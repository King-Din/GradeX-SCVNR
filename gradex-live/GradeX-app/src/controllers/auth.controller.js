import bcrypt from "bcrypt";
import {
  changeOwnPassword, chooseCoordinator as chooseOwnCoordinator, chooseDomain as chooseOwnDomain, contextFor, getUserByEmail, markAppInstalled
} from "../services/user.service.js";
import { removeSubscription } from "../services/notify.service.js";
import { signAccessToken } from "../utils/jwt.js";
import { toSafeUser } from "../utils/safeUser.js";
import { success, failure } from "../utils/apiResponse.js";
import { ERROR_CODES } from "../constants/errors.js";
import { USER_STATUS } from "../constants/users.js";

// Compared against when the email is unknown, so both paths take as long.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);

export async function login(req, res) {
  const { email, password } = req.body;
  const user = await getUserByEmail(email);

  const passwordMatches = await bcrypt.compare(password, user?.passwordHash || DUMMY_HASH);

  // Same outward error for unknown email and wrong password.
  if (!user || !user.passwordHash || !passwordMatches) {
    return failure(res, 401, ERROR_CODES.UNAUTHORIZED, "Invalid email or password");
  }

  if (user.status === USER_STATUS.DEACTIVATED) {
    return failure(res, 403, ERROR_CODES.FORBIDDEN, "This account has been deactivated. Contact your coordinator or EB head.");
  }

  const token = signAccessToken(user);

  return success(res, 200, {
    message: "Login successful",
    token,
    user: toSafeUser(user)
  });
}

// `context` names the people above you: your domain, its EB head, your coordinator.
export async function me(req, res) {
  return success(res, 200, { user: req.user, context: await contextFor(req.user) });
}

// Changing the password signs out every older token, including the one used
// for this request, so the response carries a fresh token to continue with.
export async function changePassword(req, res) {
  const user = await changeOwnPassword(req.user, req.body.currentPassword, req.body.newPassword);
  return success(res, 200, { message: "Password changed", token: signAccessToken(user), user: toSafeUser(user) });
}

export async function chooseDomain(req, res) {
  const user = await chooseOwnDomain(req.user, req.body.domainId);
  return success(res, 200, { user, context: await contextFor(user) });
}

export async function appInstalled(req, res) {
  await markAppInstalled(req.user);
  return success(res, 200, { message: "Noted" });
}

export async function chooseCoordinator(req, res) {
  const user = await chooseOwnCoordinator(req.user, req.body.coordinatorId);
  return success(res, 200, { user, context: await contextFor(user) });
}

export async function logout(req, res) {
  // Access tokens are stateless; the client discards the token. If the app
  // sends this device's push endpoint, the device stops getting this
  // person's notifications.
  if (req.body?.endpoint) await removeSubscription(req.user, req.body.endpoint);
  return success(res, 200, {
    message: "Logout successful. Discard the access token on the client."
  });
}
