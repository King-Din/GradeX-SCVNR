import * as store from "../data/store.js";
import { PARTICIPATION_STATUS } from "../constants/tasks.js";
import { canOverseeTask, canScoreTask, taskLevel } from "../utils/access.js";
import { conflict, forbidden, notFound } from "../utils/appError.js";
import { toPersonRef } from "../utils/safeUser.js";
import { notifySafely } from "./notify.service.js";

/*
 * Scoring at two levels (B5). Work is scored by the person it was sent to:
 * a volunteer's team work by the coordinator who owns the team task, a
 * coordinator's final work by their domain's EB head. Admins can score
 * anything. EB heads also see their domain's team-level scores (view only).
 */

async function loadAll() {
  const [submissions, evaluations, users, tasks] = await Promise.all([
    store.list("Submissions"),
    store.list("Evaluations"),
    store.list("Users"),
    store.list("Tasks")
  ]);
  return { submissions, evaluations, users, tasks };
}

function decorate(submission, { users, tasks, evaluations }, actor = null) {
  const task = tasks.find((t) => t.id === submission.taskId);
  const evaluation = evaluations.find((e) => e.submissionId === submission.id) ?? null;
  return {
    ...submission,
    volunteer: toPersonRef(users.find((u) => u.id === submission.volunteerId)),
    task: task
      ? { id: task.id, title: task.title, deadline: task.deadline, domainId: task.domainId, level: taskLevel(task), ownerId: task.ownerId ?? null, parentTaskId: task.parentTaskId ?? null }
      : null,
    evaluation,
    evaluator: evaluation ? toPersonRef(users.find((u) => u.id === evaluation.evaluatorId)) : null,
    ...(actor ? { canScore: Boolean(task) && canScoreTask(actor, task) && submission.volunteerId !== actor.id } : {})
  };
}

function inScope(actor, data, level) {
  return (submission) => {
    const task = data.tasks.find((t) => t.id === submission.taskId);
    return Boolean(task) && canOverseeTask(actor, task) && submission.volunteerId !== actor.id && (!level || taskLevel(task) === level);
  };
}

/*
 * Unscored work in the reviewer's scope, oldest first. Each item says
 * whether this reviewer may score it (`canScore`); EB heads see their
 * domain's team-level work with canScore false.
 */
export async function listPendingFor(actor, { level } = {}) {
  const data = await loadAll();
  const scored = new Set(data.evaluations.map((e) => e.submissionId));

  return data.submissions
    .filter((s) => !scored.has(s.id))
    .filter(inScope(actor, data, level))
    .sort((a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt))
    .map((s) => decorate(s, data, actor));
}

// Already-scored work in the reviewer's scope, newest first.
export async function listScoredFor(actor, { level } = {}) {
  const data = await loadAll();
  const scored = new Set(data.evaluations.map((e) => e.submissionId));

  return data.submissions
    .filter((s) => scored.has(s.id))
    .filter(inScope(actor, data, level))
    .map((s) => decorate(s, data, actor))
    .sort((a, b) => Date.parse(b.evaluation.evaluatedAt) - Date.parse(a.evaluation.evaluatedAt));
}

const notice = (feedback) => (feedback.length > 120 ? `${feedback.slice(0, 117)}…` : feedback);

// Nobody scores their own work (e.g. a volunteer later made a coordinator).
function assertNotOwnWork(actor, submission) {
  if (submission.volunteerId === actor.id) throw forbidden("You can't score your own work");
}

// The scorer's scope; an EB head looking at team work gets a clear "no", not a 404.
function assertCanScore(actor, task, missing) {
  if (canScoreTask(actor, task)) return;
  if (canOverseeTask(actor, task)) throw forbidden("Team work is scored by the coordinator who runs the team task");
  throw notFound(missing);
}

export async function evaluate(actor, { submissionId, score, feedback }) {
  const { evaluation, task, submission } = await store.withWriteLock(async () => {
    const data = await loadAll();
    const submission = data.submissions.find((s) => s.id === submissionId);
    const task = submission && data.tasks.find((t) => t.id === submission.taskId);

    if (!submission || !task) throw notFound("Submission not found");
    assertCanScore(actor, task, "Submission not found");
    assertNotOwnWork(actor, submission);
    if (data.evaluations.some((e) => e.submissionId === submissionId)) {
      throw conflict("This submission has already been scored");
    }

    // Evaluator identity always comes from the login, never the request body.
    const evaluation = await store.insert("Evaluations", {
      submissionId,
      evaluatorId: actor.id,
      score,
      feedback,
      evaluatedAt: new Date().toISOString()
    }, {
      unique: (rows) => rows.some((e) => e.submissionId === submissionId),
      duplicateMessage: "This submission has already been scored"
    });

    if (submission.participationId) {
      await store.update("Participations", submission.participationId, { status: PARTICIPATION_STATUS.COMPLETED });
    }

    return { evaluation, task, submission };
  });

  // After the lock: a slow push service never holds up anyone else's save.
  await notifySafely(submission.volunteerId, { title: `Scored ${score}/100: ${task.title}`, body: notice(feedback), url: "/" });
  return evaluation;
}

// Change a score or its feedback. Same people who could give it.
export async function updateEvaluation(actor, id, { score, feedback }) {
  const { evaluation, task, submission } = await store.withWriteLock(async () => {
    const data = await loadAll();
    const existing = data.evaluations.find((e) => e.id === id);
    const submission = existing && data.submissions.find((s) => s.id === existing.submissionId);
    const task = submission && data.tasks.find((t) => t.id === submission.taskId);

    if (!existing || !submission || !task) throw notFound("Evaluation not found");
    assertCanScore(actor, task, "Evaluation not found");
    assertNotOwnWork(actor, submission);

    const evaluation = await store.update("Evaluations", id, { score, feedback, updatedAt: new Date().toISOString() });
    return { evaluation, task, submission };
  });

  await notifySafely(submission.volunteerId, { title: `Score updated to ${score}/100: ${task.title}`, body: notice(feedback), url: "/" });
  return evaluation;
}

export async function getEvaluationFor(actor, id) {
  const data = await loadAll();
  const evaluation = data.evaluations.find((e) => e.id === id);
  const submission = evaluation && data.submissions.find((s) => s.id === evaluation.submissionId);
  const task = submission && data.tasks.find((t) => t.id === submission.taskId);

  const isOwner = submission && submission.volunteerId === actor.id;
  if (!evaluation || !submission || (!isOwner && !canOverseeTask(actor, task))) {
    throw notFound("Evaluation not found");
  }

  return { ...evaluation, submission: decorate(submission, data) };
}

// Scores on your own work (a volunteer's team work, a coordinator's final work).
export async function listMyEvaluations(person) {
  const data = await loadAll();
  const mine = new Map(data.submissions.filter((s) => s.volunteerId === person.id).map((s) => [s.id, s]));

  return data.evaluations
    .filter((e) => mine.has(e.submissionId))
    .map((e) => ({ ...e, submission: decorate(mine.get(e.submissionId), data) }))
    .sort((a, b) => Date.parse(b.evaluatedAt) - Date.parse(a.evaluatedAt));
}
