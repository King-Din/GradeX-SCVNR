# Google Sheets schema

One tab per table. Row 1 is the header row and must contain these column
names (order can differ; the app writes by header name). `npm run check-sheet`
reports missing headers. The same definitions live in `src/data/schema.js`.

Only the backend talks to Google Sheets; the frontend always goes through the API.

## Users

| Column | Description |
|---|---|
| id | U001, U002, ... |
| name | Full name |
| email | Login email, stored lowercase |
| passwordHash | bcrypt hash. Never typed by hand: use the Add people screen or `POST /api/users` |
| role | ADMIN, EB, COORDINATOR or VOLUNTEER. At most 2 active ADMINs; exactly one active EB per domain |
| domainId | Domain ID. The domain an EB heads, or a coordinator's domain. A volunteer's is their coordinator's. Empty for admins |
| status | ACTIVE or DEACTIVATED. Deactivated people can't sign in; their history stays |
| createdAt | ISO timestamp |
| mustChangePassword | TRUE until the person sets their own password |
| decision | KEEP, WARN or REMOVE (staff only) |
| decisionNote | Private note behind the decision |
| decisionBy | User ID who set it |
| decisionAt | ISO timestamp |
| tokenVersion | Number, empty = 0. Goes up on password change/reset, role change and deactivation; signs out older tokens. **Required**: without this column sign-outs can't be saved |
| coordinatorId | Volunteers only: user ID of their coordinator (a COORDINATOR in the same domain). Empty for everyone else |
| appInstalledAt | When they first opened GradeX from their Home Screen (ISO date-time). Empty until then |

Volunteers may have an empty `domainId` and `coordinatorId` until they choose them at first
login (domain, then one of that domain's coordinators).

## Domains

| Column | Description |
|---|---|
| id | D001, D002, ... |
| name | e.g. Design, PR & Marketing, Operations |

## Tasks

| Column | Description |
|---|---|
| id | T001, ... |
| title | Task title |
| description | The brief |
| domainId | Domain the task belongs to |
| deadline | ISO date-time with timezone, e.g. 2026-10-18T23:59:00+05:30 |
| status | DRAFT (only the EB head sees it), AVAILABLE (can be picked), CLOSED, PROPOSED (a coordinator's idea waiting for the EB head), REJECTED (not approved; see reviewNote) |
| createdBy | User ID of the creator |
| createdAt | ISO timestamp |
| level | DOMAIN (an EB task for the domain's coordinators; empty cells count as DOMAIN) or TEAM (a coordinator's task for their own volunteers) |
| parentTaskId | TEAM tasks forwarded from an EB task: that task's ID. Empty for EB tasks and for approved proposals |
| ownerId | TEAM tasks: user ID of the coordinator whose team it is |
| reviewNote | The EB head's note when approving, or the reason when rejecting, a proposal |
| reviewedBy | User ID of whoever approved or rejected the proposal |
| reviewedAt | ISO timestamp of that decision |

## Participations

One row each time someone picks a task: a volunteer picking a TEAM task, or a coordinator
picking (or forwarding) a DOMAIN task.

| Column | Description |
|---|---|
| id | P001, ... |
| taskId | Task picked |
| volunteerId | Who picked it (the column keeps its old name: a coordinator on a DOMAIN task) |
| chosenAt | ISO timestamp |
| status | SELECTED, SUBMITTED or COMPLETED (scored) |

## Submissions

At most one row per participation. Replacing a submission before the deadline
updates the same row.

| Column | Description |
|---|---|
| id | S001, ... |
| participationId | The pick this submission belongs to |
| taskId | Task |
| volunteerId | Who submitted it (a volunteer's team work, or a coordinator's final work) |
| kind | FILE or LINK |
| fileId | Google Drive file ID (FILE only) |
| fileUrl | Google Drive link (FILE only) |
| fileName | Original file name (FILE only) |
| linkUrl | Submitted link (LINK only) |
| isLate | TRUE if first submitted after the deadline |
| submittedAt | First submission time |
| updatedAt | Last replacement time |

## Evaluations

| Column | Description |
|---|---|
| id | E001, ... |
| submissionId | Submission scored (one evaluation per submission) |
| evaluatorId | Who scored it: the coordinator for team work, the EB head for final work, or an admin |
| score | Whole number 0 to 100 |
| feedback | Shown to the volunteer |
| evaluatedAt | ISO timestamp |
| updatedAt | ISO timestamp of the last score correction (empty if never changed) |

## PushSubscriptions

One row per phone/browser that turned on reminders: `id` (Q001…), `userId`, `endpoint`, `p256dh`, `auth`, `createdAt`.

## NotificationLog

One row per reminder sent, so it's never sent twice: `id` (L001…), `userId`, `kind` (DUE_SOON), `refId` (participation), `sentAt`.

## IDs and running the server

Each table's next ID is one more than the highest existing number for its
prefix. Row numbers are never used as IDs. ID generation and every
check-then-write are serialized inside the backend process, and an update
looks its row up by `id` right before writing, so rows added or sorted by
hand don't get overwritten.

**Run exactly one server instance in Sheets mode.** The write lock and ID
generation live in that one process; two instances could hand out the same ID.
(The hosted build uses `DATA_DRIVER=kv`, which is safe with many instances.)

Cells are written RAW, so text that starts with `=`, `+`, `-` or `@` is stored
exactly as typed and is never run as a formula.

## Upgrading an existing sheet

For the roles update (EB heads, coordinators' teams, forwarding and proposals) add
`Users.coordinatorId` and `Tasks.level`, `Tasks.parentTaskId`, `Tasks.ownerId`,
`Tasks.reviewNote`, `Tasks.reviewedBy`, `Tasks.reviewedAt`. Existing tasks with an empty
`level` count as EB tasks.

Older upgrades: add these header cells to existing tabs: `Users.status`, `Users.createdAt`, `Users.mustChangePassword`,
`Users.decision`, `Users.decisionNote`, `Users.decisionBy`, `Users.decisionAt`, plus the two new tabs above,
`Submissions.kind`, `Submissions.fileName`, `Submissions.linkUrl`,
`Submissions.isLate`, `Submissions.updatedAt`, `Users.tokenVersion`, `Evaluations.updatedAt`.
Empty `status` cells count as ACTIVE; empty `tokenVersion` cells count as 0.
Text saved by older versions may start with a stray `'` (they added one before
`=`, `+`, `-`, `@`); you can remove it by hand.
