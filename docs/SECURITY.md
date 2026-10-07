# B1 Security Checklist

## Authentication

- [ ] Login requires email and password.
- [ ] Passwords are compared using bcrypt.
- [ ] Password hashes are never returned.
- [ ] JWT is signed with an environment-only secret.
- [ ] JWT algorithm is explicitly restricted to HS256.
- [ ] JWT issuer is checked.
- [ ] JWT audience is checked.
- [ ] JWT expiry is checked.
- [ ] Missing JWT returns 401.
- [ ] Invalid JWT returns 401.
- [x] Expired JWT returns 401.
- [x] A token whose embedded role differs from the current user record is rejected in every environment.

## Authorization

- [ ] Coordinator-only routes use `requireRole("COORDINATOR")`.
- [ ] Admin-only routes use `requireRole("ADMIN")`.
- [ ] Shared admin/coordinator routes use both roles.
- [ ] Client-supplied role is never trusted.
- [ ] Client-supplied identity is never trusted for authorization.

## HTTP security

- [ ] Helmet enabled.
- [x] CORS restricted to frontend origin.
- [ ] JSON body size limited.
- [ ] API rate limit enabled.
- [ ] Login rate limit enabled.
- [x] x-powered-by disabled.
- [x] Express only trusts explicitly configured reverse-proxy hops.

## Secrets

- [ ] `.env` ignored by Git.
- [ ] `.env.example` contains no real secrets.
- [ ] JWT secret is not in source code.
- [x] Google credentials are not in B1.
- [x] Spreadsheet formula-injection sanitizers are provided for B2 before writing untrusted strings to cells.
- [x] B2 integration must own bounded retries/backoff and quota handling; B1 does not perform direct Sheets calls.
- [ ] No secrets sent to React.

## Required negative tests

1. No Authorization header -> 401.
2. Modified JWT -> 401.
3. Expired JWT -> 401.
4. Volunteer -> coordinator endpoint -> 403.
5. Malformed body -> 400.
6. Invalid user ID -> 400.
7. User API response contains no passwordHash.
8. Login with wrong password -> 401.
9. Login with unknown email -> 401.
10. A stale token with a changed role is rejected in production.
