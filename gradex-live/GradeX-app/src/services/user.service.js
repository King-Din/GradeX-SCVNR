import bcrypt from "bcrypt";
import * as store from "../data/store.js";
import { env } from "../config/env.js";
import { MAX_ADMINS, ROLES } from "../constants/roles.js";
import { USER_STATUS } from "../constants/users.js";
import { DEMO_EMAILS, DEMO_FIRST_LOGIN_EMAIL } from "../data/seed.js";

import { findDomainHead, isAdmin, isCoordinator, isEB, leadsDomain, overseesPerson } from "../utils/access.js";
import { AppError, badRequest, conflict, forbidden, notFound } from "../utils/appError.js";
import { toNameRef, toSafeUser, toStaffUser } from "../utils/safeUser.js";
import { passwordProblem } from "../validators/common.js";

const BCRYPT_ROUNDS = 12;

const normalizeEmail = (email) => String(email ?? "").trim().toLowerCase();
const isActive = (user) => Boolean(user) && user.status !== USER_STATUS.DEACTIVATED;

export async function getUsers() {
  return store.list("Users");
}

export async function getUserById(id) {
  return store.findById("Users", id);
}

// Sheet cells may have been typed with capitals; compare case-insensitively.
export async function getUserByEmail(email) {
  const wanted = normalizeEmail(email);
  return (await getUsers()).find((user) => normalizeEmail(user.email) === wanted) ?? null;
}

export async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/*
 * In DEMO_MODE everyone knows the sample accounts' password, so nobody may
 * change their password, role, status or email (that would lock other
 * visitors out). The first-login sample account may set its own password.
 */
export function isDemoAccount(user) {
  return Boolean(env.DEMO_MODE && user && DEMO_EMAILS.has(normalizeEmail(user.email)));
}

const demoLocked = () => forbidden("Demo accounts can't be changed. Add your own account to try this.");

function assertNewPassword(password, email) {
  const problem = passwordProblem(password, email);
  if (problem) throw badRequest(problem);
}

const nextTokenVersion = (user) => (Number(user.tokenVersion) || 0) + 1;

const domainName = (domains, id) => domains.find((d) => d.id === id)?.name ?? id;

/*
 * The hierarchy rules every account must satisfy, checked on create, import
 * and edit against the people already stored (`users`, minus `selfId`):
 *
 * - ADMIN: no domain, no coordinator; at most MAX_ADMINS active admins.
 * - EB: exactly one domain, and only one active EB head per domain.
 * - COORDINATOR: one domain.
 * - VOLUNTEER: a coordinator (an active COORDINATOR in the volunteer's
 *   domain), or none yet: then they choose at first login. Their domain
 *   follows the coordinator's.
 *
 * Returns the normalised { role, domainId, coordinatorId }.
 */
function assertNoOtherHead(others, domains, domainId, active) {
  const head = findDomainHead(others, domainId);
  if (active && head) throw conflict(`${domainName(domains, domainId)} already has an EB head (${head.name}). Each domain has exactly one.`);
}

