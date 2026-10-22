import crypto from "node:crypto";
import { startFakeUpstash } from "./fake-upstash.mjs";
process.env.GRADEX_JWT_SECRET = crypto.randomBytes(48).toString("base64url");
process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_fake";
process.env.CRON_SECRET = "cron-test-secret";
const fake = (globalThis.__fakeUpstash ??= await startFakeUpstash());
process.env.KV_REST_API_URL = fake.url;
process.env.KV_REST_API_TOKEN = "fake-upstash-token";
