import * as store from "../data/store.js";
import { ROLES } from "../constants/roles.js";
import { PARTICIPATION_STATUS, TASK_LEVEL, TASK_STATUS } from "../constants/tasks.js";
import { USER_STATUS } from "../constants/users.js";
import {
  canManageTask, canOverseeTask, findDomainHead, headsDomain, isAdmin, isCoordinator, isDomainTask, isEB, isProposal,
  isPublished, isTaskAudience, isTeamTask, taskLevel
} from "../utils/access.js";
import { badRequest, conflict, forbidden, notFound } from "../utils/appError.js";
import { isPastDeadline, participationOutcome } from "../utils/outcome.js";
import { toNameRef, toPersonRef } from "../utils/safeUser.js";
import { istWhen } from "../utils/time.js";
import { notifySafely } from "./notify.service.js";

/*
 * Tasks at two levels.
 *
 * DOMAIN: the EB head publishes to the domain's coordinators. A coordinator
 *   picks it (it's theirs to deliver), then does it alone or forwards it to
 *   their team, and finally submits the finished work for the EB head to score.
 * TEAM: a coordinator's task for their own volunteers: forwarded from a
 *   DOMAIN task (parentTaskId), or their own proposal once the EB head
 *   approves it. Volunteers pick it, submit, and the coordinator scores.
 */

function assertFutureDeadline(deadline, message = "The deadline must be in the future") {
  if (Date.parse(deadline) <= Date.now()) throw badRequest(message);
}

async function loadAll() {
  const [tasks, participations, submissions, evaluations, users] = await Promise.all([
    store.list("Tasks"),
    store.list("Participations"),
    store.list("Submissions"),
    store.list("Evaluations"),
    store.list("Users")
  ]);
  return { tasks, participations, submissions, evaluations, users };
}

function countsFor(task, { participations, submissions, evaluations }) {
  const picks = participations.filter((p) => p.taskId === task.id);
  const taskSubmissions = submissions.filter((s) => s.taskId === task.id);
  const scoredIds = new Set(evaluations.map((e) => e.submissionId));
  return {
    picked: picks.length,
    submitted: taskSubmissions.length,
    scored: taskSubmissions.filter((s) => scoredIds.has(s.id)).length,
    late: taskSubmissions.filter((s) => s.isLate).length
  };
}

const brief = (task) => (task ? { id: task.id, title: task.title, deadline: task.deadline, status: task.status } : null);

// Adds progress counts and the names behind a task (owner, parent, reviewer).
function decorate(task, data) {
  const nameOf = (id) => toNameRef(data.users.find((u) => u.id === id));
  return {
    ...task,
    level: taskLevel(task),
    counts: countsFor(task, data),
    owner: task.ownerId ? nameOf(task.ownerId) : null,
    creator: nameOf(task.createdBy),
    reviewer: task.reviewedBy ? nameOf(task.reviewedBy) : null,
    parent: task.parentTaskId ? brief(data.tasks.find((t) => t.id === task.parentTaskId)) : null,
    // How many coordinators forwarded this EB task to their team.
    forwards: isDomainTask(task) ? data.tasks.filter((t) => t.parentTaskId === task.id).length : 0
  };
}

function evaluationFor(submission, evaluations) {
  return submission ? evaluations.find((e) => e.submissionId === submission.id) ?? null : null;
}

// The team task a coordinator forwarded from an EB task, if any.
function forwardedBy(coordinatorId, parent, data) {
  const team = data.tasks.find((t) => t.parentTaskId === parent.id && t.ownerId === coordinatorId);
  return team ? { ...brief(team), counts: countsFor(team, data) } : null;
}

// A coordinator's own position on an EB task: picked, forwarded, final work, score.
function myWork(actor, task, data) {
  const participation = data.participations.find((p) => p.taskId === task.id && p.volunteerId === actor.id);
  if (!participation) return { picked: false, teamTask: null };
  const submission = data.submissions.find((s) => s.participationId === participation.id) ?? null;
  return {
    picked: true,
    participationId: participation.id,
    pickedAt: participation.chosenAt,
    submission,
    evaluation: evaluationFor(submission, data.evaluations),
    outcome: participationOutcome({ task, submission }),
    teamTask: forwardedBy(actor.id, task, data)
  };
}

