import webpush from "web-push";
import { env } from "../config/env.js";
import * as store from "../data/store.js";
import { PARTICIPATION_STATUS, TASK_STATUS } from "../constants/tasks.js";
import { USER_STATUS } from "../constants/users.js";
import { badRequest } from "../utils/appError.js";

/*
 * Phone notifications (web push). Volunteers allow notifications in the app;
 * we then send "due tomorrow" reminders and "your work was scored" alerts.
 * Works when VAPID keys are set; otherwise every call here quietly does nothing.
 */
const HOUR = 60 * 60 * 1000;
// How far ahead a "due soon" reminder goes out. Hourly-or-better runs use 24;
// a once-a-day run (Vercel Hobby cron) uses a bit more, so each deadline
// still gets exactly one reminder between the runs.
export const REMIND_WITHIN_HOURS = env.REMINDER_WINDOW_HOURS;
export const MAX_SUBSCRIPTIONS_PER_USER = 5;
export const PUSH_TIMEOUT_MS = 5000;
const REMINDER_CONCURRENCY = 5;

/*
 * Real browsers only ever hand out endpoints on these push services. Anything
 * else is refused, so the server never POSTs to an address someone typed in.
 */
const PUSH_HOSTS = ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"];
const PUSH_HOST_SUFFIXES = [".push.services.mozilla.com", ".notify.windows.com", ".push.apple.com"];

export function isAllowedPushEndpoint(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS.includes(host) || PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export const pushEnabled = () => Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

let sender = async (subscription, payload) => {
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  // A push service that never answers must not hold anything up.
  return webpush.sendNotification(subscription, payload, { TTL: 12 * 60 * 60, timeout: PUSH_TIMEOUT_MS });
};

// Tests swap in a fake sender.
export function setPushSender(fn) {
  sender = fn;
}

export function publicKey() {
  return pushEnabled() ? env.VAPID_PUBLIC_KEY : null;
}

/*
 * The endpoint URL is a secret only that browser knows, so whoever registers
 * it is the person now using that device: it is (re)bound to them. Each
 * person keeps at most MAX_SUBSCRIPTIONS_PER_USER devices; the oldest drops off.
 */
export async function saveSubscription(user, subscription) {
  const endpoint = subscription?.endpoint;
  const { p256dh, auth } = subscription?.keys ?? {};
  if (!endpoint || !p256dh || !auth) throw badRequest("That notification subscription isn't valid");
  if (!isAllowedPushEndpoint(endpoint)) throw badRequest("Notifications must come from your browser's push service");

  return store.withWriteLock(async () => {
    const now = new Date().toISOString();
    const all = await store.list("PushSubscriptions");
    const existing = all.find((s) => s.endpoint === endpoint);
    // The app re-registers this device on every visit: nothing to save when
    // it's already this person's, with the same keys.
    if (existing && existing.userId === user.id && existing.p256dh === p256dh && existing.auth === auth) return existing;

    let saved;
    if (existing) {
      saved = await store.update("PushSubscriptions", existing.id, { userId: user.id, p256dh, auth, createdAt: now });
    } else {
      try {
        // Guarded across server instances: one row per endpoint.
        saved = await store.insert("PushSubscriptions", { userId: user.id, endpoint, p256dh, auth, createdAt: now }, {
          unique: (rows) => rows.some((row) => row.endpoint === endpoint),
          duplicateMessage: "This device is already registered"
        });
      } catch (error) {
        const raced = (await store.list("PushSubscriptions")).find((s) => s.endpoint === endpoint);
        if (!raced) throw error;
        saved = await store.update("PushSubscriptions", raced.id, { userId: user.id, p256dh, auth, createdAt: now });
      }
    }

    const mine = (await store.list("PushSubscriptions"))
      .filter((s) => s.userId === user.id)
      .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0) || b.id.localeCompare(a.id));
    for (const old of mine.slice(MAX_SUBSCRIPTIONS_PER_USER)) {
      await store.update("PushSubscriptions", old.id, { userId: null });
    }
    return saved;
  });
}

export async function removeSubscription(user, endpoint) {
  const mine = (await store.list("PushSubscriptions")).filter((s) => s.endpoint === endpoint && s.userId === user.id);
  for (const row of mine) await store.update("PushSubscriptions", row.id, { userId: null });
}

