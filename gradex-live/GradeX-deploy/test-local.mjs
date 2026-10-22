// End-to-end check of a built site's API function (v2) with an in-memory
// Blobs stand-in. Usage: node test-local.mjs improved|original
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { requestToEvent, resultToResponse } from "./src/shared.mjs";

const edition = process.argv[2];
if (!["improved", "original"].includes(edition)) throw new Error("usage: node test-local.mjs improved|original");

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

// --- adapter unit checks -------------------------------------------------
{
  const req = new Request("http://local/api/tasks?status=A&status=B&q=x%20y", { method: "POST", headers: { "x-forwarded-for": "6.6.6.6" }, body: Buffer.from([0, 255, 1]) });
  const event = await requestToEvent(req, { ip: "9.9.9.9" });
  check("multi-value query kept", JSON.stringify(event.multiValueQueryStringParameters) === JSON.stringify({ status: ["A", "B"], q: ["x y"] }));
  check("binary request body kept", Buffer.compare(event.body, Buffer.from([0, 255, 1])) === 0);
  check("client IP from context, not X-Forwarded-For", event.requestContext.identity.sourceIp === "9.9.9.9");
  const r204 = resultToResponse({ statusCode: 204, headers: { "content-length": "0" }, body: "" }, "OPTIONS");
  check("204 has a null body", r204.status === 204 && r204.body === null);
  const r304 = resultToResponse({ statusCode: 304, headers: {}, body: "" });
  check("304 has a null body", r304.status === 304);
  const multi = resultToResponse({ statusCode: 200, headers: { vary: "Origin", "set-cookie": "" }, multiValueHeaders: { vary: ["Origin", "Accept"] }, body: "{}" });
  check("multi-value response headers not duplicated", multi.headers.get("vary") === "Origin, Accept");
}

// --- the built function ---------------------------------------------------
const v2 = (await import(`./sites/${edition}/functions/api.mjs`)).default;

