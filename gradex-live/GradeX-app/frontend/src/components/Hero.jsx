import { Ring } from "./ui.jsx";
import Icon from "./Icon.jsx";
import { HeroArt } from "./Logo.jsx";

// Numbers for the pulse card, from people-report rows that are already loaded.
export function teamPulse(rows) {
  const active = rows.filter((r) => r.standing !== "DEACTIVATED");
  const sum = (key) => active.reduce((n, r) => n + (r.totals?.[key] ?? 0), 0);
  const onTime = sum("onTime");
  const late = sum("late");
  const missed = sum("missed");
  const finished = onTime + late + missed;
  const scored = active.map((r) => r.averageScore).filter((n) => typeof n === "number");
  return {
    onTime, late, missed, finished,
    rate: finished ? onTime / finished : null,
    average: scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null
  };
}

// The blue greeting banner at the top of a home page.
export function Welcome({ kicker, title, text, children }) {
  return (
    <section className="welcome" aria-label="Overview">
      <p className="welcome-k">{kicker}</p>
      <h1 className="welcome-title">{title}</h1>
      {text && <p className="welcome-p">{text}</p>}
      {children && <div className="welcome-cta">{children}</div>}
      <HeroArt className="welcome-art" />
    </section>
  );
}

// On-time ring with on time / late / missed beside it.
export function Pulse({ title = "Team pulse", meta, pulse, ready = true, foot }) {
  return (
    <div className="pulse surface">
      <div className="ctitle"><h2>{title}</h2>{meta && <span className="ctitle-meta">{meta}</span>}</div>
      <div className="pulse-row">
        <Ring value={ready ? pulse.rate : null} />
        <dl className="pulse-stats">
          <div><dt><i className="key key--leaf" aria-hidden="true" />On time</dt><dd>{ready ? pulse.onTime : "—"}</dd></div>
          <div><dt><i className="key key--sun" aria-hidden="true" />Late</dt><dd>{ready ? pulse.late : "—"}</dd></div>
          <div><dt><i className="key key--rose" aria-hidden="true" />Missed</dt><dd>{ready ? pulse.missed : "—"}</dd></div>
        </dl>
      </div>
      <p className="pulse-foot"><Icon name="trend" size={15} />{foot ?? <>Average score <b>{pulse.average ?? "—"}</b> (missed = 0)</>}</p>
    </div>
  );
}
