import { AsyncLocalStorage } from "node:async_hooks";
import { assertUnique, DuplicateRowError, deserializeRow, nextIdFor, TABLE_NAMES } from "./schema.js";

/*
 * Storage on a key-value store with conditional writes (Netlify Blobs in the
 * hosted app). Each table is one entry, written with "only if nobody else
 * changed it since I read it". When two people save at the same moment, the
 * loser re-reads and re-applies its change, so nothing is ever overwritten.
 *
 * kv.read(key)                    -> { data, etag } | null
 * kv.write(key, data, { etag })   -> { modified, etag }   (etag: only if unchanged)
 * kv.write(key, data, { create }) -> { modified, etag }   (create: only if missing)
 * kv.write(key, data)             -> { modified, etag }   (unconditional)
 *
 * Options (both off by default):
 * - cacheMs: share each table's last read between requests on this server
 *   instance for this long, so a page that makes several API calls reads the
 *   store once. A save updates the copy straight away, so an instance always
 *   sees its own saves; another instance's saves show up within cacheMs.
 *   Saves stay safe: they're conditional on the version, and a stale copy only
 *   makes the save retry with fresh data.
 * - verifyWrites (on by default): read every save back to check it landed.
 *   Netlify Blobs could report success for a dropped write; stores that answer
 *   reliably with the new version can skip the extra read.
 * - validate: for stores whose kv has versions() -> { key: etag } in one cheap
 *   call. Each request asks for all versions once, then reuses this
 *   instance's copy of every table whose version hasn't changed and reads only
 *   the ones that have. Always current (unlike cacheMs), and a page that makes
 *   several API calls moves only what changed (Upstash meters commands and
 *   bandwidth).
 */
