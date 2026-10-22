import ExcelJS from "exceljs";
import * as store from "../data/store.js";
import { ROLE_LABELS, ROLES } from "../constants/roles.js";
import { isAdmin, isCoordinator, isEB, isTeamTask, taskLevel } from "../utils/access.js";
import { peopleReport } from "./report.service.js";

const STANDING = { NEW: "New", RELIABLE: "Reliable", SLIPPING: "Slipping", INACTIVE: "Inactive", DEACTIVATED: "Deactivated" };
const DECISION = { KEEP: "Keep", WARN: "Warn", REMOVE: "Remove" };
const STATUS = { DRAFT: "Draft", AVAILABLE: "Published", CLOSED: "Closed", PROPOSED: "Proposed", REJECTED: "Not approved" };
const LEVEL = { DOMAIN: "EB task", TEAM: "Team task" };

function addSheet(workbook, name, columns, rows) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = columns.map(([header, key, width = 18]) => ({ header, key, width }));
  sheet.getRow(1).font = { bold: true };
  sheet.addRows(rows);
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return sheet;
}

const date = (iso) => (iso ? new Date(iso) : null);

/*
 * Everything in one Excel file: standings with decisions, every submission
 * with its score, tasks and people. Admins get every domain, EB heads their
 * domain, coordinators their own team (and their own final work).
 */
export async function buildExport(actor) {
  const [domains, users, tasks, participations, submissions, evaluations, report] = await Promise.all([
    store.list("Domains"), store.list("Users"), store.list("Tasks"), store.list("Participations"),
    store.list("Submissions"), store.list("Evaluations"), peopleReport(actor)
  ]);

  const team = new Set(isCoordinator(actor) ? users.filter((u) => u.coordinatorId === actor.id).map((u) => u.id) : []);
  const picked = new Set(participations.filter((p) => p.volunteerId === actor.id).map((p) => p.taskId));

  const taskInScope = (task) => {
    if (!task) return false;
    if (isAdmin(actor)) return true;
    if (isEB(actor)) return task.domainId === actor.domainId;
    return isTeamTask(task) ? task.ownerId === actor.id : picked.has(task.id);
  };
  const submissionInScope = (s) => taskInScope(taskOf(s.taskId)) && (!isCoordinator(actor) || s.volunteerId === actor.id || team.has(s.volunteerId));
  const personInScope = (u) => {
    if (isAdmin(actor)) return true;
    if (isEB(actor)) return u.domainId === actor.domainId;
    return u.id === actor.id || team.has(u.id);
  };

  const domainName = (id) => domains.find((d) => d.id === id)?.name ?? "";
  const userOf = (id) => users.find((u) => u.id === id);
  const taskOf = (id) => tasks.find((t) => t.id === id);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "GradeX";
  workbook.created = new Date();

  addSheet(workbook, "Roster", [
    ["Name", "name", 22], ["Email", "email", 28], ["Role", "role", 13], ["Domain", "domain"], ["Coordinator", "coordinator", 20],
    ["Standing", "standing", 13], ["Decision", "decision", 11], ["Decision note", "note", 40], ["Tasks picked", "taken", 12],
    ["On time", "onTime", 10], ["Late", "late", 8], ["Missed", "missed", 9], ["On-time rate", "rate", 13],
    ["Average score (missed = 0)", "average", 14], ["Last active", "lastActive", 18]
  ], report.map((r) => {
    const user = userOf(r.person.id);
    return {
      name: r.person.name, email: r.person.email, role: ROLE_LABELS[r.role] ?? r.role, domain: domainName(r.person.domainId),
      coordinator: r.coordinator?.name ?? "", standing: STANDING[r.standing] ?? r.standing, decision: DECISION[user?.decision] ?? "",
      note: user?.decisionNote ?? "", taken: r.totals.taken, onTime: r.totals.onTime, late: r.totals.late, missed: r.totals.missed,
      rate: r.onTimeRate == null ? "" : Math.round(r.onTimeRate * 100) / 100, average: r.averageScore ?? "", lastActive: date(r.lastActivity)
    };
  })).getColumn("rate").numFmt = "0%";

  addSheet(workbook, "Submissions", [
    ["Task", "task", 32], ["Level", "level", 11], ["Domain", "domain"], ["Submitted by", "person", 22], ["Role", "role", 13],
    ["Submitted", "submitted", 18], ["Deadline", "deadline", 18], ["Late", "late", 7], ["Link or file", "work", 45],
    ["Score", "score", 8], ["Feedback", "feedback", 45], ["Scored by", "by", 20]
  ], submissions.filter(submissionInScope).map((s) => {
    const task = taskOf(s.taskId);
    const evaluation = evaluations.find((e) => e.submissionId === s.id);
    const person = userOf(s.volunteerId);
    return {
      task: task?.title, level: LEVEL[taskLevel(task)], domain: domainName(task?.domainId), person: person?.name, role: ROLE_LABELS[person?.role] ?? "",
      submitted: date(s.submittedAt), deadline: date(task?.deadline), late: s.isLate ? "Yes" : "No",
      work: s.linkUrl ?? s.fileUrl ?? s.fileName ?? "", score: evaluation?.score ?? "", feedback: evaluation?.feedback ?? "",
      by: evaluation ? userOf(evaluation.evaluatorId)?.name ?? "" : ""
    };
  }));

  addSheet(workbook, "Tasks", [
    ["Task", "title", 34], ["Level", "level", 11], ["Domain", "domain"], ["Team of", "owner", 20], ["From EB task", "parent", 30],
    ["Status", "status", 13], ["Deadline", "deadline", 18], ["Created", "created", 18], ["EB note", "note", 36]
  ], tasks.filter(taskInScope).map((t) => ({
    title: t.title, level: LEVEL[taskLevel(t)], domain: domainName(t.domainId), owner: t.ownerId ? userOf(t.ownerId)?.name ?? "" : "",
    parent: t.parentTaskId ? taskOf(t.parentTaskId)?.title ?? "" : "", status: STATUS[t.status] ?? t.status,
    deadline: date(t.deadline), created: date(t.createdAt), note: t.reviewNote ?? ""
  })));

  addSheet(workbook, "People", [
    ["Name", "name", 22], ["Email", "email", 28], ["Role", "role", 16], ["Domain", "domain"], ["Coordinator", "coordinator", 20], ["Account", "status", 12]
  ], users.filter(personInScope).map((u) => ({
    name: u.name, email: u.email, role: ROLE_LABELS[u.role] ?? u.role, domain: domainName(u.domainId),
    coordinator: u.role === ROLES.VOLUNTEER && u.coordinatorId ? userOf(u.coordinatorId)?.name ?? "" : "",
    status: u.status === "DEACTIVATED" ? "Deactivated" : "Active"
  })));

  for (const sheet of workbook.worksheets) {
    sheet.eachRow((row, n) => { if (n > 1) row.eachCell((cell) => { if (cell.value instanceof Date) cell.numFmt = "dd mmm yyyy hh:mm"; }); });
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
