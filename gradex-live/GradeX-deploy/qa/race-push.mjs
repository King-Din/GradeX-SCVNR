import zlib from "node:zlib";
// Two Fluid-compute instances (two copies of the bundled function) sharing one
// Blob store. The home page mounts two <Notifications> (only="setup" and
// only="switch"), so a device with permission granted but no subscription
// fires two POST /api/push/subscribe at once.
import { startInstance, call } from "./common.mjs";
process.env.FAKE_BLOB_MS = "60";
const A = await startInstance(5092, "A");
const B = await startInstance(5093, "B");
await call(A.base, "GET", "/api/config"); await call(B.base, "GET", "/api/config");
const login = await call(A.base, "POST", "/api/auth/login", { json: { email: "volunteer@example.com", password: "password123" } });
const token = login.body.token;
const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/device-1", expirationTime: null, keys: { p256dh: "BPkey", auth: "authkey" } };
const [r1, r2] = await Promise.all([
  call(A.base, "POST", "/api/push/subscribe", { token, json: sub }),
  call(B.base, "POST", "/api/push/subscribe", { token, json: sub })
]);
console.log("subscribe statuses:", r1.status, r2.status);
const rows = () => { const h = globalThis.__fakeRedis.get("gradex:table/PushSubscriptions"); const d = h.get("d"); return JSON.parse(d.startsWith("gz:") ? zlib.gunzipSync(Buffer.from(d.slice(3), "base64")).toString() : d); };
console.log("rows for this endpoint:", rows().map((s) => ({ id: s.id, userId: s.userId })));
const off = await call(A.base, "POST", "/api/push/unsubscribe", { token, json: { endpoint: sub.endpoint } });
console.log("unsubscribe:", off.status, "rows still bound after unsubscribe:", rows().filter((s) => s.userId).map((s) => s.id));
process.exit(0);
