import { ERROR_CODES } from "../constants/errors.js";
import { USER_STATUS } from "../constants/users.js";
import { failure } from "../utils/apiResponse.js";
import { verifyAccessToken } from "../utils/jwt.js";
import { getUserById } from "../services/user.service.js";
import * as store from "../data/store.js";

const PASSWORD_CHANGE_ALLOWED = new Set(["/api/auth/me", "/api/auth/logout", "/api/auth/change-password"]);

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
      return failure(res, 401, ERROR_CODES.UNAUTHORIZED, "Invalid or expired authentication token");
    }

    const userId = typeof payload.sub === "string" ? payload.sub : null;
    const tokenRole = typeof payload.role === "string" ? payload.role : null;

    if (!userId || !tokenRole) {
      return failure(res, 401, ERROR_CODES.UNAUTHORIZED, "Invalid authentication token");
    }

    const tokenVersion = Number.isInteger(payload.tv) ? payload.tv : 0;
    const problem = (u) => {
      // Deactivated accounts lose access immediately, even with a valid token.
      if (!u || u.status === USER_STATUS.DEACTIVATED) return "User account is not available";
      // The current backend record is authoritative. A role change immediately
      // invalidates previously issued tokens in every environment.
      if (u.role !== tokenRole) return "Authentication token is no longer valid";
      // Password change/reset, role change and deactivation bump tokenVersion.
      if (tokenVersion !== (Number(u.tokenVersion) || 0)) return "Authentication token is no longer valid";
      return null;
    };

    let user = await getUserById(userId);
    // Hosted instances share recent reads for a few seconds: before turning
    // someone away (say, just after they changed their password elsewhere),
    // check the latest copy.
    if (problem(user)) {
      await store.refresh("Users");
      user = await getUserById(userId);
    }
    const rejected = problem(user);
    if (rejected) return failure(res, 401, ERROR_CODES.UNAUTHORIZED, rejected);

    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      domainId: user.domainId ?? null,
      coordinatorId: user.coordinatorId ?? null,
      status: user.status ?? USER_STATUS.ACTIVE,
      mustChangePassword: Boolean(user.mustChangePassword)
    };

    // Until a shared starting password is replaced, only these routes work.
    if (req.user.mustChangePassword && !PASSWORD_CHANGE_ALLOWED.has(req.originalUrl.split("?")[0])) {
      return failure(res, 403, ERROR_CODES.PASSWORD_CHANGE_REQUIRED, "Set your own password before continuing");
    }

    next();
  } catch (error) {
    next(error);
  }
}
