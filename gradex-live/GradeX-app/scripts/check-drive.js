// Uploads a tiny text file to the configured Drive folder to prove access.
import { storeFile, removeFile } from "../src/services/file.service.js";

try {
  const result = await storeFile({
    buffer: Buffer.from("GradeX Drive access test"),
    mimeType: "text/plain",
    prefix: "drive-test"
  });
  console.log("Upload worked:", result.fileUrl ?? result.fileId);
  await removeFile(result.fileId);
  console.log("Test file removed.");
} catch (error) {
  console.error("Drive upload failed:", error.response?.data?.error?.message || error.message);
  process.exitCode = 1;
}
