import ExcelJS from "exceljs";

/*
 * Reads the club's filled GradeX-real-data-template.xlsx into domains and
 * people the app can load. Nothing here touches a store.
 *
 * - Domains: sheet "1. Domains", in order (D001, D002, ...).
 * - People: sheet "2. People".
 *   "Admin (EB)" rows are admins when their email is in `admins` (an admin
 *   with a domain also heads it); every other "Admin (EB)" row is the EB head
 *   of its domain. "EB (domain head)" and "Admin" from the newer template work too.
 * - Rows without an email can't sign in: they come back in `left`, not `people`.
 * - The same email twice, or the same phone where one row has no email, is one
 *   person (the row with the email wins).
 * - Phone numbers are only used to spot duplicates and to list the people
 *   left out; they are never part of `people`.
 */

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

function cellText(value) {
  if (value == null) return "";
  if (typeof value === "object") {
    if (value.text) return String(value.text);
    if (value.richText) return value.richText.map((r) => r.text).join("");
    if (value.result !== undefined) return String(value.result);
    if (value.hyperlink) return String(value.hyperlink).replace(/^mailto:/, "");
  }
  return String(value);
}

const ROLE_OF = {
  "admin (eb)": "EB?",
  admin: "ADMIN",
  "eb (domain head)": "EB",
  eb: "EB",
  coordinator: "COORDINATOR",
  volunteer: "VOLUNTEER"
};

export async function parseRoster(file, { admins = [] } = {}) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const sheet = (prefix) => wb.worksheets.find((ws) => ws.name.trim().startsWith(prefix));
  const rowsOf = (ws, width) => {
    const rows = [];
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const cells = Array.from({ length: width }, (_, i) => clean(cellText(row.getCell(i + 1).value)));
      if (cells.some(Boolean)) rows.push({ line: n, cells });
    });
    return rows;
  };

  const domains = rowsOf(sheet("1."), 2)
    .filter(({ cells }) => cells[0])
    .map(({ cells }, i) => ({ id: `D${String(i + 1).padStart(3, "0")}`, name: cells[0], ...(cells[1] ? { description: cells[1] } : {}) }));
  const domainByName = new Map(domains.map((d) => [d.name.toLowerCase(), d]));
  const adminSet = new Set(admins.map((e) => e.trim().toLowerCase()));

  const problems = [];
  const all = rowsOf(sheet("2."), 6).map(({ line, cells: [name, email, roleRaw, domainRaw, phone] }) => {
    const domain = domainRaw ? domainByName.get(domainRaw.toLowerCase()) : null;
    if (domainRaw && !domain) problems.push(`Line ${line}: domain "${domainRaw}" isn't on the Domains sheet`);
    const mail = email.toLowerCase();
    let role = ROLE_OF[roleRaw.toLowerCase()];
    if (!role) problems.push(`Line ${line}: role "${roleRaw}" isn't one the app knows`);
    if (role === "EB?") role = adminSet.has(mail) ? "ADMIN" : "EB";
    return { line, name, email: mail, role, domainId: domain?.id ?? null, domainName: domain?.name ?? null, phone: phone.replace(/\D/g, "") };
  });

  // One person per email; a row without an email that shares a phone with a
  // row that has one is the same person.
  const merged = [];
  const byEmail = new Map();
  const phonesWithEmail = new Set(all.filter((p) => p.email && p.phone).map((p) => p.phone));
  for (const p of all) {
    if (p.email && byEmail.has(p.email)) { merged.push({ kept: byEmail.get(p.email), dropped: p }); continue; }
    if (!p.email && p.phone && phonesWithEmail.has(p.phone)) {
      merged.push({ kept: all.find((q) => q.email && q.phone === p.phone), dropped: p });
      continue;
    }
    if (p.email) byEmail.set(p.email, p);
  }
  const droppedLines = new Set(merged.map((m) => m.dropped.line));
  const unique = all.filter((p) => !droppedLines.has(p.line));

  for (const p of unique) {
    if (p.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) problems.push(`Line ${p.line}: "${p.email}" isn't an email address`);
    if (p.role === "EB" && !p.domainId) problems.push(`Line ${p.line}: ${p.name} is EB but has no domain (or add their email to the admins)`);
  }
  for (const email of adminSet) {
    if (!unique.some((p) => p.email === email && p.role === "ADMIN")) problems.push(`Admin ${email} isn't an "Admin (EB)" row in the sheet`);
  }

  const people = unique
    .filter((p) => p.email)
    .map(({ line, name, email, role, domainId }) => ({ line, name, email, role, domainId: role === "VOLUNTEER" ? null : domainId }));
  const left = unique.filter((p) => !p.email);

  return { domains, people, left, merged, problems };
}
