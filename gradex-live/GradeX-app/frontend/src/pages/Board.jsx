import { useEffect, useState } from "react";
import { api, openSubmission } from "../api.js";
import { Avatar, Empty, ErrorNote, FeedbackNote, Loading } from "../components/ui.jsx";
import Icon from "../components/Icon.jsx";
import { firstName, fmtDate, fmtDateTime, relative } from "../format.js";

const COORDINATORS = "coordinators";

/*
 * The board: a team's finished work, scores, feedback and leaderboard
 * (volunteers see their own team), or a domain's coordinators' board with
 * their final work on EB tasks and the EB head's scores. Tasks only appear
 * here once their deadline has passed.
 */
export default function Board({ user, domains = [], domainsLoaded = true, embedded = false }) {
  const role = user.role;
  const isAdmin = role === "ADMIN";
  const [domainId, setDomainId] = useState(user.domainId ?? "");
  // "team" (own team), "coordinators", or a coordinator's id (EB/admin).
  const [scope, setScope] = useState(role === "EB" || isAdmin ? COORDINATORS : "team");
  const [coordinators, setCoordinators] = useState([]);
  const [state, setState] = useState({ status: "loading", data: null, error: null });
  const [openTask, setOpenTask] = useState(null);
  const [openError, setOpenError] = useState(null);

  useEffect(() => {
    if (isAdmin && !domainId && domains[0]) setDomainId(domains[0].id);
  }, [isAdmin, domainId, domains]);

  // EB heads and admins can open any team in the domain.
  useEffect(() => {
    if ((role !== "EB" && !isAdmin) || !domainId) return undefined;
    const controller = new AbortController();
    api.domainCoordinators(domainId, controller.signal).then(({ coordinators }) => setCoordinators(coordinators)).catch(() => setCoordinators([]));
    return () => controller.abort();
  }, [role, isAdmin, domainId]);

  useEffect(() => {
    if (isAdmin && !domainId) return undefined;
    const params = scope === "team" ? {} : scope === COORDINATORS ? { domainId: isAdmin ? domainId : undefined, level: "DOMAIN" } : { coordinatorId: scope };
    const controller = new AbortController();
    setState({ status: "loading", data: null, error: null });
    setOpenError(null);
    api.board(params, controller.signal)
      .then((data) => {
        setState({ status: "ready", data, error: null });
        setOpenTask(data.tasks[0]?.id ?? null);
      })
      .catch((error) => error.name !== "AbortError" && setState({ status: "error", data: null, error: error.message }));
    return () => controller.abort();
  }, [isAdmin, domainId, scope]);

  const data = state.data;
  const team = data?.level === "TEAM";
  const noDomains = isAdmin && !domainId && domainsLoaded && domains.length === 0;
  const open = (s) => {
    setOpenError(null);
    openSubmission({ id: s.submissionId, linkUrl: s.linkUrl, fileUrl: s.fileUrl, fileName: s.fileName }).catch((e) => setOpenError(e.message));
  };
  const title = !data ? "Board" : team ? `${data.coordinator?.id === user.id ? "Your" : `${data.coordinator?.name}'s`} team board` : `${data.domain.name} coordinators' board`;

  // Inside the volunteer page (already a <main>) the board is a section.
  const Root = embedded ? "div" : "main";
  return (
    <Root className={embedded ? "board board--embedded" : "page page--full board"}>
      {!embedded && (
        <header className="page-head">
          <div>
            <p className="eyebrow">{team ? "Open to everyone in the team" : "Open to the domain's coordinators and EB head"}</p>
            <h1>{title}</h1>
            <p className="muted">{team ? "Finished team tasks, everyone's work and scores." : "Finished EB tasks, each coordinator's final work and the EB head's scores."} A task appears here once its deadline passes.</p>
          </div>
          <div className="row">
            {isAdmin && domains.length > 0 && (
              <label className="field field--inline">
                <span>Domain</span>
                <select id="board-domain" value={domainId} onChange={(e) => { setDomainId(e.target.value); setScope(COORDINATORS); }}>
                  {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
            )}
            {(role === "EB" || isAdmin) && (
              <label className="field field--inline">
                <span>Board</span>
                <select id="board-scope" value={scope} onChange={(e) => setScope(e.target.value)}>
                  <option value={COORDINATORS}>Coordinators (EB tasks)</option>
                  {coordinators.map((c) => <option key={c.id} value={c.id}>{c.name}'s team</option>)}
                </select>
              </label>
            )}
          </div>
        </header>
      )}
      {!embedded && role === "COORDINATOR" && (
        <div className="tabs tabs--inline" role="group" aria-label="Which board">
          <button type="button" aria-pressed={scope === "team"} className={scope === "team" ? "is-on" : ""} onClick={() => setScope("team")}>My team</button>
          <button type="button" aria-pressed={scope === COORDINATORS} className={scope === COORDINATORS ? "is-on" : ""} onClick={() => setScope(COORDINATORS)}>Coordinators</button>
        </div>
      )}
      {embedded && data?.coordinator && <p className="muted small board-scope">{data.coordinator.name}'s team · finished tasks, everyone's work and scores</p>}

      {noDomains ? (
        <Empty title="No domains yet" icon="grid">Add the club's domains first; each one gets its own boards.</Empty>
      ) : state.status === "loading" && <Loading />}
      <ErrorNote error={state.error ?? openError} />

      {data && (
        <div className="board-grid">
          <section className="board-card leaderboard" aria-labelledby="lb-title">
            <div className="ctitle"><h2 id="lb-title"><Icon name="trophy" size={18} />Leaderboard</h2></div>
            <p className="muted small">Average score on finished tasks (a missed task counts as 0), then on-time record. People with the same average and on-time count share a place.</p>
            {data.leaderboard.length === 0 && <p className="muted small">{team ? "No one in this team yet." : "No coordinators in this domain yet."}</p>}
            <ol className="lb">
              {data.leaderboard.map((row) => (
                <li key={row.volunteerId} className={row.volunteerId === user.id ? "is-me" : undefined}>
                  <span className={`lb-rank${row.rank && row.rank <= 3 ? ` lb-rank--${row.rank}` : ""}`} aria-label={row.rank ? `Place ${row.rank}` : "Not ranked yet"}>{row.rank ?? "–"}</span>
                  <span className="lb-name">
                    <b>{row.name}{row.volunteerId === user.id ? " (you)" : ""}</b>
                    <small>{row.onTime} on time · {row.late} late · {row.missed} missed{row.rank == null ? " · no scores yet" : ""}</small>
                  </span>
                  <span className="lb-score">{row.averageScore ?? "—"}</span>
                </li>
              ))}
            </ol>
          </section>

          <section className="board-main" aria-label="Finished tasks">
            {data.upcoming.length > 0 && (
              <p className="note note--info small">
                <Icon name="eye" size={16} />
                <span>Still open, revealed after the deadline: {data.upcoming.map((t) => `${t.title} (${relative(t.deadline)})`).join(" · ")}</span>
              </p>
            )}
            {data.tasks.length === 0 && <Empty title="No finished tasks yet" icon="trophy">Once a task's deadline passes, everyone's work and scores appear here.</Empty>}
            {data.tasks.map((task) => (
              <article key={task.id} className="board-card">
                <button type="button" className="board-task" onClick={() => setOpenTask(openTask === task.id ? null : task.id)} aria-expanded={openTask === task.id}>
                  <span className="tile tint--leaf" aria-hidden="true"><Icon name="award" size={17} /></span>
                  <span className="board-task-text"><b>{task.title}</b><small className="muted">Ended {fmtDate(task.deadline)} · {task.submissions.length} submitted · {task.missed} missed</small></span>
                  <span className={`chev${openTask === task.id ? " is-open" : ""}`} aria-hidden="true"><Icon name="chev-down" size={18} /></span>
                </button>
                {openTask === task.id && (
                  <div className="entries">
                    {task.workHidden && <p className="note note--info small"><Icon name="lock" size={16} /><span>You picked this task but haven't submitted yet. Everyone's work appears here once you submit yours, or when {team ? (data.coordinator ? firstName(data.coordinator.name) : "the coordinator") : "the EB head"} closes the task.</span></p>}
                    {!task.workHidden && task.submissions.length === 0 && <p className="muted small">Nobody submitted this one.</p>}
                    {task.submissions.map((s) => (
                      <div key={s.submissionId} className={`entry${s.volunteerId === user.id ? " is-me" : ""}`}>
                        <Avatar name={s.volunteerName} size="sm" />
                        <div className="entry-body">
                          <div className="entry-top">
                            <b>{s.volunteerName}</b>
                            {s.isLate && <span className="tag tag--o-LATE">Late</span>}
                            <span className={`entry-score${s.score == null ? " is-none" : ""}`}>{s.score ?? "Not scored"}{s.score != null && <small>/100</small>}</span>
                          </div>
                          {s.feedback && <FeedbackNote feedback={s.feedback} compact />}
                          <div className="entry-meta">
                            <small className="muted">Sent {fmtDateTime(s.submittedAt)}</small>
                            <button type="button" className="link-btn small tap" onClick={() => open(s)}>
                              {s.kind === "LINK" ? "Open their link" : `Open ${s.fileName ?? "file"}`} <Icon name="arrow-ur" size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </section>
        </div>
      )}
    </Root>
  );
}
