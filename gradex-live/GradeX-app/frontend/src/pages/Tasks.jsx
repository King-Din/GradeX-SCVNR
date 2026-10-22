import { useCallback, useEffect, useState } from "react";
import { api, openSubmission } from "../api.js";
import { Avatar, Confirm, Empty, ErrorNote, FeedbackNote, LevelTag, Loading, OutcomeTag, Panel, Progress, StatusTag, useToast } from "../components/ui.jsx";
import { useDraft } from "../drafts.js";
import Icon from "../components/Icon.jsx";
import { firstName, fmtDateTime, isoToLocalInput, isPast, localInputToIso, relative } from "../format.js";

// Icon tile per status, so the list scans at a glance.
export const TASK_ICON = {
  AVAILABLE: ["target", "sky"], DRAFT: ["edit", "lilac"], CLOSED: ["check", "leaf"], PROPOSED: ["bulb", "sun"], REJECTED: ["x", "rose"]
};

const STATUS_FILTERS = [
  { key: "ALL", label: "All" },
  { key: "AVAILABLE", label: "Published" },
  { key: "DRAFT", label: "Drafts" },
  { key: "CLOSED", label: "Closed" }
];

/*
 * Tasks for EB heads and admins. EB tasks are theirs to publish, edit and
 * close; team tasks (what each coordinator forwarded or had approved) are
 * shown so they can follow every team, but only the coordinator runs them.
 */
