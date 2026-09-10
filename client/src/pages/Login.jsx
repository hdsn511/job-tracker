import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Wordmark } from "@/components/dashboard/icons";
import VineDivider from "@/components/VineDivider";
import { api, markAuthed } from "@/lib/api";
import "@/styles/jobtrak.css";

export default function Login() {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  const isRegister = mode === "register";

  /**
   * Straight to the dashboard for anyone whose inbox is already connected;
   * everyone else gets the connect step first, since an empty tracker with
   * no inbox hooked up has nothing to show.
   */
  const continueAfterAuth = async () => {
    try {
      const status = await api("/auth/gmail/status");
      navigate(status.connected ? "/dashboard" : "/connect", { replace: true });
    } catch {
      navigate("/connect", { replace: true });
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (!email.trim() || !password) {
      setError("Email and password are required.");
      return;
    }
    if (isRegister && password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setSubmitting(true);
    try {
      if (isRegister) {
        await api("/auth/register", {
          method: "POST",
          body: { email: email.trim(), password },
        });
      }

      await api("/auth/login", {
        method: "POST",
        body: { email: email.trim(), password },
      });
      markAuthed();
      await continueAfterAuth();
    } catch (err) {
      if (err.status === 409) {
        setError("An account with this email already exists. Log in instead.");
      } else if (err.status === 401) {
        setError("Invalid email or password. Please try again.");
      } else {
        setError(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="jt-auth-page">
      <form className="jt-auth-card" onSubmit={handleSubmit}>
        <Wordmark />

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="jt-auth-title">
            {isRegister ? (
              <>
                Create your <em>account</em>
              </>
            ) : (
              <>
                Welcome <em>back</em>
              </>
            )}
          </div>
          <div className="jt-auth-sub">
            {isRegister
              ? "Track every application in one pipeline, built from your inbox."
              : "Pick up where your pipeline left off."}
          </div>
        </div>

        <VineDivider />

        <div className="jt-auth-form">
          <div className="jt-field">
            <label htmlFor="jt-email">Email</label>
            <input
              id="jt-email"
              className="jt-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </div>

          <div className="jt-field">
            <label htmlFor="jt-password">Password</label>
            <input
              id="jt-password"
              className="jt-input"
              type="password"
              autoComplete={isRegister ? "new-password" : "current-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={isRegister ? "At least 8 characters" : "••••••••"}
            />
          </div>

          {error ? <div className="jt-notice">{error}</div> : null}

          <button
            type="submit"
            className="jt-btn jt-btn-primary"
            disabled={submitting}
          >
            {submitting ? "Just a moment…" : isRegister ? "Create account" : "Log in"}
          </button>
        </div>

        <div className="jt-auth-switch">
          {isRegister ? "Already have an account? " : "Don't have an account? "}
          <button
            type="button"
            onClick={() => {
              setMode(isRegister ? "login" : "register");
              setError("");
            }}
          >
            {isRegister ? "Log in" : "Register"}
          </button>
        </div>
      </form>
    </div>
  );
}
