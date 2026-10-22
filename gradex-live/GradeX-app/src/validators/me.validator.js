import { z } from "zod";
import { DECISION_VALUES } from "../constants/users.js";
import { TASK_LEVEL_VALUES } from "../constants/tasks.js";
import { domainIdSchema, passwordSchema, userIdSchema } from "./common.js";

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password").max(72),
  newPassword: passwordSchema
}).strict();

export const chooseDomainSchema = z.object({ domainId: domainIdSchema }).strict();

export const chooseCoordinatorSchema = z.object({ coordinatorId: userIdSchema }).strict();

export const appInstalledSchema = z.object({}).strict();

export const decisionSchema = z.object({
  decision: z.enum(DECISION_VALUES).nullable(),
  note: z.string().max(1000).optional()
}).strict();

// A team board (coordinatorId) or a domain's coordinators' board (domainId, level DOMAIN).
export const boardQuerySchema = z.object({
  domainId: domainIdSchema.optional(),
  coordinatorId: userIdSchema.optional(),
  level: z.enum(TASK_LEVEL_VALUES).optional()
}).strict();

export const pushSubscriptionSchema = z.object({
  endpoint: z.url().max(2000),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) })
}).strict();

export const pushUnsubscribeSchema = z.object({ endpoint: z.url().max(2000) }).strict();

// Logging out can also switch notifications off for this device.
export const logoutSchema = z.object({ endpoint: z.url().max(2000).optional() }).strict().optional();
