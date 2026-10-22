import { z } from "zod";
import { idParam } from "./common.js";

export const evaluationIdParamSchema = idParam("E", "evaluation");

const scoreSchema = z.number().int("Score must be a whole number").min(0, "Score cannot be below 0").max(100, "Score cannot exceed 100");
const feedbackSchema = z.string().trim().min(1, "Feedback is required").max(2000, "Feedback cannot exceed 2000 characters");

export const createEvaluationSchema = z.object({
  submissionId: z.string().regex(/^S\d{3,}$/, "Invalid submission ID"),
  score: scoreSchema,
  feedback: feedbackSchema
}).strict();

export const updateEvaluationSchema = z.object({ score: scoreSchema, feedback: feedbackSchema }).strict();
