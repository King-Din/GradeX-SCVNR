import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { inDays, loginAll, startTestServer } from "./helpers.js";

// Regressions for the 22 Oct 2026 QA pass (backend audit + hosting audit).
let t;
let tokens = {};
const ids = {};

before(async () => {
  t = await startTestServer();
  tokens = await loginAll(t, ["admin", "priya", "ravi", "lakshmi", "meena", "kavya"]);
  for (const [name, email] of Object.entries({ ravi: "coordinator@example.com", lakshmi: "coordinator2@example.com", meena: "volunteer@example.com", priya: "eb.design@example.com" })) {
    ids[name] = await t.userId(email);
  }
});

after(async () => {
  await t.close();
  t.cleanup();
});

const get = (url, token) => t.call("GET", url, { token });
const post = (url, token, json) => t.call("POST", url, { token, json });
const put = (url, token, json) => t.call("PUT", url, { token, json });
const patch = (url, token, json) => t.call("PATCH", url, { token, json });

async function signInFresh(email, password) {
  const first = await t.login(email, password);
  const changed = await post("/api/auth/change-password", first, { currentPassword: password, newPassword: "my-own-pass-1984" });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  return changed.body.token;
}

test("a coordinator never sees the private Keep/Warn/Remove decision about themselves", async () => {
  assert.equal((await put(`/api/users/${ids.ravi}/decision`, tokens.priya, { decision: "WARN", note: "PRIVATE note" })).status, 200);
  const list = (await get("/api/users", tokens.ravi)).body.users;
  const self = list.find((u) => u.id === ids.ravi);
  assert.ok(self, "still sees their own row");
  for (const key of ["decision", "decisionNote", "decisionBy", "decisionAt"]) assert.ok(!(key in self), `no ${key} in the list`);
  const one = (await get(`/api/users/${ids.ravi}`, tokens.ravi)).body.user;
  assert.ok(!("decisionNote" in one) && !("decision" in one), "nor on their own record");
  assert.equal((await get(`/api/users/${ids.ravi}`, tokens.priya)).body.user.decisionNote, "PRIVATE note", "the EB head still does");
});

test("a coordinator who picks their first domain brings their team; a volunteer with a coordinator can't pick a domain", async () => {
  const csv = await post("/api/users/import", tokens.admin, { users: [
    { name: "Floating Lead", email: "float.lead@example.com", role: "COORDINATOR", password: "start-here-55" },
    { name: "Floating Vol", email: "float.vol@example.com", role: "VOLUNTEER", password: "start-here-55", coordinatorEmail: "float.lead@example.com" }
  ] });
  assert.equal(csv.status, 200, JSON.stringify(csv.body));
  assert.ok(csv.body.results.every((r) => r.ok), JSON.stringify(csv.body.results));

  const vol = await signInFresh("float.vol@example.com", "start-here-55");
  assert.equal((await post("/api/auth/domain", vol, { domainId: "D003" })).status, 409, "domain comes from the coordinator");

  const lead = await signInFresh("float.lead@example.com", "start-here-55");
  assert.equal((await post("/api/auth/domain", lead, { domainId: "D001" })).status, 200);
  const me = (await get("/api/auth/me", vol)).body.user;
  assert.equal(me.domainId, "D001", "the team followed");
  assert.ok((await get("/api/reports/people", tokens.priya)).body.people.some((r) => r.person.email === "float.vol@example.com"), "and the Design EB head sees them");
});

test("a coordinator with active volunteers can't be deactivated until the team moves", async () => {
  const res = await patch(`/api/users/${ids.ravi}`, tokens.priya, { status: "DEACTIVATED" });
  assert.equal(res.status, 409);
  assert.match(res.body.error.message, /Move them to another coordinator first/);
});

test("an EB deadline can't move before the team deadlines forwarded from it", async () => {
  const eb = (await post("/api/tasks", tokens.priya, { title: "QA EB", description: "x", deadline: inDays(10), status: "AVAILABLE" })).body.task;
  const teamDeadline = inDays(9);
  assert.equal((await post(`/api/tasks/${eb.id}/forward`, tokens.ravi, { deadline: teamDeadline })).status, 201);
  const early = await put(`/api/tasks/${eb.id}`, tokens.priya, { deadline: inDays(2) });
  assert.equal(early.status, 400);
  assert.match(early.body.error.message, /team is working to/);
  assert.equal((await put(`/api/tasks/${eb.id}`, tokens.priya, { deadline: inDays(9.5) })).status, 200, "on or after the team deadline is fine");
});

test("an approved proposal keeps the brief the EB head approved", async () => {
  const proposal = (await post("/api/tasks/proposals", tokens.ravi, { title: "Small poster", description: "A5 poster", deadline: inDays(6) })).body.task;
  assert.equal((await post(`/api/tasks/${proposal.id}/approve`, tokens.priya, {})).status, 200);
  const rewrite = await put(`/api/tasks/${proposal.id}`, tokens.ravi, { title: "Something else", description: "Totally different" });
  assert.equal(rewrite.status, 409);
  assert.equal((await put(`/api/tasks/${proposal.id}`, tokens.ravi, { deadline: inDays(7) })).status, 200, "the date can still move");
  assert.equal((await put(`/api/tasks/${proposal.id}`, tokens.admin, { title: "Small poster (A5)" })).status, 200, "an admin can still correct it");
});

