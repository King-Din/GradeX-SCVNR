import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "a".repeat(64);
process.env.JWT_EXPIRES_IN = "1h";
process.env.GOOGLE_CLIENT_ID = "test_client_id";
process.env.GOOGLE_CLIENT_SECRET = "test_client_secret";
process.env.GOOGLE_REFRESH_TOKEN = "test_refresh_token";
process.env.GOOGLE_SPREADSHEET_ID = "test_spreadsheet_id";

const { TASK_STATUS, PARTICIPATION_STATUS } = await import("../src/constants/tasks.js");
const {
  taskIdParamSchema,
  createTaskSchema,
  updateTaskSchema
} = await import("../src/validators/task.validator.js");
const { taskRouter } = await import("../src/routes/task.routes.js");
const {
  dataStore,
  getAllTasks,
  getAvailableTasks,
  getTaskById,
  createTask,
  updateTask,
  chooseTask,
  getVolunteerParticipations
} = await import("../src/services/task.service.js");
const sheetsService = await import("../src/services/sheets.service.js");

test("Task & Participation constants match specifications", () => {
  assert.equal(TASK_STATUS.DRAFT, "DRAFT");
  assert.equal(TASK_STATUS.AVAILABLE, "AVAILABLE");
  assert.equal(TASK_STATUS.CLOSED, "CLOSED");

  assert.equal(PARTICIPATION_STATUS.SELECTED, "SELECTED");
  assert.equal(PARTICIPATION_STATUS.IN_PROGRESS, "IN_PROGRESS");
  assert.equal(PARTICIPATION_STATUS.SUBMITTED, "SUBMITTED");
  assert.equal(PARTICIPATION_STATUS.UNDER_REVIEW, "UNDER_REVIEW");
  assert.equal(PARTICIPATION_STATUS.COMPLETED, "COMPLETED");
});

test("taskIdParamSchema validates correct ID format and rejects invalid formats", () => {
  assert.equal(taskIdParamSchema.safeParse({ id: "T001" }).success, true);
  assert.equal(taskIdParamSchema.safeParse({ id: "T999" }).success, true);
  assert.equal(taskIdParamSchema.safeParse({ id: "T1234" }).success, true);

  assert.equal(taskIdParamSchema.safeParse({ id: "U001" }).success, false);
  assert.equal(taskIdParamSchema.safeParse({ id: "P001" }).success, false);
  assert.equal(taskIdParamSchema.safeParse({ id: "invalid" }).success, false);
  assert.equal(taskIdParamSchema.safeParse({ id: "T01" }).success, false); // needs at least 3 digits
});

test("createTaskSchema validates fields and sets default DRAFT status", () => {
  const valid = {
    title: "Clean Park",
    description: "Cleaning the community park",
    domainId: "D001",
    deadline: "2026-10-20T00:00:00.000Z"
  };

  const parsed = createTaskSchema.safeParse(valid);
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.status, "DRAFT");

  // Allowing explicit AVAILABLE status
  const parsedAvailable = createTaskSchema.safeParse({
    ...valid,
    status: "AVAILABLE"
  });
  assert.equal(parsedAvailable.success, true);
  assert.equal(parsedAvailable.data.status, "AVAILABLE");

  // Rejects invalid domain ID or empty title
  assert.equal(createTaskSchema.safeParse({ ...valid, title: "" }).success, false);
  assert.equal(createTaskSchema.safeParse({ ...valid, domainId: "invalid" }).success, false);
  assert.equal(createTaskSchema.safeParse({ ...valid, extraField: "not_allowed" }).success, false);
});

test("updateTaskSchema requires at least one field and allows valid status transitions", () => {
  assert.equal(updateTaskSchema.safeParse({}).success, false);
  assert.equal(updateTaskSchema.safeParse({ title: "Updated Title" }).success, true);
  assert.equal(updateTaskSchema.safeParse({ status: "AVAILABLE" }).success, true);
  assert.equal(updateTaskSchema.safeParse({ status: "CLOSED" }).success, true);
  assert.equal(updateTaskSchema.safeParse({ status: "INVALID_STATUS" }).success, false);
});

