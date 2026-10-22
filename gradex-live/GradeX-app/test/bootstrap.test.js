import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./helpers.js";

// A new real store (DEMO_MODE off): no sample accounts, just the domains and
// one admin from BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD.
let t;

before(async () => {
  t = await startTestServer({
    seed: "none",
    env: { BOOTSTRAP_ADMIN_EMAIL: "EB.Lead@StreetCause.org", BOOTSTRAP_ADMIN_PASSWORD: "first-setup-pass-1" }
  });
});

after(async () => {
  await t.close();
  t.cleanup();
});

test("no demo accounts exist outside demo mode", async () => {
  const res = await t.call("POST", "/api/auth/login", { json: { email: "admin@example.com", password: "password123" } });
  assert.equal(res.status, 401);
  assert.equal((await t.call("GET", "/api/config")).body.demo, false);
});

test("the bootstrap admin signs in and must change the password first", async () => {
  const token = await t.login("eb.lead@streetcause.org", "first-setup-pass-1");
  assert.ok(token);
  const blocked = await t.call("GET", "/api/users", { token });
  assert.equal(blocked.body.error.code, "PASSWORD_CHANGE_REQUIRED");

  const changed = await t.call("POST", "/api/auth/change-password", { token, json: { currentPassword: "first-setup-pass-1", newPassword: "real-admin-pass-7" } });
  assert.equal(changed.status, 200);

  const users = (await t.call("GET", "/api/users", { token: changed.body.token })).body.users;
  assert.equal(users.length, 1);
  assert.equal(users[0].role, "ADMIN");
  const domains = (await t.call("GET", "/api/domains", { token: changed.body.token })).body.domains;
  assert.deepEqual(domains.map((d) => d.id), ["D001", "D002", "D003"]);
  assert.equal((await t.call("GET", "/api/tasks", { token: changed.body.token })).body.tasks.length, 0);
});
