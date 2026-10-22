// Netlify function (v2) for the ORIGINAL version: the team's GitHub code at
// commit c7ec46b (~/Desktop/GradeX-original), not modified in any way.
// Google Sheets is replaced by a fake (fake-googleapis.mjs) whose data is one
// JSON document in Netlify Blobs, saved with the same conditional-write care
// as the improved site so the comparison is about the app, not the hosting.
import { createStateHandler, createV2Function } from "./shared.mjs";

const ORIGINAL_ENV = {
  NODE_ENV: "production",
  GOOGLE_CLIENT_ID: "demo",
  GOOGLE_CLIENT_SECRET: "demo",
  GOOGLE_REFRESH_TOKEN: "demo",
  GOOGLE_SPREADSHEET_ID: "demo",
  FRONTEND_URL: "https://gradex-scvnr-original.netlify.app",
  TRUST_PROXY_HOPS: "0",
  API_RATE_LIMIT_MAX: "100000",
  LOGIN_RATE_LIMIT_MAX: "30"
};

// Loaded on the first request so the environment above is set before the
// app's own config is read.
async function init() {
  const { useSheets, sheetsDirty } = await import("./fake-googleapis.mjs");
  const { app } = await import("../../GradeX-original/src/app.js");
  const { buildSeed } = await import("../../GradeX-app/src/data/seed.js");

  // Header rows exactly as the team's docs/SHEET_SCHEMA.md lists them.
  const HEADERS = {
    Users: ["id", "name", "email", "passwordHash", "role", "domainId"],
    Domains: ["id", "name"],
    Tasks: ["id", "title", "description", "domainId", "deadline", "status", "createdBy", "createdAt"],
    Participations: ["id", "taskId", "volunteerId", "chosenAt", "status"],
    Submissions: ["id", "participationId", "taskId", "volunteerId", "fileId", "fileUrl", "submittedAt"],
    Evaluations: ["id", "submissionId", "evaluatorId", "score", "feedback", "evaluatedAt"]
  };

  // Same people, tasks and history as the improved demo, laid out as sheet rows.
  function seedSheets() {
    const tables = buildSeed();
    const sheets = {};
    for (const [tab, headers] of Object.entries(HEADERS)) {
      sheets[tab] = [headers, ...(tables[tab] ?? []).map((row) => headers.map((h) => (row[h] == null ? "" : String(row[h]))))];
    }
    return sheets;
  }

  return createStateHandler({
    app,
    storeName: "gradex-original",
    seed: seedSheets,
    attach(state) {
      useSheets(state);
      return { isDirty: sheetsDirty, state: () => state };
    }
  });
}

export default createV2Function({ fixedEnv: ORIGINAL_ENV, init });

export const config = { path: "/api/*" };
