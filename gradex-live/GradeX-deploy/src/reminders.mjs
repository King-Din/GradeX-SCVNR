// Scheduled function (v2, hourly): "due soon" phone reminders for the improved site.
// Uses the same settings and JWT secret source as the API function.
import { configureEnv, openStore } from "./shared.mjs";
import { blobsKv } from "./kv-netlify.mjs";
import { IMPROVED_ENV, STORE_NAME } from "./improved-env.mjs";

export default async () => {
  const problem = configureEnv(IMPROVED_ENV);
  if (problem) {
    console.error(`Reminders skipped: ${problem}`);
    return;
  }

  try {
    const store = await import("../../GradeX-app/src/data/store.js");
    const { createKvDriver } = await import("../../GradeX-app/src/data/kvDriver.js");
    const { buildSeed } = await import("../../GradeX-app/src/data/seed.js");
    const { runDueReminders } = await import("../../GradeX-app/src/services/notify.service.js");

    const driver = createKvDriver({ kv: blobsKv(openStore(STORE_NAME)), seed: () => buildSeed() });
    driver.beginRequest();
    store.setDriverForTests(driver);
    const result = await runDueReminders();
    console.log(`Reminders sent: ${result.reminded}`);
  } catch (error) {
    console.error(`Reminders failed: ${error?.stack || error}`);
  }
};

export const config = { schedule: "@hourly" };