function settleRole({ role, domainId = null, coordinatorId = null, status }, { users, domains, selfId = null, keptCoordinatorId = null }) {
  const others = users.filter((u) => u.id !== selfId);
  if (domainId && !domains.some((d) => d.id === domainId)) throw badRequest(`Domain ${domainId} does not exist`);
  const active = status !== USER_STATUS.DEACTIVATED;

  if (role === ROLES.ADMIN) {
    if (active && others.filter((u) => u.role === ROLES.ADMIN && isActive(u)).length >= MAX_ADMINS) {
      throw conflict(`There can only be ${MAX_ADMINS} admins. Make one of them something else first.`);
    }
    // An admin may also lead one domain, and is then named as its head.
    if (domainId) assertNoOtherHead(others, domains, domainId, active);
    return { role, domainId: domainId ?? null, coordinatorId: null };
  }

  if (role === ROLES.EB) {
    if (!domainId) throw badRequest("An EB head needs the domain they lead");
    assertNoOtherHead(others, domains, domainId, active);
    return { role, domainId, coordinatorId: null };
  }

  // A coordinator added without a domain chooses it at first sign-in.
  if (role === ROLES.COORDINATOR) return { role, domainId: domainId ?? null, coordinatorId: null };

  // Volunteer.
  if (!coordinatorId) return { role, domainId: domainId ?? null, coordinatorId: null };
  const coordinator = others.find((u) => u.id === coordinatorId);
  if (!coordinator || coordinator.role !== ROLES.COORDINATOR) throw badRequest("A volunteer's coordinator must be someone with the Coordinator role");
  if (!isActive(coordinator) && coordinatorId !== keptCoordinatorId) throw badRequest(`${coordinator.name} is deactivated. Choose an active coordinator.`);
  if (domainId && domainId !== coordinator.domainId) {
    throw badRequest(`${coordinator.name} coordinates ${domainName(domains, coordinator.domainId)}, not ${domainName(domains, domainId)}. Choose a coordinator in the volunteer's domain.`);
  }
  return { role, domainId: coordinator.domainId, coordinatorId };
}

// A coordinator with volunteers can't stop being one, or move domain, until
// those volunteers have another coordinator.
function assertNoOrphans(user, next, users) {
  if (user.role !== ROLES.COORDINATOR) return;
  // Same domain, or a first domain for a coordinator who had none (the team follows).
  if (next.role === ROLES.COORDINATOR && (next.domainId === user.domainId || !user.domainId)) return;
  const team = users.filter((u) => u.coordinatorId === user.id && u.role === ROLES.VOLUNTEER);
  if (team.length) {
    throw conflict(`${user.name} coordinates ${team.length} ${team.length === 1 ? "volunteer" : "volunteers"}. Move them to another coordinator first.`);
  }
}

// Admins see everyone; EB heads their domain; coordinators themselves and their own team.
function visibleTo(actor, user) {
  if (isAdmin(actor)) return true;
  if (user.id === actor.id) return true;
  if (isEB(actor)) return Boolean(actor.domainId) && user.domainId === actor.domainId;
  if (isCoordinator(actor)) return user.role === ROLES.VOLUNTEER && user.coordinatorId === actor.id;
  return false;
}

// Keep / Warn / Remove decisions are never shown to the person they're about.
const viewFor = (actor) => (user) => (user.id === actor.id ? toSafeUser(user) : toStaffUser(user));

export async function listUsersFor(actor) {
  return (await getUsers()).filter((user) => visibleTo(actor, user)).map(viewFor(actor));
}

export async function getUserFor(actor, id) {
  const user = await getUserById(id);
  if (!user || !visibleTo(actor, user)) throw notFound("User not found");
  return viewFor(actor)(user);
}

/*
 * `passwordHash` is worked out before the write lock is taken (bcrypt is slow).
 * `coordinatorEmail` (imports) is resolved to an ID here, so a batch can name
 * coordinators added earlier in the same batch.
 */
