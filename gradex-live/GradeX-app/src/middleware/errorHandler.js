import multer from "multer";
import { failure } from "../utils/apiResponse.js";
import { ERROR_CODES } from "../constants/errors.js";
import { AppError } from "../utils/appError.js";
import { MAX_UPLOAD_MB } from "../services/file.service.js";

export function notFoundHandler(req, res) {
  return failure(res, 404, ERROR_CODES.NOT_FOUND, "Route not found");
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  if (error instanceof AppError) {
    return failure(res, error.status, error.code, error.message);
  }

  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return failure(res, 413, ERROR_CODES.VALIDATION_ERROR, `That file is too large. The limit is ${MAX_UPLOAD_MB} MB.`);
    }
    if (error.code === "LIMIT_FIELD_COUNT" || error.code === "LIMIT_FIELD_VALUE") {
      return failure(res, 400, ERROR_CODES.VALIDATION_ERROR, "Send only taskId and a file or link");
    }
    return failure(res, 400, ERROR_CODES.VALIDATION_ERROR, "Upload one file in the \"file\" field");
  }

  if (error?.type === "entity.too.large") {
    return failure(res, 413, ERROR_CODES.VALIDATION_ERROR, "Request body is too large");
  }

  if (error?.type === "entity.parse.failed") {
    return failure(res, 400, ERROR_CODES.VALIDATION_ERROR, "Malformed JSON request body");
  }

  // Keep detailed diagnostics server-side only. Never serialize stack traces,
  // API errors, secrets, or internal paths into responses.
  console.error(error?.stack || error);

  return failure(
    res,
    Number.isInteger(error?.status) && error.status >= 400 && error.status < 500 ? error.status : 500,
    error?.status === 429 ? ERROR_CODES.TOO_MANY_REQUESTS : ERROR_CODES.INTERNAL_ERROR,
    error?.status === 429 ? "Too many requests. Please try again later." : "An unexpected error occurred"
  );
}
