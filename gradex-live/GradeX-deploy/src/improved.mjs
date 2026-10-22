// Netlify function (v2) for the IMPROVED version (~/Desktop/GradeX-app).
import { createKvHandler, createV2Function, deletePrefix, openStore } from "./shared.mjs";
import { blobsKv } from "./kv-netlify.mjs";
import { IMPROVED_ENV, STORE_NAME } from "./improved-env.mjs";

// The app is loaded on the first request, after IMPROVED_ENV is applied.
async function init() {
  const { app } = await import("../../GradeX-app/src/app.js");
  const store = await import("../../GradeX-app/src/data/store.js");
  const { createKvDriver } = await import("../../GradeX-app/src/data/kvDriver.js");
  const { buildSeed } = await import("../../GradeX-app/src/data/seed.js");
  const { setFileStore } = await import("../../GradeX-app/src/services/file.service.js");

  let driver;
  let blobs;

  return createKvHandler({
    app,
    async onRequest() {
      // Netlify's storage credentials are per request and expire, so open the
      // store fresh every time; the driver always uses the current one.
      blobs = openStore(STORE_NAME);
      driver ??= createKvDriver({ kv: blobsKv(() => blobs), seed: () => buildSeed() });
      driver.beginRequest();
      store.setDriverForTests(driver);
      setFileStore({
        put: (name, buffer) => blobs.set(`files/${name}`, buffer),
        get: async (name) => {
          const data = await blobs.get(`files/${name}`, { type: "arrayBuffer" });
          return data ? Buffer.from(data) : null;
        },
        remove: (name) => blobs.delete(`files/${name}`)
      });
    },
    async reset() {
      await driver.reset();
      await deletePrefix(blobs, "files/");
    }
  });
}

export default createV2Function({ fixedEnv: IMPROVED_ENV, init });

export const config = { path: "/api/*" };
