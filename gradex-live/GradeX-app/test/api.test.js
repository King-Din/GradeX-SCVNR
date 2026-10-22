import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { inDays, loginAll, PDF_BYTES, startTestServer, teamTask } from "./helpers.js";

// Runs the whole app against the seeded sample club (src/data/seed.js):
// Asha = admin, Priya = Design EB head, Rohan = PR EB head, Ravi and Lakshmi =
// Design coordinators, Arvind = PR coordinator, Meena/Arjun/... = Ravi's team,
// Varun/Divya/Harini = Lakshmi's team, Nikhil = Arvind's team.
let t;
let tokens = {};

before(async () => {
  t = await startTestServer();
  tokens = await loginAll(t, ["admin", "priya", "rohan", "ravi", "lakshmi", "arvind", "meena", "arjun", "nikhil", "divya"]);
});

after(async () => {
  await t.close();
  t.cleanup();
});

async function ebTask(token, extra = {}) {
  const { status, body } = await t.call("POST", "/api/tasks", {
    token,
    json: { title: "Test task", description: "Do it", deadline: inDays(8), status: "AVAILABLE", ...extra }
  });
  assert.equal(status, 201, JSON.stringify(body));
  return body.task;
}

test("login ignores capital letters in the email", async () => {
  assert.ok(await t.login("Volunteer@Example.COM"));
});

test("unknown email and wrong password get the same answer", async () => {
  const a = await t.call("POST", "/api/auth/login", { json: { email: "nobody@example.com", password: "password123" } });
  const b = await t.call("POST", "/api/auth/login", { json: { email: "volunteer@example.com", password: "wrong-password" } });
  assert.equal(a.status, 401);
  assert.deepEqual(a.body, b.body);
});

test("a deadline must be a real date with a timezone, in the future", async () => {
  const text = await t.call("POST", "/api/tasks", { token: tokens.priya, json: { title: "x", description: "y", deadline: "next friday" } });
  assert.equal(text.status, 400);
  assert.match(text.body.error.message, /timezone/);

  const past = await t.call("POST", "/api/tasks", { token: tokens.priya, json: { title: "x", description: "y", deadline: inDays(-1) } });
  assert.equal(past.status, 400);
  assert.match(past.body.error.message, /future/);
});

test("EB heads publish tasks only in their own domain; admins in any; coordinators can't publish", async () => {
  const own = await ebTask(tokens.priya);
  assert.equal(own.domainId, "D001");
  assert.equal(own.level, "DOMAIN");

  const other = await t.call("POST", "/api/tasks", { token: tokens.priya, json: { title: "x", description: "y", deadline: inDays(3), domainId: "D002" } });
  assert.equal(other.status, 403);

  const byAdmin = await ebTask(tokens.admin, { domainId: "D003" });
  assert.equal(byAdmin.domainId, "D003");

  assert.equal((await t.call("POST", "/api/tasks", { token: tokens.ravi, json: { title: "x", description: "y", deadline: inDays(3) } })).status, 403);
  assert.equal((await t.call("POST", "/api/tasks", { token: tokens.meena, json: { title: "x", description: "y", deadline: inDays(3) } })).status, 403);
});

test("coordinators see and pick only their own domain's published EB tasks", async () => {
  const designTask = await ebTask(tokens.priya);
  const draft = await ebTask(tokens.priya, { status: "DRAFT" });

  const raviSees = (await t.call("GET", "/api/tasks/available", { token: tokens.ravi })).body.tasks.map((x) => x.id);
  const arvindSees = (await t.call("GET", "/api/tasks/available", { token: tokens.arvind })).body.tasks.map((x) => x.id);

  assert.ok(raviSees.includes(designTask.id));
  assert.ok(!raviSees.includes(draft.id), "drafts are not listed");
  assert.ok(!arvindSees.includes(designTask.id), "other domains are not listed");

  assert.equal((await t.call("GET", `/api/tasks/${draft.id}`, { token: tokens.ravi })).status, 404, "draft is hidden by ID too");
  assert.equal((await t.call("POST", `/api/tasks/${designTask.id}/choose`, { token: tokens.arvind })).status, 404);
  assert.equal((await t.call("POST", `/api/tasks/${designTask.id}/choose`, { token: tokens.meena })).status, 404, "volunteers never see EB tasks");
  assert.equal((await t.call("POST", `/api/tasks/${designTask.id}/choose`, { token: tokens.ravi })).status, 201);
  assert.equal((await t.call("POST", `/api/tasks/${designTask.id}/choose`, { token: tokens.ravi })).status, 409, "no double pick");
});

