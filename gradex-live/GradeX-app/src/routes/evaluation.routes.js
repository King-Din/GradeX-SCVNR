import express from "express";
import * as evaluations from "../controllers/evaluation.controller.js";
import { authenticateUser } from "../middleware/authenticateUser.js";
import { requireRole } from "../middleware/requireRole.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.js";
import { createEvaluationSchema, evaluationIdParamSchema, updateEvaluationSchema } from "../validators/evaluation.validator.js";
import { levelQuerySchema } from "../validators/task.validator.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ROLES } from "../constants/roles.js";

export const reviewRouter = express.Router();
export const evaluationRouter = express.Router();

const STAFF = [ROLES.ADMIN, ROLES.EB, ROLES.COORDINATOR];

reviewRouter.use(authenticateUser, requireRole(...STAFF));

// Work nobody has scored yet / already scored, in the reviewer's scope.
// ?level=DOMAIN (coordinators' final work) or TEAM (volunteers' work).
reviewRouter.get("/pending", validateQuery(levelQuerySchema), asyncHandler(evaluations.getPendingReviews));
reviewRouter.get("/scored", validateQuery(levelQuerySchema), asyncHandler(evaluations.getScoredReviews));

evaluationRouter.use(authenticateUser);

evaluationRouter.post(
  "/",
  requireRole(...STAFF),
  validateBody(createEvaluationSchema),
  asyncHandler(evaluations.submitEvaluation)
);

// /my must come before /:id
evaluationRouter.get("/my", requireRole(ROLES.VOLUNTEER, ROLES.COORDINATOR), asyncHandler(evaluations.getMyEvaluations));

evaluationRouter.get("/:id", validateParams(evaluationIdParamSchema), asyncHandler(evaluations.getEvaluationById));

evaluationRouter.put(
  "/:id",
  requireRole(...STAFF),
  validateParams(evaluationIdParamSchema),
  validateBody(updateEvaluationSchema),
  asyncHandler(evaluations.updateEvaluation)
);
