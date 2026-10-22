import * as store from "../data/store.js";
import { PARTICIPATION_STATUS, TASK_STATUS } from "../constants/tasks.js";
import { canOverseeTask, isPublished } from "../utils/access.js";
import { badRequest, conflict, forbidden, notFound } from "../utils/appError.js";
import { isPastDeadline } from "../utils/outcome.js";
import { matchesFileType, removeFile, storeFile } from "./file.service.js";
import { mayViewOthersWork } from "./board.service.js";

/*
 * Submissions (B4).
 *
 * - Whoever picked a task submits a file or a link for it: a volunteer on a
 *   team task (their coordinator scores it), a coordinator their final work
 *   on an EB task (the EB head scores it).
 * - After the deadline a first submission is still accepted and marked late,
 *   so "late" and "never submitted" stay different.
 * - Before the deadline, and until it is scored, a submission can be replaced.
 * - The Submissions sheet is the source of truth for "already submitted", so a
 *   failed status update afterwards can never allow a duplicate.
 */
async function loadForSubmit(person, taskId) {
  const [task, participations, submissions, evaluations] = await Promise.all([
    store.findById("Tasks", taskId),
    store.list("Participations"),
    store.list("Submissions"),
    store.list("Evaluations")
  ]);

  const participation = participations.find((p) => p.taskId === taskId && p.volunteerId === person.id);

  if (!task || !isPublished(task)) throw notFound("Task not found");
  if (!participation) throw forbidden("Pick this task before submitting");
  if (task.status === TASK_STATUS.CLOSED) throw conflict("This task is closed and no longer takes submissions");

  const existing = submissions.find((s) => s.participationId === participation.id) ?? null;
  const late = isPastDeadline(task);

  if (existing && evaluations.some((e) => e.submissionId === existing.id)) {
    throw conflict("This submission has already been scored, so it can't be replaced");
  }
  if (existing && late) {
    throw conflict("The deadline has passed, so your submission can no longer be replaced");
  }

  return { participation, existing, late };
}

/*
 * The file is checked and stored BEFORE the write lock (uploads can be slow),
 * then every rule is checked again inside the lock. If that second check
 * fails, or the save does, the stored file is removed again.
 */
export async function submit(person, { taskId, linkUrl, file }) {
  if (!file && !linkUrl) throw badRequest("Attach a file or paste a link");
  if (file && linkUrl) throw badRequest("Send either a file or a link, not both");
  if (file && (!file.size || !file.buffer?.length || (file.mimetype === "text/plain" && !file.buffer.toString("utf8").trim()))) {
    throw badRequest("That file is empty. Choose the finished file and try again.");
  }
  if (file && !matchesFileType(file.mimetype, file.buffer)) {
    throw badRequest("That file doesn't look like the type it claims to be. Upload a real PDF, Word, PowerPoint, PNG, JPG or text file.");
  }

  const first = await loadForSubmit(person, taskId);
  const stored = file
    ? await storeFile({ buffer: file.buffer, mimeType: file.mimetype, prefix: first.participation.id })
    : null;

  let saved = false;
  let started = false;
  try {
    return await store.withWriteLock(async () => {
      started = true;
      try {
        const { participation, existing, late } = await loadForSubmit(person, taskId);

        const now = new Date().toISOString();
        const content = {
          kind: file ? "FILE" : "LINK",
          fileId: stored?.fileId ?? null,
          fileUrl: stored?.fileUrl ?? null,
          fileName: file ? file.originalname.slice(0, 200) : null,
          linkUrl: file ? null : linkUrl,
          updatedAt: now
        };

        let submission;
        if (existing) {
          submission = await store.update("Submissions", existing.id, content);
          saved = true;
          if (existing.fileId && existing.fileId !== content.fileId) await removeFile(existing.fileId);
        } else {
          submission = await store.insert("Submissions", {
            participationId: participation.id,
            taskId,
            volunteerId: person.id,
            ...content,
            isLate: late,
            submittedAt: now
          }, {
            unique: (rows) => rows.some((s) => s.participationId === participation.id),
            duplicateMessage: "You have already submitted this task"
          });
        }
        saved = true;

        if (participation.status === PARTICIPATION_STATUS.SELECTED) {
          await store.update("Participations", participation.id, { status: PARTICIPATION_STATUS.SUBMITTED });
        }

        return { submission, replaced: Boolean(existing) };
      } catch (error) {
        // Failed before the row was saved: the uploaded file has no row to belong to.
        if (stored && !saved) await removeFile(stored.fileId);
        throw error;
      }
    });
  } catch (error) {
    // Too busy to even start: nothing was saved. (Once started, the work above
    // finishes on its own and cleans up after itself; deleting here could
    // remove the file of a row that's about to be saved.)
    if (stored && !started) await removeFile(stored.fileId);
    throw error;
  }
}

async function withContext(submission) {
  const [tasks, evaluations] = await Promise.all([store.list("Tasks"), store.list("Evaluations")]);
  const task = tasks.find((t) => t.id === submission.taskId) ?? null;
  return {
    ...submission,
    task: task ? { id: task.id, title: task.title, deadline: task.deadline, domainId: task.domainId, level: task.level ?? "DOMAIN", ownerId: task.ownerId ?? null } : null,
    evaluation: evaluations.find((e) => e.submissionId === submission.id) ?? null
  };
}

// Your own submissions, each with its score and feedback once scored.
export async function listMySubmissions(person) {
  const submissions = (await store.list("Submissions")).filter((s) => s.volunteerId === person.id);
  return Promise.all(submissions.map(withContext));
}

/*
 * The person who sent it, the staff who run or oversee the task, and (per the
 * board rule) the others who worked on the same task. Anyone else gets 404 so
 * we never confirm that someone else's submission exists.
 */
export async function getSubmissionFor(actor, id) {
  const submission = await store.findById("Submissions", id);
  if (!submission) throw notFound("Submission not found");

  const task = await store.findById("Tasks", submission.taskId);
  const isOwner = submission.volunteerId === actor.id;

  if (!isOwner && !canOverseeTask(actor, task)) {
    const [participations, submissions] = await Promise.all([store.list("Participations"), store.list("Submissions")]);
    if (!mayViewOthersWork(actor, task, { participations, submissions })) throw notFound("Submission not found");
  }
  return withContext(submission);
}