test("volunteers see and pick only their own coordinator's team tasks", async () => {
  const { task } = await teamTask(t, tokens);
  const meenaSees = (await t.call("GET", "/api/tasks/available", { token: tokens.meena })).body.tasks.map((x) => x.id);
  const divyaSees = (await t.call("GET", "/api/tasks/available", { token: tokens.divya })).body.tasks.map((x) => x.id);
  assert.ok(meenaSees.includes(task.id));
  assert.ok(!divyaSees.includes(task.id), "Lakshmi's team doesn't see Ravi's team tasks");

  assert.equal((await t.call("POST", `/api/tasks/${task.id}/choose`, { token: tokens.divya })).status, 404);
  assert.equal((await t.call("POST", `/api/tasks/${task.id}/choose`, { token: tokens.nikhil })).status, 404);
  assert.equal((await t.call("POST", `/api/tasks/${task.id}/choose`, { token: tokens.lakshmi })).status, 404, "other coordinators can't pick team tasks");
  assert.equal((await t.call("POST", `/api/tasks/${task.id}/choose`, { token: tokens.meena })).status, 201);
});

test("two picks at the same moment create only one participation", async () => {
  const { task } = await teamTask(t, tokens);
  const results = await Promise.all([
    t.call("POST", `/api/tasks/${task.id}/choose`, { token: tokens.arjun }),
    t.call("POST", `/api/tasks/${task.id}/choose`, { token: tokens.arjun })
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
});

test("EB heads can't manage another domain's tasks", async () => {
  const prTask = await ebTask(tokens.rohan);
  assert.equal((await t.call("PUT", `/api/tasks/${prTask.id}`, { token: tokens.priya, json: { status: "CLOSED" } })).status, 404);
  assert.equal((await t.call("GET", `/api/tasks/${prTask.id}/participants`, { token: tokens.priya })).status, 404);
  assert.equal((await t.call("PUT", `/api/tasks/${prTask.id}`, { token: tokens.arvind, json: { status: "CLOSED" } })).status, 404, "coordinators don't manage EB tasks");
});

test("submit a file, replace it with a link before the deadline, then the coordinator scores it", async () => {
  const { task } = await teamTask(t, tokens);
  await t.call("POST", `/api/tasks/${task.id}/choose`, { token: tokens.meena });

  const form = new FormData();
  form.append("taskId", task.id);
  form.append("file", new Blob([PDF_BYTES], { type: "application/pdf" }), "poster.pdf");
  const first = await t.call("POST", "/api/submissions", { token: tokens.meena, form });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.submission.kind, "FILE");
  assert.equal(first.body.submission.isLate, false);

  const second = await t.call("POST", "/api/submissions", {
    token: tokens.meena,
    json: { taskId: task.id, linkUrl: "https://www.canva.com/design/abc" }
  });
  assert.equal(second.status, 200);
  assert.equal(second.body.submission.id, first.body.submission.id, "replacing keeps the same submission");
  assert.equal(second.body.submission.kind, "LINK");

  const pending = (await t.call("GET", "/api/reviews/pending", { token: tokens.ravi })).body.submissions;
  const mine = pending.find((s) => s.id === first.body.submission.id);
  assert.ok(mine);
  assert.equal(mine.canScore, true);

  const scored = await t.call("POST", "/api/evaluations", {
    token: tokens.ravi,
    json: { submissionId: first.body.submission.id, score: 88, feedback: "Nice" }
  });
  assert.equal(scored.status, 201);

  const again = await t.call("POST", "/api/submissions", { token: tokens.meena, json: { taskId: task.id, linkUrl: "https://x.example/y" } });
  assert.equal(again.status, 409, "scored work can't be replaced");

  const subs = (await t.call("GET", "/api/submissions/my", { token: tokens.meena })).body.submissions;
  assert.equal(subs.find((s) => s.id === first.body.submission.id).evaluation.score, 88, "volunteer sees their score");
});

test("work sent after the deadline is accepted and marked late, but can't then be replaced", async () => {
  const { task } = await teamTask(t, tokens);
  await t.call("POST", `/api/tasks/${task.id}/choose`, { token: tokens.arjun });
  await t.store.update("Tasks", task.id, { deadline: inDays(-1) });

  const late = await t.call("POST", "/api/submissions", { token: tokens.arjun, json: { taskId: task.id, linkUrl: "https://x.example/late" } });
  assert.equal(late.status, 201);
  assert.equal(late.body.submission.isLate, true);
  assert.equal(late.body.message, "Submitted after the deadline");

  const replace = await t.call("POST", "/api/submissions", { token: tokens.arjun, json: { taskId: task.id, linkUrl: "https://x.example/2" } });
  assert.equal(replace.status, 409);
});

test("a submission needs exactly one of a file or a link, of an allowed type and size", async () => {
  const { task } = await teamTask(t, tokens);
  await t.call("POST", `/api/tasks/${task.id}/choose`, { token: tokens.meena });

  const neither = await t.call("POST", "/api/submissions", { token: tokens.meena, json: { taskId: task.id } });
  assert.equal(neither.status, 400);

  const badLink = await t.call("POST", "/api/submissions", { token: tokens.meena, json: { taskId: task.id, linkUrl: "javascript:alert(1)" } });
  assert.equal(badLink.status, 400);

  const exe = new FormData();
  exe.append("taskId", task.id);
  exe.append("file", new Blob(["MZ"], { type: "application/x-msdownload" }), "virus.exe");
  const wrongType = await t.call("POST", "/api/submissions", { token: tokens.meena, form: exe });
  assert.equal(wrongType.status, 400);

  const big = new FormData();
  big.append("taskId", task.id);
  big.append("file", new Blob([new Uint8Array(11 * 1024 * 1024)], { type: "application/pdf" }), "big.pdf");
  const tooBig = await t.call("POST", "/api/submissions", { token: tokens.meena, form: big });
  assert.equal(tooBig.status, 413);
});

test("admins see and score everything; EB heads their domain; coordinators their own team", async () => {
  const adminPending = (await t.call("GET", "/api/reviews/pending", { token: tokens.admin })).body.submissions;
  const rohanPending = (await t.call("GET", "/api/reviews/pending", { token: tokens.rohan })).body.submissions;
  const raviPending = (await t.call("GET", "/api/reviews/pending", { token: tokens.ravi })).body.submissions;

  assert.ok(adminPending.length >= rohanPending.length);
  assert.ok(rohanPending.every((s) => s.task.domainId === "D002"));
  const raviId = await t.userId("coordinator@example.com");
  assert.ok(raviPending.every((s) => s.task.level === "TEAM" && s.task.ownerId === raviId), "a coordinator's queue is their own team");

  const designTeamWork = adminPending.find((s) => s.task.domainId === "D001" && s.task.level === "TEAM");
  const byRohan = await t.call("POST", "/api/evaluations", { token: tokens.rohan, json: { submissionId: designTeamWork.id, score: 50, feedback: "x" } });
  assert.equal(byRohan.status, 404);

  const byAdmin = await t.call("POST", "/api/evaluations", { token: tokens.admin, json: { submissionId: designTeamWork.id, score: 70, feedback: "Good" } });
  assert.equal(byAdmin.status, 201);

  const evaluation = await t.call("GET", `/api/evaluations/${byAdmin.body.evaluation.id}`, { token: tokens.admin });
  assert.equal(evaluation.status, 200);
  assert.equal((await t.call("GET", `/api/evaluations/${byAdmin.body.evaluation.id}`, { token: tokens.nikhil })).status, 404);
});

test("the people report shows each person's record and standing", async () => {
  const { body } = await t.call("GET", "/api/reports/people", { token: tokens.ravi });
  const byName = Object.fromEntries(body.people.map((v) => [v.person.name, v]));

  assert.deepEqual(Object.keys(byName).sort(), ["Arjun Das", "Kavya Reddy", "Meena Iyer", "Sai Teja"], "only the coordinator's own team");
  assert.equal(byName["Kavya Reddy"].standing, "RELIABLE");
  assert.equal(byName["Sai Teja"].standing, "SLIPPING");
  assert.equal(byName["Sai Teja"].totals.missed, 3);
  assert.ok(byName["Kavya Reddy"].history.length <= 8);

  const design = (await t.call("GET", "/api/reports/people", { token: tokens.priya })).body.people;
  const designByName = Object.fromEntries(design.map((v) => [v.person.name, v]));
  assert.equal(designByName["Varun K"].standing, "INACTIVE");
  assert.equal(designByName["Lakshmi Prasad"].role, "COORDINATOR", "EB heads see their coordinators too");
  assert.equal(designByName["Lakshmi Prasad"].standing, "SLIPPING");
  assert.ok(!designByName["Nikhil P"], "but not other domains");

  const all = await t.call("GET", "/api/reports/volunteers", { token: tokens.admin });
  assert.ok(all.body.volunteers.some((v) => v.volunteer.name === "Nikhil P"), "admins see every domain (older path still works)");

  assert.equal((await t.call("GET", "/api/reports/people", { token: tokens.meena })).status, 403);
});

test("admins add people one at a time or in bulk, and reset passwords", async () => {
  const raviId = await t.userId("coordinator@example.com");
  const created = await t.call("POST", "/api/users", {
    token: tokens.admin,
    json: { name: "New Volunteer", email: "New.Volunteer@Example.com", password: "welcome-123", role: "VOLUNTEER", coordinatorId: raviId }
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.user.email, "new.volunteer@example.com");
  assert.equal(created.body.user.domainId, "D001", "a volunteer's domain follows their coordinator");
  assert.equal(created.body.user.passwordHash, undefined);

  const imported = await t.call("POST", "/api/users/import", {
    token: tokens.admin,
    json: {
      users: [
        { name: "Batch One", email: "batch1@example.com", password: "welcome-123", role: "VOLUNTEER", domainId: "D002" },
        { name: "Duplicate", email: "NEW.VOLUNTEER@example.com", password: "welcome-123", role: "VOLUNTEER", domainId: "D001" }
      ]
    }
  });
  assert.equal(imported.body.created, 1);
  assert.equal(imported.body.failed, 1);

  await t.call("POST", `/api/users/${created.body.user.id}/reset-password`, { token: tokens.admin, json: { password: "brand-new-pass" } });
  assert.ok(await t.login("new.volunteer@example.com", "brand-new-pass"));

  for (const token of [tokens.priya, tokens.ravi]) {
    assert.equal((await t.call("POST", "/api/users", { token, json: { name: "x", email: "x@example.com", password: "welcome-123", role: "VOLUNTEER", domainId: "D001" } })).status, 403);
  }
});

test("someone added today counts as new, not inactive", async () => {
  const raviId = await t.userId("coordinator@example.com");
  await t.call("POST", "/api/users", {
    token: tokens.admin,
    json: { name: "Fresh Face", email: "fresh@example.com", password: "welcome-123", role: "VOLUNTEER", coordinatorId: raviId }
  });
  const report = (await t.call("GET", "/api/reports/people", { token: tokens.ravi })).body.people;
  assert.equal(report.find((v) => v.person.email === "fresh@example.com").standing, "NEW");
});

test("deactivating a volunteer locks them out immediately but keeps their history", async () => {
  const divyaId = await t.userId("divya@example.com");
  const meenaId = await t.userId("volunteer@example.com");
  const before = await t.login("divya@example.com");
  assert.ok(before);

  const off = await t.call("PATCH", `/api/users/${divyaId}`, { token: tokens.lakshmi, json: { status: "DEACTIVATED" } });
  assert.equal(off.status, 200);

  assert.equal((await t.call("GET", "/api/auth/me", { token: before })).status, 401, "existing token stops working");
  assert.equal((await t.call("POST", "/api/auth/login", { json: { email: "divya@example.com", password: "password123" } })).status, 403);

  const report = (await t.call("GET", "/api/reports/people", { token: tokens.lakshmi })).body.people;
  const divya = report.find((v) => v.person.id === divyaId);
  assert.equal(divya.standing, "DEACTIVATED");
  assert.ok(divya.totals.taken > 0);

  // Coordinators can only change status, only for their own volunteers.
  assert.equal((await t.call("PATCH", `/api/users/${divyaId}`, { token: tokens.lakshmi, json: { role: "ADMIN" } })).status, 403);
  assert.equal((await t.call("PATCH", `/api/users/${meenaId}`, { token: tokens.lakshmi, json: { status: "DEACTIVATED" } })).status, 404, "not another coordinator's volunteer");

  assert.equal((await t.call("PATCH", `/api/users/${divyaId}`, { token: tokens.lakshmi, json: { status: "ACTIVE" } })).status, 200);
});

test("volunteers and coordinators see their picked tasks with outcome and score", async () => {
  const meena = (await t.call("GET", "/api/tasks/my", { token: tokens.meena })).body.participations;
  assert.ok(new Set(meena.map((p) => p.outcome)).has("ON_TIME"));
  assert.ok(meena.some((p) => p.evaluation?.score != null));
  assert.ok(meena.every((p) => p.task.level === "TEAM"));

  const ravi = (await t.call("GET", "/api/tasks/my", { token: tokens.ravi })).body.participations;
  assert.ok(ravi.every((p) => p.task.level === "DOMAIN"));
  assert.ok(ravi.some((p) => p.evaluation?.score != null && p.evaluator?.name === "Priya Sharma"), "scored by the EB head");
  assert.ok(ravi.some((p) => p.teamTask), "with the team task each was forwarded as");
});
