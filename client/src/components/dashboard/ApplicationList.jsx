import { formatShort } from "@/lib/applications";
import { StatusBadge } from "./StatusBadge";

export default function ApplicationList({ apps, selectedId, onSelect, emptyState }) {
  if (!apps.length) {
    return (
      <div className="jt-list">
        <div className="jt-empty">
          <span className="jt-empty-title">{emptyState.title}</span>
          <span className="jt-empty-note">{emptyState.note}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="jt-list" role="listbox" aria-label="Applications">
      {apps.map((app) => (
        <button
          key={app.id}
          type="button"
          role="option"
          className="jt-row"
          aria-selected={app.id === selectedId}
          onClick={() => onSelect(app.id)}
        >
          <span className="jt-row-bar" />
          <span className="jt-row-text">
            <span className="jt-row-company">{app.company}</span>
            <span className="jt-row-title">{app.title}</span>
          </span>
          <StatusBadge status={app.status} />
          <span className="jt-row-date">{formatShort(app.date)}</span>
        </button>
      ))}
    </div>
  );
}
