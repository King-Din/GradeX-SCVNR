# API contract

Base URL: `http://localhost:5000` in development.

Every response is JSON. Success: `{ "success": true, ... }`. Failure:

```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "Readable reason", "details": [] } }
```

| Status | Code | Meaning |
|---:|---|---|
| 400 | VALIDATION_ERROR | Invalid input; `message` says what to fix |
| 401 | UNAUTHORIZED | Missing, invalid or expired token, or account no longer available |
| 403 | FORBIDDEN | Signed in but not allowed (e.g. wrong role, deactivated at login) |
| 404 | NOT_FOUND | Doesn't exist, or outside your scope |
| 409 | CONFLICT | Not allowed in the current state (already picked, already scored, closed) |
| 413 | VALIDATION_ERROR | Upload over `MAX_UPLOAD_MB` (default 10 MB) |
| 429 | TOO_MANY_REQUESTS | Rate limit, or another upload of yours still in progress |
| 503 | SERVICE_BUSY | "The server is busy, try again": a save waited more than 20 s |

All routes except login, health and config need `Authorization: Bearer <token>`.

## Public

| Method | Path | Notes |
|---|---|---|
| GET | /health, /api/health | `{ service, status: "ok" }` (no storage details) |
| GET | /api/config | `{ maxUploadMb, demo }`: the upload limit and whether this is a demo (DEMO_MODE) |
## Roles and scope

| Role | Who | Scope |
|---|---|---|
| ADMIN | The app owner and the divisional president (at most 2 active) | Everything, every domain, every account |
| EB | The head of exactly one domain (`domainId`; one active EB per domain) | Basic facts of every domain; their own domain in depth: its EB tasks (publish, edit, close, score the coordinators' final work), proposals (approve/reject), its team tasks and team scores (view only), people, standings, decisions, Excel |
| COORDINATOR | One domain (`domainId`), with a team of volunteers | The domain's published EB tasks (pick, forward to the team, submit final work); their own team tasks (edit, close, score); their own volunteers |
| VOLUNTEER | One coordinator's team (`coordinatorId`; `domainId` follows the coordinator) | Their coordinator's published team tasks; their own picks, submissions and scores; their team's board |

Tasks have a `level`:
- **DOMAIN** ("EB task"): published by the EB head (or an admin) to the domain's coordinators.
  A coordinator picks it, then does it alone or forwards it to the team, and submits the final
  work, which the EB head scores.
- **TEAM** ("team task"): owned by one coordinator (`ownerId`) for their own volunteers, either
  forwarded from an EB task (`parentTaskId`) or a coordinator's proposal approved by the EB head.
  Volunteers pick it and submit; the coordinator scores.

Out-of-scope records answer 404, so the API never confirms they exist.

## Objects

**User** `{ id, name, email, role, domainId, coordinatorId, status, mustChangePassword }`, where role is
ADMIN, EB, COORDINATOR or VOLUNTEER and status is ACTIVE or DEACTIVATED. Staff lists add
`createdAt, decision, decisionNote, decisionBy, decisionAt`.

**Task** `{ id, title, description, domainId, deadline, status, level, parentTaskId, ownerId, reviewNote, reviewedBy, reviewedAt, createdBy, createdAt, counts, owner, creator, reviewer, parent, forwards }`.
Status is DRAFT, AVAILABLE, CLOSED, PROPOSED or REJECTED. `counts` is `{ picked, submitted, scored, late }`;
`owner`/`creator`/`reviewer` are `{ id, name }`; `parent` is the EB task a team task came from;
`forwards` is how many coordinators forwarded an EB task. For coordinators, each EB task also has
`mine: { picked, participationId, pickedAt, submission, evaluation, outcome, teamTask }`, their own
progress (with the team task they forwarded, `{ id, title, deadline, status, counts }`).
Deadlines are ISO date-times with a timezone.

**Submission** `{ id, participationId, taskId, volunteerId, kind, fileId, fileUrl, fileName, linkUrl, isLate, submittedAt, updatedAt }`.
Kind is FILE or LINK. `volunteerId` is whoever submitted it (a coordinator for final work on an EB task).

**Evaluation** `{ id, submissionId, evaluatorId, score, feedback, evaluatedAt, updatedAt }`, where score is 0–100
and `updatedAt` is set when a score is corrected.

**Outcome** of a picked task: `IN_PROGRESS`, `ON_TIME`, `LATE` or `MISSED`. It's worked out from
the deadline and the submission, not stored.

## Auth

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | /api/auth/login | Public | `{ email, password }` → `{ token, user }`. Deactivated → 403. Failed attempts are limited per IP **and** email |
| GET | /api/auth/me | Any | `{ user, context }`; `context` is `{ domain, head, coordinator }` (names of the domain, its EB head and your coordinator, or null) |
| POST | /api/auth/logout | Any | Optional `{ endpoint }`: this device stops getting your notifications. Client discards the token |
| POST | /api/auth/change-password | Any | `{ currentPassword, newPassword }` → `{ token, user }`. Clears `mustChangePassword`. **All older tokens, including the one used, stop working: continue with the returned token** |
| POST | /api/auth/domain | Volunteer | `{ domainId }`. Only once, while the volunteer has no domain (409 after) |
| POST | /api/auth/coordinator | Volunteer | `{ coordinatorId }` → `{ user, context }`. First login, last step: an active COORDINATOR in the volunteer's domain (or, with no domain yet, any; the domain becomes the coordinator's). Only once (409 after); then only an admin or the domain's EB head can move them |

