import fs from "node:fs";
import path from "node:path";
import { assertUnique, DuplicateRowError, deserializeRow, nextIdFor, TABLE_NAMES } from "./schema.js";

/*
 * Development/demo storage: the same tables as the Google Sheet, kept in one
 * JSON file. Created from `seed()` the first time it is used.
 */
export function createLocalDriver({ file, seed }) {
  let data = null;

  function load() {
    if (data) return data;

    if (fs.existsSync(file)) {
      data = JSON.parse(fs.readFileSync(file, "utf8"));
    } else {
      data = seed ? seed() : {};
      save();
    }

    for (const name of TABLE_NAMES) data[name] ??= [];
    return data;
  }

  function save() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  }

  return {
    async list(name) {
      return load()[name].map((row) => deserializeRow(name, row));
    },

    async insert(name, values, { unique } = {}) {
      const rows = load()[name];
      assertUnique(name, rows, unique);
      const row = deserializeRow(name, { ...values, id: nextIdFor(name, rows) });
      rows.push(row);
      save();
      return { ...row };
    },

    async update(name, id, patch, { unique } = {}) {
      const rows = load()[name];
      const index = rows.findIndex((row) => row.id === id);
      if (index === -1) throw new Error(`${name} record ${id} not found`);

      const next = deserializeRow(name, { ...rows[index], ...patch, id });
      const others = rows.filter((_, i) => i !== index).map((row) => deserializeRow(name, row));
      if (typeof unique === "function" && unique(others, next)) throw new DuplicateRowError(name);
      rows[index] = next;
      save();
      return { ...rows[index] };
    },

    // Used by the reset script and tests.
    reset() {
      data = seed ? seed() : {};
      save();
    }
  };
}
