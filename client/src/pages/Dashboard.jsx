import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import ApplicationModal from "@/components/ApplicationModal";
import ActivityRow from "@/components/dashboard/ActivityRow";
import ApplicationList from "@/components/dashboard/ApplicationList";
import DetailPanel from "@/components/dashboard/DetailPanel";
import FunnelPanel from "@/components/dashboard/FunnelPanel";
import Rail from "@/components/dashboard/Rail";
import VineDivider from "@/components/VineDivider";
import { api, clearToken } from "@/lib/api";
import {
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
  const [selectedId, setSelectedId] = useState(null);
  const [gmail, setGmail] = useState({ connected: false, lastSyncedAt: null });
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState(null); // { tone, text }
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleFailure = useCallback(
    (error) => {
      if (error?.unauthorized) {
        clearToken();
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
  const visible = useMemo(
    () => (filter === "All" ? apps : apps.filter((app) => app.status === filter)),
    [apps, filter],
  );

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
        const notes = form.notes.trim()
          ? [editing.notes, noteLine(form.notes.trim())].filter(Boolean).join("\n")
          : editing.notes;
        const row = await api(`/jobs/${editing.id}`, {
          method: "PUT",
          body: {
            company_name: form.company,
            job_title: form.title || "Unknown title",
            status: form.status,
            application_date: form.date,
            notes,
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
        setFilter("All");
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

  const handleResync = async () => {
    setSyncing(true);
    setNotice(null);
    try {
      const { summary } = await api("/auth/gmail/sync", { method: "POST" });
      await Promise.all([loadJobs(), loadGmail()]);
      setNotice({
        tone: "good",
        text: `Sync done — ${summary.inserted} new, ${summary.updated} updated.`,
      });
    } catch (error) {
      handleFailure(error);
    } finally {
      setSyncing(false);
    }
  };

  const handleConnectGmail = () => navigate("/connect");

  const handleLogout = () => {
    clearToken();
    navigate("/", { replace: true });
  };

  return (
    <div className="jt-page">
      <div className="jt-shell">
        <Rail
          counts={counts}
          filter={filter}
          onFilterChange={setFilter}
          gmailConnected={gmail.connected}
          syncLabel={relativeTime(gmail.lastSyncedAt)}
          parsedCount={parsedEventCount(apps)}
          syncing={syncing}
          onResync={handleResync}
          onConnectGmail={handleConnectGmail}
          onLogout={handleLogout}
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
                {apps.length} tracked &middot; {counts.Interviewing} interviewing
              </span>
            </div>
            <FunnelPanel apps={apps} />
          </div>

          <ActivityRow apps={apps} />

          <div className="jt-section-rule">
            <VineDivider />
          </div>

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
                        title: (
                          <>
                            No <em>{filter.toLowerCase()}</em> applications
                          </>
                        ),
                        note: "Pick another stage in the rail to see the rest of the pipeline.",
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
