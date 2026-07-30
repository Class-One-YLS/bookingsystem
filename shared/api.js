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
    const token = window.ClassOneSession?.getSession?.()?.token || "";
    const res = await fetch(`${apiBase()}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": DEFAULT_NEON.apiKey,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {})
      }
    });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (error) { data = { error: text }; }
    if (!res.ok || data.ok === false) throw new Error(data.error || `Class One API HTTP ${res.status}`);
    return data;
  }

  window.ClassOneApi = {
    DEFAULT_NEON,
    apiBase,
    request
  };
})();
