import { z } from "zod";

export const createEvaluationSchema = z.object({
  submissionId: z.string().regex(/^S\d{3,}$/, "Invalid submission ID"),
  score: z.number().min(0, "Score cannot be below 0").max(100, "Score cannot exceed 100"),
  feedback: z
    .string()
    .trim()
    .min(1, "Feedback is required")
    .max(2000, "Feedback cannot exceed 2000 characters")
}).strict();

export const evaluationIdParamSchema = z.object({
  id: z.string().regex(/^E\d{3,}$/, "Invalid evaluation ID")
}).strict();
