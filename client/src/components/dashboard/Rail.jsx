import { useEffect, useState } from "react";
import { STAGES } from "@/lib/applications";
import { LogOutIcon, RefreshIcon, UploadIcon, Wordmark } from "./icons";

/** YYYY-MM-DD, `days` before today — mirrors the same helper in ConnectGmail. */
function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

/**
 * Left rail: identity, the stage filter, inbox status, and the account
 * actions. Resync and Log out live here rather than in a main-column header
 * row, so the main column is nothing but data.
 *
 * The outer column carries the background so it spans the full shell; the
 * inner <aside> is what sticks as the page scrolls past a long list.
 */
export default function Rail({
  counts,
  filter,
  onFilterChange,
  gmailConnected,
  syncLabel,
  syncStartDate,
  maxLookbackDays = 730,
  parsedCount,
  syncing,
  onResync,
  onChangeSyncStart,
  onConnectGmail,
  onDisconnectGmail,
  onOpenBackfill,
  onLogout,
  onDeleteAccount,
  onAddApplication,
}) {
  // The sync is a re-read of the whole window every time, not "since last
  // run" — so this is the one control that lets someone narrow/widen it
  // without disconnecting and reconnecting.
  const [startInput, setStartInput] = useState(syncStartDate || "");

  useEffect(() => {
    setStartInput(syncStartDate || "");
  }, [syncStartDate]);

  const startChanged = Boolean(startInput) && startInput !== syncStartDate;

  return (
    <div className="jt-rail-col">
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
          <button type="button" className="jt-btn jt-btn-primary" onClick={onAddApplication}>
            Add application
          </button>

          <div className="jt-sync-card">
            <div className="jt-sync-head">
              <span className={`jt-sync-dot${gmailConnected ? "" : " is-off"}`} />
              {gmailConnected ? "Inbox sync on" : "Inbox sync off"}
            </div>
            {gmailConnected ? (
              <>
                <div className="jt-sync-meta">
                  {syncLabel}
                  <br />
                  {parsedCount} events parsed
                </div>

                <label className="jt-since-field">
                  <span className="jt-label">Syncing since</span>
                  <input
                    type="date"
                    className="jt-input"
                    value={startInput}
                    min={isoDaysAgo(maxLookbackDays)}
                    max={isoDaysAgo(0)}
                    onChange={(event) => setStartInput(event.target.value)}
                    disabled={syncing}
                  />
                </label>
                {startChanged ? (
                  <span className="jt-hint">
                    Takes effect on the next sync. Applications already tracked from before this
                    date aren&rsquo;t removed — archive or delete those by hand.
                  </span>
                ) : null}

                <div className="jt-rail-actions">
                  {startChanged ? (
                    <button
                      type="button"
                      className="jt-sync-link"
                      onClick={() => onChangeSyncStart(startInput)}
                      disabled={syncing}
                    >
                      {syncing ? "Updating…" : "Save & resync"}
                    </button>
                  ) : null}
                  <button type="button" className="jt-sync-link" onClick={onDisconnectGmail}>
                    Disconnect Gmail
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="jt-sync-meta">
                  Connect Gmail to track applications automatically.
                </div>
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
            {/* Available either way -- a resync re-reads an OAuth account's
                own window, but backfilling further back (or filling a
                forwarding-only account's history, which has no window to
                re-read at all) goes through the upload flow instead. */}
            <button type="button" className="jt-btn jt-btn-ghost" onClick={onOpenBackfill}>
              <UploadIcon />
              Backfill history
            </button>
            <button type="button" className="jt-btn jt-btn-ghost" onClick={onLogout}>
              <LogOutIcon />
              Log out
            </button>
          </div>

          <button type="button" className="jt-btn-danger-text" onClick={onDeleteAccount}>
            Delete account
          </button>
        </div>
      </aside>
    </div>
  );
}
