import { useCallback, useEffect, useRef, useState } from "react";
import { api, tokenStore } from "../api.js";
import { ErrorNote, Loading } from "../components/ui.jsx";
import { initials } from "../format.js";
import Icon from "../components/Icon.jsx";
import Logo from "../components/Logo.jsx";

const TINTS = ["sky", "leaf", "sun", "rose", "lilac"];

// A volunteer's first sign-in: password, then domain, then coordinator.
// A coordinator added without a domain: password, then domain.
const STEP_LABELS = ["Your password", "Your domain", "Your coordinator"];

// Volunteers without a coordinator, and coordinators without a domain, still
// have steps ahead of them.
export const needsTeam = (user) =>
  (user.role === "VOLUNTEER" && !user.coordinatorId) || (user.role === "COORDINATOR" && !user.domainId);
const stepCount = (user) => (user.role === "COORDINATOR" ? 2 : 3);

function Steps({ current, total }) {
  if (total < 2) return null;
  const labels = STEP_LABELS.slice(0, total);
  return (
    <ol className="steps" aria-label={`Step ${current} of ${total}`}>
      {labels.map((label, i) => (
        <li key={label} className={i + 1 < current ? "is-done" : i + 1 === current ? "is-on" : ""} aria-current={i + 1 === current ? "step" : undefined}>
          <span className="steps-n" aria-hidden="true">{i + 1 < current ? <Icon name="check" size={13} /> : i + 1}</span>{label}
        </li>
      ))}
    </ol>
  );
}

// Step 1 of a first login (or after an admin reset): replace the shared password.
export function SetPassword({ user, onDone, onSignOut, optional = false, onCancel }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (next !== confirm) return setError("The two new passwords don't match.");
    if (next === current) return setError("Choose a new password that's different from the current one.");
    setPending(true);
    setError(null);
    try {
      const result = await api.changePassword(current, next);
      // Changing the password signs out every older session, including this
      // one's token, so carry on with the fresh token the server returns.
      if (result.token) tokenStore.set(result.token);
      onDone(result.user);
    } catch (err) {
      setError(err.message);
      setPending(false);
    }
  }

  const form = (
    <form className="form" onSubmit={submit}>
      <label className="field"><span>{optional ? "Current password" : "Password you were given"}</span>
        <input id="pw-current" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} /></label>
      <label className="field"><span>New password</span>
        <input id="pw-new" type="password" autoComplete="new-password" required minLength={8} maxLength={72} value={next} onChange={(e) => setNext(e.target.value)} aria-describedby="pw-hint" />
        <small id="pw-hint" className="muted">{optional ? "At least 8 characters." : "At least 8 characters. Don't reuse the one you were given."}</small></label>
      <label className="field"><span>Type it again</span>
        <input id="pw-confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
      <ErrorNote error={error} />
      <div className="row">
        <button type="submit" className="btn" disabled={pending}>{pending ? "Saving…" : "Save my password"}</button>
        {optional && <button type="button" className="btn btn--ghost" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );

  if (optional) return form;

  const steps = needsTeam(user) ? stepCount(user) : 1;

  return (
    <main className="login">
      <section className="login-card login-card--first">
        <Logo variant="brand" />
        <Steps current={1} total={steps} />
        <p className="eyebrow">Welcome, {user.name.split(" ")[0]}{steps > 1 ? ` · step 1 of ${steps}` : ""}</p>
        <h1>Set your own password</h1>
        <p className="muted">You're signed in with a password an admin gave you. Choose one only you know to carry on.</p>
        {form}
        <button type="button" className="link-btn small tap" onClick={onSignOut}>Sign out</button>
      </section>
    </main>
  );
}

/*
 * Steps 2 and 3 for volunteers (step 2 only for a coordinator without a
 * domain): choose a domain (skipped when an admin set
 * it), then one of that domain's coordinators. Saved together, once: after
 * that only the domain's EB head or an admin can move them.
 */
