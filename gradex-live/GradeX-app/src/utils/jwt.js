import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

const JWT_ALGORITHM = "HS256";

// `tv` is the user's tokenVersion: bumping it on the user signs out every
// token issued before (password change/reset, role change, deactivation).
export function signAccessToken({ id, role, tokenVersion = 0 }) {
  return jwt.sign(
    { role, tv: Number(tokenVersion) || 0 },
    env.JWT_SECRET,
    {
      subject: id,
      expiresIn: env.JWT_EXPIRES_IN,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      algorithm: JWT_ALGORITHM
    }
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_SECRET, {
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    algorithms: [JWT_ALGORITHM]
  });
}