async function insertUser({ name, email, passwordHash, role, domainId, coordinatorId, coordinatorEmail }) {
  const [users, domains] = await Promise.all([getUsers(), store.list("Domains")]);

  if (coordinatorEmail && !coordinatorId) {
    const coordinator = users.find((u) => normalizeEmail(u.email) === normalizeEmail(coordinatorEmail));
    if (!coordinator) throw badRequest(`No coordinator with the email ${normalizeEmail(coordinatorEmail)}`);
    coordinatorId = coordinator.id;
  }
  if (role !== ROLES.VOLUNTEER && coordinatorId) throw badRequest("Only volunteers have a coordinator");
  if (users.some((u) => normalizeEmail(u.email) === normalizeEmail(email))) {
    throw conflict(`An account with ${normalizeEmail(email)} already exists`);
  }

  const settled = settleRole({ role, domainId: domainId ?? null, coordinatorId: coordinatorId ?? null }, { users, domains });

  // The storage guard repeats the checks that must hold across server
  // instances: one account per email, one active EB head per domain.
  return store.insert("Users", {
    name: name.trim(),
    email: normalizeEmail(email),
    passwordHash,
    ...settled,
    status: USER_STATUS.ACTIVE,
    createdAt: new Date().toISOString(),
    // Starting passwords are shared by the admin, so people must replace them.
    mustChangePassword: true,
    tokenVersion: 0
  }, {
    unique: (rows) => rows.some((row) =>
      normalizeEmail(row.email) === normalizeEmail(email) ||
      (leadsDomain(settled, settled.domainId) && leadsDomain(row, settled.domainId) && isActive(row))
    ),
    duplicateMessage: leadsDomain(settled, settled.domainId)
      ? "That email is taken, or this domain already has an EB head"
      : `An account with ${normalizeEmail(email)} already exists`
  });
}

function withHash({ password, ...rest }, passwordHash) {
  return { ...rest, passwordHash };
}

export async function createUser(data) {
  assertNewPassword(data.password, data.email);
  const passwordHash = await hashPassword(data.password);
  return store.withWriteLock(async () => toSafeUser(await insertUser(withHash(data, passwordHash))));
}

// Leaders first, so volunteers in a batch can name a coordinator added in the same batch.
const IMPORT_ORDER = { ADMIN: 0, EB: 1, COORDINATOR: 2, VOLUNTEER: 3 };
const IMPORT_BATCH = 25;

// Adds many people at once (e.g. a new batch from a CSV). Each row succeeds or
// fails on its own, so one bad email doesn't block the rest. Results come back
// in the order the rows were sent.
export async function importUsers(rows) {
  // Hash first, outside the lock (bcrypt is slow), once per distinct password:
  // a batch normally shares one starting password.
  const hashes = new Map();
  const prepared = [];
  for (const [index, row] of rows.entries()) {
    const problem = passwordProblem(row.password, row.email);
    if (problem) {
      prepared.push({ index, row, problem });
      continue;
    }
    if (!hashes.has(row.password)) hashes.set(row.password, await hashPassword(row.password));
    prepared.push({ index, row, passwordHash: hashes.get(row.password) });
  }
  const ordered = [...prepared].sort((a, b) => (IMPORT_ORDER[a.row.role] ?? 9) - (IMPORT_ORDER[b.row.role] ?? 9) || a.index - b.index);
  const results = new Array(rows.length);

  // Saved in small batches, each under its own lock, so a big import never
  // holds everyone else up (or times out) as one long operation.
  for (let start = 0; start < ordered.length; start += IMPORT_BATCH) {
    await store.withWriteLock(async () => {
      for (const { index, row, problem, passwordHash } of ordered.slice(start, start + IMPORT_BATCH)) {
        const email = normalizeEmail(row.email);
        if (problem) {
          results[index] = { email, ok: false, error: problem };
          continue;
        }
        try {
          const user = await insertUser(withHash(row, passwordHash));
          results[index] = { email: user.email, ok: true, user: toSafeUser(user) };
        } catch (error) {
          // Only our own, user-facing messages go back; anything else stays in the log.
          if (!(error instanceof AppError)) console.error(error);
          results[index] = { email, ok: false, error: error instanceof AppError ? error.message : "This person couldn't be added. Try again." };
        }
      }
    });
  }

  return results;
}

/*
 * Admins change anything. Below them:
 * - EB heads may (de)activate the coordinators and volunteers of their domain
 *   and move a volunteer to another coordinator of that domain.
 * - Coordinators may (de)activate their own volunteers.
 * History is kept either way; a deactivated person simply can't sign in.
 */
