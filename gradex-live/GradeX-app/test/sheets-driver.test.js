import test from "node:test";
import assert from "node:assert/strict";
import { createSheetsDriver } from "../src/data/sheetsDriver.js";

// A tiny stand-in for the googleapis sheets client, holding rows in memory.
function fakeSheets(initial) {
  const sheets = structuredClone(initial);
  const calls = { get: 0, append: [], update: [] };
  let failNextGetWith = null;

  const client = {
    spreadsheets: {
      values: {
        async get({ range }) {
          calls.get += 1;
          if (failNextGetWith) {
            const error = Object.assign(new Error("quota"), { code: failNextGetWith });
            failNextGetWith = null;
            throw error;
          }
          return { data: { values: sheets[range.split("!")[0]] } };
        },
        async append({ range, requestBody }) {
          calls.append.push(requestBody.values[0]);
          sheets[range].push(requestBody.values[0]);
        },
        async update({ range, requestBody }) {
          const [name, cell] = range.split("!");
          const rowNumber = Number(cell.replace("A", ""));
          calls.update.push({ rowNumber, values: requestBody.values[0] });
          sheets[name][rowNumber - 1] = requestBody.values[0];
        }
      }
    }
  };

  return { client, sheets, calls, failNextGet: (code) => { failNextGetWith = code; } };
}

const TASK_HEADERS = ["id", "title", "description", "domainId", "deadline", "status", "createdBy", "createdAt"];

test("insert writes cells in the sheet's header order with the ID in the id column", async () => {
  const fake = fakeSheets({ Tasks: [TASK_HEADERS, ["T001", "Old", "d", "D001", "2030-01-01T00:00:00Z", "DRAFT", "U002", "x"]] });
  const driver = createSheetsDriver({ client: fake.client, spreadsheetId: "s" });

  // Object keys deliberately in a different order from the sheet.
  const row = await driver.insert("Tasks", {
    createdAt: "2026-10-14T00:00:00Z", status: "AVAILABLE", title: "Poster", createdBy: "U002",
    description: "Make it", deadline: "2030-02-01T00:00:00Z", domainId: "D001"
  });

  assert.equal(row.id, "T002");
  assert.deepEqual(fake.calls.append[0], [
    "T002", "Poster", "Make it", "D001", "2030-02-01T00:00:00Z", "AVAILABLE", "U002", "2026-10-14T00:00:00Z"
  ]);
});

test("insert follows the real header order even if the sheet's columns were rearranged", async () => {
  const shuffled = ["title", "id", "status", "description", "domainId", "deadline", "createdBy", "createdAt"];
  const fake = fakeSheets({ Tasks: [shuffled] });
  const driver = createSheetsDriver({ client: fake.client, spreadsheetId: "s" });

  await driver.insert("Tasks", { title: "Poster", status: "DRAFT", description: "d", domainId: "D001", deadline: "x", createdBy: "U1", createdAt: "y" });
  assert.deepEqual(fake.calls.append[0].slice(0, 3), ["Poster", "T001", "DRAFT"]);
});

test("RAW writes keep text exactly (no stray apostrophe); USER_ENTERED writes are neutralized", async () => {
  const fake = fakeSheets({ Tasks: [TASK_HEADERS] });
  const driver = createSheetsDriver({ client: fake.client, spreadsheetId: "s" });

  const row = await driver.insert("Tasks", { title: "- fix the colours", description: "=HYPERLINK(\"evil\")" });
  assert.equal(fake.calls.append[0][1], "- fix the colours", "RAW is never evaluated, so the text is stored as typed");
  assert.equal(fake.calls.append[0][2], "=HYPERLINK(\"evil\")");
  assert.equal((await driver.list("Tasks")).find((r) => r.id === row.id).title, "- fix the colours", "reads back unchanged");

  const entered = fakeSheets({ Tasks: [TASK_HEADERS] });
  const typed = createSheetsDriver({ client: entered.client, spreadsheetId: "s", valueInputOption: "USER_ENTERED" });
  await typed.insert("Tasks", { title: "=HYPERLINK(\"evil\")", description: "d" });
  assert.equal(entered.calls.append[0][1], "'=HYPERLINK(\"evil\")");
});

