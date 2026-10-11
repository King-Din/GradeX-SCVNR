import {
  getSubmissions,
  getEvaluations,
  createEvaluation,
  updateParticipation,
  getParticipations,
  getUsers,
  getTasks
} from "../services/sheets.service.js";

import { ROLES } from "../constants/roles.js";
import { ERROR_CODES } from "../constants/errors.js";
import { success, failure } from "../utils/apiResponse.js";

export async function getPendingSubmissions(req, res) {
  const [submissions, evaluations, users, tasks] = await Promise.all([
    getSubmissions(),
    getEvaluations(),
    getUsers(),
    getTasks()
  ]);

  // A submission is pending when no evaluation exists for it.
  const evaluatedSubmissionIds = new Set(
    evaluations.map((evaluation) => evaluation.submissionId)
  );

  const pendingSubmissions = submissions
    .filter((submission) => !evaluatedSubmissionIds.has(submission.id))
    .map((submission) => {
      const volunteer = users.find((user) => user.id === submission.volunteerId);
      const task = tasks.find((item) => item.id === submission.taskId);

      return {
        ...submission,
        volunteer: volunteer
          ? { id: volunteer.id, name: volunteer.name, email: volunteer.email }
          : null,
        task: task
          ? { id: task.id, title: task.title ?? task.name ?? "" }
          : null
      };
    });

  return success(res, 200, { submissions: pendingSubmissions });
}

export async function submitEvaluation(req, res) {
  const { submissionId, score, feedback } = req.body;

  const submissions = await getSubmissions();
  const submission = submissions.find((item) => item.id === submissionId);

  if (!submission) {
    return failure(res, 404, ERROR_CODES.NOT_FOUND, "Submission not found");
  }

  const evaluations = await getEvaluations();

  if (evaluations.some((evaluation) => evaluation.submissionId === submissionId)) {
    return failure(
      res,
      409,
      ERROR_CODES.CONFLICT,
      "This submission has already been evaluated"
    );
  }

  if (!submission.participationId) {
    return failure(
      res,
      400,
      ERROR_CODES.VALIDATION_ERROR,
      "Submission is missing its participation ID"
    );
  }

  const participations = await getParticipations();
  const participation = participations.find(
    (item) => item.id === submission.participationId
  );

  if (!participation) {
    return failure(
      res,
      404,
      ERROR_CODES.NOT_FOUND,
      "Participation linked to this submission was not found"
    );
  }

  // Evaluator identity always comes from the authenticated JWT, never the request body.
  const evaluationData = {
    submissionId,
    evaluatorId: req.user.id,
    score,
    feedback,
    evaluatedAt: new Date().toISOString()
  };

  const evaluation = await createEvaluation(evaluationData);

  // Mark the participation complete only after the evaluation is saved.
  await updateParticipation(submission.participationId, { status: "COMPLETED" });

  return success(res, 201, {
    message: "Evaluation submitted successfully",
    evaluation
  });
}

export async function getEvaluationById(req, res) {
  const evaluations = await getEvaluations();
  const evaluation = evaluations.find((item) => item.id === req.params.id);

  if (!evaluation) {
    return failure(res, 404, ERROR_CODES.NOT_FOUND, "Evaluation not found");
  }

  const submissions = await getSubmissions();
  const submission = submissions.find(
    (item) => item.id === evaluation.submissionId
  );

  if (!submission) {
    return failure(
      res,
      404,
      ERROR_CODES.NOT_FOUND,
      "Submission linked to this evaluation was not found"
    );
  }

  const isCoordinator = req.user.role === ROLES.COORDINATOR;
  const isOwner =
    req.user.role === ROLES.VOLUNTEER &&
    req.user.id === submission.volunteerId;

  if (!isCoordinator && !isOwner) {
    return failure(
      res,
      403,
      ERROR_CODES.FORBIDDEN,
      "You do not have permission to view this evaluation"
    );
  }

  return success(res, 200, { evaluation });
}
