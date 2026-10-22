import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { api } from "../api.js";
import Icon from "./Icon.jsx";
import Logo from "./Logo.jsx";

/*
 * Making GradeX work like an app on each phone: added to the Home Screen and
 * allowed to send notifications. Everyone goes through this once per device
 * (right after their first sign-in steps), and it comes back each time they
 * open GradeX until both are done. iPhones only allow web notifications for
 * apps opened from the Home Screen, so there the order matters.
 */

// ---- What this device can do ----------------------------------------------

const ua = () => navigator.userAgent || "";
const isAndroid = () => /Android/i.test(ua());
// iPads report themselves as a Mac with a touchscreen.
export const isIOS = () => !isAndroid() && (/iPhone|iPad|iPod/.test(ua()) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
// Instagram, Facebook, Snapchat, LinkedIn and LINE open links in their own
// browser, which can't add anything to the Home Screen.
const inAppBrowser = () => /Instagram|FBAN|FBAV|FB_IAB|Snapchat|LinkedInApp|\bLine\//i.test(ua());
const isPhone = () => isIOS() || isAndroid() || /Mobi/i.test(ua());
export const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

// ---- Home Screen ------------------------------------------------------------

const INSTALLED_KEY = "gradex.installed";
const SKIPPED_KEY = "gradex.setupSkipped";
const REPORTED_KEY = "gradex.installReported";

const remember = (key, store = localStorage) => { try { store.setItem(key, "1"); } catch { /* private mode */ } };
const recalled = (key, store = localStorage) => { try { return store.getItem(key) === "1"; } catch { return false; } };
const forget = (key, store = localStorage) => { try { store.removeItem(key); } catch { /* nothing stored */ } };

// Chrome and Edge offer their install prompt once, early: keep it for our button.
let installPrompt = null;
const listeners = new Set();
const changed = () => listeners.forEach((listener) => listener());

// Called once at start-up (main.jsx), before React renders.
export function watchInstall() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    changed();
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    remember(INSTALLED_KEY);
    changed();
  });
  if (isStandalone()) remember(INSTALLED_KEY);
}

/*
 * app        running as the installed app (opened from the Home Screen)
 * installed  installed on this device, but opened in the browser right now
 * desktop    a computer: optional (with an Install button when the browser offers one)
 * prompt     a phone browser that can install it with one tap
 * ios        iPhone/iPad: Share, then "Add to Home Screen"
 * android    an Android browser without the prompt: use its menu
 * in-app     inside Instagram & co: open in Chrome/Safari first
 */
function installState() {
  if (isStandalone()) return "app";
  if (recalled(INSTALLED_KEY)) return "installed";
  if (!isPhone()) return "desktop";
  if (installPrompt) return "prompt";
  if (inAppBrowser()) return "in-app";
  if (isIOS()) return "ios";
  return "android";
}

const installDone = (state) => state === "app" || state === "installed" || state === "desktop";

function useInstall() {
  const state = useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, installState);

  const install = useCallback(async () => {
    const prompt = installPrompt;
    if (!prompt) return;
    prompt.prompt();
    const { outcome } = await prompt.userChoice.catch(() => ({ outcome: "dismissed" }));
    installPrompt = null;
    if (outcome === "accepted") remember(INSTALLED_KEY);
    changed();
  }, []);

  return { state, install };
}

// ---- Notifications ----------------------------------------------------------

function keyToBytes(base64) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function currentSubscription() {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return registration ? registration.pushManager.getSubscription() : null;
}

/*
 * Called on sign-out, before the token is cleared: tells the server to stop
 * sending this device's reminders to the signed-out person, and drops the
 * browser subscription so the next person on this device starts clean.
 */
export async function unsubscribeThisDevice() {
  try {
    const subscription = await currentSubscription();
    if (!subscription) return;
    await api.pushUnsubscribe(subscription.endpoint).catch(() => {});
    await subscription.unsubscribe().catch(() => {});
  } catch {
    /* nothing to undo */
  }
}