test("update re-finds the row by id right before writing, even if rows moved", async () => {
  const fake = fakeSheets({ Tasks: [TASK_HEADERS, ["T001", "A", "d", "D001", "x", "DRAFT", "U1", "y"], ["T002", "B", "d", "D001", "x", "DRAFT", "U1", "y"]] });
  const realGet = fake.client.spreadsheets.values.get;
  let reads = 0;
  // Someone inserts a row at the top by hand between our read and our write.
  fake.client.spreadsheets.values.get = async (args) => {
    reads += 1;
    if (reads === 2) fake.sheets.Tasks.splice(1, 0, ["T009", "Manual", "d", "D001", "x", "DRAFT", "U1", "y"]);
    return realGet(args);
  };
  const driver = createSheetsDriver({ client: fake.client, spreadsheetId: "s" });

  await driver.update("Tasks", "T001", { title: "A2" });
  assert.equal(fake.calls.update[0].rowNumber, 3, "writes where T001 is now, not where it was");
  assert.deepEqual(fake.sheets.Tasks[1][0], "T009", "the hand-added row is untouched");
  assert.equal(fake.sheets.Tasks[2][1], "A2");
});

test("reads are cached until the TTL passes or a write happens", async () => {
  let clock = 0;
  const fake = fakeSheets({ Tasks: [TASK_HEADERS, ["T001", "A", "d", "D001", "x", "DRAFT", "U1", "y"]] });
  const driver = createSheetsDriver({ client: fake.client, spreadsheetId: "s", cacheTtlMs: 1000, now: () => clock });

  await driver.list("Tasks");
  await driver.list("Tasks");
  assert.equal(fake.calls.get, 1, "second read within the TTL is served from cache");

  clock = 1500;
  await driver.list("Tasks");
  assert.equal(fake.calls.get, 2, "read after the TTL goes to Google");

  await driver.update("Tasks", "T001", { status: "AVAILABLE" });
  const rows = await driver.list("Tasks");
  assert.equal(rows[0].status, "AVAILABLE", "a write is visible straight away");
});

test("update merges into the existing row instead of blanking other columns", async () => {
  const fake = fakeSheets({ Tasks: [TASK_HEADERS, ["T001", "Keep me", "desc", "D001", "x", "DRAFT", "U1", "y"]] });
  const driver = createSheetsDriver({ client: fake.client, spreadsheetId: "s" });

  await driver.update("Tasks", "T001", { status: "AVAILABLE" });
  assert.deepEqual(fake.calls.update[0], { rowNumber: 2, values: ["T001", "Keep me", "desc", "D001", "x", "AVAILABLE", "U1", "y"] });
});

test("quota errors are retried with backoff", async () => {
  const fake = fakeSheets({ Tasks: [TASK_HEADERS] });
  const driver = createSheetsDriver({ client: fake.client, spreadsheetId: "s" });

  fake.failNextGet(429);
  assert.deepEqual(await driver.list("Tasks"), []);
  assert.equal(fake.calls.get, 2);
});

test("numbers and true/false come back typed", async () => {
  const fake = fakeSheets({
    Evaluations: [["id", "submissionId", "evaluatorId", "score", "feedback", "evaluatedAt"], ["E001", "S001", "U002", "86", "Good", "x"]],
    Submissions: [["id", "participationId", "isLate"], ["S001", "P001", "TRUE"]]
  });
  const driver = createSheetsDriver({ client: fake.client, spreadsheetId: "s" });

  assert.equal((await driver.list("Evaluations"))[0].score, 86);
  assert.equal((await driver.list("Submissions"))[0].isLate, true);
});

test("insert refuses a duplicate when the caller's unique guard matches", async () => {
  const fake = fakeSheets({ Tasks: [TASK_HEADERS, ["T001", "A", "d", "D001", "x", "DRAFT", "U1", "y"]] });
  const driver = createSheetsDriver({ client: fake.client, spreadsheetId: "s" });
  await assert.rejects(
    driver.insert("Tasks", { title: "A" }, { unique: (rows) => rows.some((r) => r.title === "A") }),
    (error) => error.code === "DUPLICATE_ROW"
  );
  assert.equal(fake.calls.append.length, 0);
});
