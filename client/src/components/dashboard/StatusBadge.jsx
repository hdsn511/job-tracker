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
 * and the add/edit form. Unselected chips drop back to the neutral inset.
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
        background: selected ? tone.bg : "oklch(0.22 0.04 300 / 0.6)",
        color: selected ? tone.fg : "oklch(0.72 0.03 300)",
        border: `1px solid ${selected ? tone.bd : "oklch(0.32 0.045 300)"}`,
        boxShadow: selected ? "inset 0 1px 0 oklch(1 0 0 / 0.14)" : "none",
      }}
    >
      <StageIcon dash={tone.dash} path={tone.path} size={14} />
      {status}
    </button>
  );
}