export async function updateUser(actor, id, patch) {
  return store.withWriteLock(async () => {
    const [users, domains] = await Promise.all([getUsers(), store.list("Domains")]);
    const user = users.find((u) => u.id === id);
    if (!user || !visibleTo(actor, user)) throw notFound("User not found");

    if (user.id === actor.id && patch.status === USER_STATUS.DEACTIVATED) {
      throw badRequest("You can't deactivate your own account");
    }
    if (user.id === actor.id && patch.role && patch.role !== user.role) {
      throw badRequest("You can't change your own role. Ask another admin.");
    }

    if (!isAdmin(actor)) {
      const allowed = isEB(actor) ? ["status", "coordinatorId"] : ["status"];
      if (!overseesPerson(actor, user) || !Object.keys(patch).every((key) => allowed.includes(key))) {
        throw forbidden(isEB(actor)
          ? "EB heads can only activate or deactivate people in their domain, and move volunteers between its coordinators"
          : "Coordinators can only activate or deactivate their own volunteers");
      }
      if ("coordinatorId" in patch && (user.role !== ROLES.VOLUNTEER || !patch.coordinatorId)) {
        throw badRequest("Choose a coordinator for this volunteer");
      }
    }

    const roleChanges = Boolean(patch.role && patch.role !== user.role);
    const deactivates = patch.status === USER_STATUS.DEACTIVATED && isActive(user);
    const reactivates = patch.status === USER_STATUS.ACTIVE && !isActive(user);
    const emailChanges = Boolean(patch.email && normalizeEmail(patch.email) !== normalizeEmail(user.email));
    const statusChanges = Boolean(patch.status && patch.status !== (user.status ?? USER_STATUS.ACTIVE));

    if (isDemoAccount(user) && (roleChanges || emailChanges || statusChanges)) throw demoLocked();

    // A deactivated coordinator can't score or run their team's tasks, so the
    // team moves first.
    if (deactivates && user.role === ROLES.COORDINATOR) {
      const team = users.filter((u) => u.role === ROLES.VOLUNTEER && u.coordinatorId === user.id && isActive(u)).length;
      if (team) throw conflict(`${user.name} coordinates ${team} ${team === 1 ? "volunteer" : "volunteers"}. Move them to another coordinator first.`);
    }

    // There must always be at least one active admin.
    if (user.role === ROLES.ADMIN && isActive(user) && (roleChanges || deactivates)) {
      const otherAdmins = users.filter((u) => u.id !== user.id && u.role === ROLES.ADMIN && isActive(u)).length;
      if (otherAdmins === 0) throw conflict("This is the last active admin. Make someone else an admin first.");
    }

    const role = patch.role ?? user.role;
    // A role change drops the old role's links unless new ones are given.
    const domainId = "domainId" in patch ? patch.domainId : role === ROLES.ADMIN && roleChanges ? null : user.domainId;
    let coordinatorId = "coordinatorId" in patch ? patch.coordinatorId : role === ROLES.VOLUNTEER ? user.coordinatorId : null;
    // A volunteer moved to another domain with no coordinator named chooses
    // one of the new domain's coordinators at their next sign-in.
    if (role === ROLES.VOLUNTEER && !("coordinatorId" in patch) && "domainId" in patch && patch.domainId !== user.domainId) coordinatorId = null;

    // Check the hierarchy whenever something it covers changes (or someone comes back).
    const structural = roleChanges || "domainId" in patch || "coordinatorId" in patch || reactivates;
    const changes = { ...patch };
    if (structural) {
      const settled = settleRole(
        { role, domainId, coordinatorId, status: patch.status ?? user.status },
        { users, domains, selfId: user.id, keptCoordinatorId: user.coordinatorId }
      );
      assertNoOrphans(user, settled, users);
      Object.assign(changes, settled);
    }
    if (roleChanges || deactivates) changes.tokenVersion = nextTokenVersion(user);
    if (emailChanges && users.some((u) => u.id !== user.id && normalizeEmail(u.email) === normalizeEmail(patch.email))) {
      throw conflict(`An account with ${normalizeEmail(patch.email)} already exists`);
    }
    if (changes.email) changes.email = normalizeEmail(changes.email);

    // Checked again against the exact rows being saved, so two edits on
    // different server instances can't both make a domain head or an admin.
    const oneOfRules = (others, next) => {
      if (!isActive(next)) return false;
      if (next.domainId && leadsDomain(next, next.domainId) && others.some((o) => leadsDomain(o, next.domainId) && isActive(o))) return true;
      return next.role === ROLES.ADMIN && others.filter((o) => o.role === ROLES.ADMIN && isActive(o)).length >= MAX_ADMINS;
    };
    const saved = await store.update("Users", id, changes, structural ? {
      unique: oneOfRules,
      duplicateMessage: "Someone else changed the domain heads or admins just now. Reload and try again."
    } : undefined);
    // A coordinator who gets their first domain brings their team along.
    if (saved.role === ROLES.COORDINATOR && saved.domainId && !user.domainId) await moveTeamToDomain(saved.id, saved.domainId);
    return toSafeUser(saved);
  });
}