function canView(actor, task, participations) {
  if (canOverseeTask(actor, task)) return true;
  if (participations.some((p) => p.taskId === task.id && p.volunteerId === actor.id)) return true;
  // Drafts, proposals and rejections stay with the people who run the task.
  return isPublished(task) && isTaskAudience(actor, task);
}

/*
 * The staff task list:
 * - admins: everything;
 * - EB heads: every task in their domain, both levels;
 * - coordinators: their domain's published EB tasks (with their own progress
 *   on each as `mine`) and their own team tasks, proposals included.
 */
export async function listTasksFor(actor, { level } = {}) {
  const data = await loadAll();
  const inScope = (task) => {
    if (isAdmin(actor)) return true;
    if (isEB(actor)) return task.domainId === actor.domainId;
    if (isTeamTask(task)) return task.ownerId === actor.id;
    return task.domainId === actor.domainId && isPublished(task);
  };

  return data.tasks
    .filter(inScope)
    .filter((task) => !level || taskLevel(task) === level)
    .map((task) => {
      const row = decorate(task, data);
      if (isCoordinator(actor) && isDomainTask(task)) row.mine = myWork(actor, task, data);
      return row;
    })
    .sort((a, b) => Date.parse(b.deadline) - Date.parse(a.deadline));
}

/*
 * Open tasks someone can pick right now: a volunteer gets their coordinator's
 * published team tasks; a coordinator gets their domain's published EB tasks.
 */
export async function listAvailableFor(actor) {
  const data = await loadAll();
  const mine = new Set(data.participations.filter((p) => p.volunteerId === actor.id).map((p) => p.taskId));

  return data.tasks
    .filter((task) => task.status === TASK_STATUS.AVAILABLE && isTaskAudience(actor, task) && !isPastDeadline(task))
    .map((task) => ({
      ...decorate(task, data),
      pickedByMe: mine.has(task.id),
      ...(isCoordinator(actor) ? { mine: myWork(actor, task, data) } : {})
    }))
    .sort((a, b) => Date.parse(a.deadline) - Date.parse(b.deadline));
}

export async function getTaskFor(actor, id) {
  const data = await loadAll();
  const task = data.tasks.find((t) => t.id === id);
  if (!task || !canView(actor, task, data.participations)) throw notFound("Task not found");
  const row = decorate(task, data);
  if (isCoordinator(actor) && isDomainTask(task)) row.mine = myWork(actor, task, data);
  return row;
}

// EB tasks: admins choose the domain; an EB head always publishes to their own.
function resolveDomain(actor, domainId) {
  if (isAdmin(actor)) {
    if (!domainId) throw badRequest("Choose a domain for this task");
    return domainId;
  }
  const target = domainId ?? actor.domainId;
  if (!headsDomain(actor, target)) throw forbidden("EB heads publish tasks only in the domain they lead");
  return target;
}

// The EB head (or an admin) publishes a task to the domain's coordinators.
export async function createTask(actor, data) {
  if (!isAdmin(actor) && !isEB(actor)) {
    throw forbidden("Coordinators propose their own tasks (POST /api/tasks/proposals) or forward an EB task to their team");
  }
  const domainId = resolveDomain(actor, data.domainId);
  if (!(await store.findById("Domains", domainId))) throw badRequest(`Domain ${domainId} does not exist`);
  assertFutureDeadline(data.deadline);

  return store.insert("Tasks", {
    title: data.title,
    description: data.description,
    domainId,
    deadline: data.deadline,
    status: data.status ?? TASK_STATUS.DRAFT,
    createdBy: actor.id,
    createdAt: new Date().toISOString(),
    level: TASK_LEVEL.DOMAIN,
    parentTaskId: null,
    ownerId: null
  });
}

async function headOf(domainId) {
  return findDomainHead(await store.list("Users"), domainId);
}

