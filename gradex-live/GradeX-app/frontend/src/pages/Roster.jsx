import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, downloadExport } from "../api.js";
import { Avatar, Dots, Empty, ErrorNote, Legend, Loading, OutcomeTag, StandingTag, useToast } from "../components/ui.jsx";
import Icon from "../components/Icon.jsx";
import { useDraft } from "../drafts.js";
import { firstName, fmtDate, fmtDateTime, pct, relative, STANDING_LABEL } from "../format.js";

const DECISIONS = [
  { key: "KEEP", label: "Keep" },
  { key: "WARN", label: "Warn" },
  { key: "REMOVE", label: "Remove" }
];
const DECISION_LABEL = Object.fromEntries(DECISIONS.map((d) => [d.key, d.label]));

const FILTERS = ["ALL", "RELIABLE", "SLIPPING", "INACTIVE", "NEW", "DEACTIVATED"];
const ORDER = { SLIPPING: 0, INACTIVE: 1, NEW: 2, RELIABLE: 3, DEACTIVATED: 4 };

const MIX = [
  { key: "RELIABLE", color: "leaf" },
  { key: "NEW", color: "lilac" },
  { key: "SLIPPING", color: "sun" },
  { key: "INACTIVE", color: "rose" },
  { key: "DEACTIVATED", color: "gray" }
];

const personOf = (row) => row.person ?? row.volunteer;

// Has this person set GradeX up: own password, on their Home Screen, notifications on?
const SETUP_MARKS = [
  { key: "signedIn", icon: "key", yes: "Signed in", no: "Hasn't signed in yet", todo: "sign in" },
  { key: "app", icon: "phone", yes: "On their Home Screen", no: "Not on their Home Screen yet", todo: "add GradeX to their Home Screen" },
  { key: "notifications", icon: "bell", yes: "Notifications on", no: "Notifications off", todo: "turn on notifications" }
];
const setUp = (row) => !row.setup || SETUP_MARKS.every((m) => row.setup[m.key]);

function SetupMarks({ setup }) {
  if (!setup) return null;
  const label = SETUP_MARKS.map((m) => (setup[m.key] ? m.yes : m.no)).join(", ");
  return (
    <span className="setup-marks" role="img" aria-label={label} title={label}>
      {SETUP_MARKS.map((m) => (
        <span key={m.key} className={`setup-mark${setup[m.key] ? " is-on" : ""}`}><Icon name={m.icon} size={14} /></span>
      ))}
    </span>
  );
}

/*
 * Standings: who's showing up. Coordinators see their own volunteers; EB
 * heads the coordinators and volunteers of their domain; admins everyone.
 * Keep / Warn / Remove decisions and deactivation live here (staff only).
 */
