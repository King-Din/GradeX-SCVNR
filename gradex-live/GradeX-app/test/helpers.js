import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/*
 * Starts the real app on a random port with its own throwaway local data
 * file. Call before importing anything from src/ (env is read at import).
 */
export async function startTestServer({ demoMode = false, seed = "demo", env = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gradex-test-"));
  const dataFile = path.join(dir, "db.json");

  // Most tests run on the sample club WITHOUT demo-mode protections, so they
  // can change those accounts: the data file is written before the app starts.
  if (seed === "demo" && !demoMode) {
    const { buildSeed } = await import("../src/data/seed.js");
    fs.writeFileSync(dataFile, JSON.stringify(buildSeed()));
  }

  Object.assign(process.env, {
    NODE_ENV: "test",
    JWT_SECRET: "a".repeat(64),
    JWT_EXPIRES_IN: "1h",
    DATA_DRIVER: "local",
    LOCAL_DATA_FILE: dataFile,
    LOCAL_UPLOAD_DIR: path.join(dir, "uploads"),
    LOGIN_RATE_LIMIT_MAX: "1000",
    DEMO_MODE: demoMode ? "true" : "false",
    ...env
  });

  const { app } = await import("../src/app.js");
  const store = await import("../src/data/store.js");
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.GRADEX_TEST_BASE = base;

  async function call(method, url, { token, json, form } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (json) headers["Content-Type"] = "application/json";

    const res = await fetch(base + url, {
      method,
      headers,
      body: json ? JSON.stringify(json) : form
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, body, headers: res.headers };
  }

  async function login(email, password = "password123") {
    const { body } = await call("POST", "/api/auth/login", { json: { email, password } });
    return body.token;
  }

  // Seeded people and tasks by email / title, so tests never hard-code IDs.
  async function userId(email) {
    const user = (await store.list("Users")).find((u) => u.email === email);
    if (!user) throw new Error(`No user ${email}`);
    return user.id;
  }

  async function taskByTitle(title, level = "DOMAIN") {
    return (await store.list("Tasks")).find((task) => task.title === title && (task.level ?? "DOMAIN") === level);
  }

  return {
    call,
    login,
    userId,
    taskByTitle,
    store,
    close: () => new Promise((resolve) => server.close(resolve)),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true })
  };
}

/*
 * The sample club (src/data/seed.js): two admins; Priya heads Design, Rohan
 * PR & Marketing; Ravi and Lakshmi coordinate Design teams, Arvind a PR team.
 */
export const PEOPLE = {
  admin: "admin@example.com",
  admin2: "admin2@example.com",
  priya: "eb.design@example.com",
  rohan: "eb.pr@example.com",
  sneha: "eb.ops@example.com",
  ravi: "coordinator@example.com",
  lakshmi: "coordinator2@example.com",
  arvind: "coordinator.pr@example.com",
  sameer: "coordinator.ops@example.com",
  meena: "volunteer@example.com",
  kavya: "kavya@example.com",
  arjun: "arjun@example.com",
  sai: "saiteja@example.com",
  varun: "varun@example.com",
  divya: "divya@example.com",
  harini: "harini@example.com",
  nikhil: "nikhil@example.com",
  ananya: "ananya@example.com",
  rahul: "rahul@example.com",
  pooja: "newvolunteer@example.com"
};

// Signs everyone in (password123); returns { name: token }.
export async function loginAll(t, names = Object.keys(PEOPLE)) {
  const tokens = {};
  for (const name of names) tokens[name] = await t.login(PEOPLE[name]);
  return tokens;
}

/*
 * A fresh EB task in Design (by Priya) forwarded by a coordinator (Ravi by
 * default) to their team: returns { parent, task } where task is the team task.
 */
export async function teamTask(t, tokens, { coordinator = "ravi", eb = "priya", deadline = inDays(5), parentDeadline = inDays(10), title } = {}) {
  const name = title ?? `Task ${Math.random().toString(36).slice(2, 8)}`;
  const created = await t.call("POST", "/api/tasks", {
    token: tokens[eb],
    json: { title: name, description: "Do it", deadline: parentDeadline, status: "AVAILABLE" }
  });
  if (created.status !== 201) throw new Error(`EB task: ${JSON.stringify(created.body)}`);
  const forwarded = await t.call("POST", `/api/tasks/${created.body.task.id}/forward`, {
    token: tokens[coordinator],
    json: { deadline }
  });
  if (forwarded.status !== 201) throw new Error(`Forward: ${JSON.stringify(forwarded.body)}`);
  return { parent: created.body.task, task: forwarded.body.task };
}

export const inDays = (days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

// File contents that pass the upload content checks.
export const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n% test poster\n");
