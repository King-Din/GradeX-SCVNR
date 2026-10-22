import { startInstance, call } from "./common.mjs";
import crypto from "node:crypto";
const { base } = await startInstance(5095, "up");
await call(base, "GET", "/api/config");
const token = (await call(base, "POST", "/api/auth/login", { json: { email: "volunteer@example.com", password: "password123" } })).body.token;
const my = (await call(base, "GET", "/api/tasks/my", { token })).body;
let open = my.participations.find((x) => x.task?.status === "AVAILABLE" && !x.evaluation);
if (!open) { const av = (await call(base, "GET", "/api/tasks/available", { token })).body; const t = (av.tasks ?? [])[0]; await call(base, "POST", `/api/tasks/${t.id}/choose`, { token }); open = { taskId: t.id }; }
const taskId = open.taskId; console.log("task:", taskId);
const png = Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), crypto.randomBytes(4 * 1024 * 1024 - 8)]); // exactly 4 MiB
const form = new FormData(); form.append("taskId", taskId); form.append("file", new Blob([png], { type: "image/png" }), "poster.png");
const req = new Request("http://x", { method: "POST", body: form }); const total = (await req.arrayBuffer()).byteLength;
console.log("multipart body for a 4 MiB file:", total, "bytes (Vercel limit 4.5 MB = 4,500,000)");
const r = await call(base, "POST", "/api/submissions", { token, form });
console.log("upload:", r.status, r.body.message ?? r.body.error, "ops simple/advanced:", r.simple, r.advanced);
const id = r.body.submission?.id;
const d = await call(base, "GET", `/api/submissions/${id}/file`, { token });
console.log("download:", d.status, d.headers.get("content-type"), d.headers.get("content-disposition"), "cache-control:", d.headers.get("cache-control"), "identical:", Buffer.isBuffer(d.body) && Buffer.compare(d.body, png) === 0);
const big = new FormData(); big.append("taskId", taskId); big.append("file", new Blob([Buffer.concat([png, Buffer.alloc(1)])], { type: "image/png" }), "big.png");
const b = await call(base, "POST", "/api/submissions", { token, form: big });
console.log("4 MiB + 1 byte:", b.status, JSON.stringify(b.body));
process.exit(0);
