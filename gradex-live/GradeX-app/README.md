# GradeX

Task publishing, submissions, scoring and volunteer tracking for Street Cause VNRVJIET.

- **Admins** (the app owner and the divisional president, at most 2) see and do everything
  across domains, manage accounts, and download it all as Excel.
- **EB heads** (one per domain) publish EB tasks to their domain's coordinators, approve the
  coordinators' own task ideas, score the coordinators' final work, and see every domain at a
  glance and their own in depth (people, standings, decisions, Excel).
- **Coordinators** each run a team in one domain: pick an EB task, do it themselves or forward it
  to their team, score their volunteers' work, then send the final work to their EB head.
  They can propose their own team tasks, and mark their volunteers Keep / Warn / Remove.
- **Volunteers** belong to one coordinator's team. At first login they set their own password,
  then choose a domain and a coordinator. They pick the tasks their coordinator forwards,
  submit a file or a link, and see their scores. The team board shows everyone's finished work,
  scores and a leaderboard once each deadline passes. Phone reminders for "due soon" and "scored".

## Run it locally (no Google account needed)

Requires Node.js 20+.

```bash
npm install
cp .env.example .env        # then set JWT_SECRET to a long random string
npm run demo                # API on http://localhost:5000 with demo data
```

`npm run demo` uses `DATA_DRIVER=local`: everything lives in `data/local-db.json`
and uploads go to `data/uploads/`. The demo accounts are in `src/data/seed.js`
(password `password123`). Rebuild the demo data any time with `npm run reset-demo`.

The frontend lives in `frontend/` (see `frontend/README.md`):

```bash
cd frontend && npm install && npm run dev   # http://localhost:5173
```

On macOS, AirPlay Receiver uses port 5000. Set `PORT=5050` in `.env`; the
frontend reads the port from there.

## Run it on Google Sheets

1. Create the spreadsheet with one tab per table and the header rows from
   [docs/SHEET_SCHEMA.md](docs/SHEET_SCHEMA.md).
2. Create a Google Cloud **service account**, download its JSON key, and share
   the spreadsheet and a Drive folder **inside a Shared Drive** with the
   service account's email (Editor). Service accounts have no Drive storage of
   their own, so uploads must go to a Shared Drive.
3. In `.env`: `DATA_DRIVER=sheets`, `GOOGLE_SERVICE_ACCOUNT_KEY_FILE`,
   `GOOGLE_SPREADSHEET_ID`, `GOOGLE_DRIVE_FOLDER_ID`.
4. Check the setup:

```bash
npm run check-env      # which settings are present (never prints values)
npm run check-sheet    # every tab has the expected header cells
npm run check-drive    # uploads and deletes a test file
npm start
```

An OAuth refresh token still works as a fallback (`GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`). If you use it, set the Google
Cloud OAuth app to **In production**; apps left in Testing get tokens that
expire after 7 days.

Sheet reads are cached for `SHEETS_CACHE_TTL_MS` (15 s by default) and dropped
after every write, which keeps the app well inside Google's request limits.

## Phone notifications

Generate keys once and put them in `.env` (and in the host's environment variables):

```bash
npx web-push generate-vapid-keys
```

`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` (a `mailto:` or the site URL). The
server checks for due-soon reminders every 15 minutes; on Netlify an hourly scheduled function does it.

## Hosted on Netlify

`~/Desktop/GradeX-deploy` packages this app as Netlify functions with Netlify Blobs storage
(`src/data/kvDriver.js`): every save is conditional and read back, so hundreds of people
submitting at once can't overwrite each other.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API with auto-restart, using `.env` |
| `npm run demo` | Same, with local demo data |
| `npm start` | API without auto-restart |
| `npm test` | All tests |
| `npm run check` | Syntax-check every file |
| `npm run reset-demo` | Rebuild the local demo data |
| `npm run check-env` / `check-sheet` / `check-drive` | Google setup checks |

## Docs

- [docs/API_CONTRACT.md](docs/API_CONTRACT.md): every route, who can call it, and what it returns
- [docs/SHEET_SCHEMA.md](docs/SHEET_SCHEMA.md): the spreadsheet tabs and columns
- [docs/SECURITY.md](docs/SECURITY.md): how access is enforced

## Code map

```text
src/
  app.js, server.js         Express app and entry point
  config/env.js             All settings, validated at startup
  data/                     Storage: schema, Google Sheets driver, local driver, demo seed
  services/                 Business rules (users, tasks, submissions, evaluations, reports)
  controllers/, routes/     HTTP layer
  validators/               Request validation (zod)
  middleware/               Auth, roles, uploads, validation, errors
scripts/                    Setup checks and demo reset
test/                       API, Sheets driver and security tests
frontend/                   React app
```

Rules that matter when changing code:

- Identity always comes from the login token (`req.user`), never from the request body.
- Every check-then-write runs inside `store.withWriteLock()`.
- The Submissions sheet is the source of truth for "has this volunteer submitted";
  on time / late / missed is worked out from deadlines, never stored.
