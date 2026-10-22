// Stand-in for the googleapis package, used only by the ORIGINAL demo.
// The team's own sheets.service.js runs unchanged on top of it, so it behaves
// exactly as it would against a real Google Sheet (including its bugs).
let sheetsData = {};
let dirty = false;

export function useSheets(data) {
  sheetsData = data;
  dirty = false;
}
export const sheetsDirty = () => dirty;

const tabOf = (range) => String(range).split("!")[0];

const client = {
  spreadsheets: {
    values: {
      async get({ range }) {
        const rows = sheetsData[tabOf(range)] ?? [];
        const onlyHeader = /!1:1$/.test(range);
        return { data: { values: structuredClone(onlyHeader ? rows.slice(0, 1) : rows) } };
      },
      async append({ range, requestBody }) {
        const tab = tabOf(range);
        sheetsData[tab] ??= [];
        for (const row of requestBody.values) sheetsData[tab].push(row.map((v) => (v == null ? "" : String(v))));
        dirty = true;
        return { data: {} };
      },
      async update({ range, requestBody }) {
        const [tab, cell] = String(range).split("!");
        const rowNumber = Number(String(cell).replace(/^[A-Z]+/, ""));
        sheetsData[tab][rowNumber - 1] = requestBody.values[0].map((v) => (v == null ? "" : String(v)));
        dirty = true;
        return { data: {} };
      }
    }
  }
};

class OAuth2 {
  setCredentials() {}
}

export const google = {
  auth: { OAuth2 },
  sheets: () => client,
  drive: () => ({ files: { create: async () => { throw new Error("Drive is not connected in the demo"); } } })
};
export default { google };