New passwords (create, import, reset, change) must be 8–72 characters, not a common password
(`password123`, `12345678`, `qwerty123`, `streetcause`, `gradex`, …) and not contain the part of
the email before `@`. Existing passwords still sign in.

Tokens carry the user's `tokenVersion`. A password change or reset, a role change and a
deactivation raise it, so every token issued before stops working (401).

While a user's `mustChangePassword` is true (every account an admin creates, imports or resets),
all other routes answer 403 `PASSWORD_CHANGE_REQUIRED`. A volunteer's first login is: set a
password, then choose a domain and a coordinator (`POST /api/auth/coordinator`).

## People

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | /api/users | Admin, EB, Coordinator | Admin: everyone. EB: their domain. Coordinator: themselves and their own volunteers |
| GET | /api/users/:id | Admin, EB, Coordinator | Same scope |
| POST | /api/users | Admin | `{ name, email, password, role, domainId?, coordinatorId? }`. Rules below |
| POST | /api/users/import | Admin | `{ users: [ { name, email, password, role, domainId?, coordinatorId?, coordinatorEmail? } ] }` (up to 500) → `{ created, failed, results[] }`. Each row succeeds or fails on its own; results come back in the order sent. Admins, EB heads and coordinators are added before volunteers, so a volunteer's `coordinatorEmail` may name a coordinator from the same batch |
| PATCH | /api/users/:id | Admin; EB; Coordinator | Admin: any of `name, email, role, domainId, coordinatorId, status`. EB: `status` for the coordinators and volunteers of their domain, and `coordinatorId` to move a volunteer to another coordinator of that domain. Coordinator: `status` for their own volunteers. Nobody changes their own role or deactivates themselves (400); the last active admin can't be demoted or deactivated (409) |
| POST | /api/users/:id/reset-password | Admin | `{ password }`. They must change it at next sign-in |
| PUT | /api/users/:id/decision | Admin; EB (their domain's coordinators and volunteers); Coordinator (their own volunteers) | `{ decision: "KEEP" \| "WARN" \| "REMOVE" \| null, note }`. Staff only; never shown to the person |
| GET | /api/domains | Any | `{ domains: [{ id, name, head: { id, name } \| null }] }` |
| GET | /api/domains/overview | Admin, EB | `{ domains: [{ id, name, head, mine, coordinators, volunteers, openTasks, onTimeRate, averageScore }] }`: basic facts of every domain (on-time rate and average score, missed = 0, over finished work at both levels) |
| GET | /api/domains/:id/coordinators | Any | `{ coordinators: [{ id, name, teamSize }] }`: active coordinators (names only), for the first-login choice |

Account rules (create, import, edit), each a 400 or 409 with a readable message:
- ADMIN: no domain or coordinator; at most 2 active admins.
- EB: needs the domain they lead; only one active EB per domain.
- COORDINATOR: needs a domain. A coordinator who still has volunteers can't change role or
  domain until those volunteers are moved.
- VOLUNTEER: `coordinatorId` (or `coordinatorEmail` on import) must be an active COORDINATOR in
  the volunteer's domain; the domain follows the coordinator. Leave both empty and the volunteer
  chooses at first login. Moving a volunteer to another domain without naming a coordinator
  clears it, so they choose again at next sign-in.

## Tasks

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | /api/tasks | Admin, EB, Coordinator | `?level=DOMAIN\|TEAM`. Admin: everything. EB: every task in their domain (both levels, drafts and proposals too). Coordinator: their domain's published EB tasks (each with `mine`) and their own team tasks (proposals included) |
| GET | /api/tasks/available | Volunteer, Coordinator | Open tasks you can pick now: a volunteer's coordinator's published team tasks; a coordinator's domain's published EB tasks. Each has `pickedByMe` |
| GET | /api/tasks/my | Volunteer, Coordinator | Your picks: `{ participations: [{ ...participation, task, submission, evaluation, evaluator, outcome, teamTask }] }` |
| POST | /api/tasks | Admin, EB | An EB task: `{ title, description, deadline, status?, domainId? }`. EB heads: their own domain (default). Admins: domainId required. Deadline must be in the future. Coordinators get 403: they forward or propose |
| GET | /api/tasks/:id | Any | Drafts, proposals and rejections only for the people who run them |
| GET | /api/tasks/:id/participants | Admin, EB, Coordinator | For the task's manager and the domain's EB head. Everyone who picked it, with submission, evaluation and outcome; on an EB task each coordinator also has `teamTask` |
| PUT | /api/tasks/:id | Admin, EB, Coordinator | Edit, publish (DRAFT→AVAILABLE) or close (AVAILABLE→CLOSED). EB tasks: the domain's EB head. Team tasks: the coordinator who owns them (EB heads only watch). No reopening. 409 when changing the deadline after it has passed, or the domain once anyone has picked the task. A forwarded team task's deadline can't go past its EB task's (400). A proposal can be edited while it waits, never published this way; a rejected one can't be edited |
| POST | /api/tasks/:id/choose | Volunteer, Coordinator | Pick a published, open task meant for you (a volunteer: their coordinator's team task; a coordinator: their domain's EB task). 409 if already picked |
| POST | /api/tasks/:id/forward | Coordinator | "Forward to my team": `{ deadline, title?, description? }` → 201 `{ task }`, a TEAM task (AVAILABLE, `parentTaskId` = the EB task, `ownerId` = you) your volunteers can pick. Picks the EB task for you if you hadn't. Once per coordinator per EB task (409). The team deadline must be in the future and on or before the EB deadline (400); the EB task must be open and before its deadline (409) |
| GET | /api/tasks/proposals | Admin, EB, Coordinator | Proposals (team tasks with no parent), newest first: admins all, EB heads their domain, coordinators their own. Includes decided ones (status AVAILABLE/CLOSED once approved, REJECTED with `reviewNote`) |
| POST | /api/tasks/proposals | Coordinator | `{ title, description, deadline }` → 201, a TEAM task with status PROPOSED. Volunteers don't see it until it's approved. The EB head gets a notification |
| POST | /api/tasks/:id/approve | Admin, EB (the proposal's domain) | `{ note?, deadline? }` → PROPOSED becomes AVAILABLE for the coordinator's team. A new deadline is needed if the proposed one has passed (400). 409 if already decided. The coordinator is notified |
| POST | /api/tasks/:id/reject | Admin, EB (the proposal's domain) | `{ reason }` (required) → REJECTED with `reviewNote`. The coordinator is notified and sees the reason |

## Submissions

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | /api/submissions | Volunteer, Coordinator | `multipart/form-data` with `taskId` and `file`, or JSON `{ taskId, linkUrl }`. 201 new, 200 replaced. Volunteers send team work to their coordinator; coordinators send their final work on an EB task to the EB head |
| GET | /api/submissions/my | Volunteer, Coordinator | Own submissions, each with `task` and `evaluation` |
| GET | /api/submissions/:id | The submitter; the task's manager and the domain's EB head; others who worked on the task per the board rule | |
| GET | /api/submissions/:id/file | Same as above | Downloads the file (local mode, or kv with the host's file store). In Sheets mode use `fileUrl` |

The submission rules are:
- You must have picked the task. Closed tasks take no submissions.
- Links must be `https://`. Files: PDF, Word (.doc/.docx), PowerPoint (.pptx), PNG, JPG or UTF-8 text,
  up to `MAX_UPLOAD_MB`, and the content must really be that type (checked by its first bytes).
- One upload at a time per person (429 while another is in progress).
- After the deadline, a first submission is accepted with `isLate: true`.
- Before the deadline you can replace your submission, unless it has already been scored.

## Reviews and scores

Work is scored by the person it was sent to: team work by the coordinator who owns the team task,
final work by the domain's EB head. Admins can score anything; nobody scores their own work.

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | /api/reviews/pending | Admin, EB, Coordinator | `?level=DOMAIN\|TEAM`. Unscored work in scope, oldest first, with `volunteer` (the submitter), `task` (with `level`) and `canScore`. EB heads see their domain's team work too, with `canScore: false` |
| GET | /api/reviews/scored | Admin, EB, Coordinator | Same, already scored, newest first |
| POST | /api/evaluations | Admin, EB, Coordinator | `{ submissionId, score, feedback }`. One per submission. Never your own work (403). An EB head scoring team work gets 403; anything else out of scope 404 |
| PUT | /api/evaluations/:id | Same people who could give the score | `{ score, feedback }` corrects a score; sets `updatedAt`, notifies the submitter "Score updated" |
| GET | /api/evaluations/my | Volunteer, Coordinator | Scores on your own work, with feedback |
| GET | /api/evaluations/:id | The submitter, the task's manager, the domain's EB head | |

## Boards (transparency)

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | /api/board | Any | Volunteers: always their own team's board. Coordinators: their team's board, or `?level=DOMAIN` for their domain's coordinators' board. EB heads: `?coordinatorId=` for any team in their domain, otherwise their coordinators' board. Admins: `?coordinatorId=` or `?domainId=` |

Returns `{ level, domain, coordinator, leaderboard[], tasks[], upcoming[] }`. A TEAM board covers one
coordinator's team tasks and a leaderboard of their volunteers; a DOMAIN board covers the domain's
EB tasks, the coordinators' final work with the EB head's scores, and a leaderboard of coordinators.
A task and all its submissions (work, score, feedback) appear only after its deadline. Leaderboard:
average score over finished tasks (a missed task counts as 0), then on-time count. Standings and
decisions are never included.

Late work is still accepted, so someone who **picked a finished task and hasn't submitted yet**
gets that task with `workHidden: true` and `submissions: []`, until they submit or the task is
CLOSED. The same rule applies to opening someone else's submission (`GET /api/submissions/:id`
and `/file`): the task's own audience only (the same team, or the domain's coordinators), after the
deadline, and not while you still owe your own work for that task.

## Excel export

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | /api/export | Admin (all), EB (their domain), Coordinator (their team and their own final work) | `.xlsx` with Roster (coordinators and volunteers, with role, coordinator, standing, decision), Submissions (with level and who scored), Tasks (with level, team, parent EB task, EB note), People |

## Phone notifications

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | /api/push/key | Any | `{ enabled, publicKey }` |
| POST | /api/push/subscribe | Any | The browser's PushSubscription JSON. The endpoint must be on a browser push service (`fcm.googleapis.com`, `*.push.services.mozilla.com`, `*.notify.windows.com`, `web.push.apple.com`, `*.push.apple.com`), else 400. Re-registering an endpoint moves it to you. At most 5 devices per person; the oldest drops off |
| POST | /api/push/unsubscribe | Any | `{ endpoint }` |

Sent automatically, at both levels: "Scored N/100" when work is scored (a volunteer's by their
coordinator, a coordinator's final work by the EB head), "Score updated to N/100" when a score is
corrected, and one "Due in N hours" reminder per unsubmitted pick within 24 hours of its deadline
(checked hourly). Also: the EB head hears about a new proposal, and the coordinator about its approval
or rejection. Notifications are sent after the save, with a 5 s timeout per device. A reminder
is logged only once it was actually sent, so a failed one is retried on the next run.

## Reports

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | /api/reports/people | Admin, EB, Coordinator | Standings. Admin: every coordinator and volunteer (`?domainId=`, `?coordinatorId=`, `?role=COORDINATOR\|VOLUNTEER`). EB: their domain's coordinators and volunteers. Coordinator: their own volunteers. `/api/reports/volunteers` is the older path for the same thing |

Returns `{ people: [...], volunteers: [...] }` (the same rows). A coordinator's record is their final
work on EB tasks; a volunteer's is their team work. Each row looks like this:

```json
{
  "person": { "id": "U010", "name": "Meena Iyer", "role": "VOLUNTEER", "coordinatorId": "U006", "...": "..." },
  "volunteer": "same object as person (older name)",
  "role": "VOLUNTEER",
  "coordinator": { "id": "U006", "name": "Ravi Kumar" },
  "teamSize": null,
  "history": [{ "taskId": "T008", "title": "...", "deadline": "...", "outcome": "ON_TIME", "score": 82 }],
  "current": [{ "taskId": "T011", "title": "...", "deadline": "...", "outcome": "IN_PROGRESS", "score": null }],
  "totals": { "taken": 8, "onTime": 7, "late": 1, "missed": 0, "inProgress": 0 },
  "onTimeRate": 0.88,
  "averageScore": 78,
  "lastActivity": "2026-10-12T...",
  "standing": "RELIABLE"
}
```

`history` holds the last 8 **finished** tasks (on time, late or missed), newest first; open picks
are in `current`. `averageScore` counts a missed task as 0, like the leaderboard. `teamSize` is the
number of active volunteers for a coordinator (null for volunteers). `lastActivity` is the latest
submission. Standing is one of:

| Standing | Meaning |
|---|---|
| DEACTIVATED | The account has been switched off |
| INACTIVE | Nothing submitted for 30 days (counted from account creation if never). Picking alone doesn't count |
| SLIPPING | In the last 8 finished tasks, missed 2 or more, or on time less than 60% of the time |
| NEW | No finished tasks yet |
| RELIABLE | Everyone else |
