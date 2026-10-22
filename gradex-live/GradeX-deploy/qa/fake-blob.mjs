// In-memory stand-in for @vercel/blob with the same conditional-write rules
// and an op counter (simple = get, advanced = put), plus optional latency.
const store = (globalThis.__sharedBlobStore ??= new Map());
globalThis.__blobVersion ??= 0;
export const stats = (globalThis.__sharedBlobStats ??= { simple: 0, advanced: 0, log: [] });
globalThis.__fakeBlob = { store, stats };
const delay = async (kind, pathname) => {
  const hook = globalThis.__blobDelay;
  const ms = hook ? hook(kind, pathname) : Number(process.env.FAKE_BLOB_MS || 0);
  if (ms) await new Promise((r) => setTimeout(r, ms));
};
export class BlobError extends Error {}
export class BlobPreconditionFailedError extends BlobError {}
export async function get(pathname, options) {
  stats.simple += 1; stats.log.push(["get", pathname]);
  const snap = store.get(pathname); // value as of the moment the request "hits" the store
  await delay("get", pathname);
  if (!snap) return null;
  return { statusCode: 200, stream: new Blob([snap.buf]).stream(), blob: { etag: snap.etag, pathname } };
}
export async function put(pathname, body, options = {}) {
  stats.advanced += 1; stats.log.push(["put", pathname]);
  await delay("put", pathname);
  const existing = store.get(pathname);
  if (options.ifMatch) {
    if (!existing || existing.etag !== options.ifMatch) throw new BlobPreconditionFailedError("precondition failed");
  } else if (existing && !options.allowOverwrite) {
    throw new BlobError("This blob already exists");
  }
  const etag = `"e${++globalThis.__blobVersion}"`;
  store.set(pathname, { buf: Buffer.from(body), etag });
  return { etag, pathname };
}
export async function del(pathname) { store.delete(pathname); }