export function ChooseTeam({ user, onDone, onSignOut }) {
  const coordinator = user.role === "COORDINATOR";
  const total = stepCount(user);
  const presetDomain = user.domainId ?? null;
  const [domains, setDomains] = useState(null);
  const [domainId, setDomainId] = useState(presetDomain ?? "");
  const [step, setStep] = useState(presetDomain ? 3 : 2);
  const [coordinators, setCoordinators] = useState(null);
  const [choice, setChoice] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  const loadDomains = useCallback(() => {
    setError(null);
    setDomains(null);
    api.domains().then(({ domains }) => setDomains(domains)).catch((err) => setError(err.message));
  }, []);
  useEffect(loadDomains, [loadDomains]);

  // Only the latest domain's answer counts (switching domains quickly must
  // never show the previous domain's coordinators under the new heading).
  const latestDomain = useRef(null);
  const loadCoordinators = useCallback((id) => {
    latestDomain.current = id;
    setError(null);
    setCoordinators(null);
    api.domainCoordinators(id)
      .then(({ coordinators }) => latestDomain.current === id && setCoordinators(coordinators))
      .catch((err) => latestDomain.current === id && setError(err.message));
  }, []);
  useEffect(() => {
    if (step === 3 && domainId) loadCoordinators(domainId);
  }, [step, domainId, loadCoordinators]);

  async function save() {
    setPending(true);
    setError(null);
    try {
      const { user: updated, context } = coordinator ? await api.chooseDomain(domainId) : await api.chooseCoordinator(choice);
      onDone(updated, context);
    } catch (err) {
      // Already chosen (say, in another tab): pick up the saved team and carry on.
      if (err.status === 409) {
        try {
          const fresh = await api.me();
          if (coordinator ? fresh.user.domainId : fresh.user.coordinatorId) return onDone(fresh.user, fresh.context);
        } catch { /* fall through to the error */ }
      }
      setError(err.message);
      setPending(false);
      setConfirming(false);
    }
  }

  const domain = domains?.find((d) => d.id === domainId);
  const chosen = coordinators?.find((c) => c.id === choice);
  const first = user.name.split(" ")[0];

  if (step === 2) {
    return (
      <main className="login">
        <section className="login-card login-card--first login-card--wide">
          <Logo variant="brand" />
          <Steps current={2} total={total} />
          <p className="eyebrow">Welcome, {first} · step 2 of {total}</p>
          <h1>Choose your domain</h1>
          <p className="muted">{coordinator
            ? "Choose the domain you coordinate. Its EB head sends you tasks and scores your final work. You choose once; after that an admin can change it."
            : "Each domain is led by an EB head and split into coordinators' teams. Next you'll choose the coordinator whose team you join."}</p>
          {!domains && !error && <Loading />}
          {domains && domains.length === 0 && (
            <div className="empty">
              <b>No domains have been set up yet</b>
              <p className="muted">Ask an admin to add the club's domains, then try again.</p>
              <button type="button" className="btn btn--ghost btn--small" onClick={loadDomains}>Try again</button>
            </div>
          )}
          {domains && domains.length > 0 && (
            <fieldset className="domain-grid">
              <legend className="sr-only">Domains</legend>
              {domains.map((d, i) => (
                <label key={d.id} className={`domain-option${domainId === d.id ? " is-on" : ""}`}>
                  <input type="radio" name="domain" className="sr-only" value={d.id} checked={domainId === d.id} onChange={() => { setDomainId(d.id); setConfirming(false); }} />
                  <span className={`domain-badge tint--${TINTS[i % TINTS.length]}`} aria-hidden="true">{d.name.slice(0, 1).toUpperCase()}</span>
                  <span className="domain-name">{d.name}{d.head && <small className="block muted">EB head: {d.head.name}</small>}</span>
                  <span className="domain-tick" aria-hidden="true"><Icon name="check" size={14} /></span>
                </label>
              ))}
            </fieldset>
          )}
          <ErrorNote error={error} />
          {error && !domains && <button type="button" className="btn btn--ghost btn--small" onClick={loadDomains}>Try again</button>}
          {coordinator && confirming ? (
            <div className="confirm confirm--calm">
              <p className="small">Coordinate in <b>{domain?.name}</b>? You won't be able to change this yourself.</p>
              <div className="row">
                <button type="button" className="btn" disabled={pending} onClick={save}>{pending ? "Saving…" : `Join ${domain?.name}`}</button>
                <button type="button" className="btn btn--ghost" disabled={pending} onClick={() => setConfirming(false)}>Go back</button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn btn--block btn--lg" disabled={!domainId} onClick={() => { if (coordinator) return setConfirming(true); setChoice(""); setStep(3); }}>Continue <Icon name="arrow-r" size={17} /></button>
          )}
          <button type="button" className="link-btn small tap" onClick={onSignOut}>Sign out</button>
        </section>
      </main>
    );
  }

  return (
    <main className="login">
      <section className="login-card login-card--first login-card--wide">
        <Logo variant="brand" />
        <Steps current={3} total={3} />
        <p className="eyebrow">Welcome, {first} · step 3 of 3{domain ? ` · ${domain.name}` : ""}</p>
        <h1>Choose your coordinator</h1>
        <p className="muted">You'll join their team: they forward tasks to you, score your work, and you'll see your team's board. You choose once; after that your EB head{domain?.head ? ` (${domain.head.name})` : ""} or an admin can move you.</p>
        {!coordinators && !error && <Loading />}
        {coordinators && coordinators.length === 0 && (
          <div className="empty">
            <b>{domain?.name ?? "This domain"} has no coordinators yet</b>
            <p className="muted">{presetDomain ? "Ask your EB head or an admin to add one, then try again." : "Choose another domain, or ask an admin to add a coordinator."}</p>
            <button type="button" className="btn btn--ghost btn--small" onClick={() => loadCoordinators(domainId)}>Try again</button>
          </div>
        )}
        {coordinators && coordinators.length > 0 && (
          <fieldset className="domain-grid domain-grid--people">
            <legend className="sr-only">Coordinators</legend>
            {coordinators.map((c, i) => (
              <label key={c.id} className={`domain-option${choice === c.id ? " is-on" : ""}`}>
                <input type="radio" name="coordinator" className="sr-only" value={c.id} checked={choice === c.id} onChange={() => { setChoice(c.id); setConfirming(false); }} />
                <span className={`domain-badge tint--${TINTS[(i + 1) % TINTS.length]}`} aria-hidden="true">{initials(c.name)}</span>
                <span className="domain-name">{c.name}<small className="block muted">{c.teamSize === 0 ? "New team" : `${c.teamSize} ${c.teamSize === 1 ? "volunteer" : "volunteers"}`}</small></span>
                <span className="domain-tick" aria-hidden="true"><Icon name="check" size={14} /></span>
              </label>
            ))}
          </fieldset>
        )}
        <ErrorNote error={error} />
        {confirming ? (
          <div className="confirm confirm--calm">
            <p className="small">Join <b>{chosen?.name}</b>'s team in {domain?.name ?? "this domain"}? You won't be able to change this yourself.</p>
            <div className="row">
              <button type="button" className="btn" disabled={pending} onClick={save}>{pending ? "Joining…" : `Join ${chosen?.name.split(" ")[0]}'s team`}</button>
              <button type="button" className="btn btn--ghost" disabled={pending} onClick={() => setConfirming(false)}>Go back</button>
            </div>
          </div>
        ) : (
          <div className="row">
            <button type="button" className="btn btn--lg grow" disabled={!choice} onClick={() => setConfirming(true)}>Continue <Icon name="arrow-r" size={17} /></button>
            {!presetDomain && <button type="button" className="btn btn--ghost btn--lg" onClick={() => { setStep(2); setConfirming(false); }}>Change domain</button>}
          </div>
        )}
        <button type="button" className="link-btn small tap" onClick={onSignOut}>Sign out</button>
      </section>
    </main>
  );
}
