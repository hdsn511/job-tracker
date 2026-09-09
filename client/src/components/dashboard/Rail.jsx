import { STAGES } from "@/lib/applications";
import { LogOutIcon, RefreshIcon, Wordmark } from "./icons";

/**
 * Left rail: identity, the stage filter, inbox status, and the account
 * actions. Resync and Log out live here rather than in a main-column header
 * row, so the main column is nothing but data.
 */
export default function Rail({
  counts,
  filter,
  onFilterChange,
  gmailConnected,
  syncLabel,
  parsedCount,
  syncing,
  onResync,
  onConnectGmail,
  onLogout,
  onAddApplication,
}) {
  return (
    <aside className="jt-rail">
      <Wordmark />

      <div className="jt-rail-group">
        <div className="jt-rail-heading">Stages</div>
        {["All", ...STAGES].map((stage) => (
          <button
            key={stage}
            type="button"
            className="jt-stage-btn"
            aria-pressed={filter === stage}
            onClick={() => onFilterChange(stage)}
          >
            <span>{stage}</span>
            <span className="jt-stage-count">{counts[stage] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="jt-rail-foot">
        <div className="jt-sync-card">
          <div className="jt-sync-head">
            <span className={`jt-sync-dot${gmailConnected ? "" : " is-off"}`} />
            {gmailConnected ? "Inbox sync on" : "Inbox sync off"}
          </div>
          {gmailConnected ? (
            <div className="jt-sync-meta">
              {syncLabel}
              <br />
              {parsedCount} events parsed
            </div>
          ) : (
            <>
              <div className="jt-sync-meta">Connect Gmail to track applications automatically.</div>
              <button type="button" className="jt-sync-link" onClick={onConnectGmail}>
                Connect Gmail
              </button>
            </>
          )}
        </div>

        <div className="jt-rail-actions">
          <button
            type="button"
            className="jt-btn jt-btn-secondary"
            onClick={onResync}
            disabled={!gmailConnected || syncing}
          >
            <RefreshIcon className={syncing ? "jt-spin" : undefined} />
            {syncing ? "Syncing…" : "Resync inbox"}
          </button>
          <button type="button" className="jt-btn jt-btn-ghost" onClick={onLogout}>
            <LogOutIcon />
            Log out
          </button>
        </div>

        <button type="button" className="jt-btn jt-btn-primary" onClick={onAddApplication}>
          Add application
        </button>
      </div>
    </aside>
  );
}
