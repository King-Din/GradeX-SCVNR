import { useCallback, useEffect, useRef, useState } from "react";
import { api, openSubmission } from "../api.js";
import { Avatar, Empty, ErrorNote, FeedbackNote, Loading, useToast } from "../components/ui.jsx";
import Icon from "../components/Icon.jsx";
import { useDraft } from "../drafts.js";
import { fmtDateTime, relative } from "../format.js";

// On narrow screens the detail sits under the list, so bring it into view.
function revealOnNarrow(node) {
  if (node && window.matchMedia?.("(max-width: 760px)").matches) {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }
}

/*
 * Scoring. Coordinators score their own team's work. EB heads score their
 * coordinators' final work and can follow (not change) the team scores.
 * Admins can score both.
 */
export default function Review({ user, onScored }) {
  const staffAbove = user.role === "ADMIN" || user.role === "EB";
  const [level, setLevel] = useState(staffAbove ? "DOMAIN" : "TEAM");
  const [tab, setTab] = useState("pending");
  const [state, setState] = useState({ status: "loading", items: [], error: null });
  const [selectedId, setSelectedId] = useState(null);
  const [toast, showToast] = useToast();
  const detailRef = useRef(null);
  const requestRef = useRef(null);

  // Only the newest request may update the list (switching tabs quickly
  // must never show "Waiting" items under "Scored").
  const load = useCallback((keepSelection) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const call = tab === "pending" ? api.pendingReviews : api.scoredReviews;
    call(controller.signal, level)
      .then(({ submissions }) => {
        if (controller.signal.aborted) return;
        setState({ status: "ready", items: submissions, error: null });
        setSelectedId((current) => (keepSelection && submissions.some((s) => s.id === current) ? current : submissions[0]?.id ?? null));
      })
      .catch((error) => {
        if (error.name === "AbortError" || controller.signal.aborted) return;
        setState({ status: "error", items: [], error: error.message });
      });
  }, [tab, level]);

  useEffect(() => {
    setState({ status: "loading", items: [], error: null });
    setSelectedId(null);
    load(false);
    return () => requestRef.current?.abort();
  }, [load]);

  const selected = state.items.find((s) => s.id === selectedId) ?? null;

  function select(id) {
    setSelectedId(id);
    requestAnimationFrame(() => revealOnNarrow(detailRef.current));
  }

  function afterScore(submission, { edited = false, score } = {}) {
    showToast(edited ? `Updated ${submission.volunteer?.name}'s score to ${score}` : `Scored ${submission.volunteer?.name}'s ${submission.task?.level === "DOMAIN" ? "final work" : "work"}. They've been notified.`);
    onScored();
    if (edited) {
      load(true);
      return;
    }
    const index = state.items.findIndex((s) => s.id === submission.id);
    const next = state.items[index + 1] ?? state.items[index - 1] ?? null;
    setState((s) => ({ ...s, items: s.items.filter((i) => i.id !== submission.id) }));
    setSelectedId(next?.id ?? null);
  }

  // Someone else scored it first: refresh so the list is honest.
  function onConflict(message) {
    showToast(message);
    onScored();
    load(true);
  }

  return (
    <main className="page page--full review-page">
    <div className="review">
      <section className="queue surface">
        <header className="queue-head">
          <div className="queue-title">
            <h1>Review</h1>
            {state.status === "ready" && <span className="count-pill">{state.items.length} {tab === "pending" ? "waiting" : "scored"}</span>}
          </div>
          {staffAbove ? (
            <div className="seg" role="group" aria-label="Whose work">
              <button type="button" aria-pressed={level === "DOMAIN"} className={level === "DOMAIN" ? "is-on" : ""} onClick={() => setLevel("DOMAIN")}>Coordinators' work</button>
              <button type="button" aria-pressed={level === "TEAM"} className={level === "TEAM" ? "is-on" : ""} onClick={() => setLevel("TEAM")}>Volunteers' work</button>
            </div>
          ) : (
            <p className="small muted">Work your volunteers sent for your team tasks.</p>
          )}
          {level === "TEAM" && user.role === "EB" && <p className="small muted">Coordinators score their own volunteers. You can follow every team here.</p>}
          <div className="tabs" role="group" aria-label="Which submissions">
            <button type="button" aria-pressed={tab === "pending"} className={tab === "pending" ? "is-on" : ""} onClick={() => setTab("pending")}>Waiting</button>
            <button type="button" aria-pressed={tab === "scored"} className={tab === "scored" ? "is-on" : ""} onClick={() => setTab("scored")}>Scored</button>
          </div>
        </header>
        {state.status === "loading" && <Loading />}
        <ErrorNote error={state.error} />
        {state.status === "ready" && state.items.length === 0 && (
          <Empty title={tab === "pending" ? "Nothing waiting" : "Nothing scored yet"} icon="inbox">
            {tab === "pending"
              ? level === "DOMAIN" ? "Final work your coordinators send for EB tasks shows up here." : user.role === "COORDINATOR" ? "Work from your volunteers shows up here." : "Volunteers' work waiting for their coordinator shows up here."
              : "Scores appear here once given."}
          </Empty>
        )}
        <div className="queue-list">
          {state.items.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`queue-item${s.id === selectedId ? " is-selected" : ""}`}
              aria-current={s.id === selectedId ? "true" : undefined}
              onClick={() => select(s.id)}
            >
              <Avatar name={s.volunteer?.name} size="sm" />
              <span className="queue-text">
                <b>{s.volunteer?.name}</b>
                <small>{s.task?.title}</small>
              </span>
              <span className="queue-side">
                {s.evaluation ? <b className="score-chip">{s.evaluation.score}</b> : s.canScore === false ? <span className="go go--quiet" aria-hidden="true">View</span> : <span className="go" aria-hidden="true">Score</span>}
                <small className="muted">{s.isLate ? <span className="late-text">Late · </span> : null}{relative(s.updatedAt ?? s.submittedAt)}</small>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="review-detail surface" ref={detailRef} aria-label="Selected submission">
        {selected ? (
          <SubmissionView
            key={`${selected.id}-${selected.evaluation?.id ?? "new"}`}
            submission={selected}
            onScored={afterScore}
            onConflict={onConflict}
            onError={showToast}
          />
        ) : state.status === "ready" && (
          <Empty title={tab === "pending" ? "You're all caught up" : "Pick a scored submission"} icon={tab === "pending" ? "heart" : "award"} />
        )}
      </section>
    </div>
      {toast}
    </main>
  );
}

