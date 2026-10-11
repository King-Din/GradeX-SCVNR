import { google } from "googleapis";
import { env } from "../config/env.js";

const auth = new google.auth.OAuth2(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET
);

auth.setCredentials({
  refresh_token: env.GOOGLE_REFRESH_TOKEN
});

const sheets = google.sheets({
  version: "v4",
  auth
});

const spreadsheetId = env.GOOGLE_SPREADSHEET_ID;

const idLocks = new Map();

async function withIdLock(sheetName, callback) {
  const previousLock = idLocks.get(sheetName) || Promise.resolve();

  let releaseLock;

  const currentLock = new Promise((resolve) => {
    releaseLock = resolve;
  });

  idLocks.set(sheetName, currentLock);

  await previousLock;

  try {
    return await callback();
  } finally {
    releaseLock();

    if (idLocks.get(sheetName) === currentLock) {
      idLocks.delete(sheetName);
    }
  }
}

// --------------------------------------------------
// READ SHEET DATA
// --------------------------------------------------

async function getSheetData(sheetName) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: sheetName
  });

  const rows = response.data.values || [];

  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0];

  return rows.slice(1).map((row) => {
    const object = {};

    headers.forEach((header, index) => {
      object[header] = row[index] ?? "";
    });

    return object;
  });
}

// --------------------------------------------------
// GENERATE NEXT STABLE ID
// --------------------------------------------------

async function generateNextId(sheetName, prefix) {
  const rows = await getSheetData(sheetName);

  let maxNumber = 0;

  for (const row of rows) {
    if (!row.id) continue;

    if (row.id.startsWith(prefix)) {
      const number = parseInt(
        row.id.substring(prefix.length),
        10
      );

      if (!isNaN(number) && number > maxNumber) {
        maxNumber = number;
      }
    }
  }

  const nextNumber = maxNumber + 1;

  return `${prefix}${String(nextNumber).padStart(3, "0")}`;
}

// --------------------------------------------------
// FIND BY ID
// --------------------------------------------------

async function findById(sheetName, id) {
  const rows = await getSheetData(sheetName);

  return rows.find((row) => row.id === id) || null;
}

// --------------------------------------------------
// APPEND ROW
// --------------------------------------------------

async function appendRow(sheetName, data) {
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: sheetName,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [
        Object.values(data)
      ]
    }
  });

  return data;
}

// --------------------------------------------------
// UPDATE BY ID
// --------------------------------------------------

async function updateById(sheetName, id, data) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: sheetName
  });

  const rows = response.data.values || [];

  if (rows.length === 0) {
    throw new Error(`${sheetName} sheet is empty`);
  }

  const headers = rows[0];

  const idColumnIndex = headers.indexOf("id");

  if (idColumnIndex === -1) {
    throw new Error(`id column not found in ${sheetName}`);
  }

  const rowIndex = rows.findIndex(
    (row, index) =>
      index > 0 && row[idColumnIndex] === id
  );

  if (rowIndex === -1) {
    throw new Error(
      `${sheetName} record with ID ${id} not found`
    );
  }

  const rowNumber = rowIndex + 1;

  const updatedRow = headers.map(
    (header) => data[header] ?? ""
  );

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A${rowNumber}`,
    valueInputOption: "RAW",
    requestBody: {
      values: [updatedRow]
    }
  });

  return {
    ...data,
    id
  };
}

// ==================================================
// USERS
// ==================================================

export async function getUsers() {
  return getSheetData("Users");
}

export async function getUserById(id) {
  return findById("Users", id);
}

export async function getUserByEmail(email) {
  const users = await getUsers();

  return (
    users.find(
      (user) => user.email === email
    ) || null
  );
}

// ==================================================
// DOMAINS
// ==================================================

export async function getDomains() {
  return getSheetData("Domains");
}

// ==================================================
// TASKS
// ==================================================

export async function getTasks() {
  return getSheetData("Tasks");
}

export async function getTaskById(id) {
  return findById("Tasks", id);
}

export async function createTask(data) {
  return withIdLock("Tasks", async () => {
    const id = await generateNextId("Tasks", "T");

    const task = {
      ...data,
      id
    };

    return appendRow("Tasks", task);
  });
}

export async function updateTask(id, data) {
  return updateById("Tasks", id, {
    ...data,
    id
  });
}

// ==================================================
// PARTICIPATIONS
// ==================================================

export async function getParticipations() {
  return getSheetData("Participations");
}

export async function createParticipation(data) {
  return withIdLock("Participations", async () => {
    const id = await generateNextId(
      "Participations",
      "P"
    );

    const participation = {
      ...data,
      id
    };

    return appendRow(
      "Participations",
      participation
    );
  });
}

export async function updateParticipation(id, data) {
  const existingParticipation = await findById(
    "Participations",
    id
  );

  if (!existingParticipation) {
    throw new Error(
      `Participation with ID ${id} not found`
    );
  }

  return updateById("Participations", id, {
    ...existingParticipation,
    ...data,
    id
  });
}

// ==================================================
// SUBMISSIONS
// ==================================================

export async function getSubmissions() {
  return getSheetData("Submissions");
}

export async function createSubmission(data) {
  return withIdLock("Submissions", async () => {
    const id = await generateNextId(
      "Submissions",
      "S"
    );

    const submission = {
      ...data,
      id
    };

    return appendRow(
      "Submissions",
      submission
    );
  });
}

// ==================================================
// EVALUATIONS
// ==================================================

export async function getEvaluations() {
  return getSheetData("Evaluations");
}

export async function createEvaluation(data) {
  return withIdLock("Evaluations", async () => {
    const id = await generateNextId(
      "Evaluations",
      "E"
    );

    const evaluation = {
      ...data,
      id
    };

    return appendRow(
      "Evaluations",
      evaluation
    );
  });
}