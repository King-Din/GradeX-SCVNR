import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { inDays, loginAll, startTestServer, teamTask } from "./helpers.js";

// The club hierarchy: ADMIN > EB (one per domain) > COORDINATOR (with a team) > VOLUNTEER.
let t;
let tokens = {};
const ids = {};

before(async () => {
  t = await startTestServer();
  tokens = await loginAll(t, ["admin", "priya", "rohan", "ravi", "lakshmi", "arvind", "meena", "kavya", "divya", "nikhil"]);
  for (const [name, email] of Object.entries({
    priya: "eb.design@example.com", rohan: "eb.pr@example.com", ravi: "coordinator@example.com", lakshmi: "coordinator2@example.com",
    arvind: "coordinator.pr@example.com", meena: "volunteer@example.com", kavya: "kavya@example.com", divya: "divya@example.com",
    harini: "harini@example.com", asha: "admin@example.com"
  })) ids[name] = await t.userId(email);
});

after(async () => {
  await t.close();
  t.cleanup();
});

const get = (url, token) => t.call("GET", url, { token });
const post = (url, token, json) => t.call("POST", url, { token, json });
const put = (url, token, json) => t.call("PUT", url, { token, json });
const patch = (url, token, json) => t.call("PATCH", url, { token, json });

async function ebTask(token = tokens.priya, extra = {}) {
  const res = await post("/api/tasks", token, { title: `EB ${Math.random().toString(36).slice(2, 7)}`, description: "Deliver it", deadline: inDays(10), status: "AVAILABLE", ...extra });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.task;
}

// ---- Visibility at all four levels -------------------------------------------

test("tasks: admins see every domain, EB heads their domain (both levels), coordinators their EB tasks and own team, volunteers only their team", async () => {
  const all = (await get("/api/tasks", tokens.admin)).body.tasks;
  assert.ok(new Set(all.map((x) => x.domainId)).size >= 2);

  const priya = (await get("/api/tasks", tokens.priya)).body.tasks;
  assert.ok(priya.every((x) => x.domainId === "D001"));
  assert.ok(priya.some((x) => x.level === "TEAM" && x.ownerId === ids.lakshmi), "the EB head sees every team's tasks");
  assert.ok(priya.some((x) => x.status === "PROPOSED"), "and proposals");
  assert.ok(priya.some((x) => x.status === "DRAFT"), "and drafts");

  const ravi = (await get("/api/tasks", tokens.ravi)).body.tasks;
  assert.ok(ravi.every((x) => x.domainId === "D001"));
  assert.ok(!ravi.some((x) => x.status === "DRAFT"), "no EB drafts");
  assert.ok(!ravi.some((x) => x.level === "TEAM" && x.ownerId !== ids.ravi), "no other team's tasks");
  assert.ok(ravi.some((x) => x.status === "REJECTED" && x.reviewNote), "their own rejected proposal, with the reason");
  const poster = ravi.find((x) => x.title === "Poster for blood donation camp" && x.level === "DOMAIN");
  assert.equal(poster.mine.picked, true);
  assert.equal(poster.mine.teamTask.counts.submitted, 2, "with their forwarded team task's progress");

  assert.equal((await get("/api/tasks", tokens.meena)).status, 403);
  const meena = (await get("/api/tasks/available", tokens.meena)).body.tasks;
  assert.ok(meena.length > 0 && meena.every((x) => x.level === "TEAM" && x.ownerId === ids.ravi));

  const parent = await t.taskByTitle("Poster for blood donation camp", "DOMAIN");
  const ravisTeam = await t.taskByTitle("Poster for blood donation camp", "TEAM");
  assert.equal((await get(`/api/tasks/${parent.id}`, tokens.meena)).status, 404, "volunteers never see EB tasks");
  assert.equal((await get(`/api/tasks/${ravisTeam.id}`, tokens.lakshmi)).status, 404, "nor other coordinators' team tasks");
  assert.equal((await get(`/api/tasks/${ravisTeam.id}`, tokens.priya)).status, 200);
  assert.equal((await get(`/api/tasks/${ravisTeam.id}/participants`, tokens.priya)).status, 200, "the EB head sees in depth");
  assert.equal((await get(`/api/tasks/${ravisTeam.id}/participants`, tokens.lakshmi)).status, 404);
  assert.equal((await get(`/api/tasks/${ravisTeam.id}`, tokens.rohan)).status, 404, "other domains' EB heads don't");

  const finals = (await get(`/api/tasks/${parent.id}/participants`, tokens.priya)).body.participants;
  assert.ok(finals.find((p) => p.volunteer.id === ids.ravi).teamTask, "each coordinator shows the team task they forwarded");
});

