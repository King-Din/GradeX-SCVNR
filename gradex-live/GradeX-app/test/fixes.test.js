import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { inDays, loginAll, PDF_BYTES, startTestServer, teamTask } from "./helpers.js";

// Regression tests for the security audit fixes, on the sample club data
// (without demo-mode protections, so accounts can be changed).
let t;
let notify;
let tokens = {};
const pushes = [];
let sendImpl = async () => {};

const keys = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };
const endpoint = (name) => `https://fcm.googleapis.com/fcm/send/${name}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

before(async () => {
  t = await startTestServer({
    env: {
      VAPID_PUBLIC_KEY: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U",
      VAPID_PRIVATE_KEY: "UUxI4O8-FbRouAevSmBQ6o18hgE4nSG3qwvJTfKc-ls"
    }
  });
  notify = await import("../src/services/notify.service.js");
  notify.setPushSender(async (subscription, payload) => {
    await sendImpl(subscription);
    pushes.push({ endpoint: subscription.endpoint, ...JSON.parse(payload) });
  });
  tokens = await loginAll(t, ["admin", "admin2", "priya", "rohan", "ravi", "lakshmi", "arvind", "meena", "kavya", "arjun", "sai", "varun"]);
});

after(async () => {
  await t.close();
  t.cleanup();
});

// A team task in Ravi's team (forwarded from a fresh EB task of Priya's).
async function newTask({ deadline = inDays(5), title, coordinator = "ravi" } = {}) {
  return (await teamTask(t, tokens, { deadline, title, coordinator })).task;
}

const pick = (task, token) => t.call("POST", `/api/tasks/${task.id}/choose`, { token });
const sendLink = (task, token, url = "https://www.canva.com/design/x") =>
  t.call("POST", "/api/submissions", { token, json: { taskId: task.id, linkUrl: url } });

function fileForm(taskId, bytes, type, name) {
  const form = new FormData();
  form.append("taskId", taskId);
  form.append("file", new Blob([bytes], { type }), name);
  return form;
}

// #1 ---------------------------------------------------------------------

test("a slow push service doesn't hold up anyone else's save", async () => {
  const task = await newTask();
  await pick(task, tokens.meena);
  const submission = (await sendLink(task, tokens.meena)).body.submission;
  assert.equal((await t.call("POST", "/api/push/subscribe", { token: tokens.meena, json: { endpoint: endpoint("meena-slow"), keys } })).status, 201);

  sendImpl = () => sleep(1500);
  try {
    const scoring = t.call("POST", "/api/evaluations", { token: tokens.ravi, json: { submissionId: submission.id, score: 70, feedback: "Ok" } });
    await sleep(150);

    const other = await newTask();
    const started = Date.now();
    assert.equal((await pick(other, tokens.kavya)).status, 201);
    assert.ok(Date.now() - started < 1000, "the pick didn't wait for the notification");

    assert.equal((await scoring).status, 201);
  } finally {
    sendImpl = async () => {};
  }
});

test("the write lock gives up after its timeout and never runs work that timed out waiting", async () => {
  const hang = t.store.withWriteLock(() => sleep(400), { timeoutMs: 100 });
  let ranLate = false;
  const queued = t.store.withWriteLock(async () => { ranLate = true; }, { timeoutMs: 50 });

  await assert.rejects(queued, (error) => error.status === 503 && /busy/.test(error.message));
  await assert.rejects(hang, (error) => error.status === 503);

  const started = Date.now();
  assert.equal(await t.store.withWriteLock(async () => "next"), "next");
  assert.ok(Date.now() - started < 250, "later work isn't stuck behind the hung one");

  await sleep(450);
  assert.equal(ranLate, false, "work that timed out while waiting never ran");
});

// #2 ---------------------------------------------------------------------

test("board: someone who picked a finished task and hasn't submitted can't see others' work until they submit or it closes", async () => {
  const task = await newTask({ title: "Copy check" });
  for (const token of [tokens.meena, tokens.kavya, tokens.arjun]) await pick(task, token);
  const kavyas = (await sendLink(task, tokens.kavya, "https://www.canva.com/design/kavya-original")).body.submission;
  await t.store.update("Tasks", task.id, { deadline: inDays(-0.1) });

  const boardFor = async (token) => (await t.call("GET", "/api/board", { token })).body.tasks.find((x) => x.id === task.id);

  const meenaBefore = await boardFor(tokens.meena);
  assert.equal(meenaBefore.workHidden, true);
  assert.equal(meenaBefore.submissions.length, 0);
  assert.ok(!JSON.stringify(meenaBefore).includes("kavya-original"));
  assert.equal((await t.call("GET", `/api/submissions/${kavyas.id}`, { token: tokens.meena })).status, 404);

  // Staff and teammates who didn't pick it see everything; other teams don't.
  assert.equal((await t.call("GET", `/api/submissions/${kavyas.id}`, { token: tokens.varun })).status, 404, "another team");
  assert.equal((await boardFor(tokens.sai)).submissions.length, 1);
  assert.equal((await t.call("GET", `/api/submissions/${kavyas.id}`, { token: tokens.sai })).status, 200);

  // Late work is still accepted; after that the board opens up.
  assert.equal((await sendLink(task, tokens.meena)).status, 201);
  assert.equal((await boardFor(tokens.meena)).submissions.length, 2);
  assert.equal((await t.call("GET", `/api/submissions/${kavyas.id}`, { token: tokens.meena })).status, 200);

  // Arjun never submitted: hidden until the task is closed.
  assert.equal((await boardFor(tokens.arjun)).workHidden, true);
  assert.equal((await t.call("PUT", `/api/tasks/${task.id}`, { token: tokens.ravi, json: { status: "CLOSED" } })).status, 200);
  assert.equal((await boardFor(tokens.arjun)).workHidden, false);
  assert.equal((await t.call("GET", `/api/submissions/${kavyas.id}`, { token: tokens.arjun })).status, 200);
});

// #3 ---------------------------------------------------------------------

test("standing: open picks don't wipe out a slipping record, and picking isn't activity", async () => {
  const saiId = await t.userId("saiteja@example.com");
  const varunId = await t.userId("varun@example.com");
  const standing = async (id) =>
    (await t.call("GET", "/api/reports/people", { token: tokens.priya })).body.people.find((v) => v.person.id === id);

  assert.equal((await standing(saiId)).standing, "SLIPPING");
  assert.equal((await standing(varunId)).standing, "INACTIVE");

  for (let i = 0; i < 9; i += 1) assert.equal((await pick(await newTask(), tokens.sai)).status, 201);
  assert.equal((await pick(await newTask({ coordinator: "lakshmi" }), tokens.varun)).status, 201);

  const sai = await standing(saiId);
  assert.equal(sai.standing, "SLIPPING", "nine open picks don't reset it to NEW");
  assert.ok(sai.history.every((h) => h.outcome !== "IN_PROGRESS"), "the window holds finished tasks only");
  assert.ok(sai.current.length >= 9, "open picks are listed separately");
  assert.equal((await standing(varunId)).standing, "INACTIVE", "a pick alone isn't activity");
});

// #4 ---------------------------------------------------------------------

test("admins can't demote or deactivate themselves, the last active admin is kept, and there are at most two", async () => {
  const ashaId = await t.userId("admin@example.com");
  const vikramId = await t.userId("admin2@example.com");
  assert.equal((await t.call("PATCH", `/api/users/${ashaId}`, { token: tokens.admin, json: { role: "VOLUNTEER" } })).status, 400);
  assert.equal((await t.call("PATCH", `/api/users/${ashaId}`, { token: tokens.admin, json: { status: "DEACTIVATED" } })).status, 400);

  // Only two admins: a third can't be added.
  const third = await t.call("POST", "/api/users", {
    token: tokens.admin,
    json: { name: "Third Admin", email: "third.admin@example.com", password: "board-member-77", role: "ADMIN" }
  });
  assert.equal(third.status, 409);
  assert.match(third.body.error.message, /only be 2 admins/);

  // With two, one can step the other down; then the last one is protected.
  assert.equal((await t.call("PATCH", `/api/users/${vikramId}`, { token: tokens.admin, json: { role: "COORDINATOR", domainId: "D003" } })).status, 200);
  const users = await import("../src/services/user.service.js");
  const otherAdmin = { id: "U999", role: "ADMIN", domainId: null };
  await assert.rejects(users.updateUser(otherAdmin, ashaId, { role: "VOLUNTEER" }), (error) => error.status === 409);
  await assert.rejects(users.updateUser(otherAdmin, ashaId, { status: "DEACTIVATED" }), (error) => error.status === 409);

  assert.equal((await t.call("PATCH", `/api/users/${vikramId}`, { token: tokens.admin, json: { role: "ADMIN" } })).status, 200);
  tokens.admin2 = await t.login("admin2@example.com");
});

// #5 ---------------------------------------------------------------------

test("old tokens stop working after a password change or reset, a role change, or deactivation", async () => {
  const kavyaOld = await t.login("kavya@example.com");
  const changed = await t.call("POST", "/api/auth/change-password", { token: kavyaOld, json: { currentPassword: "password123", newPassword: "fresh-river-77" } });
  assert.equal(changed.status, 200);
  assert.equal((await t.call("GET", "/api/auth/me", { token: kavyaOld })).status, 401);
  assert.equal((await t.call("GET", "/api/auth/me", { token: changed.body.token })).status, 200, "the returned token works");
  tokens.kavya = changed.body.token;

  const varunOld = await t.login("varun@example.com");
  await t.call("POST", `/api/users/${await t.userId("varun@example.com")}/reset-password`, { token: tokens.admin, json: { password: "fresh-start-42" } });
  assert.equal((await t.call("GET", "/api/auth/me", { token: varunOld })).status, 401);

  const nikhilId = await t.userId("nikhil@example.com");
  const arvindId = await t.userId("coordinator.pr@example.com");
  const nikhilOld = await t.login("nikhil@example.com");
  assert.equal((await t.call("PATCH", `/api/users/${nikhilId}`, { token: tokens.admin, json: { role: "COORDINATOR" } })).status, 200);
  assert.equal((await t.call("PATCH", `/api/users/${nikhilId}`, { token: tokens.admin, json: { role: "VOLUNTEER", coordinatorId: arvindId } })).status, 200);
  assert.equal((await t.call("GET", "/api/auth/me", { token: nikhilOld })).status, 401, "same role again, still signed out");

  const divyaId = await t.userId("divya@example.com");
  const divyaOld = await t.login("divya@example.com");
  await t.call("PATCH", `/api/users/${divyaId}`, { token: tokens.lakshmi, json: { status: "DEACTIVATED" } });
  await t.call("PATCH", `/api/users/${divyaId}`, { token: tokens.lakshmi, json: { status: "ACTIVE" } });
  assert.equal((await t.call("GET", "/api/auth/me", { token: divyaOld })).status, 401, "reactivating doesn't revive old tokens");
  assert.ok(await t.login("divya@example.com"), "but they can sign in again");
});

// #6 ---------------------------------------------------------------------

test("push: only real push services, at most 5 devices per person, and logout can detach a device", async () => {
  for (const bad of ["https://evil.example/push", "https://127.0.0.1:8443/push", "https://fcm.googleapis.com.evil.example/x", "http://fcm.googleapis.com/x"]) {
    const res = await t.call("POST", "/api/push/subscribe", { token: tokens.arjun, json: { endpoint: bad, keys } });
    assert.equal(res.status, 400, bad);
  }
  for (const ok of ["https://updates.push.services.mozilla.com/wpush/v2/a", "https://wns2-par02p.notify.windows.com/w/?token=a", "https://web.push.apple.com/abc"]) {
    assert.equal((await t.call("POST", "/api/push/subscribe", { token: tokens.sai, json: { endpoint: ok, keys } })).status, 201, ok);
  }

  for (let i = 1; i <= 6; i += 1) {
    assert.equal((await t.call("POST", "/api/push/subscribe", { token: tokens.arjun, json: { endpoint: endpoint(`arjun-${i}`), keys } })).status, 201);
    await sleep(5);
  }
  const arjunId = await t.userId("arjun@example.com");
  const arjuns = (await t.store.list("PushSubscriptions")).filter((s) => s.userId === arjunId).map((s) => s.endpoint);
  assert.equal(arjuns.length, 5);
  assert.ok(!arjuns.includes(endpoint("arjun-1")), "the oldest device dropped off");

  const out = await t.call("POST", "/api/auth/logout", { token: tokens.arjun, json: { endpoint: endpoint("arjun-6") } });
  assert.equal(out.status, 200);
  const after = (await t.store.list("PushSubscriptions")).find((s) => s.endpoint === endpoint("arjun-6"));
  assert.equal(after.userId, null);
  assert.equal((await t.call("POST", "/api/auth/logout", { token: tokens.arjun })).status, 200, "a plain logout still works");
});

// #11 + PUT /api/evaluations/:id ------------------------------------------

test("nobody scores their own work, and scores can be corrected by the right people", async () => {
  const vikramId = await t.userId("admin2@example.com");
  // Vikram steps down to coordinate in Design for a while and delivers an EB task.
  assert.equal((await t.call("PATCH", `/api/users/${vikramId}`, { token: tokens.admin, json: { role: "COORDINATOR", domainId: "D001" } })).status, 200);
  const vikramCoordinator = await t.login("admin2@example.com");
  const parent = (await t.call("POST", "/api/tasks", { token: tokens.priya, json: { title: "Own work", description: "d", deadline: inDays(6), status: "AVAILABLE" } })).body.task;
  assert.equal((await pick(parent, vikramCoordinator)).status, 201);
  const finalWork = (await sendLink(parent, vikramCoordinator)).body.submission;

  // Back to admin: he still can't score his own final work.
  assert.equal((await t.call("PATCH", `/api/users/${vikramId}`, { token: tokens.admin, json: { role: "ADMIN" } })).status, 200);
  const vikramAdmin = await t.login("admin2@example.com");
  tokens.admin2 = vikramAdmin;
  const own = await t.call("POST", "/api/evaluations", { token: vikramAdmin, json: { submissionId: finalWork.id, score: 100, feedback: "Perfect" } });
  assert.equal(own.status, 403);

  const scored = await t.call("POST", "/api/evaluations", { token: tokens.priya, json: { submissionId: finalWork.id, score: 60, feedback: "Fine" } });
  assert.equal(scored.status, 201);
  const id = scored.body.evaluation.id;

  assert.equal((await t.call("PUT", `/api/evaluations/${id}`, { token: vikramAdmin, json: { score: 100, feedback: "x" } })).status, 403, "not their own, even as an edit");
  assert.equal((await t.call("PUT", `/api/evaluations/${id}`, { token: tokens.rohan, json: { score: 10, feedback: "x" } })).status, 404, "not another domain's EB head");
  assert.equal((await t.call("PUT", `/api/evaluations/${id}`, { token: tokens.ravi, json: { score: 10, feedback: "x" } })).status, 404, "coordinators don't score each other");
  assert.equal((await t.call("PUT", `/api/evaluations/${id}`, { token: tokens.meena, json: { score: 10, feedback: "x" } })).status, 403);
  assert.equal((await t.call("PUT", `/api/evaluations/${id}`, { token: tokens.priya, json: { score: 101, feedback: "x" } })).status, 400);

  await t.call("POST", "/api/push/subscribe", { token: vikramAdmin, json: { endpoint: endpoint("vikram-phone"), keys } });
  const updated = await t.call("PUT", `/api/evaluations/${id}`, { token: tokens.priya, json: { score: 75, feedback: "Better than I first thought" } });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.evaluation.score, 75);
  assert.ok(updated.body.evaluation.updatedAt);
  assert.ok(pushes.some((p) => p.endpoint === endpoint("vikram-phone") && p.title.startsWith("Score updated to 75/100")));

  const byAdmin = await t.call("PUT", `/api/evaluations/${id}`, { token: tokens.admin, json: { score: 80, feedback: "Admin review" } });
  assert.equal(byAdmin.status, 200);
});

// #12 #13 ------------------------------------------------------------------

test("a deadline can't move once it has passed, and a picked task can't change domain", async () => {
  const { parent: task } = await teamTask(t, tokens);
  assert.equal((await t.call("PUT", `/api/tasks/${task.id}`, { token: tokens.admin, json: { domainId: "D002" } })).status, 409, "Ravi picked it when forwarding");

  const unpicked = (await t.call("POST", "/api/tasks", { token: tokens.priya, json: { title: "Unpicked", description: "d", deadline: inDays(6), status: "AVAILABLE" } })).body.task;
  assert.equal((await t.call("PUT", `/api/tasks/${unpicked.id}`, { token: tokens.admin, json: { domainId: "D002" } })).status, 200, "no picks yet: fine");

  assert.equal((await t.call("PUT", `/api/tasks/${task.id}`, { token: tokens.priya, json: { deadline: inDays(12) } })).status, 200, "still open: fine");
  await t.store.update("Tasks", task.id, { deadline: inDays(-1) });
  const moved = await t.call("PUT", `/api/tasks/${task.id}`, { token: tokens.priya, json: { deadline: inDays(3) } });
  assert.equal(moved.status, 409);
  assert.match(moved.body.error.message, /deadline has passed/);
});

// #14 #15 #17 --------------------------------------------------------------

test("uploads must really be the type they claim", async () => {
  const task = await newTask();
  await pick(task, tokens.meena);
  const send = (bytes, type, name) => t.call("POST", "/api/submissions", { token: tokens.meena, form: fileForm(task.id, bytes, type, name) });

  assert.equal((await send(new TextEncoder().encode("<html><script>alert(1)</script>"), "application/pdf", "x.pdf")).status, 400);
  assert.equal((await send(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]), "image/jpeg", "x.jpg")).status, 400);
  assert.equal((await send(new Uint8Array([104, 105, 0, 104]), "text/plain", "x.txt")).status, 400, "text with NUL bytes");
  assert.equal((await send(new Uint8Array([0xc3, 0x28]), "text/plain", "x.txt")).status, 400, "invalid UTF-8");
  assert.equal((await send(new TextEncoder().encode("not a zip"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "x.docx")).status, 400);

  assert.equal((await send(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]), "image/png", "x.png")).status, 201);
  assert.equal((await send(new TextEncoder().encode("Plain notes, ünïcode ok"), "text/plain", "notes.txt")).status, 200);
  assert.equal((await send(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9]), "application/vnd.openxmlformats-officedocument.presentationml.presentation", "x.pptx")).status, 200);
  assert.equal((await send(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]), "application/msword", "x.doc")).status, 200);
  assert.equal((await send(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg", "x.jpg")).status, 200);
  assert.equal((await send(PDF_BYTES, "application/pdf", "x.pdf")).status, 200);
});

test("one upload at a time per person", async () => {
  const task = await newTask();
  await pick(task, tokens.meena);
  const boundary = "----gradexboundary";
  const { port } = new URL(process.env.GRADEX_TEST_BASE);

  // Start an upload and keep it open.
  const slow = http.request({
    host: "127.0.0.1", port, method: "POST", path: "/api/submissions",
    headers: { Authorization: `Bearer ${tokens.meena}`, "Content-Type": `multipart/form-data; boundary=${boundary}` }
  });
  slow.on("error", () => {});
  slow.write(`--${boundary}\r\nContent-Disposition: form-data; name="taskId"\r\n\r\n${task.id}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4\n`);
  await sleep(150);

  const second = await t.call("POST", "/api/submissions", { token: tokens.meena, form: fileForm(task.id, PDF_BYTES, "application/pdf", "b.pdf") });
  assert.equal(second.status, 429);

  const someoneElse = await newTask();
  await pick(someoneElse, tokens.sai);
  assert.equal((await t.call("POST", "/api/submissions", { token: tokens.sai, form: fileForm(someoneElse.id, PDF_BYTES, "application/pdf", "c.pdf") })).status, 201, "other people aren't blocked");

  slow.destroy();
  await sleep(150);
  assert.equal((await t.call("POST", "/api/submissions", { token: tokens.meena, form: fileForm(task.id, PDF_BYTES, "application/pdf", "b.pdf") })).status, 201, "free again once the first ends");
});

test("submission links must be https", async () => {
  const task = await newTask();
  await pick(task, tokens.meena);
  assert.equal((await sendLink(task, tokens.meena, "http://www.canva.com/design/x")).status, 400);
  assert.equal((await sendLink(task, tokens.meena, "https://www.canva.com/design/x")).status, 201);
});

// #19 -----------------------------------------------------------------------

test("new passwords: no common ones, none containing the email name; sample accounts still sign in", async () => {
  const add = (email, password) => t.call("POST", "/api/users", { token: tokens.admin, json: { name: "P", email, password, role: "VOLUNTEER", domainId: "D001" } });
  assert.equal((await add("p1@example.com", "Password123")).status, 400);
  assert.equal((await add("p2@example.com", "qwerty123")).status, 400);
  assert.equal((await add("streetcause@example.com", "StreetCause")).status, 400);
  assert.equal((await add("ravikiran@example.com", "my-ravikiran-pass")).status, 400);
  assert.equal((await add("p3@example.com", "short1")).status, 400);
  assert.equal((await add("p4@example.com", "long-and-unusual-9")).status, 201);

  const reset = await t.call("POST", `/api/users/${await t.userId("saiteja@example.com")}/reset-password`, { token: tokens.admin, json: { password: "saiteja-2026" } });
  assert.equal(reset.status, 400, "contains the email name");

  const sai = await t.login("saiteja@example.com");
  assert.ok(sai, "existing password123 accounts still sign in");
  assert.equal((await t.call("POST", "/api/auth/change-password", { token: sai, json: { currentPassword: "password123", newPassword: "12345678" } })).status, 400);
});

test("health says nothing about storage; /api/config gives public settings", async () => {
  for (const path of ["/health", "/api/health"]) {
    const res = await t.call("GET", path);
    assert.equal(res.status, 200);
    assert.equal(res.body.dataDriver, undefined);
  }
  const config = await t.call("GET", "/api/config");
  assert.deepEqual(config.body, { success: true, maxUploadMb: 10, demo: false });
});

// Reminders (hosting audit) ----------------------------------------------------

test("reminders: one failure doesn't stop the rest, a failed send is retried, overlapping runs send once", async () => {
  await t.call("POST", "/api/auth/logout", { token: tokens.meena, json: { endpoint: endpoint("meena-slow") } });
  await t.call("POST", "/api/push/subscribe", { token: tokens.meena, json: { endpoint: endpoint("meena-remind"), keys } });
  await t.call("POST", "/api/push/subscribe", { token: tokens.sai, json: { endpoint: endpoint("sai-remind"), keys } });

  const task = await newTask({ title: "Reminder retry", deadline: inDays(0.4) });
  await pick(task, tokens.meena);
  await pick(task, tokens.sai);
  const mine = (name) => pushes.filter((p) => p.title.includes("Reminder retry") && p.endpoint === endpoint(name)).length;

  let failMeena = true;
  sendImpl = async (subscription) => {
    if (failMeena && subscription.endpoint === endpoint("meena-remind")) throw new Error("push service down");
  };
  try {
    await notify.runDueReminders();
    assert.equal(mine("sai-remind"), 1);
    assert.equal(mine("meena-remind"), 0);

    failMeena = false;
    await notify.runDueReminders();
    assert.equal(mine("meena-remind"), 1, "retried on the next run");
    assert.equal(mine("sai-remind"), 1, "not sent twice");

    const overlap = await newTask({ title: "Reminder overlap", deadline: inDays(0.4) });
    await pick(overlap, tokens.meena);
    sendImpl = () => sleep(100);
    await Promise.all([notify.runDueReminders(), notify.runDueReminders(), notify.runDueReminders()]);
    assert.equal(pushes.filter((p) => p.title.includes("Reminder overlap")).length, 1);
    const logged = (await t.store.list("NotificationLog")).filter((l) => l.kind === "DUE_SOON");
    assert.equal(new Set(logged.map((l) => l.refId)).size, logged.length, "one log row per pick");
  } finally {
    sendImpl = async () => {};
  }
});

// Import (runs last: swaps the storage driver) ---------------------------------

test("import hashes outside the lock and never leaks internal error text", async () => {
  const { createLocalDriver } = await import("../src/data/localDriver.js");
  const real = createLocalDriver({ file: process.env.LOCAL_DATA_FILE });
  t.store.setDriver({
    list: (name) => real.list(name),
    update: (name, id, patch) => real.update(name, id, patch),
    insert: async (name, values, options) => {
      if (values.email === "boom@example.com") throw new Error("EACCES: /srv/secret/path/db.json");
      return real.insert(name, values, options);
    }
  });

  const res = await t.call("POST", "/api/users/import", {
    token: tokens.admin,
    json: {
      users: [
        { name: "Fine", email: "fine@example.com", password: "batch-pass-0001", role: "VOLUNTEER", domainId: "D001" },
        { name: "Boom", email: "boom@example.com", password: "batch-pass-0002", role: "VOLUNTEER", domainId: "D001" },
        { name: "No domain", email: "nodomain@example.com", password: "batch-pass-0003", role: "VOLUNTEER", domainId: "D099" }
      ]
    }
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.created, 1);
  const byEmail = Object.fromEntries(res.body.results.map((r) => [r.email, r]));
  assert.equal(byEmail["boom@example.com"].ok, false);
  assert.ok(!JSON.stringify(res.body).includes("/srv/secret"), "internal error text stays in the server log");
  assert.match(byEmail["nodomain@example.com"].error, /D099 does not exist/, "our own messages still come through");
});
