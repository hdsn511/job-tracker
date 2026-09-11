import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import ApplicationModal from "@/components/ApplicationModal";
import DeleteAccountModal from "@/components/DeleteAccountModal";
import ActivityRow from "@/components/dashboard/ActivityRow";
import ApplicationList from "@/components/dashboard/ApplicationList";
import DetailPanel from "@/components/dashboard/DetailPanel";
import FunnelPanel from "@/components/dashboard/FunnelPanel";
import Rail from "@/components/dashboard/Rail";
import VineDivider from "@/components/VineDivider";
import { api, clearAuthed } from "@/lib/api";
import {
  buildSankey,
  formatLong,
  parsedEventCount,
  relativeTime,
  sortByDateDesc,
  stageCounts,
  toApplication,
  toISODate,
} from "@/lib/applications";
import "@/styles/jobtrak.css";

/** Manual edits join the same parsed timeline the sync writer appends to. */
function noteLine(text, date = toISODate(new Date())) {
  return `[${date}] ${text}`;
}

export default function Dashboard() {
  const navigate = useNavigate();

  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("All");
  const [dayFilter, setDayFilter] = useState(null); // ISO date, from the calendar
  const [pathFilterId, setPathFilterId] = useState(null); // sankey link id, from the funnel
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [gmail, setGmail] = useState({ connected: false, lastSyncedAt: null });
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState(null); // { tone, text }
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);

  const handleFailure = useCallback(
    (error) => {
      if (error?.unauthorized) {
        clearAuthed();
        navigate("/", { replace: true });
        return;
      }
      setNotice({ tone: "bad", text: error?.message || "Something went wrong." });
    },
    [navigate],
  );

  const loadJobs = useCallback(async () => {
    const rows = await api("/jobs");
    setApps(sortByDateDesc(rows.map(toApplication)));
  }, []);

  const loadGmail = useCallback(async () => {
    setGmail(await api("/auth/gmail/status"));
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await Promise.all([loadJobs(), loadGmail()]);
      } catch (error) {
        if (!cancelled) handleFailure(error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadJobs, loadGmail, handleFailure]);

  // The Gmail OAuth callback bounces the browser back here with a result in
  // the query string; show it once, then clean the URL.
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("gmail");
    if (result !== "connected" && result !== "error") return;
    setNotice(
      result === "connected"
        ? { tone: "good", text: "Gmail connected. Resync to pull in your applications." }
        : { tone: "bad", text: "Couldn't connect Gmail. Please try again." },
    );
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  const counts = useMemo(() => stageCounts(apps), [apps]);

  // Computed here rather than inside FunnelPanel so a ribbon click can
  // filter this same `apps` list — see FunnelPanel's own comment on why
  // that keeps the filter self-correcting as apps change.
  const sankey = useMemo(() => buildSankey(apps), [apps]);
  const pathFilterLink = pathFilterId ? sankey.links.find((link) => link.id === pathFilterId) : null;

  // A path whose count dropped to zero (every app that was on it got
  // edited off) stops existing in `sankey.links` entirely rather than
  // lingering as an empty selection.
  useEffect(() => {
    if (pathFilterId && !pathFilterLink) setPathFilterId(null);
  }, [pathFilterId, pathFilterLink]);

  const handleSelectLink = (link) => setPathFilterId((current) => (current === link.id ? null : link.id));

  // Stage, day, path and search all compose — each one narrows whatever the
  // others already show rather than resetting them, the same way stage+day
  // already did before path/search existed.
  const visible = useMemo(() => {
    let result = filter === "All" ? apps : apps.filter((app) => app.status === filter);
    if (dayFilter) result = result.filter((app) => app.date === dayFilter);
    if (pathFilterLink) {
      const ids = new Set(pathFilterLink.appIds);
      result = result.filter((app) => ids.has(app.id));
    }
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (app) => app.company.toLowerCase().includes(q) || app.title.toLowerCase().includes(q),
      );
    }
    return result;
  }, [apps, filter, dayFilter, pathFilterLink, search]);

  // Keep a valid selection as the filter narrows or rows come and go.
  useEffect(() => {
    if (visible.some((app) => app.id === selectedId)) return;
    setSelectedId(visible.length ? visible[0].id : null);
  }, [visible, selectedId]);

  const selected = apps.find((app) => app.id === selectedId) || null;

  /** Optimistic write: patch locally, then reconcile with the server row. */
  const patchApp = async (id, body) => {
    const previous = apps;
    setBusy(true);
    setApps((current) =>
      current.map((app) => (app.id === id ? toApplication({ ...toRow(app), ...body }) : app)),
    );
    try {
      const row = await api(`/jobs/${id}`, { method: "PUT", body });
      setApps((current) =>
        sortByDateDesc(current.map((app) => (app.id === id ? toApplication(row) : app))),
      );
    } catch (error) {
      setApps(previous);
      handleFailure(error);
    } finally {
      setBusy(false);
    }
  };

  const handleStageChange = (id, status) => patchApp(id, { status });

  const handleArchive = async (app) => {
    const previous = apps;
    setBusy(true);
    setApps((current) => current.filter((item) => item.id !== app.id));
    try {
      await api(`/jobs/${app.id}`, { method: "PUT", body: { archived: true } });
      setNotice({ tone: "good", text: `Archived ${app.company}.` });
    } catch (error) {
      setApps(previous);
      handleFailure(error);
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async (form) => {
    setSaving(true);
    try {
      if (editing) {
        // Full replace, not an append: the timeline field in the modal now
        // shows (and lets the user edit) the whole thing, specifically so a
        // wrong line -- a stage that never really happened -- can be
        // removed, not just added to.
        const row = await api(`/jobs/${editing.id}`, {
          method: "PUT",
          body: {
            company_name: form.company,
            job_title: form.title || "Unknown title",
            status: form.status,
            application_date: form.date,
            notes: form.notes,
          },
        });
        setApps((current) =>
          sortByDateDesc(current.map((app) => (app.id === editing.id ? toApplication(row) : app))),
        );
      } else {
        const notes = [noteLine("Added manually", form.date), form.notes.trim()]
          .filter(Boolean)
          .join("\n");
        const row = await api("/jobs", {
          method: "POST",
          body: {
            company_name: form.company,
            job_title: form.title || "Unknown title",
            status: form.status,
            application_date: form.date,
            notes,
          },
        });
        const created = toApplication(row);
        setApps((current) => sortByDateDesc([created, ...current]));
        // Clear both filters, or a new row can land outside the current view.
        setFilter("All");
        setDayFilter(null);
        setSelectedId(created.id);
      }
      setModalOpen(false);
      setEditing(null);
    } catch (error) {
      handleFailure(error);
    } finally {
      setSaving(false);
    }
  };

  /**
   * e.g. "12 new, 3 updated (via gemini)" / "... (no LLM configured — rules only)"
   *
   * A message that matched a known company but that neither engine could
   * stage is dropped silently by sync/index.js — no job, no timeline note,
   * nothing — so needsReview/llmFailed are surfaced here even though there's
   * no screen yet to go inspect *which* messages those were. A visible flag
   * beats a number nobody ever sees.
   */
  const syncSummaryText = (summary) => {
    const counts = `${summary.inserted} new, ${summary.updated} updated`;
    const flags = [];
    if (summary.needsReview) flags.push(`${summary.needsReview} needs review`);
    if (summary.llmFailed) flags.push(`${summary.llmFailed} LLM call${summary.llmFailed === 1 ? "" : "s"} failed`);
    const engine = summary.llmProvider
      ? `via ${summary.llmProvider}`
      : "no LLM configured — rules only";
    return flags.length ? `${counts}, ${flags.join(", ")} (${engine})` : `${counts} (${engine})`;
  };

  const handleResync = async () => {
    setSyncing(true);
    setNotice(null);
    try {
      const { summary } = await api("/auth/gmail/sync", { method: "POST" });
      await Promise.all([loadJobs(), loadGmail()]);
      setNotice({ tone: "good", text: `Sync done — ${syncSummaryText(summary)}.` });
    } catch (error) {
      handleFailure(error);
    } finally {
      setSyncing(false);
    }
  };

  // The sync is always a re-read of the whole window back to this date, not
  // "since last time" — so narrowing/widening it here takes effect on the
  // very next sync, without disconnecting and reconnecting. It does NOT
  // retroactively remove jobs already created from messages now outside a
  // narrowed window; those stay until archived or deleted by hand.
  const handleChangeSyncStart = async (newDate) => {
    setSyncing(true);
    setNotice(null);
    try {
      const { summary } = await api("/auth/gmail/sync", {
        method: "POST",
        body: { startDate: newDate },
      });
      await Promise.all([loadJobs(), loadGmail()]);
      setNotice({
        tone: "good",
        text: `Sync window updated to ${newDate} — ${syncSummaryText(summary)}.`,
      });
    } catch (error) {
      handleFailure(error);
    } finally {
      setSyncing(false);
    }
  };

  const handleConnectGmail = () => navigate("/connect");

  const handleOpenBackfill = () => navigate("/backfill");

  const handleDisconnectGmail = async () => {
    if (!window.confirm("Disconnect Gmail? You can reconnect any time.")) return;
    try {
      await api("/auth/gmail/disconnect", { method: "DELETE" });
      await loadGmail();
      setNotice({ tone: "good", text: "Gmail disconnected." });
    } catch (error) {
      handleFailure(error);
    }
  };

  const handleLogout = async () => {
    // Best-effort: even if the network call fails, drop the local hint and
    // send the user back — a stale cookie with no local "authed" flag just
    // means the next request 401s and they're bounced to login anyway.
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      // ignore
    }
    clearAuthed();
    navigate("/", { replace: true });
  };

  const confirmDeleteAccount = async (password) => {
    await api("/auth/account", { method: "DELETE", body: { password } });
    clearAuthed();
    navigate("/", { replace: true });
  };

  return (
    <div className="jt-page">
      <div className="jt-shell">
        <Rail
          counts={counts}
          filter={filter}
          onFilterChange={setFilter}
          search={search}
          onSearchChange={setSearch}
          gmailConnected={gmail.connected}
          syncLabel={relativeTime(gmail.lastSyncedAt)}
          syncStartDate={gmail.syncStartDate}
          maxLookbackDays={gmail.maxLookbackDays}
          parsedCount={parsedEventCount(apps)}
          syncing={syncing}
          onResync={handleResync}
          onChangeSyncStart={handleChangeSyncStart}
          onConnectGmail={handleConnectGmail}
          onDisconnectGmail={handleDisconnectGmail}
          onOpenBackfill={handleOpenBackfill}
          onLogout={handleLogout}
          onDeleteAccount={() => setDeleteAccountOpen(true)}
          onAddApplication={() => {
            setEditing(null);
            setModalOpen(true);
          }}
        />

        <main className="jt-main">
          {notice ? (
            <button
              type="button"
              className={`jt-banner jt-notice${notice.tone === "good" ? " is-good" : ""}`}
              onClick={() => setNotice(null)}
              title="Dismiss"
            >
              {notice.text}
            </button>
          ) : null}

          <div className={`jt-funnel-section${apps.length ? "" : " is-empty"}`}>
            <div className="jt-funnel-head">
              <h1 className="jt-funnel-title">
                Your <em>pipeline</em>
              </h1>
              <span className="jt-label">
                {/* Both stages, not their sum: "interviewing" means a human
                    conversation now that assessments have their own stage,
                    so folding the two together would overstate it. */}
                {apps.length} tracked &middot; {counts.Assessment} in assessment &middot;{" "}
                {counts.Interviewing} interviewing
              </span>
            </div>
            <FunnelPanel
              nodes={sankey.nodes}
              links={sankey.links}
              selectedLinkId={pathFilterId}
              onSelectLink={handleSelectLink}
            />
          </div>

          <ActivityRow apps={apps} selectedDate={dayFilter} onSelectDate={setDayFilter} />

          <div className="jt-section-rule">
            <VineDivider />
          </div>

          {pathFilterLink ? (
            <div className="jt-filter-bar">
              <span>
                Showing <strong>{pathFilterLink.label}</strong> &middot; {visible.length}{" "}
                {visible.length === 1 ? "application" : "applications"}
              </span>
              <button type="button" className="jt-filter-clear" onClick={() => setPathFilterId(null)}>
                Show all
              </button>
            </div>
          ) : null}

          {dayFilter ? (
            <div className="jt-filter-bar">
              <span>
                Showing <strong>{formatLong(dayFilter)}</strong> &middot; {visible.length}{" "}
                {visible.length === 1 ? "application" : "applications"}
              </span>
              <button type="button" className="jt-filter-clear" onClick={() => setDayFilter(null)}>
                Show all
              </button>
            </div>
          ) : null}

          <div className="jt-body">
            <ApplicationList
              apps={visible}
              selectedId={selectedId}
              onSelect={setSelectedId}
              emptyState={
                loading
                  ? { title: "Loading applications…", note: "" }
                  : apps.length
                    ? {
                        title: search.trim() ? (
                          <>
                            No matches for <em>&ldquo;{search.trim()}&rdquo;</em>
                          </>
                        ) : pathFilterLink ? (
                          <>
                            Nothing on <em>{pathFilterLink.label}</em>
                          </>
                        ) : dayFilter ? (
                          <>
                            Nothing on <em>{formatLong(dayFilter)}</em>
                          </>
                        ) : (
                          <>
                            No <em>{filter.toLowerCase()}</em> applications
                          </>
                        ),
                        note:
                          search.trim() || pathFilterLink || dayFilter
                            ? "Try clearing a filter above to see more."
                            : "Pick another stage in the rail to see the rest of the pipeline.",
                      }
                    : {
                        title: (
                          <>
                            Nothing tracked <em>yet</em>
                          </>
                        ),
                        note: gmail.connected
                          ? "Resync your inbox to pull in application emails, or add one by hand."
                          : "Connect Gmail to pull applications out of your inbox, or add one by hand."
                      }
              }
            />
            <DetailPanel
              app={selected}
              busy={busy}
              onStageChange={handleStageChange}
              onEdit={(app) => {
                setEditing(app);
                setModalOpen(true);
              }}
              onArchive={handleArchive}
            />
          </div>
        </main>
      </div>

      <ApplicationModal
        open={modalOpen}
        application={editing}
        saving={saving}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onSave={handleSave}
      />

      <DeleteAccountModal
        open={deleteAccountOpen}
        onClose={() => setDeleteAccountOpen(false)}
        onConfirm={confirmDeleteAccount}
      />
    </div>
  );
}

/** Inverse of `toApplication`, for optimistic local patches. */
function toRow(app) {
  return {
    id: app.id,
    company_name: app.company,
    job_title: app.title,
    status: app.status,
    application_date: app.date,
    notes: app.notes,
    archived: app.archived,
  };
}
