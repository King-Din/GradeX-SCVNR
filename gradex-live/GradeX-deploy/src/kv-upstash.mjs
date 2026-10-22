import crypto from "node:crypto";
import zlib from "node:zlib";

/*
 * Upstash Redis (free plan: 500K commands, 10 GB transfer, 250 MB a month)
 * as GradeX's table store, over its REST API. Credentials come from the
 * Vercel marketplace integration's env vars.
 *
 * Each kv key (e.g. "table/Users") is a hash `gradex:<key>` with d = JSON
 * and v = version. Every save is one Lua script that checks the version and
 * updates `gradex:versions` (key -> version) in the same step, so
 * versions() is one tiny call telling which tables changed (see kvDriver's
 * `validate` option). One command per read, write or versions call.
 * Table JSON is stored gzip-compressed ("gz:" + base64), about 5x less to
 * move against the free plan's monthly transfer; plain JSON still reads.
 */
const PREFIX = "gradex:";
const VERSIONS = `${PREFIX}versions`;

// KEYS[1] item, KEYS[2] versions hash; ARGV: mode, expected version, data, new version, kv key.
const SAVE = `
local cur = redis.call('HGET', KEYS[1], 'v')
if ARGV[1] == 'match' and cur ~= ARGV[2] then return 0 end
if ARGV[1] == 'create' and cur then return 0 end
redis.call('HSET', KEYS[1], 'd', ARGV[3], 'v', ARGV[4])
redis.call('HSET', KEYS[2], ARGV[5], ARGV[4])
return 1`;

export function upstashConfig(env = process.env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

export function upstashClient({ url, token }) {
  return async function command(...args) {
    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(args)
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) throw new Error(`Upstash ${args[0]} failed: ${res.status} ${body.error ?? ""}`.trim());
    return body.result;
  };
}

const pack = (data) => `gz:${zlib.gzipSync(JSON.stringify(data)).toString("base64")}`;
const unpack = (stored) => JSON.parse(stored.startsWith("gz:") ? zlib.gunzipSync(Buffer.from(stored.slice(3), "base64")).toString("utf8") : stored);

export function upstashKv(config) {
  const command = upstashClient(config);
  const newVersion = () => crypto.randomBytes(9).toString("base64url");

  async function save(key, data, mode, expected = "") {
    const version = newVersion();
    const ok = await command("EVAL", SAVE, "2", PREFIX + key, VERSIONS, mode, expected, pack(data), version, key);
    return Number(ok) === 1 ? { modified: true, etag: version } : { modified: false };
  }

  return {
    async read(key) {
      const [data, version] = (await command("HMGET", PREFIX + key, "d", "v")) ?? [];
      return data == null ? null : { data: unpack(data), etag: version };
    },

    async write(key, data, { etag, create } = {}) {
      if (etag !== undefined) return save(key, data, "match", etag);
      return save(key, data, create ? "create" : "force");
    },

    async versions() {
      const flat = (await command("HGETALL", VERSIONS)) ?? [];
      const out = {};
      for (let i = 0; i < flat.length; i += 2) out[flat[i]] = flat[i + 1];
      return out;
    },

    command
  };
}

/*
 * Vercel Blob's Hobby plan allows 2,000 uploads ("advanced operations") a
 * month and locks the store for 30 days past that. Uploads are counted per
 * day in Redis; past the cap (over the last 30 days, since Vercel's month
 * may not be the calendar month) new uploads are refused with a message
 * asking for a link instead, so the files already there stay reachable.
 */
export function uploadBudget(command, { cap = 1700, days = 30 } = {}) {
  const dayKey = (offset) => `${PREFIX}uploads:${new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10)}`;
  return {
    async used() {
      const counts = (await command("MGET", ...Array.from({ length: days }, (_, i) => dayKey(i)))) ?? [];
      return counts.reduce((sum, n) => sum + (Number(n) || 0), 0);
    },
    async allowed() {
      return (await this.used()) < cap;
    },
    async count() {
      const key = dayKey(0);
      await command("INCR", key);
      await command("EXPIRE", key, String(40 * 86400));
    }
  };
}