function parseScore(value) {
  if (value === "" || value == null) return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 100 ? n : null;
}

function SubmissionView({ submission, onScored, onConflict, onError }) {
  const evaluation = submission.evaluation;
  const [editing, setEditing] = useState(false);
  const firstName = submission.volunteer?.name?.split(" ")[0] ?? "them";
  const final = submission.task?.level === "DOMAIN";
  const viewOnly = submission.canScore === false;

  return (
    <div className="submission">
      <p className="eyebrow">{submission.id} · {final ? "EB task" : "Team task"} · {submission.task?.title}</p>
      <h2>{submission.volunteer?.name}'s {final ? "final work" : "submission"}</h2>
      <div className="meta-row">
        <span>Sent <b>{fmtDateTime(submission.updatedAt ?? submission.submittedAt)}</b></span>
        <span>Deadline <b>{fmtDateTime(submission.task?.deadline)}</b></span>
        {submission.isLate && <span className="tag tag--o-LATE">Sent after the deadline</span>}
      </div>

      <button type="button" className="file-card" onClick={() => openSubmission(submission).catch((e) => onError(e.message))}>
        <span className="file-icon" aria-hidden="true"><Icon name={submission.kind === "LINK" ? "link" : "file"} size={20} /></span>
        <span>
          <b>{submission.kind === "LINK" ? "Open their link" : submission.fileName ?? "Open their file"}</b>
          <small className="block muted">{submission.kind === "LINK" ? submission.linkUrl : "Opens in a new tab, or downloads if your browser can't show it"}</small>
        </span>
        <span className="file-go" aria-hidden="true"><Icon name="arrow-ur" size={16} /></span>
      </button>

      {viewOnly && !evaluation && (
        <p className="note note--info small"><Icon name="eye" size={16} /><span>Their coordinator scores this. You'll see the score and feedback here once it's given.</span></p>
      )}
      {viewOnly && evaluation && (
        <div className="scored">
          <div className="score-big"><b>{evaluation.score}</b><span>/ 100</span></div>
          <FeedbackNote feedback={evaluation.feedback} by={submission.evaluator?.name} />
          <p className="muted small">Scored by {submission.evaluator?.name ?? "their coordinator"} on {fmtDateTime(evaluation.evaluatedAt)}</p>
        </div>
      )}
      {viewOnly ? null : evaluation && !editing ? (
        <div className="scored">
          <div className="score-big"><b>{evaluation.score}</b><span>/ 100</span></div>
          <FeedbackNote feedback={evaluation.feedback} by={submission.evaluator?.name} />
          <p className="muted small">
            Scored by {submission.evaluator?.name ?? "a reviewer"} on {fmtDateTime(evaluation.evaluatedAt)}
            {evaluation.updatedAt && evaluation.updatedAt !== evaluation.evaluatedAt ? ` · edited ${fmtDateTime(evaluation.updatedAt)}` : ""}
          </p>
          <button type="button" className="btn btn--ghost btn--small" onClick={() => setEditing(true)}><Icon name="edit" size={15} />Edit score</button>
        </div>
      ) : (
        <ScoreForm
          submission={submission}
          firstName={firstName}
          evaluation={evaluation}
          onCancel={evaluation ? () => setEditing(false) : null}
          onSaved={(...args) => { setEditing(false); onScored(...args); }}
          onConflict={onConflict}
        />
      )}
    </div>
  );
}

