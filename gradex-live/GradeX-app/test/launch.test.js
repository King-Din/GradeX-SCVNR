import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { inDays, loginAll, startTestServer, teamTask } from "./helpers.js";

// First-login flow, the boards, decisions, export and notifications.
let t;
let tokens = {};
const pushes = [];

before(async () => {
  process.env.VAPID_PUBLIC_KEY = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";
  process.env.VAPID_PRIVATE_KEY = "UUxI4O8-FbRouAevSmBQ6o18hgE4nSG3qwvJTfKc-ls";
  t = await startTestServer();
  const notify = await import("../src/services/notify.service.js");
  notify.setPushSender(async (subscription, payload) => pushes.push({ endpoint: subscription.endpoint, ...JSON.parse(payload) }));
  tokens = await loginAll(t, ["admin", "priya", "rohan", "ravi", "lakshmi", "arvind", "meena", "kavya", "sai", "varun", "nikhil"]);
});

after(async () => {
  await t.close();
  t.cleanup();
});

const subscription = (name) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${name}`,
  keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" }
});

test("first login: set a password, choose a domain, then a coordinator from that domain, once", async () => {
  let token = await t.login("newvolunteer@example.com");
  const me = await t.call("GET", "/api/auth/me", { token });
  assert.equal(me.body.user.mustChangePassword, true);
  assert.equal(me.body.user.domainId, null);
  assert.equal(me.body.user.coordinatorId, null);

  const blocked = await t.call("GET", "/api/tasks/available", { token });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, "PASSWORD_CHANGE_REQUIRED");
  assert.equal((await t.call("POST", "/api/auth/coordinator", { token, json: { coordinatorId: "U006" } })).status, 403, "the password comes first");

  const wrong = await t.call("POST", "/api/auth/change-password", { token, json: { currentPassword: "nope", newPassword: "my-own-pass-1" } });
  assert.equal(wrong.status, 400);
  const same = await t.call("POST", "/api/auth/change-password", { token, json: { currentPassword: "password123", newPassword: "password123" } });
  assert.equal(same.status, 400);
  const changed = await t.call("POST", "/api/auth/change-password", { token, json: { currentPassword: "password123", newPassword: "my-own-pass-1" } });
  assert.equal(changed.status, 200);
  assert.equal((await t.call("GET", "/api/auth/me", { token })).status, 401, "the old token is signed out");
  token = changed.body.token;

  const none = await t.call("GET", "/api/tasks/available", { token });
  assert.equal(none.status, 200);
  assert.equal(none.body.tasks.length, 0, "no tasks until a coordinator is chosen");

  // The domain's coordinators are listed by name.
  const listed = (await t.call("GET", "/api/domains/D001/coordinators", { token })).body.coordinators;
  assert.deepEqual(listed.map((c) => c.name), ["Lakshmi Prasad", "Ravi Kumar"]);
  assert.ok(listed.every((c) => !("email" in c)), "names only");

  const ravi = listed.find((c) => c.name === "Ravi Kumar");
  const priya = await t.userId("eb.design@example.com");
  assert.equal((await t.call("POST", "/api/auth/coordinator", { token, json: { coordinatorId: priya } })).status, 400, "an EB head isn't a coordinator");

  const chosen = await t.call("POST", "/api/auth/coordinator", { token, json: { coordinatorId: ravi.id } });
  assert.equal(chosen.status, 200);
  assert.equal(chosen.body.user.domainId, "D001", "the domain comes with the coordinator");
  assert.equal(chosen.body.context.coordinator.name, "Ravi Kumar");
  assert.equal(chosen.body.context.head.name, "Priya Sharma");

  const lakshmi = listed.find((c) => c.name === "Lakshmi Prasad");
  assert.equal((await t.call("POST", "/api/auth/coordinator", { token, json: { coordinatorId: lakshmi.id } })).status, 409, "locked after choosing");
  assert.equal((await t.call("POST", "/api/auth/domain", { token, json: { domainId: "D002" } })).status, 409, "the domain is locked too");
  assert.ok((await t.call("GET", "/api/tasks/available", { token })).body.tasks.length > 0, "now sees Ravi's team tasks");

  // The EB head (or an admin) can still move them, within the domain.
  const poojaId = chosen.body.user.id;
  assert.equal((await t.call("PATCH", `/api/users/${poojaId}`, { token: tokens.priya, json: { coordinatorId: lakshmi.id } })).status, 200);
  assert.equal((await t.call("PATCH", `/api/users/${poojaId}`, { token: tokens.lakshmi, json: { coordinatorId: ravi.id } })).status, 403, "coordinators can't move people");
  assert.equal((await t.call("PATCH", `/api/users/${poojaId}`, { token: tokens.ravi, json: { coordinatorId: ravi.id } })).status, 404, "and can't see other teams");
  assert.equal((await t.call("PATCH", `/api/users/${poojaId}`, { token: tokens.priya, json: { coordinatorId: await t.userId("coordinator.pr@example.com") } })).status, 400, "only within the domain");
});

test("a volunteer whose domain was set by an admin chooses only among that domain's coordinators", async () => {
  await t.call("POST", "/api/users", { token: tokens.admin, json: { name: "Preset Domain", email: "preset@example.com", password: "starting-123", role: "VOLUNTEER", domainId: "D002" } });
  const first = await t.login("preset@example.com", "starting-123");
  const token = (await t.call("POST", "/api/auth/change-password", { token: first, json: { currentPassword: "starting-123", newPassword: "my-own-pass-2" } })).body.token;
  const me = (await t.call("GET", "/api/auth/me", { token })).body;
  assert.equal(me.context.domain.name, "PR & Marketing");

  const ravi = await t.userId("coordinator@example.com");
  const arvind = await t.userId("coordinator.pr@example.com");
  assert.equal((await t.call("POST", "/api/auth/coordinator", { token, json: { coordinatorId: ravi } })).status, 400, "Ravi coordinates Design");
  assert.equal((await t.call("POST", "/api/auth/coordinator", { token, json: { coordinatorId: arvind } })).status, 200);
});

test("people added by an admin must change their starting password", async () => {
  await t.call("POST", "/api/users", { token: tokens.admin, json: { name: "Batch Person", email: "batch.person@example.com", password: "starting-123", role: "VOLUNTEER" } });
  const token = await t.login("batch.person@example.com", "starting-123");
  assert.equal((await t.call("GET", "/api/auth/me", { token })).body.user.mustChangePassword, true);
});

test("the team board shows the team's finished work, scores and feedback, never open work", async () => {
  // Meena and Kavya have submitted the open team poster task; it must stay hidden.
  const board = (await t.call("GET", "/api/board", { token: tokens.meena })).body;
  assert.equal(board.level, "TEAM");
  assert.equal(board.coordinator.name, "Ravi Kumar");
  assert.ok(board.tasks.length > 0);
  assert.ok(!board.tasks.some((task) => task.title === "Poster for blood donation camp"), "open tasks are hidden");
  assert.ok(board.upcoming.some((task) => task.title === "Poster for blood donation camp"));

  const finished = board.tasks[0];
  assert.ok(finished.submissions.some((s) => s.volunteerName !== "Meena Iyer"), "sees teammates' work");
  assert.ok(finished.submissions.some((s) => typeof s.score === "number" && s.feedback), "with scores and feedback");
  assert.deepEqual(board.leaderboard.map((r) => r.name).sort(), ["Arjun Das", "Kavya Reddy", "Meena Iyer", "Sai Teja"], "only the team");

  assert.equal(board.leaderboard[0].rank, 1);
  assert.ok(!("standing" in board.leaderboard[0]), "standing stays staff-only");
  assert.ok(!JSON.stringify(board).includes("decision"), "decisions stay staff-only");

  // A volunteer can't ask for another team or the coordinators' board.
  const varun = (await t.call("GET", `/api/board?coordinatorId=${await t.userId("coordinator@example.com")}`, { token: tokens.varun })).body;
  assert.equal(varun.coordinator.name, "Lakshmi Prasad", "always their own team");
  assert.equal((await t.call("GET", "/api/board?level=DOMAIN", { token: tokens.meena })).status, 403);

  const someoneElses = finished.submissions.find((s) => s.volunteerName !== "Meena Iyer");
  assert.equal((await t.call("GET", `/api/submissions/${someoneElses.submissionId}`, { token: tokens.meena })).status, 200);
  assert.equal((await t.call("GET", `/api/submissions/${someoneElses.submissionId}`, { token: tokens.varun })).status, 404, "another team");
  assert.equal((await t.call("GET", `/api/submissions/${someoneElses.submissionId}`, { token: tokens.nikhil })).status, 404);
});

test("the coordinators' board shows EB tasks, final work and EB scores to the domain's coordinators and EB head", async () => {
  const lakshmi = (await t.call("GET", "/api/board?level=DOMAIN", { token: tokens.lakshmi })).body;
  assert.equal(lakshmi.level, "DOMAIN");
  assert.deepEqual(lakshmi.leaderboard.map((r) => r.name).sort(), ["Lakshmi Prasad", "Ravi Kumar"]);
  const finished = lakshmi.tasks.find((task) => task.submissions.some((s) => s.volunteerName === "Ravi Kumar" && s.score != null));
  assert.ok(finished, "sees Ravi's scored final work");

  const priya = (await t.call("GET", "/api/board", { token: tokens.priya })).body;
  assert.equal(priya.level, "DOMAIN", "an EB head's default board is the coordinators'");
  const raviTeam = (await t.call("GET", `/api/board?coordinatorId=${await t.userId("coordinator@example.com")}`, { token: tokens.priya })).body;
  assert.equal(raviTeam.coordinator.name, "Ravi Kumar", "and any team in the domain");
  assert.equal((await t.call("GET", `/api/board?coordinatorId=${await t.userId("coordinator.pr@example.com")}`, { token: tokens.priya })).status, 403);
  assert.equal((await t.call("GET", "/api/board?domainId=D002", { token: tokens.priya })).status, 403);
});

test("a volunteer can't open a teammate's work before the deadline", async () => {
  const pending = (await t.call("GET", "/api/reviews/pending", { token: tokens.ravi })).body.submissions;
  const kavyas = pending.find((s) => s.volunteer.name === "Kavya Reddy");
  assert.equal((await t.call("GET", `/api/submissions/${kavyas.id}`, { token: tokens.meena })).status, 404);
});

test("staff mark people Keep / Warn / Remove with a private note, within their scope", async () => {
  const saiId = await t.userId("saiteja@example.com");
  const lakshmiId = await t.userId("coordinator2@example.com");
  const set = await t.call("PUT", `/api/users/${saiId}/decision`, { token: tokens.ravi, json: { decision: "WARN", note: "Missed two tasks in September" } });
  assert.equal(set.status, 200);
  assert.equal(set.body.user.decision, "WARN");

  const report = (await t.call("GET", "/api/reports/people", { token: tokens.ravi })).body.people;
  assert.equal(report.find((r) => r.person.id === saiId).person.decisionNote, "Missed two tasks in September");

  assert.equal((await t.call("PUT", `/api/users/${saiId}/decision`, { token: tokens.lakshmi, json: { decision: "KEEP" } })).status, 404, "another team's coordinator can't");
  assert.equal((await t.call("PUT", `/api/users/${saiId}/decision`, { token: tokens.rohan, json: { decision: "KEEP" } })).status, 404, "another domain's EB head can't");
  assert.equal((await t.call("PUT", `/api/users/${saiId}/decision`, { token: tokens.meena, json: { decision: "KEEP" } })).status, 403);
  assert.equal((await t.call("PUT", `/api/users/${lakshmiId}/decision`, { token: tokens.priya, json: { decision: "WARN", note: "Final work late twice" } })).status, 200, "the EB head decides on coordinators");
  assert.equal((await t.call("PUT", `/api/users/${lakshmiId}/decision`, { token: tokens.ravi, json: { decision: "KEEP" } })).status, 404, "coordinators can't decide on each other");
  assert.equal((await t.call("PUT", `/api/users/${await t.userId("eb.design@example.com")}/decision`, { token: tokens.admin, json: { decision: "KEEP" } })).status, 404, "decisions are for coordinators and volunteers");

  const me = (await t.call("GET", "/api/auth/me", { token: await t.login("saiteja@example.com") })).body.user;
  assert.equal(me.decision, undefined, "the person never sees their decision");
});

async function workbook(token) {
  const res = await fetch(`${process.env.GRADEX_TEST_BASE}/api/export`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /spreadsheetml/);
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), "PK", "a real .xlsx file");
  const ExcelJS = (await import("exceljs")).default;
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes);
  return book;
}

const column = (sheet, header) => {
  const index = sheet.getRow(1).values.indexOf(header);
  const values = [];
  sheet.eachRow((row, n) => n > 1 && values.push(row.getCell(index).value));
  return values;
};

test("Excel export: admins get everything, EB heads their domain, coordinators their team", async () => {
  const eb = await workbook(tokens.priya);
  assert.deepEqual(eb.worksheets.map((s) => s.name), ["Roster", "Submissions", "Tasks", "People"]);
  assert.deepEqual([...new Set(column(eb.getWorksheet("Roster"), "Domain"))], ["Design"]);
  assert.ok(column(eb.getWorksheet("Roster"), "Role").includes("Coordinator"), "coordinators are on the EB's roster");

  const coordinator = await workbook(tokens.ravi);
  assert.deepEqual(column(coordinator.getWorksheet("Roster"), "Name").sort(), ["Arjun Das", "Kavya Reddy", "Meena Iyer", "Sai Teja"]);
  const people = column(coordinator.getWorksheet("Submissions"), "Submitted by");
  assert.ok(!people.includes("Varun K") && !people.includes("Lakshmi Prasad"), "no other team's work");
  assert.ok(people.includes("Ravi Kumar"), "but their own final work");

  const admin = await workbook(tokens.admin);
  assert.ok(new Set(column(admin.getWorksheet("Roster"), "Domain")).size >= 2);

  const volunteer = await fetch(`${process.env.GRADEX_TEST_BASE}/api/export`, { headers: { Authorization: `Bearer ${tokens.meena}` } });
  assert.equal(volunteer.status, 403);
});

test("phone notifications at both levels: scored alerts and a single 'due soon' reminder", async () => {
  assert.equal((await t.call("POST", "/api/push/subscribe", { token: tokens.meena, json: subscription("meena-phone") })).status, 201);
  assert.equal((await t.call("POST", "/api/push/subscribe", { token: tokens.ravi, json: subscription("ravi-phone") })).status, 201);

  // Ravi scores Meena's poster: her phone hears about it.
  const pending = (await t.call("GET", "/api/reviews/pending", { token: tokens.ravi })).body.submissions;
  const meenas = pending.find((s) => s.volunteer.name === "Meena Iyer");
  await t.call("POST", "/api/evaluations", { token: tokens.ravi, json: { submissionId: meenas.id, score: 88, feedback: "Great poster" } });
  assert.ok(pushes.some((p) => p.endpoint === subscription("meena-phone").endpoint && p.title.startsWith("Scored 88/100")));

  // Priya scores Ravi's final work: his phone hears about it.
  const finals = (await t.call("GET", "/api/reviews/pending?level=DOMAIN", { token: tokens.priya })).body.submissions;
  const ravis = finals.find((s) => s.volunteer.name === "Ravi Kumar");
  assert.equal(ravis.canScore, true);
  await t.call("POST", "/api/evaluations", { token: tokens.priya, json: { submissionId: ravis.id, score: 91, feedback: "Lovely logo" } });
  assert.ok(pushes.some((p) => p.endpoint === subscription("ravi-phone").endpoint && p.title.startsWith("Scored 91/100")));

  // A team task due in 10 hours that Meena picked but hasn't submitted: one reminder, once.
  const { task } = await teamTask(t, tokens, { title: "Quick survey", deadline: inDays(0.4) });
  await t.call("POST", `/api/tasks/${task.id}/choose`, { token: tokens.meena });

  const { runDueReminders } = await import("../src/services/notify.service.js");
  const first = await runDueReminders();
  const second = await runDueReminders();
  assert.equal(first.reminded, 1);
  assert.equal(second.reminded, 0, "never twice");
  assert.ok(pushes.some((p) => p.title.includes("Quick survey") && p.endpoint === subscription("meena-phone").endpoint));
});

test("on the leaderboard a missed task counts as 0", async () => {
  const board = (await t.call("GET", "/api/board", { token: tokens.kavya })).body;
  const sai = board.leaderboard.find((r) => r.name === "Sai Teja");
  const kavya = board.leaderboard.find((r) => r.name === "Kavya Reddy");
  assert.ok(sai.missed >= 3);
  assert.ok(sai.averageScore < 50, `Sai's average ${sai.averageScore} includes his misses`);
  assert.ok(kavya.rank < sai.rank);

  const lakshmiTeam = (await t.call("GET", "/api/board", { token: tokens.varun })).body;
  const varun = lakshmiTeam.leaderboard.find((r) => r.name === "Varun K");
  assert.ok(varun.averageScore < 40, `Varun's average ${varun.averageScore} includes his misses`);
});
