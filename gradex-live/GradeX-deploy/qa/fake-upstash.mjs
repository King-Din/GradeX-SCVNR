// In-process stand-in for Upstash's REST API: the commands GradeX uses, the
// SAVE script's exact rules, and counters for commands and bytes sent back.
import http from "node:http";
const db = (globalThis.__fakeRedis ??= new Map()); // key -> Map (hash) | string
export const redisStats = (globalThis.__redisStats ??= { commands: 0, bytesOut: 0, byCommand: {} });
const hash = (key) => { if (!(db.get(key) instanceof Map)) db.set(key, new Map()); return db.get(key); };
function run([cmd, ...args]) {
  switch (cmd.toUpperCase()) {
    case "HMGET": { const h = db.get(args[0]); return args.slice(1).map((f) => (h instanceof Map ? h.get(f) ?? null : null)); }
    case "HGETALL": { const h = db.get(args[0]); return h instanceof Map ? [...h].flat() : []; }
    case "MGET": return args.map((k) => (typeof db.get(k) === "string" ? db.get(k) : null));
    case "INCR": { const n = (Number(db.get(args[0])) || 0) + 1; db.set(args[0], String(n)); return n; }
    case "EXPIRE": return 1;
    case "DEL": { let n = 0; for (const k of args) n += db.delete(k) ? 1 : 0; return n; }
    case "EVAL": {
      const [, , item, versions, mode, expected, data, version, field] = args;
      const cur = db.get(item) instanceof Map ? db.get(item).get("v") : undefined;
      if (mode === "match" && cur !== expected) return 0;
      if (mode === "create" && cur !== undefined) return 0;
      hash(item).set("d", data); hash(item).set("v", version);
      hash(versions).set(field, version);
      return 1;
    }
    default: throw new Error(`fake upstash: unsupported ${cmd}`);
  }
}
export async function startFakeUpstash(port = 0) {
  const server = http.createServer((req, res) => {
    let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
      let out;
      try {
        const args = JSON.parse(body);
        redisStats.commands += 1; redisStats.byCommand[args[0]] = (redisStats.byCommand[args[0]] ?? 0) + 1;
        out = JSON.stringify({ result: run(args) });
      } catch (e) { out = JSON.stringify({ error: e.message }); }
      redisStats.bytesOut += Buffer.byteLength(out);
      res.writeHead(200, { "content-type": "application/json" }); res.end(out);
    });
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
