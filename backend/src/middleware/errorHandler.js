import { failure } from "../utils/apiResponse.js";
import { ERROR_CODES } from "../constants/errors.js";

export function notFoundHandler(req, res) {
  return failure(
    res,
    404,
    ERROR_CODES.NOT_FOUND,
    "Route not found"
  );
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  // Keep detailed diagnostics server-side only. Never serialize stack traces,
  // SQL/API errors, secrets, or internal paths into production responses.
  console.error(error?.stack || error);

  if (error?.type === "entity.too.large") {
    return failure(
      res,
      413,
      ERROR_CODES.VALIDATION_ERROR,
      "Request body is too large"
    );
  }

  if (error?.type === "entity.parse.failed") {
    return failure(
      res,
      400,
      ERROR_CODES.VALIDATION_ERROR,
      "Malformed JSON request body"
    );
  }

  return failure(
    res,
    Number.isInteger(error?.status) && error.status >= 400 && error.status < 500
      ? error.status
      : 500,
    error?.status === 429 ? ERROR_CODES.TOO_MANY_REQUESTS : ERROR_CODES.INTERNAL_ERROR,
    error?.status === 429
      ? "Too many requests. Please try again later."
      : "An unexpected error occurred"
  );
}
