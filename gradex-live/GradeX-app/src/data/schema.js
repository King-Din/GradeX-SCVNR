/*
 * One entry per sheet (tab). Column order here is the header row order in
 * Google Sheets; docs/SHEET_SCHEMA.md documents the same thing for humans.
 * Types tell the drivers how to turn cell text back into values.
 */

export const TABLES = Object.freeze({
  Users: {
    prefix: "U",
    columns: [
      "id", "name", "email", "passwordHash", "role", "domainId", "status", "createdAt",
      "mustChangePassword", "decision", "decisionNote", "decisionBy", "decisionAt",
      "tokenVersion", "coordinatorId", "appInstalledAt"
    ],
    // tokenVersion goes up on password change/reset, role change and
    // deactivation; tokens signed with an older value stop working.
    // coordinatorId: a volunteer's coordinator (their domain is that
    // coordinator's domain). Empty for everyone else.
    // appInstalledAt: first time they opened GradeX as an installed app
    // (from their Home Screen), so leaders can see who has set it up.
    types: { mustChangePassword: "boolean", tokenVersion: "number" }
  },
  Domains: {
    prefix: "D",
    columns: ["id", "name"]
  },
  Tasks: {
    prefix: "T",
    columns: [
      "id", "title", "description", "domainId", "deadline", "status", "createdBy", "createdAt",
      "level", "parentTaskId", "ownerId", "reviewNote", "reviewedBy", "reviewedAt"
    ]
    // level DOMAIN (EB -> coordinators; empty cells count as DOMAIN) or TEAM
    // (a coordinator -> their own volunteers). TEAM tasks have ownerId = the
    // coordinator and, when forwarded from a DOMAIN task, parentTaskId.
    // reviewNote / reviewedBy / reviewedAt record the EB's approve/reject.
  },
  Participations: {
    prefix: "P",
    // volunteerId is whoever picked the task: a volunteer on a TEAM task, a
    // coordinator on a DOMAIN task (the column keeps its old name).
    columns: ["id", "taskId", "volunteerId", "chosenAt", "status"]
  },
  Submissions: {
    prefix: "S",
    columns: [
      "id", "participationId", "taskId", "volunteerId", "kind",
      "fileId", "fileUrl", "fileName", "linkUrl", "isLate", "submittedAt", "updatedAt"
    ],
    types: { isLate: "boolean" }
  },
  Evaluations: {
    prefix: "E",
    columns: ["id", "submissionId", "evaluatorId", "score", "feedback", "evaluatedAt", "updatedAt"],
    types: { score: "number" }
  },
  // Phones that asked for notifications (one row per browser/device).
  PushSubscriptions: {
    prefix: "Q",
    columns: ["id", "userId", "endpoint", "p256dh", "auth", "createdAt"]
  },
  // Notifications already sent, so a reminder never goes out twice.
  NotificationLog: {
    prefix: "L",
    columns: ["id", "userId", "kind", "refId", "sentAt"]
  }
});

export const TABLE_NAMES = Object.keys(TABLES);

export function tableDef(name) {
  const def = TABLES[name];
  if (!def) throw new Error(`Unknown table ${name}`);
  return def;
}

// Cells come back from Sheets as text; empty cells become null.
export function deserializeRow(name, raw) {
  const { columns, types = {} } = tableDef(name);
  const row = {};

  for (const column of columns) {
    let value = raw[column];

    if (value === undefined || value === "") {
      row[column] = null;
      continue;
    }

    if (types[column] === "number") value = Number(value);
    if (types[column] === "boolean") value = value === true || String(value).toUpperCase() === "TRUE";

    row[column] = value;
  }

  return row;
}

export function formatId(prefix, number) {
  return `${prefix}${String(number).padStart(3, "0")}`;
}

export function nextIdFor(name, rows) {
  const { prefix } = tableDef(name);
  let max = 0;

  for (const row of rows) {
    if (typeof row.id !== "string" || !row.id.startsWith(prefix)) continue;
    const number = Number.parseInt(row.id.slice(prefix.length), 10);
    if (Number.isInteger(number) && number > max) max = number;
  }

  return formatId(prefix, max + 1);
}

/*
 * Thrown by a driver's insert() when the caller's `unique(rows)` guard finds
 * the record already exists. Drivers check the guard against the rows they
 * are about to write, including on every conflict retry, so a rule like "one
 * evaluation per submission" holds even across several server instances.
 */
export class DuplicateRowError extends Error {
  constructor(table) {
    super(`Duplicate ${table} record`);
    this.code = "DUPLICATE_ROW";
  }
}

export function assertUnique(name, rows, unique) {
  if (typeof unique === "function" && unique(rows.map((row) => deserializeRow(name, row)))) {
    throw new DuplicateRowError(name);
  }
}
