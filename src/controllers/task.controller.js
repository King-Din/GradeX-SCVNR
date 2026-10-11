import {
  getAllTasks as fetchAllTasks,
  getAvailableTasks as fetchAvailableTasks,
  getTaskById as fetchTaskById,
  createTask as createTaskService,
  updateTask as updateTaskService,
  chooseTask as chooseTaskService,
  getVolunteerParticipations as fetchVolunteerParticipations
} from "../services/task.service.js";
import { success, failure } from "../utils/apiResponse.js";
import { ERROR_CODES } from "../constants/errors.js";

export async function getTasks(req, res) {
  const tasks = await fetchAllTasks();
  return success(res, 200, { tasks });
}

export async function getAvailableTasks(req, res) {
  const tasks = await fetchAvailableTasks();
  return success(res, 200, { tasks });
}

export async function getTaskById(req, res) {
  const task = await fetchTaskById(req.params.id);

  if (!task) {
    return failure(
      res,
      404,
      ERROR_CODES.NOT_FOUND,
      "Task not found"
    );
  }

  return success(res, 200, { task });
}

export async function createTask(req, res) {
  const task = await createTaskService(req.body, req.user.id);
  return success(res, 201, { task });
}

export async function updateTask(req, res) {
  try {
    const updated = await updateTaskService(req.params.id, req.body);

    if (!updated) {
      return failure(
        res,
        404,
        ERROR_CODES.NOT_FOUND,
        "Task not found"
      );
    }

    return success(res, 200, { task: updated });
  } catch (error) {
    if (error.isConflict) {
      return failure(
        res,
        409,
        ERROR_CODES.CONFLICT,
        error.message
      );
    }
    throw error;
  }
}

export async function chooseTask(req, res) {
  try {
    const participation = await chooseTaskService(req.params.id, req.user.id);

    return success(res, 201, { participation });
  } catch (error) {
    if (error.isNotFound) {
      return failure(
        res,
        404,
        ERROR_CODES.NOT_FOUND,
        error.message
      );
    }
    if (error.isConflict) {
      return failure(
        res,
        409,
        ERROR_CODES.CONFLICT,
        error.message
      );
    }
    throw error;
  }
}

export async function getMyTasks(req, res) {
  const participations = await fetchVolunteerParticipations(req.user.id);
  return success(res, 200, { participations });
}
