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

// --------------------------------------------------
// GET ALL DATA FROM A SHEET
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
// FIND ONE ROW BY ID
// --------------------------------------------------

async function findById(sheetName, id) {
  const rows = await getSheetData(sheetName);

  return rows.find((row) => row.id === id) || null;
}

// --------------------------------------------------
// APPEND A NEW ROW
// --------------------------------------------------

async function appendRow(sheetName, data) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: sheetName
  });

  const rows = response.data.values || [];

  if (rows.length === 0) {
    throw new Error(`Sheet "${sheetName}" has no header row`);
  }

  const headers = rows[0];

  const newRow = headers.map((header) => data[header] ?? "");

  const appendResponse = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: sheetName,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    includeValuesInResponse: true,
    requestBody: {
      values: [newRow]
    }
  });

  console.log("APPEND RESPONSE:", appendResponse.data);

  return data;
}

// --------------------------------------------------
// UPDATE A ROW BY ID
// --------------------------------------------------

async function updateById(sheetName, id, data) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: sheetName
  });

  const rows = response.data.values || [];

  if (rows.length === 0) {
    throw new Error(`Sheet "${sheetName}" has no header row`);
  }

  const headers = rows[0];

  const rowIndex = rows.findIndex(
    (row, index) => index > 0 && row[0] === id
  );

  if (rowIndex === -1) {
    return null;
  }

  const updatedRow = headers.map((header, index) => {
    if (data[header] !== undefined) {
      return data[header];
    }

    return rows[rowIndex][index] ?? "";
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A${rowIndex + 1}`,
    valueInputOption: "RAW",
    requestBody: {
      values: [updatedRow]
    }
  });

  return headers.reduce((object, header, index) => {
    object[header] = updatedRow[index];
    return object;
  }, {});
}

// --------------------------------------------------
// USERS
// --------------------------------------------------

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
      (user) =>
        user.email.toLowerCase() === email.toLowerCase()
    ) || null
  );
}

// --------------------------------------------------
// DOMAINS
// --------------------------------------------------

export async function getDomains() {
  return getSheetData("Domains");
}

// --------------------------------------------------
// TASKS
// --------------------------------------------------

export async function getTasks() {
  return getSheetData("Tasks");
}

export async function getTaskById(id) {
  return findById("Tasks", id);
}

export async function createTask(data) {
  const id = await generateNextId("Tasks", "T");

  const task = {
    ...data,
    id
  };

  return appendRow("Tasks", task);
}

export async function updateTask(id, data) {
  return updateById("Tasks", id, data);
}

// --------------------------------------------------
// PARTICIPATIONS
// --------------------------------------------------

export async function getParticipations() {
  return getSheetData("Participations");
}

export async function createParticipation(data) {
  const id = await generateNextId("Participations", "P");

  const participation = {
    ...data,
    id
  };

  return appendRow("Participations", participation);
}

// --------------------------------------------------
// SUBMISSIONS
// --------------------------------------------------

export async function getSubmissions() {
  return getSheetData("Submissions");
}

export async function createSubmission(data) {
  const id = await generateNextId("Submissions", "S");

  const submission = {
    ...data,
    id
  };

  return appendRow("Submissions", submission);
}

// --------------------------------------------------
// EVALUATIONS
// --------------------------------------------------

export async function getEvaluations() {
  return getSheetData("Evaluations");
}

export async function createEvaluation(data) {
  const id = await generateNextId("Evaluations", "E");

  const evaluation = {
    ...data,
    id
  };

  return appendRow("Evaluations", evaluation);
}