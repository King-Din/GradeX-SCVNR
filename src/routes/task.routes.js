import express from "express";
import {
  getTasks,
  getAvailableTasks,
  getTaskById,
  createTask,
  updateTask,
  chooseTask,
  getMyTasks
} from "../controllers/task.controller.js";
import { authenticateUser } from "../middleware/authenticateUser.js";
import { requireRole } from "../middleware/requireRole.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import {
  taskIdParamSchema,
  createTaskSchema,
  updateTaskSchema
} from "../validators/task.validator.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ROLES } from "../constants/roles.js";

export const taskRouter = express.Router();

/**
 * Route registration order is critical:
 * Static paths (/available, /my) must be registered BEFORE parameterized paths (/:id),
 * otherwise Express will match 'available' or 'my' as an ':id' parameter.
 */

// 1. Available tasks for volunteers
taskRouter.get(
  "/available",
  authenticateUser,
  requireRole(ROLES.VOLUNTEER),
  asyncHandler(getAvailableTasks)
);

// 2. Caller's selected tasks
taskRouter.get(
  "/my",
  authenticateUser,
  requireRole(ROLES.VOLUNTEER),
  asyncHandler(getMyTasks)
);

// 3. Coordinator/Admin full task list
taskRouter.get(
  "/",
  authenticateUser,
  requireRole(ROLES.COORDINATOR, ROLES.ADMIN),
  asyncHandler(getTasks)
);

// 4. Create task (Coordinator)
taskRouter.post(
  "/",
  authenticateUser,
  requireRole(ROLES.COORDINATOR),
  validateBody(createTaskSchema),
  asyncHandler(createTask)
);

// 5. Task details by ID (Any authenticated user)
taskRouter.get(
  "/:id",
  authenticateUser,
  validateParams(taskIdParamSchema),
  asyncHandler(getTaskById)
);

// 6. Edit/publish/close task (Coordinator)
taskRouter.put(
  "/:id",
  authenticateUser,
  requireRole(ROLES.COORDINATOR),
  validateParams(taskIdParamSchema),
  validateBody(updateTaskSchema),
  asyncHandler(updateTask)
);

// 7. Choose task (Volunteer)
taskRouter.post(
  "/:id/choose",
  authenticateUser,
  requireRole(ROLES.VOLUNTEER),
  validateParams(taskIdParamSchema),
  asyncHandler(chooseTask)
);
