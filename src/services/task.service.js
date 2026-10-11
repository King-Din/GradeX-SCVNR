import {
  getTasks as sheetsGetTasks,
  getTaskById as sheetsGetTaskById,
  createTask as sheetsCreateTask,
  updateTask as sheetsUpdateTask,
  getParticipations as sheetsGetParticipations,
  createParticipation as sheetsCreateParticipation
} from "./sheets.service.js";
import { TASK_STATUS, PARTICIPATION_STATUS } from "../constants/tasks.js";

/**
 * Shared data adapter referencing B2's Sheets service.
 * Exposed for testing and modular invocation.
 */
export const dataStore = {
  getTasks: sheetsGetTasks,
  getTaskById: sheetsGetTaskById,
  createTask: sheetsCreateTask,
  updateTask: sheetsUpdateTask,
  getParticipations: sheetsGetParticipations,
  createParticipation: sheetsCreateParticipation
};

/**
 * Service handling Task Management & Selection (B3)
 * Consumes the shared B2 Sheets Data Layer.
 */

export async function getAllTasks() {
  return dataStore.getTasks();
}

export async function getAvailableTasks() {
  const tasks = await dataStore.getTasks();
  return tasks.filter((task) => task.status === TASK_STATUS.AVAILABLE);
}

export async function getTaskById(id) {
  return dataStore.getTaskById(id);
}

export async function createTask(taskData, creatorId) {
  const taskToCreate = {
    title: taskData.title,
    description: taskData.description,
    domainId: taskData.domainId,
    deadline: taskData.deadline,
    status: taskData.status || TASK_STATUS.DRAFT,
    createdBy: creatorId,
    createdAt: new Date().toISOString()
  };

  return dataStore.createTask(taskToCreate);
}

export async function updateTask(id, updateData) {
  const existingTask = await dataStore.getTaskById(id);
  if (!existingTask) {
    return null;
  }

  // Validate status transitions if status is being updated:
  // DRAFT -> AVAILABLE (publishing)
  // AVAILABLE -> CLOSED (closing)
  if (updateData.status && updateData.status !== existingTask.status) {
    if (existingTask.status === TASK_STATUS.CLOSED) {
      const error = new Error("Closed tasks cannot be modified to a different status");
      error.status = 409;
      error.isConflict = true;
      throw error;
    }

    if (existingTask.status === TASK_STATUS.DRAFT && updateData.status === TASK_STATUS.CLOSED) {
      const error = new Error("Draft tasks cannot be closed directly; they must be published first");
      error.status = 409;
      error.isConflict = true;
      throw error;
    }
  }

  const merged = {
    ...existingTask,
    ...updateData
  };

  return dataStore.updateTask(id, merged);
}

export async function chooseTask(taskId, volunteerId) {
  const task = await dataStore.getTaskById(taskId);
  if (!task) {
    const error = new Error("Task not found");
    error.status = 404;
    error.isNotFound = true;
    throw error;
  }

  if (task.status !== TASK_STATUS.AVAILABLE) {
    const error = new Error("Task is not available for selection");
    error.status = 409;
    error.isConflict = true;
    throw error;
  }

  // Check duplicate participation (Appendix A decision: same volunteer cannot choose the same task twice)
  const participations = await dataStore.getParticipations();
  const alreadyChosen = participations.some(
    (p) => p.taskId === taskId && p.volunteerId === volunteerId
  );

  if (alreadyChosen) {
    const error = new Error("Volunteer has already selected this task");
    error.status = 409;
    error.isConflict = true;
    throw error;
  }

  // Create participation record.
  // Rule: Do NOT modify the task itself; the task stays selectable while AVAILABLE.
  const newParticipation = await dataStore.createParticipation({
    taskId,
    volunteerId,
    chosenAt: new Date().toISOString(),
    status: PARTICIPATION_STATUS.SELECTED
  });

  return newParticipation;
}

export async function getVolunteerParticipations(volunteerId) {
  const [participations, tasks] = await Promise.all([
    dataStore.getParticipations(),
    dataStore.getTasks()
  ]);

  const taskMap = new Map(tasks.map((task) => [task.id, task]));

  const callerParticipations = participations.filter(
    (p) => p.volunteerId === volunteerId
  );

  return callerParticipations.map((p) => ({
    id: p.id,
    taskId: p.taskId,
    volunteerId: p.volunteerId,
    chosenAt: p.chosenAt,
    status: p.status,
    task: taskMap.get(p.taskId) || null
  }));
}
