/*
 * Replaces the LOCAL store (data/local-db.json) with the club's real roster:
 * the domains and everyone with an email, all with one starting password
 * they must change at first sign-in. The old store and uploads are moved
 * aside first, never deleted.
 *
 *   ROSTER_ADMINS=a@x.com,b@y.com STARTING_PASSWORD_FILE=path/to/file \
 *     node scripts/load-roster.js roster.xlsx [reportDir]
 *
 * reportDir gets people-left-out.xlsx (no email yet, with their phone so
 * someone can ask) and roster-report.txt.
 */
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { parseRoster } from "./roster.js";

const [file, reportDir] = process.argv.slice(2);
if (!file) {
  console.error("Usage: node scripts/load-roster.js roster.xlsx [reportDir]");
  process.exit(1);
}
const password = fs.readFileSync(process.env.STARTING_PASSWORD_FILE ?? "", "utf8").trim();
if (password.length < 8) {
  console.error("Set STARTING_PASSWORD_FILE to a file holding the starting password (8+ characters).");
  process.exit(1);
}
const admins = (process.env.ROSTER_ADMINS ?? "").split(",").filter(Boolean);

const roster = await parseRoster(file, { admins });
if (roster.problems.length) {
  console.error("Fix these in the sheet first:\n- " + roster.problems.join("\n- "));
  process.exit(1);
}

// Real data, so never demo mode; set before the app's modules read the env.
process.env.DATA_DRIVER = "local";
process.env.DEMO_MODE = "false";
const { env } = await import("../src/config/env.js");

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
for (const target of [env.LOCAL_DATA_FILE, env.LOCAL_UPLOAD_DIR]) {
  if (fs.existsSync(target)) fs.renameSync(target, `${target}.before-roster-${stamp}`);
}
fs.mkdirSync(path.dirname(env.LOCAL_DATA_FILE), { recursive: true });
const { TABLE_NAMES } = await import("../src/data/schema.js");
const tables = Object.fromEntries(TABLE_NAMES.map((name) => [name, []]));
tables.Domains = roster.domains;
fs.writeFileSync(env.LOCAL_DATA_FILE, JSON.stringify(tables, null, 2));

const { importUsers } = await import("../src/services/user.service.js");
const results = await importUsers(roster.people.map(({ name, email, role, domainId }) => ({ name, email, role, domainId, password })));
const failed = results.map((r, i) => ({ ...r, person: roster.people[i] })).filter((r) => !r.ok);

const count = (role) => results.filter((r) => r.ok && r.user.role === role).length;
const lines = [
  `Loaded ${results.length - failed.length} of ${roster.people.length} people into ${env.LOCAL_DATA_FILE}`,
  `  admins ${count("ADMIN")}, EB heads ${count("EB")}, coordinators ${count("COORDINATOR")}, volunteers ${count("VOLUNTEER")}`,
  `  domains: ${roster.domains.map((d) => d.name).join(", ")}`,
  `Merged duplicates (${roster.merged.length}):`,
  ...roster.merged.map((m) => `  line ${m.dropped.line} "${m.dropped.name}" = line ${m.kept.line} "${m.kept.name}"`),
  `Left out, no email yet (${roster.left.length}): see people-left-out.xlsx`,
  `Coordinators who choose their domain at first sign-in: ${roster.people.filter((p) => p.role === "COORDINATOR" && !p.domainId).map((p) => p.name).join(", ") || "none"}`,
  ...(failed.length ? ["Failed:", ...failed.map((f) => `  line ${f.person.line} ${f.email}: ${f.error}`)] : [])
];
console.log(lines.join("\n"));

if (reportDir) {
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, "roster-report.txt"), lines.join("\n") + "\n");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("No email yet");
  ws.columns = [
    { header: "Full name", key: "name", width: 34 },
    { header: "Email (fill in)", key: "email", width: 34 },
    { header: "Role", key: "role", width: 14 },
    { header: "Domain", key: "domain", width: 26 },
    { header: "Phone", key: "phone", width: 14 },
    { header: "Sheet line", key: "line", width: 10 }
  ];
  ws.getRow(1).font = { bold: true };
  const label = { COORDINATOR: "Coordinator", VOLUNTEER: "Volunteer", EB: "EB", ADMIN: "Admin" };
  for (const p of roster.left) ws.addRow({ name: p.name, email: "", role: label[p.role] ?? p.role, domain: p.domainName ?? "", phone: p.phone, line: p.line });
  await wb.xlsx.writeFile(path.join(reportDir, "people-left-out.xlsx"));
}
process.exit(failed.length ? 1 : 0);
