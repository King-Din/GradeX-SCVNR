import { Component, useCallback, useEffect, useRef, useState } from "react";
import { api, setPasswordChangeHandler, setUnauthorizedHandler, tokenStore } from "./api.js";
import { drafts } from "./drafts.js";
import Rail from "./components/Rail.jsx";
import { reportInstall, setPushUser, setupLooksDone, SetupApp, skippedThisSession, unsubscribeThisDevice } from "./components/AppSetup.jsx";
import Login from "./pages/Login.jsx";
import Roster from "./pages/Roster.jsx";
import Tasks from "./pages/Tasks.jsx";
import TeamTasks from "./pages/TeamTasks.jsx";
import Review from "./pages/Review.jsx";
import Accounts from "./pages/Accounts.jsx";
import Volunteer from "./pages/Volunteer.jsx";
import Board from "./pages/Board.jsx";
import Approvals from "./pages/Approvals.jsx";
import DomainsHome from "./pages/DomainsHome.jsx";
import CoordinatorHome from "./pages/CoordinatorHome.jsx";
import { ChooseTeam, needsTeam, SetPassword } from "./pages/FirstLogin.jsx";
import { keyFromHash, ROLE_LABEL } from "./format.js";
import { Panel, useToast } from "./components/ui.jsx";
import Logo from "./components/Logo.jsx";

/*
 * Navigation per role:
 * - Admin: every domain, people, tasks, reviews, boards and accounts.
 * - EB head: home (all domains at a glance + their own in depth), approvals
 *   of coordinators' proposals, their domain's tasks, final work to score,
 *   people and boards.
 * - Coordinator: home (EB tasks to deliver), team tasks, team work to score,
 *   their team, boards.
 */
const PAGES = {
  ADMIN: [
    { key: "home", label: "Domains", icon: "grid", badge: "proposals" },
    { key: "people", label: "People", icon: "users" },
    { key: "tasks", label: "Tasks", icon: "tasks" },
    { key: "review", label: "Review", icon: "inbox", badge: "pending" },
    { key: "board", label: "Board", icon: "trophy" },
    { key: "accounts", label: "Accounts", icon: "user-plus" }
  ],
  EB: [
    { key: "home", label: "Home", icon: "home" },
    { key: "approvals", label: "Approvals", icon: "check-circle", badge: "proposals" },
    { key: "tasks", label: "Tasks", icon: "tasks" },
    { key: "review", label: "Review", icon: "inbox", badge: "pending" },
    { key: "people", label: "People", icon: "users" },
    { key: "board", label: "Board", icon: "trophy" }
  ],
  COORDINATOR: [
    { key: "home", label: "Home", icon: "home" },
    { key: "team", label: "Team tasks", icon: "tasks" },
    { key: "review", label: "Review", icon: "inbox", badge: "pending" },
    { key: "people", label: "My team", icon: "users" },
    { key: "board", label: "Board", icon: "trophy" }
  ]
};

const SESSION_ENDED = "Your session ended. Sign in again — your draft is kept.";

// Shows a way back instead of a blank page if a screen ever crashes.
class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="login">
        <section className="login-card">
          <Logo variant="brand" />
          <h1>Something went wrong</h1>
          <p className="muted">This screen hit an error. Reload to carry on. Anything you already saved is safe; text you were typing may need to be entered again.</p>
          <button type="button" className="btn btn--block" onClick={() => window.location.reload()}>Reload</button>
        </section>
      </main>
    );
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <GradeX />
    </ErrorBoundary>
  );
}

