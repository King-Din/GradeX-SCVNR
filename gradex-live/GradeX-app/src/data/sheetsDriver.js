import { assertUnique, deserializeRow, nextIdFor, tableDef } from "./schema.js";
import { sanitizeSpreadsheetRow } from "../utils/spreadsheet.js";

const RETRY_DELAYS_MS = [500, 1000, 2000];

function isRetryable(error) {
  const status = error?.code ?? error?.response?.status;
  return status === 429 || (Number.isInteger(status) && status >= 500);
}

async function withRetry(operation) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= RETRY_DELAYS_MS.length || !isRetryable(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }
}

/*
 * Google Sheets storage.
 *
 * - Rows are written in the sheet's own header order, never object order.
 * - Reads are cached per sheet for cacheTtlMs and dropped after any write, so
 *   one page load does not cost one Google read per request.
 * - Quota and server errors are retried with backoff.
 * - Cells are written with valueInputOption RAW, so Google never evaluates
 *   them as formulas and no "'" prefix is needed (it would be stored as part
 *   of the text). The sanitizer is applied only if USER_ENTERED is chosen.
 * - Run ONE server instance in Sheets mode: IDs and row positions are worked
 *   out by this process, and its write lock does not reach other processes.
 *
 * `client` is a googleapis sheets client (google.sheets({ version: "v4" })).
 */
export function createSheetsDriver({ client, spreadsheetId, cacheTtlMs = 15000, now = Date.now, valueInputOption = "RAW" }) {
  const cache = new Map();

  async function readValues(name) {
    const response = await withRetry(() =>
      client.spreadsheets.values.get({ spreadsheetId, range: name })
    );
    return response.data.values || [];
  }

  async function readTable(name) {
    const cached = cache.get(name);
    if (cached && now() - cached.at < cacheTtlMs) return cached;

    const values = await readValues(name);
    const headers = values[0] || [];

    if (headers.length === 0) {
      throw new Error(`${name} sheet has no header row. Expected: ${tableDef(name).columns.join(", ")}`);
    }

    // Raw cells are kept too, so an update rewrites a row without blanking
    // columns the club added to the sheet by hand.
    const raws = values.slice(1).map((cells) => {
      const raw = {};
      headers.forEach((header, index) => {
        raw[header] = cells[index] ?? "";
      });
      return raw;
    });
    const rows = raws.map((raw) => deserializeRow(name, raw));

    const entry = { at: now(), headers, rows, raws };
    cache.set(name, entry);
    return entry;
  }

  function toCells(headers, row) {
    const cells = headers.map((header) => {
      const value = row[header];
      return value === null || value === undefined ? "" : value;
    });
    return valueInputOption === "RAW" ? cells : sanitizeSpreadsheetRow(cells);
  }

  // Sheet row number (1-based, header is row 1) currently holding `id`, read
  // straight from the sheet, so a row inserted, deleted or sorted by hand in
  // the meantime can't make us overwrite the wrong record.
  async function locateRow(name, headers, id) {
    const values = await readValues(name);
    const idColumn = (values[0] || headers).indexOf("id");
    const index = values.findIndex((cells, i) => i > 0 && cells[idColumn] === id);
    return index === -1 ? null : index + 1;
  }

  return {
    async list(name) {
      const { rows } = await readTable(name);
      return rows.map((row) => ({ ...row }));
    },

    async insert(name, data, { unique } = {}) {
      cache.delete(name);
      const { headers, rows } = await readTable(name);
      assertUnique(name, rows, unique);
      const row = { ...data, id: nextIdFor(name, rows) };

      await withRetry(() =>
        client.spreadsheets.values.append({
          spreadsheetId,
          range: name,
          valueInputOption,
          insertDataOption: "INSERT_ROWS",
          requestBody: { values: [toCells(headers, row)] }
        })
      );

      cache.delete(name);
      return deserializeRow(name, row);
    },

    async update(name, id, patch) {
      cache.delete(name);
      const { headers, rows, raws } = await readTable(name);
      const index = rows.findIndex((row) => row.id === id);

      if (index === -1) throw new Error(`${name} record ${id} not found`);

      const merged = { ...raws[index], ...rows[index], ...patch, id };
      const rowNumber = await locateRow(name, headers, id);
      if (!rowNumber) throw new Error(`${name} record ${id} not found`);

      await withRetry(() =>
        client.spreadsheets.values.update({
          spreadsheetId,
          range: `${name}!A${rowNumber}`,
          valueInputOption,
          requestBody: { values: [toCells(headers, merged)] }
        })
      );

      cache.delete(name);
      return deserializeRow(name, merged);
    }
  };
}
