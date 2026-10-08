import express from "express";

import {
  getPendingSubmissions,
  submitEvaluation,
  getEvaluationById
} from "../controllers/evaluation.controller.js";

import { authenticateUser } from "../middleware/authenticateUser.js";
import { requireRole } from "../middleware/requireRole.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import {
  createEvaluationSchema,
  evaluationIdParamSchema
} from "../validators/evaluation.validator.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ROLES } from "../constants/roles.js";

export const evaluationRouter = express.Router();

evaluationRouter.use(authenticateUser);

evaluationRouter.get(
  "/submissions",
  requireRole(ROLES.COORDINATOR),
  asyncHandler(getPendingSubmissions)
);

evaluationRouter.post(
  "/evaluations",
  requireRole(ROLES.COORDINATOR),
  validateBody(createEvaluationSchema),
  asyncHandler(submitEvaluation)
);

evaluationRouter.get(
  "/evaluations/:id",
  requireRole(ROLES.COORDINATOR, ROLES.VOLUNTEER),
  validateParams(evaluationIdParamSchema),
  asyncHandler(getEvaluationById)
);
