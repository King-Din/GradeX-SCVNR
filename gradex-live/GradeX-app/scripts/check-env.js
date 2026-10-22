// Checks that the environment is complete without printing any secret values.
import "dotenv/config";

const groups = {
  "Always": ["JWT_SECRET"],
  "New store without demo data": ["BOOTSTRAP_ADMIN_EMAIL", "BOOTSTRAP_ADMIN_PASSWORD"],
  "Optional": ["DEMO_MODE", "MAX_UPLOAD_MB", "TRUST_PROXY_HOPS", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"],
  "Google service account (preferred)": ["GOOGLE_SERVICE_ACCOUNT_KEY_FILE", "GOOGLE_SERVICE_ACCOUNT_JSON"],
  "Google OAuth (fallback)": ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"],
  "Google files": ["GOOGLE_SPREADSHEET_ID", "GOOGLE_DRIVE_FOLDER_ID"]
};

console.log(`DATA_DRIVER: ${process.env.DATA_DRIVER || "sheets (default)"}`);

for (const [label, names] of Object.entries(groups)) {
  console.log(`\n${label}`);
  for (const name of names) {
    const value = process.env[name];
    const state = value === undefined || value === "" ? "missing" : value !== value.trim() ? "set, but has stray spaces" : "set";
    console.log(`  ${name.padEnd(34)} ${state}`);
  }
}
