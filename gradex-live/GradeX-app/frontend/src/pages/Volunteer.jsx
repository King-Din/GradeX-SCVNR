import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { Empty, ErrorNote, FeedbackNote, Loading, OutcomeTag, Panel, RecordFlow, useToast } from "../components/ui.jsx";
import Icon from "../components/Icon.jsx";
import { Countdown, SentRow, SubmitForm } from "../components/Work.jsx";
import Logo, { HeroArt } from "../components/Logo.jsx";
import Notifications from "../components/Notifications.jsx";
import Board from "./Board.jsx";
import { SetPassword } from "./FirstLogin.jsx";
import { firstName as first, fmtDateTime, fmtWeekday, initials, isPast, keyFromHash, relative } from "../format.js";

const TABS = [["mine", "My tasks"], ["open", "Open tasks"], ["board", "Board"], ["scores", "My scores"]];
const TAB_KEYS = TABS.map(([key]) => key);
const TAB_ICON = { mine: "tasks", open: "layers", board: "trophy", scores: "award" };

/*
 * A volunteer's home. They belong to one coordinator's team: they pick the
 * tasks their coordinator forwards, send work back to them, and see their
 * team's finished work on the board.
 */
export default function Volunteer({ user, context, onSignOut }) {
  const [tab, setTabState] = useState(() => keyFromHash(TAB_KEYS));
  const [mine, setMine] = useState({ status: "loading", items: [], error: null });
  const [toast, showToast] = useToast();
  const [changingPassword, setChangingPassword] = useState(false);
  const domainName = context?.domain?.name ?? "";
  const coordinator = context?.coordinator?.name ?? "";

  // Tabs live in the address bar, so the back button moves between them.
  useEffect(() => {
    const onHash = () => setTabState(keyFromHash(TAB_KEYS));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const setTab = (key) => {
    if (window.location.hash !== `#${key}`) window.location.hash = key;
    setTabState(key);
  };

  const loadMine = useCallback((signal) => {
    api.myTasks(signal)
      .then(({ participations }) => setMine({ status: "ready", items: participations, error: null }))
      .catch((error) => error.name !== "AbortError" && setMine({ status: "error", items: [], error: error.message }));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadMine(controller.signal);
    return () => controller.abort();
  }, [loadMine]);

  const history = mine.items.map((p) => ({
    participationId: p.id,
    title: p.task?.title ?? "Task",
    deadline: p.task?.deadline,
    outcome: p.outcome ?? "IN_PROGRESS",
    score: p.evaluation?.score ?? null
  }));
  const finished = history.filter((h) => h.outcome !== "IN_PROGRESS");
  const onTime = finished.filter((h) => h.outcome === "ON_TIME").length;
  const count = (o) => history.filter((h) => h.outcome === o).length;
  // Same rule as the board's leaderboard: a missed task counts as 0.
  const scores = history.map((h) => (h.outcome === "MISSED" ? 0 : h.score)).filter((n) => typeof n === "number");
  const average = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const firstName = first(user.name);
  const rate = finished.length ? onTime / finished.length : null;

  return (
    <div className="vol">
      <header className="vol-head">
        <div className="vol-top">
          <Logo onBlue />
          <span className="vol-actions">
            <button type="button" className="circ circ--glass" onClick={() => setChangingPassword(true)} aria-label="Change your password" title="Change your password"><Icon name="key" /></button>
            <button type="button" className="circ circ--glass" onClick={onSignOut} aria-label="Sign out" title="Sign out"><Icon name="logout" /></button>
          </span>
        </div>
        <div className="vol-greet">
          <div>
            <p className="vol-hello">{[domainName, coordinator ? `${coordinator}'s team` : "Street Cause VNRVJIET"].filter(Boolean).join(" · ")}</p>
            <h1>Namaste, {firstName}</h1>
            <p className="vol-sub">{finished.length === 0 ? "Thank you for showing up. Your first task is a tap away." : rate >= 0.75 ? "You keep showing up, and it shows. Thank you." : "Every task you finish on time helps the cause. You've got this."}</p>
          </div>
          <span className="vol-av" aria-hidden="true">{initials(user.name)}</span>
        </div>
        <HeroArt className="vol-art" />
      </header>

      <section className="record surface" aria-label="Your record">
        <div className="record-top">
          <b className="record-big">{finished.length === 0 ? <>0<small>/0</small></> : <>{onTime}<small>/{finished.length}</small></>}</b>
          <p className="record-cap">
            {finished.length === 0 ? "Pick your first task" : `${onTime} on time out of ${finished.length}`}
            <span>{history.length === 0 ? "Your record fills in as you finish tasks." : `${count("LATE")} late · ${count("MISSED")} missed · ${count("IN_PROGRESS")} in progress`}</span>
          </p>
        </div>
        {history.length > 0 && <RecordFlow history={history} />}
        {history.length > 0 && (
          <dl className="vol-stats">
            <div><dt>Picked</dt><dd>{history.length}</dd></div>
            <div><dt>On time</dt><dd>{count("ON_TIME")}</dd></div>
            <div><dt>Late</dt><dd>{count("LATE")}</dd></div>
            <div><dt>Missed</dt><dd>{count("MISSED")}</dd></div>
            <div title="Average of your scores; a missed task counts as 0, like on the board"><dt>Avg score (missed = 0)</dt><dd>{average ?? "—"}</dd></div>
          </dl>
        )}
        <p className="vol-who">{user.name} · {user.email}</p>
      </section>

      <div className="vol-main">
        <nav className="vol-tabs" aria-label="Sections">
          {TABS.map(([key, label]) => (
            <button key={key} type="button" className={tab === key ? "is-on" : ""} aria-current={tab === key ? "page" : undefined} onClick={() => setTab(key)}><Icon name={TAB_ICON[key]} size={16} />{label}</button>
          ))}
        </nav>

        <main className="vol-body">
          <Notifications />
          {tab === "mine" && <MyTasks state={mine} coordinator={coordinator} onChanged={(msg) => { showToast(msg); loadMine(); }} onError={showToast} onFindTasks={() => setTab("open")} />}
          {tab === "open" && <OpenTasks coordinator={coordinator} onPicked={(msg) => { showToast(msg); loadMine(); setTab("mine"); }} />}
          {tab === "scores" && <Scores coordinator={coordinator} />}
          {tab === "board" && <Board user={user} embedded />}
        </main>
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

function MyTasks({ state, coordinator, onChanged, onError, onFindTasks }) {
  if (state.status === "loading") return <Loading />;
  if (state.error) return <ErrorNote error={state.error} />;

  const now = state.items.filter((p) => p.outcome === "IN_PROGRESS" || (p.submission && !p.evaluation && p.task?.status !== "CLOSED"));
  const earlier = state.items.filter((p) => !now.includes(p));

  if (state.items.length === 0) {
    return (
      <Empty title="You haven't picked a task yet" icon="layers">
        <p>{coordinator ? `${first(coordinator)} forwards tasks to the team; pick the ones you want to do.` : "Pick the tasks you want to do."}</p>
        <button type="button" className="btn" onClick={onFindTasks}>See open tasks <Icon name="arrow-r" size={16} /></button>
      </Empty>
    );
  }

  return (
    <>
      <span className="eyebrow">Now</span>
      {now.length === 0 && <p className="muted small">Nothing due. <button type="button" className="link-btn" onClick={onFindTasks}>Pick another task</button></p>}
      {now.map((p) => <TaskCard key={p.id} p={p} coordinator={coordinator} onChanged={onChanged} onError={onError} />)}
      {earlier.length > 0 && <span className="eyebrow">Earlier</span>}
      {earlier.map((p) => <TaskCard key={p.id} p={p} coordinator={coordinator} onChanged={onChanged} onError={onError} />)}
    </>
  );
}

function TaskCard({ p, coordinator, onChanged, onError }) {
  const { task, submission, evaluation } = p;
  const late = isPast(task?.deadline);
  const canSubmit = task?.status === "AVAILABLE" && !evaluation && !(submission && late);

  return (
    <article className="card">
      <div className="card-top">
        <span className={`tile tint--${evaluation ? "leaf" : submission ? "sky" : late ? "rose" : "sun"}`} aria-hidden="true">
          {evaluation ? <b>{evaluation.score}</b> : <Icon name={submission ? "send" : late ? "alert" : "target"} size={18} />}
        </span>
        <div className="card-title">
          <h3>{task?.title}</h3>
          <p className="small muted">{evaluation ? `Scored ${evaluation.score} / 100` : `Due ${fmtWeekday(task?.deadline)} · ${relative(task?.deadline)}`}</p>
        </div>
        <OutcomeTag outcome={p.outcome ?? "IN_PROGRESS"} />
      </div>
      {!late && !submission && task?.deadline && <Countdown deadline={task.deadline} />}
      {task?.description && !evaluation && <p className="brief small">{task.description}</p>}

      {submission && <SentRow submission={submission} onError={onError} />}

      {evaluation && <FeedbackNote feedback={evaluation.feedback} by={p.evaluator?.name} />}

      {canSubmit && <SubmitForm taskId={task.id} replacing={Boolean(submission)} late={late} onDone={onChanged} to={!submission && coordinator ? `${coordinator} (your coordinator)` : null} />}
      {submission && !evaluation && task?.status !== "CLOSED" && (
        <p className="muted small">Waiting for {coordinator ? first(coordinator) : "your coordinator"} to score it.</p>
      )}
    </article>
  );
}

function OpenTasks({ coordinator, onPicked }) {
  const [state, setState] = useState({ status: "loading", tasks: [], error: null });
  const [error, setError] = useState(null);
  const [picking, setPicking] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    api.availableTasks(controller.signal)
      .then(({ tasks }) => setState({ status: "ready", tasks, error: null }))
      .catch((err) => err.name !== "AbortError" && setState({ status: "error", tasks: [], error: err.message }));
    return () => controller.abort();
  }, []);

  async function pick(task) {
    if (picking) return;
    setError(null);
    setPicking(task.id);
    try {
      await api.chooseTask(task.id);
      onPicked(`You picked "${task.title}"`);
    } catch (err) {
      setError(err.message);
      setPicking(null);
    }
  }

  if (state.status === "loading") return <Loading />;
  if (state.error) return <ErrorNote error={state.error} />;
  if (state.tasks.length === 0) return <Empty title="No open tasks right now" icon="layers">{coordinator ? `${first(coordinator)} will forward new ones to the team soon.` : "Your coordinator will forward new ones soon."}</Empty>;

  return (
    <>
      <ErrorNote error={error} />
      {state.tasks.map((task) => (
        <article key={task.id} className="card">
          <div className="card-top">
            <span className="tile tint--sky" aria-hidden="true"><Icon name="target" size={18} /></span>
            <div className="card-title"><h3>{task.title}</h3><p className="small muted">From {task.owner?.name ?? "your coordinator"} · {relative(task.deadline)}</p></div>
          </div>
          {!isPast(task.deadline) && <Countdown deadline={task.deadline} />}
          <p className="brief small">{task.description}</p>
          <p className="muted small">Due {fmtDateTime(task.deadline)}{task.counts ? ` · ${task.counts.picked} picked so far` : ""}</p>
          {task.pickedByMe ? (
            <span className="tag tag--o-ON_TIME"><Icon name="check" size={13} />You picked this</span>
          ) : (
            <button type="button" className="btn btn--block btn--lg" disabled={Boolean(picking)} onClick={() => pick(task)}>
              {picking === task.id ? "Picking…" : <><Icon name="plus" size={17} />Pick this task</>}
            </button>
          )}
        </article>
      ))}
    </>
  );
}

function Scores({ coordinator }) {
  const [state, setState] = useState({ status: "loading", items: [], error: null });

  useEffect(() => {
    const controller = new AbortController();
    api.myEvaluations(controller.signal)
      .then(({ evaluations }) => {
        const items = [...evaluations].sort((a, b) => Date.parse(b.updatedAt ?? b.evaluatedAt) - Date.parse(a.updatedAt ?? a.evaluatedAt));
        setState({ status: "ready", items, error: null });
      })
      .catch((err) => err.name !== "AbortError" && setState({ status: "error", items: [], error: err.message }));
    return () => controller.abort();
  }, []);

  if (state.status === "loading") return <Loading />;
  if (state.error) return <ErrorNote error={state.error} />;
  if (state.items.length === 0) return <Empty title="No scores yet" icon="award">Scores and feedback appear here once {coordinator ? first(coordinator) : "your coordinator"} marks your work.</Empty>;

  const average = Math.round(state.items.reduce((sum, e) => sum + e.score, 0) / state.items.length);

  return (
    <>
      <p className="muted small scores-sum"><Icon name="trend" size={15} />Average <b>{average}</b> across {state.items.length} scored {state.items.length === 1 ? "task" : "tasks"}, newest first</p>
      {state.items.map((e) => (
        <article key={e.id} className="card">
          <div className="card-top">
            <span className="tile tint--leaf" aria-hidden="true"><b>{e.score}</b></span>
            <div className="card-title">
              <h3>{e.submission.task?.title}</h3>
              <p className="small muted">Scored {e.score} / 100 · {fmtDateTime(e.updatedAt ?? e.evaluatedAt)}{e.submission.isLate ? " · sent late" : ""}</p>
            </div>
          </div>
          <FeedbackNote feedback={e.feedback} by={e.submission.evaluator?.name ?? coordinator ?? "your coordinator"} />
        </article>
      ))}
    </>
  );
}
