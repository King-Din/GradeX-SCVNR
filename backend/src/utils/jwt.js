import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

const JWT_ALGORITHM = "HS256";

export function signAccessToken({ id, role }) {
  return jwt.sign(
    { role },
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
