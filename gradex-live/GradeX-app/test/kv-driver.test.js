import test from "node:test";
import assert from "node:assert/strict";
import { createKvDriver, createMemoryKv } from "../src/data/kvDriver.js";

const seed = () => ({ Users: [], Domains: [], Tasks: [], Participations: [], Submissions: [], Evaluations: [], PushSubscriptions: [], NotificationLog: [] });

test("300 submissions saved at the same moment from 4 servers: none lost, no duplicate IDs", async () => {
  const kv = createMemoryKv({ latencyMs: 8 });
  // Four separate server instances sharing one store, like Netlify scaling out.
  const servers = Array.from({ length: 4 }, () => createKvDriver({ kv, seed, maxAttempts: 200 }));

  await Promise.all(Array.from({ length: 300 }, (_, i) => {
    const driver = servers[i % servers.length];
    driver.beginRequest();
    return driver.insert("Submissions", { participationId: `P${i}`, taskId: "T001", volunteerId: `U${i}`, kind: "LINK", linkUrl: `https://x.example/${i}` });
  }));

  const check = createKvDriver({ kv, seed });
  const rows = await check.list("Submissions");
  assert.equal(rows.length, 300);
  assert.equal(new Set(rows.map((r) => r.id)).size, 300, "every ID is unique");
  assert.equal(new Set(rows.map((r) => r.participationId)).size, 300, "every submission is there");
});

test("an update from one server isn't undone by another server's stale copy", async () => {
  const kv = createMemoryKv();
  const a = createKvDriver({ kv, seed });
  const b = createKvDriver({ kv, seed });

  const task = await a.insert("Tasks", { title: "Poster", status: "DRAFT" });
  await b.list("Tasks"); // b now holds an older copy
  await a.update("Tasks", task.id, { status: "AVAILABLE" });
  await b.insert("Tasks", { title: "Second", status: "DRAFT" }); // must not overwrite a's change

  const rows = await createKvDriver({ kv, seed }).list("Tasks");
  assert.equal(rows.find((r) => r.id === task.id).status, "AVAILABLE");
  assert.equal(rows.length, 2);
});

test("a store that returns no version after saving still never loses a write", async () => {
  const kv = createMemoryKv({ latencyMs: 8, omitWriteEtag: true });
  // One server handling many requests at once shares a driver, like Netlify does.
  const shared = createKvDriver({ kv, seed, maxAttempts: 200 });
  const other = createKvDriver({ kv, seed, maxAttempts: 200 });

  await Promise.all(Array.from({ length: 120 }, (_, i) => {
    const driver = i % 3 === 0 ? other : shared;
    driver.beginRequest();
    return driver.insert("Participations", { taskId: "T001", volunteerId: `U${i}`, status: "SELECTED" });
  }));

  const rows = await createKvDriver({ kv, seed }).list("Participations");
  assert.equal(rows.length, 120);
  assert.equal(new Set(rows.map((r) => r.id)).size, 120);
});

test("server A, then B, then A again: B's save survives even when the store returns no version", async () => {
  const kv = createMemoryKv({ omitWriteEtag: true });
  const a = createKvDriver({ kv, seed });
  const b = createKvDriver({ kv, seed });

  await a.insert("Participations", { volunteerId: "U1" }); // A is left holding an empty version
  await b.insert("Participations", { volunteerId: "U2" }); // B saves in between
  await a.insert("Participations", { volunteerId: "U3" }); // A must not overwrite B's save

  const rows = await createKvDriver({ kv, seed }).list("Participations");
  assert.deepEqual(rows.map((r) => r.volunteerId).sort(), ["U1", "U2", "U3"]);
  assert.equal(new Set(rows.map((r) => r.id)).size, 3);
});

test("a store that sometimes says 'saved' but drops the write still ends up with every record", async () => {
  const kv = createMemoryKv({ latencyMs: 5, dropRate: 0.3 });
  const servers = Array.from({ length: 3 }, () => createKvDriver({ kv, seed, maxAttempts: 200 }));

  await Promise.all(Array.from({ length: 60 }, (_, i) => {
    const driver = servers[i % servers.length];
    driver.beginRequest();
    return driver.insert("Tasks", { title: `Burst ${i}` });
  }));

  const rows = await createKvDriver({ kv, seed }).list("Tasks");
  assert.equal(rows.length, 60);
  assert.equal(new Set(rows.map((r) => r.id)).size, 60);
});

test("a unique guard holds across servers: two instances scoring the same submission at once save one evaluation", async () => {
  const kv = createMemoryKv({ latencyMs: 8 });
  const servers = Array.from({ length: 4 }, () => createKvDriver({ kv, seed, maxAttempts: 200 }));
  const unique = (rows) => rows.some((e) => e.submissionId === "S001");

  const results = await Promise.allSettled(servers.map((driver, i) => {
    driver.beginRequest();
    return driver.insert("Evaluations", { submissionId: "S001", evaluatorId: `U${i}`, score: 50 + i }, { unique });
  }));

  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.ok(results.filter((r) => r.status === "rejected").every((r) => r.reason.code === "DUPLICATE_ROW"));
  const rows = await createKvDriver({ kv, seed }).list("Evaluations");
  assert.equal(rows.length, 1);
});

