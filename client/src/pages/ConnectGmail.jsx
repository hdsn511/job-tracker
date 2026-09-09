import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MailIcon, Wordmark } from "@/components/dashboard/icons";
import VineDivider from "@/components/VineDivider";
import { api, clearToken } from "@/lib/api";
import "@/styles/jobtrak.css";

/**
 * Step two of the flow: log in, connect the inbox, then land on the
 * dashboard. Skippable — the tracker still works with applications added by
 * hand, and the rail keeps offering the connect link afterwards.
 */
export default function ConnectGmail() {
  const navigate = useNavigate();
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    api("/auth/gmail/status")
      .then((data) => {
        if (cancelled) return;
        // Already connected (e.g. back button after the OAuth round trip) —
        // nothing to do here.
        if (data.connected) navigate("/dashboard", { replace: true });
        else setStatus(data);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err.unauthorized) {
          clearToken();
          navigate("/", { replace: true });
        } else {
          setError(err.message);
          setStatus({ connected: false });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("gmail") === "error") {
      setError("Couldn't connect Gmail. Please try again.");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const handleConnect = async () => {
    setRedirecting(true);
    setError("");
    try {
      const { url } = await api("/auth/gmail/connect");
      window.location.href = url;
    } catch (err) {
      if (err.unauthorized) {
        clearToken();
        navigate("/", { replace: true });
        return;
      }
      setError(err.message);
      setRedirecting(false);
    }
  };

  return (
    <div className="jt-auth-page">
      <div className="jt-auth-card is-wide">
        <Wordmark />

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="jt-auth-title">
            Connect your <em>inbox</em>
          </div>
          <div className="jt-auth-sub">
            jobtrak reads only the job-application mail in your Gmail and turns it into a pipeline —
            confirmations, assessments, interview invites and rejections, dated and grouped by
            company.
          </div>
        </div>

        <VineDivider />

        <div className="jt-steps">
          <div className="jt-step">
            <span className="jt-step-num">1</span>
            <span>Google asks you to grant read-only access to Gmail.</span>
          </div>
          <div className="jt-step">
            <span className="jt-step-num">2</span>
            <span>
              We scan the last 30 days for application mail, then keep up twice a day. Nothing is
              ever sent from your account.
            </span>
          </div>
          <div className="jt-step">
            <span className="jt-step-num">3</span>
            <span>Your pipeline opens with everything already sorted by stage.</span>
          </div>
        </div>

        {error ? <div className="jt-notice">{error}</div> : null}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button
            type="button"
            className="jt-btn jt-btn-primary"
            onClick={handleConnect}
            disabled={!status || redirecting}
          >
            <MailIcon />
            {redirecting ? "Opening Google…" : "Connect Gmail"}
          </button>

          <button
            type="button"
            className="jt-btn jt-btn-ghost"
            onClick={() => navigate("/dashboard", { replace: true })}
          >
            Skip &mdash; I&apos;ll add applications myself
          </button>
        </div>
      </div>
    </div>
  );
}
