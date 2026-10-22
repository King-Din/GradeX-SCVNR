import { useState } from "react";
import { api, openSubmission } from "../api.js";
import { ErrorNote, useConfig } from "./ui.jsx";
import Icon from "./Icon.jsx";
import { fmtDateTime, fmtWeekday } from "../format.js";

// "2 days 14 hrs" until a deadline (only called for future deadlines).
function countdown(iso, now = Date.now()) {
  const diff = Math.max(0, Date.parse(iso) - now);
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (days >= 1) return `${plural(days, "day")} ${plural(hours, "hr")}`;
  if (hours >= 1) return `${plural(hours, "hr")} ${plural(mins, "min")}`;
  return plural(Math.max(mins, 1), "min");
}

export function Countdown({ deadline }) {
  return (
    <p className="countdown">
      <Icon name="clock" size={16} />
      <span><b>{countdown(deadline)}</b> to go · {fmtWeekday(deadline)}</span>
    </p>
  );
}

// What someone already sent: when, late or not, and a way to open it.
export function SentRow({ submission, onError, label }) {
  return (
    <div className="sent">
      <span className="small">
        {label ?? (submission.isLate ? "Sent after the deadline" : "Sent")} {fmtDateTime(submission.updatedAt ?? submission.submittedAt)}
      </span>
      <button type="button" className="link-btn tap" onClick={() => openSubmission(submission).catch((e) => onError(e.message))}>
        {submission.kind === "LINK" ? "Open link" : submission.fileName ?? "Open file"} <Icon name="arrow-ur" size={14} />
      </button>
    </div>
  );
}

/*
 * Send work as a link or a file. `to` names who receives it ("Priya (EB,
 * Design)") so the button says exactly where the work goes.
 */
export function SubmitForm({ taskId, replacing, late, onDone, to = null, finalWork = false, startOpen }) {
  const { maxUploadMb } = useConfig();
  const [mode, setModeState] = useState("link");
  const [link, setLink] = useState("");
  const [file, setFile] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(startOpen ?? !replacing);

  // Switching modes remounts the inputs, so start each mode clean.
  const setMode = (next) => {
    setModeState(next);
    setFile(null);
    setError(null);
  };

  const what = finalWork ? "final work" : "work";
  // Buttons name the person by first name only, so they fit on a phone; the
  // full "Name (EB, Domain)" is in the note above the form.
  const toFirst = to && !/^your\b/i.test(to) ? to.split(" ")[0] : null;

  if (!open) {
    return (
      <button type="button" className="btn btn--ghost btn--small" onClick={() => setOpen(true)}>
        <Icon name={replacing ? "refresh" : "upload"} size={15} />
        {replacing ? `Replace my ${what}` : toFirst ? `Submit ${what} to ${toFirst}` : `Submit my ${what}`}
      </button>
    );
  }

  function chooseFile(e) {
    const chosen = e.target.files?.[0] ?? null;
    setError(null);
    if (chosen && chosen.size > maxUploadMb * 1024 * 1024) {
      setError(`That file is too large. The limit is ${maxUploadMb} MB.`);
      e.target.value = "";
      setFile(null);
      return;
    }
    setFile(chosen);
  }

  async function submit(e) {
    e.preventDefault();
    if (pending) return;
    if (mode === "file" && !file) return setError("Choose a file first.");
    if (mode === "link" && !/^https:\/\//i.test(link.trim())) return setError("Paste a full link starting with https://");
    setPending(true);
    setError(null);
    try {
      const { message } = mode === "link" ? await api.submitLink(taskId, link.trim()) : await api.submitFile(taskId, file);
      setLink("");
      setFile(null);
      setOpen(false);
      onDone(to && !replacing ? `${message}: sent to ${to}` : message);
    } catch (err) {
      setError(err.message);
    }
    setPending(false);
  }

  return (
    <form className="submit-form" onSubmit={submit} noValidate>
      {to && <p className="small muted">Your {what} goes to <b className="ink">{to}</b>, who scores it.</p>}
      <div className="seg" role="group" aria-label="How to send your work">
        <button type="button" aria-pressed={mode === "link"} className={mode === "link" ? "is-on" : ""} onClick={() => setMode("link")}><Icon name="link" size={15} />Paste a link</button>
        <button type="button" aria-pressed={mode === "file"} className={mode === "file" ? "is-on" : ""} onClick={() => setMode("file")}><Icon name="file" size={15} />Upload a file</button>
      </div>
      {mode === "link" ? (
        <input id={`link-${taskId}`} type="url" aria-label="Link to your work" placeholder="https://www.canva.com/design/…" value={link} onChange={(e) => setLink(e.target.value)} />
      ) : (
        <label className="drop">
          <input id={`file-${taskId}`} type="file" accept=".pdf,.doc,.docx,.pptx,.png,.jpg,.jpeg,.txt" onChange={chooseFile} />
          <span className="drop-icon" aria-hidden="true"><Icon name="upload" size={20} /></span>
          <span>{file ? file.name : "Choose a file"}</span>
          <small className="muted">PDF, Word, PowerPoint, PNG, JPG or text · up to {maxUploadMb} MB</small>
        </label>
      )}
      {late && !replacing && <p className="note note--warn small">The deadline has passed. You can still submit, and it will be marked late.</p>}
      <ErrorNote error={error} />
      <div className="row">
        <button type="submit" className="btn btn--lg submit-go" disabled={pending || (mode === "link" ? !link.trim() : !file)}>
          {!pending && <Icon name="upload" size={17} />}
          {pending ? "Sending…" : replacing ? "Replace submission" : late ? `Submit ${what} late` : toFirst ? `Send to ${toFirst}` : to ? "Send" : "Submit my work"}
        </button>
        {(replacing || startOpen === false) && <button type="button" className="btn btn--ghost" disabled={pending} onClick={() => setOpen(false)}>Cancel</button>}
      </div>
    </form>
  );
}
