import { peopleReport } from "../services/report.service.js";
import { success } from "../utils/apiResponse.js";

// `people` and (older name) `volunteers` are the same rows.
export async function getPeopleReport(req, res) {
  const people = await peopleReport(req.user, req.valid.query);
  return success(res, 200, { people, volunteers: people });
}
