import fs from "node:fs";
import { google } from "googleapis";
import { env } from "../config/env.js";

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive"
];

let auth;

/*
 * A service account is used when configured: it never expires and is not tied
 * to one person's Google account. Share the spreadsheet and the Drive folder
 * (a Shared Drive folder, so uploads have storage) with its email address.
 *
 * The OAuth refresh token is a fallback. If you use it, publish the Google
 * Cloud OAuth app ("In production"); tokens from apps left in "Testing" stop
 * working after 7 days.
 */
export function getGoogleAuth() {
  if (auth) return auth;

  const keyJson = env.GOOGLE_SERVICE_ACCOUNT_JSON
    ?? (env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE && fs.readFileSync(env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE, "utf8"));

  if (keyJson) {
    const credentials = JSON.parse(keyJson);
    auth = new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
  } else {
    auth = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
    auth.setCredentials({ refresh_token: env.GOOGLE_REFRESH_TOKEN });
  }

  return auth;
}

export function getSheetsClient() {
  return google.sheets({ version: "v4", auth: getGoogleAuth() });
}

export function getDriveClient() {
  return google.drive({ version: "v3", auth: getGoogleAuth() });
}
