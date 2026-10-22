// Adapts a Netlify Blobs store to the kv interface used by kvDriver.js.
// Pass a function returning the current request's store: credentials expire.
export function blobsKv(storeOrGetter) {
  const current = () => (typeof storeOrGetter === "function" ? storeOrGetter() : storeOrGetter);
  return {
    async read(key) {
      const entry = await current().getWithMetadata(key, { type: "json" });
      return entry ? { data: entry.data, etag: entry.etag } : null;
    },
    async write(key, data, { etag, create } = {}) {
      const options = etag !== undefined ? { onlyIfMatch: etag } : create ? { onlyIfNew: true } : {};
      const result = await current().setJSON(key, data, options);
      return { modified: result?.modified ?? true, etag: result?.etag };
    }
  };
}