test("a draft whose deadline passed can get a new date, and can't be published expired", async () => {
  const draft = (await post("/api/tasks", tokens.priya, { title: "Late draft", description: "x", deadline: inDays(5), status: "DRAFT" })).body.task;
  await t.store.update("Tasks", draft.id, { deadline: inDays(-1) });
  const publish = await put(`/api/tasks/${draft.id}`, tokens.priya, { status: "AVAILABLE" });
  assert.equal(publish.status, 409);
  assert.match(publish.body.error.message, /deadline has passed/);
  assert.equal((await put(`/api/tasks/${draft.id}`, tokens.priya, { deadline: inDays(4) })).status, 200, "a draft can be re-dated");
  assert.equal((await put(`/api/tasks/${draft.id}`, tokens.priya, { status: "AVAILABLE" })).status, 200);
});

async function teamTaskForMeena() {
  const eb = (await post("/api/tasks", tokens.priya, { title: `Upload EB ${Math.random()}`, description: "x", deadline: inDays(10), status: "AVAILABLE" })).body.task;
  const team = (await post(`/api/tasks/${eb.id}/forward`, tokens.ravi, { deadline: inDays(8) })).body.task;
  assert.equal((await post(`/api/tasks/${team.id}/choose`, tokens.meena, {})).status, 201);
  return team;
}

test("broken uploads get a 400, not a server error", async () => {
  const team = await teamTaskForMeena();
  for (const [contentType, body] of [
    ["multipart/form-data; boundary=XX", `--XX\r\nContent-Disposition: form-data; name="taskId"\r\n\r\n${team.id}\r\n--XX\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\nhello`],
    ["multipart/form-data", "garbage"]
  ]) {
    const res = await fetch(`${process.env.GRADEX_TEST_BASE}/api/submissions`, { method: "POST", headers: { Authorization: `Bearer ${tokens.meena}`, "Content-Type": contentType }, body });
    assert.equal(res.status, 400, `${contentType} -> ${res.status}`);
  }
});

test("uploaded file names keep their Telugu/Hindi letters, and empty files are refused", async () => {
  const team = await teamTaskForMeena();
  const empty = new FormData();
  empty.set("taskId", team.id);
  empty.set("file", new Blob([""], { type: "text/plain" }), "empty.txt");
  const emptyRes = await t.call("POST", "/api/submissions", { token: tokens.meena, form: empty });
  assert.equal(emptyRes.status, 400);
  assert.match(emptyRes.body.error.message, /empty/);

  const named = new FormData();
  named.set("taskId", team.id);
  named.set("file", new Blob(["poster notes"], { type: "text/plain" }), "పోస్టర్ notes.txt");
  const res = await t.call("POST", "/api/submissions", { token: tokens.meena, form: named });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.submission.fileName, "పోస్టర్ notes.txt");
});

test("a CSV batch reports a starting password that doesn't suit one person on that row only", async () => {
  const res = await post("/api/users/import", tokens.admin, { users: [
    { name: "Ok Person", email: "ok.person@example.com", role: "VOLUNTEER", password: "batch-pass-ravikiran" },
    { name: "Ravi Kiran", email: "ravikiran@example.com", role: "VOLUNTEER", password: "batch-pass-ravikiran" }
  ] });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.results[0].ok, true);
  assert.equal(res.body.results[1].ok, false);
  assert.match(res.body.results[1].error, /email name/);
});

test("re-registering the same phone changes nothing; one row per device", async () => {
  const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/qa-device-1", expirationTime: null, keys: { p256dh: "BPxkey", auth: "authkey" } };
  const first = await post("/api/push/subscribe", tokens.kavya, sub);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const before = (await t.store.list("PushSubscriptions")).filter((s) => s.endpoint === sub.endpoint);
  await post("/api/push/subscribe", tokens.kavya, sub);
  await post("/api/push/subscribe", tokens.kavya, sub);
  const afterRows = (await t.store.list("PushSubscriptions")).filter((s) => s.endpoint === sub.endpoint);
  assert.equal(afterRows.length, 1);
  assert.equal(afterRows[0].createdAt, before[0].createdAt, "not re-saved");
  assert.equal((await post("/api/push/subscribe", tokens.meena, sub)).status, 201, "another person on the same phone takes it over");
  assert.equal((await t.store.list("PushSubscriptions")).filter((s) => s.endpoint === sub.endpoint && s.userId).length, 1);
});

test("API answers are never cached", async () => {
  const res = await fetch(`${process.env.GRADEX_TEST_BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${tokens.meena}` } });
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal((await fetch(`${process.env.GRADEX_TEST_BASE}/api/health`)).headers.get("cache-control"), "no-store");
});

test("sign-in lifetime: up to 30 days is accepted, longer is refused", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../src/config/env.js", import.meta.url), "utf8");
  assert.match(source, /30 \* 24 \* 60 \* 60/);
  // A 7-day token from the live settings still stops working after a password change.
  const token = await t.login("kavya@example.com");
  assert.equal((await post("/api/auth/change-password", token, { currentPassword: "password123", newPassword: "my-own-pass-2207" })).status, 200);
  assert.equal((await get("/api/auth/me", token)).status, 401, "the old session ends at once");
});
