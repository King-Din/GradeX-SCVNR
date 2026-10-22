import { z } from "zod";
import { TASK_LEVEL_VALUES, TASK_STATUS } from "../constants/tasks.js";
import { deadlineSchema, domainIdSchema, idParam } from "./common.js";

export const taskIdParamSchema = idParam("T", "task");

const title = z.string().trim().min(1, "Title is required").max(200, "Title cannot exceed 200 characters");
const description = z.string().trim().min(1, "Description is required").max(5000, "Description cannot exceed 5000 characters");

// An EB task (EB heads: their own domain; admins: domainId required).
export const createTaskSchema = z.object({
  title,
  description,
  domainId: domainIdSchema.optional(),
  deadline: deadlineSchema,
  status: z.enum([TASK_STATUS.DRAFT, TASK_STATUS.AVAILABLE]).optional().default(TASK_STATUS.DRAFT)
}).strict();

// A coordinator's own task idea for their team, waiting for the EB head.
export const proposeTaskSchema = z.object({ title, description, deadline: deadlineSchema }).strict();

// "Forward to my team": title and brief default to the EB task's.
export const forwardTaskSchema = z.object({
  title: title.optional(),
  description: description.optional(),
  deadline: deadlineSchema
}).strict();

export const approveTaskSchema = z.object({
  note: z.string().trim().max(1000).optional(),
  deadline: deadlineSchema.optional()
}).strict();

export const rejectTaskSchema = z.object({
  reason: z.string().trim().min(1, "Say why, so the coordinator knows what to change").max(1000)
}).strict();

export const updateTaskSchema = z.object({
  title: z.string().trim().min(1, "Title cannot be empty").max(200, "Title cannot exceed 200 characters").optional(),
  description: z.string().trim().min(1, "Description cannot be empty").max(5000, "Description cannot exceed 5000 characters").optional(),
  domainId: domainIdSchema.optional(),
  deadline: deadlineSchema.optional(),
  status: z.enum([TASK_STATUS.DRAFT, TASK_STATUS.AVAILABLE, TASK_STATUS.CLOSED]).optional()
}).strict().refine((data) => Object.keys(data).length > 0, {
  message: "At least one field must be provided for update"
});

export const levelQuerySchema = z.object({ level: z.enum(TASK_LEVEL_VALUES).optional() }).strict();