test("Router registers /available and /my BEFORE /:id parameter", () => {
  const routes = taskRouter.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: layer.route.path,
      method: Object.keys(layer.route.methods)[0].toUpperCase()
    }));

  const availableIndex = routes.findIndex((r) => r.path === "/available");
  const myIndex = routes.findIndex((r) => r.path === "/my");
  const idIndex = routes.findIndex((r) => r.path === "/:id");

  assert.ok(availableIndex >= 0, "/available route must exist");
  assert.ok(myIndex >= 0, "/my route must exist");
  assert.ok(idIndex >= 0, "/:id route must exist");

  assert.ok(
    availableIndex < idIndex,
    "/available route must be registered before /:id"
  );
  assert.ok(
    myIndex < idIndex,
    "/my route must be registered before /:id"
  );
});

test("chooseTask enforces B3 business rules: AVAILABLE check, no lock, duplicate check", async () => {
  const mockTasks = [
    {
      id: "T001",
      title: "Task 1",
      status: "AVAILABLE"
    },
    {
      id: "T002",
      title: "Task 2",
      status: "DRAFT"
    },
    {
      id: "T003",
      title: "Task 3",
      status: "CLOSED"
    }
  ];

  const mockParticipations = [
    {
      id: "P001",
      taskId: "T001",
      volunteerId: "U001",
      chosenAt: "2026-10-08T00:00:00.000Z",
      status: "SELECTED"
    }
  ];

  // Mock dataStore functions temporarily
  const origGetTaskById = dataStore.getTaskById;
  const origGetParticipations = dataStore.getParticipations;
  const origCreateParticipation = dataStore.createParticipation;

  dataStore.getTaskById = async (id) => mockTasks.find((t) => t.id === id) || null;
  dataStore.getParticipations = async () => [...mockParticipations];
  dataStore.createParticipation = async (data) => ({
    id: "P002",
    ...data
  });

  try {
    // 1. Trying to choose non-existent task throws 404
    await assert.rejects(
      async () => chooseTask("T999", "U002"),
      (err) => err.status === 404
    );

    // 2. Trying to choose DRAFT task throws 409
    await assert.rejects(
      async () => chooseTask("T002", "U002"),
      (err) => err.status === 409 && err.isConflict
    );

    // 3. Trying to choose CLOSED task throws 409
    await assert.rejects(
      async () => chooseTask("T003", "U002"),
      (err) => err.status === 409 && err.isConflict
    );

    // 4. Same volunteer choosing again throws 409 conflict
    await assert.rejects(
      async () => chooseTask("T001", "U001"),
      (err) => err.status === 409 && err.isConflict
    );

    // 5. A second volunteer choosing T001 succeeds (Never lock a task)
    const participation = await chooseTask("T001", "U002");
    assert.equal(participation.id, "P002");
    assert.equal(participation.taskId, "T001");
    assert.equal(participation.volunteerId, "U002");
    assert.equal(participation.status, "SELECTED");
    assert.ok(participation.chosenAt);
  } finally {
    dataStore.getTaskById = origGetTaskById;
    dataStore.getParticipations = origGetParticipations;
    dataStore.createParticipation = origCreateParticipation;
  }
});

