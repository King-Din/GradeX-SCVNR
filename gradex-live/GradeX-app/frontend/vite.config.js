import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proxy API calls to the backend so the browser stays on one origin. The port
// is read from the backend's own ../.env file (not process.env, which belongs
// to this Vite process), so the two can't drift apart.
function backendPort() {
  try {
    const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
    return env.match(/^PORT=(\d+)/m)?.[1] ?? "5000";
  } catch {
    return "5000";
  }
}

// GRADEX_API_PORT points a second copy (e.g. a QA server with demo data) elsewhere.
const API_URL = `http://localhost:${process.env.GRADEX_API_PORT || backendPort()}`;
const proxy = { "/api": API_URL, "/health": API_URL };

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  // `vite preview` serves the production build with the same API proxy.
  preview: { proxy }
});
