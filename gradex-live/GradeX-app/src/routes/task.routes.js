import express from "express";
import * as tasks from "../controllers/task.controller.js";
import { authenticateUser } from "../middleware/authenticateUser.js";
import { requireRole } from "../middleware/requireRole.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.js";
import {
  approveTaskSchema, createTaskSchema, forwardTaskSchema, levelQuerySchema, proposeTaskSchema,
  rejectTaskSchema, taskIdParamSchema, updateTaskSchema
} from "../validators/task.validator.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ROLES } from "../constants/roles.js";

export const taskRouter = express.Router();

const STAFF = [ROLES.ADMIN, ROLES.EB, ROLES.COORDINATOR];
// People who pick tasks: volunteers (team tasks) and coordinators (EB tasks).
const PICKERS = [ROLES.VOLUNTEER, ROLES.COORDINATOR];

taskRouter.use(authenticateUser);

/*
 * Static paths (/available, /my, /proposals) must be registered BEFORE /:id,
 * otherwise Express matches "available" or "my" as an :id.
 */

// Open tasks you can pick now: a volunteer's team tasks, a coordinator's EB tasks.
taskRouter.get("/available", requireRole(...PICKERS), asyncHandler(tasks.getAvailableTasks));

// Your picked tasks, with submission, score and outcome.
taskRouter.get("/my", requireRole(...PICKERS), asyncHandler(tasks.getMyTasks));

// Coordinators' own task ideas: they propose, the EB head approves or rejects.
taskRouter.get("/proposals", requireRole(...STAFF), asyncHandler(tasks.getProposals));
taskRouter.post("/proposals", requireRole(ROLES.COORDINATOR), validateBody(proposeTaskSchema), asyncHandler(tasks.proposeTask));

// Admins: everything. EB heads: their domain. Coordinators: their domain's EB tasks and their own team tasks.
taskRouter.get("/", requireRole(...STAFF), validateQuery(levelQuerySchema), asyncHandler(tasks.getTasks));

// EB tasks are published by the domain's EB head (or an admin).
taskRouter.post("/", requireRole(ROLES.ADMIN, ROLES.EB), validateBody(createTaskSchema), asyncHandler(tasks.createTask));

// Drafts and proposals are only visible to the people who run them.
taskRouter.get("/:id", validateParams(taskIdParamSchema), asyncHandler(tasks.getTaskById));

taskRouter.get("/:id/participants", requireRole(...STAFF), validateParams(taskIdParamSchema), asyncHandler(tasks.getParticipants));

// Edit, publish (DRAFT -> AVAILABLE) or close (AVAILABLE -> CLOSED).
taskRouter.put(
  "/:id",
  requireRole(...STAFF),
  validateParams(taskIdParamSchema),
  validateBody(updateTaskSchema),
  asyncHandler(tasks.updateTask)
);

taskRouter.post("/:id/choose", requireRole(...PICKERS), validateParams(taskIdParamSchema), asyncHandler(tasks.chooseTask));

// "Forward to my team": a coordinator turns an EB task into a team task.
taskRouter.post(
  "/:id/forward",
  requireRole(ROLES.COORDINATOR),
  validateParams(taskIdParamSchema),
  validateBody(forwardTaskSchema),
  asyncHandler(tasks.forwardTask)
);

// The EB head decides on a coordinator's proposal.
taskRouter.post(
  "/:id/approve",
  requireRole(ROLES.ADMIN, ROLES.EB),
  validateParams(taskIdParamSchema),
  validateBody(approveTaskSchema),
  asyncHandler(tasks.approveTask)
);
taskRouter.post(
  "/:id/reject",
  requireRole(ROLES.ADMIN, ROLES.EB),
  validateParams(taskIdParamSchema),
  validateBody(rejectTaskSchema),
  asyncHandler(tasks.rejectTask)
);