test("people: admins everyone, EB heads their domain, coordinators their team, volunteers nobody", async () => {
  const all = (await get("/api/users", tokens.admin)).body.users;
  assert.ok(all.some((u) => u.domainId === "D002") && all.some((u) => u.role === "ADMIN"));

  const priya = (await get("/api/users", tokens.priya)).body.users;
  assert.ok(priya.every((u) => u.domainId === "D001"));
  assert.ok(priya.some((u) => u.role === "COORDINATOR") && priya.some((u) => u.role === "VOLUNTEER"));

  const ravi = (await get("/api/users", tokens.ravi)).body.users;
  assert.deepEqual(ravi.filter((u) => u.role === "VOLUNTEER").map((u) => u.coordinatorId).filter((c) => c !== ids.ravi), []);
  assert.ok(!ravi.some((u) => u.id === ids.divya), "not Lakshmi's volunteers");
  assert.equal((await get(`/api/users/${ids.divya}`, tokens.ravi)).status, 404);

  assert.equal((await get("/api/users", tokens.meena)).status, 403);
});

test("domains overview: names and basic facts of every domain for admins and EB heads only", async () => {
  const overview = (await get("/api/domains/overview", tokens.priya)).body.domains;
  assert.equal(overview.length, 3);
  const design = overview.find((d) => d.id === "D001");
  assert.equal(design.mine, true);
  assert.equal(design.head.name, "Priya Sharma");
  assert.equal(design.coordinators, 2);
  assert.equal(design.volunteers, 7);
  assert.ok(design.openTasks > 0);
  assert.ok(design.onTimeRate > 0 && design.onTimeRate < 1);
  assert.equal(typeof design.averageScore, "number");
  const pr = overview.find((d) => d.id === "D002");
  assert.equal(pr.mine, false);
  assert.deepEqual(Object.keys(pr).sort(), ["averageScore", "coordinators", "head", "id", "mine", "name", "onTimeRate", "openTasks", "volunteers"], "basic facts only, no people");

  assert.equal((await get("/api/domains/overview", tokens.admin)).status, 200);
  assert.equal((await get("/api/domains/overview", tokens.ravi)).status, 403);
  assert.equal((await get("/api/domains/overview", tokens.meena)).status, 403);

  // In-depth stays in-domain: Priya can't read PR's people, standings or board.
  assert.ok((await get("/api/reports/people?domainId=D002", tokens.priya)).body.people.every((p) => p.person.domainId === "D001"));
  assert.equal((await get("/api/board?domainId=D002", tokens.priya)).status, 403);

  const domains = (await get("/api/domains", tokens.meena)).body.domains;
  assert.equal(domains.find((d) => d.id === "D002").head.name, "Rohan Mehta", "everyone can see who heads each domain");
});

test("me: everyone sees the names above them", async () => {
  const meena = (await get("/api/auth/me", tokens.meena)).body;
  assert.equal(meena.user.coordinatorId, ids.ravi);
  assert.deepEqual(meena.context, { domain: { id: "D001", name: "Design" }, head: { id: ids.priya, name: "Priya Sharma" }, coordinator: { id: ids.ravi, name: "Ravi Kumar" } });
  const ravi = (await get("/api/auth/me", tokens.ravi)).body;
  assert.equal(ravi.context.head.name, "Priya Sharma");
  assert.equal(ravi.context.coordinator, null);
});

