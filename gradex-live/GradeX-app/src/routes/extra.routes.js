import express from "express";
import { authenticateUser } from "../middleware/authenticateUser.js";
import { requireRole } from "../middleware/requireRole.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { boardQuerySchema, pushSubscriptionSchema, pushUnsubscribeSchema } from "../validators/me.validator.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { success } from "../utils/apiResponse.js";
import { ROLES } from "../constants/roles.js";
import { domainBoard } from "../services/board.service.js";
import { buildExport } from "../services/export.service.js";
import { publicKey, pushEnabled, removeSubscription, saveSubscription } from "../services/notify.service.js";
import { istDate } from "../utils/time.js";

// Board: a team's (or the domain's coordinators') finished work, scores and leaderboard.
export const boardRouter = express.Router();
boardRouter.get(
  "/",
  authenticateUser,
  validateQuery(boardQuerySchema),
  asyncHandler(async (req, res) => success(res, 200, await domainBoard(req.user, req.valid.query)))
);

// Excel download: admins everything, EB heads their domain, coordinators their team.
export const exportRouter = express.Router();
exportRouter.get(
  "/",
  authenticateUser,
  requireRole(ROLES.ADMIN, ROLES.EB, ROLES.COORDINATOR),
  asyncHandler(async (req, res) => {
    const file = await buildExport(req.user);
    const stamp = istDate();
    res.attachment(`GradeX-${stamp}.xlsx`)
      .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .send(file);
  })
);

// Phone notifications.
export const pushRouter = express.Router();
pushRouter.get("/key", authenticateUser, (req, res) => success(res, 200, { enabled: pushEnabled(), publicKey: publicKey() }));
pushRouter.post(
  "/subscribe",
  authenticateUser,
  validateBody(pushSubscriptionSchema),
  asyncHandler(async (req, res) => {
    await saveSubscription(req.user, req.body);
    return success(res, 201, { message: "Notifications are on for this device" });
  })
);
pushRouter.post(
  "/unsubscribe",
  authenticateUser,
  validateBody(pushUnsubscribeSchema),
  asyncHandler(async (req, res) => {
    await removeSubscription(req.user, req.body.endpoint);
    return success(res, 200, { message: "Notifications are off for this device" });
  })
);
