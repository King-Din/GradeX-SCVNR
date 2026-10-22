import { z } from "zod";
import { emailSchema } from "./common.js";

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(72)
}).strict();
