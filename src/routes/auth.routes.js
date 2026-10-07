import express from "express";
import { login, me, logout } from "../controllers/auth.controller.js";
import { authenticateUser } from "../middleware/authenticateUser.js";
import { validateBody } from "../middleware/validate.js";
import { loginSchema } from "../validators/auth.validator.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const authRouter = express.Router();

authRouter.post(
  "/login",
  validateBody(loginSchema),
  asyncHandler(login)
);

authRouter.get(
  "/me",
  authenticateUser,
  asyncHandler(me)
);

authRouter.post(
  "/logout",
  authenticateUser,
  asyncHandler(logout)
);
