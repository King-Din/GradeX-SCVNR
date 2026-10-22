import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./helpers.js";

// DEMO_MODE=true: the sample club is seeded and its accounts can't be changed
// (anyone knows their password), except the first-login account.
let t;
const tokens = {};
const ids = {};
const LOCKED = "Demo accounts can't be changed. Add your own account to try this.";

before(async () => {
  t = await startTestServer({ demoMode: true });
  tokens.admin = await t.login("admin@example.com");
  tokens.design = await t.login("coordinator@example.com");
  tokens.meena = await t.login("volunteer@example.com");
  tokens.priya = await t.login("eb.design@example.com");
  for (const [name, email] of Object.entries({ asha: "admin@example.com", ravi: "coordinator@example.com", meena: "volunteer@example.com", pooja: "newvolunteer@example.com", priya: "eb.design@example.com", lakshmi: "coordinator2@example.com" })) {
    ids[name] = await t.userId(email);
  }
});

after(async () => {
  await t.close();
  t.cleanup();
});

test("demo mode seeds the sample club and says so in /api/config", async () => {
  assert.ok(tokens.admin && tokens.meena);
  assert.equal((await t.call("GET", "/api/config")).body.demo, true);
});

test("sample accounts can't have their password, role, status or email changed, or be reset", async () => {
  const checks = [
    await t.call("POST", `/api/users/${ids.asha}/reset-password`, { token: tokens.admin, json: { password: "take-over-9876" } }),
    await t.call("POST", `/api/users/${ids.meena}/reset-password`, { token: tokens.admin, json: { password: "take-over-9876" } }),
    await t.call("PATCH", `/api/users/${ids.ravi}`, { token: tokens.admin, json: { role: "VOLUNTEER" } }),
    await t.call("PATCH", `/api/users/${ids.ravi}`, { token: tokens.admin, json: { email: "mine@example.org" } }),
    await t.call("PATCH", `/api/users/${ids.meena}`, { token: tokens.admin, json: { status: "DEACTIVATED" } }),
    await t.call("PATCH", `/api/users/${ids.meena}`, { token: tokens.design, json: { status: "DEACTIVATED" } }),
    await t.call("PATCH", `/api/users/${ids.ravi}`, { token: tokens.priya, json: { status: "DEACTIVATED" } }),
    await t.call("POST", "/api/auth/change-password", { token: tokens.meena, json: { currentPassword: "password123", newPassword: "lock-you-out-42" } }),
    await t.call("POST", "/api/auth/change-password", { token: tokens.admin, json: { currentPassword: "password123", newPassword: "lock-you-out-42" } })
  ];
  for (const res of checks) {
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(res.body.error.message, LOCKED);
  }
  assert.ok(await t.login("admin@example.com"), "still password123");
  assert.ok(await t.login("volunteer@example.com"));

  // Harmless edits still work.
  assert.equal((await t.call("PATCH", `/api/users/${ids.meena}`, { token: tokens.admin, json: { name: "Meena I." } })).status, 200);
});

test("the first-login sample account may set its password and choose its coordinator", async () => {
  const first = await t.login("newvolunteer@example.com");
  const changed = await t.call("POST", "/api/auth/change-password", { token: first, json: { currentPassword: "password123", newPassword: "my-own-pass-1" } });
  assert.equal(changed.status, 200);
  assert.equal((await t.call("POST", "/api/auth/coordinator", { token: changed.body.token, json: { coordinatorId: ids.lakshmi } })).status, 200);
  assert.equal((await t.call("POST", `/api/users/${ids.pooja}/reset-password`, { token: tokens.admin, json: { password: "reset-it-9876" } })).status, 403, "but nobody else can reset it");
});

test("accounts people add themselves are fully editable", async () => {
  const created = await t.call("POST", "/api/users", {
    token: tokens.admin,
    json: { name: "Visitor", email: "visitor@example.org", password: "harbor-lights-31", role: "VOLUNTEER", coordinatorId: ids.ravi }
  });
  assert.equal(created.status, 201);
  const id = created.body.user.id;
  assert.equal((await t.call("POST", `/api/users/${id}/reset-password`, { token: tokens.admin, json: { password: "another-pass-2" } })).status, 200);
  assert.equal((await t.call("PATCH", `/api/users/${id}`, { token: tokens.admin, json: { role: "COORDINATOR" } })).status, 200, "keeps the domain it had through its coordinator");
  assert.equal((await t.call("PATCH", `/api/users/${id}`, { token: tokens.admin, json: { status: "DEACTIVATED" } })).status, 200);
});
