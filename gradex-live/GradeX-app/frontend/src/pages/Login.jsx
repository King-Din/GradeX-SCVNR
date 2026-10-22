import { useState } from "react";
import { api } from "../api.js";
import { ErrorNote, useDemo } from "../components/ui.jsx";
import Icon from "../components/Icon.jsx";
import Logo, { HeroArt, Underline } from "../components/Logo.jsx";

// Matches src/data/seed.js. Shown only when the backend says it's a demo.
const DEMO_PASSWORD = "password123";
const DEMO_ACCOUNTS = [
  { label: "Admin", email: "admin@example.com", who: "Asha, app admin" },
  { label: "EB head", email: "eb.design@example.com", who: "Priya, heads Design" },
  { label: "Coordinator", email: "coordinator@example.com", who: "Ravi, a Design team" },
  { label: "Volunteer", email: "volunteer@example.com", who: "Meena, in Ravi's team" }
];

export default function Login({ notice, onSignedIn }) {
  const demo = useDemo();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function signIn(nextEmail, nextPassword) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const { token, user } = await api.login(nextEmail, nextPassword);
      onSignedIn(token, user);
    } catch (err) {
      setError(err.status === 401 ? "That email and password don't match an account. Check both and try again." : err.message);
      setPending(false);
    }
  }

  return (
    <main className="login">
      <section className="login-card login-card--split">
        <div className="login-art">
          <Logo variant="brand" onBlue />
          <p className="login-pitch display">Every task picked, <Underline>seen and scored.</Underline></p>
          <p className="login-sub">GradeX keeps Street Cause VNRVJIET's tasks, submissions and feedback in one warm place.</p>
          <HeroArt className="login-illo" />
          <p className="login-quote">"A life without a cause is a life without an effect."</p>
        </div>
        <div className="login-form">
        <p className="eyebrow">GradeX · Street Cause VNRVJIET</p>
        <h1>Sign in</h1>
        <p className="muted">Tasks, submissions and scores for the club, from the EB to every team.</p>

        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            signIn(email, password);
          }}
        >
          <label className="field">
            <span>Email</span>
            <input id="login-email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            <span>Password</span>
            <input id="login-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <ErrorNote error={error ?? notice} />
          <button className="btn btn--block btn--lg" type="submit" disabled={pending}>{pending ? "Signing in…" : <>Sign in <Icon name="arrow-r" size={17} /></>}</button>
        </form>

        {demo && (
          <div className="demo">
            <span className="eyebrow">Demo accounts</span>
            <div className="demo-row">
              {DEMO_ACCOUNTS.map((d) => (
                <button key={d.email} type="button" className="chip" disabled={pending} onClick={() => signIn(d.email, DEMO_PASSWORD)} title={`${d.who} · ${d.email}`}>
                  <Icon name="user" size={15} />{d.label}
                </button>
              ))}
            </div>
            <p className="small muted">Password <code>password123</code>. To try a first sign-in, use <code>newvolunteer@example.com</code>.</p>
          </div>
        )}
        </div>
      </section>
    </main>
  );
}
