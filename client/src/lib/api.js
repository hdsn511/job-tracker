const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

const AUTH_FLAG = "jt_authed";

// The real session lives in an httpOnly cookie the browser manages —
// client JS never sees it, so it can't be stolen via XSS the way a
// localStorage bearer token could. This flag is only a UI hint for
// routing (ProtectedRoute) and grants nothing by itself: every request is
// still authorized server-side by the cookie, so a stale/forged flag just
// means a 401 the caller already handles, not real access.
export function isAuthed() {
  return localStorage.getItem(AUTH_FLAG) === "1";
}

export function markAuthed() {
  localStorage.setItem(AUTH_FLAG, "1");
}

export function clearAuthed() {
  localStorage.removeItem(AUTH_FLAG);
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.unauthorized = status === 401;
  }
}

/**
 * Thin wrapper over fetch: sends the session cookie, JSON-encodes the
 * body, and turns non-2xx responses into ApiError so callers can `catch`
 * instead of checking `res.ok` everywhere. A 401 means the session cookie
 * is missing/expired — the caller clears the local auth flag and sends the
 * user back to the login screen.
 */
export async function api(path, { method = "GET", body } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      credentials: "include",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection.", 0);
  }

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const message =
      (data && (data.error || (data.errors && data.errors[0]?.msg))) ||
      "Something went wrong. Please try again.";
    throw new ApiError(message, response.status);
  }

  return data;
}

export { API_URL };
