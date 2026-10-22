import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./helpers.js";

// Failed logins are limited per address AND account, so one person's typos
// never lock out everyone behind the same college IP.
let t;

before(async () => {
  t = await startTestServer({ env: { LOGIN_RATE_LIMIT_MAX: "3" } });
});

after(async () => {
  await t.close();
  t.cleanup();
});

test("one account's failed logins don't block other accounts from the same address", async () => {
  const fail = (email) => t.call("POST", "/api/auth/login", { json: { email, password: "wrong-password" } });
  for (let i = 0; i < 3; i += 1) assert.equal((await fail("volunteer@example.com")).status, 401);
  assert.equal((await fail("volunteer@example.com")).status, 429);
  assert.equal((await fail("VOLUNTEER@example.com")).status, 429, "same account in other capitals");

  assert.equal((await fail("kavya@example.com")).status, 401, "a different account isn't limited");
  assert.ok(await t.login("arjun@example.com"));
});
