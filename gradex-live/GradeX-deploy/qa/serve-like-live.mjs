// QA static server that behaves like the live Vercel site: same build output,
// same headers from vercel.json, SPA rewrite, /api proxied to the QA API.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const qa = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(qa, "../sites/vercel");
const cfg = JSON.parse(fs.readFileSync(`${site}/vercel.json`, "utf8"));
const API = "http://127.0.0.1:5070";
const types = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".webmanifest": "application/manifest+json", ".json": "application/json", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
const rules = cfg.headers.map((h) => ({ re: new RegExp("^" + h.source.replace(/\(\.\*\)/g, ".*") + "$"), headers: h.headers }));
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.startsWith("/api/") || url.pathname === "/health") {
    const body = ["GET", "HEAD"].includes(req.method) ? undefined : await new Promise((r) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => r(Buffer.concat(c))); });
    const headers = { ...req.headers }; delete headers.host; delete headers["content-length"];
    const up = await fetch(API + req.url, { method: req.method, headers, body, duplex: "half" });
    res.writeHead(up.status, Object.fromEntries([...up.headers].filter(([k]) => !["content-encoding", "transfer-encoding", "content-length"].includes(k))));
    return res.end(Buffer.from(await up.arrayBuffer()));
  }
  // QA-only test pages, served with the same headers as the site.
  if (url.pathname.startsWith("/__qa/")) {
    const f = path.join(qa, "static", url.pathname.slice(6));
    const h = { "content-type": types[path.extname(f)] || (f.endsWith(".pdf") ? "application/pdf" : "application/octet-stream") };
    for (const rule of rules) if (rule.re.test(url.pathname)) for (const x of rule.headers) h[x.key] = x.value;
    res.writeHead(fs.existsSync(f) ? 200 : 404, h);
    return res.end(fs.existsSync(f) ? fs.readFileSync(f) : "");
  }
  let file = path.join(site, "public", decodeURIComponent(url.pathname));
  if (!file.startsWith(path.join(site, "public"))) { res.writeHead(400); return res.end(); }
  let servedPath = url.pathname;
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (url.pathname.startsWith("/assets/")) { res.writeHead(404); return res.end("not found"); }
    file = path.join(site, "public", "index.html"); servedPath = "/index.html";
  }
  const headers = { "content-type": types[path.extname(file)] || "application/octet-stream" };
  for (const rule of rules) if (rule.re.test(url.pathname) || rule.re.test(servedPath)) for (const h of rule.headers) headers[h.key] = h.value;
  res.writeHead(200, headers);
  res.end(fs.readFileSync(file));
}).listen(4180, "127.0.0.1", () => console.log("QA live-like site on http://localhost:4180"));
