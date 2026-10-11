# Google Sheets Database Schema

The Task Evaluation System uses Google Sheets as its structured data layer.

The backend communicates with Google Sheets through the Google Sheets API.
Frontend modules must not access Google Sheets directly.

## 1. Users

| Column | Description |
|---|---|
| id | Unique user ID, e.g. U001 |
| name | User's full name |
| email | User's email address |
| passwordHash | Hashed password |
| role | User role |
| domainId | ID of the user's domain |

## 2. Domains

| Column | Description |
|---|---|
| id | Unique domain ID, e.g. D001 |
| name | Domain name |

## 3. Tasks

| Column | Description |
|---|---|
| id | Unique task ID, e.g. T001 |
| title | Task title |
| description | Task description |
| domainId | Domain associated with the task |
| deadline | Task deadline |
| status | Current task status |
| createdBy | ID of the user who created the task |
| createdAt | Task creation timestamp |

## 4. Participations

| Column | Description |
|---|---|
| id | Unique participation ID, e.g. P001 |
| taskId | ID of the selected task |
| volunteerId | ID of the volunteer |
| chosenAt | Time when the volunteer was selected |
| status | Participation status |

## 5. Submissions

| Column | Description |
|---|---|
| id | Unique submission ID, e.g. S001 |
| participationId | Related participation ID |
| taskId | ID of the submitted task |
| volunteerId | ID of the volunteer |
| fileId | Google Drive file ID |
| fileUrl | Google Drive file URL |
| submittedAt | Submission timestamp |

## 6. Evaluations

| Column | Description |
|---|---|
| id | Unique evaluation ID, e.g. E001 |
| submissionId | Related submission ID |
| evaluatorId | ID of the evaluator |
| score | Evaluation score |
| feedback | Evaluator feedback |
| evaluatedAt | Evaluation timestamp |

## ID Rules

All records use stable IDs.

Examples:

- Users: U001
- Domains: D001
- Tasks: T001
- Participations: P001
- Submissions: S001
- Evaluations: E001

Row numbers must not be used as permanent IDs.

The backend generates the next ID based on the highest existing numeric ID for that sheet.

ID generation and row creation are serialized within the backend process to reduce the risk of duplicate IDs.

## Access Rule

Only the backend Google Sheets service should communicate with Google Sheets.

Frontend code must communicate with the Express backend API instead of accessing Google Sheets directly.