function GradeX() {
  const [session, setSession] = useState({ status: "checking" });
  const [notice, setNotice] = useState(null);
  // The "make it an app" screen: shown after the first-sign-in steps, and on
  // each new visit until this device is set up (or they skip it for now).
  // null: not decided yet for whoever signs in (worked out from their device state).
  const [setupCleared, setSetupCleared] = useState(null);
  const [firstSignIn, setFirstSignIn] = useState(false);

  // Session ended (401): keep drafts so they can be picked up after signing in again.
  const endSession = useCallback((message = null) => {
    tokenStore.clear();
    setNotice(message);
    setSession({ status: "signedOut" });
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => endSession(SESSION_ENDED));
    // An admin reset this person's password while they were signed in.
    setPasswordChangeHandler(() =>
      setSession((s) => (s.status === "signedIn" && !s.user.mustChangePassword ? { ...s, user: { ...s.user, mustChangePassword: true } } : s))
    );

    if (!tokenStore.get()) {
      setSession({ status: "signedOut" });
      return;
    }

    api.me()
      .then(({ user, context }) => setSession({ status: "signedIn", user, context: context ?? null }))
      .catch((error) => {
        if (error.status !== 401) setNotice(error.message);
        setSession({ status: "signedOut" });
      });
  }, [endSession]);

  // The names above this person (domain, EB head, coordinator) arrive with /me.
  const signedIn = session.status === "signedIn";
  const needsContext = signedIn && !session.context && !session.user.mustChangePassword;
  useEffect(() => {
    if (!needsContext) return;
    api.me().then(({ user, context }) => setSession((s) => (s.status === "signedIn" ? { ...s, user: { ...s.user, ...user }, context } : s))).catch(() => {});
  }, [needsContext]);

  // Leaders see who opens GradeX from their Home Screen; notifications follow
  // whoever is signed in (set before any screen that shows them renders).
  const signedInId = signedIn ? session.user.id : null;
  const settled = signedIn && !session.user.mustChangePassword;
  setPushUser(signedInId);
  useEffect(() => {
    if (settled) reportInstall(signedInId);
  }, [settled, signedInId]);

  if (session.status === "checking") return <div className="boot" aria-busy="true" />;

  if (session.status === "signedOut") {
    return (
      <Login
        notice={notice}
        onSignedIn={(token, user) => {
          // A different person on this device: don't show them the last person's drafts.
          if (drafts.get("owner") !== user.id) drafts.clearAll();
          drafts.set("owner", user.id);
          tokenStore.set(token);
          setNotice(null);
          setSetupCleared(null);
          setSession({ status: "signedIn", user, context: null });
        }}
      />
    );
  }

  // Deliberate sign-out: stop this device's reminders for this person first
  // (needs the token), then forget the session and any drafts.
  const handleSignOut = async () => {
    await unsubscribeThisDevice();
    await api.logout().catch(() => {});
    drafts.clearAll();
    window.history.replaceState(null, "", window.location.pathname);
    endSession();
  };

  const { user, context } = session;
  const setUser = (next, nextContext) => setSession((s) => ({ status: "signedIn", user: next, context: nextContext === undefined ? s.context : nextContext }));

  // First login: replace the shared password, then (volunteers) choose a domain and a coordinator.
  if (user.mustChangePassword) {
    return <SetPassword user={user} onSignOut={handleSignOut} onDone={() => { setFirstSignIn(true); setUser({ ...user, mustChangePassword: false }, null); }} />;
  }
  if (needsTeam(user)) {
    return <ChooseTeam user={user} onSignOut={handleSignOut} onDone={(updated, nextContext) => setUser({ ...user, ...updated, mustChangePassword: false }, nextContext ?? null)} />;
  }

  if (!(setupCleared ?? (setupLooksDone(user.id) || skippedThisSession(user.id)))) {
    return <SetupApp user={user} firstTime={firstSignIn} onSignOut={handleSignOut} onDone={() => setSetupCleared(true)} />;
  }

  if (user.role === "VOLUNTEER") {
    return <Volunteer user={user} context={context} onSignOut={handleSignOut} />;
  }

  return <Staff user={user} context={context} onSignOut={handleSignOut} />;
}

