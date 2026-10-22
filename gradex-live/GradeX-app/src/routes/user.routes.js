import express from "express";
import * as users from "../controllers/user.controller.js";
import { authenticateUser } from "../middleware/authenticateUser.js";
import { requireRole } from "../middleware/requireRole.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import { decisionSchema } from "../validators/me.validator.js";
import {
  createUserSchema,
  domainIdParamSchema,
  importUsersSchema,
  resetPasswordSchema,
  updateUserSchema,
  userIdParamSchema
} from "../validators/user.validator.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ROLES } from "../constants/roles.js";

export const userRouter = express.Router();
export const domainRouter = express.Router();

const STAFF = [ROLES.ADMIN, ROLES.EB, ROLES.COORDINATOR];

userRouter.use(authenticateUser);

// Admins see everyone; EB heads their domain; coordinators their own team.
userRouter.get("/", requireRole(...STAFF), asyncHandler(users.listUsers));

// Accounts are managed by admins only.
userRouter.post("/", requireRole(ROLES.ADMIN), validateBody(createUserSchema), asyncHandler(users.createUser));

userRouter.post("/import", requireRole(ROLES.ADMIN), validateBody(importUsersSchema), asyncHandler(users.importUsers));

userRouter.get("/:id", requireRole(...STAFF), validateParams(userIdParamSchema), asyncHandler(users.getUser));

// Admins change anything; EB heads (de)activate and move volunteers between
// their domain's coordinators; coordinators (de)activate their own volunteers.
userRouter.patch(
  "/:id",
  requireRole(...STAFF),
  validateParams(userIdParamSchema),
  validateBody(updateUserSchema),
  asyncHandler(users.updateUser)
);

// Keep / Warn / Remove + private note on a coordinator or volunteer (staff only).
userRouter.put(
  "/:id/decision",
  requireRole(...STAFF),
  validateParams(userIdParamSchema),
  validateBody(decisionSchema),
  asyncHandler(users.setDecision)
);

userRouter.post(
  "/:id/reset-password",
  requireRole(ROLES.ADMIN),
  validateParams(userIdParamSchema),
  validateBody(resetPasswordSchema),
  asyncHandler(users.resetPassword)
);

domainRouter.use(authenticateUser);
domainRouter.get("/", asyncHandler(users.listDomains));
// Basic facts about every domain, for admins and EB heads (before /:id).
domainRouter.get("/overview", requireRole(ROLES.ADMIN, ROLES.EB), asyncHandler(users.domainsOverview));
// Names of a domain's coordinators, for a volunteer's first-login choice.
domainRouter.get("/:id/coordinators", validateParams(domainIdParamSchema), asyncHandler(users.listDomainCoordinators));