export async function resetPassword(id, password) {
  const target = await getUserById(id);
  if (!target) throw notFound("User not found");
  if (isDemoAccount(target)) throw demoLocked();
  assertNewPassword(password, target.email);
  const passwordHash = await hashPassword(password);

  return store.withWriteLock(async () => {
    const user = await getUserById(id);
    if (!user) throw notFound("User not found");
    await store.update("Users", id, { passwordHash, mustChangePassword: true, tokenVersion: nextTokenVersion(user) });
  });
}

/*
 * Anyone changing their own password (required after an admin sets one).
 * Every older token stops working, so the caller gets the updated user back
 * and the controller hands out a fresh token.
 */
export async function changeOwnPassword(actor, currentPassword, newPassword) {
  const current = await getUserById(actor.id);
  if (!current || !(await bcrypt.compare(currentPassword, current.passwordHash ?? ""))) {
    throw badRequest("Your current password isn't right");
  }
  if (isDemoAccount(current) && normalizeEmail(current.email) !== DEMO_FIRST_LOGIN_EMAIL) throw demoLocked();
  if (currentPassword === newPassword) throw badRequest("Choose a password different from the one you were given");
  assertNewPassword(newPassword, current.email);
  const passwordHash = await hashPassword(newPassword);

  return store.withWriteLock(async () => {
    const user = await getUserById(actor.id);
    if (!user || user.passwordHash !== current.passwordHash) {
      throw conflict("Your password was changed somewhere else. Sign in again.");
    }
    return store.update("Users", user.id, { passwordHash, mustChangePassword: false, tokenVersion: nextTokenVersion(user) });
  });
}

// A coordinator's volunteers always share the coordinator's domain.
async function moveTeamToDomain(coordinatorId, domainId) {
  const team = (await getUsers()).filter((u) => u.role === ROLES.VOLUNTEER && u.coordinatorId === coordinatorId && u.domainId !== domainId);
  for (const volunteer of team) await store.update("Users", volunteer.id, { domainId });
}

// A volunteer (or a coordinator added without one) picks their domain once;
// after that only an admin can change it.
export async function chooseDomain(actor, domainId) {
  return store.withWriteLock(async () => {
    const user = await getUserById(actor.id);
    if (!user || ![ROLES.VOLUNTEER, ROLES.COORDINATOR].includes(user.role)) throw forbidden("Only volunteers and coordinators choose a domain");
    if (user.domainId) throw conflict("Your domain is already set. Ask an admin if it needs to change.");
    // A volunteer's domain is their coordinator's.
    if (user.role === ROLES.VOLUNTEER && user.coordinatorId) throw conflict("Your domain comes from your coordinator. Ask an admin if it needs to change.");
    if (!domainId) throw badRequest("Choose a domain");
    if (!(await store.findById("Domains", domainId))) throw badRequest(`Domain ${domainId} does not exist`);
    const updated = await store.update("Users", user.id, { domainId });
    if (user.role === ROLES.COORDINATOR) await moveTeamToDomain(user.id, domainId);
    return toSafeUser(updated);
  });
}

