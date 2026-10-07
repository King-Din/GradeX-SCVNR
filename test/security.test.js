import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "a".repeat(64);
process.env.JWT_EXPIRES_IN = "1h";

const { signAccessToken, verifyAccessToken } = await import("../src/utils/jwt.js");
const { toSafeUser } = await import("../src/utils/safeUser.js");
const { sanitizeSpreadsheetCell, sanitizeSpreadsheetRow } = await import("../src/utils/spreadsheet.js");
const { loginSchema, userIdParamSchema } = await import("../src/validators/auth.validator.js");
const { requireRole } = await import("../src/middleware/requireRole.js");

 test("JWT rejects tampering and accepts only the configured algorithm/claims", () => {
  const token = signAccessToken({ id: "U001", role: "VOLUNTEER" });
  const payload = verifyAccessToken(token);

  assert.equal(payload.sub, "U001");
  assert.equal(payload.role, "VOLUNTEER");
  assert.throws(() => verifyAccessToken(`${token.slice(0, -1)}x`));
});

test("safe user output is an explicit allowlist", () => {
  const safe = toSafeUser({
    id: "U001",
    name: "A",
    email: "a@example.com",
    role: "VOLUNTEER",
    domainId: "D001",
    passwordHash: "secret",
    resetToken: "reset",
    apiKey: "key"
  });

  assert.deepEqual(safe, {
    id: "U001",
    name: "A",
    email: "a@example.com",
    role: "VOLUNTEER",
    domainId: "D001"
  });
});

test("spreadsheet formula prefixes are neutralized", () => {
  assert.equal(sanitizeSpreadsheetCell("=SUM(A1:A2)"), "'=SUM(A1:A2)");
  assert.equal(sanitizeSpreadsheetCell("+cmd"), "'+cmd");
  assert.equal(sanitizeSpreadsheetCell("-cmd"), "'-cmd");
  assert.equal(sanitizeSpreadsheetCell("@cmd"), "'@cmd");
  assert.equal(sanitizeSpreadsheetCell("normal"), "normal");
  assert.deepEqual(sanitizeSpreadsheetRow(["=1", "normal", 42]), ["'=1", "normal", 42]);
});

test("authentication schemas reject unknown fields and malformed IDs", () => {
  assert.equal(loginSchema.safeParse({ email: "A@EXAMPLE.COM", password: "password", role: "ADMIN" }).success, false);
  assert.equal(loginSchema.safeParse({ email: "A@EXAMPLE.COM", password: "password" }).success, true);
  assert.equal(userIdParamSchema.safeParse({ id: "bad" }).success, false);
  assert.equal(userIdParamSchema.safeParse({ id: "U123" }).success, true);
});

test("requireRole rejects unknown roles at route definition time", () => {
  assert.throws(() => requireRole("SUPERADMIN"));
});
