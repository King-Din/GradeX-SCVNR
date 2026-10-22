import { startInstance, call } from "./common.mjs";
const { base } = await startInstance(5094, "onb");
await call(base, "GET", "/api/config");
await call(base, "POST", "/api/auth/login", { json: { email: "volunteer@example.com", password: "password123" } }); // seeds the store
const t = { simple: 0, advanced: 0 }; const add = (r, label) => { t.simple += r.simple; t.advanced += r.advanced; console.log(label.padEnd(48), r.status, `simple=${r.simple} advanced=${r.advanced}`); return r; };
let r = add(await call(base, "POST", "/api/auth/login", { json: { email: "newvolunteer@example.com", password: "password123" } }), "login");
let token = r.body.token;
add(await call(base, "GET", "/api/auth/me", { token }), "me");
r = add(await call(base, "POST", "/api/auth/change-password", { token, json: { currentPassword: "password123", newPassword: "A-much-better-pass-123" } }), "change-password");
token = r.body.token ?? token;
r = add(await call(base, "GET", "/api/domains", { token }), "domains");
r = add(await call(base, "GET", "/api/domains/D001/coordinators", { token }), "domain coordinators");
const coord = r.body.coordinators?.[0]?.id ?? "U006";
add(await call(base, "POST", "/api/auth/coordinator", { token, json: { coordinatorId: coord } }), "choose coordinator");
add(await call(base, "GET", "/api/auth/me", { token }), "me");
add(await call(base, "GET", "/api/push/key", { token }), "push key (setup screen)");
add(await call(base, "POST", "/api/push/subscribe", { token, json: { endpoint: "https://fcm.googleapis.com/fcm/send/new-1", expirationTime: null, keys: { p256dh: "BPx", auth: "ax" } } }), "push subscribe");
add(await call(base, "POST", "/api/auth/app-installed", { token, json: {} }), "app-installed");
for (const p of ["/api/auth/me", "/api/tasks/my", "/api/push/key", "/api/push/subscribe"]) {
  if (p.endsWith("subscribe")) add(await call(base, "POST", p, { token, json: { endpoint: "https://fcm.googleapis.com/fcm/send/new-1", expirationTime: null, keys: { p256dh: "BPx", auth: "ax" } } }), "home: re-register existing subscription");
  else add(await call(base, "GET", p, { token }), `home GET ${p}`);
}
console.log(`ONE person's first sign-in through to home: simple=${t.simple} advanced=${t.advanced}`);
console.log(`x 232 people: simple=${t.simple * 232} advanced=${t.advanced * 232}  (Hobby monthly: 10,000 simple / 2,000 advanced)`);
process.exit(0);