// ---- Forwarding -------------------------------------------------------------

test("forwarding: a coordinator picks the EB task and opens it to their own team, once", async () => {
  const parent = await ebTask();
  assert.equal((await post(`/api/tasks/${parent.id}/forward`, tokens.ravi, { deadline: inDays(11) })).status, 400, "the team deadline can't be after the EB deadline");
  assert.equal((await post(`/api/tasks/${parent.id}/forward`, tokens.meena, { deadline: inDays(5) })).status, 403);
  assert.equal((await post(`/api/tasks/${parent.id}/forward`, tokens.arvind, { deadline: inDays(5) })).status, 404, "another domain's coordinator");

  const forwarded = await post(`/api/tasks/${parent.id}/forward`, tokens.ravi, { deadline: inDays(6), description: "Draft one each, I'll pick the best." });
  assert.equal(forwarded.status, 201, JSON.stringify(forwarded.body));
  const team = forwarded.body.task;
  assert.equal(team.level, "TEAM");
  assert.equal(team.parentTaskId, parent.id);
  assert.equal(team.ownerId, ids.ravi);
  assert.equal(team.status, "AVAILABLE");
  assert.equal(team.title, parent.title, "the title defaults to the EB task's");
  assert.equal(team.description, "Draft one each, I'll pick the best.");

  assert.equal((await post(`/api/tasks/${parent.id}/forward`, tokens.ravi, { deadline: inDays(5) })).status, 409, "one forward per coordinator");
  assert.equal((await post(`/api/tasks/${parent.id}/choose`, tokens.ravi)).status, 409, "forwarding picked it already");

  const mine = (await get(`/api/tasks/${parent.id}`, tokens.ravi)).body.task.mine;
  assert.equal(mine.picked, true);
  assert.equal(mine.teamTask.id, team.id);

  assert.ok((await get("/api/tasks/available", tokens.kavya)).body.tasks.some((x) => x.id === team.id), "Ravi's volunteers can pick it");
  assert.ok(!(await get("/api/tasks/available", tokens.divya)).body.tasks.some((x) => x.id === team.id), "Lakshmi's can't");

  // Lakshmi forwards the same EB task to her own team: a separate team task.
  const hers = await post(`/api/tasks/${parent.id}/forward`, tokens.lakshmi, { deadline: inDays(4) });
  assert.equal(hers.status, 201);
  assert.ok((await get("/api/tasks/available", tokens.divya)).body.tasks.some((x) => x.id === hers.body.task.id));

  // The team deadline can move, but never past the EB deadline.
  assert.equal((await put(`/api/tasks/${team.id}`, tokens.ravi, { deadline: inDays(12) })).status, 400);
  assert.equal((await put(`/api/tasks/${team.id}`, tokens.ravi, { deadline: inDays(7) })).status, 200);
  assert.equal((await put(`/api/tasks/${team.id}`, tokens.lakshmi, { status: "CLOSED" })).status, 404, "only the owner manages a team task");
  assert.equal((await put(`/api/tasks/${team.id}`, tokens.priya, { status: "CLOSED" })).status, 404, "the EB head watches team tasks but doesn't run them");

  // Drafts can't be forwarded, nor EB tasks whose deadline has passed.
  const draft = await ebTask(tokens.priya, { status: "DRAFT" });
  assert.equal((await post(`/api/tasks/${draft.id}/forward`, tokens.ravi, { deadline: inDays(5) })).status, 404);
  const passed = await ebTask();
  await t.store.update("Tasks", passed.id, { deadline: inDays(-1) });
  assert.equal((await post(`/api/tasks/${passed.id}/forward`, tokens.ravi, { deadline: inDays(1) })).status, 409);
});

// ---- Proposals ----------------------------------------------------------------

