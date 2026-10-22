// Client for the GradeX API (see ../../docs/API_CONTRACT.md).

const TOKEN_KEY = "gradex.token";

// In the installed app (opened from the Home Screen) a sign-in survives
// closing the app, like any app; in a browser tab it ends with the tab.
// Either way the token itself still expires on the server's schedule.
const installedApp = () => window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
const tokenStorage = () => (installedApp() ? localStorage : sessionStorage);

export const tokenStore = {
  get() {
    try { return tokenStorage().getItem(TOKEN_KEY); } catch { return null; }
  },
  set(token) {
    try { tokenStorage().setItem(TOKEN_KEY, token); } catch { /* private mode */ }
  },
  clear() {
    for (const store of [sessionStorage, localStorage]) {
      try { store.removeItem(TOKEN_KEY); } catch { /* nothing stored */ }
    }
  }
};

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const UNREACHABLE = "GradeX can't be reached right now. Check your connection and try again.";
const SERVER_TROUBLE = "GradeX ran into a problem. Try again in a moment.";

// Public settings from the backend. Falls back to safe defaults if the
// backend is older or unreachable.
const DEFAULT_CONFIG = { maxUploadMb: 10, demo: false };
let configPromise = null;
let configValue = DEFAULT_CONFIG;
export function loadConfig() {
  if (!configPromise) {
    configPromise = fetch("/api/config")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.success) {
          configValue = {
            maxUploadMb: Number(data.maxUploadMb) > 0 ? Number(data.maxUploadMb) : DEFAULT_CONFIG.maxUploadMb,
            demo: data.demo === true
          };
        }
        return configValue;
      })
      .catch(() => configValue);
  }
  return configPromise;
}
export const currentConfig = () => configValue;

// Set by App: any 401 signs the user out; a 403 PASSWORD_CHANGE_REQUIRED sends
// them to the "set your password" screen.
let onUnauthorized = () => {};
let onPasswordChangeRequired = () => {};
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}
export function setPasswordChangeHandler(handler) {
  onPasswordChangeRequired = handler;
}

const tooLarge = () => `That file is too large. The limit is ${currentConfig().maxUploadMb} MB.`;

