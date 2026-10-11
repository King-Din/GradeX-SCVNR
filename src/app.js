import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import { env } from "./config/env.js";
import { authRouter } from "./routes/auth.routes.js";
import { userRouter } from "./routes/user.routes.js";
import { taskRouter } from "./routes/task.routes.js";
import { failure, success } from "./utils/apiResponse.js";
import { ERROR_CODES } from "./constants/errors.js";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler.js";

export const app = express();

app.disable("x-powered-by");
app.set("trust proxy", env.TRUST_PROXY_HOPS);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "same-site" }
  })
);

app.use(
  cors({
    origin: env.FRONTEND_URL,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false
  })
);

app.use(
  express.json({
    limit: "100kb",
    strict: true,
    type: "application/json"
  })
);

app.use(
  rateLimit({
    windowMs: env.API_RATE_LIMIT_WINDOW_MS,
    limit: env.API_RATE_LIMIT_MAX,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      success: false,
      error: {
        code: ERROR_CODES.TOO_MANY_REQUESTS,
        message: "Too many requests. Please try again later."
      }
    }
  })
);

const loginLimiter = rateLimit({
  windowMs: env.LOGIN_RATE_LIMIT_WINDOW_MS,
  limit: env.LOGIN_RATE_LIMIT_MAX,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    success: false,
    error: {
      code: ERROR_CODES.TOO_MANY_REQUESTS,
      message: "Too many login attempts. Please try again later."
    }
  }
});

app.get("/health", (req, res) => {
  return success(res, 200, {
    service: "task-evaluation-api",
    status: "ok"
  });
});

app.use("/api/auth/login", loginLimiter);
app.use("/api/auth", authRouter);
app.use("/api/users", userRouter);
app.use("/api/tasks", taskRouter);

app.use(notFoundHandler);
app.use(errorHandler);