test("proposals: a coordinator proposes, the EB head approves, then the team sees it", async () => {
  const proposed = await post("/api/tasks/proposals", tokens.ravi, { title: "Diwali greeting card", description: "One card design each", deadline: inDays(6) });
  assert.equal(proposed.status, 201);
  const task = proposed.body.task;
  assert.equal(task.status, "PROPOSED");
  assert.equal(task.level, "TEAM");
  assert.equal(task.ownerId, ids.ravi);
  assert.equal(task.parentTaskId, null);

  assert.ok(!(await get("/api/tasks/available", tokens.meena)).body.tasks.some((x) => x.id === task.id), "volunteers don't see proposals");
  assert.equal((await get(`/api/tasks/${task.id}`, tokens.meena)).status, 404);
  assert.equal((await post(`/api/tasks/${task.id}/choose`, tokens.meena)).status, 404);
  assert.equal((await put(`/api/tasks/${task.id}`, tokens.ravi, { status: "AVAILABLE" })).status, 409, "a coordinator can't publish their own proposal");
  assert.equal((await put(`/api/tasks/${task.id}`, tokens.ravi, { title: "Diwali greeting cards" })).status, 200, "but can edit it while it waits");
  assert.equal((await get(`/api/tasks/${task.id}`, tokens.lakshmi)).status, 404);
  assert.equal((await post("/api/tasks/proposals", tokens.priya, { title: "x", description: "y", deadline: inDays(3) })).status, 403, "only coordinators propose");

  const inbox = (await get("/api/tasks/proposals", tokens.priya)).body.tasks;
  assert.ok(inbox.some((x) => x.id === task.id && x.owner.name === "Ravi Kumar"));
  assert.ok(!(await get("/api/tasks/proposals", tokens.rohan)).body.tasks.some((x) => x.id === task.id));
  assert.ok(!(await get("/api/tasks/proposals", tokens.lakshmi)).body.tasks.some((x) => x.id === task.id), "coordinators see only their own");

  assert.equal((await post(`/api/tasks/${task.id}/approve`, tokens.rohan, {})).status, 404, "another domain's EB head can't decide");
  assert.equal((await post(`/api/tasks/${task.id}/approve`, tokens.ravi, {})).status, 403);
  assert.equal((await post(`/api/tasks/${task.id}/reject`, tokens.priya, { reason: "" })).status, 400, "a rejection needs a reason");

  const approved = await post(`/api/tasks/${task.id}/approve`, tokens.priya, { note: "Go ahead" });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.task.status, "AVAILABLE");
  assert.equal(approved.body.task.reviewedBy, ids.priya);
  assert.equal((await post(`/api/tasks/${task.id}/approve`, tokens.priya, {})).status, 409, "decided once");

  assert.ok((await get("/api/tasks/available", tokens.meena)).body.tasks.some((x) => x.id === task.id), "now Ravi's team sees it");
  assert.ok(!(await get("/api/tasks/available", tokens.divya)).body.tasks.some((x) => x.id === task.id), "only Ravi's team");
  assert.equal((await post(`/api/tasks/${task.id}/choose`, tokens.meena)).status, 201);
});

test("proposals: a rejection carries the reason, and approving a stale one needs a new deadline", async () => {
  const proposed = (await post("/api/tasks/proposals", tokens.lakshmi, { title: "Mural for the canteen", description: "Paint it", deadline: inDays(9) })).body.task;
  const rejected = await post(`/api/tasks/${proposed.id}/reject`, tokens.priya, { reason: "We don't have permission for walls yet." });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.task.status, "REJECTED");
  const hers = (await get("/api/tasks/proposals", tokens.lakshmi)).body.tasks.find((x) => x.id === proposed.id);
  assert.equal(hers.reviewNote, "We don't have permission for walls yet.");
  assert.equal(hers.reviewer.name, "Priya Sharma");
  assert.equal((await put(`/api/tasks/${proposed.id}`, tokens.lakshmi, { title: "Try again" })).status, 409);
  assert.ok(!(await get("/api/tasks/available", tokens.divya)).body.tasks.some((x) => x.id === proposed.id));

  const stale = (await post("/api/tasks/proposals", tokens.lakshmi, { title: "Old idea", description: "x", deadline: inDays(2) })).body.task;
  await t.store.update("Tasks", stale.id, { deadline: inDays(-1) });
  assert.equal((await post(`/api/tasks/${stale.id}/approve`, tokens.priya, {})).status, 400);
  const fresh = await post(`/api/tasks/${stale.id}/approve`, tokens.admin, { deadline: inDays(4) });
  assert.equal(fresh.status, 200, "admins decide anywhere");
  assert.ok(Date.parse(fresh.body.task.deadline) > Date.now() + 3 * 24 * 60 * 60 * 1000, "with the new deadline");
});