test("seeding: tables first, marker last; a half-finished seed is completed, existing data is never overwritten", async () => {
  const kv = createMemoryKv();
  // A previous run wrote Users and died before the rest (and before the marker).
  await kv.write("table/Users", [{ id: "U001", email: "kept@example.com" }], { create: true });

  let seeds = 0;
  const seeder = () => {
    seeds += 1;
    return { ...seed(), Users: [{ id: "U001", email: "seeded@example.com" }], Domains: [{ id: "D001", name: "Design" }] };
  };
  const driver = createKvDriver({ kv, seed: seeder });

  assert.deepEqual((await driver.list("Users")).map((u) => u.email), ["kept@example.com"], "existing table kept");
  assert.equal((await driver.list("Domains")).length, 1, "missing table created");
  assert.ok(await kv.read("meta/seeded"), "marker written");

  // Once the marker exists nothing is seeded again, and a lost table is just empty.
  const later = createKvDriver({ kv, seed: seeder });
  await later.list("Users");
  assert.equal(seeds, 1);
  const noTasks = createMemoryKv();
  await noTasks.write("meta/seeded", { at: "x" });
  assert.deepEqual(await createKvDriver({ kv: noTasks, seed: seeder }).list("Tasks"), []);
});

test("the memory and local drivers honour the unique guard too", async () => {
  const { createMemoryDriver } = await import("../src/data/memoryDriver.js");
  const { createLocalDriver } = await import("../src/data/localDriver.js");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gradex-unique-"));

  const drivers = [createMemoryDriver(seed()), createLocalDriver({ file: path.join(dir, "db.json"), seed })];
  for (const driver of drivers) {
    const unique = (rows) => rows.some((p) => p.taskId === "T001" && p.volunteerId === "U004");
    await driver.insert("Participations", { taskId: "T001", volunteerId: "U004" }, { unique });
    await assert.rejects(driver.insert("Participations", { taskId: "T001", volunteerId: "U004" }, { unique }), (e) => e.code === "DUPLICATE_ROW");
    assert.equal((await driver.list("Participations")).length, 1);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- Hosted options (22 Oct 2026): shared short cache, no read-back, per-request copies ----

function countingKv(inner) {
  const counts = { reads: 0, writes: 0 };
  return {
    counts,
    async read(key) { counts.reads += 1; return inner.read(key); },
    async write(key, data, options) { counts.writes += 1; return inner.write(key, data, options); }
  };
}

test("with cacheMs, several reads in a burst cost one store read, and a save needs no read-back", async () => {
  const kv = countingKv(createMemoryKv());
  const driver = createKvDriver({ kv, seed, cacheMs: 60_000, verifyWrites: false });
  await driver.list("Tasks");
  const afterFirst = kv.counts.reads;
  for (let i = 0; i < 5; i += 1) { driver.beginRequest(); await driver.list("Tasks"); }
  assert.equal(kv.counts.reads, afterFirst, "later requests reuse the shared copy");
  const readsBeforeSave = kv.counts.reads;
  const task = await driver.insert("Tasks", { title: "One", status: "DRAFT" });
  assert.equal(kv.counts.reads, readsBeforeSave, "no read-back after the save");
  driver.beginRequest();
  assert.ok((await driver.list("Tasks")).some((r) => r.id === task.id), "this instance sees its own save at once");
});

test("a stale shared copy never loses another server's save: the conditional write retries on fresh data", async () => {
  const kv = createMemoryKv();
  const a = createKvDriver({ kv, seed, cacheMs: 60_000, verifyWrites: false });
  const b = createKvDriver({ kv, seed, cacheMs: 60_000, verifyWrites: false });
  await a.list("Tasks");
  await b.list("Tasks"); // b caches the empty table
  await a.insert("Tasks", { title: "From A", status: "DRAFT" });
  b.beginRequest();
  await b.insert("Tasks", { title: "From B", status: "DRAFT" }); // b's copy is stale
  const rows = await createKvDriver({ kv, seed }).list("Tasks");
  assert.deepEqual(rows.map((r) => r.title).sort(), ["From A", "From B"]);
  assert.equal(new Set(rows.map((r) => r.id)).size, 2);
});

test("refresh() skips the shared copy for the rest of the request", async () => {
  const kv = createMemoryKv();
  const a = createKvDriver({ kv, seed, cacheMs: 60_000, verifyWrites: false });
  const b = createKvDriver({ kv, seed, cacheMs: 60_000, verifyWrites: false });
  const user = await a.insert("Users", { name: "Asha", email: "a@x.org", role: "VOLUNTEER", tokenVersion: 0 });
  await b.list("Users");
  await a.update("Users", user.id, { tokenVersion: 1 });
  b.beginRequest();
  assert.equal((await b.list("Users"))[0].tokenVersion, 0, "b's shared copy is still old");
  await b.refresh("Users");
  assert.equal((await b.list("Users"))[0].tokenVersion, 1, "after refresh it's current");
});

test("requests running side by side on one instance each keep their own copy", async () => {
  const kv = createMemoryKv({ latencyMs: 5 });
  const driver = createKvDriver({ kv, seed });
  await driver.insert("Tasks", { title: "Before", status: "DRAFT" });
  const other = createKvDriver({ kv, seed });

  const slow = (async () => {
    driver.beginRequest();
    const first = (await driver.list("Tasks")).length;
    await new Promise((r) => setTimeout(r, 40));
    const second = (await driver.list("Tasks")).length;
    return [first, second];
  })();
  await new Promise((r) => setTimeout(r, 10));
  await other.insert("Tasks", { title: "Meanwhile", status: "DRAFT" });
  const fresh = (async () => {
    driver.beginRequest();
    return (await driver.list("Tasks")).length;
  })();

  const [[first, second], seen] = await Promise.all([slow, fresh]);
  assert.equal(first, second, "a request's view doesn't change under it");
  assert.equal(seen, 2, "a request that started later sees the new task");
});

test("update guards are checked against the rows being written (two servers can't both make a head)", async () => {
  const kv = createMemoryKv({ latencyMs: 5 });
  const a = createKvDriver({ kv, seed, maxAttempts: 50 });
  const b = createKvDriver({ kv, seed, maxAttempts: 50 });
  const x = await a.insert("Users", { name: "X", email: "x@x.org", role: "COORDINATOR", domainId: "D001", status: "ACTIVE" });
  const y = await a.insert("Users", { name: "Y", email: "y@x.org", role: "COORDINATOR", domainId: "D001", status: "ACTIVE" });
  const oneHead = (others, next) => next.role === "EB" && others.some((o) => o.role === "EB" && o.domainId === next.domainId);
  const results = await Promise.allSettled([
    a.update("Users", x.id, { role: "EB" }, { unique: oneHead }),
    b.update("Users", y.id, { role: "EB" }, { unique: oneHead })
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.find((r) => r.status === "rejected").reason.code, "DUPLICATE_ROW");
  const rows = await createKvDriver({ kv, seed }).list("Users");
  assert.equal(rows.filter((r) => r.role === "EB").length, 1);
});

// ---- validate: version-checked shared copies (Upstash) ----

test("validate: unchanged tables are reused across requests; one versions call per request", async () => {
  const kv = createMemoryKv({ withVersions: true });
  const driver = createKvDriver({ kv, seed, validate: true, verifyWrites: false });
  driver.beginRequest();
  await driver.list("Tasks");
  await driver.list("Users");
  const reads = kv.counts.reads;
  for (let i = 0; i < 5; i += 1) {
    driver.beginRequest();
    await Promise.all([driver.list("Tasks"), driver.list("Users"), driver.list("Tasks")]);
  }
  assert.equal(kv.counts.reads, reads, "no table re-read while versions match");
  assert.ok(kv.counts.versions <= 7, `one versions call per request (got ${kv.counts.versions})`);
});

test("validate: another server's save shows on the very next request, and only that table is re-read", async () => {
  const kv = createMemoryKv({ withVersions: true });
  const a = createKvDriver({ kv, seed, validate: true, verifyWrites: false });
  const b = createKvDriver({ kv, seed, validate: true, verifyWrites: false });
  b.beginRequest();
  await b.list("Tasks");
  await b.list("Users");
  a.beginRequest();
  await a.insert("Tasks", { title: "From A", status: "DRAFT" });

  const before = kv.counts.reads;
  b.beginRequest();
  const tasks = await b.list("Tasks");
  await b.list("Users");
  assert.ok(tasks.some((t) => t.title === "From A"), "b sees a's save at once");
  assert.equal(kv.counts.reads - before, 1, "only the changed table was read");
});

test("validate: saves from stale copies still never lose data", async () => {
  const kv = createMemoryKv({ withVersions: true, latencyMs: 4 });
  const servers = Array.from({ length: 3 }, () => createKvDriver({ kv, seed, validate: true, verifyWrites: false, maxAttempts: 200 }));
  await Promise.all(Array.from({ length: 60 }, (_, i) => {
    const d = servers[i % 3];
    d.beginRequest();
    return d.insert("Submissions", { participationId: `P${i}`, taskId: "T1", volunteerId: `U${i}`, kind: "LINK", linkUrl: `https://x.example/${i}` });
  }));
  const rows = await createKvDriver({ kv, seed }).list("Submissions");
  assert.equal(rows.length, 60);
  assert.equal(new Set(rows.map((r) => r.id)).size, 60);
});
