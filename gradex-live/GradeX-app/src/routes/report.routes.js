import express from "express";
import { getPeopleReport } from "../controllers/report.controller.js";
import { authenticateUser } from "../middleware/authenticateUser.js";
import { requireRole } from "../middleware/requireRole.js";
import { validateQuery } from "../middleware/validate.js";
import { reportQuerySchema } from "../validators/report.validator.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ROLES } from "../constants/roles.js";

export const reportRouter = express.Router();

// Who's showing up: on-time / late / missed record and standing per person.
// Admins: everyone; EB heads: their domain's coordinators and volunteers;
// coordinators: their own volunteers. /volunteers is the older path.
for (const path of ["/people", "/volunteers"]) {
  reportRouter.get(
    path,
    authenticateUser,
    requireRole(ROLES.ADMIN, ROLES.EB, ROLES.COORDINATOR),
    validateQuery(reportQuerySchema),
    asyncHandler(getPeopleReport)
  );
}
