import "./env.mjs";
import http from "node:http";
import { redisStats } from "./fake-upstash.mjs";
export const stats = () => globalThis.__sharedBlobStats;
export const rstats = () => redisStats;
export async function startInstance(port, tag) {
  const mod = await import(`./out/index.mjs?instance=${tag}`);
  const server = http.createServer((req, res) => mod.default(req, res));
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  return { server, mod, base: `http://127.0.0.1:${port}` };
}
// Mimic the vercel.json rewrite: /api/:path* -> /api/index?path=...
export function vercelUrl(base, path) {
  const [p, q] = path.split("?");
  const rest = p.replace(/^\/api\//, "");
  const extra = `path=${encodeURIComponent(rest)}`;
  return `${base}${p}?${q ? q + "&" : ""}${extra}`;
}
export async function call(base, method, path, { token, json, form, headers = {} } = {}) {
  const before = { ...stats() };
  const rBefore = { commands: redisStats.commands, bytes: redisStats.bytesOut };
  const res = await fetch(vercelUrl(base, path), {
    method,
    headers: { ...(json ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: json ? JSON.stringify(json) : form
  });
  const buf = Buffer.from(await res.arrayBuffer());
  let body; try { body = JSON.parse(buf.toString()); } catch { body = buf; }
  const s = stats();
  return { status: res.status, headers: res.headers, body, simple: s.simple - before.simple, advanced: s.advanced - before.advanced, commands: redisStats.commands - rBefore.commands, bytes: redisStats.bytesOut - rBefore.bytes };
}
