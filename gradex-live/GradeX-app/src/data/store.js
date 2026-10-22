import { env } from "../config/env.js";
import { busy, conflict } from "../utils/appError.js";
import { createLocalDriver } from "./localDriver.js";
import { createSheetsDriver } from "./sheetsDriver.js";
import { initialData } from "./seed.js";

let driver;

// What a brand-new store is filled with: the demo club in DEMO_MODE,
// otherwise the domains and the bootstrap admin.
export function seedForEnv() {
  return initialData({
    demo: env.DEMO_MODE,
    adminEmail: env.BOOTSTRAP_ADMIN_EMAIL,
    adminPassword: env.BOOTSTRAP_ADMIN_PASSWORD
  });
}

function createDriver() {
  if (env.DATA_DRIVER === "local") {
    return createLocalDriver({ file: env.LOCAL_DATA_FILE, seed: seedForEnv });
  }

  if (env.DATA_DRIVER === "kv") {
    // The host builds the kv driver (it owns the Blobs client) and calls setDriver().
    throw new Error("DATA_DRIVER=kv: the host must call setDriver(createKvDriver(...)) before handling requests");
  }

  // Imported lazily so local mode never loads googleapis credentials.
  return import("../services/google.service.js").then(({ getSheetsClient }) =>
    createSheetsDriver({
      client: getSheetsClient(),
      spreadsheetId: env.GOOGLE_SPREADSHEET_ID,
      cacheTtlMs: env.SHEETS_CACHE_TTL_MS
    })
  );
}

async function getDriver() {
  driver ??= createDriver();
  return driver;
}

export function setDriver(nextDriver) {
  driver = nextDriver;
}

// Older name, kept for existing callers.
export const setDriverForTests = setDriver;

export async function list(table) {
  return (await getDriver()).list(table);
}

// Drivers that share recent reads between requests can be asked for the
// latest copy (e.g. when a token looks newer than the copy of its user).
export async function refresh(table) {
  const active = await getDriver();
  if (active.refresh) await active.refresh(table);
}

// Single-file queue for raw writes, so two inserts can never read the same
// "next ID". Separate from withWriteLock, which wraps whole check-then-write
// operations and calls these inside it.
let writeQueue = Promise.resolve();

function queued(work) {
  const run = writeQueue.then(work, work);
  writeQueue = run.catch(() => {});
  return run;
}

/*
 * `options.unique(rows)` returns true when the record already exists (for
 * example "this volunteer already picked this task"). The driver checks it
 * against the rows it is about to write, so the rule also holds across
 * several server instances; a hit becomes a 409 with `options.duplicateMessage`.
 */
export async function insert(table, values, { unique, duplicateMessage } = {}) {
  const active = await getDriver();
  try {
    return await queued(() => active.insert(table, values, unique ? { unique } : undefined));
  } catch (error) {
    if (error?.code === "DUPLICATE_ROW") throw conflict(duplicateMessage ?? "That already exists");
    throw error;
  }
}

// `options.unique(otherRows, nextRow)` guards one-of rules on edits the same
// way insert's does (drivers that can't check it just apply the change).
export async function update(table, id, patch, { unique, duplicateMessage } = {}) {
  const active = await getDriver();
  try {
    return await queued(() => active.update(table, id, patch, unique ? { unique } : undefined));
  } catch (error) {
    if (error?.code === "DUPLICATE_ROW") throw conflict(duplicateMessage ?? "That already exists");
    throw error;
  }
}

export async function findById(table, id) {
  return (await list(table)).find((row) => row.id === id) ?? null;
}

export async function resetLocalData() {
  const active = await getDriver();
  if (typeof active.reset !== "function") throw new Error("Only the local driver can be reset");
  await active.reset();
}

/*
 * Every write that first checks something ("has this volunteer already
 * submitted?") runs inside this lock, so two requests cannot both pass the
 * check and write twice. This covers one server process; across processes
 * the drivers' `unique` guards keep the important rules.
 *
 * Nothing slow (uploads, notifications) belongs inside it. As a safety net,
 * a caller that can't finish within the timeout (waiting included) gets
 * "The server is busy, try again" and the lock moves on. Work that hasn't
 * started by then never runs; work already running can't be stopped, but no
 * longer holds everyone else up.
 */
export const WRITE_LOCK_TIMEOUT_MS = 20_000;
let tail = Promise.resolve();

export function withWriteLock(work, { timeoutMs = WRITE_LOCK_TIMEOUT_MS } = {}) {
  let timedOut = false;
  let timer;

  const run = tail.then(() => {
    if (timedOut) throw busy();
    return work();
  });

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(busy());
    }, timeoutMs);
    timer.unref?.();
  });

  const guarded = Promise.race([run, timeout]).finally(() => clearTimeout(timer));
  run.catch(() => {}); // a late failure after a timeout is not unhandled
  // After a timeout the next holder doesn't wait for hung work, so one stuck
  // save can't block everyone; overlapping saves stay safe because every
  // hosted save is conditional on the version it read.
  tail = guarded.catch(() => {});
  return guarded;
}
