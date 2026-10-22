# GradeX frontend

React + Vite. Talks to the API in the parent folder through Vite's dev proxy,
so the browser only ever sees one origin.

```bash
npm install
npm run dev      # http://localhost:5173 (start the API first: npm run demo in ..)
npm run build    # static files in dist/
```

The proxy reads the API port from `../.env` (`PORT`), so if you change it
there, restart `npm run dev`.

## Screens

| Who | Screen | What it's for |
|---|---|---|
| Coordinator, Admin | People | "Who's showing up": every volunteer's last 8 tasks as dots (on time, late, missed, in progress), on-time %, average score and standing. Deactivate or reactivate from the side panel |
| Coordinator, Admin | Tasks | Create, publish and close tasks; see who picked each one and open their work |
| Coordinator, Admin | Review | Work waiting for a score, with a 0–100 slider and feedback; already-scored work |
| Admin | Accounts | Add people, import a batch from CSV, edit roles and domains, reset passwords, deactivate |
| Volunteer | Home | Their own record, tasks to submit (link or file, replace before the deadline), open tasks to pick, scores and feedback |

The demo-account buttons on the sign-in page only appear in `npm run dev`.

## Code map

```text
src/
  api.js            API client (token in sessionStorage, signs out on 401)
  format.js         Dates, labels, datetime-local <-> ISO with timezone
  App.jsx           Session, staff vs volunteer layout, hash routes (#people, #tasks, ...)
  components/       Rail and shared UI (dots, tags, panels, toasts)
  pages/            One file per screen
  styles.css        All styles; colour and type tokens at the top
```
