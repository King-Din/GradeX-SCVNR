import { z } from "zod";
import { TASK_STATUS, TASK_STATUS_VALUES } from "../constants/tasks.js";

export const taskIdParamSchema = z.object({
  id: z.string().regex(/^T\d{3,}$/i, "Invalid task ID format (expected T001, T002, etc.)")
}).strict();

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200, "Title cannot exceed 200 characters"),
  description: z.string().trim().min(1, "Description is required").max(5000, "Description cannot exceed 5000 characters"),
  domainId: z.string().trim().regex(/^D\d{3,}$/i, "Invalid domain ID format (expected D001, D002, etc.)"),
  deadline: z.string().trim().min(1, "Deadline is required"),
  status: z.enum([TASK_STATUS.DRAFT, TASK_STATUS.AVAILABLE]).optional().default(TASK_STATUS.DRAFT)
}).strict();

export const updateTaskSchema = z.object({
  title: z.string().trim().min(1, "Title cannot be empty").max(200, "Title cannot exceed 200 characters").optional(),
  description: z.string().trim().min(1, "Description cannot be empty").max(5000, "Description cannot exceed 5000 characters").optional(),
  domainId: z.string().trim().regex(/^D\d{3,}$/i, "Invalid domain ID format").optional(),
  deadline: z.string().trim().min(1, "Deadline cannot be empty").optional(),
  status: z.enum([TASK_STATUS.DRAFT, TASK_STATUS.AVAILABLE, TASK_STATUS.CLOSED]).optional()
}).strict().refine((data) => Object.keys(data).length > 0, {
  message: "At least one field must be provided for update"
});
