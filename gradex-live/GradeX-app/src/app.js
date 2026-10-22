import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

import { env } from "./config/env.js";
import { authRouter } from "./routes/auth.routes.js";
import { domainRouter, userRouter } from "./routes/user.routes.js";
import { taskRouter } from "./routes/task.routes.js";
import { submissionRouter } from "./routes/submission.routes.js";
import { evaluationRouter, reviewRouter } from "./routes/evaluation.routes.js";
import { reportRouter } from "./routes/report.routes.js";
import { boardRouter, exportRouter, pushRouter } from "./routes/extra.routes.js";
import { success } from "./utils/apiResponse.js";
import { ERROR_CODES } from "./constants/errors.js";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler.js";
import { MAX_UPLOAD_MB } from "./services/file.service.js";

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
    limit: "1mb",
    strict: true,
    type: "application/json"
  })
);

const tooMany = (message) => ({
  success: false,
  error: { code: ERROR_CODES.TOO_MANY_REQUESTS, message }
});

app.use(
  rateLimit({
    windowMs: env.API_RATE_LIMIT_WINDOW_MS,
    limit: env.API_RATE_LIMIT_MAX,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: tooMany("Too many requests. Please try again later.")
  })
);

const loginLimiter = rateLimit({
  windowMs: env.LOGIN_RATE_LIMIT_WINDOW_MS,
  limit: env.LOGIN_RATE_LIMIT_MAX,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  // Per address AND account: one person's typos (or a shared college IP)
  // never lock everyone else out. Needs TRUST_PROXY_HOPS set behind a proxy.
  keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? "")}|${String(req.body?.email ?? "").trim().toLowerCase().slice(0, 254)}`,
  message: tooMany("Too many login attempts. Please try again later.")
});

// API answers are personal (scores, files, exports): never keep them in a
// browser or shared cache, e.g. on a college lab PC.
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

const health = (req, res) => success(res, 200, { service: "task-evaluation-api", status: "ok" });
app.get("/health", health);
app.get("/api/health", health);

// Public settings the app needs before anyone signs in.
app.get("/api/config", (req, res) => success(res, 200, { maxUploadMb: MAX_UPLOAD_MB, demo: env.DEMO_MODE }));

app.use("/api/auth/login", loginLimiter);
app.use("/api/auth", authRouter);
app.use("/api/users", userRouter);
app.use("/api/domains", domainRouter);
app.use("/api/tasks", taskRouter);
app.use("/api/submissions", submissionRouter);
app.use("/api/reviews", reviewRouter);
app.use("/api/evaluations", evaluationRouter);
app.use("/api/reports", reportRouter);
app.use("/api/board", boardRouter);
app.use("/api/export", exportRouter);
app.use("/api/push", pushRouter);

app.use(notFoundHandler);
app.use(errorHandler);
