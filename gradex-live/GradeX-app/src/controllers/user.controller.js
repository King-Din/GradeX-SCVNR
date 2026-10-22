import * as users from "../services/user.service.js";
import { domainsOverview as overview } from "../services/board.service.js";
import { success } from "../utils/apiResponse.js";

export async function listUsers(req, res) {
  return success(res, 200, { users: await users.listUsersFor(req.user) });
}

export async function getUser(req, res) {
  return success(res, 200, { user: await users.getUserFor(req.user, req.params.id) });
}

export async function createUser(req, res) {
  return success(res, 201, { user: await users.createUser(req.body) });
}

export async function importUsers(req, res) {
  const results = await users.importUsers(req.body.users);
  return success(res, 200, {
    created: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results
  });
}

export async function updateUser(req, res) {
  return success(res, 200, { user: await users.updateUser(req.user, req.params.id, req.body) });
}

export async function setDecision(req, res) {
  return success(res, 200, { user: await users.setDecision(req.user, req.params.id, req.body) });
}

export async function resetPassword(req, res) {
  await users.resetPassword(req.params.id, req.body.password);
  return success(res, 200, { message: "Password reset" });
}

export async function listDomains(req, res) {
  return success(res, 200, { domains: await users.listDomains() });
}

export async function domainsOverview(req, res) {
  return success(res, 200, { domains: await overview(req.user) });
}

export async function listDomainCoordinators(req, res) {
  return success(res, 200, { coordinators: await users.listDomainCoordinators(req.params.id) });
}