// ---- Two-level scoring --------------------------------------------------------

test("the whole flow: EB publishes, coordinator forwards, volunteer submits, coordinator scores, final to EB, EB scores", async () => {
  const parent = await ebTask(tokens.priya, { title: "Camp banner" });
  const team = (await post(`/api/tasks/${parent.id}/forward`, tokens.ravi, { deadline: inDays(5) })).body.task;

  assert.equal((await post(`/api/tasks/${team.id}/choose`, tokens.meena)).status, 201);
  const work = (await post("/api/submissions", tokens.meena, { taskId: team.id, linkUrl: "https://www.canva.com/design/meena-banner" })).body.submission;

  // The coordinator scores team work; the EB head watches but doesn't score it.
  const priyaView = (await get("/api/reviews/pending?level=TEAM", tokens.priya)).body.submissions.find((s) => s.id === work.id);
  assert.equal(priyaView.canScore, false);
  const byPriya = await post("/api/evaluations", tokens.priya, { submissionId: work.id, score: 90, feedback: "x" });
  assert.equal(byPriya.status, 403);
  assert.match(byPriya.body.error.message, /coordinator/);
  assert.equal((await post("/api/evaluations", tokens.lakshmi, { submissionId: work.id, score: 90, feedback: "x" })).status, 404, "another coordinator");
  const teamScore = await post("/api/evaluations", tokens.ravi, { submissionId: work.id, score: 86, feedback: "Bold and clear" });
  assert.equal(teamScore.status, 201);
  assert.equal((await put(`/api/evaluations/${teamScore.body.evaluation.id}`, tokens.ravi, { score: 88, feedback: "Bold and clear, nice colours" })).status, 200, "and may correct it");
  assert.equal((await put(`/api/evaluations/${teamScore.body.evaluation.id}`, tokens.priya, { score: 10, feedback: "x" })).status, 403);

  // The coordinator sends the final work to the EB head.
  const final = await post("/api/submissions", tokens.ravi, { taskId: parent.id, linkUrl: "https://www.canva.com/design/ravi-final-banner" });
  assert.equal(final.status, 201);
  assert.equal((await post("/api/submissions", tokens.ravi, { taskId: parent.id, linkUrl: "https://www.canva.com/design/ravi-final-v2" })).status, 200, "replace until scored");
  assert.equal((await post("/api/submissions", tokens.lakshmi, { taskId: parent.id, linkUrl: "https://x.example/a" })).status, 403, "only coordinators who picked it");
  assert.equal((await post("/api/submissions", tokens.meena, { taskId: parent.id, linkUrl: "https://x.example/a" })).status, 403);

  const queue = (await get("/api/reviews/pending?level=DOMAIN", tokens.priya)).body.submissions;
  const ravis = queue.find((s) => s.id === final.body.submission.id);
  assert.equal(ravis.canScore, true);
  assert.equal(ravis.volunteer.name, "Ravi Kumar");
  assert.ok(!(await get("/api/reviews/pending", tokens.ravi)).body.submissions.some((s) => s.id === ravis.id), "never in your own queue");
  assert.equal((await post("/api/evaluations", tokens.ravi, { submissionId: ravis.id, score: 100, feedback: "x" })).status, 404, "coordinators don't score final work");
  assert.equal((await post("/api/evaluations", tokens.rohan, { submissionId: ravis.id, score: 100, feedback: "x" })).status, 404);
  assert.equal((await post("/api/evaluations", tokens.priya, { submissionId: ravis.id, score: 84, feedback: "Good final" })).status, 201);
  assert.equal((await post("/api/submissions", tokens.ravi, { taskId: parent.id, linkUrl: "https://x.example/v3" })).status, 409, "scored work can't be replaced");

  const meenaScores = (await get("/api/evaluations/my", tokens.meena)).body.evaluations;
  assert.ok(meenaScores.some((e) => e.score === 88 && e.submission.task.id === team.id));
  const raviScores = (await get("/api/evaluations/my", tokens.ravi)).body.evaluations;
  assert.ok(raviScores.some((e) => e.score === 84 && e.submission.task.level === "DOMAIN"));
});

