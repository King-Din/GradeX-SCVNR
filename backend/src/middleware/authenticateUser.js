import { ERROR_CODES } from "../constants/errors.js";
import { failure } from "../utils/apiResponse.js";
import { verifyAccessToken } from "../utils/jwt.js";
import { getUserById } from "../services/user.service.js";

function extractBearerToken(headerValue) {
  if (!headerValue) return null;

  const match = /^Bearer\s+([^\s]+)$/i.exec(headerValue.trim());
  return match?.[1] || null;
}

export async function authenticateUser(req, res, next) {
  try {
    const token = extractBearerToken(req.get("Authorization"));

    if (!token) {
      return failure(res, 401, ERROR_CODES.UNAUTHORIZED, "Authentication required");
    }

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      return failure(
        res,
        401,
        ERROR_CODES.UNAUTHORIZED,
        "Invalid or expired authentication token"
      );
    }

    const userId = typeof payload.sub === "string" ? payload.sub : null;
    const tokenRole = typeof payload.role === "string" ? payload.role : null;

    if (!userId || !tokenRole) {
      return failure(res, 401, ERROR_CODES.UNAUTHORIZED, "Invalid authentication token");
    }

    const user = await getUserById(userId);

    if (!user) {
      return failure(res, 401, ERROR_CODES.UNAUTHORIZED, "User account is not available");
    }

    // The current backend record is authoritative. A role change immediately
    // invalidates previously issued tokens in every environment.
    if (user.role !== tokenRole) {
      return failure(
        res,
        401,
        ERROR_CODES.UNAUTHORIZED,
        "Authentication token is no longer valid"
      );
    }

    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      domainId: user.domainId ?? null
    };

    next();
  } catch (error) {
    next(error);
  }
}
