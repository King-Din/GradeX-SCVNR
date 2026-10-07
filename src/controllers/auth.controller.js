import bcrypt from "bcrypt";
import { getUserByEmail } from "../services/user.service.js";
import { signAccessToken } from "../utils/jwt.js";
import { toSafeUser } from "../utils/safeUser.js";
import { success, failure } from "../utils/apiResponse.js";
import { ERROR_CODES } from "../constants/errors.js";

const BCRYPT_ROUNDS = 12;

export async function login(req, res) {
  const { email, password } = req.body;

  const user = await getUserByEmail(email);

  // Same outward error for unknown email and wrong password.
  if (!user || !user.passwordHash) {
    return failure(
      res,
      401,
      ERROR_CODES.UNAUTHORIZED,
      "Invalid email or password"
    );
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);

  if (!passwordMatches) {
    return failure(
      res,
      401,
      ERROR_CODES.UNAUTHORIZED,
      "Invalid email or password"
    );
  }

  const token = signAccessToken({
    id: user.id,
    role: user.role
  });

  return success(res, 200, {
    message: "Login successful",
    token,
    user: toSafeUser(user)
  });
}

export async function me(req, res) {
  return success(res, 200, {
    user: {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      domainId: req.user.domainId
    }
  });
}

export async function logout(req, res) {
  /*
   * JWT access tokens are stateless in this 5-day scope.
   * The client must discard the token.
   *
   * If the team later adopts token revocation, add a server-side
   * revocation mechanism deliberately rather than inventing one here.
   */
  return success(res, 200, {
    message: "Logout successful. Discard the access token on the client."
  });
}

export async function getUsers(req, res) {
  const { getUsers: fetchUsers } = await import("../services/user.service.js");
  const users = await fetchUsers();

  return success(res, 200, {
    users: users.map(toSafeUser)
  });
}

export async function getUserById(req, res) {
  const { getUserById: fetchUserById } = await import("../services/user.service.js");
  const user = await fetchUserById(req.params.id);

  if (!user) {
    return failure(
      res,
      404,
      ERROR_CODES.NOT_FOUND,
      "User not found"
    );
  }

  return success(res, 200, {
    user: toSafeUser(user)
  });
}

export async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}
