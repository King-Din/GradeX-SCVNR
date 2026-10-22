// Shared plumbing for both demo sites (Netlify Functions v2).
//
// v2 functions receive a web Request; the Express apps run through
// serverless-http, which expects a Lambda-style event. The helpers here
// translate in both directions, open the Blobs store, handle the demo reset,
// and make sure nothing (stack traces, half-written state) leaks out.
import crypto from "node:crypto";
import serverless from "serverless-http";
import { getStore } from "@netlify/blobs";

const onNetlify = () => typeof Netlify !== "undefined";

// Netlify site settings are on Netlify.env in v2 functions; process.env is
// the fallback for local runs.
export function envValue(key) {
  const value = onNetlify() ? Netlify.env.get(key) : undefined;
  return value ?? process.env[key];
}

const GENERIC_500 = { success: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } };

/*
 * Copies the site settings the app needs into process.env (the app reads its
 * config once, on first import). Returns a problem message instead of letting
 * the app's own config check call process.exit() and kill the function.
 */
export function configureEnv(fixed) {
  const secret = envValue("GRADEX_JWT_SECRET");
  if (!secret || secret.length < 43 || new Set(secret).size < 8 || /^(replace|change|your|default|secret|example|test)/i.test(secret)) {
    return "The server is not configured: set GRADEX_JWT_SECRET (at least 43 random characters) in the Netlify site settings.";
  }
  process.env.JWT_SECRET = secret;
  for (const key of ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]) {
    const value = envValue(key);
    if (value) process.env[key] = value;
  }
  Object.assign(process.env, fixed);
  const frontend = envValue("FRONTEND_URL");
  if (frontend) process.env.FRONTEND_URL = frontend;
  return null;
}

/*
 * Wraps an Express handler factory as a v2 function: checks configuration,
 * initialises once, translates request/response, and turns any crash into a
 * plain 500 (never a stack trace).
 */
export function createV2Function({ fixedEnv, init }) {
  let ready;
  return async function v2(req, context) {
    try {
      const problem = configureEnv(fixedEnv);
      if (problem) {
        console.error(problem);
        return jsonResponse(500, { success: false, error: { code: "SERVER_MISCONFIGURED", message: problem } });
      }
      ready ??= init().catch((error) => {
        ready = undefined; // try again on the next request
        throw error;
      });
      const handler = await ready;
      const result = await handler(await requestToEvent(req, context), {});
      return resultToResponse(result, req.method);
    } catch (error) {
      console.error(error?.stack || error);
      return jsonResponse(500, GENERIC_500);
    }
  };
}

// Strongly consistent store so every request sees the latest saves. Outside
// Netlify (local tests) an in-memory store stands in; on Netlify that
// fallback is never used, so data can't silently live in one instance only.
export function openStore(name) {
  if (onNetlify()) return getStore({ name, consistency: "strong" });
  if (process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY_BLOBS_CONTEXT) {
    throw new Error("Netlify Blobs is unavailable in this function; refusing to use an in-memory store");
  }
  return localStore(name);
}

export async function requestToEvent(req, context) {
  const url = new URL(req.url);
  const headers = Object.fromEntries(req.headers.entries()); // repeated headers arrive joined with ", "

  const multiQuery = {};
  for (const key of new Set(url.searchParams.keys())) multiQuery[key] = url.searchParams.getAll(key);
  const hasQuery = Object.keys(multiQuery).length > 0;

  const body = ["GET", "HEAD"].includes(req.method) ? null : Buffer.from(await req.arrayBuffer());

  return {
    httpMethod: req.method,
    path: url.pathname,
    headers,
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: hasQuery ? multiQuery : null,
    body: body && body.length ? body : null, // serverless-http accepts a Buffer as is
    isBase64Encoded: false,
    // The client address comes from Netlify (context.ip), never from request
    // headers, so rate limiting can't be dodged with a forged X-Forwarded-For.
    requestContext: { identity: { sourceIp: context?.ip || "127.0.0.1" } }
  };
}

// Only JSON and text/* responses are passed through as text; everything else
// (Excel, Word, PowerPoint, images, PDFs...) is carried as base64 so no byte
// is lost.
export function isBinaryResponse(headers) {
  const type = String(headers?.["content-type"] || "").split(";")[0].trim().toLowerCase();
  return !(type === "application/json" || type.startsWith("text/"));
}

