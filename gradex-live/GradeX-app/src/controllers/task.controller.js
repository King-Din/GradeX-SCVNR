import * as tasks from "../services/task.service.js";
import { success } from "../utils/apiResponse.js";

export async function getTasks(req, res) {
  return success(res, 200, { tasks: await tasks.listTasksFor(req.user, req.valid.query) });
}

export async function getAvailableTasks(req, res) {
  return success(res, 200, { tasks: await tasks.listAvailableFor(req.user) });
}

export async function getMyTasks(req, res) {
  return success(res, 200, { participations: await tasks.listMyParticipations(req.user) });
}

export async function getTaskById(req, res) {
  return success(res, 200, { task: await tasks.getTaskFor(req.user, req.params.id) });
}

export async function getParticipants(req, res) {
  return success(res, 200, { participants: await tasks.listParticipants(req.user, req.params.id) });
}

export async function createTask(req, res) {
  return success(res, 201, { task: await tasks.createTask(req.user, req.body) });
}

export async function updateTask(req, res) {
  return success(res, 200, { task: await tasks.updateTask(req.user, req.params.id, req.body) });
}

export async function chooseTask(req, res) {
  return success(res, 201, { participation: await tasks.chooseTask(req.user, req.params.id) });
}

export async function forwardTask(req, res) {
  return success(res, 201, { task: await tasks.forwardTask(req.user, req.params.id, req.body) });
}

export async function getProposals(req, res) {
  return success(res, 200, { tasks: await tasks.listProposals(req.user) });
}

export async function proposeTask(req, res) {
  return success(res, 201, { task: await tasks.proposeTask(req.user, req.body) });
}

export async function approveTask(req, res) {
  return success(res, 200, { task: await tasks.reviewProposal(req.user, req.params.id, { approve: true, note: req.body.note, deadline: req.body.deadline }) });
}

export async function rejectTask(req, res) {
  return success(res, 200, { task: await tasks.reviewProposal(req.user, req.params.id, { approve: false, note: req.body.reason }) });
}