async function call(method, path, { token, json, raw, contentType, headers = {} } = {}) {
  const res = await v2(new Request(`http://local${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(json ? { "content-type": "application/json" } : {}), ...(contentType ? { "content-type": contentType } : {}), ...headers },
    body: json ? JSON.stringify(json) : raw
  }), { ip: "127.0.0.1" });
  const buf = Buffer.from(await res.arrayBuffer());
  let body = buf;
  try { body = JSON.parse(buf.toString("utf8")); } catch {}
  return { status: res.status, headers: res.headers, body, buf };
}

// Missing secret: a clear 500, no stack trace.
delete process.env.GRADEX_JWT_SECRET;
const misconfigured = await call("GET", "/api/auth/me");
check("missing GRADEX_JWT_SECRET -> 500 JSON", misconfigured.status === 500 && misconfigured.body?.error?.code === "SERVER_MISCONFIGURED", misconfigured.body?.error?.message);
process.env.GRADEX_JWT_SECRET = crypto.randomBytes(48).toString("base64url");
process.env.GRADEX_RESET_TOKEN = crypto.randomBytes(24).toString("base64url");

const show = (label, r) => console.log("     ", label.padEnd(24), r.status, typeof r.body === "object" && !Buffer.isBuffer(r.body) ? JSON.stringify(r.body).slice(0, 120) : `${r.buf.length} bytes`);
const login = async (email) => (await call("POST", "/api/auth/login", { json: { email, password: "password123" } })).body.token;

const C = await login("coordinator@example.com");
const V = await login("volunteer@example.com");
const A = await login("admin@example.com");
check("logins", Boolean(C && V && A));

const options = await call("OPTIONS", "/api/tasks", { headers: { origin: "https://elsewhere.example", "access-control-request-method": "POST" } });
check("OPTIONS preflight", options.status === 204, String(options.status));
const head = await call("HEAD", "/api/tasks", { token: C });
check("HEAD", head.status === 200 && head.buf.length === 0, String(head.status));
const multiQuery = await call("GET", "/api/tasks?status=AVAILABLE&status=CLOSED", { token: C });
check("repeated query params accepted", multiQuery.status === 200, String(multiQuery.status));

// Concurrent writes must all be saved.
// (Counted, not matched by title: the original app writes columns out of order — one of its own bugs.)
const before = (await call("GET", "/api/tasks", { token: C })).body.tasks?.length ?? 0;
const titles = Array.from({ length: 8 }, (_, i) => `Parallel ${i} ${Date.now()}`);
const made = await Promise.all(titles.map((title) => call("POST", "/api/tasks", { token: C, json: { title, description: "x", domainId: "D001", deadline: "2030-01-01T23:59:00+05:30", status: "AVAILABLE" } })));
const listed = await call("GET", "/api/tasks", { token: C });
const saved = (listed.body.tasks?.length ?? 0) - before;
check("8 concurrent creates all saved", saved === 8, `${made.map((r) => r.status).join(",")} -> ${saved}/8 new rows`);

if (edition === "improved") {
  const many = await Promise.all(["volunteer@example.com", "kavya@example.com", "arjun@example.com", "divya@example.com", "saiteja@example.com", "varun@example.com"].map(login));
  const task = await call("POST", "/api/tasks", { token: C, json: { title: "Load test", description: "x", domainId: "D001", deadline: "2030-01-01T23:59:00+05:30", status: "AVAILABLE" } });
  await Promise.all(many.map((tk) => call("POST", `/api/tasks/${task.body.task.id}/choose`, { token: tk })));
  const results = await Promise.all(many.map((tk, i) => call("POST", "/api/submissions", { token: tk, json: { taskId: task.body.task.id, linkUrl: `https://x.example/${i}` } })));
  check("concurrent submissions", results.every((r) => r.status === 201 || r.status === 200), results.map((r) => r.status).join(","));

  // Binary file round trip.
  const created = await call("POST", "/api/tasks", { token: C, json: { title: "File task", description: "Test", domainId: "D001", deadline: "2030-01-01T23:59:00+05:30", status: "AVAILABLE" } });
  const tid = created.body.task?.id;
  await call("POST", `/api/tasks/${tid}/choose`, { token: V });
  const bytes = Buffer.concat([Buffer.from("%PDF-1.4\n"), crypto.randomBytes(4096)]);
  const boundary = "----x";
  const multipart = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="taskId"\r\n\r\n${tid}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="poster.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);
  const sub = await call("POST", "/api/submissions", { token: V, raw: multipart, contentType: `multipart/form-data; boundary=${boundary}` });
  show("submit file", sub);
  const download = sub.body.submission ? await call("GET", `/api/submissions/${sub.body.submission.id}/file`, { token: C }) : null;
  check("binary file download is byte-identical", download?.status === 200 && Buffer.compare(download.buf, bytes) === 0, download ? `${download.status}, ${download.buf.length} bytes` : "no submission");

  const exported = await call("GET", "/api/export", { token: A });
  const isZip = exported.buf.subarray(0, 2).toString() === "PK" && exported.buf.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06])) && !exported.buf.includes(Buffer.from([0xef, 0xbf, 0xbd]));
  check("Excel export is an intact zip", exported.status === 200 && isZip, `${exported.status}, ${exported.buf.length} bytes`);
}

check("reset by volunteer refused", (await call("POST", "/api/demo/reset", { token: V })).status === 403);
check("reset with no auth refused", (await call("POST", "/api/demo/reset")).status === 403);
check("reset with wrong token refused", (await call("POST", "/api/demo/reset", { headers: { "x-demo-reset-token": "wrong-token-wrong-token-wrong" } })).status === 403);
const adminReset = await call("POST", "/api/demo/reset", { token: A });
check("reset by admin", adminReset.status === 200, String(adminReset.status));
const after = await call("GET", "/api/tasks", { token: C });
check("tasks back to the seed after reset", after.body.tasks?.length === before, `${after.body.tasks?.length} tasks, seed had ${before}`);

const local = globalThis.__gradexLocalStores.get(edition === "improved" ? "gradex-improved-v2" : "gradex-original");
const fileKeys = (await local.list({ prefix: "files/" })).blobs.length;
check("reset removed stored files", fileKeys === 0, `${fileKeys} left`);

// Recovery: corrupt the data, then reset with the token.
await local.set(edition === "improved" ? "table/Users" : "state", Buffer.from("{corrupt"));
const broken = await call("GET", "/api/auth/me", { token: A });
check("corrupt data -> generic 500, no stack", broken.status >= 500 && !JSON.stringify(broken.body).includes("at "), `${broken.status} ${JSON.stringify(broken.body).slice(0, 80)}`);
const tokenReset = await call("POST", "/api/demo/reset", { headers: { "x-demo-reset-token": process.env.GRADEX_RESET_TOKEN } });
check("token reset works on corrupt data", tokenReset.status === 200, String(tokenReset.status));
check("login works after recovery", Boolean(await login("admin@example.com")));

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exitCode = failures ? 1 : 0;
