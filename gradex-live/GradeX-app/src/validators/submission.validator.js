import { z } from "zod";
import { idParam } from "./common.js";

export const submissionIdParamSchema = idParam("S", "submission");

// Multipart text fields; the file itself is checked by the upload middleware.
export const submitSchema = z.object({
  taskId: z.string().regex(/^T\d{3,}$/, "Invalid task ID"),
  linkUrl: z.url({ protocol: /^https$/, error: "Paste a full link starting with https://" }).max(2000).optional()
}).strict();
