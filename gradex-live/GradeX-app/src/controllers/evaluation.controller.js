import * as evaluations from "../services/evaluation.service.js";
import { success } from "../utils/apiResponse.js";

export async function getPendingReviews(req, res) {
  return success(res, 200, { submissions: await evaluations.listPendingFor(req.user, req.valid.query) });
}

export async function getScoredReviews(req, res) {
  return success(res, 200, { submissions: await evaluations.listScoredFor(req.user, req.valid.query) });
}

export async function submitEvaluation(req, res) {
  return success(res, 201, {
    message: "Evaluation submitted successfully",
    evaluation: await evaluations.evaluate(req.user, req.body)
  });
}

export async function getEvaluationById(req, res) {
  return success(res, 200, { evaluation: await evaluations.getEvaluationFor(req.user, req.params.id) });
}

export async function getMyEvaluations(req, res) {
  return success(res, 200, { evaluations: await evaluations.listMyEvaluations(req.user) });
}

export async function updateEvaluation(req, res) {
  return success(res, 200, {
    message: "Score updated",
    evaluation: await evaluations.updateEvaluation(req.user, req.params.id, req.body)
  });
}
