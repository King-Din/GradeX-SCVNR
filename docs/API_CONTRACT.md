# API Contract — B1

Base URL:

```text
http://localhost:5000
```

Production base URL will be supplied by S2.

---

## POST /api/auth/login

Authentication: Public

Request:

```json
{
  "email": "volunteer@example.com",
  "password": "password123"
}
```

Success `200`:

```json
{
  "success": true,
  "message": "Login successful",
  "token": "<JWT>",
  "user": {
    "id": "U001",
    "name": "Volunteer One",
    "email": "volunteer@example.com",
    "role": "VOLUNTEER",
    "domainId": "D001"
  }
}
```

Failure `400`:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request body validation failed"
  }
}
```

Failure `401`:

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid email or password"
  }
}
```

---

## GET /api/auth/me

Authentication: Required

Header:

```text
Authorization: Bearer <JWT>
```

Success `200`:

```json
{
  "success": true,
  "user": {
    "id": "U001",
    "name": "Volunteer One",
    "email": "volunteer@example.com",
    "role": "VOLUNTEER",
    "domainId": "D001"
  }
}
```

---

## POST /api/auth/logout

Authentication: Required

Success `200`:

```json
{
  "success": true,
  "message": "Logout successful. Discard the access token on the client."
}
```

---

## GET /api/users

Authentication: Required

Roles:

- ADMIN
- COORDINATOR

Success `200`:

```json
{
  "success": true,
  "users": [
    {
      "id": "U001",
      "name": "Volunteer One",
      "email": "volunteer@example.com",
      "role": "VOLUNTEER",
      "domainId": "D001"
    }
  ]
}
```

Never return `passwordHash`.

---

## GET /api/users/:id

Authentication: Required

Roles:

- ADMIN
- COORDINATOR

Success `200`:

```json
{
  "success": true,
  "user": {
    "id": "U001",
    "name": "Volunteer One",
    "email": "volunteer@example.com",
    "role": "VOLUNTEER",
    "domainId": "D001"
  }
}
```

---

## Standard errors

| Status | Code | Meaning |
|---:|---|---|
| 400 | VALIDATION_ERROR | Invalid request |
| 401 | UNAUTHORIZED | Missing/invalid/expired authentication |
| 403 | FORBIDDEN | Authenticated but insufficient role |
| 404 | NOT_FOUND | Resource does not exist |
| 429 | TOO_MANY_REQUESTS | Rate limit exceeded |
| 500 | INTERNAL_ERROR | Unexpected server failure |
