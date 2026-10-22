# GradeX (live version)

The version of GradeX that Street Cause VNRVJIET runs at **streetcausevnr.org**. It grew out
of the team's original backend modules (B1–B5, in the root of this repository, left
unchanged) into a complete app: a hardened API, a web front end that installs on phones,
and the setup that hosts it.

The two folders sit side by side (the hosting code imports the app from `../GradeX-app`).

| Folder | What's in it |
|---|---|
| [`GradeX-app/`](GradeX-app/) | The app. `src/` is the Express 5 API; `frontend/` is the React 19 + Vite front end; `test/` has the automated tests (`npm test`). |
| [`GradeX-deploy/`](GradeX-deploy/) | Hosting on Vercel: the serverless function, the storage adapters (Upstash Redis for data, Vercel Blob for uploaded files and daily backups), and `qa/`, which runs the real function against in-memory stand-ins for both. |

## What it does

- **Four roles:** admins, EB heads (one per domain), coordinators (each with a team), and
  volunteers (each in one coordinator's team).
- **Two levels of tasks:**
  - EB heads publish tasks to their domain's coordinators.
  - A coordinator forwards a task to their team or does it themselves, and can propose
    tasks of their own for the EB head to approve.
- **Work and scoring:** volunteers pick tasks and submit links or files. Coordinators score
  their volunteers, and EB heads score coordinators' final work.
- **Boards and leaderboards** open after each deadline; a missed task counts as 0.
- **Staff tools:** standings, private Keep / Warn / Remove notes, accounts with CSV import,
  and Excel export.
- **First sign-in** has people set their own password, choose a domain and coordinator, add
  the app to the phone's Home Screen and turn on notifications. Leaders can see who has
  finished setting up.

## Run it locally (demo data)

Needs Node 20 or later.

From this folder:

```bash
cd GradeX-app && npm install && (cd frontend && npm install)
cp .env.example .env          # then set JWT_SECRET to 32+ random characters
npm run demo                  # the API with the demo club (password: password123)
```

In a second terminal, from `GradeX-app/frontend`, run `npm run dev` and open
http://localhost:5173.

## Tests

From this folder, after installing the app as above:

```bash
(cd GradeX-app && npm test)        # API, roles, security and storage-driver tests
(cd GradeX-deploy && npm install && node qa/build.mjs && node qa/two.mjs)   # more in GradeX-deploy/qa/README.md
```

## Deploying

`GradeX-deploy/build-vercel.mjs` builds the site into `GradeX-deploy/sites/vercel`. Run `vercel deploy`
from there. The project needs these settings, and their values are never committed:

| Setting | What it is |
|---|---|
| `GRADEX_JWT_SECRET` | The sign-in secret |
| `CRON_SECRET` | Protects the daily reminders and backup job |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Phone notifications |
| `NODEJS_HELPERS=0` | A Vercel setting the function needs |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Data in Upstash Redis |
| `BLOB_READ_WRITE_TOKEN` | Uploaded files and backups in Vercel Blob |

No member data lives in this repository. The club's roster is loaded from a spreadsheet
kept outside the repository.
