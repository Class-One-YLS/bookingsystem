(function () {
  "use strict";

  const SESSION_KEY = "classone_session";
  const USER_KEY = "classone_user";

  function readJson(store, key) {
    try {
      return JSON.parse(store.getItem(key) || "null");
    } catch (error) {
      return null;
    }
  }

  function tokenIsFresh(token) {
    try {
      const payload = String(token || "").split(".")[0];
      if (!payload) return false;
      const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
      const data = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")));
      return Number(data.exp || 0) > Date.now();
    } catch (error) {
      return false;
    }
  }

  function getSession() {
    for (const store of [localStorage, sessionStorage]) {
      const saved = readJson(store, SESSION_KEY);
      const user = readJson(store, USER_KEY);
      if (saved?.token && tokenIsFresh(saved.token)) return { ...saved, user };
    }
    return null;
  }

  function getUser() {
    return getSession()?.user || null;
  }

  window.ClassOneSession = {
    SESSION_KEY,
    USER_KEY,
    tokenIsFresh,
    getSession,
    getUser
  };
})();
