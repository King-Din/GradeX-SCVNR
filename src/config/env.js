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
  return amount * multipliers[match[2].toLowerCase()] <= 24 * 60 * 60;
}, "JWT_EXPIRES_IN must not exceed 24 hours");

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
  API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(200),

  // 0 means Express does not trust X-Forwarded-* headers. Set this to the
  // number of known reverse-proxy hops in production; never enable it blindly.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),

  DEV_AUTH_MOCK: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true")
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

  if (config.DEV_AUTH_MOCK) {
    console.error("Invalid environment configuration: DEV_AUTH_MOCK must be false in production.");
    process.exit(1);
  }
}

export const env = Object.freeze(config);
