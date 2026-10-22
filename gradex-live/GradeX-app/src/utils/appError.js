import { ERROR_CODES } from "../constants/errors.js";

// Thrown by services; errorHandler turns it into the standard error response.
export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
    this.expose = true;
  }
}

export const badRequest = (message) => new AppError(400, ERROR_CODES.VALIDATION_ERROR, message);
export const forbidden = (message = "You do not have permission to do this") => new AppError(403, ERROR_CODES.FORBIDDEN, message);
export const notFound = (message) => new AppError(404, ERROR_CODES.NOT_FOUND, message);
export const conflict = (message) => new AppError(409, ERROR_CODES.CONFLICT, message);
export const tooMany = (message) => new AppError(429, ERROR_CODES.TOO_MANY_REQUESTS, message);
export const busy = (message = "The server is busy, try again") => new AppError(503, ERROR_CODES.SERVICE_BUSY, message);
