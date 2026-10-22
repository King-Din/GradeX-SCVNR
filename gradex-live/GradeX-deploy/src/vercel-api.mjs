// Vercel function for the live GradeX: Express app, tables in Upstash Redis
// (free plan), uploaded files in a private Vercel Blob store.
// Secrets come from the Vercel project settings; everything else is fixed here.
import zlib from "node:zlib";
import { vercelBlobBackups, vercelBlobFiles, vercelBlobKv } from "./kv-vercel-blob.mjs";
import { uploadBudget, upstashConfig, upstashKv } from "./kv-upstash.mjs";
import { runMigrations } from "./migrations.mjs";
// A one-off loading build bundles the roster here (SEED_FILE in build-vercel.mjs); normally null.
import seedTables from "gradex-seed";

const FIXED_ENV = {
  NODE_ENV: "production",
  DATA_DRIVER: "kv",
  DEMO_MODE: "false",
  MAX_UPLOAD_MB: "4", // Vercel functions accept at most 4.5 MB per request
  FRONTEND_URL: "https://streetcausevnr.org",
  JWT_EXPIRES_IN: "7d", // the Home Screen app keeps people signed in for a week
  TRUST_PROXY_HOPS: "1", // Vercel's edge sets X-Forwarded-For to the visitor
  API_RATE_LIMIT_MAX: "100000", // in-memory per instance; a whole college shares one IP
  LOGIN_RATE_LIMIT_MAX: "30",
  VAPID_SUBJECT: "mailto:streetcause.vnrvjiet@gmail.com",
  REMINDER_WINDOW_HOURS: "26" // the reminder cron runs once a day (9 am IST, give or take an hour)
};

function configure() {
  const secret = process.env.GRADEX_JWT_SECRET ?? "";
  if (secret.length < 43) return "GRADEX_JWT_SECRET is not set";
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) return "The Blob store isn't connected";
  if (!upstashConfig()) return "Upstash Redis isn't connected";
  process.env.JWT_SECRET = secret;
  Object.assign(process.env, FIXED_ENV);
  return null;
}

let ready;
async function init() {
  const { app } = await import("../../GradeX-app/src/app.js");
  const store = await import("../../GradeX-app/src/data/store.js");
  const { createKvDriver } = await import("../../GradeX-app/src/data/kvDriver.js");
  const { setFileStore } = await import("../../GradeX-app/src/services/file.service.js");
  const { runDueReminders } = await import("../../GradeX-app/src/services/notify.service.js");
  const { TABLE_NAMES } = await import("../../GradeX-app/src/data/schema.js");
  const { conflict } = await import("../../GradeX-app/src/utils/appError.js");

  const kv = upstashKv(upstashConfig());
  await runMigrations(kv);
  /*
   * An empty Upstash store is filled once, from the tables that were in Vercel
   * Blob before the move (left there as a backup) or from a loading build's
   * roster; never with placeholder data. Saves answer with their new version
   * (no read-back), and `validate` reuses this instance's copy of every table
   * whose version hasn't changed, so each request moves only what changed.
   */
  const driver = createKvDriver({
    kv,
    verifyWrites: false,
    validate: true,
    seed: async () => {
      if (seedTables) return seedTables;
      const blob = vercelBlobKv();
      const tables = {};
      for (const name of TABLE_NAMES) tables[name] = (await blob.read(`table/${name}`))?.data ?? [];
      if (!tables.Users.length) throw new Error("The GradeX store hasn't been loaded");
      return tables;
    }
  });

  // Uploaded files stay in Blob; past its monthly upload allowance, new
  // uploads are refused (people paste a link instead) rather than risking
  // a 30-day lock on the files already there.
  const budget = uploadBudget(kv.command);
  setFileStore({
    ...vercelBlobFiles,
    async put(name, buffer) {
      if (!(await budget.allowed())) {
        throw conflict("File uploads are paused for now: this month's free storage allowance is nearly used. Paste a Google Drive or Canva link instead.");
      }
      await vercelBlobFiles.put(name, buffer);
      await budget.count().catch(() => {});
    }
  });

  const { istDate } = await import("../../GradeX-app/src/utils/time.js");
  const KEEP_DAYS = 14;
  // Today's copy of every table, and the copy that just aged out goes.
  async function backUp() {
    const tables = {};
    for (const name of TABLE_NAMES) tables[name] = await store.list(name); // the app's own view of each table
    const day = istDate();
    await vercelBlobBackups.save(day, zlib.gzipSync(JSON.stringify({ at: new Date().toISOString(), tables })));
    for (const age of [KEEP_DAYS + 1, KEEP_DAYS + 2]) await vercelBlobBackups.remove(istDate(Date.now() - age * 86400000));
    return { day, rows: Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length])) };
  }

  return {
    app,
    begin() {
      driver.beginRequest();
      store.setDriverForTests(driver);
    },
    runDueReminders,
    backUp
  };
}

const sendJson = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
};

// The /api rewrite in vercel.json hands the matched path to the function as an
// extra ?path=... query. The app's routes never take it, and its strict query
// checks reject unknown keys, so drop it before Express sees the request.
export function withoutRewriteParam(url) {
  const [pathname, query = ""] = url.split("?");
  if (!query) return url;
  const params = new URLSearchParams(query);
  if (!params.has("path")) return url;
  params.delete("path");
  const rest = params.toString();
  return rest ? `${pathname}?${rest}` : pathname;
}

export default async function handler(req, res) {
  try {
    const problem = configure();
    if (problem) {
      console.error(problem);
      return sendJson(res, 500, { success: false, error: { code: "SERVER_MISCONFIGURED", message: "The server isn't configured yet." } });
    }
    ready ??= init().catch((error) => { ready = undefined; throw error; });
    const live = await ready;
    live.begin();

    // Vercel Cron (daily): "due soon" phone reminders.
    if (req.url.startsWith("/api/cron/reminders")) {
      if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return sendJson(res, 401, { success: false });
      // Each job on its own: a failed backup never stops the reminders, or the other way round.
      const [reminders, backup] = await Promise.allSettled([live.runDueReminders(), live.backUp()]);
      if (backup.status === "rejected") console.error(`Backup failed: ${backup.reason?.stack || backup.reason}`);
      return sendJson(res, 200, {
        success: true,
        ...(reminders.status === "fulfilled" ? reminders.value : { remindersError: true }),
        backup: backup.status === "fulfilled" ? backup.value : { error: true }
      });
    }

    req.url = withoutRewriteParam(req.url);
    await new Promise((resolve) => {
      res.on("finish", resolve);
      res.on("close", resolve);
      live.app(req, res);
    });
  } catch (error) {
    console.error(error?.stack || error);
    if (!res.headersSent) sendJson(res, 500, { success: false, error: { code: "SERVER_ERROR", message: "Something went wrong. Try again." } });
  }
}

export const config = { maxDuration: 30 };
