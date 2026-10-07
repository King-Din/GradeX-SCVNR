# Task Evaluation System — B1 Authentication Module

This is the B1 workstream for:

**Authentication + User Management + RBAC**

## Prerequisites

- Node.js 18+
- npm
- Git
- B2 Google Sheets service available for integrated operation

## Install

```bash
npm install
```

Copy:

```text
.env.example -> .env
```

Set a strong `JWT_SECRET` with at least 32 characters.

## Run

```bash
npm run dev
```

API:

```text
http://localhost:5000
```

Health:

```text
GET http://localhost:5000/health
```

## Important integration note

B1 deliberately does not implement Google Sheets calls.

B2 owns the shared Sheets service. Before integration, B2 must replace:

```text
src/services/sheets.service.js
```

with the real Google Sheets-backed implementation exposing:

```js
getUserById(id)
getUserByEmail(email)
getUsers()
```

Do not add Google credentials to this module.

## Routes

```text
POST /api/auth/login
GET  /api/auth/me
POST /api/auth/logout

GET /api/users
GET /api/users/:id
```

## Middleware for other backend modules

```js
import { authenticateUser } from "./middleware/authenticateUser.js";
import { requireRole } from "./middleware/requireRole.js";

router.post(
  "/tasks",
  authenticateUser,
  requireRole("COORDINATOR"),
  handler
);
```

For volunteer routes:

```js
router.post(
  "/submissions",
  authenticateUser,
  requireRole("VOLUNTEER"),
  handler
);
```

Authenticated identity:

```js
req.user.id
req.user.role
```

Never accept identity for authorization from:

```js
req.body.userId
req.body.volunteerId
req.body.evaluatorId
```

## Testing

Import:

```text
postman/B1.postman_collection.json
```

Then run the authentication and authorization checks listed in:

```text
docs/SECURITY.md
```

## Git

Recommended branch:

```text
auth
```

Commit small working changes and open a PR after local testing.

## Security hardening

- Set a cryptographically random `JWT_SECRET`; production requires at least 43 characters and rejects placeholder values.
- Keep `JWT_EXPIRES_IN` at 24 hours or less (the default is `1h`).
- If the API is behind a reverse proxy, set `TRUST_PROXY_HOPS` to the exact number of trusted proxy hops. Leave it at `0` otherwise.
- Never put Google service-account keys, `.env` files, or other credentials in this repository.
- B2 must call `sanitizeSpreadsheetCell`/`sanitizeSpreadsheetRow` before writing untrusted text to Google Sheets and must use bounded retries/backoff for quota/rate-limit errors.
