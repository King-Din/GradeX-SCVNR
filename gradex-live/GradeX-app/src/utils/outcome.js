import { OUTCOME } from "../constants/tasks.js";

/*
 * On time / late / missed / in progress for one picked task.
 * A submission after the deadline is accepted and counts as LATE.
 */
export function participationOutcome({ task, submission, now = Date.now() }) {
  if (submission) return submission.isLate ? OUTCOME.LATE : OUTCOME.ON_TIME;

  const deadline = Date.parse(task?.deadline);
  if (Number.isFinite(deadline) && now > deadline) return OUTCOME.MISSED;

  return OUTCOME.IN_PROGRESS;
}

export function isPastDeadline(task, now = Date.now()) {
  const deadline = Date.parse(task?.deadline);
  return Number.isFinite(deadline) && now > deadline;
}
