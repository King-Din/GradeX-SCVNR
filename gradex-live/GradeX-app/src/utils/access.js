import { ROLES } from "../constants/roles.js";
import { TASK_LEVEL, TASK_STATUS } from "../constants/tasks.js";
import { USER_STATUS } from "../constants/users.js";

/*
 * Who may do what. Every service asks these questions instead of comparing
 * roles itself, so the hierarchy lives in one place:
 *
 *   ADMIN        everything
 *   EB           head of one domain: its DOMAIN tasks (publish, score the
 *                coordinators' final work), approves proposals, and sees the
 *                domain's TEAM tasks, people and scores without changing them
 *   COORDINATOR  picks the domain's published EB tasks; owns TEAM tasks
 *                (forwarded or approved) and scores their own volunteers
 *   VOLUNTEER    picks the published TEAM tasks of their own coordinator
 */
export const isAdmin = (user) => user?.role === ROLES.ADMIN;
export const isEB = (user) => user?.role === ROLES.EB;
export const isCoordinator = (user) => user?.role === ROLES.COORDINATOR;
export const isVolunteer = (user) => user?.role === ROLES.VOLUNTEER;
export const isStaff = (user) => isAdmin(user) || isEB(user) || isCoordinator(user);

// Rows saved before levels existed count as DOMAIN tasks.
export const taskLevel = (task) => (task?.level === TASK_LEVEL.TEAM ? TASK_LEVEL.TEAM : TASK_LEVEL.DOMAIN);
export const isTeamTask = (task) => taskLevel(task) === TASK_LEVEL.TEAM;
export const isDomainTask = (task) => Boolean(task) && taskLevel(task) === TASK_LEVEL.DOMAIN;

// A TEAM task with no parent started life as a coordinator's proposal.
export const isProposal = (task) => isTeamTask(task) && !task.parentTaskId;

// What the people who pick a task can see: never drafts, proposals or rejections.
export const isPublished = (task) => task?.status === TASK_STATUS.AVAILABLE || task?.status === TASK_STATUS.CLOSED;

/*
 * The person named as a domain's head: its EB head, or an admin who also
 * leads that domain (an admin's domainId). Either way there is one per domain.
 */
export const leadsDomain = (user, domainId) =>
  (isEB(user) || isAdmin(user)) && Boolean(user.domainId) && user.domainId === domainId;

export const findDomainHead = (users, domainId) =>
  users.find((u) => leadsDomain(u, domainId) && u.status !== USER_STATUS.DEACTIVATED) ?? null;

// The EB head of this domain (admins head every domain).
export function headsDomain(user, domainId) {
  if (isAdmin(user)) return true;
  return isEB(user) && Boolean(user.domainId) && user.domainId === domainId;
}

/*
 * Edits, publishes, closes and scores work on a task:
 * DOMAIN -> the domain's EB head; TEAM -> the coordinator who owns it.
 */
export function canManageTask(user, task) {
  if (!task || !user) return false;
  if (isAdmin(user)) return true;
  if (isTeamTask(task)) return isCoordinator(user) && task.ownerId === user.id;
  return isEB(user) && Boolean(user.domainId) && user.domainId === task.domainId;
}

export const canScoreTask = canManageTask;

// Sees everything about a task (picks, submissions, scores): its manager,
// plus the domain's EB head for the TEAM tasks under them (view only).
export function canOverseeTask(user, task) {
  if (canManageTask(user, task)) return true;
  return Boolean(task) && isEB(user) && Boolean(user.domainId) && user.domainId === task.domainId;
}

// The people a task is meant for (scope only; status and deadline are checked separately).
export function isTaskAudience(user, task) {
  if (!task || !user) return false;
  if (isTeamTask(task)) return isVolunteer(user) && Boolean(user.coordinatorId) && user.coordinatorId === task.ownerId;
  return isCoordinator(user) && Boolean(user.domainId) && user.domainId === task.domainId;
}

/*
 * Staff scope over another person (standings, decisions, deactivation):
 * admins everyone; EB heads the coordinators and volunteers of their domain;
 * coordinators their own volunteers.
 */
export function overseesPerson(actor, person) {
  if (!actor || !person || actor.id === person.id) return false;
  if (isAdmin(actor)) return true;
  const worker = person.role === ROLES.COORDINATOR || person.role === ROLES.VOLUNTEER;
  if (isEB(actor)) return worker && Boolean(actor.domainId) && person.domainId === actor.domainId;
  if (isCoordinator(actor)) return person.role === ROLES.VOLUNTEER && person.coordinatorId === actor.id;
  return false;
}
