import * as store from "../data/store.js";
import { ROLES } from "../constants/roles.js";
import { OUTCOME, TASK_LEVEL, TASK_STATUS } from "../constants/tasks.js";
import { USER_STATUS } from "../constants/users.js";
import { findDomainHead, headsDomain, isAdmin, isCoordinator, isEB, isPublished, isTaskAudience, isVolunteer, leadsDomain, taskLevel } from "../utils/access.js";
import { badRequest, forbidden, notFound } from "../utils/appError.js";
import { isPastDeadline, participationOutcome } from "../utils/outcome.js";

/*
 * The board (transparency). Two kinds:
 *
 * - A TEAM board: one coordinator's team tasks, everyone's finished work,
 *   scores, feedback and a leaderboard of that team's volunteers. Volunteers
 *   and coordinators see their own team; EB heads any team in their domain.
 * - A DOMAIN board: the domain's EB tasks, the coordinators' final work and
 *   EB scores, and a leaderboard of the coordinators. For the domain's
 *   coordinators and its EB head.
 *
 * A task's work only appears once its deadline has passed, so nobody can
 * copy work that is still open. Late work is still accepted after the
 * deadline, so someone who picked the task and hasn't sent anything yet
 * doesn't see the others' work until they submit or the task is CLOSED.
 * Standings and Keep/Warn/Remove decisions are never shown here.
 */
function resolveScope(actor, { domainId, coordinatorId, level }, users) {
  const coordinatorById = (id) => users.find((u) => u.id === id && u.role === ROLES.COORDINATOR);

  if (isVolunteer(actor)) {
    if (level === TASK_LEVEL.DOMAIN) throw forbidden("The coordinators' board is for coordinators and the EB");
    if (!actor.coordinatorId) throw badRequest(actor.domainId ? "Choose your coordinator first" : "Choose your domain first");
    return { level: TASK_LEVEL.TEAM, coordinator: coordinatorById(actor.coordinatorId) ?? { id: actor.coordinatorId, name: "Your coordinator", domainId: actor.domainId } };
  }

  if (isCoordinator(actor)) {
    if (level === TASK_LEVEL.DOMAIN) return { level, domainId: actor.domainId };
    return { level: TASK_LEVEL.TEAM, coordinator: users.find((u) => u.id === actor.id) ?? actor };
  }

  // EB heads and admins choose; an EB head only within their own domain.
  if (coordinatorId) {
    const coordinator = coordinatorById(coordinatorId);
    if (!coordinator) throw notFound("Coordinator not found");
    if (!headsDomain(actor, coordinator.domainId)) throw forbidden("You can only view teams in your own domain");
    return { level: TASK_LEVEL.TEAM, coordinator };
  }
  const target = domainId ?? actor.domainId;
  if (!target) throw badRequest("Choose a domain");
  if (!headsDomain(actor, target)) throw forbidden("You can only view your own domain");
  return { level: TASK_LEVEL.DOMAIN, domainId: target };
}

export async function domainBoard(actor, query = {}, now = Date.now()) {
  const [domains, users, tasks, participations, submissions, evaluations] = await Promise.all([
    store.list("Domains"), store.list("Users"), store.list("Tasks"),
    store.list("Participations"), store.list("Submissions"), store.list("Evaluations")
  ]);

  const scope = resolveScope(actor, query, users);
  const team = scope.level === TASK_LEVEL.TEAM;
  const domainId = team ? scope.coordinator.domainId : scope.domainId;
  const domain = domains.find((d) => d.id === domainId);
  if (!domain) throw notFound("Domain not found");

  const belongs = (task) => team
    ? taskLevel(task) === TASK_LEVEL.TEAM && task.ownerId === scope.coordinator.id
    : taskLevel(task) === TASK_LEVEL.DOMAIN && task.domainId === domainId;

  const nameOf = (id) => users.find((u) => u.id === id)?.name ?? "Former member";
  const revealed = tasks
    .filter((t) => belongs(t) && isPublished(t) && isPastDeadline(t, now))
    .sort((a, b) => Date.parse(b.deadline) - Date.parse(a.deadline));
  const revealedIds = new Set(revealed.map((t) => t.id));
  const evaluationOf = (s) => evaluations.find((e) => e.submissionId === s.id) ?? null;

  const board = revealed.map((task) => {
    const picks = participations.filter((p) => p.taskId === task.id);
    const workHidden = stillOwesWork(actor, task, participations, submissions);
    const entries = workHidden ? [] : submissions
      .filter((s) => s.taskId === task.id)
      .map((s) => {
        const evaluation = evaluationOf(s);
        return {
          submissionId: s.id,
          volunteerId: s.volunteerId,
          volunteerName: nameOf(s.volunteerId),
          kind: s.kind,
          linkUrl: s.linkUrl,
          fileName: s.fileName,
          fileUrl: s.fileUrl,
          isLate: Boolean(s.isLate),
          submittedAt: s.submittedAt,
          score: evaluation?.score ?? null,
          feedback: evaluation?.feedback ?? null
        };
      })
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

    return {
      id: task.id,
      title: task.title,
      description: task.description,
      deadline: task.deadline,
      picked: picks.length,
      missed: picks.length - submissions.filter((s) => s.taskId === task.id).length,
      // true: you picked this and haven't submitted, so others' work stays
      // hidden until you do or the task is closed.
      workHidden,
      submissions: entries
    };
  });

  // Leaderboard over finished (revealed) tasks only, so open work never leaks.
  const members = users.filter((u) => u.status !== USER_STATUS.DEACTIVATED && (team
    ? u.role === ROLES.VOLUNTEER && u.coordinatorId === scope.coordinator.id
    : u.role === ROLES.COORDINATOR && u.domainId === domainId));

  const leaderboard = members.map((member) => {
    const mine = participations.filter((p) => p.volunteerId === member.id && revealedIds.has(p.taskId));
    const outcomes = mine.map((p) => {
      const task = tasks.find((t) => t.id === p.taskId);
      const submission = submissions.find((s) => s.participationId === p.id) ?? null;
      return { outcome: participationOutcome({ task, submission, now }), score: submission ? evaluationOf(submission)?.score ?? null : null };
    });
    // A missed task counts as 0, so skipping work can't lift someone's average.
    // Submitted-but-not-yet-scored work is left out until it has a score.
    const scores = outcomes
      .map((o) => (o.outcome === OUTCOME.MISSED ? 0 : o.score))
      .filter((s) => typeof s === "number");
    const count = (o) => outcomes.filter((x) => x.outcome === o).length;

    return {
      volunteerId: member.id,
      name: member.name,
      tasks: outcomes.length,
      scored: scores.length,
      averageScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      onTime: count(OUTCOME.ON_TIME),
      late: count(OUTCOME.LATE),
      missed: count(OUTCOME.MISSED)
    };
  });

  leaderboard.sort((a, b) =>
    (b.averageScore ?? -1) - (a.averageScore ?? -1) || b.onTime - a.onTime || a.missed - b.missed || a.name.localeCompare(b.name)
  );
  let rank = 0;
  leaderboard.forEach((row, i) => {
    if (row.averageScore === null) row.rank = null;
    else row.rank = i > 0 && leaderboard[i - 1].averageScore === row.averageScore && leaderboard[i - 1].onTime === row.onTime ? rank : (rank = i + 1);
  });

  const upcoming = tasks.filter((t) => belongs(t) && t.status === TASK_STATUS.AVAILABLE && !isPastDeadline(t, now));

  return {
    level: scope.level,
    domain,
    coordinator: team ? { id: scope.coordinator.id, name: scope.coordinator.name } : null,
    leaderboard,
    tasks: board,
    upcoming: upcoming.map((t) => ({ id: t.id, title: t.title, deadline: t.deadline }))
  };
}

