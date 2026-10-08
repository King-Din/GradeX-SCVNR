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

# API Contract — B3 Task Management & Selection

## GET /api/tasks

Authentication: Required  
Roles: COORDINATOR, ADMIN  
Purpose: Fetch all tasks, including DRAFT, AVAILABLE, and CLOSED.

Success `200`:

```json
{
  "success": true,
  "tasks": [
    {
      "id": "T001",
      "title": "Community Clean-up Drive",
      "description": "Organize local park cleanup",
      "domainId": "D001",
      "deadline": "2026-10-15T00:00:00.000Z",
      "status": "AVAILABLE",
      "createdBy": "U002",
      "createdAt": "2026-10-08T10:00:00.000Z"
    }
  ]
}
```

---

## GET /api/tasks/available

Authentication: Required  
Roles: VOLUNTEER  
Purpose: Fetch tasks available for volunteers to choose (status is AVAILABLE).

Success `200`:

```json
{
  "success": true,
  "tasks": [
    {
      "id": "T001",
      "title": "Community Clean-up Drive",
      "description": "Organize local park cleanup",
      "domainId": "D001",
      "deadline": "2026-10-15T00:00:00.000Z",
      "status": "AVAILABLE",
      "createdBy": "U002",
      "createdAt": "2026-10-08T10:00:00.000Z"
    }
  ]
}
```

---

## GET /api/tasks/:id

Authentication: Required  
Roles: Authenticated (ADMIN, COORDINATOR, VOLUNTEER)  
Purpose: Retrieve details of a specific task.

Success `200`:

```json
{
  "success": true,
  "task": {
    "id": "T001",
    "title": "Community Clean-up Drive",
    "description": "Organize local park cleanup",
    "domainId": "D001",
    "deadline": "2026-10-15T00:00:00.000Z",
    "status": "AVAILABLE",
    "createdBy": "U002",
    "createdAt": "2026-10-08T10:00:00.000Z"
  }
}
```

Failure `404`:

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Task not found"
  }
}
```

---

## POST /api/tasks

Authentication: Required  
Roles: COORDINATOR  
Purpose: Create a new task.

Request body:

```json
{
  "title": "Community Clean-up Drive",
  "description": "Organize local park cleanup",
  "domainId": "D001",
  "deadline": "2026-10-15T00:00:00.000Z",
  "status": "AVAILABLE"
}
```

Success `201`:

```json
{
  "success": true,
  "task": {
    "id": "T001",
    "title": "Community Clean-up Drive",
    "description": "Organize local park cleanup",
    "domainId": "D001",
    "deadline": "2026-10-15T00:00:00.000Z",
    "status": "AVAILABLE",
    "createdBy": "U002",
    "createdAt": "2026-10-08T10:00:00.000Z"
  }
}
```

---

## PUT /api/tasks/:id

Authentication: Required  
Roles: COORDINATOR  
Purpose: Edit task details or transition status (DRAFT → AVAILABLE, AVAILABLE → CLOSED).

Request body:

```json
{
  "status": "AVAILABLE"
}
```

Success `200`:

```json
{
  "success": true,
  "task": {
    "id": "T001",
    "title": "Community Clean-up Drive",
    "description": "Organize local park cleanup",
    "domainId": "D001",
    "deadline": "2026-10-15T00:00:00.000Z",
    "status": "AVAILABLE",
    "createdBy": "U002",
    "createdAt": "2026-10-08T10:00:00.000Z"
  }
}
```

Failure `409`:

```json
{
  "success": false,
  "error": {
    "code": "CONFLICT",
    "message": "Closed tasks cannot be modified to a different status"
  }
}
```

---

## POST /api/tasks/:id/choose

Authentication: Required  
Roles: VOLUNTEER  
Purpose: Select a task. Creates a Participation record. Does not lock the task.  
Request body: No body

Success `201`:

```json
{
  "success": true,
  "participation": {
    "id": "P001",
    "taskId": "T001",
    "volunteerId": "U001",
    "status": "SELECTED"
  }
}
```

Failure `409`:

```json
{
  "success": false,
  "error": {
    "code": "CONFLICT",
    "message": "Task is not available for selection"
  }
}
```

---

## GET /api/tasks/my

Authentication: Required  
Roles: VOLUNTEER  
Purpose: Retrieve caller's selected tasks (participations joined with task details).

Success `200`:

```json
{
  "success": true,
  "participations": [
    {
      "id": "P001",
      "taskId": "T001",
      "volunteerId": "U001",
      "chosenAt": "2026-10-08T10:00:00.000Z",
      "status": "SELECTED",
      "task": {
        "id": "T001",
        "title": "Community Clean-up Drive",
        "description": "Organize local park cleanup",
        "domainId": "D001",
        "deadline": "2026-10-15T00:00:00.000Z",
        "status": "AVAILABLE",
        "createdBy": "U002",
        "createdAt": "2026-10-08T10:00:00.000Z"
      }
    }
  ]
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
| 409 | CONFLICT | Action not allowed in current state or duplicate selection |
| 429 | TOO_MANY_REQUESTS | Rate limit exceeded |
| 500 | INTERNAL_ERROR | Unexpected server failure |

