import { BADGE } from "@/lib/applications";
import { StageIcon } from "./icons";

/** Read-only pill used in the application list. */
export function StatusBadge({ status }) {
  const tone = BADGE[status] || BADGE.Applied;
  return (
    <span
      className="jt-badge"
      style={{ background: tone.bg, color: tone.fg, border: `1px solid ${tone.bd}` }}
    >
      <StageIcon dash={tone.dash} path={tone.path} />
      {status}
    </span>
  );
}

/**
 * The same palette as a toggle — used for the detail panel's stage picker
 * and the add/edit form. Unselected chips drop back to a plain stone outline.
 */
export function StageChip({ status, selected, onClick, disabled }) {
  const tone = BADGE[status] || BADGE.Applied;
  return (
    <button
      type="button"
      className="jt-chip"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      style={{
        background: selected ? tone.bg : "transparent",
        color: selected ? tone.fg : "var(--jt-ink-3)",
        border: `1px solid ${selected ? tone.bd : "var(--jt-border-strong)"}`,
      }}
    >
      <StageIcon dash={tone.dash} path={tone.path} size={14} />
      {status}
    </button>
  );
}
