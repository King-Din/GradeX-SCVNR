// Settings shared by the improved site's API function and its reminder job.
export const STORE_NAME = "gradex-improved-v2";

// Settings the app reads on first import (the JWT secret and VAPID keys come
// from the Netlify site settings; see shared.mjs configureEnv).
export const IMPROVED_ENV = {
  NODE_ENV: "production",
  DATA_DRIVER: "kv",
  DEMO_MODE: "true",
  MAX_UPLOAD_MB: "4", // Netlify functions accept at most ~6 MB per request
  FRONTEND_URL: "https://gradex-scvnr-improved.netlify.app",
  JWT_EXPIRES_IN: "12h",
  TRUST_PROXY_HOPS: "0", // the client IP is passed in from Netlify's context.ip
  API_RATE_LIMIT_MAX: "100000", // in-memory per instance; a whole college shares one IP
  LOGIN_RATE_LIMIT_MAX: "30"
};