// ---- Accounts ---------------------------------------------------------------

test("accounts: one EB head per domain, and a volunteer's coordinator must coordinate their domain", async () => {
  const add = (json) => post("/api/users", tokens.admin, { password: "start-here-55", ...json });

  const secondHead = await add({ name: "Second Head", email: "head2@example.com", role: "EB", domainId: "D001" });
  assert.equal(secondHead.status, 409);
  assert.match(secondHead.body.error.message, /already has an EB head \(Priya Sharma\)/);
  assert.equal((await add({ name: "No Domain", email: "head3@example.com", role: "EB" })).status, 400);

  assert.equal((await add({ name: "V1", email: "v1@example.com", role: "VOLUNTEER", coordinatorId: ids.priya })).status, 400, "an EB head isn't a coordinator");
  assert.equal((await add({ name: "V2", email: "v2@example.com", role: "VOLUNTEER", coordinatorId: ids.ravi, domainId: "D002" })).status, 400, "Ravi coordinates Design");
  assert.equal((await add({ name: "V3", email: "v3@example.com", role: "COORDINATOR", domainId: "D001", coordinatorId: ids.ravi })).status, 400, "only volunteers have a coordinator");
  const v4 = await add({ name: "V4", email: "v4@example.com", role: "VOLUNTEER", coordinatorId: ids.arvind });
  assert.equal(v4.status, 201);
  assert.equal(v4.body.user.domainId, "D002");

  // Changing roles keeps the rules too.
  assert.equal((await patch(`/api/users/${ids.ravi}`, tokens.admin, { role: "EB" })).status, 409, "Design already has an EB head");
  assert.equal((await patch(`/api/users/${ids.ravi}`, tokens.admin, { role: "VOLUNTEER" })).status, 409, "Ravi still has a team");
  assert.equal((await patch(`/api/users/${ids.ravi}`, tokens.admin, { domainId: "D002" })).status, 409, "and can't leave his domain with it");
  assert.equal((await patch(`/api/users/${ids.harini}`, tokens.admin, { coordinatorId: ids.arvind })).status, 400, "a coordinator in another domain");
  const moved = await patch(`/api/users/${ids.harini}`, tokens.admin, { domainId: "D002", coordinatorId: ids.arvind });
  assert.equal(moved.status, 200, "unless the domain moves with them");
  const backHome = await patch(`/api/users/${ids.harini}`, tokens.admin, { domainId: "D001" });
  assert.equal(backHome.body.user.coordinatorId, null, "moved domain without a coordinator: they choose at next sign-in");
  assert.equal((await patch(`/api/users/${ids.harini}`, tokens.priya, { coordinatorId: ids.lakshmi })).status, 200, "the EB head assigns within the domain");

  // The rule still holds for people in an existing role becoming EB elsewhere.
  const newHead = await add({ name: "Ops Helper", email: "ops.helper@example.com", role: "COORDINATOR", domainId: "D003" });
  assert.equal((await patch(`/api/users/${newHead.body.user.id}`, tokens.admin, { role: "EB" })).status, 409, "Operations has Sneha");
});

