import { ERROR_CODES } from "../constants/errors.js";
import { ROLE_VALUES } from "../constants/roles.js";
import { failure } from "../utils/apiResponse.js";

export function requireRole(...allowedRoles) {
  if (
    allowedRoles.length === 0 ||
    allowedRoles.some((role) => !ROLE_VALUES.includes(role))
  ) {
    throw new Error("requireRole() requires at least one valid role");
  }

  const permitted = new Set(allowedRoles);

  return (req, res, next) => {
    if (!req.user) {
      return failure(
        res,
        401,
        ERROR_CODES.UNAUTHORIZED,
        "Authentication required"
      );
    }

    if (!permitted.has(req.user.role)) {
      return failure(
        res,
        403,
        ERROR_CODES.FORBIDDEN,
        "You do not have permission to access this resource"
      );
    }

    next();
  };
}
