(function () {
  "use strict";

  const DEFAULT_NEON = {
    apiUrl: "https://classone-booking-api-yiit.vercel.app",
    apiKey: "73a5baa8e4a70be55d79615e2dfbf4e843fa04b57ec04764",
    stateKey: "production"
  };

  function apiBase() {
    return DEFAULT_NEON.apiUrl.replace(/\/+$/, "");
  }

  async function request(path, options = {}) {
    const session = window.ClassOneSession?.getSession?.() || {};
    const token = session.token || "";
    const userEmail = session.user?.email || "";
    const method = String(options.method || "GET").toUpperCase();
    const url = `${apiBase()}${path}`;
    try {
      const res = await fetch(url, {
        ...options,
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": DEFAULT_NEON.apiKey,
          ...(token ? { "X-User-Session": token } : {}),
          ...(userEmail ? { "X-User-Email": userEmail } : {}),
          ...(options.headers || {})
        }
      });
      const text = await res.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch (error) { data = { error: text }; }
      if (!res.ok || data.ok === false) {
        console.warn("[ClassOne API] request failed", {
          operation: path,
          url,
          method,
          status: res.status,
          response: data.error || text || res.statusText
        });
        const err = new Error(data.error || `Class One API HTTP ${res.status}`);
        err.status = res.status;
        err.data = data;
        err.currentVersion = data.currentVersion;
        err.conflict = data.conflict;
        throw err;
      }
      return data;
    } catch (error) {
      if (error.status) throw error;
      console.warn("[ClassOne API] network error", {
        operation: path,
        url,
        method,
        error: error.message || String(error)
      });
      if (/failed to fetch/i.test(String(error.message || error))) {
        throw new Error(`Cannot connect to Class One API at ${url}. Please check deployment, CORS, and network access.`);
      }
      throw error;
    }
  }

  window.ClassOneApi = {
    DEFAULT_NEON,
    apiBase,
    request
  };
})();