/*
 * First login, last step: a volunteer chooses their coordinator, once. It
 * must be an active coordinator in the volunteer's domain; a volunteer with
 * no domain yet takes the coordinator's. After that only an admin or the
 * domain's EB head can change it.
 */
export async function chooseCoordinator(actor, coordinatorId) {
  return store.withWriteLock(async () => {
    const user = await getUserById(actor.id);
    if (!user || user.role !== ROLES.VOLUNTEER) throw forbidden("Only volunteers choose a coordinator");
    if (user.coordinatorId) throw conflict("Your coordinator is already set. Ask your EB head or an admin if it needs to change.");

    const coordinator = await getUserById(coordinatorId);
    if (!coordinator || coordinator.role !== ROLES.COORDINATOR || !isActive(coordinator)) {
      throw badRequest("Choose one of the coordinators listed");
    }
    if (user.domainId && coordinator.domainId !== user.domainId) {
      throw badRequest("Choose a coordinator in your own domain");
    }
    return toSafeUser(await store.update("Users", user.id, { coordinatorId: coordinator.id, domainId: coordinator.domainId }));
  });
}

// The app reports, once, that this person opened GradeX from their Home Screen.
export async function markAppInstalled(actor) {
  return store.withWriteLock(async () => {
    const user = await getUserById(actor.id);
    if (!user) throw notFound("User not found");
    if (!user.appInstalledAt) await store.update("Users", user.id, { appInstalledAt: new Date().toISOString() });
  });
}

// Keep / Warn / Remove with a private note. Staff only, never shown to the person.
export async function setDecision(actor, id, { decision, note }) {
  return store.withWriteLock(async () => {
    const user = await getUserById(id);
    if (!user || !overseesPerson(actor, user) || ![ROLES.VOLUNTEER, ROLES.COORDINATOR].includes(user.role)) {
      throw notFound("Person not found");
    }
    return toStaffUser(await store.update("Users", id, {
      decision: decision ?? null,
      decisionNote: note?.trim() || null,
      decisionBy: actor.id,
      decisionAt: new Date().toISOString()
    }));
  });
}

/*
 * Every domain with its EB head's name. Anyone signed in may see this: the
 * first-login screen lists domains, and coordinators name their EB head.
 */
export async function listDomains() {
  const [domains, users] = await Promise.all([store.list("Domains"), getUsers()]);
  return domains.map((domain) => ({
    ...domain,
    head: toNameRef(findDomainHead(users, domain.id))
  }));
}

// The active coordinators of a domain (names and team sizes), for the first-login choice.
export async function listDomainCoordinators(domainId) {
  const [domain, users] = await Promise.all([store.findById("Domains", domainId), getUsers()]);
  if (!domain) throw notFound("Domain not found");
  return users
    .filter((u) => u.role === ROLES.COORDINATOR && u.domainId === domainId && isActive(u))
    .map((u) => ({ ...toNameRef(u), teamSize: users.filter((v) => v.coordinatorId === u.id && isActive(v)).length }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Names of the people above someone: their domain, its EB head, their coordinator.
export async function contextFor(user) {
  const [domains, users] = await Promise.all([store.list("Domains"), getUsers()]);
  const domain = domains.find((d) => d.id === user.domainId) ?? null;
  return {
    domain: domain ? { id: domain.id, name: domain.name } : null,
    head: domain ? toNameRef(findDomainHead(users, domain.id)) : null,
    coordinator: user.coordinatorId ? toNameRef(users.find((u) => u.id === user.coordinatorId)) : null
  };
}
