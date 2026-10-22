import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { Empty, ErrorNote, Loading, Progress, StatusTag, useToast } from "../components/ui.jsx";
import Icon from "../components/Icon.jsx";
import { firstName, fmtDateTime, isPast, relative } from "../format.js";
import { CloseConfirm, TaskCell, TaskDetail, TaskForm } from "./Tasks.jsx";

/*
 * A coordinator's team tasks: EB tasks they forwarded, and their own ideas
 * (proposals), which the EB head must approve before volunteers see them.
 */
export default function TeamTasks({ user, context, domains, intent = null, onIntentUsed = () => {} }) {
  const [state, setState] = useState({ status: "loading", tasks: [], error: null });
  const [filter, setFilter] = useState("AVAILABLE");
  const [editing, setEditing] = useState(null); // null | "propose" | task
  const [openTaskId, setOpenTaskId] = useState(null);
  const [closing, setClosing] = useState(null);
  const [toast, showToast] = useToast();

  const head = context?.head?.name ?? "your EB head";
  const headFirst = context?.head ? firstName(context.head.name) : "your EB head";
  const domain = context?.domain?.name ?? domains.find((d) => d.id === user.domainId)?.name ?? "";

  const load = useCallback((signal) => {
    api.tasks(signal, "TEAM")
      .then(({ tasks }) => setState({ status: "ready", tasks, error: null }))
      .catch((error) => error.name !== "AbortError" && setState({ status: "error", tasks: [], error: error.message }));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (intent === "propose") {
      setEditing("propose");
      onIntentUsed();
    }
  }, [intent, onIntentUsed]);

  const FILTERS = [
    { key: "AVAILABLE", label: "Open" },
    { key: "PROPOSED", label: "Waiting for approval" },
    { key: "REJECTED", label: "Not approved" },
    { key: "CLOSED", label: "Closed" },
    { key: "ALL", label: "All" }
  ];
  const count = (key) => (key === "ALL" ? state.tasks.length : state.tasks.filter((t) => t.status === key).length);
  const visible = state.tasks.filter((t) => filter === "ALL" || t.status === filter);
  const openTask = state.tasks.find((t) => t.id === openTaskId) ?? null;
  const statusLabel = (task) => (task.status === "PROPOSED" ? `Waiting for ${headFirst}` : undefined);

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
          <p className="eyebrow">{domain} · {user.name.split(" ")[0]}'s team</p>
          <h1>Team tasks</h1>
          <p className="muted">What your volunteers can pick: EB tasks you forwarded to the team, and your own ideas once {headFirst} approves them.</p>
        </div>
        <button type="button" className="btn" onClick={() => setEditing("propose")}><Icon name="bulb" size={17} />Propose a task</button>
      </header>

      <div className="chips" role="group" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" aria-pressed={filter === f.key} className={`chip${filter === f.key ? " is-on" : ""}`} onClick={() => setFilter(f.key)}>
            {f.label}<em>{count(f.key)}</em>
          </button>
        ))}
      </div>

      {state.status === "loading" && <Loading />}
      <ErrorNote error={state.error} />

      {state.status === "ready" && visible.length === 0 && (
        <Empty title={filter === "PROPOSED" ? "No proposals waiting" : "No team tasks here"} icon="tasks">
          {filter === "AVAILABLE"
            ? <>On your Home page, use <b>Forward to my team</b> on an EB task, or propose your own task.</>
            : "Propose a task when your team has an idea; it opens to them once approved."}
        </Empty>
      )}

      {state.status === "ready" && visible.length > 0 && (
        <div className="table-wrap">
          <table className="table table--cards">
            <thead>
              <tr><th>Task</th><th>Deadline</th><th>Your team</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {visible.map((task) => (
                <tr key={task.id} className="is-clickable" onClick={() => setOpenTaskId(task.id)}>
                  <td data-label="Task">
                    <TaskCell task={task} onOpen={() => setOpenTaskId(task.id)} sub={task.parent ? `From the EB task "${task.parent.title}"` : task.status === "PROPOSED" ? "Your proposal" : task.status === "REJECTED" ? `Your proposal, not approved by ${task.reviewer?.name ?? headFirst}` : `Your idea, approved by ${task.reviewer?.name ?? headFirst}`} />
                  </td>
                  <td data-label="Deadline">
                    <span className="block">{fmtDateTime(task.deadline)}</span>
                    <small className={`due-chip${isPast(task.deadline) ? "" : " due-chip--soon"}`}>{relative(task.deadline)}</small>
                  </td>
                  <td data-label="Your team">
                    {task.status === "PROPOSED" || task.status === "REJECTED" ? <small className="muted">Not open to the team</small> : <Progress counts={task.counts} />}
                  </td>
                  <td data-label="Status"><StatusTag status={task.status} label={statusLabel(task)} /></td>
                  <td className="actions" onClick={(e) => e.stopPropagation()}>
                    {task.status === "AVAILABLE" && <button type="button" className="btn btn--small btn--ghost" onClick={() => setClosing(task)}>Close…</button>}
                    {task.status === "REJECTED" && <button type="button" className="link-btn tap" onClick={() => setOpenTaskId(task.id)}>See why</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing === "propose" && (
        <TaskForm
          draftKey="proposal.new"
          panelTitle="Propose a task for your team"
          hint={`${head} (EB, ${domain}) approves it before your volunteers see it. If it isn't approved, you'll see why here.`}
          actions={[{ label: `Send to ${headFirst} for approval` }]}
          onSave={async (body) => {
            await api.propose(body);
            return `Sent "${body.title}" to ${headFirst} for approval`;
          }}
          onClose={() => setEditing(null)}
          onSaved={(message) => { setEditing(null); setFilter("PROPOSED"); showToast(message); load(); }}
        />
      )}
      {editing && editing !== "propose" && (
        <TaskForm
          task={editing}
          draftKey={`task.${editing.id}`}
          panelTitle={editing.status === "PROPOSED" ? "Edit your proposal" : "Edit team task"}
          maxDeadline={editing.parent?.deadline ?? null}
          hint={editing.status === "PROPOSED" ? `${headFirst} sees your changes before deciding.` : "Your volunteers see the change straight away."}
          actions={[{ label: "Save changes" }]}
          onSave={async (body) => {
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
          viewer="coordinator"
          domainName={() => domain}
          canManage={openTask.status !== "REJECTED"}
          onClose={() => setOpenTaskId(null)}
          onEdit={() => setEditing(openTask)}
          onCloseTask={() => setClosing(openTask)}
        />
      )}
      {closing && <CloseConfirm task={closing} onConfirm={() => close(closing)} onCancel={() => setClosing(null)} />}
      {toast}
    </main>
  );
}
