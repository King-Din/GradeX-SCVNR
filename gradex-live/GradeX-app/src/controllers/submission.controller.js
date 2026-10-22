import path from "node:path";
import * as submissions from "../services/submission.service.js";
import { FILE_TYPES, readStoredFile, servesStoredFiles } from "../services/file.service.js";
import { success } from "../utils/apiResponse.js";
import { notFound } from "../utils/appError.js";

export async function submitTask(req, res) {
  const { submission, replaced } = await submissions.submit(req.user, {
    taskId: req.body.taskId,
    linkUrl: req.body.linkUrl,
    file: req.file
  });

  return success(res, replaced ? 200 : 201, {
    message: replaced ? "Submission replaced" : submission.isLate ? "Submitted after the deadline" : "Submitted",
    submission
  });
}

export async function getMySubmissions(req, res) {
  return success(res, 200, { submissions: await submissions.listMySubmissions(req.user) });
}

export async function getSubmissionById(req, res) {
  return success(res, 200, { submission: await submissions.getSubmissionFor(req.user, req.params.id) });
}

// Local folder or the host's file store (kv); Drive files open through their link.
export async function downloadSubmissionFile(req, res) {
  const submission = await submissions.getSubmissionFor(req.user, req.params.id);

  if (!servesStoredFiles() || !submission.fileId) throw notFound("No stored file for this submission");

  const buffer = await readStoredFile(submission.fileId);
  if (!buffer) throw notFound("The stored file is missing");

  const extension = path.extname(submission.fileId);
  const type = Object.keys(FILE_TYPES).find((mime) => FILE_TYPES[mime] === extension) ?? "application/octet-stream";
  res.attachment(submission.fileName || submission.fileId).type(type).send(Buffer.from(buffer));
}
