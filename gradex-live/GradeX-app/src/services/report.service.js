import * as store from "../data/store.js";
import { ROLES } from "../constants/roles.js";
import { OUTCOME } from "../constants/tasks.js";
import { STANDING, USER_STATUS } from "../constants/users.js";
import { isAdmin, isCoordinator, isEB } from "../utils/access.js";
import { participationOutcome } from "../utils/outcome.js";
import { toNameRef, toStaffUser } from "../utils/safeUser.js";

const DAY = 24 * 60 * 60 * 1000;

/*
 * Standing rules (shown on the roster):
 * - DEACTIVATED: the account has been switched off.
 * - INACTIVE: hasn't submitted anything for INACTIVE_AFTER_DAYS (counted
 *   from when the account was created if they never have). Picking a task
 *   is not activity: picks are unlimited and cost nothing.
 * - SLIPPING: in the last HISTORY_LENGTH finished tasks (in-progress picks
 *   don't take up the window), on time less than 60% of the time, or
 *   missed 2 or more.
 * - NEW: active, but no finished tasks yet.
 * - RELIABLE: everyone else.
 */
export const INACTIVE_AFTER_DAYS = 30;
export const HISTORY_LENGTH = 8;
const SLIPPING_ON_TIME_RATE = 0.6;
const SLIPPING_MISSED = 2;

function standingFor({ user, history, lastActivity, now }) {
  if (user.status === USER_STATUS.DEACTIVATED) return STANDING.DEACTIVATED;
  const activeSince = Date.parse(lastActivity ?? user.createdAt);
  if (!Number.isFinite(activeSince) || now - activeSince > INACTIVE_AFTER_DAYS * DAY) return STANDING.INACTIVE;

  const finished = history;
  if (finished.length === 0) return STANDING.NEW;

  const onTime = finished.filter((h) => h.outcome === OUTCOME.ON_TIME).length;
  const missed = finished.filter((h) => h.outcome === OUTCOME.MISSED).length;

  if (missed >= SLIPPING_MISSED) return STANDING.SLIPPING;
  if (finished.length >= 2 && onTime / finished.length < SLIPPING_ON_TIME_RATE) return STANDING.SLIPPING;
  return STANDING.RELIABLE;
}

function latest(...dates) {
  const times = dates.filter(Boolean).map((d) => Date.parse(d)).filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

/*
 * Who is in a report:
 * - admins: every coordinator and volunteer (filter by domain, coordinator or role);
 * - EB heads: the coordinators and volunteers of their domain;
 * - coordinators: their own volunteers.
 */
function inScope(actor, { domainId, coordinatorId, role } = {}) {
  return (user) => {
    if (user.role !== ROLES.VOLUNTEER && user.role !== ROLES.COORDINATOR) return false;
    if (isCoordinator(actor)) return user.role === ROLES.VOLUNTEER && user.coordinatorId === actor.id;
    if (isEB(actor) && user.domainId !== actor.domainId) return false;
    if (!isAdmin(actor) && !isEB(actor)) return false;
    if (isAdmin(actor) && domainId && user.domainId !== domainId) return false;
    if (coordinatorId && user.coordinatorId !== coordinatorId && user.id !== coordinatorId) return false;
    if (role && user.role !== role) return false;
    return true;
  };
}

/*
 * One row per person: their last HISTORY_LENGTH finished tasks with outcome
 * and score, totals, on-time rate, average score (a missed task counts as 0,
 * like on the board) and standing. A coordinator's record is their final work
 * on EB tasks; a volunteer's is their work on team tasks.
 */
export async function peopleReport(actor, filters = {}, now = Date.now()) {
  const [users, tasks, participations, submissions, evaluations, pushSubscriptions] = await Promise.all([
    store.list("Users"),
    store.list("Tasks"),
    store.list("Participations"),
    store.list("Submissions"),
    store.list("Evaluations"),
    store.list("PushSubscriptions")
  ]);

  const people = users.filter(inScope(actor, filters));
  const withNotifications = new Set(pushSubscriptions.map((s) => s.userId));

  return people.map((user) => {
    const all = participations
      .filter((p) => p.volunteerId === user.id)
      .map((p) => {
        const task = tasks.find((t) => t.id === p.taskId) ?? null;
        const submission = submissions.find((s) => s.participationId === p.id) ?? null;
        const evaluation = submission ? evaluations.find((e) => e.submissionId === submission.id) ?? null : null;
        return {
          participationId: p.id,
          taskId: p.taskId,
          title: task?.title ?? "Unknown task",
          level: task?.level ?? "DOMAIN",
          deadline: task?.deadline ?? null,
          chosenAt: p.chosenAt,
          submittedAt: submission?.submittedAt ?? null,
          submissionId: submission?.id ?? null,
          score: evaluation?.score ?? null,
          outcome: participationOutcome({ task, submission, now })
        };
      })
      .sort((a, b) => Date.parse(b.deadline) - Date.parse(a.deadline));

    const count = (outcome) => all.filter((h) => h.outcome === outcome).length;
    const totals = {
      taken: all.length,
      onTime: count(OUTCOME.ON_TIME),
      late: count(OUTCOME.LATE),
      missed: count(OUTCOME.MISSED),
      inProgress: count(OUTCOME.IN_PROGRESS)
    };
    const finished = totals.onTime + totals.late + totals.missed;
    // Missed counts as 0; submitted-but-unscored work waits for its score.
    const scores = all.map((h) => (h.outcome === OUTCOME.MISSED ? 0 : h.score)).filter((s) => typeof s === "number");
    // The window is the last HISTORY_LENGTH FINISHED tasks; open picks are listed separately.
    const history = all.filter((h) => h.outcome !== OUTCOME.IN_PROGRESS).slice(0, HISTORY_LENGTH);
    const current = all.filter((h) => h.outcome === OUTCOME.IN_PROGRESS);
    const lastActivity = latest(...all.map((h) => h.submittedAt));
    const person = toStaffUser(user);

    return {
      person,
      // Older name for the same object.
      volunteer: person,
      role: user.role,
      coordinator: user.coordinatorId ? toNameRef(users.find((u) => u.id === user.coordinatorId)) : null,
      teamSize: user.role === ROLES.COORDINATOR ? users.filter((u) => u.coordinatorId === user.id && u.status !== USER_STATUS.DEACTIVATED).length : null,
      history,
      current,
      totals,
      onTimeRate: finished ? totals.onTime / finished : null,
      averageScore: scores.length ? Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length) : null,
      lastActivity,
      standing: standingFor({ user, history, lastActivity, now }),
      // Have they set GradeX up? Signed in (own password), opened it from
      // their Home Screen, and turned notifications on (on any device).
      setup: {
        signedIn: !user.mustChangePassword,
        app: Boolean(user.appInstalledAt),
        notifications: withNotifications.has(user.id)
      }
    };
  });
}

// Older name, kept for existing callers.
export const volunteerReport = peopleReport;
