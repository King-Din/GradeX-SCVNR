import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { env } from "../config/env.js";

export const FILE_TYPES = Object.freeze({
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "text/plain": ".txt"
});

export const MAX_UPLOAD_MB = env.MAX_UPLOAD_MB;
export const MAX_FILE_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

const startsWith = (buffer, bytes) => buffer.length >= bytes.length && bytes.every((b, i) => buffer[i] === b);
const ZIP = [0x50, 0x4b, 0x03, 0x04]; // docx / pptx are zip files

const SIGNATURES = {
  "application/pdf": (b) => startsWith(b, [0x25, 0x50, 0x44, 0x46]), // %PDF
  "application/msword": (b) => startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": (b) => startsWith(b, ZIP),
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": (b) => startsWith(b, ZIP),
  "image/png": (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/jpeg": (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  "text/plain": (b) => {
    if (b.includes(0)) return false;
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(b);
      return true;
    } catch {
      return false;
    }
  }
};

// Does the file's content really start like the type the browser claimed?
export function matchesFileType(mimeType, buffer) {
  const check = SIGNATURES[mimeType];
  return Boolean(check && buffer && check(Buffer.from(buffer)));
}

// Files we keep ourselves (local folder or the host's store) are served back
// through GET /api/submissions/:id/file; Drive files open through their link.
export function servesStoredFiles() {
  return Boolean(externalStore) || env.DATA_DRIVER === "local";
}

// Hosted builds plug in their own storage: { put(name, buffer), get(name), remove(name) }.
let externalStore = null;
export function setFileStore(store) {
  externalStore = store;
}

/*
 * Stores an uploaded file under a name we generate (never the user's name)
 * and returns { fileId, fileUrl }. Google Drive in sheets mode, a local
 * folder in local mode (served back through an authenticated route).
 */
export async function storeFile({ buffer, mimeType, prefix }) {
  const fileName = `${prefix}_${crypto.randomUUID()}${FILE_TYPES[mimeType] ?? ""}`;

  if (externalStore) {
    await externalStore.put(fileName, buffer);
    return { fileId: fileName, fileUrl: null };
  }

  if (env.DATA_DRIVER === "kv") throw new Error("DATA_DRIVER=kv needs setFileStore() for uploads");

  if (env.DATA_DRIVER === "local") {
    fs.mkdirSync(env.LOCAL_UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(env.LOCAL_UPLOAD_DIR, fileName), buffer);
    return { fileId: fileName, fileUrl: null };
  }

  const { getDriveClient } = await import("./google.service.js");
  const response = await getDriveClient().files.create({
    requestBody: { name: fileName, parents: [env.GOOGLE_DRIVE_FOLDER_ID] },
    media: { mimeType, body: Readable.from([buffer]) },
    fields: "id, webViewLink",
    supportsAllDrives: true
  });

  return { fileId: response.data.id, fileUrl: response.data.webViewLink };
}

export async function removeFile(fileId) {
  if (!fileId) return;

  try {
    if (externalStore) {
      await externalStore.remove(fileId);
      return;
    }

    if (env.DATA_DRIVER === "local") {
      fs.rmSync(localFilePath(fileId), { force: true });
      return;
    }

    const { getDriveClient } = await import("./google.service.js");
    await getDriveClient().files.delete({ fileId, supportsAllDrives: true });
  } catch (error) {
    // A leftover old file is harmless; never fail a resubmission over it.
    console.warn(`Could not remove replaced file ${fileId}: ${error.message}`);
  }
}

// Local/demo storage only (Drive files are opened through their link).
export async function readStoredFile(fileId) {
  if (externalStore) return externalStore.get(path.basename(fileId));
  const filePath = localFilePath(fileId);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
}

export function localFilePath(fileId) {
  // fileId is always a name we generated; basename() blocks path tricks anyway.
  return path.join(env.LOCAL_UPLOAD_DIR, path.basename(fileId));
}