const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

export function resultToResponse(result, method = "GET") {
  const headers = new Headers();
  const multi = result.multiValueHeaders || {};
  for (const [key, value] of Object.entries(result.headers || {})) {
    if (!multi[key]) headers.set(key, String(value));
  }
  for (const [key, values] of Object.entries(multi)) for (const value of [].concat(values)) headers.append(key, String(value));
  headers.delete("transfer-encoding");

  const status = result.statusCode || 200;
  if (NULL_BODY_STATUS.has(status) || method === "HEAD") {
    if (NULL_BODY_STATUS.has(status)) headers.delete("content-length");
    return new Response(null, { status, headers });
  }

  const raw = result.body ?? "";
  const body = result.isBase64Encoded ? Buffer.from(raw, "base64") : Buffer.from(String(raw), "utf8");
  headers.set("content-length", String(body.length));
  return new Response(body.length ? body : null, { status, headers });
}

export function prepareEvent(event) {
  event.requestContext ??= { identity: { sourceIp: "127.0.0.1" } };
  event.headers ??= {};
  event.path = (event.path || "").replace(/^\/\.netlify\/functions\/api/, "/api");
  return event;
}

// serverless-http modifies the event it is given, so each run gets a copy.
function copyEvent(event, overrides = {}) {
  const query = event.multiValueQueryStringParameters;
  return {
    ...event,
    headers: { ...event.headers },
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: query ? Object.fromEntries(Object.entries(query).map(([k, v]) => [k, [...v]])) : null,
    requestContext: { ...event.requestContext, identity: { ...event.requestContext?.identity } },
    ...overrides
  };
}

const isResetRequest = (event) => event.path === "/api/demo/reset" && event.httpMethod === "POST";

/*
 * Who may reset the shared demo: a signed-in admin, or anyone holding the
 * recovery token from the site settings (GRADEX_RESET_TOKEN). The token path
 * never reads the stored data, so it works even if the data is corrupt or
 * every admin account has been locked.
 */
async function resetAllowed(event, roleOf) {
  const given = event.headers["x-demo-reset-token"];
  if (given) {
    const expected = envValue("GRADEX_RESET_TOKEN");
    if (!expected || expected.length < 24) return false;
    const a = crypto.createHash("sha256").update(String(given)).digest();
    const b = crypto.createHash("sha256").update(expected).digest();
    return crypto.timingSafeEqual(a, b);
  }
  if (!event.headers.authorization) return false;
  return (await roleOf()) === "ADMIN";
}

function roleFrom(result) {
  try {
    const raw = result.isBase64Encoded ? Buffer.from(result.body, "base64").toString("utf8") : result.body;
    return JSON.parse(raw).user?.role ?? null;
  } catch {
    return null;
  }
}

const meEvent = (event) => copyEvent(event, { path: "/api/auth/me", httpMethod: "GET", body: null, multiValueQueryStringParameters: null });

export async function deletePrefix(blobs, prefix) {
  const { blobs: entries } = await blobs.list({ prefix });
  await Promise.all(entries.map((entry) => blobs.delete(entry.key)));
  return entries.length;
}

/*
 * IMPROVED site: the app's own storage saves record changes directly with
 * conditional writes, so this handler only routes the demo reset.
 */
export function createKvHandler({ app, onRequest, reset }) {
  const run = serverless(app, { binary: isBinaryResponse });

  return async function handler(event, context) {
    prepareEvent(event);
    await onRequest(event);

    if (isResetRequest(event)) {
      const allowed = await resetAllowed(event, async () => roleFrom(await run(meEvent(event), context)));
      if (!allowed) return json(403, { success: false, error: { code: "FORBIDDEN", message: "Only an admin can reset the demo data" } });
      await reset();
      return json(200, { success: true, message: "Demo data reset" });
    }

    return run(copyEvent(event), context);
  };
}

/*
 * ORIGINAL site: the team's app keeps everything in (fake) Google Sheets,
 * stored here as one JSON document. Each request loads it, runs the app, and
 * saves only if nothing else saved in between (etag check). On a conflict the
 * request is simply run again on the fresh data, which is safe because the
 * app has no side effects outside this document. Every save is read back.
 */