// A coordinator proposes a task for their own team; the EB head must approve it.
export async function proposeTask(coordinator, data) {
  if (!isCoordinator(coordinator) || !coordinator.domainId) throw forbidden("Only coordinators propose tasks");
  assertFutureDeadline(data.deadline);

  const task = await store.insert("Tasks", {
    title: data.title,
    description: data.description,
    domainId: coordinator.domainId,
    deadline: data.deadline,
    status: TASK_STATUS.PROPOSED,
    createdBy: coordinator.id,
    createdAt: new Date().toISOString(),
    level: TASK_LEVEL.TEAM,
    parentTaskId: null,
    ownerId: coordinator.id
  });

  const head = await headOf(coordinator.domainId);
  await notifySafely(head?.id, { title: `New proposal from ${coordinator.name}`, body: task.title, url: "/#approvals" });
  return task;
}

/*
 * "Forward to my team": the coordinator picks the EB task (if they haven't)
 * and opens a team task linked to it, which their volunteers can pick. One
 * forward per coordinator per EB task. The team deadline must fall on or
 * before the EB deadline, leaving time to put the final work together.
 */
export async function forwardTask(coordinator, parentId, data) {
  return store.withWriteLock(async () => {
    const [parent, tasks, participations] = await Promise.all([
      store.findById("Tasks", parentId), store.list("Tasks"), store.list("Participations")
    ]);

    if (!parent || !isDomainTask(parent) || !canView(coordinator, parent, participations)) throw notFound("Task not found");
    if (!isTaskAudience(coordinator, parent)) throw forbidden("Only the domain's coordinators forward its EB tasks");
    if (coordinator.status === USER_STATUS.DEACTIVATED) throw forbidden("Your account is deactivated");
    if (parent.status !== TASK_STATUS.AVAILABLE) throw conflict("This EB task isn't open any more");
    if (isPastDeadline(parent)) throw conflict("The EB deadline has passed. Submit your final work directly.");
    if (tasks.some((t) => t.parentTaskId === parent.id && t.ownerId === coordinator.id)) {
      throw conflict("You've already forwarded this task to your team");
    }

    const deadline = data.deadline ?? parent.deadline;
    assertFutureDeadline(deadline, "Your team's deadline must be in the future");
    if (Date.parse(deadline) > Date.parse(parent.deadline)) {
      throw badRequest("Set your team's deadline on or before the EB deadline, so you have time to put the final work together");
    }

    const picked = participations.some((p) => p.taskId === parent.id && p.volunteerId === coordinator.id);
    if (!picked) {
      await store.insert("Participations", {
        taskId: parent.id,
        volunteerId: coordinator.id,
        chosenAt: new Date().toISOString(),
        status: PARTICIPATION_STATUS.SELECTED
      }, {
        unique: (rows) => rows.some((p) => p.taskId === parent.id && p.volunteerId === coordinator.id),
        duplicateMessage: "You have already picked this task"
      });
    }

    return store.insert("Tasks", {
      title: data.title?.trim() || parent.title,
      description: data.description?.trim() || parent.description,
      domainId: parent.domainId,
      deadline,
      status: TASK_STATUS.AVAILABLE,
      createdBy: coordinator.id,
      createdAt: new Date().toISOString(),
      level: TASK_LEVEL.TEAM,
      parentTaskId: parent.id,
      ownerId: coordinator.id
    }, {
      unique: (rows) => rows.some((t) => t.parentTaskId === parent.id && t.ownerId === coordinator.id),
      duplicateMessage: "You've already forwarded this task to your team"
    });
  });
}

/*
 * The EB head (or an admin) approves a proposal, which publishes it to the
 * coordinator's team, or rejects it with a reason. An approval may set a new
 * deadline (needed if the proposed one has passed).
 */
