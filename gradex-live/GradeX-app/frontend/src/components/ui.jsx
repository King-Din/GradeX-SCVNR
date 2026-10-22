import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { currentConfig, loadConfig } from "../api.js";
import { initials, OUTCOME_LABEL, STANDING_LABEL, fmtDate } from "../format.js";
import Icon from "./Icon.jsx";

// Soft avatar tints, picked from the name so a person keeps their colour everywhere.
const TINTS = ["leaf", "sky", "rose", "sun", "lilac"];
const tintFor = (name = "") => TINTS[[...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % TINTS.length];

export function Avatar({ name, size = "md" }) {
  return <span className={`avatar avatar--${size} tint--${tintFor(name)}`} aria-hidden="true">{initials(name)}</span>;
}

// One dot per task, newest on the right: the roster's signature.
export function Dots({ history, max = 8, size = "md" }) {
  const items = [...history].slice(0, max).reverse();
  return (
    <span className={`dots dots--${size}`} role="img" aria-label={summarize(history)}>
      {items.map((h) => (
        <i
          key={h.participationId ?? h.id}
          className={`dot dot--${h.outcome}`}
          title={`${h.title}: ${OUTCOME_LABEL[h.outcome]}${h.score != null ? `, scored ${h.score}` : ""} (due ${fmtDate(h.deadline)})`}
        />
      ))}
      {items.length === 0 && <span className="muted small">No tasks yet</span>}
    </span>
  );
}

/*
 * The volunteer's record as linked check circles: tick = on time, clock =
 * late, cross = missed, open ring = still in progress. Newest on the right.
 */
export function RecordFlow({ history, max = 8 }) {
  const items = [...history].slice(0, max).reverse();
  const glyph = { ON_TIME: "check", LATE: "clock", MISSED: "x" };
  return (
    <span className="flow" role="img" aria-label={summarize(history)}>
      {items.map((h, i) => (
        <span key={h.participationId ?? h.id ?? i} className="flow-step">
          {i > 0 && <em className={`flow-line${h.outcome === "IN_PROGRESS" ? "" : " is-done"}`} aria-hidden="true" />}
          <i className={`flow-dot flow-dot--${h.outcome}`} title={`${h.title}: ${OUTCOME_LABEL[h.outcome]}${h.score != null ? `, scored ${h.score}` : ""}`}>
            {glyph[h.outcome] && <Icon name={glyph[h.outcome]} size={13} strokeWidth={2.6} />}
          </i>
        </span>
      ))}
    </span>
  );
}

// On-time ring: green arc for the share on time, the rest a quiet track.
export function Ring({ value, size = 104, label = "on time" }) {
  const r = 44;
  const circ = 2 * Math.PI * r;
  const share = value == null ? 0 : Math.max(0, Math.min(1, value));
  return (
    <span className="ring" style={{ width: size, height: size }}>
      <svg viewBox="0 0 104 104" width={size} height={size} aria-hidden="true" focusable="false">
        <circle className="ring-track" cx="52" cy="52" r={r} fill="none" strokeWidth="11" />
        {share > 0 && (
          <circle className="ring-arc" cx="52" cy="52" r={r} fill="none" strokeWidth="11" strokeLinecap="round" strokeDasharray={`${Math.max(share * circ - 0.01, 0.01)} ${circ}`} transform="rotate(-90 52 52)" />
        )}
      </svg>
      <span className="ring-c"><b>{value == null ? "—" : `${Math.round(share * 100)}%`}</b><small>{label}</small></span>
    </span>
  );
}

/*
 * Coordinator feedback as a handwritten note card: the opening line in
 * Caveat, any longer detail in the UI face so it stays easy to read.
 */
function splitFeedback(text = "") {
  const clean = text.trim();
  if (clean.length <= 90) return [clean, ""];
  const match = clean.match(/^(.{8,110}?[.!?])\s+([\s\S]+)$/);
  return match ? [match[1], match[2]] : ["", clean];
}

export function FeedbackNote({ feedback, by, compact = false }) {
  if (!feedback) return null;
  const [lead, rest] = splitFeedback(feedback);
  return (
    <figure className={`hand-note${compact ? " hand-note--compact" : ""}`}>
      <blockquote>
        {lead && <p className="hand">“{lead}{rest ? "" : "”"}</p>}
        {rest && <p>{lead ? "" : "“"}{rest}”</p>}
      </blockquote>
      {by && <figcaption>— {by}</figcaption>}
    </figure>
  );
}

function summarize(history) {
  const count = (o) => history.filter((h) => h.outcome === o).length;
  return `${count("ON_TIME")} on time, ${count("LATE")} late, ${count("MISSED")} missed, ${count("IN_PROGRESS")} in progress`;
}

export function Legend() {
  return (
    <div className="legend">
      {Object.entries(OUTCOME_LABEL).map(([key, label]) => (
        <span key={key}><i className={`dot dot--${key}`} aria-hidden="true" />{label}</span>
      ))}
    </div>
  );
}

export function StandingTag({ standing }) {
  return <span className={`tag tag--${standing}`}>{STANDING_LABEL[standing] ?? standing}</span>;
}

export const STATUS_LABEL = {
  DRAFT: "Draft", AVAILABLE: "Published", CLOSED: "Closed", PROPOSED: "Waiting for approval", REJECTED: "Not approved",
  ACTIVE: "Active", DEACTIVATED: "Deactivated"
};

export function StatusTag({ status, label }) {
  return <span className={`tag tag--${status}`}>{label ?? STATUS_LABEL[status] ?? status}</span>;
}

// "EB task" (EB head -> coordinators) or "Team task" (coordinator -> volunteers).
export function LevelTag({ level }) {
  return <span className={`tag tag--lv-${level}`}>{level === "TEAM" ? "Team task" : "EB task"}</span>;
}

// Picked / submitted / scored as one stacked bar, with the numbers under it.
export function Progress({ counts, noun = "picked" }) {
  if (!counts) return null;
  const { picked, submitted, scored, late } = counts;
  const pctOf = (n) => (picked ? `${(n / picked) * 100}%` : "0%");
  return (
    <div className="progress">
      <div className="progress-bar" aria-hidden="true">
        <i className="scored" style={{ width: pctOf(scored) }} />
        <i className="submitted" style={{ width: pctOf(Math.max(submitted - scored, 0)) }} />
        <i className="picked" style={{ width: pctOf(Math.max(picked - submitted, 0)) }} />
      </div>
      <small className="muted">
        {noun === "coordinators" ? `${picked} ${picked === 1 ? "coordinator" : "coordinators"} on it` : `${picked} ${noun}`} · {submitted} submitted{late ? ` (${late} late)` : ""} · {scored} scored
      </small>
    </div>
  );
}

export function OutcomeTag({ outcome }) {
  return <span className={`tag tag--o-${outcome}`}>{OUTCOME_LABEL[outcome] ?? outcome}</span>;
}

// Which build this is, so nobody mixes up the two demo sites. Publishes its
// height as --banner so sticky rails and sidebars sit below it.
export function EditionBanner() {
  const edition = import.meta.env.VITE_EDITION;
  const ref = useRef(null);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const node = ref.current;
    if (!node) {
      root.style.setProperty("--banner", "0px");
      return undefined;
    }
    const update = () => root.style.setProperty("--banner", `${node.offsetHeight}px`);
    update();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;
    observer?.observe(node);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
      root.style.setProperty("--banner", "0px");
    };
  }, [edition]);

  if (!edition) return null;
  const original = edition === "original";
  return (
    <div ref={ref} className={`edition edition--${edition}`} role="note">
      <b>{original ? "Original version" : "Improved version"}</b>
      <span>{original ? "Your team's GitHub backend, exactly as it is. Some screens fail on purpose to show what's missing." : "All backend review fixes applied. Demo data: anything you change is shared with everyone."}</span>
    </div>
  );
}