test("an admin can also head a domain (one head per domain still), and a coordinator added without a domain chooses it at first sign-in", async () => {
  const sneha = await t.userId("eb.ops@example.com");
  const vikram = await t.userId("admin2@example.com");
  assert.equal((await patch(`/api/users/${vikram}`, tokens.admin, { domainId: "D001" })).status, 409, "Design has Priya");

  // Operations without Sneha: Vikram (admin) leads it.
  assert.equal((await patch(`/api/users/${sneha}`, tokens.admin, { status: "DEACTIVATED" })).status, 200);
  const led = await patch(`/api/users/${vikram}`, tokens.admin, { domainId: "D003" });
  assert.equal(led.status, 200, JSON.stringify(led.body));
  assert.equal(led.body.user.role, "ADMIN");
  const ops = (await get("/api/domains", tokens.ravi)).body.domains.find((d) => d.id === "D003");
  assert.equal(ops.head.name, "Vikram Shah", "named as the head everywhere");
  const overview = (await get("/api/domains/overview", await t.login("admin2@example.com"))).body.domains;
  assert.equal(overview.find((d) => d.id === "D003").mine, true, "and it's his domain on the overview");
  assert.equal((await patch(`/api/users/${sneha}`, tokens.admin, { status: "ACTIVE" })).status, 409, "Operations now has a head");
  assert.equal((await post("/api/users", tokens.admin, { name: "Ops Two", email: "ops2@example.com", password: "start-here-55", role: "EB", domainId: "D003" })).status, 409);

  // Put things back for the other tests.
  assert.equal((await patch(`/api/users/${vikram}`, tokens.admin, { domainId: null })).status, 200);
  assert.equal((await patch(`/api/users/${sneha}`, tokens.admin, { status: "ACTIVE" })).status, 200);

  // A coordinator without a domain picks one, once.
  const added = await post("/api/users", tokens.admin, { name: "Floating Coord", email: "floating@example.com", password: "start-here-55", role: "COORDINATOR" });
  assert.equal(added.status, 201);
  assert.equal(added.body.user.domainId, null);
  const first = await t.login("floating@example.com", "start-here-55");
  const changed = await post("/api/auth/change-password", first, { currentPassword: "start-here-55", newPassword: "my-own-pass-77" });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  const token = changed.body.token;
  const chose = await post("/api/auth/domain", token, { domainId: "D002" });
  assert.equal(chose.status, 200, JSON.stringify(chose.body));
  assert.equal(chose.body.user.domainId, "D002");
  assert.equal((await post("/api/auth/domain", token, { domainId: "D001" })).status, 409, "locked after");
  assert.ok((await get("/api/domains/D002/coordinators", tokens.meena)).body.coordinators.some((c) => c.name === "Floating Coord"));
  assert.equal((await post("/api/auth/domain", tokens.priya, { domainId: "D002" })).status, 403, "EB heads don't choose");
});

test("deactivation: admins anyone, EB heads their domain's coordinators and volunteers, coordinators their own volunteers", async () => {
  const spare = (await post("/api/users", tokens.admin, { name: "Spare Coordinator", email: "spare@example.com", password: "start-here-55", role: "COORDINATOR", domainId: "D001" })).body.user;
  assert.equal((await patch(`/api/users/${spare.id}`, tokens.priya, { status: "DEACTIVATED" })).status, 200);
  assert.equal((await patch(`/api/users/${spare.id}`, tokens.priya, { status: "ACTIVE" })).status, 200);
  assert.equal((await patch(`/api/users/${ids.kavya}`, tokens.priya, { status: "DEACTIVATED" })).status, 200);
  assert.equal((await patch(`/api/users/${ids.kavya}`, tokens.priya, { status: "ACTIVE" })).status, 200);

  assert.equal((await patch(`/api/users/${ids.rohan}`, tokens.priya, { status: "DEACTIVATED" })).status, 404, "not another domain's EB head");
  assert.equal((await patch(`/api/users/${ids.asha}`, tokens.priya, { status: "DEACTIVATED" })).status, 404, "not an admin");
  assert.equal((await patch(`/api/users/${ids.priya}`, tokens.priya, { status: "DEACTIVATED" })).status, 400, "not yourself");
  assert.equal((await patch(`/api/users/${ids.lakshmi}`, tokens.priya, { name: "L" })).status, 403, "EB heads don't edit accounts");
  assert.equal((await patch(`/api/users/${ids.lakshmi}`, tokens.ravi, { status: "DEACTIVATED" })).status, 404, "coordinators don't deactivate each other");
  assert.equal((await post(`/api/users/${ids.kavya}/reset-password`, tokens.priya, { password: "new-start-77" })).status, 403, "only admins reset passwords");
});