export default function Tasks({ user, domains, intent = null, onIntentUsed = () => {} }) {
  const isAdmin = user.role === "ADMIN";
  const [state, setState] = useState({ status: "loading", tasks: [], error: null });
  const [level, setLevel] = useState("DOMAIN");
  const [filter, setFilter] = useState("ALL");
  const [domainFilter, setDomainFilter] = useState("");
  const [editing, setEditing] = useState(null); // null | "new" | task
  const [openTaskId, setOpenTaskId] = useState(null);
  const [closing, setClosing] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [toast, showToast] = useToast();

  const load = useCallback((signal) => {
    api.tasks(signal)
      .then(({ tasks }) => setState({ status: "ready", tasks, error: null }))
      .catch((error) => error.name !== "AbortError" && setState({ status: "error", tasks: [], error: error.message }));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // Arrived from "Publish an EB task" on the home page: open the form once.
  useEffect(() => {
    if (intent === "new") {
      setEditing("new");
      onIntentUsed();
    }
  }, [intent, onIntentUsed]);

  const domainName = (id) => domains.find((d) => d.id === id)?.name ?? id;
  const ownDomain = domainName(user.domainId);
  const inLevel = state.tasks.filter((t) => t.level === level && (!domainFilter || t.domainId === domainFilter));
  // Proposals live on the Approvals page; here, only what's been published or drafted.
  const listed = inLevel.filter((t) => t.status !== "PROPOSED" && t.status !== "REJECTED");
  const visible = listed.filter((t) => filter === "ALL" || t.status === filter);
  const count = (status) => listed.filter((t) => t.status === status).length;
  const openTask = state.tasks.find((t) => t.id === openTaskId) ?? null;
  const manages = (task) => isAdmin || task.level === "DOMAIN";

  async function publish(task) {
    if (busyId) return;
    setBusyId(task.id);
    try {
      await api.updateTask(task.id, { status: "AVAILABLE" });
      showToast(`Published "${task.title}" to the coordinators`);
      load();
    } catch (error) {
      showToast(error.message);
    }
    setBusyId(null);
  }

  async function close(task) {
    await api.updateTask(task.id, { status: "CLOSED" });
    setClosing(null);
    showToast(`Closed "${task.title}"`);
    load();
  }

  return (
    <main className="page page--full">
      <header className="page-head">
        <div>
          <p className="eyebrow">{isAdmin ? "All domains" : `${ownDomain} · you're the EB head`}</p>
          <h1>Tasks</h1>
          <p className="muted">
            {level === "DOMAIN"
              ? "EB tasks go to the domain's coordinators. Each picks it, does it alone or forwards it to their team, then sends you the final work."
              : "What each coordinator forwarded to their team, or had approved. Coordinators run these; you can follow every one."}
          </p>
        </div>
        <div className="row">
          {isAdmin && (
            <label className="field field--inline">
              <span>Domain</span>
              <select id="tasks-domain" value={domainFilter} onChange={(e) => setDomainFilter(e.target.value)}>
                <option value="">All domains</option>
                {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
          )}
          <button type="button" className="btn" onClick={() => setEditing("new")}><Icon name="plus" size={17} />New EB task</button>
        </div>
      </header>

      <div className="toolbar">
        <div className="tabs tabs--inline" role="group" aria-label="Which tasks">
          <button type="button" aria-pressed={level === "DOMAIN"} className={level === "DOMAIN" ? "is-on" : ""} onClick={() => { setLevel("DOMAIN"); setFilter("ALL"); }}>EB tasks</button>
          <button type="button" aria-pressed={level === "TEAM"} className={level === "TEAM" ? "is-on" : ""} onClick={() => { setLevel("TEAM"); setFilter("ALL"); }}>Team tasks</button>
        </div>
        <div className="chips" role="group" aria-label="Filter by status">
          {STATUS_FILTERS.filter((f) => level === "DOMAIN" || f.key !== "DRAFT").map((f) => (
            <button key={f.key} type="button" aria-pressed={filter === f.key} className={`chip${filter === f.key ? " is-on" : ""}`} onClick={() => setFilter(f.key)}>
              {f.label}<em>{f.key === "ALL" ? listed.length : count(f.key)}</em>
            </button>
          ))}
        </div>
      </div>

      {state.status === "loading" && <Loading />}
      <ErrorNote error={state.error} />

      {state.status === "ready" && visible.length === 0 && (
        <Empty title="No tasks here" icon="tasks">
          {level === "DOMAIN" ? "Create an EB task, save it as a draft, and publish it to your coordinators when the brief is ready." : "When a coordinator forwards an EB task to their team, it shows up here."}
        </Empty>
      )}

      {state.status === "ready" && visible.length > 0 && (
        <div className="table-wrap">
          <table className="table table--cards">
            <thead>
              <tr><th>Task</th><th>Deadline</th><th>Progress</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {visible.map((task) => (
                <tr key={task.id} className="is-clickable" onClick={() => setOpenTaskId(task.id)}>
                  <td data-label="Task">
                    <TaskCell task={task} onOpen={() => setOpenTaskId(task.id)} sub={[task.id, isAdmin ? domainName(task.domainId) : null, task.level === "TEAM" ? `${task.owner?.name ?? "A coordinator"}'s team` : null].filter(Boolean).join(" · ")} />
                  </td>
                  <td data-label="Deadline">
                    <span className="block">{fmtDateTime(task.deadline)}</span>
                    <small className={`due-chip${isPast(task.deadline) ? "" : " due-chip--soon"}`}>{relative(task.deadline)}</small>
                  </td>
                  <td data-label="Progress"><Progress counts={task.counts} noun={task.level === "DOMAIN" ? "coordinators" : "picked"} /></td>
                  <td data-label="Status"><StatusTag status={task.status} /></td>
                  <td className="actions" onClick={(e) => e.stopPropagation()}>
                    {manages(task) && task.status === "DRAFT" && (
                      <button type="button" className="btn btn--small" disabled={busyId === task.id} onClick={() => publish(task)}>
                        {busyId === task.id ? "Publishing…" : "Publish"}
                      </button>
                    )}
                    {manages(task) && task.status === "AVAILABLE" && <button type="button" className="btn btn--small btn--ghost" onClick={() => setClosing(task)}>Close…</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <TaskForm
          task={editing === "new" ? null : editing}
          draftKey={`task.${editing === "new" ? "new" : editing.id}`}
          panelTitle={editing === "new" ? "New EB task" : "Edit task"}
          domains={isAdmin ? domains : null}
          defaultDomain={user.domainId}
          hint={editing === "new" || editing.level === "DOMAIN"
            ? `${isAdmin ? "The domain's" : `${ownDomain}'s`} coordinators can pick it once it's published. Each does it alone or forwards it to their team, then sends the final work for you to score. Late work is accepted and marked late.`
            : "Changes reach the coordinator's team straight away."}
          actions={editing === "new" ? [{ label: "Publish to coordinators", status: "AVAILABLE" }, { label: "Save as draft", status: "DRAFT", ghost: true }] : [{ label: "Save changes" }]}
          onSave={async (body, status) => {
            if (editing === "new") {
              await api.createTask({ ...body, status, domainId: isAdmin ? body.domainId : user.domainId });
              return status === "AVAILABLE" ? `Published "${body.title}" to the coordinators` : `Saved "${body.title}" as a draft`;
            }
            await api.updateTask(editing.id, body);
            return `Saved "${body.title}"`;
          }}
          onClose={() => setEditing(null)}
          onSaved={(message) => { setEditing(null); showToast(message); load(); }}
        />
      )}

      {openTask && !editing && !closing && (
        <TaskDetail
          task={openTask}
          domainName={domainName}
          canManage={manages(openTask)}
          onClose={() => setOpenTaskId(null)}
          onEdit={() => setEditing(openTask)}
          onCloseTask={() => setClosing(openTask)}
        />
      )}

      {closing && (
        <CloseConfirm task={closing} onConfirm={() => close(closing)} onCancel={() => setClosing(null)} />
      )}
      {toast}
    </main>
  );
}

export function TaskCell({ task, onOpen, sub }) {
  const [icon, tint] = TASK_ICON[task.status] ?? TASK_ICON.AVAILABLE;
  return (
    <span className="task-cell">
      <span className={`tile tint--${tint}`} aria-hidden="true"><Icon name={icon} size={17} /></span>
      <span>
        <button type="button" className="link-btn link-btn--title" onClick={(e) => { e.stopPropagation(); onOpen(); }}>{task.title}</button>
        <small className="block muted">{sub}</small>
      </span>
    </span>
  );
}

export function CloseConfirm({ task, onConfirm, onCancel }) {
  return (
    <Confirm title={`Close "${task.title}"?`} confirmLabel="Close the task" danger onConfirm={onConfirm} onCancel={onCancel} cancelLabel="Keep it open">
      <p>{task.level === "TEAM" ? "Your volunteers" : "Coordinators"} won't be able to pick it or send work for it any more. A closed task can't be reopened.</p>
    </Confirm>
  );
}

/*
 * One form for every kind of task: a new EB task, an edit, a coordinator's
 * proposal, or forwarding an EB task to a team. `onSave(body, status)`
 * returns the toast message; `maxDeadline` caps the deadline (a team task
 * must end on or before its EB task).
 */
export function TaskForm({ task = null, initial: start = null, draftKey, panelTitle, domains = null, defaultDomain, hint, actions, maxDeadline = null, onSave, onClose, onSaved, children }) {
  const initial = {
    title: start?.title ?? task?.title ?? "",
    description: start?.description ?? task?.description ?? "",
    deadline: start?.deadline ? isoToLocalInput(start.deadline) : task ? isoToLocalInput(task.deadline) : ""
  };
  const [fields, setFields, clearDraft, restored] = useDraft(draftKey, initial);
  const { title, description, deadline } = fields;
  const set = (key) => (e) => setFields((f) => ({ ...f, [key]: e.target.value }));
  const ownDomain = defaultDomain && domains?.some((d) => d.id === defaultDomain) ? defaultDomain : null;
  const [domainId, setDomainId] = useState(task?.domainId ?? ownDomain ?? domains?.[0]?.id ?? defaultDomain ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  // The domain list can arrive after the form opens.
  useEffect(() => {
    if (domains && !domainId && domains[0]) setDomainId(domains.some((d) => d.id === defaultDomain) ? defaultDomain : domains[0].id);
  }, [domains, domainId]);

  const dirty = title !== initial.title || description !== initial.description || deadline !== initial.deadline;
  const deadlineChanged = !task || deadline !== initial.deadline;

  async function save(status) {
    if (pending) return;
    if (domains && !domainId) return setError("Choose a domain for this task.");
    const iso = localInputToIso(deadline);
    if (deadlineChanged && Date.parse(iso) <= Date.now()) return setError("Pick a deadline in the future.");
    if (maxDeadline && Date.parse(iso) > Date.parse(maxDeadline)) return setError(`Pick a deadline on or before the EB deadline (${fmtDateTime(maxDeadline)}).`);
    setPending(true);
    setError(null);
    try {
      const body = { title: title.trim(), description: description.trim(), deadline: iso };
      if (domains) body.domainId = domainId;
      if (task && !deadlineChanged) delete body.deadline;
      const message = await onSave(body, status);
      clearDraft();
      onSaved(message);
    } catch (err) {
      setError(err.message);
      setPending(false);
    }
  }

  const ready = title.trim() && description.trim() && deadline;
  const minDeadline = deadlineChanged ? isoToLocalInput(new Date(Date.now() + 60000).toISOString()) : undefined;
  const [primary, ...rest] = actions;

  return (
    <Panel title={panelTitle} onClose={() => { clearDraft(); onClose(); }} dirty={dirty && !pending}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); save(primary.status); }}>
        {children}
        {restored && dirty && <p className="note small">We kept what you were typing last time.</p>}
        <label className="field">
          <span>Title</span>
          <input id="task-title" required maxLength={200} value={title} onChange={set("title")} placeholder="Poster for blood donation camp" />
        </label>
        <label className="field">
          <span>Brief</span>
          <textarea id="task-description" required rows={5} maxLength={5000} value={description} onChange={set("description")} placeholder="What should be made, and what must it include?" />
        </label>
        <div className="form-row">
          <label className="field">
            <span>Deadline</span>
            <input id="task-deadline" type="datetime-local" required min={minDeadline} max={maxDeadline ? isoToLocalInput(maxDeadline) : undefined} value={deadline} onChange={set("deadline")} />
            {maxDeadline && <small className="muted">On or before the EB deadline, {fmtDateTime(maxDeadline)}.</small>}
          </label>
          {domains && (
            <label className="field">
              <span>Domain</span>
              <select id="task-domain" required value={domainId} onChange={(e) => setDomainId(e.target.value)}>
                {!domainId && <option value="">Loading domains…</option>}
                {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
          )}
        </div>
        {hint && <p className="muted small">{hint}</p>}
        <ErrorNote error={error} />
        <div className="row">
          <button type="submit" className="btn" disabled={!ready || pending}>{pending ? "Saving…" : primary.label}</button>
          {rest.map((a) => (
            <button key={a.label} type="button" className="btn btn--ghost" disabled={!ready || pending} onClick={() => save(a.status)}>{a.label}</button>
          ))}
        </div>
      </form>
    </Panel>
  );
}

/*
 * A task's detail. For an EB task: each coordinator delivering it, the team
 * task they forwarded and their final work. For a team task: who picked it.
 */
export function TaskDetail({ task, domainName, canManage, onClose, onEdit, onCloseTask, viewer = "eb" }) {
  const [state, setState] = useState({ status: "loading", people: [], error: null });
  const [openError, setOpenError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading", people: [], error: null });
    api.participants(task.id, controller.signal)
      .then(({ participants }) => setState({ status: "ready", people: participants, error: null }))
      .catch((error) => error.name !== "AbortError" && setState({ status: "error", people: [], error: error.message }));
    return () => controller.abort();
  }, [task.id]);

  const open = (submission) => { setOpenError(null); openSubmission(submission).catch((e) => setOpenError(e.message)); };
  const domainTask = task.level === "DOMAIN";

  return (
    <Panel title={task.title} onClose={onClose} wide>
      <div className="task-meta">
        <LevelTag level={task.level} />
        <StatusTag status={task.status} />
        <span className="muted small">{task.id} · {domainName(task.domainId)} · due {fmtDateTime(task.deadline)} ({relative(task.deadline)})</span>
      </div>
      {!domainTask && (
        <p className="small muted">
          {task.owner ? `${task.owner.name}'s team` : "A team task"}
          {task.parent ? ` · forwarded from the EB task "${task.parent.title}" (due ${fmtDateTime(task.parent.deadline)})` : task.reviewer ? ` · proposed by ${firstName(task.owner?.name)}, approved by ${task.reviewer.name}` : ""}
        </p>
      )}
      {task.counts && task.status !== "PROPOSED" && task.status !== "REJECTED" && <Progress counts={task.counts} noun={domainTask ? "coordinators" : "picked"} />}
      <div className="brief-card">
        <span className="eyebrow">Brief</span>
        <p className="brief">{task.description}</p>
      </div>
      {task.reviewNote && <FeedbackNote feedback={task.reviewNote} by={task.reviewer?.name} compact />}
      {canManage && task.status !== "CLOSED" && (
        <div className="row">
          <button type="button" className="btn btn--ghost btn--small" onClick={onEdit}><Icon name="edit" size={15} />Edit task</button>
          {task.status === "AVAILABLE" && <button type="button" className="btn btn--ghost btn--small" onClick={onCloseTask}><Icon name="lock" size={15} />Close task…</button>}
        </div>
      )}

      {(task.status === "PROPOSED" || task.status === "REJECTED") ? (
        <p className="note note--info small"><Icon name="lock" size={16} /><span>{task.status === "PROPOSED" ? "Waiting for the EB head's approval. Your team sees it once it's approved." : "Not approved, so your team never saw it. Propose a new task if you'd like to try again."}</span></p>
      ) : (<>
      <h3 className="section-title">{domainTask ? "Coordinators delivering it" : "Who picked it"} <span className="count-pill">{task.counts?.picked ?? state.people.length}</span></h3>
      {state.status === "loading" && <Loading />}
      <ErrorNote error={state.error ?? openError} />
      {state.status === "ready" && state.people.length === 0 && (
        <p className="muted small">{task.status === "DRAFT" ? "Publish the task so coordinators can pick it." : domainTask ? "No coordinator has picked this task yet." : "Nobody in the team has picked this task yet."}</p>
      )}
      <div className="people-list">
        {state.people.map((p) => (
          <div key={p.id} className={`people-row${domainTask ? " people-row--final" : ""}`}>
            <span className="person">
              <Avatar name={p.volunteer?.name} size="sm" />
              <span>
                <b>{p.volunteer?.name}</b>
                <small>
                  {domainTask
                    ? p.teamTask ? `Forwarded to the team · ${p.teamTask.counts.submitted} of ${p.teamTask.counts.picked} sent` : "Doing it alone"
                    : `picked ${fmtDateTime(p.chosenAt)}`}
                </small>
              </span>
            </span>
            <OutcomeTag outcome={p.outcome} />
            <span className={p.evaluation ? "score-chip" : "muted small"}>{p.evaluation ? `${p.evaluation.score}/100` : p.submission ? (domainTask && viewer === "eb" ? "to score" : "not scored") : domainTask ? "no final yet" : ""}</span>
            {p.submission ? (
              <button type="button" className="link-btn tap" onClick={() => open(p.submission)}>
                {domainTask ? "Final work" : p.submission.kind === "LINK" ? "Open link" : "Open file"} <Icon name="arrow-ur" size={14} />
              </button>
            ) : <span />}
          </div>
        ))}
      </div>
      </>)}
    </Panel>
  );
}
