import { z } from "zod";
import { domainIdSchema, userIdSchema } from "./common.js";

export const reportQuerySchema = z.object({
  domainId: domainIdSchema.optional(),
  coordinatorId: userIdSchema.optional(),
  role: z.enum(["COORDINATOR", "VOLUNTEER"]).optional()
}).strict();
