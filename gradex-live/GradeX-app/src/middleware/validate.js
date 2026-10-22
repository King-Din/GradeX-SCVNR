import { failure } from "../utils/apiResponse.js";
import { ERROR_CODES } from "../constants/errors.js";

function validate(source, label) {
  return (schema) => (req, res, next) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      return failure(
        res,
        400,
        ERROR_CODES.VALIDATION_ERROR,
        result.error.issues[0]?.message ?? `Request ${label} validation failed`,
        result.error.issues.map((issue) => ({ path: issue.path, message: issue.message }))
      );
    }

    // Express 5 makes req.query read-only, so parsed values go on req.valid.
    req.valid = { ...req.valid, [source]: result.data };
    if (source !== "query") req[source] = result.data;
    next();
  };
}

export const validateBody = validate("body", "body");
export const validateParams = validate("params", "parameter");
export const validateQuery = validate("query", "query");
