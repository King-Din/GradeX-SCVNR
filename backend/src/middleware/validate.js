import { failure } from "../utils/apiResponse.js";
import { ERROR_CODES } from "../constants/errors.js";

export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      return failure(
        res,
        400,
        ERROR_CODES.VALIDATION_ERROR,
        "Request body validation failed",
        result.error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message
        }))
      );
    }

    req.body = result.data;
    next();
  };
}

export function validateParams(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.params);

    if (!result.success) {
      return failure(
        res,
        400,
        ERROR_CODES.VALIDATION_ERROR,
        "Request parameter validation failed",
        result.error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message
        }))
      );
    }

    req.params = result.data;
    next();
  };
}
