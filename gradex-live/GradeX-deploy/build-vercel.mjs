// Builds the live site for Vercel into sites/vercel/ (static app in public/,
// one bundled function in api/). Deploy with `vercel deploy --prod` from there.
// No secrets are baked in: they come from the Vercel project settings.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.dirname(new URL(import.meta.url).pathname);
const appDir = path.resolve(root, "../GradeX-app");
const out = path.join(root, "sites", "vercel");

// Same static-page security headers as the Netlify build (build.mjs).
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
const PERMISSIONS = "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), midi=(), magnetometer=(), gyroscope=(), accelerometer=(), browsing-topics=()";

const VERCEL_JSON = {
  $schema: "https://openapi.vercel.sh/vercel.json",
  framework: null,
  buildCommand: "",
  installCommand: "",
  outputDirectory: "public",
  cleanUrls: false,
  regions: ["bom1"],
  functions: { "api/index.mjs": { maxDuration: 30, memory: 1024 } },
  crons: [{ path: "/api/cron/reminders", schedule: "30 3 * * *" }], // 9:00 am IST, daily (Hobby plan limit)
  rewrites: [
    { source: "/api/:path*", destination: "/api/index" },
    // Single-page app; static files are matched before rewrites.
    { source: "/((?!assets/).*)", destination: "/index.html" }
  ],
  headers: [
    {
      source: "/(.*)",
      headers: [
        { key: "Content-Security-Policy", value: CSP },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: PERMISSIONS },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" }
      ]
    },
    { source: "/assets/(.*)", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    { source: "/index.html", headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }] },
    { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }, { key: "Service-Worker-Allowed", value: "/" }] },
    { source: "/manifest.webmanifest", headers: [{ key: "Content-Type", value: "application/manifest+json; charset=utf-8" }] }
  ]
};

fs.rmSync(path.join(out, "public"), { recursive: true, force: true });
fs.rmSync(path.join(out, "api"), { recursive: true, force: true });
fs.mkdirSync(path.join(out, "api"), { recursive: true });

execFileSync("npx", ["vite", "build", "--outDir", path.join(out, "public"), "--emptyOutDir"], {
  cwd: path.join(appDir, "frontend"),
  // No edition banner: this is the real site, not one of the demo comparisons.
  env: { ...process.env, VITE_EDITION: "" },
  stdio: "inherit"
});

await build({
  entryPoints: [path.join(root, "src", "vercel-api.mjs")],
  outfile: path.join(out, "api", "index.mjs"),
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
    googleapis: path.join(root, "src", "googleapis-stub.mjs"),
    // SEED_FILE=<all tables .json> makes a one-off loading build; never deploy it twice.
    "gradex-seed": process.env.SEED_FILE ? path.resolve(process.env.SEED_FILE) : path.join(root, "src", "no-seed.mjs")
  },
  logLevel: "warning"
});

fs.writeFileSync(path.join(out, "vercel.json"), JSON.stringify(VERCEL_JSON, null, 2));
fs.writeFileSync(path.join(out, "package.json"), JSON.stringify({ name: "gradex", private: true, type: "module", engines: { node: "24.x" } }, null, 2));
console.log("Built sites/vercel");
