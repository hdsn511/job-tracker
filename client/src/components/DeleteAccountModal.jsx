import { useEffect, useRef, useState } from "react";

/**
 * Requires the current password rather than a bare confirm — irreversible,
 * so it shouldn't be one accidental click away from a session left open on
 * a shared machine.
 */
export default function DeleteAccountModal({ open, onClose, onConfirm }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const fieldRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setPassword("");
    setError("");
    setDeleting(false);
    fieldRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!password) {
      setError("Enter your password to confirm.");
      return;
    }
    setDeleting(true);
    setError("");
    try {
      await onConfirm(password);
    } catch (err) {
      setError(err?.message || "Something went wrong. Please try again.");
      setDeleting(false);
    }
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
        aria-label="Delete account"
        onSubmit={handleSubmit}
      >
        <div className="jt-dialog-head">
          <div className="jt-dialog-title">
            Delete your <em>account</em>
          </div>
          <button type="button" className="jt-dialog-close" aria-label="Close" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="jt-dialog-fields">
          <p className="jt-sync-meta">
            This permanently deletes every tracked application, disconnects Gmail, and revokes its
            access at Google. There&rsquo;s no undo.
          </p>

          <div className="jt-field">
            <label htmlFor="jt-delete-password">Confirm with your password</label>
            <input
              id="jt-delete-password"
              ref={fieldRef}
              type="password"
              autoComplete="current-password"
              className="jt-input"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
            />
          </div>

          {error ? <div className="jt-notice">{error}</div> : null}
        </div>

        <div className="jt-dialog-foot">
          <button type="button" className="jt-btn jt-btn-ghost" onClick={onClose} disabled={deleting}>
            Cancel
          </button>
          <button type="submit" className="jt-btn jt-btn-primary" disabled={deleting}>
            {deleting ? "Deleting…" : "Delete account"}
          </button>
        </div>
      </form>
    </div>
  );
}