function Staff({ user, context, onSignOut }) {
  const pages = PAGES[user.role] ?? PAGES.COORDINATOR;
  const keys = pages.map((p) => p.key);
  const keysRef = useRef(keys);
  keysRef.current = keys;
  const [page, setPage] = useState(() => keyFromHash(keys));
  const [counts, setCounts] = useState({ pending: 0, proposals: 0 });
  const [domains, setDomains] = useState([]);
  const [domainsLoaded, setDomainsLoaded] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  // One-shot request carried to the next page, e.g. "open the new-task form".
  const [intent, setIntent] = useState(null);
  const [toast, showToast] = useToast();
  const decides = user.role === "ADMIN" || user.role === "EB";

  useEffect(() => {
    const onHash = () => setPage(keyFromHash(keysRef.current));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Badges: work this person can score, and proposals waiting for a decision.
  const refreshCounts = useCallback(() => {
    api.pendingReviews()
      .then(({ submissions }) => setCounts((c) => ({ ...c, pending: submissions.filter((s) => s.canScore !== false).length })))
      .catch(() => {});
    if (decides) {
      api.proposals()
        .then(({ tasks }) => setCounts((c) => ({ ...c, proposals: tasks.filter((t) => t.status === "PROPOSED").length })))
        .catch(() => {});
    }
  }, [decides]);

  // Keep the badges fresh: on page change, when the window regains focus, and every few minutes.
  useEffect(() => {
    refreshCounts();
  }, [refreshCounts, page]);

  useEffect(() => {
    // Only while the window is in view, and at most once every 15 seconds
    // (focus and visibilitychange usually fire together).
    let last = 0;
    const refreshIfVisible = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 15_000) return;
      last = Date.now();
      refreshCounts();
    };
    const onFocus = refreshIfVisible;
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    const timer = setInterval(refreshIfVisible, 3 * 60 * 1000);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
      clearInterval(timer);
    };
  }, [refreshCounts]);

  useEffect(() => {
    api.domains()
      .then(({ domains }) => setDomains(domains))
      .catch(() => {})
      .finally(() => setDomainsLoaded(true));
  }, []);

  const navigate = useCallback((key, nextIntent = null) => {
    if (!keysRef.current.includes(key)) return;
    setIntent(nextIntent);
    if (window.location.hash !== `#${key}`) window.location.hash = key;
    setPage(key);
    window.scrollTo?.({ top: 0 });
  }, []);

  const items = pages.map((p) => ({ ...p, badge: p.badge ? counts[p.badge] : 0 }));
  const ownDomain = context?.domain?.name ?? domains.find((d) => d.id === user.domainId)?.name;
  const shared = { user, context, domains, domainsLoaded, counts, onNavigate: navigate, refreshCounts };
  const intentProps = { intent, onIntentUsed: () => setIntent(null) };

  return (
    <div className="shell">
      <Rail items={items} active={page} onNavigate={(key) => navigate(key)} user={user} roleLabel={ROLE_LABEL[user.role]} domainName={ownDomain} onSignOut={onSignOut} onPassword={() => setChangingPassword(true)} />
      <div className="workspace">
        {page === "home" && (user.role === "COORDINATOR" ? <CoordinatorHome {...shared} /> : <DomainsHome {...shared} />)}
        {page === "approvals" && <Approvals {...shared} />}
        {page === "tasks" && <Tasks {...shared} {...intentProps} />}
        {page === "team" && <TeamTasks {...shared} {...intentProps} />}
        {page === "review" && <Review {...shared} onScored={refreshCounts} />}
        {page === "people" && <Roster {...shared} />}
        {page === "accounts" && <Accounts {...shared} />}
        {page === "board" && <Board {...shared} />}
      </div>
      {changingPassword && (
        <Panel title="Change your password" onClose={() => setChangingPassword(false)}>
          <SetPassword user={user} optional onCancel={() => setChangingPassword(false)} onDone={() => { setChangingPassword(false); showToast("Password changed"); }} />
        </Panel>
      )}
      {toast}
    </div>
  );
}