async function request(path, { method = "GET", json, form, signal } = {}) {
  const token = tokenStore.get();
  let res;

  try {
    res = await fetch(path, {
      method,
      signal,
      headers: {
        ...(json ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: json ? JSON.stringify(json) : form
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new ApiError(0, "NETWORK", UNREACHABLE);
  }

  if (res.status === 413) throw new ApiError(413, "TOO_LARGE", tooLarge());

  const data = await res.json().catch(() => null);

  if (!data) {
    if (res.status === 401 && token && path !== "/api/auth/login") onUnauthorized();
    throw new ApiError(res.status, "NETWORK", res.status >= 500 ? SERVER_TROUBLE : `Request failed (${res.status})`);
  }

  if (!res.ok || !data.success) {
    const code = data.error?.code ?? data.code ?? "UNKNOWN";
    if (res.status === 401 && token && path !== "/api/auth/login") onUnauthorized();
    if (res.status === 403 && code === "PASSWORD_CHANGE_REQUIRED") onPasswordChangeRequired();
    throw new ApiError(res.status, code, explain(method, path, res.status, data));
  }

  return data;
}

// Turns backend errors into something a person can act on. A missing route
// means this version of the backend simply doesn't have that feature.
function explain(method, path, status, data) {
  const message = data.error?.message ?? data.message;
  if (status === 404 && message === "Route not found") {
    return `This version's backend doesn't have this feature (no ${method} ${path.split("?")[0]} route).`;
  }
  if (status === 429) return message ?? "Too many tries. Wait a minute and try again.";
  const detail = data.error?.details?.[0]?.message;
  if (detail && /validation failed/i.test(message ?? "")) return `${message}: ${detail}`;
  return message ?? `Request failed (${status})`;
}

export const api = {
  config: loadConfig,
  resetDemo: () => request("/api/demo/reset", { method: "POST" }),
  login: (email, password) => request("/api/auth/login", { method: "POST", json: { email, password } }),
  me: () => request("/api/auth/me"),
  logout: () => request("/api/auth/logout", { method: "POST" }),
  changePassword: (currentPassword, newPassword) =>
    request("/api/auth/change-password", { method: "POST", json: { currentPassword, newPassword } }),
  chooseDomain: (domainId) => request("/api/auth/domain", { method: "POST", json: { domainId } }),
  chooseCoordinator: (coordinatorId) => request("/api/auth/coordinator", { method: "POST", json: { coordinatorId } }),
  // { coordinatorId } for a team's board; { domainId, level: "DOMAIN" } for the coordinators' board.
  board: (params = {}, signal) => request(`/api/board${query(params)}`, { signal }),
  setDecision: (id, decision, note) => request(`/api/users/${id}/decision`, { method: "PUT", json: { decision, note } }),
  pushKey: () => request("/api/push/key"),
  pushSubscribe: (subscription) => request("/api/push/subscribe", { method: "POST", json: subscription }),
  pushUnsubscribe: (endpoint) => request("/api/push/unsubscribe", { method: "POST", json: { endpoint } }),
  appInstalled: () => request("/api/auth/app-installed", { method: "POST", json: {} }),

  domains: () => request("/api/domains"),
  domainsOverview: (signal) => request("/api/domains/overview", { signal }),
  domainCoordinators: (domainId, signal) => request(`/api/domains/${encodeURIComponent(domainId)}/coordinators`, { signal }),
  users: (signal) => request("/api/users", { signal }),
  createUser: (user) => request("/api/users", { method: "POST", json: user }),
  importUsers: (users) => request("/api/users/import", { method: "POST", json: { users } }),
  updateUser: (id, patch) => request(`/api/users/${id}`, { method: "PATCH", json: patch }),
  resetPassword: (id, password) => request(`/api/users/${id}/reset-password`, { method: "POST", json: { password } }),

  tasks: (signal, level) => request(`/api/tasks${query({ level })}`, { signal }),
  task: (id, signal) => request(`/api/tasks/${id}`, { signal }),
  proposals: (signal) => request("/api/tasks/proposals", { signal }),
  propose: (task) => request("/api/tasks/proposals", { method: "POST", json: task }),
  forwardTask: (id, body) => request(`/api/tasks/${id}/forward`, { method: "POST", json: body }),
  approveTask: (id, body = {}) => request(`/api/tasks/${id}/approve`, { method: "POST", json: body }),
  rejectTask: (id, reason) => request(`/api/tasks/${id}/reject`, { method: "POST", json: { reason } }),
  availableTasks: (signal) => request("/api/tasks/available", { signal }),
  myTasks: (signal) => request("/api/tasks/my", { signal }),
  participants: (taskId, signal) => request(`/api/tasks/${taskId}/participants`, { signal }),
  createTask: (task) => request("/api/tasks", { method: "POST", json: task }),
  updateTask: (id, patch) => request(`/api/tasks/${id}`, { method: "PUT", json: patch }),
  chooseTask: (id) => request(`/api/tasks/${id}/choose`, { method: "POST" }),

  submitLink: (taskId, linkUrl) => request("/api/submissions", { method: "POST", json: { taskId, linkUrl } }),
  submitFile: (taskId, file) => {
    const form = new FormData();
    form.append("taskId", taskId);
    form.append("file", file);
    return request("/api/submissions", { method: "POST", form });
  },

  pendingReviews: (signal, level) => request(`/api/reviews/pending${query({ level })}`, { signal }),
  scoredReviews: (signal, level) => request(`/api/reviews/scored${query({ level })}`, { signal }),
  evaluate: (submissionId, score, feedback) =>
    request("/api/evaluations", { method: "POST", json: { submissionId, score, feedback } }),
  updateEvaluation: (id, score, feedback) =>
    request(`/api/evaluations/${id}`, { method: "PUT", json: { score, feedback } }),
  myEvaluations: (signal) => request("/api/evaluations/my", { signal }),

  // { domainId, coordinatorId, role } filters; rows cover coordinators and volunteers.
  peopleReport: (filters = {}, signal) => request(`/api/reports/people${query(filters)}`, { signal })
};

function query(params = {}) {
  const entries = Object.entries(params).filter(([, value]) => value != null && value !== "");
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : "";
}

// Is this a link we're willing to open? Only http(s), never javascript: etc.
export function isSafeUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url.trim());
}

function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function authedFetch(path) {
  let res;
  try {
    res = await fetch(path, { headers: { Authorization: `Bearer ${tokenStore.get()}` } });
  } catch {
    throw new ApiError(0, "NETWORK", UNREACHABLE);
  }
  if (res.status === 401) {
    onUnauthorized();
    throw new ApiError(401, "UNAUTHORIZED", "Your session ended. Sign in again.");
  }
  if (res.status === 403) {
    const data = await res.clone().json().catch(() => null);
    if (data?.error?.code === "PASSWORD_CHANGE_REQUIRED") onPasswordChangeRequired();
  }
  return res;
}

// Downloads the Excel export (roster, submissions, tasks, people).
export async function downloadExport() {
  const res = await authedFetch("/api/export");
  if (!res.ok) throw new ApiError(res.status, "EXPORT", "The Excel file couldn't be created. Try again.");
  // Today's date where the person is (not UTC, which is a day behind in India before 5:30 am).
  saveBlob(await res.blob(), `GradeX-${new Date().toLocaleDateString("en-CA")}.xlsx`);
}

// Types a browser can show in a tab. Everything else (Word, PowerPoint) is
// downloaded with its real file name instead of opening a blank tab.
const VIEWABLE = /\.(pdf|png|jpe?g|txt)$/i;

// Opens what a volunteer submitted: their link, the Drive file, or (in local
// demo mode) the stored file, fetched with the login token.
export async function openSubmission(submission) {
  const external = submission.linkUrl || submission.fileUrl;
  if (external) {
    if (!isSafeUrl(external)) throw new ApiError(0, "UNSAFE", "That link doesn't look safe to open.");
    window.open(external, "_blank", "noopener,noreferrer");
    return;
  }

  const fileName = submission.fileName || `submission-${submission.id}`;
  const viewable = VIEWABLE.test(fileName);
  // Open the tab before any await so the popup blocker allows it.
  const tab = viewable ? window.open("", "_blank") : null;
  if (tab) tab.opener = null;

  try {
    const res = await authedFetch(`/api/submissions/${submission.id}/file`);
    if (!res.ok) throw new ApiError(res.status, "FILE", "That file couldn't be opened. Try again.");
    const blob = await res.blob();
    if (tab) {
      const url = URL.createObjectURL(blob);
      tab.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } else {
      saveBlob(blob, fileName);
    }
  } catch (error) {
    tab?.close();
    throw error;
  }
}
