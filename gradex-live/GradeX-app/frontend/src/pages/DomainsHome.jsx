import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { Avatar, Empty, ErrorNote, Loading, Progress, StandingTag, useToast } from "../components/ui.jsx";
import Icon from "../components/Icon.jsx";
import { Pulse, teamPulse, Welcome } from "../components/Hero.jsx";
import Notifications from "../components/Notifications.jsx";
import { firstName, fmtDate, greeting, pct, relative, today } from "../format.js";
import { ProposalCard } from "./Approvals.jsx";

const TINTS = ["sky", "leaf", "sun", "rose", "lilac"];

/*
 * Home for EB heads and admins. Every domain at a glance (who heads it, team
 * sizes, open tasks, on-time rate, average score), then one domain in depth:
 * an EB head's own domain, or whichever domain an admin picks.
 */
export default function DomainsHome({ user, domains, counts, onNavigate, refreshCounts = () => {} }) {
  const isAdmin = user.role === "ADMIN";
  const [overview, setOverview] = useState({ status: "loading", domains: [], error: null });
  // An admin who also heads a domain starts on it (that's where their proposals are).
  const [selected, setSelected] = useState(isAdmin ? user.domainId ?? "" : user.domainId);
  const [detail, setDetail] = useState({ status: "loading", people: [], tasks: [], proposals: [], error: null });
  const [toast, showToast] = useToast();

  useEffect(() => {
    const controller = new AbortController();
    api.domainsOverview(controller.signal)
      .then(({ domains }) => {
        setOverview({ status: "ready", domains, error: null });
        setSelected((current) => current || domains[0]?.id || "");
      })
      .catch((error) => error.name !== "AbortError" && setOverview({ status: "error", domains: [], error: error.message }));
    return () => controller.abort();
  }, []);

  const loadDetail = useCallback((signal) => {
    if (!selected) return;
    setDetail((d) => ({ ...d, status: "loading" }));
    Promise.all([
      api.peopleReport(isAdmin ? { domainId: selected } : {}, signal),
      api.tasks(signal, "DOMAIN"),
      api.proposals(signal)
    ])
      .then(([report, tasks, proposals]) => setDetail({
        status: "ready",
        people: report.people,
        tasks: tasks.tasks.filter((t) => t.domainId === selected),
        proposals: proposals.tasks.filter((t) => t.domainId === selected && t.status === "PROPOSED"),
        error: null
      }))
      .catch((error) => error.name !== "AbortError" && setDetail({ status: "error", people: [], tasks: [], proposals: [], error: error.message }));
  }, [selected, isAdmin]);

  useEffect(() => {
    const controller = new AbortController();
    loadDetail(controller.signal);
    return () => controller.abort();
  }, [loadDetail]);

  const domain = overview.domains.find((d) => d.id === selected);
  const domainName = domain?.name ?? domains.find((d) => d.id === selected)?.name ?? "";
  const coordinators = detail.people.filter((p) => p.role === "COORDINATOR");
  const volunteers = detail.people.filter((p) => p.role === "VOLUNTEER");
  const pulse = useMemo(() => teamPulse(detail.people), [detail.people]);
  const live = detail.tasks.filter((t) => t.status === "AVAILABLE" || t.status === "DRAFT").sort((a, b) => Date.parse(a.deadline) - Date.parse(b.deadline));
  const waiting = detail.proposals.length;
  const attention = detail.people.filter((p) => p.standing === "SLIPPING" || p.standing === "INACTIVE").length;

  const tagline = detail.status !== "ready" || pulse.finished === 0
    ? <>Here's how the club is doing.</>
    : pulse.rate >= 0.75 ? <>{isAdmin ? domainName : "Your domain"} is showing up.</> : <>{isAdmin ? domainName : "Your domain"} could use a nudge.</>;

  return (
    <main className="page page--full">
      <Notifications only="setup" />
      <div className="hero">
        <Welcome
          kicker={`${today()} · ${isAdmin ? "Admin" : `${domainName} · EB head`}`}
          title={<>{greeting()}, {firstName(user.name)}.<br />{tagline}</>}
          text={[
            isAdmin
              ? counts.pending > 0 ? `${counts.pending} ${counts.pending === 1 ? "piece of work is" : "pieces of work are"} waiting for a score across the club.` : "Nothing is waiting for a score."
              : counts.pending > 0 ? `${counts.pending} ${counts.pending === 1 ? "piece of final work is" : "pieces of final work are"} waiting for your score.` : "No final work is waiting for your score.",
            waiting > 0 ? `${waiting} ${waiting === 1 ? "proposal needs" : "proposals need"} your approval.` : null,
            attention > 0 ? `${attention} ${attention === 1 ? "person could" : "people could"} use a check-in.` : null
          ].filter(Boolean).join(" ")}
        >
          <button type="button" className="btn btn--sun" onClick={() => onNavigate("review")}>
            <Icon name="inbox" size={17} />{isAdmin ? "Score work" : "Score final work"}{counts.pending > 0 && <em className="btn-count">{counts.pending}</em>}
          </button>
          <button type="button" className="btn btn--glass" onClick={() => onNavigate("tasks", "new")}>
            <Icon name="plus" size={17} />Publish an EB task
          </button>
          {!isAdmin && waiting > 0 && (
            <button type="button" className="btn btn--glass" onClick={() => onNavigate("approvals")}>
              <Icon name="check-circle" size={17} />Approvals<em className="btn-count">{waiting}</em>
            </button>
          )}
        </Welcome>
        <Pulse title={`${domainName || "Domain"} pulse`} meta={`${coordinators.length} coordinators · ${volunteers.length} volunteers`} pulse={pulse} ready={detail.status === "ready"} />
      </div>

      <Notifications only="switch" title="Hear about new proposals" about={isAdmin ? "Get a nudge on this phone when something needs you, like a proposal waiting for approval." : "Get a nudge on this phone when a coordinator proposes a task for your approval."} />

      <section className="stack" aria-labelledby="all-domains">
        <div className="section-head">
          <h2 id="all-domains" className="page-title">All domains</h2>
          <p className="muted">{isAdmin ? "Choose a domain to see it in depth." : "Every domain at a glance. You see your own in depth below."}</p>
        </div>
        {overview.status === "loading" && <Loading />}
        <ErrorNote error={overview.error} />
        <div className="domain-cards">
          {overview.domains.map((d, i) => {
            const Tag = isAdmin ? "button" : "article";
            return (
              <Tag
                key={d.id}
                type={isAdmin ? "button" : undefined}
                className={`domain-card${d.id === selected ? " is-on" : ""}${isAdmin ? " is-clickable" : ""}`}
                aria-pressed={isAdmin ? d.id === selected : undefined}
                onClick={isAdmin ? () => setSelected(d.id) : undefined}
              >
                <span className="domain-card-top">
                  <span className={`domain-badge tint--${TINTS[i % TINTS.length]}`} aria-hidden="true">{d.name.slice(0, 1)}</span>
                  <span className="domain-card-name">
                    <b>{d.name}{d.mine && <span className="tag tag--AVAILABLE">Your domain</span>}</b>
                    <small>{d.head ? `EB head: ${d.head.name}` : "No EB head yet"}</small>
                    <small>{d.coordinators} {d.coordinators === 1 ? "coordinator" : "coordinators"} · {d.volunteers} {d.volunteers === 1 ? "volunteer" : "volunteers"}</small>
                  </span>
                </span>
                <span className="domain-card-stats">
                  <span><b>{d.openTasks}</b><small>open tasks</small></span>
                  <span><b className={d.onTimeRate == null ? "" : d.onTimeRate >= 0.75 ? "good" : d.onTimeRate < 0.5 ? "bad" : ""}>{pct(d.onTimeRate)}</b><small>on time</small></span>
                  <span><b>{d.averageScore ?? "—"}</b><small>avg score</small></span>
                </span>
              </Tag>
            );
          })}
        </div>
      </section>

      {selected && (
        <section className="stack" aria-labelledby="in-depth">
          <div className="section-head">
            <h2 id="in-depth" className="page-title">{domainName} in depth</h2>
            <p className="muted">Coordinators and their teams, and the EB tasks in progress.</p>
          </div>
          {detail.status === "loading" && <Loading />}
          <ErrorNote error={detail.error} />
          {detail.status === "ready" && (
            <div className="split">
              <div className="surface list-card">
                <div className="ctitle"><h2><Icon name="users" size={18} />Coordinators</h2><button type="button" className="link-btn tap small" onClick={() => onNavigate("people")}>Everyone <Icon name="arrow-r" size={14} /></button></div>
                {coordinators.length === 0 && <p className="muted small">No coordinators in {domainName} yet. An admin adds them in Accounts.</p>}
                {coordinators.map((c) => (
                  <div key={c.person.id} className="coord-row">
                    <span className="person">
                      <Avatar name={c.person.name} size="sm" />
                      <span><b>{c.person.name}</b><small>{c.teamSize ?? 0} {c.teamSize === 1 ? "volunteer" : "volunteers"} · final work on time {pct(c.onTimeRate)}</small></span>
                    </span>
                    <span className="history-meta">
                      {c.averageScore != null && <span className="score-chip" title="Average EB score, missed = 0">{c.averageScore}</span>}
                      <StandingTag standing={c.standing} />
                    </span>
                  </div>
                ))}
              </div>

              <div className="surface list-card">
                <div className="ctitle"><h2><Icon name="tasks" size={18} />EB tasks in progress</h2><button type="button" className="link-btn tap small" onClick={() => onNavigate("tasks")}>All tasks <Icon name="arrow-r" size={14} /></button></div>
                {live.length === 0 && <p className="muted small">Nothing open. Publish an EB task for {domainName}'s coordinators.</p>}
                {live.map((t) => (
                  <div key={t.id} className="eb-row">
                    <span>
                      <b>{t.title}</b>
                      <small>{t.status === "DRAFT" ? "Draft, not published yet" : `Due ${fmtDate(t.deadline)} (${relative(t.deadline)}) · forwarded to ${t.forwards} ${t.forwards === 1 ? "team" : "teams"}`}</small>
                    </span>
                    {t.status !== "DRAFT" && <Progress counts={t.counts} noun="coordinators" />}
                  </div>
                ))}
              </div>
            </div>
          )}

          {isAdmin && detail.status === "ready" && (
            <>
              <h3 className="section-title">Proposals waiting for approval <span className="count-pill">{detail.proposals.length}</span></h3>
              {detail.proposals.length === 0
                ? <Empty title="No proposals waiting" icon="check-circle">Coordinators' own task ideas show up here until {domain?.head?.name ?? "the EB head"} or an admin decides.</Empty>
                : (
                  <div className="card-grid">
                    {detail.proposals.map((task) => (
                      <ProposalCard key={task.id} task={task} domainName={() => domainName} onDone={(message) => { showToast(message); loadDetail(); refreshCounts(); }} />
                    ))}
                  </div>
                )}
            </>
          )}
        </section>
      )}
      {toast}
    </main>
  );
}