export function createStateHandler({ app, storeName, seed, attach, maxAttempts = 8 }) {
  const run = serverless(app, { binary: isBinaryResponse });

  async function load(blobs) {
    let entry = await blobs.getWithMetadata("state", { type: "json" });
    if (!entry) {
      await blobs.setJSON("state", await seed(), { onlyIfNew: true });
      entry = await blobs.getWithMetadata("state", { type: "json" });
    }
    if (!entry?.etag) throw new Error("Demo state has no version tag; refusing to save over it");
    return entry;
  }

  // The fake Sheets client holds the attached state in module memory, so
  // requests sharing one instance take turns (instances are kept apart by
  // the etag check below).
  let queue = Promise.resolve();
  const oneAtATime = (fn) => {
    const turn = queue.then(fn, fn);
    queue = turn.catch(() => {});
    return turn;
  };

  async function attempt(blobs, event, context) {
    const { data, etag } = await load(blobs);
    const session = attach(data);
    const response = await run(copyEvent(event), context);
    if (!session.isDirty()) return response;

    const result = await blobs.setJSON("state", session.state(), { onlyIfMatch: etag });
    if (result?.modified === false) return null;
    // A dropped write leaves the old version in place; anything newer was
    // saved on top of ours (every save is conditional), so ours landed.
    const check = await blobs.getWithMetadata("state", { type: "json" });
    return check && check.etag !== etag ? response : null;
  }

  async function execute(blobs, event, context) {
    for (let n = 1; n <= maxAttempts; n += 1) {
      const response = await oneAtATime(() => attempt(blobs, event, context));
      if (response) return response;
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 25 * n));
    }
    return json(503, { success: false, error: { code: "BUSY", message: "Too many people are saving at once. Please try again." } });
  }

  return async function handler(event, context) {
    prepareEvent(event);
    const blobs = openStore(storeName);

    if (isResetRequest(event)) {
      const allowed = await resetAllowed(event, async () => roleFrom(await execute(blobs, meEvent(event), context)));
      if (!allowed) return json(403, { success: false, error: { code: "FORBIDDEN", message: "Only an admin can reset the demo data" } });
      await blobs.setJSON("state", await seed());
      await deletePrefix(blobs, "files/");
      return json(200, { success: true, message: "Demo data reset" });
    }

    return execute(blobs, event, context);
  };
}

// In-memory stand-in for Netlify Blobs, for local tests only (on globalThis
// so test-local.mjs can inspect or corrupt it).
const localStores = (globalThis.__gradexLocalStores ??= new Map());
let version = 0;
function localStore(name) {
  if (!localStores.has(name)) {
    const map = new Map();
    localStores.set(name, {
      async get(key, { type } = {}) {
        const entry = map.get(key);
        if (!entry) return null;
        if ("json" in entry) return type === "json" ? structuredClone(entry.json) : JSON.stringify(entry.json);
        const raw = entry.raw;
        return type === "arrayBuffer" ? raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) : raw;
      },
      async getWithMetadata(key) {
        const entry = map.get(key);
        if (!entry) return null;
        const data = "json" in entry ? structuredClone(entry.json) : JSON.parse(entry.raw.toString("utf8")); // throws on corrupt data, like Blobs
        return { data, etag: entry.etag, metadata: {} };
      },
      async setJSON(key, value, { onlyIfMatch, onlyIfNew } = {}) {
        const existing = map.get(key);
        if (onlyIfNew && existing) return { modified: false };
        if (onlyIfMatch !== undefined && existing?.etag !== onlyIfMatch) return { modified: false };
        const etag = `"e${++version}"`;
        map.set(key, { json: structuredClone(value), etag });
        return { modified: true, etag };
      },
      async set(key, value) {
        map.set(key, { raw: Buffer.from(value), etag: `"e${++version}"` });
        return { modified: true };
      },
      async delete(key) {
        map.delete(key);
      },
      async list({ prefix = "" } = {}) {
        return { blobs: [...map.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, etag: map.get(key).etag })), directories: [] };
      }
    });
  }
  return localStores.get(name);
}

function json(statusCode, body) {
  return { statusCode, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }, body: JSON.stringify(body) };
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