test("CSV import: name, email, role, domain, coordinator email; leaders first, results in order", async () => {
  const row = (name, email, role, extra = {}) => ({ name, email, role, password: "batch-start-77", ...extra });
  const res = await post("/api/users/import", tokens.admin, {
    users: [
      row("Team Member", "member@example.com", "VOLUNTEER", { coordinatorEmail: "newcoord@example.com" }),
      row("New Coordinator", "newcoord@example.com", "COORDINATOR", { domainId: "D003" }),
      row("Choose Later", "later@example.com", "VOLUNTEER"),
      row("Lost", "lost@example.com", "VOLUNTEER", { coordinatorEmail: "nobody@example.com" }),
      row("Wrong Boss", "wrong@example.com", "VOLUNTEER", { coordinatorEmail: "eb.design@example.com" }),
      row("Mismatch", "mismatch@example.com", "VOLUNTEER", { domainId: "D001", coordinatorEmail: "coordinator.pr@example.com" }),
      row("Extra Head", "extrahead@example.com", "EB", { domainId: "D002" }),
      row("Third Admin", "thirdadmin@example.com", "ADMIN"),
      row("Blank Coordinator", "blank@example.com", "VOLUNTEER", { domainId: "D002", coordinatorEmail: "" })
    ]
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const results = res.body.results;
  assert.deepEqual(results.map((r) => r.email), [
    "member@example.com", "newcoord@example.com", "later@example.com", "lost@example.com", "wrong@example.com",
    "mismatch@example.com", "extrahead@example.com", "thirdadmin@example.com", "blank@example.com"
  ], "results come back in the order sent");
  assert.deepEqual(results.map((r) => r.ok), [true, true, true, false, false, false, false, false, true]);
  assert.equal(results[0].user.domainId, "D003", "a volunteer takes their coordinator's domain, even one added in the same batch");
  assert.equal(results[0].user.coordinatorId, results[1].user.id);
  assert.equal(results[2].user.domainId, null);
  assert.match(results[3].error, /No coordinator with the email/);
  assert.match(results[4].error, /Coordinator role/);
  assert.match(results[5].error, /coordinates PR & Marketing, not Design/);
  assert.match(results[6].error, /already has an EB head/);
  assert.match(results[7].error, /only be 2 admins/);
  assert.equal(results[8].user.domainId, "D002");
  assert.equal(res.body.created, 4);

  const roleSchema = await post("/api/users/import", tokens.admin, { users: [row("Bad", "bad@example.com", "SUPERVISOR")] });
  assert.equal(roleSchema.status, 400, "roles are admin, EB, coordinator or volunteer");
});

test("setup status: leaders see who has signed in, installed the app and turned on notifications", async () => {
  const row = async (id) => (await get("/api/reports/people", tokens.ravi)).body.people.find((r) => r.person.id === id);
  const before = await row(ids.meena);
  assert.deepEqual(before.setup, { signedIn: true, app: false, notifications: false });

  assert.equal((await post("/api/auth/app-installed", tokens.meena, {})).status, 200);
  assert.equal((await post("/api/auth/app-installed", tokens.meena, {})).status, 200, "reporting twice is fine");
  assert.equal((await post("/api/auth/app-installed", tokens.meena, { anything: 1 })).status, 400);
  assert.equal((await row(ids.meena)).setup.app, true);

  const pooja = await t.login("newvolunteer@example.com");
  assert.equal((await post("/api/auth/app-installed", pooja, {})).status, 403, "not before setting their own password");
});
