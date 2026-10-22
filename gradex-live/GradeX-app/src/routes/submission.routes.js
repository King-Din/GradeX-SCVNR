import express from "express";
import * as submissions from "../controllers/submission.controller.js";
import { authenticateUser } from "../middleware/authenticateUser.js";
import { requireRole } from "../middleware/requireRole.js";
import { uploadSingleFile } from "../middleware/upload.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import { submissionIdParamSchema, submitSchema } from "../validators/submission.validator.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ROLES } from "../constants/roles.js";

export const submissionRouter = express.Router();

submissionRouter.use(authenticateUser);

// multipart/form-data: taskId + either file or linkUrl. Volunteers send team
// work to their coordinator; coordinators send final work to their EB head.
submissionRouter.post(
  "/",
  requireRole(ROLES.VOLUNTEER, ROLES.COORDINATOR),
  uploadSingleFile,
  validateBody(submitSchema),
  asyncHandler(submissions.submitTask)
);

// /my must come before /:id
submissionRouter.get("/my", requireRole(ROLES.VOLUNTEER, ROLES.COORDINATOR), asyncHandler(submissions.getMySubmissions));

submissionRouter.get("/:id", validateParams(submissionIdParamSchema), asyncHandler(submissions.getSubmissionById));

submissionRouter.get(
  "/:id/file",
  validateParams(submissionIdParamSchema),
  asyncHandler(submissions.downloadSubmissionFile)
);