export async function reviewProposal(actor, id, { approve, note, deadline }) {
  const { task, owner } = await store.withWriteLock(async () => {
    const task = await store.findById("Tasks", id);
    if (!task || !isProposal(task) || !headsDomain(actor, task.domainId)) throw notFound("Proposal not found");
    if (task.status !== TASK_STATUS.PROPOSED) throw conflict("This proposal has already been decided");

    const decided = { reviewedBy: actor.id, reviewedAt: new Date().toISOString(), reviewNote: note?.trim() || null };
    let saved;
    if (approve) {
      const finalDeadline = deadline ?? task.deadline;
      assertFutureDeadline(finalDeadline, "The proposed deadline has passed. Set a new deadline to approve it.");
      saved = await store.update("Tasks", id, { ...decided, status: TASK_STATUS.AVAILABLE, deadline: finalDeadline });
    } else {
      if (!decided.reviewNote) throw badRequest("Say why, so the coordinator knows what to change");
      saved = await store.update("Tasks", id, { ...decided, status: TASK_STATUS.REJECTED });
    }
    return { task: saved, owner: task.ownerId };
  });

  await notifySafely(owner, approve
    ? { title: `Approved: ${task.title}`, body: "It's now open for your team to pick.", url: "/#team" }
    : { title: `Not approved: ${task.title}`, body: task.reviewNote ?? "", url: "/#team" });
  return task;
}

