const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export function getToken() {
  return localStorage.getItem("token");
}

export function setToken(token) {
  localStorage.setItem("token", token);
}

export function clearToken() {
  localStorage.removeItem("token");
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
 * Thin wrapper over fetch: attaches the bearer token, JSON-encodes the
 * body, and turns non-2xx responses into ApiError so callers can `catch`
 * instead of checking `res.ok` everywhere. A 401 means the JWT expired —
 * the caller drops the token and sends the user back to the login screen.
 */
export async function api(path, { method = "GET", body, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
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
