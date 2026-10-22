import { useCallback, useEffect, useState } from "react";
import { api, downloadExport } from "../api.js";
import { Avatar, Confirm, Empty, ErrorNote, Loading, Panel, StatusTag, useDemo, useToast } from "../components/ui.jsx";
import { ROLE_LABEL } from "../format.js";
import Icon from "../components/Icon.jsx";

const ROLES = ["ADMIN", "EB", "COORDINATOR", "VOLUNTEER"];
const MAX_ADMINS = 2;
const active = (u) => u.status !== "DEACTIVATED";

export default function Accounts({ user, domains }) {
  const demo = useDemo();
  const [state, setState] = useState({ status: "loading", users: [], error: null });
  const [role, setRole] = useState("ALL");
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState(null); // { type: "add" | "edit" | "import" | "password" | "status" | "reset", user? }
  const [exporting, setExporting] = useState(false);
  const [toast, showToast] = useToast();

  const load = useCallback((signal) => {
    api.users(signal)
      .then(({ users }) => setState({ status: "ready", users: [...users].sort((a, b) => a.name.localeCompare(b.name)), error: null }))
      .catch((error) => error.name !== "AbortError" && setState({ status: "error", users: [], error: error.message }));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const domainName = (id) => domains.find((d) => d.id === id)?.name ?? "—";
  const nameOf = (id) => state.users.find((u) => u.id === id)?.name ?? "—";
  const q = query.trim().toLowerCase();
  const visible = state.users.filter((u) =>
    (role === "ALL" || u.role === role) && (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
  );

  const done = (message) => {
    setDialog(null);
    showToast(message);
    load();
  };

  async function exportExcel() {
    setExporting(true);
    try {
      await downloadExport();
    } catch (error) {
      showToast(error.message);
    }
    setExporting(false);
  }

  async function toggleStatus(target) {
    const status = target.status === "DEACTIVATED" ? "ACTIVE" : "DEACTIVATED";
    await api.updateUser(target.id, { status });
    done(status === "DEACTIVATED" ? `${target.name} can no longer sign in` : `${target.name} is active again`);
  }

  return (
    <main className="page page--full">
      <header className="page-head">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>Accounts</h1>
          {state.status === "ready" && <p className="muted">{state.users.length} people · {state.users.filter((u) => u.status === "DEACTIVATED").length} deactivated · one EB head per domain, at most {MAX_ADMINS} admins</p>}
        </div>
        <div className="row">
          {demo && <button type="button" className="btn btn--ghost" onClick={() => setDialog({ type: "reset" })}><Icon name="refresh" size={17} />Reset demo data</button>}
          <button type="button" className="btn btn--ghost" disabled={exporting} onClick={exportExcel}><Icon name="download" size={17} />{exporting ? "Preparing…" : "Download Excel"}</button>
          <button type="button" className="btn btn--ghost" onClick={() => setDialog({ type: "import" })}><Icon name="upload" size={17} />Import CSV</button>
          <button type="button" className="btn" onClick={() => setDialog({ type: "add" })}><Icon name="plus" size={17} />Add person</button>
        </div>
      </header>

      <div className="toolbar">
        <div className="chips" role="group" aria-label="Filter by role">
          {["ALL", ...ROLES].map((r) => (
            <button key={r} type="button" aria-pressed={role === r} className={`chip${role === r ? " is-on" : ""}`} onClick={() => setRole(r)}>
              {r === "ALL" ? "Everyone" : ROLE_LABEL[r]}<em>{r === "ALL" ? state.users.length : state.users.filter((u) => u.role === r).length}</em>
            </button>
          ))}
        </div>
        <input id="accounts-search" className="search search--icon" type="search" aria-label="Search by name or email" placeholder="Search by name or email" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {state.status === "loading" && <Loading />}
      <ErrorNote error={state.error} />
      {state.status === "ready" && visible.length === 0 && <Empty title="No one matches" icon="search">Try another filter or clear the search.</Empty>}

      {visible.length > 0 && (
        <div className="table-wrap">
          <table className="table table--cards">
            <thead><tr><th>Person</th><th>Role</th><th>Domain</th><th>Coordinator</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {visible.map((u) => (
                <tr key={u.id} className={u.status === "DEACTIVATED" ? "is-dim" : undefined}>
                  <td data-label="Person"><span className="person"><Avatar name={u.name} size="sm" /><span><b>{u.name}{u.id === user.id ? " (you)" : ""}</b><small>{u.email}</small></span></span></td>
                  <td data-label="Role"><span className={`role role--${u.role}`}>{ROLE_LABEL[u.role]}</span></td>
                  <td data-label="Domain">{u.domainId ? domainName(u.domainId) : u.role === "VOLUNTEER" || u.role === "COORDINATOR" ? <span className="muted">Not chosen yet</span> : "—"}</td>
                  <td data-label="Coordinator">{u.role === "VOLUNTEER" ? (u.coordinatorId ? nameOf(u.coordinatorId) : <span className="muted">Chooses at sign-in</span>) : <span className="muted">—</span>}</td>
                  <td data-label="Status"><StatusTag status={u.status} /></td>
                  <td className="actions">
                    <button type="button" className="link-btn tap" onClick={() => setDialog({ type: "edit", user: u })}>Edit</button>
                    {u.id !== user.id && (
                      <>
                        <button type="button" className="link-btn tap" onClick={() => setDialog({ type: "password", user: u })}>Reset password</button>
                        <button type="button" className="link-btn tap" onClick={() => setDialog({ type: "status", user: u })}>
                          {u.status === "DEACTIVATED" ? "Reactivate…" : "Deactivate…"}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(dialog?.type === "add" || dialog?.type === "edit") && (
        <PersonForm key={dialog.user?.id ?? "new"} person={dialog.user} self={dialog.user?.id === user.id} domains={domains} users={state.users} onClose={() => setDialog(null)} onSaved={done} />
      )}
      {dialog?.type === "password" && <PasswordForm person={dialog.user} onClose={() => setDialog(null)} onSaved={done} />}
      {dialog?.type === "status" && (
        <Confirm
          title={dialog.user.status === "DEACTIVATED" ? `Reactivate ${dialog.user.name}?` : `Deactivate ${dialog.user.name}?`}
          confirmLabel={dialog.user.status === "DEACTIVATED" ? "Reactivate" : "Deactivate"}
          danger={dialog.user.status !== "DEACTIVATED"}
          onConfirm={() => toggleStatus(dialog.user)}
          onCancel={() => setDialog(null)}
        >
          <p>
            {dialog.user.status === "DEACTIVATED"
              ? `${dialog.user.name} will be able to sign in again.`
              : `${dialog.user.name} is signed out everywhere and can't sign in. Their history stays, and you can reactivate them later.`}
          </p>
        </Confirm>
      )}
      {dialog?.type === "import" && <ImportForm domains={domains} users={state.users} onClose={() => setDialog(null)} onDone={() => load()} />}
      {dialog?.type === "reset" && demo && <ResetDemo onClose={() => setDialog(null)} />}
      {toast}
    </main>
  );
}

function PersonForm({ person, self, domains, users, onClose, onSaved }) {
  const initial = {
    name: person?.name ?? "",
    email: person?.email ?? "",
    role: person?.role ?? "VOLUNTEER",
    domainId: person?.domainId ?? "",
    coordinatorId: person?.coordinatorId ?? "",
    password: ""
  };
  const [form, setForm] = useState(initial);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const needsDomain = form.role === "EB";
  const leads = form.role === "EB" || form.role === "ADMIN";
  // A volunteer's current coordinator stays listed even if deactivated, so the
  // form shows what's really saved.
  const coordinators = users.filter((u) => u.role === "COORDINATOR" && u.id !== person?.id && (active(u) || u.id === person?.coordinatorId) && (!form.domainId || u.domainId === form.domainId));
  // The one-head and two-admin rules only bind active accounts (as on the server).
  const personActive = !person || active(person);
  const head = leads && form.domainId && personActive ? users.find((u) => (u.role === "EB" || u.role === "ADMIN") && u.domainId === form.domainId && active(u) && u.id !== person?.id) : null;
  const admins = users.filter((u) => u.role === "ADMIN" && active(u) && u.id !== person?.id).length;
  const tooManyAdmins = form.role === "ADMIN" && person?.role !== "ADMIN" && personActive && admins >= MAX_ADMINS;

  // EB heads need a domain: never leave the select showing one option while
  // the form holds "none". Volunteers drop a coordinator that isn't in their
  // new domain.
  const setRole = (e) => {
    const role = e.target.value;
    setForm((f) => ({ ...f, role, domainId: role === "EB" && !f.domainId ? domains[0]?.id ?? "" : f.domainId, coordinatorId: role === "VOLUNTEER" ? f.coordinatorId : "" }));
  };
  const setDomain = (e) => {
    const domainId = e.target.value;
    setForm((f) => ({ ...f, domainId, coordinatorId: users.find((u) => u.id === f.coordinatorId)?.domainId === domainId ? f.coordinatorId : "" }));
  };
  const setCoordinator = (e) => {
    const coordinatorId = e.target.value;
    const coordinator = users.find((u) => u.id === coordinatorId);
    setForm((f) => ({ ...f, coordinatorId, domainId: coordinator?.domainId ?? f.domainId }));
  };

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  async function submit(e) {
    e.preventDefault();
    if (pending) return;
    if (needsDomain && !form.domainId) return setError("Choose the domain this EB head leads.");
    if (head) return setError(`${domains.find((d) => d.id === form.domainId)?.name} already has a head (${head.name}). Change theirs first.`);
    if (tooManyAdmins) return setError(`There can only be ${MAX_ADMINS} admins. Change one of them first.`);
    setPending(true);
    setError(null);
    const body = {
      name: form.name.trim(),
      email: form.email.trim(),
      role: form.role,
      domainId: form.domainId || null,
      coordinatorId: form.role === "VOLUNTEER" && form.coordinatorId ? form.coordinatorId : null
    };
    try {
      if (person) {
        await api.updateUser(person.id, body);
        onSaved(`Saved ${body.name}`);
      } else {
        await api.createUser({ ...body, password: form.password });
        onSaved(`Added ${body.name}. Share their starting password with them directly.`);
      }
    } catch (err) {
      setError(err.message);
      setPending(false);
    }
  }

  return (
    <Panel title={person ? `Edit ${person.name}` : "Add a person"} onClose={onClose} dirty={dirty && !pending}>
      <form className="form" onSubmit={submit}>
        <label className="field"><span>Full name</span><input id="person-name" required maxLength={100} value={form.name} onChange={set("name")} /></label>
        <label className="field"><span>Email</span><input id="person-email" type="email" required value={form.email} onChange={set("email")} /></label>
        <div className="form-row">
          <label className="field">
            <span>Role</span>
            <select id="person-role" value={form.role} onChange={setRole} disabled={self} aria-describedby={self ? "person-role-self" : undefined}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
            {self && <small id="person-role-self" className="muted">You can't change your own role. Ask the other admin.</small>}
          </label>
          <label className="field">
            <span>{form.role === "EB" ? "Domain they lead" : form.role === "ADMIN" ? "Also heads (optional)" : "Domain"}</span>
            <select id="person-domain" required={needsDomain} value={form.domainId} onChange={setDomain}>
              {(form.role === "VOLUNTEER" || form.role === "COORDINATOR") && <option value="">They choose at first login</option>}
              {form.role === "ADMIN" && <option value="">No domain</option>}
              {needsDomain && !form.domainId && <option value="">Choose a domain</option>}
              {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
        </div>
        {form.role === "VOLUNTEER" && (
          <label className="field">
            <span>Coordinator</span>
            <select id="person-coordinator" value={form.coordinatorId} onChange={setCoordinator}>
              <option value="">They choose at first login</option>
              {coordinators.map((c) => <option key={c.id} value={c.id}>{c.name}{form.domainId ? "" : ` (${domains.find((d) => d.id === c.domainId)?.name ?? c.domainId})`}{active(c) ? "" : " (deactivated)"}</option>)}
            </select>
            <small className="muted">A volunteer belongs to one coordinator's team, in that coordinator's domain.</small>
          </label>
        )}
        <p className="muted small">{ROLE_HELP[form.role]}</p>
        {head && <p className="note note--warn small">{head.name} already heads this domain. Each domain has exactly one head.</p>}
        {tooManyAdmins && <p className="note note--warn small">There are already {MAX_ADMINS} admins.</p>}
        {!person && (
          <label className="field">
            <span>Starting password</span>
            <input id="person-password" type="text" required minLength={8} maxLength={72} value={form.password} onChange={set("password")} autoComplete="off" spellCheck={false} />
            <small className="muted">At least 8 characters. They'll be asked to set their own when they first sign in.</small>
          </label>
        )}
        <ErrorNote error={error} />
        <button type="submit" className="btn" disabled={pending}>{pending ? "Saving…" : person ? "Save changes" : "Add person"}</button>
      </form>
    </Panel>
  );
}

const ROLE_HELP = {
  ADMIN: "Admins see and change everything, including accounts. The club has two: the app owner and the divisional president.",
  EB: "The EB head of one domain: publishes its tasks to coordinators, approves their proposals and scores their final work.",
  COORDINATOR: "Runs a team in one domain: picks the EB's tasks, forwards them to the team, scores the team's work and sends the final work to the EB head.",
  VOLUNTEER: "Picks the tasks their coordinator forwards and sends their work back to them."
};

function ResetDemo({ onClose }) {
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  async function reset() {
    setPending(true);
    try {
      await api.resetDemo();
      window.location.reload();
    } catch (err) {
      setError(err.message);
      setPending(false);
    }
  }

  return (
    <Panel title="Reset demo data" onClose={() => !pending && onClose()}>
      <div className="form">
        <p>This puts every task, submission, score and account back to the starting demo data, for everyone using this site.</p>
        <ErrorNote error={error} />
        <div className="row">
          <button type="button" className="btn btn--danger" disabled={pending} onClick={reset}>{pending ? "Resetting…" : "Reset for everyone"}</button>
          <button type="button" className="btn btn--ghost" disabled={pending} onClick={onClose}>Keep the current data</button>
        </div>
      </div>
    </Panel>
  );
}

function PasswordForm({ person, onClose, onSaved }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await api.resetPassword(person.id, password);
      onSaved(`Password reset for ${person.name}. They'll choose their own at next sign-in.`);
    } catch (err) {
      setError(err.message);
      setPending(false);
    }
  }

  return (
    <Panel title={`Reset ${person.name}'s password`} onClose={onClose} dirty={password.length > 0 && !pending}>
      <form className="form" onSubmit={submit}>
        <p className="muted small">They'll be signed in with this password once, then asked to choose their own. Share it with them directly.</p>
        <label className="field">
          <span>New starting password</span>
          <input id="reset-password" type="text" required minLength={8} maxLength={72} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" spellCheck={false} />
        </label>
        <ErrorNote error={error} />
        <button type="submit" className="btn" disabled={pending}>{pending ? "Resetting…" : "Reset password"}</button>
      </form>
    </Panel>
  );
}

// ---------- CSV import ----------

// RFC 4180-style parser: quoted fields (with commas, quotes "" and line
// breaks), CRLF or LF, a leading BOM, and comma / semicolon / tab separators
// (Excel uses ";" in many locales). Returns rows with their real line numbers.
function parseCsvText(text) {
  const source = text.replace(/^﻿/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const count = (ch) => firstLine.split(ch).length - 1;
  const sep = count(";") > count(",") ? ";" : count("\t") > count(",") ? "\t" : ",";

  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else {
        if (ch === "\n") line += 1;
        field += ch;
      }
    } else if (ch === '"' && field.trim() === "") {
      quoted = true;
      field = "";
    } else if (ch === sep) {
      row.push(field.trim());
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i += 1;
      row.push(field.trim());
      rows.push({ line: rowLine, cells: row });
      row = [];
      field = "";
      line += 1;
      rowLine = line;
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length) {
    row.push(field.trim());
    rows.push({ line: rowLine, cells: row });
  }
  return rows.filter((r) => r.cells.some((c) => c !== ""));
}

const HEADER_ALIASES = {
  name: ["name", "full name", "fullname", "volunteer", "person"],
  email: ["email", "e-mail", "email address", "mail"],
  role: ["role", "type"],
  domain: ["domain", "domain name", "domain id"],
  coordinator: ["coordinator_email", "coordinator email", "coordinator email (volunteers)", "coordinator", "coordinator e-mail"]
};

const ROLE_ALIASES = {
  admin: "ADMIN",
  eb: "EB", "eb head": "EB", "eb (domain head)": "EB", "domain head": "EB", head: "EB",
  coordinator: "COORDINATOR",
  volunteer: "VOLUNTEER"
};

const CSV_TEMPLATE = [
  "name,email,role,domain,coordinator_email",
  "Priya Sharma,priya@example.com,eb,Design,",
  "Ravi Kumar,ravi@example.com,coordinator,Design,",
  "Meena Iyer,meena@example.com,volunteer,Design,ravi@example.com",
  "Pooja M,pooja@example.com,volunteer,,"
].join("\n");

function headerIndex(cells) {
  const lower = cells.map((c) => c.toLowerCase());
  const found = {};
  for (const [key, names] of Object.entries(HEADER_ALIASES)) {
    const at = lower.findIndex((c) => names.includes(c));
    if (at >= 0) found[key] = at;
  }
  return found.name != null && found.email != null ? found : null;
}

// "name,email,role,domain,coordinator_email" per line (any column order when
// there's a header); domain can be a name or an ID.
function parseCsv(text, domains, users = []) {
  const rows = [];
  const problems = [];
  const parsed = parseCsvText(text);
  if (parsed.length === 0) return { rows, problems };

  const header = headerIndex(parsed[0].cells);
  const columns = header ?? { name: 0, email: 1, role: 2, domain: 3, coordinator: 4 };
  const body = header ? parsed.slice(1) : parsed;
  const seen = new Map();
  const parsedRows = body.map(({ line, cells }) => {
    const roleRaw = (columns.role != null ? cells[columns.role] : "") || "volunteer";
    return {
      line,
      name: cells[columns.name] ?? "",
      email: (cells[columns.email] ?? "").toLowerCase(),
      roleRaw,
      role: ROLE_ALIASES[roleRaw.trim().toLowerCase()] ?? roleRaw.toUpperCase(),
      domainRaw: columns.domain != null ? cells[columns.domain] ?? "" : "",
      coordinatorEmail: (columns.coordinator != null ? cells[columns.coordinator] ?? "" : "").toLowerCase()
    };
  });
  // Coordinators already in GradeX, plus the ones in this file.
  const knownCoordinators = new Map(users.filter((u) => u.role === "COORDINATOR").map((u) => [u.email.toLowerCase(), u.domainId]));
  for (const r of parsedRows) {
    if (r.role === "COORDINATOR") knownCoordinators.set(r.email, domains.find((d) => d.id.toLowerCase() === r.domainRaw.toLowerCase() || d.name.toLowerCase() === r.domainRaw.toLowerCase())?.id ?? null);
  }
  const ebInFile = new Map();

  for (const { line, name, email, roleRaw, role, domainRaw, coordinatorEmail } of parsedRows) {
    const domain = domains.find((d) => d.id.toLowerCase() === domainRaw.toLowerCase() || d.name.toLowerCase() === domainRaw.toLowerCase());
    const coordinatorDomain = coordinatorEmail ? knownCoordinators.get(coordinatorEmail) : undefined;

    if (!name || !email) problems.push(`Line ${line}: needs a name and an email`);
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.push(`Line ${line}: "${email}" isn't an email address`);
    else if (seen.has(email)) problems.push(`Line ${line}: ${email} is already on line ${seen.get(email)}`);
    else if (!ROLES.includes(role)) problems.push(`Line ${line}: role "${roleRaw}" isn't admin, eb, coordinator or volunteer`);
    else if (domainRaw && !domain) problems.push(`Line ${line}: domain "${domainRaw}" doesn't exist`);
    else if (role === "EB" && !domain) problems.push(`Line ${line}: an EB head needs a domain`);
    else if ((role === "EB" || role === "ADMIN") && domain && ebInFile.has(domain.id)) problems.push(`Line ${line}: ${domain.name} already has a head on line ${ebInFile.get(domain.id)}`);
    else if (coordinatorEmail && role !== "VOLUNTEER") problems.push(`Line ${line}: only volunteers have a coordinator email`);
    else if (coordinatorEmail && coordinatorDomain === undefined) problems.push(`Line ${line}: ${coordinatorEmail} isn't a coordinator in GradeX or in this file`);
    else if (coordinatorEmail && domain && coordinatorDomain && coordinatorDomain !== domain.id) problems.push(`Line ${line}: ${coordinatorEmail} coordinates another domain`);
    else {
      if ((role === "EB" || role === "ADMIN") && domain) ebInFile.set(domain.id, line);
      rows.push({
        name, email, role,
        domainId: domain ? domain.id : null,
        ...(role === "VOLUNTEER" && coordinatorEmail ? { coordinatorEmail } : {})
      });
    }

    if (email && !seen.has(email)) seen.set(email, line);
  }

  return { rows, problems };
}

function downloadTemplate() {
  const blob = new Blob([`${CSV_TEMPLATE}\n`], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "gradex-people-template.csv";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const CSV_HEADER = "name,email,role,domain,coordinator_email";

function ImportForm({ domains, users, onClose, onDone }) {
  const [text, setText] = useState(`${CSV_HEADER}\n`);
  const [password, setPassword] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const { rows, problems } = parseCsv(text, domains, users);

  async function submit(e) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await api.importUsers(rows.map((r) => ({ ...r, password })));
      setResult(response);
      onDone();
    } catch (err) {
      setError(err.message);
    }
    setPending(false);
  }

  async function readFile(e) {
    const file = e.target.files?.[0];
    // Let the same file be chosen again after editing it.
    e.target.value = "";
    if (!file) return;
    try {
      setText(await file.text());
      setError(null);
    } catch {
      setError("That file couldn't be read. Save it as CSV and try again.");
    }
  }

  const dirty = !result && (password.length > 0 || text.trim() !== CSV_HEADER);

  return (
    <Panel title="Import people from CSV" onClose={onClose} wide dirty={dirty && !pending}>
      {result ? (
        <div className="form">
          <p><b>{result.created} added</b>{result.failed ? `, ${result.failed} skipped` : ""}.</p>
          {result.results.filter((r) => !r.ok).map((r, i) => <p key={`${r.email}-${i}`} className="note note--error">{r.email}: {r.error}</p>)}
          <p className="muted small">Everyone added can sign in with the starting password you chose, then sets their own. Ask them to keep it private.</p>
          <button type="button" className="btn" onClick={onClose}>Done</button>
        </div>
      ) : (
        <form className="form" onSubmit={submit}>
          <p className="muted small">One person per line: <code>{CSV_HEADER}</code>. A header row is optional and can list the columns in any order. Role is <b>admin</b>, <b>eb</b> (domain head), <b>coordinator</b> or <b>volunteer</b>. Domain is a name like {domains[0]?.name ?? "Design"} or an ID like D001. Each domain has one head: an EB head, or an admin who also heads it (an admin's domain is optional). A coordinator can leave domain empty and choose it at first login. For volunteers, <code>coordinator_email</code> is their coordinator (already in GradeX or earlier in this file); leave domain and coordinator empty and they choose both at first login. Names with commas can be wrapped in quotes, like <code>"Rao, Priya"</code>.</p>
          <div className="row">
            <button type="button" className="btn btn--ghost btn--small" onClick={() => setText(`${CSV_TEMPLATE}\n`)}><Icon name="file" size={15} />Fill in an example</button>
            <button type="button" className="btn btn--ghost btn--small" onClick={downloadTemplate}><Icon name="download" size={15} />Download template</button>
          </div>
          <label className="field">
            <span>People</span>
            <textarea id="import-csv" rows={8} value={text} onChange={(e) => setText(e.target.value)} className="mono" spellCheck={false} />
          </label>
          <label className="field field--file"><span>Or choose a .csv file</span><input id="import-file" type="file" accept=".csv,text/csv,text/plain" onChange={readFile} /></label>
          <label className="field">
            <span>Starting password for everyone in this batch</span>
            <input id="import-password" type="text" required minLength={8} maxLength={72} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          {problems.length > 0 && (
            <div role="alert" className="form">
              {problems.map((p) => <p key={p} className="note note--error">{p}</p>)}
            </div>
          )}
          <ErrorNote error={error} />
          <button type="submit" className="btn" disabled={pending || rows.length === 0 || problems.length > 0 || password.length < 8}>
            {pending ? "Importing…" : `Import ${rows.length} ${rows.length === 1 ? "person" : "people"}`}
          </button>
        </form>
      )}
    </Panel>
  );
}
