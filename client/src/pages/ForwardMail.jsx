import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MailIcon, Wordmark } from "@/components/dashboard/icons";
import VineDivider from "@/components/VineDivider";
import { api, clearAuthed } from "@/lib/api";
import "@/styles/jobtrak.css";

/**
 * The free alternative to /connect: forward mail to a per-user address
 * instead of granting Gmail OAuth access. Two cohorts, because the setup is
 * genuinely different:
 *  - a dedicated job-search inbox can just forward everything (100% recall,
 *    no filter criteria needed at all)
 *  - an everyday personal inbox needs a filter, since forwarding everything
 *    would also forward every personal email
 */
export default function ForwardMail() {
  const navigate = useNavigate();
  const [cohort, setCohort] = useState(null); // 'dedicated' | 'personal' | null
  const [setup, setSetup] = useState(null); // { alias, verified, confirmationLink, gmailFilterUrl }
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!cohort || setup) return;
    let cancelled = false;
    setLoading(true);
    setError("");

    api("/api/inbound/setup", { method: "POST" })
      .then((data) => {
        if (!cancelled) setSetup(data);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err.unauthorized) {
          clearAuthed();
          navigate("/", { replace: true });
          return;
        }
        setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cohort, setup, navigate]);

  // Gmail emails a confirmation link to the alias itself the moment the user
  // adds it as a forwarding address in their own Gmail settings (step 2
  // below) -- there's no inbox at that address for a human to open, so the
  // backend catches it (inboundController.js) and this poll is what notices.
  // Stops once the link shows up; nothing to poll for after that.
  useEffect(() => {
    if (!setup || setup.confirmationLink) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const status = await api("/api/inbound/status");
        if (!cancelled && status?.confirmationLink) {
          setSetup((prev) => (prev ? { ...prev, confirmationLink: status.confirmationLink } : prev));
        }
      } catch {
        // Transient network hiccup -- the next tick tries again.
      }
    };

    const interval = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [setup]);

  const handleCopy = async () => {
    if (!setup?.alias) return;
    try {
      await navigator.clipboard.writeText(setup.alias);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission denied or unavailable -- the address is still
      // shown on screen to copy by hand, so this is silent.
    }
  };

  return (
    <div className="jt-auth-page">
      <div className="jt-auth-card is-wide">
        <Wordmark />

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="jt-auth-title">
            Forward your <em>mail</em>
          </div>
          <div className="jt-auth-sub">
            No Google sign-in needed. Send job-application mail to a jobtrak address instead, and it
            gets classified the same way a connected inbox would.
          </div>
        </div>

        <VineDivider />

        {!cohort ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="jt-auth-sub">Which describes your inbox?</div>
            <button type="button" className="jt-btn jt-btn-primary" onClick={() => setCohort("dedicated")}>
              A dedicated job-search email
            </button>
            <button type="button" className="jt-btn jt-btn-secondary" onClick={() => setCohort("personal")}>
              My everyday personal inbox
            </button>
          </div>
        ) : loading ? (
          <div className="jt-auth-sub">Setting up your address…</div>
        ) : error ? (
          <div className="jt-notice">{error}</div>
        ) : setup ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="jt-since-field">
              <span className="jt-label">Your forwarding address</span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <code className="jt-input" style={{ flex: 1, userSelect: "all" }}>
                  {setup.alias}
                </code>
                <button type="button" className="jt-btn jt-btn-secondary" onClick={handleCopy}>
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>

            {setup.confirmationLink ? (
              <div className="jt-notice">
                Gmail sent its confirmation request &mdash; we caught it for you. Click below to finish
                turning forwarding on (opens Gmail; make sure you&apos;re signed into the account
                you&apos;re forwarding from).
                <div style={{ marginTop: 8 }}>
                  <a
                    href={setup.confirmationLink}
                    target="_blank"
                    rel="noreferrer"
                    className="jt-btn jt-btn-primary"
                    style={{ textDecoration: "none", display: "inline-block" }}
                  >
                    Confirm forwarding
                  </a>
                </div>
              </div>
            ) : null}

            {cohort === "dedicated" ? (
              <div className="jt-steps">
                <div className="jt-step">
                  <span className="jt-step-num">1</span>
                  <span>
                    In Gmail, open <strong>Settings &rarr; Forwarding and POP/IMAP</strong>.
                  </span>
                </div>
                <div className="jt-step">
                  <span className="jt-step-num">2</span>
                  <span>
                    Click <strong>Add a forwarding address</strong>, paste the address above, and verify
                    it with the confirmation email Gmail sends.
                  </span>
                </div>
                <div className="jt-step">
                  <span className="jt-step-num">3</span>
                  <span>
                    Choose <strong>Forward a copy of incoming mail</strong> and save. Since this inbox is
                    only for job applications, no filter is needed &mdash; everything forwards.
                  </span>
                </div>
              </div>
            ) : (
              <div className="jt-steps">
                <div className="jt-step">
                  <span className="jt-step-num">1</span>
                  <span>
                    In Gmail, open <strong>Settings &rarr; Forwarding and POP/IMAP</strong>, click{" "}
                    <strong>Add a forwarding address</strong>, paste the address above, and verify it.
                  </span>
                </div>
                <div className="jt-step">
                  <span className="jt-step-num">2</span>
                  <span>
                    Since this is a personal inbox, a filter decides what gets forwarded &mdash; job
                    mail only, not everything else. Click below to open Gmail with the filter criteria
                    already in the search bar.
                  </span>
                </div>
                <div className="jt-step">
                  <span className="jt-step-num">3</span>
                  <span>
                    Click the <strong>show search options</strong> icon (sliders, right of the search
                    bar) &mdash; the criteria carry over automatically. Click{" "}
                    <strong>Create filter</strong>, check <strong>Forward it to</strong>, and pick the
                    address you just verified.
                  </span>
                </div>
              </div>
            )}

            {cohort === "personal" ? (
              <div className="jt-notice">
                This filter catches about 99% of application mail in our testing. The rare miss tends to
                be something Gmail routed to Promotions or Social instead of your inbox &mdash; worth an
                occasional glance there. If you'd rather not think about it, a dedicated job-search
                inbox (forwarding everything, no filter) catches 100% by construction.
              </div>
            ) : null}

            {cohort === "personal" && setup.gmailFilterUrl ? (
              <a
                href={setup.gmailFilterUrl}
                target="_blank"
                rel="noreferrer"
                className="jt-btn jt-btn-primary"
                style={{ textDecoration: "none", textAlign: "center" }}
              >
                <MailIcon />
                Open Gmail with filter criteria
              </a>
            ) : null}

            <button type="button" className="jt-btn jt-btn-primary" onClick={() => navigate("/backfill")}>
              Continue &mdash; add older mail too
            </button>

            <button
              type="button"
              className="jt-btn jt-btn-ghost"
              onClick={() => {
                setCohort(null);
                setSetup(null);
              }}
            >
              Back
            </button>
          </div>
        ) : null}

        <button type="button" className="jt-btn jt-btn-ghost" onClick={() => navigate("/dashboard", { replace: true })}>
          Skip &mdash; I&apos;ll add applications myself
        </button>
      </div>
    </div>
  );
}
