export function toSafeUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    domainId: user.domainId ?? null,
    coordinatorId: user.coordinatorId ?? null,
    status: user.status ?? "ACTIVE",
    mustChangePassword: Boolean(user.mustChangePassword)
  };
}

// Staff-only view: adds the Keep / Warn / Remove decision and private note.
export function toStaffUser(user) {
  if (!user) return null;
  return {
    ...toSafeUser(user),
    createdAt: user.createdAt ?? null,
    decision: user.decision ?? null,
    decisionNote: user.decisionNote ?? null,
    decisionBy: user.decisionBy ?? null,
    decisionAt: user.decisionAt ?? null
  };
}

// Just enough to label a person next to a task or submission.
export function toPersonRef(user) {
  return user ? { id: user.id, name: user.name, email: user.email, role: user.role, domainId: user.domainId ?? null } : null;
}

// A name only, for people outside your scope (e.g. a domain's EB head).
export function toNameRef(user) {
  return user ? { id: user.id, name: user.name } : null;
}