export async function sendToUser(userId, message) {
  if (!pushEnabled() || !userId) return 0;
  // Rows saved before the allowlist existed are skipped too.
  const seen = new Set();
  const subscriptions = (await store.list("PushSubscriptions"))
    .filter((s) => s.userId === userId && isAllowedPushEndpoint(s.endpoint))
    // One notification per device, even if an old race left two rows for it.
    .filter((s) => !seen.has(s.endpoint) && seen.add(s.endpoint));
  let sent = 0;

  for (const s of subscriptions) {
    try {
      await sender({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(message));
      sent += 1;
    } catch (error) {
      // The phone unsubscribed or the browser data was cleared: forget it.
      if (error?.statusCode === 404 || error?.statusCode === 410) {
        await store.update("PushSubscriptions", s.id, { userId: null });
      } else {
        console.warn(`Push to ${userId} failed: ${error?.message}`);
      }
    }
  }
  return sent;
}

// Sends, but never lets a notification problem break the save that caused it.
// Awaited (not fire-and-forget) because hosted functions stop once they reply.
export async function notifySafely(userId, message) {
  try {
    return await sendToUser(userId, message);
  } catch (error) {
    console.warn(`Push failed: ${error.message}`);
    return 0;
  }
}

const remindersInFlight = new Set();

async function inPool(items, size, worker) {
  let next = 0;
  const lanes = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  });
  await Promise.all(lanes);
}

/*
 * "Due tomorrow" reminders: every picked task that hasn't been submitted and
 * is due within the next REMIND_WITHIN_HOURS gets one reminder. Run hourly
 * (scheduled function or server timer).
 *
 * - Sends run REMINDER_CONCURRENCY at a time; one failure never stops the rest.
 * - The log is checked again just before each send (and runs in the same
 *   process skip items another run is sending), so overlapping runs don't
 *   both remind; the log is written only after a send actually went out
 *   (a failed or impossible send is retried next run while the task is due).
 * - The log insert itself is guarded unique per participation.
 */
export async function runDueReminders(now = Date.now()) {
  if (!pushEnabled()) return { reminded: 0, failed: 0 };

  const [tasks, participations, submissions, users, log] = await Promise.all([
    store.list("Tasks"), store.list("Participations"), store.list("Submissions"),
    store.list("Users"), store.list("NotificationLog")
  ]);

  const alreadySent = new Set(log.filter((l) => l.kind === "DUE_SOON").map((l) => l.refId));
  const due = [];

  for (const p of participations) {
    if (p.status !== PARTICIPATION_STATUS.SELECTED || alreadySent.has(p.id)) continue;
    if (submissions.some((s) => s.participationId === p.id)) continue;

    const task = tasks.find((t) => t.id === p.taskId);
    const deadline = Date.parse(task?.deadline);
    if (!task || task.status !== TASK_STATUS.AVAILABLE || !(deadline > now && deadline - now <= REMIND_WITHIN_HOURS * HOUR)) continue;

    const user = users.find((u) => u.id === p.volunteerId);
    if (!user || user.status === USER_STATUS.DEACTIVATED) continue;

    due.push({ participation: p, task, user, deadline });
  }

  let reminded = 0;
  let failed = 0;

  await inPool(due, REMINDER_CONCURRENCY, async ({ participation, task, user, deadline }) => {
    // Another run in this process is already on it.
    if (remindersInFlight.has(participation.id)) return;
    remindersInFlight.add(participation.id);
    try {
      const latest = await store.list("NotificationLog");
      if (latest.some((l) => l.kind === "DUE_SOON" && l.refId === participation.id)) return;

      const hours = Math.max(1, Math.round((deadline - now) / HOUR));
      const sent = await sendToUser(user.id, {
        title: `Due in ${hours} hour${hours === 1 ? "" : "s"}: ${task.title}`,
        body: "Submit your work in GradeX before the deadline.",
        url: "/"
      });
      if (sent === 0) return;

      await store.insert(
        "NotificationLog",
        { userId: user.id, kind: "DUE_SOON", refId: participation.id, sentAt: new Date(now).toISOString() },
        { unique: (rows) => rows.some((l) => l.kind === "DUE_SOON" && l.refId === participation.id) }
      ).catch((error) => {
        if (error?.status !== 409) throw error;
      });
      reminded += 1;
    } catch (error) {
      failed += 1;
      console.warn(`Reminder for ${participation.id} failed: ${error?.message}`);
    } finally {
      remindersInFlight.delete(participation.id);
    }
  });

  return { reminded, failed };
}
