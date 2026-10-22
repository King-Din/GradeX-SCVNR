// Bundles the real Vercel function against the in-memory stand-ins (qa/out/).
// QA_SEED=none: start with no seed (as the live site does, filling from Blob).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const qa = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(qa, "..");
await build({
  entryPoints: [path.join(root, "src/vercel-api.mjs")],
  outfile: path.join(qa, "out/index.mjs"),
  bundle: true, platform: "node", format: "esm", target: "node20",
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  keepNames: true, logLevel: "warning",
  alias: {
    bcrypt: "bcryptjs",
    "supports-color": path.join(root, "src/empty.cjs"),
    googleapis: path.join(root, "src/googleapis-stub.mjs"),
    "gradex-seed": process.env.QA_SEED === "none" ? path.join(root, "src/no-seed.mjs") : path.join(qa, "seed.mjs"),
    "@vercel/blob": path.join(qa, "fake-blob.mjs")
  },
  nodePaths: [path.join(root, "node_modules")]
});
console.log("built");
