import { z } from "zod";
import { ROLE_VALUES } from "../constants/roles.js";
import { USER_STATUS_VALUES } from "../constants/users.js";
import { domainIdSchema, emailSchema, idParam, passwordProblem, passwordSchema, userIdSchema } from "./common.js";

export const userIdParamSchema = idParam("U", "user");
export const domainIdParamSchema = z.object({ id: domainIdSchema }).strict();

const personFields = {
  name: z.string().trim().min(1).max(100),
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(ROLE_VALUES),
  domainId: domainIdSchema.nullable().optional(),
  // Volunteers: their coordinator (a Coordinator in the same domain), or none
  // yet to choose at first login.
  coordinatorId: userIdSchema.nullable().optional()
};

const checkPassword = (data, ctx) => {
  const problem = passwordProblem(data.password, data.email);
  if (problem) ctx.addIssue({ code: "custom", path: ["password"], message: problem });
};

export const createUserSchema = z.object(personFields).strict().superRefine(checkPassword);

// Imports may name the coordinator by email (a coordinator in the same batch is fine).
// The starting password is checked per person by the import itself, so one
// row it doesn't suit (say, it contains their email name) doesn't stop the rest.
const importRowSchema = z.object({
  ...personFields,
  password: z.string().min(1, "Choose a starting password").max(72),
  coordinatorEmail: z.union([emailSchema, z.literal("")]).nullable().optional().transform((value) => value || null)
}).strict();

export const importUsersSchema = z.object({
  users: z.array(importRowSchema).min(1).max(500)
}).strict();

export const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  email: emailSchema.optional(),
  role: z.enum(ROLE_VALUES).optional(),
  domainId: domainIdSchema.nullable().optional(),
  coordinatorId: userIdSchema.nullable().optional(),
  status: z.enum(USER_STATUS_VALUES).optional()
}).strict().refine((data) => Object.keys(data).length > 0, { message: "Change at least one field" });

export const resetPasswordSchema = z.object({ password: passwordSchema }).strict();
