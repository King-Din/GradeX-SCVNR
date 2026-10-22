// Compares each Google Sheet tab's header row with src/data/schema.js.
import { env } from "../src/config/env.js";
import { getSheetsClient } from "../src/services/google.service.js";
import { TABLES } from "../src/data/schema.js";

const client = getSheetsClient();
let problems = 0;

for (const [name, { columns }] of Object.entries(TABLES)) {
  const response = await client.spreadsheets.values.get({ spreadsheetId: env.GOOGLE_SPREADSHEET_ID, range: `${name}!1:1` });
  const headers = response.data.values?.[0] ?? [];
  const missing = columns.filter((c) => !headers.includes(c));

  if (missing.length) {
    problems += 1;
    console.log(`${name}: add these header cells: ${missing.join(", ")}`);
  } else {
    console.log(`${name}: ok`);
  }
}

process.exitCode = problems ? 1 : 0;
