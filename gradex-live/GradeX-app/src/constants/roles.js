/*
 * The club's hierarchy:
 * - ADMIN: the app owner and the divisional president (at most MAX_ADMINS).
 *   Everything, every domain, every account.
 * - EB: head of exactly one domain. Publishes the domain's tasks to its
 *   coordinators, approves their proposals, scores their final work.
 * - COORDINATOR: one domain, with their own team of volunteers. Delivers EB
 *   tasks alone or forwards them to the team; scores the team's work.
 * - VOLUNTEER: belongs to one coordinator (and so to that coordinator's domain).
 */
export const ROLES = Object.freeze({
  ADMIN: "ADMIN",
  EB: "EB",
  COORDINATOR: "COORDINATOR",
  VOLUNTEER: "VOLUNTEER"
});

export const ROLE_VALUES = Object.values(ROLES);

export const MAX_ADMINS = 2;

export const ROLE_LABELS = Object.freeze({
  ADMIN: "Admin",
  EB: "EB (domain head)",
  COORDINATOR: "Coordinator",
  VOLUNTEER: "Volunteer"
});