function ScoreForm({ submission, firstName, evaluation, onCancel, onSaved, onConflict }) {
  const editingExisting = Boolean(evaluation);
  const draftKey = `score.${submission.id}${editingExisting ? ".edit" : ""}`;
  const initial = { score: editingExisting ? String(evaluation.score) : "75", feedback: editingExisting ? evaluation.feedback : "" };
  const [fields, setFields, clearDraft, restored] = useDraft(draftKey, initial);
  const { score, feedback } = fields;
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  const parsed = parseScore(score);
  const scoreError = score === "" ? "Enter a score from 0 to 100." : parsed == null ? "The score must be a whole number from 0 to 100." : null;
  const valid = parsed != null && feedback.trim().length > 0;

  function ask(e) {
    e.preventDefault();
    if (!valid) {
      setError(scoreError ?? "Write some feedback for them.");
      return;
    }
    setError(null);
    setConfirming(true);
  }

  async function save() {
    setPending(true);
    setError(null);
    try {
      if (editingExisting) await api.updateEvaluation(evaluation.id, parsed, feedback.trim());
      else await api.evaluate(submission.id, parsed, feedback.trim());
      clearDraft();
      onSaved(submission, { edited: editingExisting, score: parsed });
    } catch (err) {
      setPending(false);
      setConfirming(false);
      if (err.status === 409) return onConflict(err.message);
      setError(err.message);
    }
  }

  const setScore = (value) => {
    setFields((f) => ({ ...f, score: value }));
    setConfirming(false);
  };

  return (
    <form className="form" onSubmit={ask} noValidate>
      {restored && <p className="note small">We kept the score you were writing last time.</p>}
      <div className="score-input">
        <div className="score-big">
          <input
            id="score-number"
            type="number"
            inputMode="numeric"
            min="0"
            max="100"
            step="1"
            required
            value={score}
            onChange={(e) => setScore(e.target.value)}
            aria-label="Score out of 100"
            aria-invalid={Boolean(scoreError)}
            aria-describedby={scoreError ? "score-error" : undefined}
          />
          <span>/ 100</span>
        </div>
        <input id="score-range" type="range" min="0" max="100" step="1" value={parsed ?? 0} onChange={(e) => setScore(e.target.value)} aria-hidden="true" tabIndex={-1} />
        <div className="ticks" aria-hidden="true"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div>
        {scoreError && <small id="score-error" className="bad">{scoreError}</small>}
      </div>
      <label className="field">
        <span>Feedback for {firstName}</span>
        <textarea id="score-feedback" rows={4} required maxLength={2000} value={feedback} onChange={(e) => { setFields((f) => ({ ...f, feedback: e.target.value })); setConfirming(false); }} placeholder="What worked, and what to fix next time" />
      </label>
      <ErrorNote error={error} />
      {confirming ? (
        <div className="confirm confirm--calm" role="alertdialog" aria-labelledby="score-confirm">
          <p id="score-confirm" className="small">
            {editingExisting
              ? <>Change {firstName}'s score from <b>{evaluation.score}</b> to <b>{parsed}/100</b>? They'll be notified straight away.</>
              : <>Save <b>{parsed}/100</b> for {firstName}? They'll be notified straight away.</>}
          </p>
          <div className="row">
            <button type="button" className="btn" disabled={pending} onClick={save} autoFocus>{pending ? "Saving…" : editingExisting ? "Save new score" : "Save score"}</button>
            <button type="button" className="btn btn--ghost" disabled={pending} onClick={() => setConfirming(false)}>Go back</button>
          </div>
        </div>
      ) : (
        <div className="row">
          <button type="submit" className="btn" disabled={pending || !valid}>{editingExisting ? "Save new score…" : "Save score…"}</button>
          {onCancel && <button type="button" className="btn btn--ghost" onClick={() => { clearDraft(); onCancel(); }}>Cancel</button>}
        </div>
      )}
    </form>
  );
}
