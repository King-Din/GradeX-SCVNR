/**
 * Neutralizes spreadsheet formula injection before untrusted text is written
 * to a Google Sheets/CSV-compatible cell.
 */
export function sanitizeSpreadsheetCell(value) {
  if (value === null || value === undefined) return value;
  if (typeof value !== "string") return value;

  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

export function sanitizeSpreadsheetRow(row) {
  if (!Array.isArray(row)) return row;
  return row.map(sanitizeSpreadsheetCell);
}
