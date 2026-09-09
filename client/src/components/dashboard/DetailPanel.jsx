import { STAGES, cleanEventText, daysSince, formatLong } from "@/lib/applications";
import { StageChip } from "./StatusBadge";

export default function DetailPanel({ app, onStageChange, onEdit, onArchive, busy }) {
  if (!app) {
    return (
      <aside className="jt-detail">
        <div className="jt-detail-section">
          <div className="jt-label">Selected</div>
          <div className="jt-auth-sub">
            Pick an application from the list to see its parsed timeline.
          </div>
        </div>
      </aside>
    );
  }

  const age = daysSince(app.date);

  return (
    <aside className="jt-detail">
      <div className="jt-detail-section" style={{ gap: 7 }}>
        <div className="jt-label">Selected</div>
        <div className="jt-detail-company">{app.company}</div>
        <div className="jt-detail-role">{app.title}</div>
        {app.date ? (
          <div className="jt-detail-meta">
            applied {formatLong(app.date)} &middot; day {age}
          </div>
        ) : null}
      </div>

      <div className="jt-detail-section">
        <div className="jt-label">Stage</div>
        <div className="jt-chip-row">
          {STAGES.map((stage) => (
            <StageChip
              key={stage}
              status={stage}
              selected={app.status === stage}
              disabled={busy}
              onClick={() => onStageChange(app.id, stage)}
            />
          ))}
        </div>
      </div>

      <div className="jt-detail-section" style={{ gap: 11 }}>
        <div className="jt-label">Timeline &middot; parsed from inbox</div>
        {app.events.length ? (
          <div className="jt-timeline">
            {app.events.map((event) => (
              <div key={event.key} className="jt-timeline-item">
                <span className="jt-timeline-date">{event.date}</span>
                <span className="jt-timeline-text">{cleanEventText(event.text)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="jt-auth-sub">Nothing parsed for this application yet.</div>
        )}
      </div>

      <div className="jt-detail-foot">
        <button type="button" className="jt-btn jt-btn-panel" onClick={() => onEdit(app)}>
          Edit details
        </button>
        <button
          type="button"
          className="jt-btn-danger-text"
          disabled={busy}
          onClick={() => onArchive(app)}
        >
          Archive application
        </button>
      </div>
    </aside>
  );
}
