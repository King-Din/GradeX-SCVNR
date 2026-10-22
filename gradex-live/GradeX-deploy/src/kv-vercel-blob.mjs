import { del, get, put, BlobPreconditionFailedError } from "@vercel/blob";

/*
 * Vercel Blob (a private store) as GradeX's storage on Vercel. Credentials
 * come from the project's connected Blob store (BLOB_READ_WRITE_TOKEN).
 *
 * Tables: one JSON blob per key under `gradex/`, read uncached and written
 * with "only if the ETag still matches" (or "only if missing" when created),
 * which is all kvDriver.js needs to never overwrite someone else's save.
 * Files: `gradex-files/<name>`.
 */
const TABLES = "gradex/";
const FILES = "gradex-files/";
const PRIVATE = { access: "private", addRandomSuffix: false, cacheControlMaxAge: 60 };

// Read uncompressed: a compressed response carries a weak ETag (W/"...") that
// a conditional write never matches, so big tables could never be saved.
async function readBlob(pathname, { useCache = false } = {}) {
  const result = await get(pathname, { access: "private", useCache, headers: { "accept-encoding": "identity" } });
  if (!result || result.statusCode !== 200) return null;
  return { buffer: Buffer.from(await new Response(result.stream).arrayBuffer()), etag: result.blob.etag.replace(/^W\//, "") };
}

export function vercelBlobKv() {
  return {
    async read(key) {
      const blob = await readBlob(TABLES + key);
      return blob ? { data: JSON.parse(blob.buffer.toString("utf8")), etag: blob.etag } : null;
    },

    async write(key, data, { etag, create } = {}) {
      const options = { ...PRIVATE, contentType: "application/json" };
      if (etag !== undefined) options.ifMatch = etag;
      else if (!create) options.allowOverwrite = true;
      try {
        const result = await put(TABLES + key, JSON.stringify(data), options);
        return { modified: true, etag: result.etag };
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError) return { modified: false };
        // "Only if missing" and it exists already.
        if (create && (await readBlob(TABLES + key))) return { modified: false };
        throw error;
      }
    }
  };
}

/*
 * Daily backups of every table (gzip JSON) under gradex-backups/<IST date>,
 * one upload a day. The free database plan keeps no backups of its own.
 */
const BACKUPS = "gradex-backups/";
export const vercelBlobBackups = {
  async save(day, gzipped) {
    await put(`${BACKUPS}${day}.json.gz`, gzipped, { ...PRIVATE, allowOverwrite: true, contentType: "application/gzip" });
  },
  async remove(day) {
    await del(`${BACKUPS}${day}.json.gz`).catch(() => {}); // deletes are free; a missing one is fine
  },
  async read(day) {
    return (await readBlob(`${BACKUPS}${day}.json.gz`))?.buffer ?? null;
  }
};

export const vercelBlobFiles = {
  async put(name, buffer) {
    await put(FILES + name, buffer, { ...PRIVATE, contentType: "application/octet-stream" });
  },
  // Uploaded files never change (each upload gets a new name), so the CDN's
  // copy is always right, and cached reads don't count against Blob limits.
  async get(name) {
    return (await readBlob(FILES + name, { useCache: true }))?.buffer ?? null;
  },
  async remove(name) {
    await del(FILES + name);
  }
};
