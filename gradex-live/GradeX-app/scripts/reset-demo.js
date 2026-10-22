// Rebuilds the local demo data (DATA_DRIVER=local) from src/data/seed.js.
process.env.DATA_DRIVER = "local";
process.env.DEMO_MODE = "true";

const { env } = await import("../src/config/env.js");
const { resetLocalData } = await import("../src/data/store.js");

await resetLocalData();
console.log(`Demo data reset in ${env.LOCAL_DATA_FILE}`);
