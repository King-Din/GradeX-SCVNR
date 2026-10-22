import express from "express";
import { appInstalled, changePassword, chooseCoordinator, chooseDomain, login, me, logout } from "../controllers/auth.controller.js";
import { authenticateUser } from "../middleware/authenticateUser.js";
import { validateBody } from "../middleware/validate.js";
import { loginSchema } from "../validators/auth.validator.js";
import { appInstalledSchema, changePasswordSchema, chooseCoordinatorSchema, chooseDomainSchema, logoutSchema } from "../validators/me.validator.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const authRouter = express.Router();

authRouter.post("/login", validateBody(loginSchema), asyncHandler(login));
authRouter.get("/me", authenticateUser, asyncHandler(me));
authRouter.post("/logout", authenticateUser, validateBody(logoutSchema), asyncHandler(logout));

// Everyone sets their own password (required while a starting password is in use).
authRouter.post("/change-password", authenticateUser, validateBody(changePasswordSchema), asyncHandler(changePassword));

// Volunteers at first login: their domain (once), then their coordinator (once).
// Choosing the coordinator also sets the domain, so the app needs only this call.
authRouter.post("/domain", authenticateUser, validateBody(chooseDomainSchema), asyncHandler(chooseDomain));
authRouter.post("/coordinator", authenticateUser, validateBody(chooseCoordinatorSchema), asyncHandler(chooseCoordinator));

// The app was opened from the Home Screen (recorded once, for leaders' setup checks).
authRouter.post("/app-installed", authenticateUser, validateBody(appInstalledSchema), asyncHandler(appInstalled));