// Picked a task, hasn't submitted yet, and the task still takes (late) work.
function stillOwesWork(actor, task, participations, submissions) {
  if (task.status === TASK_STATUS.CLOSED) return false;
  const pick = participations.find((p) => p.taskId === task.id && p.volunteerId === actor.id);
  return Boolean(pick) && !submissions.some((s) => s.participationId === pick.id);
}

/*
 * Can this person open someone else's submission on a task? Only the task's
 * own audience (the same team for a team task, the domain's coordinators for
 * an EB task), only after the deadline, never unpublished tasks, and not while
 * they still owe their own (late) work for it, unless it is closed.
 */
export function mayViewOthersWork(actor, task, { participations = [], submissions = [] } = {}, now = Date.now()) {
  return Boolean(
    task && isTaskAudience(actor, task) && isPublished(task) && isPastDeadline(task, now) &&
    !stillOwesWork(actor, task, participations, submissions)
  );
}

// Older name, kept for existing callers.
export const volunteerMayViewOthers = mayViewOthersWork;

/*
 * Basic facts about every domain for admins and EB heads: who heads it, how
 * many coordinators and volunteers, open tasks, on-time rate and average
 * score (missed = 0) over finished work at both levels.
 */
export async function domainsOverview(actor, now = Date.now()) {
  if (!isAdmin(actor) && !isEB(actor)) throw forbidden("The domains overview is for admins and EB heads");
  const [domains, users, tasks, participations, submissions, evaluations] = await Promise.all([
    store.list("Domains"), store.list("Users"), store.list("Tasks"),
    store.list("Participations"), store.list("Submissions"), store.list("Evaluations")
  ]);
  const active = (u) => u.status !== USER_STATUS.DEACTIVATED;

  return domains.map((domain) => {
    const inDomain = tasks.filter((t) => t.domainId === domain.id);
    const ids = new Set(inDomain.map((t) => t.id));
    const head = findDomainHead(users, domain.id);

    const finished = participations
      .filter((p) => ids.has(p.taskId))
      .map((p) => {
        const task = inDomain.find((t) => t.id === p.taskId);
        const submission = submissions.find((s) => s.participationId === p.id) ?? null;
        const evaluation = submission ? evaluations.find((e) => e.submissionId === submission.id) : null;
        return { outcome: participationOutcome({ task, submission, now }), score: evaluation?.score ?? null };
      })
      .filter((x) => x.outcome !== OUTCOME.IN_PROGRESS);
    const scores = finished.map((x) => (x.outcome === OUTCOME.MISSED ? 0 : x.score)).filter((n) => typeof n === "number");

    return {
      id: domain.id,
      name: domain.name,
      head: head ? { id: head.id, name: head.name } : null,
      mine: leadsDomain(actor, domain.id),
      coordinators: users.filter((u) => u.role === ROLES.COORDINATOR && u.domainId === domain.id && active(u)).length,
      volunteers: users.filter((u) => u.role === ROLES.VOLUNTEER && u.domainId === domain.id && active(u)).length,
      openTasks: inDomain.filter((t) => t.status === TASK_STATUS.AVAILABLE && !isPastDeadline(t, now)).length,
      onTimeRate: finished.length ? finished.filter((x) => x.outcome === OUTCOME.ON_TIME).length / finished.length : null,
      averageScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null
    };
  });
}
