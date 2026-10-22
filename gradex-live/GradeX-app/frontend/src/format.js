const DAY = 24 * 60 * 60 * 1000;

const dateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });

export const fmtDate = (iso) => (iso ? dateFmt.format(new Date(iso)) : "—");
export const fmtDateTime = (iso) => (iso ? dateTimeFmt.format(new Date(iso)) : "—");
export const fmtWeekday = (iso) => (iso ? weekdayFmt.format(new Date(iso)) : "—");

// "in 4 days", "in 5 hours", "2 days ago"
export function relative(iso, now = Date.now()) {
  const diff = Date.parse(iso) - now;
  const abs = Math.abs(diff);
  const unit = abs >= DAY ? ["day", DAY] : abs >= 3600000 ? ["hour", 3600000] : ["minute", 60000];
  // Time left is rounded down (never promise more time than there is); time ago is rounded.
  const n = Math.max(1, diff >= 0 ? Math.floor(abs / unit[1]) : Math.round(abs / unit[1]));
  const label = `${n} ${unit[0]}${n === 1 ? "" : "s"}`;
  return diff >= 0 ? `in ${label}` : `${label} ago`;
}

export const isPast = (iso) => Date.parse(iso) < Date.now();

export const pct = (rate) => (rate == null ? "—" : `${Math.round(rate * 100)}%`);

export const initials = (name = "") =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("");

// <input type="datetime-local"> value -> ISO with the browser's own offset,
// which is what the API asks for (e.g. 2026-10-18T23:59:00+05:30).
export function localInputToIso(value) {
  const date = new Date(value);
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  return `${value.length === 16 ? `${value}:00` : value}${sign}${pad(offset / 60)}:${pad(offset % 60)}`;
}

export function isoToLocalInput(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const OUTCOME_LABEL = {
  ON_TIME: "On time",
  LATE: "Late",
  MISSED: "Missed",
  IN_PROGRESS: "In progress"
};

export const STANDING_LABEL = {
  RELIABLE: "Reliable",
  SLIPPING: "Slipping",
  INACTIVE: "Inactive",
  NEW: "New",
  DEACTIVATED: "Deactivated"
};

export const ROLE_LABEL = { ADMIN: "Admin", EB: "EB head", COORDINATOR: "Coordinator", VOLUNTEER: "Volunteer" };

// EB tasks go from the domain's EB head to its coordinators; team tasks from a coordinator to their volunteers.
export const LEVEL_LABEL = { DOMAIN: "EB task", TEAM: "Team task" };

export const firstName = (name = "") => name.split(" ")[0] || name;

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" });
export const today = () => dayFmt.format(new Date());

export function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

// Reads "#key" and falls back to the first allowed key. Fixes the address bar
// when the hash named a page this person can't open.
export function keyFromHash(keys) {
  const key = window.location.hash.replace("#", "");
  if (keys.includes(key)) return key;
  if (key) window.history.replaceState(null, "", `#${keys[0]}`);
  return keys[0];
}
