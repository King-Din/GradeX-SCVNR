/*
 * TEMPORARY LOCAL CONTRACT ADAPTER.
 *
 * IMPORTANT:
 * B2 owns the real Google Sheets implementation.
 * Replace the contents of this file with B2's implementation before
 * production integration, or merge B2's shared service into this path.
 *
 * This adapter intentionally fails loudly so B1 never silently falls
 * back to an insecure in-memory production data source.
 */

export async function getUserById(id) {
  throw new Error(
    `Google Sheets user service is not connected. B2 must implement getUserById(${id}).`
  );
}

export async function getUserByEmail(email) {
  throw new Error(
    `Google Sheets user service is not connected. B2 must implement getUserByEmail(${email}).`
  );
}

export async function getUsers() {
  throw new Error(
    "Google Sheets user service is not connected. B2 must implement getUsers()."
  );
}