// Proposals (team tasks that started as a coordinator's idea), newest first.
export async function listProposals(actor) {
  const data = await loadAll();
  return data.tasks
    .filter(isProposal)
    .filter((task) => isAdmin(actor) || (isEB(actor) ? task.domainId === actor.domainId : task.ownerId === actor.id))
    .map((task) => decorate(task, data))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export async function updateTask(actor, id, patch) {
  return store.withWriteLock(async () => {
    const [task, tasks, participations] = await Promise.all([
      store.findById("Tasks", id), store.list("Tasks"), store.list("Participations")
    ]);
    if (!task || !canManageTask(actor, task)) throw notFound("Task not found");

    if (task.status === TASK_STATUS.REJECTED) throw conflict("This proposal was turned down. Propose a new task instead.");
    if (task.status === TASK_STATUS.PROPOSED && patch.status && patch.status !== TASK_STATUS.PROPOSED) {
      throw conflict("A proposal opens to the team when the EB head approves it");
    }
    // What an approved proposal asks for is what the EB head approved.
    const changesBrief = (patch.title !== undefined && patch.title !== task.title) || (patch.description !== undefined && patch.description !== task.description);
    if (isProposal(task) && task.status !== TASK_STATUS.PROPOSED && !isAdmin(actor) && changesBrief) {
      throw conflict("Your EB head approved this task as it is. To change what it asks for, propose a new task.");
    }

    if (patch.domainId && patch.domainId !== task.domainId) {
      if (isTeamTask(task)) throw conflict("A team task stays in its coordinator's domain");
      resolveDomain(actor, patch.domainId);
      if (!(await store.findById("Domains", patch.domainId))) throw badRequest(`Domain ${patch.domainId} does not exist`);
      // Picks belong to the old domain's coordinators; moving would strand them.
      if (participations.some((p) => p.taskId === id)) {
        throw conflict("People have already picked this task, so it can't move to another domain");
      }
    }

    if (patch.deadline && patch.deadline !== task.deadline) {
      // Once a published task's deadline has passed, work has been shown on
      // the board and lateness decided; moving it would undo both. A draft
      // nobody has seen can still get a new date.
      if (isPastDeadline(task) && task.status !== TASK_STATUS.DRAFT) throw conflict("The deadline has passed, so it can't be changed");
      assertFutureDeadline(patch.deadline);
      const parent = task.parentTaskId ? tasks.find((t) => t.id === task.parentTaskId) : null;
      if (parent && Date.parse(patch.deadline) > Date.parse(parent.deadline)) {
        throw badRequest("Your team's deadline must be on or before the EB deadline");
      }
      // An EB deadline can't move before the team deadlines forwarded from it.
      const latestTeam = tasks
        .filter((t) => t.parentTaskId === task.id && t.status !== TASK_STATUS.CLOSED)
        .reduce((latest, t) => Math.max(latest, Date.parse(t.deadline) || 0), 0);
      if (latestTeam && Date.parse(patch.deadline) < latestTeam) {
        throw badRequest(`A coordinator's team is working to ${istWhen(latestTeam)}. Pick an EB deadline on or after that.`);
      }
    }

    // Publishing needs a deadline that's still ahead.
    if (patch.status === TASK_STATUS.AVAILABLE && task.status === TASK_STATUS.DRAFT) {
      const deadline = patch.deadline ?? task.deadline;
      if (Date.parse(deadline) <= Date.now()) throw conflict("This draft's deadline has passed. Give it a new deadline, then publish it.");
    }

    if (patch.status && patch.status !== task.status) {
      if (task.status === TASK_STATUS.CLOSED) throw conflict("Closed tasks cannot be reopened");
      if (task.status === TASK_STATUS.DRAFT && patch.status === TASK_STATUS.CLOSED) {
        throw conflict("Publish a draft before closing it");
      }
      if (task.status === TASK_STATUS.AVAILABLE && patch.status === TASK_STATUS.DRAFT) {
        throw conflict("A published task cannot go back to draft");
      }
    }

    return store.update("Tasks", id, patch);
  });
}

/*
 * Picking: a volunteer picks their coordinator's team tasks; a coordinator
 * picks their domain's EB tasks ("I'll deliver this").
 */
export async function chooseTask(actor, taskId) {
  return store.withWriteLock(async () => {
    const [task, participations] = await Promise.all([
      store.findById("Tasks", taskId),
      store.list("Participations")
    ]);

    if (!task || !canView(actor, task, participations)) throw notFound("Task not found");
    if (actor.status === USER_STATUS.DEACTIVATED) throw forbidden("Your account is deactivated");
    if (!isTaskAudience(actor, task)) {
      throw forbidden(isTeamTask(task) ? "This task is for another coordinator's team" : "Only the domain's coordinators pick its EB tasks");
    }
    if (task.status !== TASK_STATUS.AVAILABLE) throw conflict("This task is not open for picking");
    if (isPastDeadline(task)) throw conflict("The deadline for this task has passed");

    if (participations.some((p) => p.taskId === taskId && p.volunteerId === actor.id)) {
      throw conflict("You have already picked this task");
    }

    return store.insert("Participations", {
      taskId,
      volunteerId: actor.id,
      chosenAt: new Date().toISOString(),
      status: PARTICIPATION_STATUS.SELECTED
    }, {
      unique: (rows) => rows.some((p) => p.taskId === taskId && p.volunteerId === actor.id),
      duplicateMessage: "You have already picked this task"
    });
  });
}

// Someone's picked tasks with their submission, score and outcome.
export async function listMyParticipations(actor) {
  const data = await loadAll();

  return data.participations
    .filter((p) => p.volunteerId === actor.id)
    .map((p) => {
      const raw = data.tasks.find((t) => t.id === p.taskId) ?? null;
      const submission = data.submissions.find((s) => s.participationId === p.id) ?? null;
      const evaluation = evaluationFor(submission, data.evaluations);
      return {
        ...p,
        task: raw ? decorate(raw, data) : null,
        submission,
        evaluation,
        evaluator: evaluation ? toNameRef(data.users.find((u) => u.id === evaluation.evaluatorId)) : null,
        outcome: participationOutcome({ task: raw, submission }),
        teamTask: raw && isDomainTask(raw) ? forwardedBy(actor.id, raw, data) : null
      };
    })
    .sort((a, b) => Date.parse(b.task?.deadline) - Date.parse(a.task?.deadline));
}

/*
 * Everyone who picked a task, for the people who run or oversee it. On an EB
 * task each coordinator also shows the team task they forwarded.
 */
export async function listParticipants(actor, taskId) {
  const data = await loadAll();
  const task = data.tasks.find((t) => t.id === taskId);
  if (!task || !canOverseeTask(actor, task)) throw notFound("Task not found");

  return data.participations
    .filter((p) => p.taskId === taskId)
    .map((p) => {
      const submission = data.submissions.find((s) => s.participationId === p.id) ?? null;
      const evaluation = evaluationFor(submission, data.evaluations);
      return {
        ...p,
        volunteer: toPersonRef(data.users.find((u) => u.id === p.volunteerId)),
        submission,
        evaluation,
        evaluator: evaluation ? toNameRef(data.users.find((u) => u.id === evaluation.evaluatorId)) : null,
        outcome: participationOutcome({ task, submission }),
        teamTask: isDomainTask(task) ? forwardedBy(p.volunteerId, task, data) : null
      };
    });
}
