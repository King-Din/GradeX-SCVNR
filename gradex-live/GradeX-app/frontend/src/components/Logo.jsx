/*
 * The official Street Cause logo (frontend/public/brand/, cut from the club's
 * logo files):
 * - the two hands alone, white or brand blue, as the app mark (top bars, icons);
 * - the full "17 years of street cause, we care" logo where there's room:
 *   a light-surface and a dark-surface version, plus one for the blue panels
 *   (rainbow 17 kept, hands and words in white).
 */
export function LogoMark({ size = 28, tone = "brand", className = "" }) {
  const src = tone === "white" ? "/brand/hands-white.png" : "/brand/hands-blue.png";
  return <img src={src} width={size} height={size} alt="" className={`logo-mark ${className}`.trim()} />;
}

const FULL = { width: 322, height: 360, alt: "Street Cause: we care" };

/*
 * variant "app": the hands in a blue tile + "GradeX / Street Cause VNRVJIET" (top bars).
 * variant "brand": the full Street Cause logo (sign-in and first-login screens).
 */
export default function Logo({ variant = "app", onBlue = false }) {
  if (variant === "brand") {
    return (
      <span className={`logo logo--brand${onBlue ? " logo--on-blue" : ""}`}>
        {onBlue ? (
          <img className="logo-full" src="/brand/logo-on-blue.png" {...FULL} />
        ) : (
          <>
            <img className="logo-full logo-full--light" src="/brand/logo-light.png" {...FULL} />
            <img className="logo-full logo-full--dark" src="/brand/logo-dark.png" {...FULL} />
          </>
        )}
      </span>
    );
  }
  return (
    <span className={`logo logo--app${onBlue ? " logo--on-blue" : ""}`}>
      <span className="logo-tile"><LogoMark size={30} tone="white" /></span>
      <span className="logo-words">
        <b>GradeX</b>
        <small>Street Cause VNRVJIET</small>
      </span>
    </span>
  );
}

// The greeting banner's illustration: a raised hand holding a heart, with sparkles.
export function HeroArt({ className = "" }) {
  return (
    <svg className={`hero-art ${className}`.trim()} viewBox="0 0 290 200" aria-hidden="true" focusable="false">
      <circle cx="200" cy="96" r="78" fill="rgb(255 255 255 / 0.08)" />
      <circle cx="200" cy="96" r="52" fill="rgb(255 255 255 / 0.08)" />
      <g transform="translate(140 40)">
        <path d="M60 116c-14-8-30-22-36-44L16 40c-1.6-5 1.4-9.6 6-10.6 4.5-.9 8.6 1.9 9.8 6.3L38 56l2-.8-13-42c-1.5-4.8 1-9.4 5.6-10.8 4.4-1.4 8.8 1 10.4 5.4l12 34 2.5-.6-7-43c-.8-4.6 2.3-8.8 6.9-9.6 4.6-.7 8.6 2.4 9.5 7l7 40.4h2.4l4-35c.6-4.6 4.4-8 9-7.6 4.6.4 7.6 4.3 7.3 8.9L95 76v26c0 9-4 16-10 20z" fill="#FFB627" />
        <path d="M82 22c3-6 11-7 15-2 4-5 12-4 15 2 3 7-3 14-15 22-12-8-18-15-15-22z" fill="#F0656B" transform="translate(-30 -10) scale(.9)" />
      </g>
      <g fill="#fff" opacity=".9">
        <path d="M60 40l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" />
        <path d="M110 150l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" opacity=".7" />
        <circle cx="270" cy="30" r="3" />
        <circle cx="96" cy="86" r="2.5" opacity=".6" />
      </g>
    </svg>
  );
}

// Hand-drawn marigold underline for one phrase of a heading.
export function Underline({ children }) {
  return (
    <span className="underline">
      {children}
      <svg viewBox="0 0 200 14" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path d="M3 9c40-6 90-8 194-3" stroke="#FFB627" strokeWidth="5" fill="none" strokeLinecap="round" />
      </svg>
    </span>
  );
}
