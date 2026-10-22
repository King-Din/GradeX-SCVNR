// Builds both demo sites into sites/<name>/ ready for `netlify deploy`.
// Both use the current GradeX-app frontend and v2 (ES module) functions.
// No secrets are baked in: the JWT secret is read at run time from the
// GRADEX_JWT_SECRET site setting (see src/shared.mjs).
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.dirname(new URL(import.meta.url).pathname);
const appDir = path.resolve(root, "../GradeX-app");
const only = process.argv[2];

// Static-page security headers. The API sets its own (helmet) headers.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "frame-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests"
].join("; ");

// Notifications and push are not Permissions-Policy features, so they stay
// available; powerful features the app never uses are switched off.
const PERMISSIONS = "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), midi=(), magnetometer=(), gyroscope=(), accelerometer=(), browsing-topics=()";

const NETLIFY_TOML = `[build]
  publish = "dist"

[functions]
  directory = "functions"

# Missing build files must 404, not fall through to index.html (a stale tab
# asking for an old hashed bundle would otherwise get HTML back).
[[redirects]]
  from = "/assets/*"
  to = "/404.html"
  status = 404

# Single-page app: every other unknown path is the app. /api/* is handled by
# the v2 function's own path setting before redirects apply.
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

[[headers]]
  for = "/*"
  [headers.values]
    Content-Security-Policy = "${CSP}"
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"
    Permissions-Policy = "${PERMISSIONS}"
    Cross-Origin-Opener-Policy = "same-origin"

# Hashed file names: safe to cache forever.
[[headers]]
  for = "/assets/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"

# Always revalidated so a new deploy is picked up straight away.
[[headers]]
  for = "/index.html"
  [headers.values]
    Cache-Control = "public, max-age=0, must-revalidate"

[[headers]]
  for = "/sw.js"
  [headers.values]
    Cache-Control = "no-cache"
    Service-Worker-Allowed = "/"

[[headers]]
  for = "/manifest.webmanifest"
  [headers.values]
    Content-Type = "application/manifest+json; charset=utf-8"
    Cache-Control = "public, max-age=0, must-revalidate"
`;

const NOT_FOUND_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Not found · GradeX</title></head>
<body style="font-family: system-ui, sans-serif; padding: 2rem"><h1>Not found</h1><p>This file isn't part of the current version of GradeX. <a href="/">Reload the app</a>.</p></body></html>
`;

for (const edition of ["improved", "original"]) {
  if (only && only !== edition) continue;
  const out = path.join(root, "sites", edition);
  fs.rmSync(path.join(out, "dist"), { recursive: true, force: true });
  fs.rmSync(path.join(out, "functions"), { recursive: true, force: true });
  fs.mkdirSync(path.join(out, "functions"), { recursive: true });

  // Frontend: the same (current) React app for both, labelled with its edition.
  execFileSync("npx", ["vite", "build", "--outDir", path.join(out, "dist"), "--emptyOutDir"], {
    cwd: path.join(appDir, "frontend"),
    env: { ...process.env, VITE_EDITION: edition },
    stdio: "inherit"
  });
  fs.writeFileSync(path.join(out, "dist", "404.html"), NOT_FOUND_HTML);

  // Backend: bundled v2 functions (plus the hourly reminder job on the improved site).
  const functions = [["api", `${edition}.mjs`], ...(edition === "improved" ? [["reminders", "reminders.mjs"]] : [])];
  for (const [fnName, entry] of functions) await build({
    entryPoints: [path.join(root, "src", entry)],
    outfile: path.join(out, "functions", `${fnName}.mjs`),
    bundle: true,
    platform: "node",
    format: "esm",
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    target: "node20",
    minify: true,
    keepNames: true,
    legalComments: "none",
    alias: {
      bcrypt: "bcryptjs",
      "supports-color": path.join(root, "src", "empty.cjs"),
      googleapis: path.join(root, "src", edition === "original" ? "fake-googleapis.mjs" : "googleapis-stub.mjs")
    },
    logLevel: "warning"
  });

  fs.writeFileSync(path.join(out, "netlify.toml"), NETLIFY_TOML);
  fs.writeFileSync(path.join(out, "package.json"), JSON.stringify({ name: `gradex-${edition}-demo`, private: true, type: "module" }, null, 2));
  console.log(`Built sites/${edition}`);
}
