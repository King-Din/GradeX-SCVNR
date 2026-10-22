import "dotenv/config";
import { z } from "zod";

const isPlaceholderSecret = (value) =>
  /^(replace|change|your|default|secret|example|test)[_-]?/i.test(value) ||
  value.includes("REPLACE_WITH") ||
  value.includes("YOUR_");

const jwtExpiresSchema = z.string().trim().regex(
  /^(?:[1-9]\d*)\s*(?:s|m|h|d|w)$/i,
  "JWT_EXPIRES_IN must be a positive duration such as 15m, 1h, or 1d"
).refine((value) => {
  const match = value.match(/^(\d+)\s*(s|m|h|d|w)$/i);
  if (!match) return false;
  const amount = Number(match[1]);
  const multipliers = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
  // Up to 30 days: the installed phone app keeps people signed in, and any
  // password change, role change or deactivation still ends old sessions at
  // once (tokenVersion).
  return amount * multipliers[match[2].toLowerCase()] <= 30 * 24 * 60 * 60;
}, "JWT_EXPIRES_IN must not exceed 30 days");

const optionalString = z.string().trim().optional().transform((value) => value || undefined);

const booleanFlag = z
  .enum(["true", "false", "1", "0", "yes", "no", ""])
  .optional()
  .transform((value) => value === "true" || value === "1" || value === "yes");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),

  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRES_IN: jwtExpiresSchema.default("1h"),
  JWT_ISSUER: z.string().trim().min(1).max(100).default("task-evaluation-system"),
  JWT_AUDIENCE: z.string().trim().min(1).max(100).default("task-evaluation-api"),

  FRONTEND_URL: z.string().url().default("http://localhost:5173"),

  LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  API_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  // A whole college often shares one public IP, so keep this generous.
  API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(1000),

  // 0 means Express does not trust X-Forwarded-* headers. Set this to the
  // number of known reverse-proxy hops in production; never enable it blindly.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),

  // "sheets" uses Google Sheets + Drive. "local" keeps everything in a JSON
  // file and an uploads folder so the app runs without Google credentials.
  // "kv" is a key-value store (Netlify Blobs) whose driver the host injects
  // with store.setDriver() and whose files go through setFileStore().
  DATA_DRIVER: z.enum(["sheets", "local", "kv"]).default("sheets"),

  // Demo mode seeds the sample club (password "password123") and protects
  // those sample accounts from being changed. Never use it for real data.
  DEMO_MODE: booleanFlag,

  // Outside demo mode, a new empty store gets this one admin (who must
  // change the password at first login).
  BOOTSTRAP_ADMIN_EMAIL: optionalString,
  BOOTSTRAP_ADMIN_PASSWORD: optionalString,

  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(50).default(10),
  REMINDER_WINDOW_HOURS: z.coerce.number().int().min(1).max(72).default(24),
  LOCAL_DATA_FILE: z.string().trim().default("data/local-db.json"),
  LOCAL_UPLOAD_DIR: z.string().trim().default("data/uploads"),

  // Google access. A service account is preferred: it never expires and does
  // not depend on one person's account. The OAuth refresh token is a fallback.
  GOOGLE_SERVICE_ACCOUNT_KEY_FILE: optionalString,
  GOOGLE_SERVICE_ACCOUNT_JSON: optionalString,
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  GOOGLE_REFRESH_TOKEN: optionalString,
  GOOGLE_SPREADSHEET_ID: optionalString,
  GOOGLE_DRIVE_FOLDER_ID: optionalString,

  // Phone notifications (web push). Generate once with: npx web-push generate-vapid-keys
  VAPID_PUBLIC_KEY: optionalString,
  VAPID_PRIVATE_KEY: optionalString,
  VAPID_SUBJECT: z.string().trim().default("mailto:streetcause.vnrvjiet@example.com"),

  // How long sheet reads are reused before Google is asked again.
  SHEETS_CACHE_TTL_MS: z.coerce.number().int().min(0).max(10 * 60 * 1000).default(15000)
}).superRefine((config, ctx) => {
  if (config.DATA_DRIVER !== "sheets") return;

  const hasServiceAccount = Boolean(config.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || config.GOOGLE_SERVICE_ACCOUNT_JSON);
  const hasOAuth = Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET && config.GOOGLE_REFRESH_TOKEN);

  if (!hasServiceAccount && !hasOAuth) {
    ctx.addIssue({
      code: "custom",
      path: ["GOOGLE_SERVICE_ACCOUNT_KEY_FILE"],
      message: "Set a service account (GOOGLE_SERVICE_ACCOUNT_KEY_FILE or GOOGLE_SERVICE_ACCOUNT_JSON) or all three OAuth values, or use DATA_DRIVER=local"
    });
  }

  for (const key of ["GOOGLE_SPREADSHEET_ID", "GOOGLE_DRIVE_FOLDER_ID"]) {
    if (!config[key]) {
      ctx.addIssue({ code: "custom", path: [key], message: `${key} is required when DATA_DRIVER=sheets` });
    }
  }
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const config = parsed.data;

if (config.NODE_ENV === "production") {
  if (isPlaceholderSecret(config.JWT_SECRET)) {
    console.error("Invalid environment configuration: JWT_SECRET is a placeholder/default value.");
    process.exit(1);
  }

  if (config.JWT_SECRET.length < 43 || new Set(config.JWT_SECRET).size < 8) {
    console.error("Invalid environment configuration: production JWT_SECRET must be at least 43 characters and contain sufficient character diversity.");
    process.exit(1);
  }

  if (config.DATA_DRIVER === "local") {
    console.error("Invalid environment configuration: DATA_DRIVER=local is for development and demos only.");
    process.exit(1);
  }
}

export const env = Object.freeze(config);
