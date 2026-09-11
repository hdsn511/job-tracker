import { useEffect, useRef, useState } from "react";
import { STAGES, toISODate } from "@/lib/applications";
import { StageChip } from "./dashboard/StatusBadge";

const emptyForm = () => ({
  company: "",
  title: "",
  status: "Applied",
  date: toISODate(new Date()),
  notes: "",
});

/**
 * Add / edit dialog. `application` null means "add"; otherwise the fields
 * are seeded from the row being edited.
 */
export default function ApplicationModal({ open, application, onClose, onSave, saving }) {
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const firstFieldRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setError("");
    setForm(
      application
        ? {
            company: application.company,
            title: application.title === "Unknown title" ? "" : application.title,
            status: application.status,
            date: application.date || toISODate(new Date()),
            notes: application.notes || "",
          }
        : emptyForm(),
    );
    firstFieldRef.current?.focus();
  }, [open, application]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const update = (field) => (event) => setForm((prev) => ({ ...prev, [field]: event.target.value }));

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!form.company.trim()) {
      setError("Company is required.");
      return;
    }
    onSave({ ...form, company: form.company.trim(), title: form.title.trim() });
  };

  return (
    <div
      className="jt-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        className="jt-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={application ? "Edit application" : "Add application"}
        onSubmit={handleSubmit}
      >
        <div className="jt-dialog-head">
          <div className="jt-dialog-title">
            {application ? (
              <>
                Edit <em>application</em>
              </>
            ) : (
              <>
                Add an <em>application</em>
              </>
            )}
          </div>
          <button type="button" className="jt-dialog-close" aria-label="Close" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="jt-dialog-fields">
          <div className="jt-field">
            <label htmlFor="jt-company">Company</label>
            <input
              id="jt-company"
              ref={firstFieldRef}
              className="jt-input"
              value={form.company}
              onChange={update("company")}
              placeholder="Acme Corp"
            />
          </div>

          <div className="jt-field">
            <label htmlFor="jt-role">Role</label>
            <input
              id="jt-role"
              className="jt-input"
              value={form.title}
              onChange={update("title")}
              placeholder="Software Engineer, New Grad"
            />
          </div>

          <div className="jt-dialog-split">
            <div className="jt-field">
              <label htmlFor="jt-stage">Stage</label>
              <div className="jt-chip-row" id="jt-stage">
                {STAGES.map((stage) => (
                  <StageChip
                    key={stage}
                    status={stage}
                    selected={form.status === stage}
                    onClick={() => setForm((prev) => ({ ...prev, status: stage }))}
                  />
                ))}
              </div>
            </div>

            <div className="jt-field">
              <label htmlFor="jt-date">Applied</label>
              <input
                id="jt-date"
                type="date"
                className="jt-input"
                value={form.date}
                onChange={update("date")}
              />
            </div>
          </div>

          <div className="jt-field">
            <label htmlFor="jt-notes">{application ? "Timeline" : "Notes"}</label>
            <textarea
              id="jt-notes"
              className="jt-input jt-notes-textarea"
              value={form.notes}
              onChange={update("notes")}
              placeholder={
                application
                  ? "One event per line, e.g. [2026-09-02] Applied"
                  : "Referred by Dana; recruiter said decisions in two weeks."
              }
            />
            {application ? (
              <span className="jt-hint">
                This is the full timeline, editable directly — remove a wrong line (a stage that
                never actually happened) or fix one by hand. Saving any change here stops future
                syncs from touching this application&apos;s stage, title, or timeline automatically;
                you&apos;re the source of truth for it from here on.
              </span>
            ) : null}
          </div>

          {error ? <div className="jt-notice">{error}</div> : null}
        </div>

        <div className="jt-dialog-foot">
          <button type="button" className="jt-btn jt-btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="jt-btn jt-btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
