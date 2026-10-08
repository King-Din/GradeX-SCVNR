/*
 * B1/B2 integration boundary.
 *
 * B2 owns the Google Sheets implementation.
 * B1 must not call the Google Sheets API directly.
 *
 * Expected B2 exports:
 *   getUserById(id)
 *   getUserByEmail(email)
 *   getUsers()
 *
 * The easiest integration is for B2 to export these functions from:
 *   src/services/sheets.service.js
 *
 * Then replace the import below with B2's actual shared service path.
 */

import {
  getUserById as sheetsGetUserById,
  getUserByEmail as sheetsGetUserByEmail,
  getUsers as sheetsGetUsers
} from "./sheets.service.js";

export async function getUserById(id) {
  return sheetsGetUserById(id);
}

export async function getUserByEmail(email) {
  return sheetsGetUserByEmail(email);
}

export async function getUsers() {
  return sheetsGetUsers();
}
