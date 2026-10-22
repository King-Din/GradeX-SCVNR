import { app } from "./app.js";
import { env } from "./config/env.js";
import { pushEnabled, runDueReminders } from "./services/notify.service.js";

const server = app.listen(env.PORT, () => {
  console.log(`Task Evaluation API running on http://localhost:${env.PORT}`);

  if (env.DATA_DRIVER === "local") {
    console.warn(`DATA_DRIVER=local: data in ${env.LOCAL_DATA_FILE}, not Google Sheets.`);
  }
});

// "Due tomorrow" phone reminders, checked every 15 minutes.
if (pushEnabled()) {
  const check = () => runDueReminders().catch((error) => console.warn(`Reminder run failed: ${error.message}`));
  setInterval(check, 15 * 60 * 1000).unref();
  check();
}

function shutdown(signal) {
  console.log(`${signal} received. Shutting down gracefully...`);

  server.close(() => {
    console.log("HTTP server closed.");
    process.exit(0);
  });

  setTimeout(() => {
    console.error("Forced shutdown after timeout.");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
