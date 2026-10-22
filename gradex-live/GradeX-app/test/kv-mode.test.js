import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { PDF_BYTES, inDays, startTestServer, teamTask } from "./helpers.js";

// DATA_DRIVER=kv as the hosted build runs it: the host injects the kv driver
// with store.setDriver() and its file storage with setFileStore().
let t;
const files = new Map();

before(async () => {
  t = await startTestServer({ seed: "none", env: { DATA_DRIVER: "kv", DEMO_MODE: "true", MAX_UPLOAD_MB: "2" } });
  const { createKvDriver, createMemoryKv } = await import("../src/data/kvDriver.js");
  const { buildSeed } = await import("../src/data/seed.js");
  const { setFileStore } = await import("../src/services/file.service.js");
  t.store.setDriver(createKvDriver({ kv: createMemoryKv(), seed: () => buildSeed() }));
  setFileStore({
    put: async (name, buffer) => { files.set(name, Buffer.from(buffer)); },
    get: async (name) => files.get(name) ?? null,
    remove: async (name) => { files.delete(name); }
  });
});

after(async () => {
  await t.close();
  t.cleanup();
});

test("uploads go to the host's file store and download back through the API", async () => {
  const tokens = { priya: await t.login("eb.design@example.com"), ravi: await t.login("coordinator@example.com") };
  const design = tokens.ravi;
  const meena = await t.login("volunteer@example.com");
  const { task } = await teamTask(t, tokens, { deadline: inDays(3) });
  assert.equal((await t.call("POST", `/api/tasks/${task.id}/choose`, { token: meena })).status, 201);

  const form = new FormData();
  form.append("taskId", task.id);
  form.append("file", new Blob([PDF_BYTES], { type: "application/pdf" }), "poster.pdf");
  const sent = await t.call("POST", "/api/submissions", { token: meena, form });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.equal(files.size, 1);

  for (const token of [meena, design]) {
    const res = await fetch(`${process.env.GRADEX_TEST_BASE}/api/submissions/${sent.body.submission.id}/file`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /application\/pdf/);
    assert.deepEqual(new Uint8Array(await res.arrayBuffer()), PDF_BYTES);
  }

  const nikhil = await t.login("nikhil@example.com");
  const blocked = await fetch(`${process.env.GRADEX_TEST_BASE}/api/submissions/${sent.body.submission.id}/file`, { headers: { Authorization: `Bearer ${nikhil}` } });
  assert.equal(blocked.status, 404);
});

test("MAX_UPLOAD_MB sets the upload limit and is published in /api/config", async () => {
  assert.equal((await t.call("GET", "/api/config")).body.maxUploadMb, 2);
  const tokens = { priya: await t.login("eb.design@example.com"), ravi: await t.login("coordinator@example.com") };
  const kavya = await t.login("kavya@example.com");
  const { task } = await teamTask(t, tokens, { deadline: inDays(3) });
  await t.call("POST", `/api/tasks/${task.id}/choose`, { token: kavya });

  const big = new Uint8Array(3 * 1024 * 1024);
  big.set(PDF_BYTES);
  const form = new FormData();
  form.append("taskId", task.id);
  form.append("file", new Blob([big], { type: "application/pdf" }), "big.pdf");
  const res = await t.call("POST", "/api/submissions", { token: kavya, form });
  assert.equal(res.status, 413);
  assert.match(res.body.error.message, /2 MB/);
});

test("DATA_DRIVER=kv is accepted in production, and setDriverForTests is still an alias of setDriver", async () => {
  const { spawnSync } = await import("node:child_process");
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", "await import('./src/config/env.js'); console.log('ok')"], {
    env: { ...process.env, NODE_ENV: "production", DATA_DRIVER: "kv", JWT_SECRET: "k3J9xQ2mP7vR5tW8yL1nB6cH4dF0gS2aZ9eU7iO3pX5qT" },
    encoding: "utf8"
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(t.store.setDriverForTests, t.store.setDriver);
});
