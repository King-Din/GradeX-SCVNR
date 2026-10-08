# GradeX — B5: Evaluation + Coordinator Review

This folder contains the B5 backend additions for the `King-Din/GradeX-SCVNR` project.

## Files included

- `src/validators/evaluation.validator.js` — validates evaluation request bodies and evaluation IDs.
- `src/controllers/evaluation.controller.js` — pending submissions, evaluation submission, and evaluation visibility.
- `src/routes/evaluation.routes.js` — authenticated and role-protected API routes.
- `src/app.js` — current `main` app file with the B5 router import and mount added.

## API routes added

- `GET /api/submissions` — COORDINATOR only; returns submissions without an evaluation yet, with volunteer/task details.
- `POST /api/evaluations` — COORDINATOR only; saves a score and feedback, uses the logged-in coordinator ID, then marks the linked participation `COMPLETED`.
- `GET /api/evaluations/:id` — COORDINATOR or the VOLUNTEER who owns the related submission.

Evaluation score must be a JSON number from 0 to 100. Feedback is required (up to 2,000 characters). A submission is considered pending when no Evaluation row references it.

## Important: do not run this yet

This is a backend branch contribution, not the complete app. Frontend integration can happen later. Before running/testing the backend, the team still needs to integrate B2's real `src/services/sheets.service.js` into the main branch and confirm the Google Sheets column mapping.

**B2 integration issue to coordinate with the B2 teammate:** the current `sheets` branch's `appendRow()` writes `Object.values(data)`, while `createEvaluation()` constructs `{ ...data, id }`. If the Evaluations sheet has columns in the documented order `id, submissionId, evaluatorId, score, feedback, evaluatedAt`, this would append the ID in the wrong column. The B2 service should build appended rows in sheet-header order (or put `id` first for this schema) before runtime testing. Similar ordering may affect other create methods too.

## How to use this folder

Use this as the contents for a new branch based on the team's current `main` branch. The `src/app.js` file is included with only the B5 router import and `app.use("/api", evaluationRouter)` added to the current version. If `main` has changed since this package was prepared, keep the latest `app.js` and add just those two lines instead of replacing newer work.

Do not merge this branch into the shared main branch until B2's Sheets service integration and the frontend/API contract are coordinated.