// Public backend settings (upload limit, demo mode).
export function useConfig() {
  const [config, setConfig] = useState(currentConfig);
  useEffect(() => {
    let live = true;
    loadConfig().then((c) => live && setConfig(c));
    return () => { live = false; };
  }, []);
  return config;
}

// Demo-only UI (demo logins, "Reset demo data") shows in `vite dev` or when the backend says so.
export function useDemo() {
  const config = useConfig();
  return Boolean(config.demo);
}

export function ErrorNote({ error }) {
  if (!error) return null;
  return <p className="note note--error" role="alert">{error}</p>;
}

export function Loading({ label = "Loading…" }) {
  return <p className="muted loading" role="status"><span className="spinner" aria-hidden="true" />{label}</p>;
}

export function Empty({ title, children, icon = "heart" }) {
  return (
    <div className="empty">
      <span className="empty-icon" aria-hidden="true"><Icon name={icon} size={20} /></span>
      <b>{title}</b>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

// Small toast for "Saved" style confirmations.
export function useToast() {
  const [toast, setToast] = useState(null);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  const node = toast ? <div className="toast" role="status"><span className="toast-dot" aria-hidden="true" />{toast}</div> : null;
  return [node, setToast];
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/*
 * Side-sheet dialog. Moves focus inside on open, keeps Tab inside, makes the
 * page behind inert, and gives focus back to whatever opened it on close.
 * With `dirty`, closing by Escape / backdrop / ✕ asks first so typed work isn't lost.
 */
export function Panel({ title, onClose, children, wide = false, dirty = false }) {
  const panelRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const requestClose = () => {
    if (dirtyRef.current && !window.confirm("Discard what you've typed?")) return;
    onCloseRef.current();
  };
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  useEffect(() => {
    const opener = document.activeElement;
    const root = document.getElementById("root");
    if (root) root.inert = true;

    const panel = panelRef.current;
    const first = panel?.querySelector(".panel-body " + FOCUSABLE.split(", ").join(", .panel-body "));
    (first ?? panel)?.focus();

    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        requestCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === firstItem || !panel.contains(document.activeElement))) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
      if (root) root.inert = false;
      if (opener && typeof opener.focus === "function" && document.contains(opener)) opener.focus();
    };
  }, []);

  return createPortal(
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && requestClose()}>
      <section ref={panelRef} tabIndex={-1} className={`panel${wide ? " panel--wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="panel-title">
        <header className="panel-head">
          <h2 id="panel-title">{title}</h2>
          <button type="button" className="icon-btn" onClick={requestClose} aria-label="Close"><Icon name="x" size={18} /></button>
        </header>
        <div className="panel-body">{children}</div>
      </section>
    </div>,
    document.body
  );
}

// "Are you sure?" dialog for irreversible or far-reaching actions.
export function Confirm({ title, children, confirmLabel, danger = false, onConfirm, onCancel, cancelLabel = "Cancel" }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err.message);
      setPending(false);
    }
  }

  return (
    <Panel title={title} onClose={() => !pending && onCancel()}>
      <div className="form">
        <div>{children}</div>
        <ErrorNote error={error} />
        <div className="row">
          <button type="button" className={`btn${danger ? " btn--danger" : ""}`} disabled={pending} onClick={confirm}>
            {pending ? "Working…" : confirmLabel}
          </button>
          <button type="button" className="btn btn--ghost" disabled={pending} onClick={onCancel}>{cancelLabel}</button>
        </div>
      </div>
    </Panel>
  );
}