async function subscribe(publicKey) {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) });
  try {
    await api.pushSubscribe(subscription.toJSON());
  } catch (err) {
    // Don't leave the browser subscribed when the server didn't save it.
    await subscription.unsubscribe().catch(() => {});
    throw err;
  }
  return subscription;
}

/*
 * One notifications state for the whole page, shared by every component that
 * shows it (a page can show the setup card and the switch at once).
 *
 * checking | hidden (server can't send) | ios-install | unsupported | blocked | off | on | busy
 *
 * Whoever is signed in gets this device's subscription: an existing one is
 * re-registered (it may have been someone else's), and when notifications are
 * already allowed but there's no subscription (say, after signing out and back
 * in) a new one is made without asking again, unless this person turned them
 * off on this device.
 */
const OFF_KEY = (userId) => `gradex.notificationsOff.${userId}`;
let push = { state: "checking", error: null };
let pushKeyValue = null;
let pushUserId = null;
let pushCheck = null;
const pushListeners = new Set();
const setPush = (next) => {
  push = { ...push, ...next };
  pushListeners.forEach((listener) => listener());
};

async function runPushCheck(userId) {
  try {
    const { enabled, publicKey } = await api.pushKey();
    if (!enabled) return setPush({ state: "hidden" });
    pushKeyValue = publicKey;

    if (!pushSupported()) return setPush({ state: isIOS() && !isStandalone() ? "ios-install" : "unsupported" });
    if (Notification.permission === "denied") return setPush({ state: "blocked" });

    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    if (existing) {
      await api.pushSubscribe(existing.toJSON());
    } else if (Notification.permission === "granted" && !recalled(OFF_KEY(userId))) {
      await subscribe(publicKey);
    } else {
      return setPush({ state: "off" });
    }
    setPush({ state: "on" });
  } catch {
    setPush({ state: push.state === "checking" ? "off" : push.state });
  }
}

// App.jsx calls this while rendering, before any screen that shows notifications,
// with whoever is signed in (null when nobody). Each person's check runs once per visit.
export function setPushUser(userId) {
  if (userId === pushUserId) return;
  pushUserId = userId;
  pushCheck = null;
  push = { state: "checking", error: null };
  // Screens already on show (rare: a different person without a reload) re-check after
  // this render. Nobody signed in (signing out): nothing to check.
  if (userId && pushListeners.size) {
    queueMicrotask(() => {
      pushCheck ??= runPushCheck(pushUserId);
      pushListeners.forEach((listener) => listener());
    });
  }
}

export function usePush() {
  const current = useSyncExternalStore((listener) => {
    pushListeners.add(listener);
    return () => pushListeners.delete(listener);
  }, () => push);

  useEffect(() => {
    if (pushUserId) pushCheck ??= runPushCheck(pushUserId);
  }, []);

  const turnOn = useCallback(async () => {
    setPush({ state: "busy", error: null });
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setPush({ state: permission === "denied" ? "blocked" : "off" });
      await subscribe(pushKeyValue);
      forget(OFF_KEY(pushUserId));
      setPush({ state: "on" });
    } catch (err) {
      setPush({ state: "off", error: err.message || "Couldn't turn on notifications on this device." });
    }
  }, []);

  const turnOff = useCallback(async () => {
    setPush({ state: "busy", error: null });
    try {
      const subscription = await currentSubscription();
      if (subscription) {
        await api.pushUnsubscribe(subscription.endpoint);
        await subscription.unsubscribe();
      }
      remember(OFF_KEY(pushUserId));
      setPush({ state: "off" });
    } catch (err) {
      setPush({ state: "on", error: err.message || "Couldn't turn notifications off. Try again." });
    }
  }, []);

  const recheck = useCallback(() => {
    setPush({ state: "checking", error: null });
    pushCheck = runPushCheck(pushUserId);
  }, []);

  return { ...current, turnOn, turnOff, recheck };
}

const pushDone = (state) => state === "on" || state === "hidden";

