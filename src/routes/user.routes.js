import express from "express";
import {
  getUsers,
  getUserById
} from "../controllers/auth.controller.js";
import { authenticateUser } from "../middleware/authenticateUser.js";
import { requireRole } from "../middleware/requireRole.js";
import { validateParams } from "../middleware/validate.js";
import { userIdParamSchema } from "../validators/auth.validator.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ROLES } from "../constants/roles.js";

export const userRouter = express.Router();

userRouter.get(
  "/",
  authenticateUser,
  requireRole(ROLES.ADMIN, ROLES.COORDINATOR),
  asyncHandler(getUsers)
);

userRouter.get(
  "/:id",
  authenticateUser,
  requireRole(ROLES.ADMIN, ROLES.COORDINATOR),
  validateParams(userIdParamSchema),
  asyncHandler(getUserById)
);
