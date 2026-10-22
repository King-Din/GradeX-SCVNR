# Security

## Authentication

- Passwords are bcrypt hashes (12 rounds); hashes are never returned by the API.
- Login emails are compared case-insensitively. Unknown email and wrong password
  get the same 401 response and take the same time.
- New passwords: 8–72 characters, not on the common-password list
  (`src/validators/common.js`), and not containing the email's name part.
  Existing passwords (including the demo accounts' `password123`) still sign in.
- JWTs are HS256 with issuer, audience and expiry checked. `JWT_SECRET` must be
  long and random; production refuses placeholders.
- Every request re-reads the user. Tokens carry the user's `tokenVersion`; a
  password change or reset, a role change and a deactivation raise it, so
  every older token stops working at once (reactivating doesn't revive them).
  Change-password returns a fresh token.
- Failed logins are rate-limited per IP **and** email (`LOGIN_RATE_LIMIT_MAX`
  per `LOGIN_RATE_LIMIT_WINDOW_MS`), so one person's typos don't lock out a
  whole college behind one IP.

## Authorization

| Who | Can |
|---|---|
| Admin (at most 2) | Everything in every domain; add, import, edit, deactivate and reset people; assign roles |
| EB head (one per domain) | Basic facts of every domain; in their own domain: publish, edit, close and score EB tasks (the coordinators' final work), approve or reject proposals, see team tasks and team scores (view only), people, standings, decisions, deactivate coordinators and volunteers, move volunteers between the domain's coordinators, Excel |
| Coordinator | Pick, forward and submit final work for their domain's published EB tasks; run and score their own team tasks; propose tasks; standings, decisions and deactivation for their own volunteers; Excel for their team |
| Volunteer | Their coordinator's published team tasks; their own picks, submissions and scores; their team's board |

All of these rules live in `src/utils/access.js` (`canManageTask`, `canOverseeTask`,
`isTaskAudience`, `overseesPerson`, `headsDomain`), so every service asks the same questions.

- Identity comes only from the token (`req.user`); `userId`/`volunteerId`/`evaluatorId` in a body are never trusted.
- Records outside your scope return 404, so the API never confirms they exist.
- Drafts, proposals and rejected proposals are visible only to the people who run them (the
  EB head for drafts, the proposing coordinator and the EB head for proposals).
- Work is scored by the person it was sent to: team work by the owning coordinator, final work
  by the domain's EB head (admins anything). EB heads see team scores but can't change them.
- Account rules are enforced on create, import and edit: at most 2 admins, one active EB per
  domain (also guarded by the storage driver's conditional write, like one email per account),
  and a volunteer's coordinator must be an active coordinator in the volunteer's domain.
- Nobody scores (or re-scores) their own work.
- Nobody changes their own role or deactivates themselves; the last active
  admin can't be demoted or deactivated.
- Deadlines can't move once passed, and a picked task can't change domain.
- Board: other people's work appears only to the task's own audience (the same
  team for a team task, the domain's coordinators for an EB task), only after
  the deadline, and not to someone who picked the task and still owes their own
  (late) work, until they submit or the task is closed. The same rule guards
  `GET /api/submissions/:id` and its file.

## Demo mode

`DEMO_MODE=true` seeds the sample club, whose password everyone knows. Those
accounts can't have their password, role, status or email changed or be reset
(403), so a visitor can't lock others out. Only `newvolunteer@example.com` may
set its password and choose its domain and coordinator (a reset restores it). Outside demo
mode a new store gets only the domains and one admin from
`BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`, who must change that
password at first sign-in. Never run demo mode on real data.

## Input and files

- Every body, parameter and query is validated with zod (`src/validators`).
- Uploads: one file, `MAX_UPLOAD_MB` (default 10) max, PDF/Word/PowerPoint/PNG/
  JPG/UTF-8 text only. The content must match the claimed type (first bytes:
  `%PDF`, PNG/JPEG signatures, `PK` zip for docx/pptx, OLE for doc, valid UTF-8
  without NUL for text). Stored under a generated name; served back as an
  attachment with `nosniff`.
- One upload at a time per person; files are stored before the write lock and
  removed again if the save is refused.
- Links must be `https://`.
- Google Sheets cells are written RAW, so text is never evaluated as a formula
  (and is stored exactly as typed). The Excel export writes all text as plain
  strings.
- Import results only show our own messages; unexpected errors stay in the server log.

## Notifications

- Push endpoints must be on a browser push service (FCM, Mozilla, Windows,
  Apple); anything else is refused, so the server never posts to arbitrary
  addresses. At most 5 devices per person. Logging out with `{ endpoint }`
  detaches that device.
- Sends happen after the save (never inside the write lock), with a 5 s timeout
  per device, so a slow push service can't stall anyone else.

## Data integrity

- Check-then-write operations run inside one write lock per process. The lock
  has a 20 s safety timeout ("The server is busy, try again"); work that timed
  out while waiting never runs.
- One pick per (task, volunteer), one submission per pick and one evaluation
  per submission are also enforced by the storage drivers themselves, against
  the exact rows being written, so they hold across several instances (kv).
- Sheets mode: run one server instance. Updates look the row up by id right
  before writing.

## HTTP

- Helmet, CORS limited to `FRONTEND_URL`, 1 MB JSON limit, `x-powered-by` off.
- `/health` and `/api/health` reveal nothing about storage.
- Rate limits: API-wide (`API_RATE_LIMIT_MAX`, generous because a college shares
  one IP) and failed logins.
- **Set `TRUST_PROXY_HOPS` to the real number of reverse proxies** in front of
  the server (e.g. 1 behind one load balancer). With 0 behind a proxy every
  request looks like it comes from the proxy, so all users share one rate-limit
  bucket; set too high and clients can fake their IP with `X-Forwarded-For`.

## Secrets

- `.env`, service account keys and `data/` are git-ignored. Never commit them.
- `npm run check-env` reports which settings exist without printing values.

## Tests

`npm test` covers token tampering and revocation, role checks at all four
levels, cross-domain and cross-team access, forwarding, proposals and
approvals, two-level scoring, account rules (admins, EB heads, coordinators of
volunteers), first-login coordinator choice, CSV import, draft visibility, deactivation, admin self-protection, demo-account
protection, bootstrap seeding, duplicate picks/scores under concurrency (one
process and several kv instances), upload type/size/concurrency, push
allowlist and limits, reminder retries, the board's copy protection, standing
rules, and the Sheets driver's column order, caching, retries and row lookup.
