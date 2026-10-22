import { z } from "zod";

export const idParam = (prefix, label) =>
  z.object({
    id: z.string().regex(new RegExp(`^${prefix}\\d{3,}$`), `Invalid ${label} ID (expected ${prefix}001, ${prefix}002, ...)`)
  }).strict();

export const domainIdSchema = z.string().trim().regex(/^D\d{3,}$/, "Invalid domain ID (expected D001, D002, ...)");
export const userIdSchema = z.string().trim().regex(/^U\d{3,}$/, "Invalid user ID (expected U001, U002, ...)");

// A real date and time with a timezone, e.g. 2026-10-18T23:59:00+05:30.
export const deadlineSchema = z.iso.datetime({
  offset: true,
  error: "Deadline must be a date and time with a timezone, e.g. 2026-10-18T23:59:00+05:30"
});

export const emailSchema = z.string().trim().email().max(254).transform((value) => value.toLowerCase());
// Passwords people reach for first. Compared case-insensitively.
export const COMMON_PASSWORDS = new Set([
  "password", "password1", "password12", "password123", "password1234", "passw0rd", "p@ssw0rd", "p@ssword",
  "12345678", "123456789", "1234567890", "87654321", "11111111", "00000000", "12341234",
  "qwerty123", "qwertyuiop", "qwerty12", "1q2w3e4r", "abc12345", "abcd1234", "iloveyou", "letmein1",
  "welcome1", "welcome123", "admin123", "changeme", "sunshine", "football",
  "streetcause", "streetcause1", "streetcause123", "vnrvjiet", "vnrvjiet123", "gradex", "gradex123"
]);

/*
 * Rules for a NEW password (login accepts whatever is stored, so the demo
 * accounts keep "password123"): 8-72 characters, not a common password, and
 * not containing the email's name part. Returns the problem, or null.
 */
export function passwordProblem(password, email) {
  const value = String(password ?? "");
  if (value.length < 8) return "Password must be at least 8 characters";
  if (value.length > 72) return "Password cannot exceed 72 characters";
  if (COMMON_PASSWORDS.has(value.toLowerCase())) return "That password is too common. Choose something harder to guess.";
  const localPart = String(email ?? "").split("@")[0].toLowerCase();
  if (localPart.length >= 3 && value.toLowerCase().includes(localPart)) return "Your password can't contain your email name";
  return null;
}

export const passwordSchema = z.string().min(8, "Password must be at least 8 characters").max(72)
  .refine((value) => !COMMON_PASSWORDS.has(value.toLowerCase()), "That password is too common. Choose something harder to guess.");
