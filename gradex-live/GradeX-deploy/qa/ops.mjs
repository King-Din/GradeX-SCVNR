import { startInstance, call, stats } from "./common.mjs";
const { server, base } = await startInstance(5091, "a");
const row = (label, r) => console.log(`${label.padEnd(44)} ${String(r.status).padEnd(4)} simple=${r.simple} advanced=${r.advanced}`);
let r = await call(base, "GET", "/api/config"); row("cold start + GET /api/config (seeds store)", r);
r = await call(base, "GET", "/api/config"); row("GET /api/config (warm)", r);
r = await call(base, "GET", "/api/health"); row("GET /api/health (warm)", r);

const login = async (email) => { const x = await call(base, "POST", "/api/auth/login", { json: { email, password: "password123" } }); row(`POST /api/auth/login ${email}`, x); return x.body.token; };
const vt = await login("volunteer@example.com");
let total = { simple: 0, advanced: 0 };
for (const p of ["/api/auth/me", "/api/tasks/my", "/api/push/key", "/api/evaluations/my", "/api/tasks/available"]) {
  r = await call(base, "GET", p, { token: vt }); row(`volunteer GET ${p}`, r); total.simple += r.simple; total.advanced += r.advanced;
}
r = await call(base, "POST", "/api/push/subscribe", { token: vt, json: { endpoint: "https://fcm.googleapis.com/fcm/send/abc", expirationTime: null, keys: { p256dh: "BPx", auth: "ax" } } }); row("volunteer POST /api/push/subscribe", r); total.simple += r.simple; total.advanced += r.advanced;
console.log(`  => volunteer app open total: simple=${total.simple} advanced=${total.advanced}`);

const et = await login("eb.design@example.com");
total = { simple: 0, advanced: 0 };
for (const p of ["/api/auth/me", "/api/domains/overview", "/api/reports/people", "/api/tasks?level=DOMAIN", "/api/tasks/proposals", "/api/reviews/pending", "/api/tasks/proposals", "/api/domains", "/api/push/key", "/api/push/key"]) {
  r = await call(base, "GET", p, { token: et }); row(`EB GET ${p}`, r); total.simple += r.simple; total.advanced += r.advanced;
}
console.log(`  => EB home open total: simple=${total.simple} advanced=${total.advanced}`);
total = { simple: 0, advanced: 0 };
for (const p of ["/api/reviews/pending", "/api/tasks/proposals"]) { r = await call(base, "GET", p, { token: et }); total.simple += r.simple; }
console.log(`  => EB badge refresh (every 3 min while open): simple=${total.simple}`);

// A write
const tasks = (await call(base, "GET", "/api/tasks/my", { token: vt })).body;
const open = (tasks.tasks ?? tasks.participations ?? []).find?.((t) => t.status === "AVAILABLE" || t.task?.status === "AVAILABLE");
r = await call(base, "POST", "/api/auth/app-installed", { token: vt, json: {} }); row("volunteer POST /api/auth/app-installed", r);
const at = await login("admin@example.com");
r = await call(base, "GET", "/api/export", { token: at }); row("admin GET /api/export", r);
console.log("export headers:", r.headers.get("content-type"), r.headers.get("content-disposition"), "cache-control:", r.headers.get("cache-control"), "bytes:", r.body.length);
r = await call(base, "GET", "/api/auth/me", { token: vt }); console.log("authed GET /api/auth/me cache-control header from app:", r.headers.get("cache-control"));
server.close(); process.exit(0);
