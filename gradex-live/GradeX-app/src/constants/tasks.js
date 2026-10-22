/*
 * DRAFT -> AVAILABLE -> CLOSED for tasks published by the EB (or approved).
 * A coordinator's own proposal starts PROPOSED and becomes AVAILABLE when the
 * EB head approves it, or REJECTED (with a reason).
 */
export const TASK_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  AVAILABLE: "AVAILABLE",
  CLOSED: "CLOSED",
  PROPOSED: "PROPOSED",
  REJECTED: "REJECTED"
});

export const TASK_STATUS_VALUES = Object.values(TASK_STATUS);

/*
 * DOMAIN: published by the EB head to the domain's coordinators.
 * TEAM: a coordinator's task for their own volunteers, either forwarded from
 * a DOMAIN task (parentTaskId) or an approved proposal.
 */
export const TASK_LEVEL = Object.freeze({
  DOMAIN: "DOMAIN",
  TEAM: "TEAM"
});

export const TASK_LEVEL_VALUES = Object.values(TASK_LEVEL);

// Stored on each Participation row.
export const PARTICIPATION_STATUS = Object.freeze({
  SELECTED: "SELECTED",
  SUBMITTED: "SUBMITTED",
  COMPLETED: "COMPLETED"
});

export const PARTICIPATION_STATUS_VALUES = Object.values(PARTICIPATION_STATUS);

// Worked out from deadline + submission, never stored, so it can't go stale.
export const OUTCOME = Object.freeze({
  IN_PROGRESS: "IN_PROGRESS",
  ON_TIME: "ON_TIME",
  LATE: "LATE",
  MISSED: "MISSED"
});
