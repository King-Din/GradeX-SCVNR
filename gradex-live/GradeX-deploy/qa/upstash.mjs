// Build with QA_SEED=none first: node qa/build.mjs (with QA_SEED=none), then node qa/upstash.mjs
import { buildSeed } from "../../GradeX-app/src/data/seed.js";
import "./env.mjs";
import { rstats, startInstance, call } from "./common.mjs";
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) process.exitCode = 1; };

// The live situation: tables in Vercel Blob, Upstash empty.
const blob = (globalThis.__sharedBlobStore ??= new Map());
const seed = buildSeed();
let v = 0;
for (const [name, rows] of Object.entries(seed)) blob.set(`gradex/table/${name}`, { buf: Buffer.from(JSON.stringify(rows)), etag: `"b${++v}"` });
blob.set("gradex/meta/seeded", { buf: Buffer.from("{}"), etag: `"b${++v}"` });

const A = await startInstance(5191, "a");
const B = await startInstance(5192, "b");
const admin = (await call(A.base, "POST", "/api/auth/login", { json: { email: "admin@example.com", password: "password123" } })).body.token;
const users = await call(B.base, "GET", "/api/users", { token: admin });
ok(users.status === 200 && users.body.users.length === seed.Users.length, `Blob tables moved into Upstash: ${users.body.users?.length} of ${seed.Users.length} people, served by the other instance too`);
const blobTablesBefore = [...blob.keys()].filter((k) => k.startsWith("gradex/table/")).length;

// Consistency across two instances.
const first = (await call(A.base, "POST", "/api/auth/login", { json: { email: "newvolunteer@example.com", password: "password123" } })).body.token;
await call(B.base, "GET", "/api/auth/me", { token: first });
const changed = await call(A.base, "POST", "/api/auth/change-password", { token: first, json: { currentPassword: "password123", newPassword: "Totally-new-pass-55" } });
const tok = changed.body.token;
ok((await call(B.base, "GET", "/api/auth/me", { token: tok })).status === 200, "new password works at once on the other instance");
const coords = await call(B.base, "GET", "/api/domains/D001/coordinators", { token: tok });
await call(B.base, "POST", "/api/auth/coordinator", { token: tok, json: { coordinatorId: coords.body.coordinators[0].id } });
const meA = await call(A.base, "GET", "/api/auth/me", { token: tok });
ok(Boolean(meA.body.user?.coordinatorId), "a change made on B shows on A's very next request");

// Cost per screen (commands and bytes from Upstash).
const sum = async (token, base, paths) => { let c = 0, b = 0; for (const p of paths) { const r = await call(base, "GET", p, { token }); c += r.commands; b += r.bytes; } return { c, b }; };
const vol = (await call(A.base, "POST", "/api/auth/login", { json: { email: "volunteer@example.com", password: "password123" } })).body.token;
await sum(vol, A.base, ["/api/auth/me"]);
const volOpen = await sum(vol, A.base, ["/api/auth/me", "/api/tasks/my", "/api/push/key", "/api/evaluations/my", "/api/tasks/available"]);
const eb = (await call(A.base, "POST", "/api/auth/login", { json: { email: "eb.design@example.com", password: "password123" } })).body.token;
const ebOpen = await sum(eb, A.base, ["/api/auth/me", "/api/domains/overview", "/api/reports/people", "/api/tasks?level=DOMAIN", "/api/tasks/proposals", "/api/reviews/pending", "/api/domains", "/api/push/key"]);
console.log(`      volunteer opens app: ${volOpen.c} commands, ${(volOpen.b / 1024).toFixed(1)} KB from Upstash`);
console.log(`      EB home: ${ebOpen.c} commands, ${(ebOpen.b / 1024).toFixed(1)} KB`);
ok(volOpen.c <= 10, `a cold app open stays small (${volOpen.c} commands)`);

// Uploads: allowed, then refused past the monthly cap; existing files still open.
const meena = vol;
const eb2 = (await call(A.base, "POST", "/api/tasks", { token: eb, json: { title: "Upload test", description: "x", deadline: new Date(Date.now() + 8 * 864e5).toISOString(), status: "AVAILABLE" } })).body.task;
const ravi = (await call(A.base, "POST", "/api/auth/login", { json: { email: "coordinator@example.com", password: "password123" } })).body.token;
const team = (await call(A.base, "POST", `/api/tasks/${eb2.id}/forward`, { token: ravi, json: { deadline: new Date(Date.now() + 6 * 864e5).toISOString() } })).body.task;
await call(A.base, "POST", `/api/tasks/${team.id}/choose`, { token: meena, json: {} });
const form = () => { const f = new FormData(); f.set("taskId", team.id); f.set("file", new Blob([Buffer.from("%PDF-1.4\n%%EOF")], { type: "application/pdf" }), "a.pdf"); return f; };
const up1 = await call(A.base, "POST", "/api/submissions", { token: meena, form: form() });
ok(up1.status === 201 || up1.status === 200, `upload within the allowance works (${up1.status})`);
const today = `gradex:uploads:${new Date().toISOString().slice(0, 10)}`;
globalThis.__fakeRedis.set(today, "1700");
const up2 = await call(A.base, "POST", "/api/submissions", { token: meena, form: form() });
ok(up2.status === 409 && /paste a google drive or canva link/i.test(up2.body?.error?.message ?? ""), `past the cap, uploads are refused with a clear message (${up2.status})`);
const file = await call(A.base, "GET", `/api/submissions/${up1.body.submission.id}/file`, { token: meena });
ok(file.status === 200, "the file already uploaded still opens");
const link = await call(A.base, "POST", "/api/submissions", { token: meena, json: { taskId: team.id, linkUrl: "https://docs.google.com/document/d/qa" } });
ok(link.status === 200 || link.status === 201, `links still work past the cap (${link.status})`);

ok([...blob.keys()].filter((k) => k.startsWith("gradex/table/")).length === blobTablesBefore, "tables are no longer written to Blob (the old copy stays as a backup)");
console.log("      Upstash commands by type:", JSON.stringify(rstats().byCommand));
A.server.close(); B.server.close(); globalThis.__fakeUpstash.server.close(); process.exit();