export function createKvDriver({ kv, seed, maxAttempts = 25, cacheMs = 0, verifyWrites = true, validate = false }) {
  // One consistent copy of each table per request. Requests run side by side
  // on one instance, so each request's copy lives in its own async context;
  // code that never begins a request (scripts, tests) shares `outside`.
  const requests = new AsyncLocalStorage();
  const outside = new Map();
  const snapshot = () => requests.getStore() ?? outside;
  const shared = new Map(); // table -> { data, etag, at }, across requests on this instance
  let seeded = false;

  const keyFor = (name) => `table/${name}`;

  const MARKER = "meta/seeded";

  /*
   * First use of an empty store: every table is created (only if missing, so
   * nothing that already exists is overwritten), then the marker is written
   * last. If a run dies half-way, the marker is absent and the next request
   * finishes the job. Stores from before the marker existed already have
   * their tables, so they simply get the marker.
   */
  async function ensureSeeded() {
    if (seeded) return;
    if (!(await kv.read(MARKER))) {
      const tables = await seed();
      for (const name of TABLE_NAMES) {
        await kv.write(keyFor(name), tables[name] ?? [], { create: true });
      }
      await kv.write(MARKER, { at: new Date().toISOString() }, { create: true });
    }
    seeded = true;
  }

  const validating = validate && typeof kv.versions === "function";
  const VERSIONS = Symbol("versions");

  function remember(name, entry) {
    snapshot().set(name, entry);
    if ((cacheMs > 0 || validating) && entry?.etag) shared.set(name, { ...entry, at: Date.now() });
  }

  // One versions call per request, shared by the request's parallel reads.
  function requestVersions() {
    const snap = snapshot();
    if (!snap.has(VERSIONS)) snap.set(VERSIONS, kv.versions().catch(() => ({})));
    return snap.get(VERSIONS);
  }

  // `useShared: false` always asks the store (after a conflict, or to check a save).
  async function fresh(name, { useShared = true } = {}) {
    await ensureSeeded();
    const cached = useShared ? shared.get(name) : null;
    if (cached && validating && (await requestVersions())[keyFor(name)] === cached.etag) {
      snapshot().set(name, cached);
      return cached;
    }
    if (cached && !validating && cacheMs > 0 && Date.now() - cached.at < cacheMs) {
      snapshot().set(name, cached);
      return cached;
    }
    let entry = await kv.read(keyFor(name));
    if (!entry) {
      await kv.write(keyFor(name), [], { create: true });
      entry = await kv.read(keyFor(name));
    }
    remember(name, entry);
    return entry;
  }

  async function current(name) {
    return snapshot().get(name) ?? fresh(name);
  }

  // `change` edits the rows and returns the row it wrote, so we can check it
  // really landed: some stores report success for a write that was dropped
  // (for example when throttled), so every save is read back and retried.
  async function mutate(name, change) {
    let entry = await current(name);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      // Never save without a version tag: that would be a blind overwrite.
      if (!entry.etag) entry = await fresh(name, { useShared: false });
      if (!entry.etag) throw new Error(`Storage gave no version for ${name}; refusing to overwrite it`);

      const rows = structuredClone(entry.data);
      const written = change(rows);
      const { modified, etag } = await kv.write(keyFor(name), rows, { etag: entry.etag });

      if (modified && !verifyWrites && etag) {
        remember(name, { data: rows, etag });
        return { ...written };
      }
      if (modified) {
        const check = await fresh(name, { useShared: false });
        const landed = check.data.some((row) => row.id === written.id && sameRow(row, written));
        if (landed) return { ...written };
        entry = check;
        continue;
      }

      // Someone else saved first: back off a little, re-read, try again.
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 20 * attempt));
      entry = await fresh(name, { useShared: false });
    }

    throw new Error(`Could not save to ${name}: too many people saving at once. Try again.`);
  }

  return {
    // Call at the start of every request so it sees other people's changes.
    beginRequest() {
      requests.enterWith(new Map());
      outside.clear();
    },

    async list(name) {
      return (await current(name)).data.map((row) => deserializeRow(name, row));
    },

    // Re-read a table from the store for the rest of this request (skips the shared copy).
    async refresh(name) {
      await fresh(name, { useShared: false });
    },

    // `unique(rows)` returning true means "already there": checked against
    // the exact rows being written, again on every retry.
    async insert(name, values, { unique } = {}) {
      return mutate(name, (rows) => {
        assertUnique(name, rows, unique);
        const row = deserializeRow(name, { ...values, id: nextIdFor(name, rows) });
        rows.push(row);
        return row;
      });
    },

    // `unique(otherRows, nextRow)` returning true means the change would
    // break a one-of rule; checked against the exact rows being written.
    async update(name, id, patch, { unique } = {}) {
      return mutate(name, (rows) => {
        const index = rows.findIndex((row) => row.id === id);
        if (index === -1) throw new Error(`${name} record ${id} not found`);
        const next = deserializeRow(name, { ...rows[index], ...patch, id });
        const others = rows.filter((_, i) => i !== index).map((row) => deserializeRow(name, row));
        if (typeof unique === "function" && unique(others, next)) throw new DuplicateRowError(name);
        rows[index] = next;
        return rows[index];
      });
    },

    async reset() {
      const tables = await seed();
      await Promise.all(TABLE_NAMES.map((name) => kv.write(keyFor(name), tables[name] ?? [])));
      await kv.write(MARKER, { at: new Date().toISOString() });
      snapshot().clear();
      outside.clear();
      shared.clear();
      seeded = true;
    }
  };
}

function sameRow(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// In-memory kv with the same conditional-write rules, for tests and local runs.
export function createMemoryKv({ latencyMs = 0, omitWriteEtag = false, dropRate = 0, withVersions = false } = {}) {
  const entries = new Map();
  let version = 0;
  const pause = () => (latencyMs ? new Promise((r) => setTimeout(r, Math.random() * latencyMs)) : null);
  const counts = { reads: 0, writes: 0, versions: 0 };

  return {
    counts,
    ...(withVersions ? {
      async versions() {
        counts.versions += 1;
        await pause();
        return Object.fromEntries([...entries].map(([key, entry]) => [key, entry.etag]));
      }
    } : {}),
    async read(key) {
      counts.reads += 1;
      await pause();
      const entry = entries.get(key);
      return entry ? { data: structuredClone(entry.data), etag: entry.etag } : null;
    },
    async write(key, data, { etag, create } = {}) {
      counts.writes += 1;
      await pause();
      const existing = entries.get(key);
      if (create && existing) return { modified: false };
      // Like Netlify Blobs: an empty etag means "no condition", i.e. overwrite.
      if (etag && existing?.etag !== etag) return { modified: false };
      // Like a throttled store: report success but never save.
      if (dropRate && Math.random() < dropRate) return { modified: true, etag: "" };
      const next = { data: structuredClone(data), etag: `v${++version}` };
      entries.set(key, next);
      // Netlify Blobs sometimes answers a successful write with an empty etag.
      return { modified: true, etag: omitWriteEtag ? "" : next.etag };
    }
  };
}
