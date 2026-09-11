import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { UploadIcon, Wordmark } from "@/components/dashboard/icons";
import VineDivider from "@/components/VineDivider";
import { api, clearAuthed } from "@/lib/api";
import { MboxParseError, parseMboxFile } from "@/lib/mbox";
import "@/styles/jobtrak.css";

/** YYYY-MM-DD, `days` before today — mirrors the same helper in ConnectGmail/Rail. */
function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

// Mirrors DEFAULT_LOOKBACK_DAYS / MAX_LOOKBACK_DAYS in server/sync/startDate.js.
// The server re-validates regardless — these only shape the picker.
const DEFAULT_LOOKBACK_DAYS = 30;
const MAX_LOOKBACK_DAYS = 730;

// Under server/sync/inboundUploads.js's MAX_BATCH_SIZE (50), with margin.
const UPLOAD_CHUNK_SIZE = 40;

const LABEL_NAME = "jobtrak-backfill";

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size));
  return chunks;
}

const emptyTotals = { saved: 0, duplicates: 0, noise: 0, staged: 0, errors: 0 };

/**
 * Backfills history from before Gmail was connected or forwarding was set up
 * — neither path can reach mail that isn't inside its own window (OAuth) or
 * that arrived before the filter existed (forwarding). The browser parses a
 * Google Takeout mbox export entirely client-side (see lib/mbox.js); only the
 * extracted {from, subject, body, date, messageId} fields are sent to the
 * server, batched, and run through the same classify/upsert pipeline the
 * forwarding webhook already uses.
 */
