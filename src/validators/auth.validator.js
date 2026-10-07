import { z } from "zod";
import { ROLE_VALUES } from "../constants/roles.js";

export const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(72)
}).strict();

export const userIdParamSchema = z.object({
  id: z.string().regex(/^U\d{3,}$/i, "Invalid user ID")
}).strict();

export const userCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(72),
  role: z.enum(ROLE_VALUES),
  domainId: z.string().regex(/^D\d{3,}$/i).nullable().optional()
}).strict();
