import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { Empty, ErrorNote, FeedbackNote, Loading, OutcomeTag, Progress, useToast } from "../components/ui.jsx";
import Icon from "../components/Icon.jsx";
import Notifications from "../components/Notifications.jsx";
import { Pulse, teamPulse, Welcome } from "../components/Hero.jsx";
import { Countdown, SentRow, SubmitForm } from "../components/Work.jsx";
import { firstName, fmtDate, fmtDateTime, greeting, isPast, relative, today } from "../format.js";
import { TaskForm } from "./Tasks.jsx";

/*
 * A coordinator's home: the EB head's tasks for their domain. For each one
 * they decide to do it themselves or forward it to their team, follow the
 * team's progress, and send the final work to the EB head for a score.
 */
export default function CoordinatorHome({ user, context, counts, onNavigate }) {
  const [state, setState] = useState({ status: "loading", tasks: [], error: null });
  const [team, setTeam] = useState({ status: "loading", rows: [] });
  const [forwarding, setForwarding] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [toast, showToast] = useToast();

  const head = context?.head?.name ?? null;
  const headFirst = head ? firstName(head) : "your EB head";
  const domain = context?.domain?.name ?? "";
  const to = head ? `${head} (EB, ${domain})` : "your EB head";

  const load = useCallback((signal) => {
    api.tasks(signal, "DOMAIN")
      .then(({ tasks }) => setState({ status: "ready", tasks, error: null }))
      .catch((error) => error.name !== "AbortError" && setState({ status: "error", tasks: [], error: error.message }));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    api.peopleReport({}, controller.signal)
      .then(({ people }) => setTeam({ status: "ready", rows: people }))
      .catch((error) => error.name !== "AbortError" && setTeam({ status: "error", rows: [] }));
    return () => controller.abort();
  }, [load]);

  const refresh = (message) => {
    if (message) showToast(message);
    load();
  };

  // Needs you now: open EB tasks, and anything picked that isn't scored yet.
  const { now, earlier } = useMemo(() => {
    const live = (t) => {
      const mine = t.mine ?? {};
      // Scored work stays up front (with the EB head's feedback) until the EB task is closed.
      if (mine.evaluation) return t.status !== "CLOSED";
      if (mine.picked) return t.status !== "CLOSED" || Boolean(mine.submission);
      return t.status === "AVAILABLE" && !isPast(t.deadline);
    };
    const nowList = state.tasks.filter(live).sort((a, b) => Date.parse(a.deadline) - Date.parse(b.deadline));
    const earlierList = state.tasks.filter((t) => !live(t) && t.mine?.picked);
    return { now: nowList, earlier: earlierList };
  }, [state.tasks]);

  const needAction = now.filter((t) => !t.mine?.submission && t.status === "AVAILABLE").length;
  const pulse = useMemo(() => teamPulse(team.rows), [team.rows]);

  async function doItMyself(task) {
    if (busyId) return;
    setBusyId(task.id);
    try {
      await api.chooseTask(task.id);
      refresh(`"${task.title}" is yours. Send the final work to ${headFirst} by ${fmtDate(task.deadline)}.`);
    } catch (error) {
      showToast(error.message);
    }
    setBusyId(null);
  }

  const tagline = state.status !== "ready"
    ? "Let's see what the EB needs."
    : needAction > 0
      ? `${needAction} EB ${needAction === 1 ? "task needs" : "tasks need"} you.`
      : "You're on top of the EB's tasks.";

  return (
    <main className="page page--full">
      <Notifications only="setup" />
      <div className="hero">
        <Welcome
          kicker={`${today()} · ${domain} · your team`}
          title={<>{greeting()}, {firstName(user.name)}.<br />{tagline}</>}
          text={`${counts.pending > 0 ? `${counts.pending} ${counts.pending === 1 ? "piece" : "pieces"} of team work ${counts.pending === 1 ? "is" : "are"} waiting for your score. ` : "No team work is waiting for your score. "}Forward EB tasks to your team, score their work, then send the final work to ${headFirst}.`}
        >
          <button type="button" className="btn btn--sun" onClick={() => onNavigate("review")}>
            <Icon name="inbox" size={17} />Score team work{counts.pending > 0 && <em className="btn-count">{counts.pending}</em>}
          </button>
          <button type="button" className="btn btn--glass" onClick={() => onNavigate("team", "propose")}>
            <Icon name="bulb" size={17} />Propose a task
          </button>
        </Welcome>
        <Pulse title="Your team" meta={`${team.rows.length} ${team.rows.length === 1 ? "volunteer" : "volunteers"}`} pulse={pulse} ready={team.status === "ready"} />
      </div>

      <Notifications only="switch" about="Get a nudge before an EB task is due, when your final work is scored, and when the EB head decides on your proposals." />

      <section className="stack" aria-labelledby="eb-tasks">
        <div className="section-head">
          <h2 id="eb-tasks" className="page-title">EB tasks from {head ?? "your EB head"}</h2>
          <p className="muted">Each one is yours to deliver. Do it yourself, or forward it to your team and send {headFirst} the final work.</p>
        </div>
        {state.status === "loading" && <Loading />}
        <ErrorNote error={state.error} />
        {state.status === "ready" && now.length === 0 && (
          <Empty title="Nothing from the EB right now" icon="layers">When {headFirst} publishes a task for {domain || "your domain"}, it appears here.</Empty>
        )}
        <div className="card-grid">
          {now.map((task) => (
            <EbTaskCard
              key={task.id}
              task={task}
              to={to}
              headFirst={headFirst}
              busy={busyId === task.id}
              onForward={() => setForwarding(task)}
              onMine={() => doItMyself(task)}
              onReview={() => onNavigate("review")}
              onChanged={refresh}
              onError={showToast}
            />
          ))}
        </div>
      </section>

      {earlier.length > 0 && (
        <section className="stack" aria-labelledby="eb-earlier">
          <h2 id="eb-earlier" className="section-title">Earlier EB tasks</h2>
          <div className="surface list-card">
            {earlier.map((task) => (
              <div key={task.id} className="history-row">
                <span>
                  <b>{task.title}</b>
                  <small>Due {fmtDate(task.deadline)}{task.mine?.teamTask ? ` · forwarded to your team (${task.mine.teamTask.counts.submitted} sent)` : " · done yourself"}</small>
                  {task.mine?.evaluation?.feedback && <small className="quote">“{task.mine.evaluation.feedback}” · {headFirst}</small>}
                </span>
                <span className="history-meta">
                  {task.mine?.evaluation && <span className="score-chip">{task.mine.evaluation.score}</span>}
                  <OutcomeTag outcome={task.mine?.outcome ?? "MISSED"} />
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {forwarding && (
        <TaskForm
          draftKey={`forward.${forwarding.id}`}
          panelTitle="Forward to my team"
          initial={{
            title: forwarding.title,
            description: forwarding.description,
            deadline: new Date(Math.max(Date.now() + 3600000, Date.parse(forwarding.deadline) - 24 * 3600000)).toISOString()
          }}
          maxDeadline={forwarding.deadline}
          hint={`Your volunteers can pick it as soon as you forward it. Give them a deadline before ${headFirst}'s, so you have time to put the final work together. Score their work in Review.`}
          actions={[{ label: "Forward to my team" }]}
          onSave={async (body) => {
            await api.forwardTask(forwarding.id, body);
            return `Forwarded "${body.title}" to your team`;
          }}
          onClose={() => setForwarding(null)}
          onSaved={(message) => { setForwarding(null); refresh(message); }}
        >
          <p className="note note--info small"><Icon name="forward" size={16} /><span>From {head ?? "the EB"}: <b>{forwarding.title}</b>, due {fmtDateTime(forwarding.deadline)}. Edit the brief for your team if you like.</span></p>
        </TaskForm>
      )}
      {toast}
    </main>
  );
}

function EbTaskCard({ task, to, headFirst, busy, onForward, onMine, onReview, onChanged, onError }) {
  const mine = task.mine ?? { picked: false };
  const late = isPast(task.deadline);
  const open = task.status === "AVAILABLE";
  const canSubmit = mine.picked && open && !mine.evaluation && !(mine.submission && late);
  const team = mine.teamTask;
  const tile = mine.submission ? ["send", "sky"] : team ? ["forward", "lilac"] : mine.picked ? ["user", "sun"] : ["target", "sky"];

  return (
    <article className="card">
      <div className="card-top">
        <span className={`tile tint--${tile[1]}`} aria-hidden="true"><Icon name={tile[0]} size={18} /></span>
        <div className="card-title">
          <h3>{task.title}</h3>
          <p className="small muted">EB deadline {fmtDateTime(task.deadline)} · {relative(task.deadline)}</p>
        </div>
        {mine.picked && <OutcomeTag outcome={mine.outcome ?? "IN_PROGRESS"} />}
      </div>
      {!late && !mine.submission && <Countdown deadline={task.deadline} />}
      <p className="brief small">{task.description}</p>

      {!mine.picked && (
        <>
          <p className="small muted">Forward it and your volunteers can pick it; either way you send the final work to {headFirst}.</p>
          <div className="row">
            <button type="button" className="btn" onClick={onForward}><Icon name="forward" size={16} />Forward to my team</button>
            <button type="button" className="btn btn--ghost" disabled={busy} onClick={onMine}>{busy ? "Picking…" : "Do it myself"}</button>
          </div>
        </>
      )}

      {mine.picked && team && (
        <div className="team-box">
          <div className="team-box-top">
            <span className="small"><b>Your team's version</b> · team deadline {fmtDate(team.deadline)}</span>
            {team.counts.submitted > team.counts.scored
              ? <button type="button" className="link-btn tap small" onClick={onReview}>Score team work <Icon name="arrow-r" size={14} /></button>
              : <span className="small muted">{team.counts.picked === 0 ? "Nobody has picked it yet" : team.counts.submitted === 0 ? "Nothing sent yet" : "All scored"}</span>}
          </div>
          <Progress counts={team.counts} />
        </div>
      )}
      {mine.picked && !team && !mine.submission && (
        <div className="row row--between">
          <span className="small muted">You're doing this one yourself.</span>
          {open && !late && <button type="button" className="btn btn--ghost btn--small" onClick={onForward}><Icon name="forward" size={15} />Forward to my team</button>}
        </div>
      )}

      {mine.submission && <SentRow submission={mine.submission} onError={onError} label={mine.submission.isLate ? `Final work sent late to ${headFirst}` : `Final work sent to ${headFirst}`} />}
      {mine.evaluation && (
        <>
          <p className="score-line"><b className="score-chip">{mine.evaluation.score}</b><span className="small muted">/ 100 from {headFirst}</span></p>
          <FeedbackNote feedback={mine.evaluation.feedback} by={headFirst} />
        </>
      )}
      {mine.submission && !mine.evaluation && <p className="muted small">Waiting for {headFirst} to score it.</p>}

      {canSubmit && (
        <SubmitForm
          key={mine.submission?.id ?? "new"}
          taskId={task.id}
          replacing={Boolean(mine.submission)}
          late={late}
          finalWork
          to={to}
          startOpen={false}
          onDone={(message) => onChanged(message)}
        />
      )}
      {mine.picked && !open && !mine.submission && <p className="note note--warn small">This EB task is closed, so it no longer takes final work.</p>}
    </article>
  );
}