// ---- Start-up checks (App.jsx) ----------------------------------------------

// Quick, synchronous: is this device clearly set up already? (Skips the setup screen.)
export function setupLooksDone(userId) {
  const notifications = pushSupported() && Notification.permission === "granted" && !recalled(OFF_KEY(userId));
  return installDone(installState()) && notifications;
}

// Per person: on a shared computer, one person skipping doesn't skip it for the next.
export const skippedThisSession = (userId) => recalled(`${SKIPPED_KEY}.${userId}`, sessionStorage);
const skipForNow = (userId) => remember(`${SKIPPED_KEY}.${userId}`, sessionStorage);

// Tell the server (once per person, per device) that they use GradeX from their Home Screen.
export function reportInstall(userId) {
  const key = `${REPORTED_KEY}.${userId}`;
  if (!isStandalone() || recalled(key)) return;
  api.appInstalled().then(() => remember(key)).catch(() => {});
}

// ---- The two steps, as shown on the setup screen and the home pages ----------

const SITE = "streetcausevnr.org";

function InstallStep({ install }) {
  const { state } = install;
  const done = installDone(state);
  return (
    <li className={`setup-step${done ? " is-done" : ""}`}>
      <span className="setup-icon" aria-hidden="true"><Icon name={done ? "check" : "phone"} size={20} /></span>
      <div className="setup-text">
        <b>{state === "desktop" ? "Add GradeX to your phone" : "Add GradeX to your Home Screen"}</b>
        {state === "app" && <span>Done: you're using the GradeX app.</span>}
        {state === "installed" && <span>Done. From now on, open GradeX from your Home Screen.</span>}
        {state === "prompt" && <span>One tap: GradeX gets its own icon and opens like an app.</span>}
        {state === "ios" && (
          <ol className="setup-how">
            <li>In Safari, tap <span className="setup-key"><Icon name="share" size={14} /> Share</span> at the bottom of the screen.</li>
            <li>Scroll down and tap <span className="setup-key"><Icon name="plus-square" size={14} /> Add to Home Screen</span>, then <b>Add</b>.</li>
            <li>Open <b>GradeX</b> from your Home Screen and sign in there to finish.</li>
          </ol>
        )}
        {state === "ios" && <small className="muted">Not in Safari? Open {SITE} in Safari first.</small>}
        {state === "android" && (
          <ol className="setup-how">
            <li>Tap your browser's menu <span className="setup-key"><Icon name="more-vert" size={14} /></span> (top right).</li>
            <li>Tap <b>Install app</b> or <b>Add to Home screen</b>.</li>
            <li>Open <b>GradeX</b> from your Home Screen.</li>
          </ol>
        )}
        {state === "in-app" && <span>You're in another app's browser, which can't add GradeX. Open <b>{SITE}</b> in Chrome or Safari.</span>}
        {state === "desktop" && <span>Optional on a computer. On your phone, open {SITE} and add it there too.</span>}
        {state === "desktop" && installPrompt && <button type="button" className="btn btn--ghost btn--small" onClick={install.install}>Install on this computer</button>}
        {state === "prompt" && <button type="button" className="btn btn--small" onClick={install.install}><Icon name="plus-square" size={16} /> Add to Home Screen</button>}
      </div>
    </li>
  );
}

function PushStep({ push, about }) {
  const { state } = push;
  if (state === "hidden") return null;
  const done = pushDone(state);
  return (
    <li className={`setup-step${done ? " is-done" : ""}${state === "blocked" || state === "unsupported" ? " is-stuck" : ""}`}>
      <span className="setup-icon" aria-hidden="true"><Icon name={done ? "check" : "bell"} size={20} /></span>
      <div className="setup-text">
        <b>{done ? "Notifications are on" : "Turn on notifications"}</b>
        {(state === "on" || state === "off" || state === "busy" || state === "checking") && <span>{about}</span>}
        {state === "ios-install" && <span>Unlocks after the step above: iPhones only allow notifications for apps on the Home Screen.</span>}
        {state === "blocked" && <span>Notifications are blocked for GradeX. Allow them for {SITE} in your phone's or browser's settings, then tap Check again.</span>}
        {state === "unsupported" && <span>This browser can't show notifications. Use Chrome on Android, or GradeX from your iPhone's Home Screen.</span>}
        {push.error && <span className="bad" role="alert">{push.error}</span>}
        {(state === "off" || state === "busy") && (
          <button type="button" className="btn btn--small" disabled={state === "busy"} onClick={push.turnOn}><Icon name="bell" size={16} /> {state === "busy" ? "Turning on…" : "Turn on notifications"}</button>
        )}
        {state === "blocked" && <button type="button" className="btn btn--ghost btn--small" onClick={push.recheck}>Check again</button>}
      </div>
    </li>
  );
}

const ABOUT = "A nudge before a task is due, and when work is scored.";

/*
 * Full screen, after the first-sign-in steps (and on later opens until both
 * steps are done). Continue unlocks when both are done; "Skip for now" lets
 * them in, and the screen comes back the next time they open GradeX.
 */
export function SetupApp({ user, firstTime, onDone, onSignOut }) {
  const install = useInstall();
  const push = usePush();
  const ready = installDone(install.state) && pushDone(push.state);
  const first = user.name.split(" ")[0];

  return (
    <main className="login">
      <section className="login-card login-card--first">
        <Logo variant="brand" />
        <p className="eyebrow">{firstTime ? `Welcome, ${first} · last step` : `Hi ${first} · finish setting up`}</p>
        <h1>Make GradeX an app on your phone</h1>
        <p className="muted">Two things, once on each phone. GradeX then opens from your Home Screen like any app and tells you when tasks are due or scored.</p>
        <ol className="setup-list">
          <InstallStep install={install} />
          <PushStep push={push} about={ABOUT} />
        </ol>
        <button type="button" className="btn btn--block btn--lg" disabled={!ready} onClick={onDone}>
          {ready ? "Continue to GradeX" : "Finish both to continue"} {ready && <Icon name="arrow-r" size={17} />}
        </button>
        {!ready && (
          <button type="button" className="link-btn small tap" onClick={() => { skipForNow(user.id); onDone(); }}>
            Skip for now (we'll ask again next time)
          </button>
        )}
        <button type="button" className="link-btn small tap" onClick={onSignOut}>Sign out</button>
      </section>
    </main>
  );
}

/*
 * Home pages: while either step is missing, both are shown as a card; once
 * both are done, just the notifications switch. only="setup" / only="switch"
 * shows just one of the two, so a page can put them in different places.
 */
export function SetupCard({ title = "Never miss a deadline", about = ABOUT, only }) {
  const install = useInstall();
  const push = usePush();

  if (push.state === "checking") return null;
  if (installDone(install.state) && pushDone(push.state)) {
    if (push.state === "hidden" || only === "setup") return null;
    const on = push.state === "on";
    return (
      <div className={`notify notify--${push.state}`}>
        <span className="notify-icon" aria-hidden="true"><Icon name="bell" size={20} /></span>
        <div className="notify-text">
          <b>{on ? "Notifications are on" : title}</b>
          <span>{about}</span>
          {push.error && <span className="bad small" role="alert">{push.error}</span>}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Notifications on this device"
          aria-busy={push.state === "busy" || undefined}
          className={`switch${on ? " is-on" : ""}`}
          disabled={push.state === "busy"}
          onClick={on ? push.turnOff : push.turnOn}
        />
      </div>
    );
  }

  if (only === "switch") return null;
  return (
    <section className="setup-card" aria-labelledby="setup-card-title">
      <b id="setup-card-title" className="setup-card-title">{install.state === "desktop" ? "Turn on notifications on this computer" : "Finish setting up GradeX on this phone"}</b>
      <ol className="setup-list">
        <InstallStep install={install} />
        <PushStep push={push} about={about} />
      </ol>
    </section>
  );
}