export default function Backfill() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [date, setDate] = useState(() => isoDaysAgo(DEFAULT_LOOKBACK_DAYS));
  const [filterInfo, setFilterInfo] = useState(null);
  const [filterLoading, setFilterLoading] = useState(false);
  const [filterError, setFilterError] = useState("");

  const [dragActive, setDragActive] = useState(false);
  const [fileName, setFileName] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState({ parsed: 0, total: 0 });
  const [parseError, setParseError] = useState("");
  const [parsedMessages, setParsedMessages] = useState(null);
  const [skippedCount, setSkippedCount] = useState(0);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [batches, setBatches] = useState(null); // array of message chunks, once parsed
  const [batchIndex, setBatchIndex] = useState(0);
  const [totals, setTotals] = useState(emptyTotals);
  const [done, setDone] = useState(false);

  const handleAuthFailure = (error) => {
    if (error?.unauthorized) {
      clearAuthed();
      navigate("/", { replace: true });
      return true;
    }
    return false;
  };

  const handleGetFilterLink = async () => {
    setFilterLoading(true);
    setFilterError("");
    try {
      const data = await api(`/api/inbound/backfill-filter-url?after=${encodeURIComponent(date)}`);
      setFilterInfo(data);
    } catch (error) {
      if (handleAuthFailure(error)) return;
      setFilterError(error.message);
    } finally {
      setFilterLoading(false);
    }
  };

  const resetFileState = () => {
    setParseError("");
    setParsedMessages(null);
    setSkippedCount(0);
    setBatches(null);
    setBatchIndex(0);
    setTotals(emptyTotals);
    setUploadError("");
    setDone(false);
  };

  const runParse = async (file) => {
    resetFileState();
    setFileName(file.name);
    setParsing(true);
    setParseProgress({ parsed: 0, total: 0 });
    try {
      const { messages, skippedCount: skipped } = await parseMboxFile(file, {
        onProgress: (parsed, total) => setParseProgress({ parsed, total }),
      });
      setParsedMessages(messages);
      setSkippedCount(skipped);
      setBatches(chunk(messages, UPLOAD_CHUNK_SIZE));
    } catch (error) {
      setParseError(
        error instanceof MboxParseError ? error.message : "Could not read that file. Please try again.",
      );
    } finally {
      setParsing(false);
    }
  };

  const handleFileSelect = (files) => {
    const file = files && files[0];
    if (!file) return;
    runParse(file);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setDragActive(false);
    if (uploading || parsing) return;
    handleFileSelect(event.dataTransfer.files);
  };

  const runUpload = async () => {
    if (!batches || batches.length === 0) return;
    setUploading(true);
    setUploadError("");
    try {
      for (let i = batchIndex; i < batches.length; i += 1) {
        const summary = await api("/api/inbound/upload-batch", {
          method: "POST",
          body: { messages: batches[i], final: i === batches.length - 1 },
        });
        setTotals((prev) => ({
          saved: prev.saved + summary.saved,
          duplicates: prev.duplicates + summary.duplicates,
          noise: prev.noise + summary.noise,
          staged: prev.staged + summary.staged,
          errors: prev.errors + summary.errors,
        }));
        setBatchIndex(i + 1);
      }
      setDone(true);
    } catch (error) {
      if (handleAuthFailure(error)) return;
      setUploadError(error.message);
    } finally {
      setUploading(false);
    }
  };

  const stagedNotice =
    parsedMessages && parsedMessages.length === 0
      ? "No usable messages were found in this file — it may not be the exported label, or every message in it was unreadable."
      : null;

  return (
    <div className="jt-auth-page">
      <div className="jt-auth-card is-wide">
        <Wordmark />

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="jt-auth-title">
            Backfill your <em>history</em>
          </div>
          <div className="jt-auth-sub">
            Add applications from before you connected — a Gmail filter (or OAuth&apos;s sync window) can
            only reach mail from the point it started. This exports that older mail from Gmail and
            parses it entirely in your browser; only the job-relevant fields are sent to jobtrak, never
            the raw file.
          </div>
        </div>

        <VineDivider />

        <div className="jt-steps">
          <div className="jt-step">
            <span className="jt-step-num">1</span>
            <span>
              Pick how far back to go.
              <label className="jt-since-field">
                <span className="jt-label">Backfill from</span>
                <input
                  type="date"
                  className="jt-input"
                  value={date}
                  min={isoDaysAgo(MAX_LOOKBACK_DAYS)}
                  max={isoDaysAgo(0)}
                  onChange={(event) => {
                    setDate(event.target.value);
                    setFilterInfo(null);
                  }}
                  disabled={filterLoading}
                />
              </label>
              <button
                type="button"
                className="jt-btn jt-btn-secondary"
                onClick={handleGetFilterLink}
                disabled={filterLoading}
                style={{ marginTop: 8 }}
              >
                {filterLoading ? "Loading…" : "Get my Gmail filter link"}
              </button>
              {filterError ? <div className="jt-notice">{filterError}</div> : null}
            </span>
          </div>

          {filterInfo ? (
            <>
              <div className="jt-step">
                <span className="jt-step-num">2</span>
                <span>
                  <a
                    href={filterInfo.gmailFilterUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="jt-btn jt-btn-primary"
                    style={{ textDecoration: "none", display: "inline-flex", marginBottom: 8 }}
                  >
                    Open Gmail with the search criteria
                  </a>
                  <br />
                  Click the <strong>show search options</strong> icon (sliders, right of the search
                  bar), then <strong>Create filter</strong>. Check <strong>Apply the label</strong>,
                  choose <strong>New label</strong> and name it something like{" "}
                  <code>{LABEL_NAME}</code>, then check{" "}
                  <strong>Also apply filter to matching conversations</strong> — that last box is what
                  labels your existing mail, not just future mail.
                </span>
              </div>
              <div className="jt-step">
                <span className="jt-step-num">3</span>
                <span>
                  Go to{" "}
                  <a href="https://takeout.google.com/settings/takeout" target="_blank" rel="noreferrer">
                    Google Takeout
                  </a>
                  , deselect all products, select only <strong>Mail</strong>, click{" "}
                  <strong>All Mail data included</strong> and choose just the{" "}
                  <code>{LABEL_NAME}</code> label, then export. Download the <code>.mbox</code> file
                  from the export when it&apos;s ready.
                </span>
              </div>
              <div className="jt-step">
                <span className="jt-step-num">4</span>
                <span>Upload that file below.</span>
              </div>
            </>
          ) : null}
        </div>

        {filterInfo ? (
          <>
            <VineDivider />

            <div
              className={`jt-dropzone${dragActive ? " is-active" : ""}`}
              onClick={() => !uploading && !parsing && fileInputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
            >
              <UploadIcon size={22} />
              <div>{fileName || "Drop your .mbox file here, or click to choose one"}</div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".mbox"
                onChange={(event) => handleFileSelect(event.target.files)}
                disabled={uploading || parsing}
              />
            </div>

            {parsing ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div className="jt-hint">
                  Parsing {parseProgress.parsed} of {parseProgress.total || "…"} messages — this stays
                  on your device.
                </div>
                <div className="jt-progress">
                  <div
                    className="jt-progress-bar"
                    style={{
                      width: `${parseProgress.total ? (100 * parseProgress.parsed) / parseProgress.total : 0}%`,
                    }}
                  />
                </div>
              </div>
            ) : null}

            {parseError ? <div className="jt-notice">{parseError}</div> : null}
            {stagedNotice ? <div className="jt-notice">{stagedNotice}</div> : null}

            {parsedMessages && parsedMessages.length > 0 && !done ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div className="jt-hint">
                  Found {parsedMessages.length} message{parsedMessages.length === 1 ? "" : "s"}
                  {skippedCount > 0 ? ` (${skippedCount} unreadable, skipped)` : ""}. Nothing is sent
                  until you click below.
                </div>

                {uploading ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div className="jt-hint">
                      Uploading batch {Math.min(batchIndex + 1, batches.length)} of {batches.length}…
                    </div>
                    <div className="jt-progress">
                      <div
                        className="jt-progress-bar"
                        style={{ width: `${(100 * batchIndex) / batches.length}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <button type="button" className="jt-btn jt-btn-primary" onClick={runUpload}>
                    {batchIndex > 0 ? "Resume upload" : "Start upload"}
                  </button>
                )}

                {uploadError ? (
                  <div className="jt-notice">
                    {uploadError} Already-uploaded messages are safe — click below to pick up where
                    this left off.
                  </div>
                ) : null}
              </div>
            ) : null}

            {done ? (
              <div className="jt-notice is-good">
                Done. {totals.staged} application{totals.staged === 1 ? "" : "s"} worth of mail found
                and added to your pipeline
                {totals.duplicates > 0 ? `, ${totals.duplicates} already had a copy on file` : ""}
                {totals.errors > 0 ? `, ${totals.errors} couldn't be processed` : ""}.
              </div>
            ) : null}
          </>
        ) : null}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {done ? (
            <button type="button" className="jt-btn jt-btn-primary" onClick={() => navigate("/dashboard")}>
              Go to dashboard
            </button>
          ) : (
            <button type="button" className="jt-btn jt-btn-ghost" onClick={() => navigate("/dashboard")}>
              Skip &mdash; I don&apos;t need older history
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
