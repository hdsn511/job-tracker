/**
 * Inline icons on lucide's 24x24 grid at the handoff's 2.6 stroke weight.
 * Inline rather than lucide-react so the stroke width and the dashed
 * "Interviewing" circle stay exactly as designed.
 */

function Stroke({ size = 15, children, ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

/** The badge/chip glyph: a ring plus an optional inner mark per stage. */
export function StageIcon({ dash, path, size = 15 }) {
  return (
    <Stroke size={size}>
      <circle cx="12" cy="12" r="10" strokeDasharray={dash || undefined} />
      {path ? <path d={path} /> : null}
    </Stroke>
  );
}

export function RefreshIcon({ size = 15, className }) {
  return (
    <Stroke size={size} className={className}>
      <path d="M21 12a9 9 0 1 1-3.5-7.1" />
      <path d="M21 3.5V9h-5.5" />
    </Stroke>
  );
}

export function LogOutIcon({ size = 15 }) {
  return (
    <Stroke size={size}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </Stroke>
  );
}

export function MailIcon({ size = 15 }) {
  return (
    <Stroke size={size}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m2.5 6.5 9.5 6.5 9.5-6.5" />
    </Stroke>
  );
}

export function LogoMark() {
  return (
    <div className="jt-logo-mark">
      <svg
        width="19"
        height="19"
        viewBox="0 0 24 24"
        fill="none"
        stroke="oklch(0.99 0.01 300)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4 19V5" />
        <path d="M4 13h6l3-5 3 8 4-6" />
      </svg>
    </div>
  );
}

export function Wordmark() {
  return (
    <div className="jt-logo">
      <LogoMark />
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <div className="jt-wordmark">jobtrak</div>
        <div className="jt-sublabel">inbox &rarr; pipeline</div>
      </div>
    </div>
  );
}