test("getVolunteerParticipations joins participation records with task details", async () => {
  const mockTasks = [
    {
      id: "T001",
      title: "Community Clean-up",
      description: "Clean up park",
      domainId: "D001",
      deadline: "2026-10-15",
      status: "AVAILABLE",
      createdBy: "U002",
      createdAt: "2026-10-08"
    }
  ];

  const mockParticipations = [
    {
      id: "P001",
      taskId: "T001",
      volunteerId: "U001",
      chosenAt: "2026-10-08T10:00:00.000Z",
      status: "SELECTED"
    },
    {
      id: "P002",
      taskId: "T001",
      volunteerId: "U002",
      chosenAt: "2026-10-08T11:00:00.000Z",
      status: "SELECTED"
    }
  ];

  const origGetTasks = dataStore.getTasks;
  const origGetParticipations = dataStore.getParticipations;

  dataStore.getTasks = async () => [...mockTasks];
  dataStore.getParticipations = async () => [...mockParticipations];

  try {
    const user1Participations = await getVolunteerParticipations("U001");
    assert.equal(user1Participations.length, 1);
    assert.equal(user1Participations[0].id, "P001");
    assert.equal(user1Participations[0].taskId, "T001");
    assert.equal(user1Participations[0].volunteerId, "U001");
    assert.deepEqual(user1Participations[0].task, mockTasks[0]);

    const user3Participations = await getVolunteerParticipations("U003");
    assert.equal(user3Participations.length, 0);
  } finally {
    dataStore.getTasks = origGetTasks;
    dataStore.getParticipations = origGetParticipations;
  }
});

test("updateTask validates lifecycle transitions: DRAFT -> AVAILABLE, AVAILABLE -> CLOSED", async () => {
  const taskDraft = { id: "T001", status: "DRAFT", title: "Task 1" };
  const taskAvailable = { id: "T002", status: "AVAILABLE", title: "Task 2" };
  const taskClosed = { id: "T003", status: "CLOSED", title: "Task 3" };

  const origGetTaskById = dataStore.getTaskById;
  const origUpdateTask = dataStore.updateTask;

  dataStore.getTaskById = async (id) => {
    if (id === "T001") return { ...taskDraft };
    if (id === "T002") return { ...taskAvailable };
    if (id === "T003") return { ...taskClosed };
    return null;
  };
  dataStore.updateTask = async (id, data) => ({ ...data, id });

  try {
    // DRAFT -> AVAILABLE succeeds
    const published = await updateTask("T001", { status: "AVAILABLE" });
    assert.equal(published.status, "AVAILABLE");

    // AVAILABLE -> CLOSED succeeds
    const closed = await updateTask("T002", { status: "CLOSED" });
    assert.equal(closed.status, "CLOSED");

    // DRAFT -> CLOSED directly throws 409
    await assert.rejects(
      async () => updateTask("T001", { status: "CLOSED" }),
      (err) => err.status === 409 && err.isConflict
    );

    // CLOSED -> any transition throws 409
    await assert.rejects(
      async () => updateTask("T003", { status: "AVAILABLE" }),
      (err) => err.status === 409 && err.isConflict
    );

    // Non-existent task returns null
    const notFound = await updateTask("T999", { title: "New" });
    assert.equal(notFound, null);
  } finally {
    dataStore.getTaskById = origGetTaskById;
    dataStore.updateTask = origUpdateTask;
  }
});

test("getAvailableTasks only returns tasks with status AVAILABLE", async () => {
  const allTasks = [
    { id: "T001", status: "DRAFT" },
    { id: "T002", status: "AVAILABLE" },
    { id: "T003", status: "CLOSED" },
    { id: "T004", status: "AVAILABLE" }
  ];

  const origGetTasks = dataStore.getTasks;
  dataStore.getTasks = async () => allTasks;

  try {
    const available = await getAvailableTasks();
    assert.equal(available.length, 2);
    assert.deepEqual(available.map((t) => t.id), ["T002", "T004"]);
  } finally {
    dataStore.getTasks = origGetTasks;
  }
});

test("createTask populates createdBy, createdAt, and status", async () => {
  let createdPayload = null;
  const origCreateTask = dataStore.createTask;
  dataStore.createTask = async (data) => {
    createdPayload = data;
    return { id: "T010", ...data };
  };

  try {
    const created = await createTask(
      {
        title: "New Task",
        description: "Desc",
        domainId: "D001",
        deadline: "2026-10-30"
      },
      "U002"
    );

    assert.equal(created.id, "T010");
    assert.equal(created.createdBy, "U002");
    assert.equal(created.status, "DRAFT");
    assert.ok(created.createdAt);
  } finally {
    dataStore.createTask = origCreateTask;
  }
});