export default function Roster({ user, domains }) {
  const isAdmin = user.role === "ADMIN";
  const isCoordinator = user.role === "COORDINATOR";
  const [domainId, setDomainId] = useState("");
  const [roleFilter, setRoleFilter] = useState(isCoordinator ? "VOLUNTEER" : "ALL");
  const [state, setState] = useState({ status: "loading", rows: [], error: null });
  const [filter, setFilter] = useState("ALL");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [toast, showToast] = useToast();
  const detailRef = useRef(null);
  const requestRef = useRef(null);

  // Only the newest request may update the table (switching domains quickly
  // must never show the previous domain's people).
  const load = useCallback(() => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    api.peopleReport(isAdmin && domainId ? { domainId } : {}, controller.signal)
      .then(({ people }) => {
        if (controller.signal.aborted) return;
        const rows = [...people].sort((a, b) =>
          (a.role === b.role ? 0 : a.role === "COORDINATOR" ? -1 : 1) || ORDER[a.standing] - ORDER[b.standing] || personOf(a).name.localeCompare(personOf(b).name)
        );
        setState({ status: "ready", rows, error: null });
      })
      .catch((error) => {
        if (error.name === "AbortError" || controller.signal.aborted) return;
        setState({ status: "error", rows: [], error: error.message });
      });
  }, [isAdmin, domainId]);

  useEffect(() => {
    load();
    return () => requestRef.current?.abort();
  }, [load]);

  const inRole = useMemo(() => state.rows.filter((r) => roleFilter === "ALL" || r.role === roleFilter), [state.rows, roleFilter]);
  const counts = useMemo(() => {
    const c = { ALL: inRole.length };
    for (const row of inRole) c[row.standing] = (c[row.standing] ?? 0) + 1;
    const active = inRole.filter((row) => row.standing !== "DEACTIVATED" && row.setup);
    c.SETUP = active.filter((row) => !setUp(row)).length;
    c.setup = Object.fromEntries(SETUP_MARKS.map((m) => [m.key, active.filter((row) => row.setup[m.key]).length]));
    c.active = active.length;
    return c;
  }, [inRole]);

  const q = query.trim().toLowerCase();
  const visible = inRole.filter((row) =>
    (filter === "ALL" || (filter === "SETUP" ? row.standing !== "DEACTIVATED" && !setUp(row) : row.standing === filter)) &&
    (!q || personOf(row).name.toLowerCase().includes(q) || personOf(row).email.toLowerCase().includes(q))
  );

  useEffect(() => {
    setSelectedId((current) => (current && visible.some((r) => personOf(r).id === current) ? current : visible[0] ? personOf(visible[0]).id : null));
  }, [state.rows, roleFilter, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = state.rows.find((row) => personOf(row).id === selectedId) ?? null;
  const domainName = (id) => domains.find((d) => d.id === id)?.name ?? id ?? "No domain yet";
  const scopeLabel = isAdmin ? (domainId ? domainName(domainId) : "All domains") : isCoordinator ? `${firstName(user.name)}'s team` : domainName(user.domainId);
  const attention = (counts.SLIPPING ?? 0) + (counts.INACTIVE ?? 0);
  const coordinatorsByDomain = (id) => state.rows.filter((r) => r.role === "COORDINATOR" && personOf(r).domainId === id && r.standing !== "DEACTIVATED").map(personOf);
  const noun = roleFilter === "COORDINATOR" ? "coordinators" : roleFilter === "VOLUNTEER" ? "volunteers" : "people";

  function select(id) {
    setSelectedId(id);
    // Below 1100px the detail sits under the table: bring it into view.
    if (window.matchMedia?.("(max-width: 1100px)").matches) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }));
    }
  }

  async function exportExcel() {
    setExporting(true);
    try {
      await downloadExport();
    } catch (error) {
      showToast(error.message);
    }
    setExporting(false);
  }

  async function saveDecision(row, decision, note) {
    try {
      await api.setDecision(personOf(row).id, decision, note);
      showToast(decision ? `Marked ${personOf(row).name}: ${DECISION_LABEL[decision]}` : `Cleared the decision for ${personOf(row).name}`);
      load();
      return true;
    } catch (error) {
      showToast(error.message);
      return false;
    }
  }

  async function update(row, patch, message) {
    try {
      await api.updateUser(personOf(row).id, patch);
      showToast(message);
      load();
      return true;
    } catch (error) {
      showToast(error.message);
      return false;
    }
  }

  const subline = (row) => {
    const person = personOf(row);
    if (row.role === "COORDINATOR") return `Coordinator · ${row.teamSize ?? 0} ${row.teamSize === 1 ? "volunteer" : "volunteers"}${isAdmin && !domainId ? ` · ${domainName(person.domainId)}` : ""}`;
    if (isCoordinator) return person.email;
    return [row.coordinator ? `${row.coordinator.name}'s team` : "No coordinator yet", isAdmin && !domainId ? domainName(person.domainId) : null].filter(Boolean).join(" · ");
  };

  return (
    <main className="page page--full roster-page">
      <div className="roster">
        <section className="roster-main surface" aria-labelledby="people-title">
          <header className="page-head">
            <div>
              <p className="eyebrow">Street Cause VNRVJIET · {scopeLabel}</p>
              <h1 id="people-title" className="page-title">{isCoordinator ? "My team" : "Who's showing up"}</h1>
              {state.status === "ready" && (
                <p className="muted">
                  {counts.ALL === 0
                    ? `No ${noun} here yet.`
                    : attention === 0
                      ? `All ${counts.ALL} ${noun} are keeping up.`
                      : `${attention} of ${counts.ALL} ${noun} need a nudge: ${counts.SLIPPING ?? 0} slipping, ${counts.INACTIVE ?? 0} inactive.`}
                </p>
              )}
            </div>
            <div className="row">
              <button type="button" className="btn btn--ghost" disabled={exporting} onClick={exportExcel}><Icon name="download" size={17} />{exporting ? "Preparing…" : "Download Excel"}</button>
              {isAdmin && (
                <label className="field field--inline">
                  <span>Domain</span>
                  <select id="roster-domain" value={domainId} onChange={(e) => { setDomainId(e.target.value); setFilter("ALL"); setState((s) => ({ ...s, status: "loading" })); }}>
                    <option value="">All domains</option>
                    {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </label>
              )}
            </div>
          </header>

          {!isCoordinator && (
            <div className="tabs tabs--inline" role="group" aria-label="Whose standings">
              {[["ALL", "Everyone"], ["COORDINATOR", "Coordinators"], ["VOLUNTEER", "Volunteers"]].map(([key, label]) => (
                <button key={key} type="button" aria-pressed={roleFilter === key} className={roleFilter === key ? "is-on" : ""} onClick={() => { setRoleFilter(key); setFilter("ALL"); }}>{label}</button>
              ))}
            </div>
          )}

          <div className="toolbar">
            <div className="chips" role="group" aria-label="Filter by standing">
              {FILTERS.filter((f) => f === "ALL" || counts[f]).map((f) => (
                <button key={f} type="button" aria-pressed={filter === f} className={`chip${filter === f ? " is-on" : ""}`} onClick={() => setFilter(f)}>
                  {f === "ALL" ? "All" : STANDING_LABEL[f]}<em>{counts[f] ?? 0}</em>
                </button>
              ))}
              {(counts.SETUP > 0 || filter === "SETUP") && (
                <button type="button" aria-pressed={filter === "SETUP"} className={`chip${filter === "SETUP" ? " is-on" : ""}`} onClick={() => setFilter("SETUP")}>
                  Not set up<em>{counts.SETUP}</em>
                </button>
              )}
            </div>
            <input id="roster-search" className="search search--icon" type="search" aria-label="Search by name or email" placeholder="Search by name or email" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <Legend />
          {state.status === "ready" && counts.active > 0 && (
            <p className="setup-summary small muted">
              Set up, of {counts.active}: signed in <b>{counts.setup.signedIn}</b> · on Home Screen <b>{counts.setup.app}</b> · notifications on <b>{counts.setup.notifications}</b>
            </p>
          )}

          {state.status === "loading" && <Loading />}
          <ErrorNote error={state.error} />

          {state.status === "ready" && visible.length === 0 && (
            <Empty title={inRole.length ? "No one matches" : `No ${noun} yet`}>
              {inRole.length ? "Try another filter or clear the search." : isCoordinator ? "Volunteers join your team by choosing you at their first sign-in, or an admin adds them." : "People appear here once an admin adds them."}
            </Empty>
          )}

          {state.status === "ready" && visible.length > 0 && (
            <div className="table-wrap">
              <table className="table table--cards roster-table">
                <thead>
                  <tr><th>Person</th><th>Last 8 tasks</th><th className="num">On time</th><th className="num">Avg (missed = 0)</th><th>Set up</th><th>Standing</th><th>Decision</th></tr>
                </thead>
                <tbody>
                  {visible.map((row) => {
                    const person = personOf(row);
                    return (
                      <tr key={person.id} className={`is-clickable${person.id === selectedId ? " is-selected" : ""}`} onClick={() => select(person.id)}>
                        <td data-label="Person">
                          <button type="button" className="person" aria-pressed={person.id === selectedId} onClick={(e) => { e.stopPropagation(); select(person.id); }}>
                            <Avatar name={person.name} />
                            <span><b>{person.name}</b><small>{subline(row)}</small></span>
                          </button>
                        </td>
                        <td data-label="Last 8 tasks"><Dots history={[...(row.current ?? []), ...row.history]} /></td>
                        <td data-label="On time" className={`num mono ${rateClass(row.onTimeRate)}`}>{pct(row.onTimeRate)}</td>
                        <td data-label="Avg score" className="num mono">{row.averageScore ?? "—"}</td>
                        <td data-label="Set up"><SetupMarks setup={row.setup} /></td>
                        <td data-label="Standing"><StandingTag standing={row.standing} /></td>
                        <td data-label="Decision">{person.decision ? <span className={`dec dec--${person.decision}`}>{DECISION_LABEL[person.decision]}</span> : <span className="dec dec--none">Not set</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {state.status === "ready" && counts.ALL > 0 && (
            <div className="mix">
              <div className="mix-bar" aria-hidden="true">
                {MIX.filter((m) => counts[m.key]).map((m) => <i key={m.key} className={`bg--${m.color}`} style={{ flex: counts[m.key] }} />)}
              </div>
              <p className="mix-legend">
                {MIX.filter((m) => counts[m.key]).map((m) => (
                  <span key={m.key}><i className={`key key--${m.color}`} aria-hidden="true" /><b>{counts[m.key]}</b> {STANDING_LABEL[m.key].toLowerCase()}</span>
                ))}
              </p>
            </div>
          )}
        </section>

        <aside className="detail surface" ref={detailRef} aria-label="Selected person">
          {selected ? (
            <PersonDetail
              key={personOf(selected).id}
              row={selected}
              viewer={user}
              domainName={domainName}
              coordinators={coordinatorsByDomain(personOf(selected).domainId)}
              onUpdate={update}
              onDecision={saveDecision}
            />
          ) : (
            <div className="detail-inner"><Empty title="Pick someone" icon="user">Their record and recent tasks show up here.</Empty></div>
          )}
        </aside>
      </div>
      {toast}
    </main>
  );
}

function rateClass(rate) {
  if (rate == null) return "";
  if (rate >= 0.75) return "good";
  if (rate < 0.5) return "bad";
  return "";
}

function PersonDetail({ row, viewer, domainName, coordinators, onUpdate, onDecision }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const person = personOf(row);
  const { totals } = row;
  const deactivated = person.status === "DEACTIVATED";
  const saved = { decision: person.decision ?? null, note: person.decisionNote ?? "" };
  const [draft, setDraft, clearDraft] = useDraft(`decision.${person.id}`, saved);
  const { decision, note } = draft;
  const [moveTo, setMoveTo] = useState(person.coordinatorId ?? "");
  const canMove = row.role === "VOLUNTEER" && viewer.role !== "COORDINATOR";
  const isCoordinatorRow = row.role === "COORDINATOR";

  // When the saved decision changes (after a save, or someone else's), start from it.
  const savedKey = `${saved.decision}|${saved.note}`;
  const lastSaved = useRef(savedKey);
  useEffect(() => {
    if (lastSaved.current !== savedKey) {
      lastSaved.current = savedKey;
      setDraft(saved);
    }
  });

  const changed = decision !== saved.decision || note !== saved.note;
  const first = firstName(person.name);
  const history = [...(row.current ?? []), ...row.history];

  async function save() {
    setBusy(true);
    const ok = await onDecision(row, decision, note);
    if (ok) clearDraft();
    setBusy(false);
  }

  async function setStatus(status) {
    setBusy(true);
    await onUpdate(row, { status }, status === "DEACTIVATED" ? `${person.name} can no longer sign in` : `${person.name} is active again`);
    setBusy(false);
    setConfirming(false);
  }

  async function move() {
    setBusy(true);
    const target = coordinators.find((c) => c.id === moveTo);
    await onUpdate(row, { coordinatorId: moveTo }, `${person.name} is now in ${target?.name ?? "the new"}'s team`);
    setBusy(false);
  }

  return (
    <div className="detail-inner">
      <div className="detail-head">
        <Avatar name={person.name} size="lg" />
        <div>
          <h2>{person.name}</h2>
          <p className="muted small">{person.email} · {domainName(person.domainId)}</p>
          <p className="muted small">{isCoordinatorRow ? `Coordinator · ${row.teamSize ?? 0} in the team` : row.coordinator ? `${row.coordinator.name}'s team` : "Hasn't chosen a coordinator yet"}</p>
          <StandingTag standing={row.standing} />
          {row.setup && !setUp(row) && (
            <p className="small bad">Still to do: {SETUP_MARKS.filter((m) => !row.setup[m.key]).map((m) => m.todo).join(", ")}</p>
          )}
        </div>
      </div>

      <div className="stat-grid">
        <div><b>{totals.taken}</b><span>{isCoordinatorRow ? "EB tasks picked" : "Tasks picked"}</span></div>
        <div><b>{totals.onTime}</b><span>On time</span></div>
        <div><b>{totals.late}</b><span>Late</span></div>
        <div><b className={totals.missed ? "bad" : ""}>{totals.missed}</b><span>Missed</span></div>
      </div>
      <p className="muted small">
        Average score {row.averageScore ?? "—"} (missed = 0) · last active {row.lastActivity ? relative(row.lastActivity) : "never"}
      </p>

      <div className="history">
        <span className="eyebrow">{isCoordinatorRow ? "Final work for EB tasks" : "Recent tasks"}</span>
        {history.length === 0 && <p className="muted small">Hasn't picked a task yet.</p>}
        {history.map((h) => (
          <div key={h.participationId ?? h.taskId} className="history-row">
            <span><b>{h.title}</b><small>Due {fmtDate(h.deadline)}</small></span>
            <span className="history-meta">
              {h.score != null && <span className="score-chip">{h.score}</span>}
              <OutcomeTag outcome={h.outcome} />
            </span>
          </div>
        ))}
      </div>

      {canMove && (
        <div className="decision">
          <span className="eyebrow" id={`move-label-${person.id}`}>Coordinator</span>
          <select aria-labelledby={`move-label-${person.id}`} className="select" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
            {!person.coordinatorId && <option value="">Not chosen yet</option>}
            {coordinators.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <small className="muted">Moves {first} to another team in {domainName(person.domainId)}. Their past work and scores stay with them.</small>
          <button type="button" className="btn btn--small" disabled={busy || !moveTo || moveTo === (person.coordinatorId ?? "")} onClick={move}>{busy ? "Moving…" : "Move to this team"}</button>
        </div>
      )}

      <div className="decision">
        <span className="eyebrow" id={`decision-label-${person.id}`}>Your decision · staff only</span>
        <div className="seg" role="group" aria-labelledby={`decision-label-${person.id}`}>
          {DECISIONS.map((d) => (
            <button key={d.key} type="button" aria-pressed={decision === d.key} className={`${decision === d.key ? "is-on" : ""} seg-${d.key}`} onClick={() => setDraft((x) => ({ ...x, decision: x.decision === d.key ? null : d.key }))}>
              {d.label}
            </button>
          ))}
        </div>
        <small className="muted">A private note for staff. It doesn't change their account; to stop them signing in, use Deactivate below.</small>
        <textarea id="decision-note" aria-label="Private note" rows={3} maxLength={1000} placeholder="Private note, e.g. why, or what was agreed" value={note} onChange={(e) => setDraft((x) => ({ ...x, note: e.target.value }))} />
        {person.decisionAt && <small className="muted">Last updated {fmtDateTime(person.decisionAt)}</small>}
        <button type="button" className="btn btn--small" disabled={!changed || busy} onClick={save}>{busy ? "Saving…" : "Save decision"}</button>
      </div>

      {deactivated ? (
        <button type="button" className="btn btn--ghost btn--block" disabled={busy} onClick={() => setStatus("ACTIVE")}>Reactivate {first}</button>
      ) : confirming ? (
        <div className="confirm">
          <p className="small">{person.name} won't be able to sign in. Their history stays, and you can reactivate them later.{isCoordinatorRow && row.teamSize ? ` Their ${row.teamSize} volunteers stay in the team until someone moves them.` : ""}</p>
          <div className="row">
            <button type="button" className="btn btn--danger" disabled={busy} onClick={() => setStatus("DEACTIVATED")}>{busy ? "Deactivating…" : `Deactivate ${first}`}</button>
            <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn--ghost btn--block" onClick={() => setConfirming(true)}>Deactivate {first}…</button>
      )}
    </div>
  );
}
