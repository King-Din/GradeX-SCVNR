import { assertUnique, deserializeRow, nextIdFor, TABLE_NAMES } from "./schema.js";

/*
 * Holds the tables in memory. Used by hosted demos that load the data at the
 * start of a request and save it afterwards (see `dirty`).
 */
export function createMemoryDriver(initial) {
  const data = initial;
  for (const name of TABLE_NAMES) data[name] ??= [];

  const driver = {
    data,
    dirty: false,

    async list(name) {
      return data[name].map((row) => deserializeRow(name, row));
    },

    async insert(name, values, { unique } = {}) {
      assertUnique(name, data[name], unique);
      const row = deserializeRow(name, { ...values, id: nextIdFor(name, data[name]) });
      data[name].push(row);
      driver.dirty = true;
      return { ...row };
    },

    async update(name, id, patch) {
      const index = data[name].findIndex((row) => row.id === id);
      if (index === -1) throw new Error(`${name} record ${id} not found`);
      data[name][index] = deserializeRow(name, { ...data[name][index], ...patch, id });
      driver.dirty = true;
      return { ...data[name][index] };
    }
  };

  return driver;
}
