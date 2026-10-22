import { initials, ROLE_LABEL } from "../format.js";
import Icon from "./Icon.jsx";
import Logo from "./Logo.jsx";

const ICON = { people: "users", tasks: "tasks", review: "inbox", board: "trophy", accounts: "user-plus" };

/*
 * Staff navigation. Laptop/tablet: one top bar with the logo, a pill nav and
 * the person's chip. Phones (≤760px): the same pill items become a bottom
 * tab bar, so every page stays one tap away.
 */
export default function Rail({ items, active, onNavigate, user, onSignOut, onPassword, domainName, roleLabel }) {
  const roleLine = [domainName, roleLabel ?? ROLE_LABEL[user.role]].filter(Boolean).join(" · ");
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Logo />
        <nav className="pills" aria-label="Main">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`pill${active === item.key ? " is-active" : ""}`}
              onClick={() => onNavigate(item.key)}
              aria-label={item.badge > 0 ? `${item.label} (${item.badge} waiting)` : item.label}
              aria-current={active === item.key ? "page" : undefined}
            >
              <Icon name={ICON[item.icon] ?? item.icon} size={17} />
              <span className="pill-label">{item.label}</span>
              {item.badge > 0 && <em className="pill-badge" aria-hidden="true">{item.badge}</em>}
            </button>
          ))}
        </nav>
        <div className="topbar-end">
          <span className="me" title={`${user.name} · ${user.email}`}>
            <span className="me-av" aria-hidden="true">{initials(user.name)}</span>
            <span className="me-text"><b>{user.name}</b><small>{roleLine}</small></span>
          </span>
          <button type="button" className="circ" onClick={onPassword} aria-label="Change your password" title="Change your password">
            <Icon name="key" />
          </button>
          <button type="button" className="circ" onClick={onSignOut} aria-label="Sign out" title="Sign out">
            <Icon name="logout" />
          </button>
        </div>
      </div>
    </header>
  );
}
