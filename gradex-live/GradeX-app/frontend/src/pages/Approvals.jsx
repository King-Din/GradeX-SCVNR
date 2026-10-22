import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { Avatar, Empty, ErrorNote, FeedbackNote, Loading, StatusTag, useToast } from "../components/ui.jsx";
import Icon from "../components/Icon.jsx";
import { firstName, fmtDateTime, isoToLocalInput, isPast, localInputToIso, relative } from "../format.js";

/*
 * The EB head's approvals inbox: coordinators' own task ideas. Approving one
 * opens it to that coordinator's team at once; turning it down needs a reason,
 * which the coordinator sees.
 */
export default function Approvals({ user, domains, refreshCounts = () => {} }) {
  const isAdmin = user.role === "ADMIN";
  const [state, setState] = useState({ status: "loading", tasks: [], error: null });
  const [toast, showToast] = useToast();

  const load = useCallback((signal) => {
    api.proposals(signal)
      .then(({ tasks }) => setState({ status: "ready", tasks, error: null }))
      .catch((error) => error.name !== "AbortError" && setState({ status: "error", tasks: [], error: error.message }));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const domainName = (id) => domains.find((d) => d.id === id)?.name ?? id;
  const waiting = state.tasks.filter((t) => t.status === "PROPOSED");
  const decided = state.tasks.filter((t) => t.status !== "PROPOSED").slice(0, 12);

  const done = (message) => {
    showToast(message);
    load();
    refreshCounts();
  };

  return (
    <main className="page page--full">
      <header className="page-head">
        <div>
          <p className="eyebrow">{isAdmin ? "All domains" : `${domainName(user.domainId)} · proposals from your coordinators`}</p>
          <h1>Approvals</h1>
          <p className="muted">Coordinators propose their own tasks for their team. Approve one and it opens to that coordinator's volunteers straight away; if you turn it down, say why and they'll see it.</p>
        </div>
      </header>

      {state.status === "loading" && <Loading />}
      <ErrorNote error={state.error} />

      {state.status === "ready" && (
        <>
          <h2 className="section-title">Waiting for you <span className="count-pill">{waiting.length}</span></h2>
          {waiting.length === 0 && <Empty title="Nothing waiting" icon="check-circle">New proposals from coordinators appear here.</Empty>}
          <div className="card-grid">
            {waiting.map((task) => (
              <ProposalCard key={task.id} task={task} showDomain={isAdmin} domainName={domainName} onDone={done} />
            ))}
          </div>

          {decided.length > 0 && (
            <>
              <h2 className="section-title">Decided</h2>
              <div className="surface list-card">
                {decided.map((task) => (
                  <div key={task.id} className="history-row">
                    <span>
                      <b>{task.title}</b>
                      <small>{task.owner?.name ?? "A coordinator"}{isAdmin ? ` · ${domainName(task.domainId)}` : ""} · {task.reviewer ? `${task.status === "REJECTED" ? "turned down" : "approved"} by ${task.reviewer.name} ${relative(task.reviewedAt)}` : ""}</small>
                    </span>
                    <span className="history-meta">
                      <StatusTag status={task.status === "REJECTED" ? "REJECTED" : "ACTIVE"} label={task.status === "REJECTED" ? "Not approved" : "Approved"} />
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
      {toast}
    </main>
  );
}

export function ProposalCard({ task, showDomain, domainName, onDone }) {
  const [mode, setMode] = useState(null); // null | "approve" | "reject"
  const [note, setNote] = useState("");
  const stale = isPast(task.deadline);
  const [deadline, setDeadline] = useState(stale ? "" : isoToLocalInput(task.deadline));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const owner = task.owner?.name ?? "the coordinator";

  async function decide() {
    setPending(true);
    setError(null);
    try {
      if (mode === "approve") {
        const body = { note: note.trim() || undefined };
        if (stale || deadline !== isoToLocalInput(task.deadline)) {
          if (!deadline) throw new Error("Set a new deadline: the proposed one has passed.");
          body.deadline = localInputToIso(deadline);
        }
        await api.approveTask(task.id, body);
        onDone(`Approved "${task.title}". It's open to ${firstName(owner)}'s team now.`);
      } else {
        await api.rejectTask(task.id, note.trim());
        onDone(`Turned down "${task.title}". ${firstName(owner)} will see your reason.`);
      }
    } catch (err) {
      setError(err.message);
      setPending(false);
    }
  }

  return (
    <article className="card">
      <div className="card-top">
        <span className="tile tint--sun" aria-hidden="true"><Icon name="bulb" size={18} /></span>
        <div className="card-title">
          <h3>{task.title}</h3>
          <p className="small muted">For {firstName(owner)}'s team{showDomain ? ` · ${domainName(task.domainId)}` : ""} · proposed {relative(task.createdAt)}</p>
        </div>
      </div>
      <p className="person small"><Avatar name={owner} size="sm" /><span><b>{owner}</b><small>Coordinator</small></span></p>
      <p className="brief small">{task.description}</p>
      <p className={`small due-line ${stale ? "bad" : "muted"}`}><Icon name="calendar" size={15} />Due {fmtDateTime(task.deadline)} ({relative(task.deadline)}){stale ? ": set a new deadline to approve it" : ""}</p>

      {mode === null && (
        <div className="row">
          <button type="button" className="btn btn--small" onClick={() => { setMode("approve"); setNote(""); }}><Icon name="check" size={15} />Approve…</button>
          <button type="button" className="btn btn--ghost btn--small" onClick={() => { setMode("reject"); setNote(""); }}>Not approved…</button>
        </div>
      )}

      {mode && (
        <div className={`confirm${mode === "approve" ? " confirm--calm" : ""}`}>
          {mode === "approve" ? (
            <>
              <p className="small">Approve it and <b>{firstName(owner)}'s volunteers</b> can pick it straight away.</p>
              <label className="field">
                <span>Deadline</span>
                <input id={`approve-deadline-${task.id}`} type="datetime-local" required value={deadline} min={isoToLocalInput(new Date(Date.now() + 60000).toISOString())} onChange={(e) => setDeadline(e.target.value)} />
              </label>
              <label className="field">
                <span>Note for {firstName(owner)} (optional)</span>
                <textarea id={`approve-note-${task.id}`} rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Lovely idea, go ahead." />
              </label>
            </>
          ) : (
            <label className="field">
              <span>Why not? {firstName(owner)} will see this</span>
              <textarea id={`reject-reason-${task.id}`} rows={3} required maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What would need to change, or why it doesn't fit right now" />
            </label>
          )}
          <ErrorNote error={error} />
          <div className="row">
            <button type="button" className={`btn btn--small${mode === "reject" ? " btn--danger" : ""}`} disabled={pending || (mode === "reject" && !note.trim()) || (mode === "approve" && !deadline)} onClick={decide}>
              {pending ? "Saving…" : mode === "approve" ? `Approve for ${firstName(owner)}'s team` : "Turn it down"}
            </button>
            <button type="button" className="btn btn--ghost btn--small" disabled={pending} onClick={() => { setMode(null); setError(null); }}>Cancel</button>
          </div>
        </div>
      )}
      {task.reviewNote && <FeedbackNote feedback={task.reviewNote} compact />}
    </article>
  );
}
