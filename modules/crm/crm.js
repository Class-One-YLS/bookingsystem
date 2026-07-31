(function () {
  "use strict";

  const DEFAULT_NEON = window.ClassOneApi?.DEFAULT_NEON || {
    apiUrl: "https://classone-booking-api-yiit.vercel.app",
    apiKey: "73a5baa8e4a70be55d79615e2dfbf4e843fa04b57ec04764",
    stateKey: "production"
  };
  const SESSION_KEY = "classone_session";
  const USER_KEY = "classone_user";
  const UI_STATE_KEY = "classone_ui_state";
  const CRM_LEAD_COLUMN_KEY = "crmLeadVisibleColumns.v1";
  const CRM_DEVICE_KEY = "classone_crm_device_id";
  const CRM_BATCH = 70;
  const CRM_PERF = new URLSearchParams(window.location.search).has("perf");
  const CURRENT_MONTH = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const CRM_ENROLLMENT_TRIGGER_STATUS = "Enrolled";
  const CRM_REGISTERED_STATUS = "Registered";
  const CRM_FINAL_STATUSES = new Set([CRM_ENROLLMENT_TRIGGER_STATUS, CRM_REGISTERED_STATUS]);
  const LEAD_STATUSES = ["New Contact", "Follow Up", "Assessment", "Trial Class", CRM_ENROLLMENT_TRIGGER_STATUS, CRM_REGISTERED_STATUS, "No Response", "Not Interested", "Lost"];
  const URGENCIES = ["hot", "warm", "cold"];
  const LEAD_SUBJECTS = ["BC", "BM", "BI", "CN", "PK", "Phonics", "BC Exam", "BM Exam", "Speakokid"];
  const CRM_SESSION = {
    assessment: { title: "Assessment", teacher: "assessmentTeacherId", date: "assessmentDate", time: "assessmentTime", booking: "assessmentBookingId", type: "assessment", status: "Assessment" },
    trial1: { title: "Trial 1", teacher: "trialTeacherId", date: "trialDate", time: "trialTime", booking: "trialBookingId", type: "trial class", status: "Trial Class" },
    trial2: { title: "Trial 2", teacher: "trialTeacherId2", date: "trialDate2", time: "trialTime2", booking: "trialBookingId2", type: "trial class", status: "Trial Class" }
  };
  const COLUMNS = [
    { key: "created", label: "Created Date", sortable: true },
    { key: "child", label: "Child", sortable: true },
    { key: "parent", label: "Parent", sortable: true },
    { key: "phone", label: "Phone" },
    { key: "email", label: "Email" },
    { key: "status", label: "Status" },
    { key: "salesperson", label: "Assigned Salesperson" },
    { key: "nextFollowUp", label: "Next Follow-up" },
    { key: "source", label: "Source" },
    { key: "subjects", label: "Subjects" },
    { key: "urgency", label: "Urgency" },
    { key: "assessment", label: "Assessment Teacher / Slot" },
    { key: "trial", label: "Trial 1 / Trial 2" },
    { key: "package", label: "Package" },
    { key: "remarks", label: "Remarks" },
    { key: "actions", label: "Actions" }
  ];
  const DEFAULT_COLUMNS = ["created", "child", "parent", "phone", "status", "salesperson", "nextFollowUp", "assessment", "trial", "package"];

  let state = {};
  let version = 0;
  let renderLimit = CRM_BATCH;
  let saveTimer = 0;
  let saving = false;
  let pendingSave = false;
  let currentSort = { key: "", direction: "desc" };
  let expandedMonths = new Set([CURRENT_MONTH]);
  let lastRenderedSignature = "";
  let lastLoadStartedAt = 0;
  let eventsBound = false;
  let workspaceExpanded = false;
  let dirtyLeads = new Map();
  let dirtyBookings = new Map();
  let dirtyStudents = new Map();
  let dirtyTeachers = new Map();
  let dirtyActivityLogs = new Map();
  let pendingEnrollment = null;
  let enrollmentRegularSlotsDraft = [];
  let enrollmentAvailabilityRequest = 0;
  let lastSaveErrorMessage = "";

  const $ = id => document.getElementById(id);
  const safeJson = value => JSON.parse(JSON.stringify(value || null));
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch]));
  const dateOnly = value => String(value || "").slice(0, 10);
  const uid = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const deterministicId = (prefix, value) => `${prefix}_${String(value || "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || Date.now().toString(36)}`;
  const nowISO = () => new Date().toISOString();
  const monthKey = value => dateOnly(value).slice(0, 7) || "unknown";
  const timeValue = value => {
    const time = Date.parse(value || "");
    return Number.isFinite(time) ? time : 0;
  };
  const leadAddedDate = lead => dateOnly(lead.createdAt || lead.addedAt || lead.date || lead.updatedAt || "");
  const leadAddedTime = lead => timeValue(lead.createdAt || lead.addedAt || lead.date || lead.updatedAt);
  const leadLatestTime = lead => timeValue(lead.updatedAt || lead.statusChangedAt || lead.createdAt);
  const leadSalespersonKey = lead => String(lead.salesperson || "Unassigned").trim() || "Unassigned";
  const leadStatus = lead => lead.status || "New Contact";
  const isCrmFinalStatus = status => CRM_FINAL_STATUSES.has(String(status || ""));
  const isEnrollmentActionStatus = status => String(status || "") === CRM_ENROLLMENT_TRIGGER_STATUS || String(status || "") === CRM_REGISTERED_STATUS;
  const canonicalLeadStatusAfterSave = status => isEnrollmentActionStatus(status) ? CRM_REGISTERED_STATUS : status;
  const isOldImportedLead = lead => Boolean(lead.oldImported || lead.importedFromSheet || lead.monthlyTabImported);

  function perfInfo(label, details = {}) {
    if (!CRM_PERF) return;
    console.info(`[CRM perf] ${label}`, details);
  }

  function byteSize(text) {
    try { return new TextEncoder().encode(String(text || "")).length; } catch (err) { return String(text || "").length; }
  }

  function cssEscape(value) {
    if (window.CSS?.escape) return CSS.escape(String(value || ""));
    return String(value || "").replace(/["\\]/g, "\\$&");
  }

  function storageGet(key) {
    try { return localStorage.getItem(key) || sessionStorage.getItem(key) || ""; } catch (err) { return ""; }
  }

  function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (err) {}
  }

  function deviceId() {
    let id = storageGet(CRM_DEVICE_KEY);
    if (!id) {
      id = `crm_device_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      storageSet(CRM_DEVICE_KEY, id);
    }
    return id;
  }

  function sessionRecord() {
    const shared = window.ClassOneSession?.getSession?.();
    if (shared?.token) return shared;
    for (const store of [localStorage, sessionStorage]) {
      try {
        const saved = JSON.parse(store.getItem(SESSION_KEY) || "null");
        const user = JSON.parse(store.getItem(USER_KEY) || "null");
        if (saved?.token && sessionTokenIsFresh(saved.token)) return { ...saved, user };
      } catch (err) {}
    }
    return null;
  }

  function sessionTokenIsFresh(token) {
    try {
      const payload = String(token || "").split(".")[0];
      if (!payload) return false;
      const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
      const data = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")));
      return Number(data.exp || 0) > Date.now();
    } catch (err) {
      return false;
    }
  }

  function currentUser() {
    return sessionRecord()?.user || null;
  }

  function userCanEdit() {
    const user = currentUser();
    if (!user || user.status === "disabled") return false;
    if (user.role === "master_admin" || user.role === "company_admin") return true;
    const full = (state.users || []).find(item => String(item.email || "").toLowerCase() === String(user.email || "").toLowerCase());
    if (full?.role === "master_admin" || full?.role === "company_admin") return true;
    const role = (state.roles || []).find(item => item.name === (full?.role || user.role));
    return Array.isArray(role?.permissions) && role.permissions.includes("edit");
  }

  function hasCrmAccess() {
    const user = currentUser();
    if (!user) return false;
    if (user.role === "master_admin") return true;
    const full = (state.users || []).find(item => String(item.email || "").toLowerCase() === String(user.email || "").toLowerCase());
    const role = (state.roles || []).find(item => item.name === (full?.role || user.role));
    const tabs = full?.allowedTabs?.length ? full.allowedTabs : (role?.allowedTabs || []);
    return !tabs.length || tabs.includes("crm") || tabs.includes("CRM Leads");
  }

  function setStatus(message, type = "info") {
    const el = $("statusText");
    if (!el) return;
    el.textContent = message;
    el.dataset.type = type;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function ensureCrmMarkup() {
    if ($("openLeadModalBtn")) return;
    const mount = $("crmModuleMount") || $("crm");
    if (!mount) throw new Error("CRM mount point is missing.");
    const res = await fetch("./modules/crm/crm.html", { cache: "no-store" });
    if (!res.ok) throw new Error(`Unable to load CRM module HTML (${res.status}).`);
    mount.innerHTML = await res.text();
  }

  function apiBase() {
    return DEFAULT_NEON.apiUrl.replace(/\/+$/, "");
  }

  async function apiFetch(path, options = {}) {
    if (window.ClassOneApi?.request) return window.ClassOneApi.request(path, options);
    const session = sessionRecord() || {};
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
        console.warn("[ClassOne CRM API] request failed", {
          operation: path,
          url,
          method,
          status: res.status,
          response: data.error || text || res.statusText
        });
        const err = new Error(data.error || res.statusText || "API request failed.");
        err.status = res.status;
        throw err;
      }
      return data;
    } catch (error) {
      if (error.status) throw error;
      console.warn("[ClassOne CRM API] network error", {
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

  async function loadState() {
    if (!sessionRecord()?.token) {
      window.location.href = "./index.html";
      return;
    }
    lastLoadStartedAt = performance.now();
    setStatus("Loading CRM from Neon...");
    const apiStarted = performance.now();
    const result = await apiFetch(`/api/state?key=${encodeURIComponent(DEFAULT_NEON.stateKey)}`, { method: "GET" });
    perfInfo("state load", {
      ms: Math.round(performance.now() - apiStarted),
      version: Number(result.version || 0),
      leads: Array.isArray(result.data?.leads) ? result.data.leads.length : 0,
      bookings: Array.isArray(result.data?.bookings) ? result.data.bookings.length : 0,
      teachers: Array.isArray(result.data?.teachers) ? result.data.teachers.length : 0
    });
    state = result.data || {};
    version = Number(result.version || state.settings?.neonVersion || 0);
    state.leads ||= [];
    state.teachers ||= [];
    state.students ||= [];
    state.bookings ||= [];
    state.teacherLeaves ||= [];
    state.publicHolidays ||= [];
    state.activityLogs ||= [];
    if (!hasCrmAccess()) {
      $("crmContent").innerHTML = `<div class="panel"><h2>No Access</h2><p class="subtle">You do not have permission to access CRM Leads.</p><a class="btn ghost" href="./index.html">Back to Dashboard</a></div>`;
      return;
    }
    hydrateFilters();
    renderLeads({ reset: true });
    perfInfo("crm initial load total", {
      ms: Math.round(performance.now() - lastLoadStartedAt),
      domNodes: document.querySelectorAll("*").length,
      inputs: document.querySelectorAll("#crm input").length,
      selects: document.querySelectorAll("#crm select").length,
      textareas: document.querySelectorAll("#crm textarea").length
    });
    setStatus(`CRM loaded in ${Math.round(performance.now() - lastLoadStartedAt)} ms.`);
  }

  function markLeadDirty(lead) {
    if (lead?.id) dirtyLeads.set(String(lead.id), lead);
  }

  function markBookingDirty(booking) {
    if (booking?.id) dirtyBookings.set(String(booking.id), booking);
  }

  function markStudentDirty(student) {
    if (student?.id) dirtyStudents.set(String(student.id), student);
  }

  function markTeacherDirty(teacher) {
    if (teacher?.id) dirtyTeachers.set(String(teacher.id), teacher);
  }

  function markActivityLogDirty(log) {
    if (log?.id) dirtyActivityLogs.set(String(log.id), log);
  }

  function hasDirtyChanges() {
    return Boolean(dirtyLeads.size || dirtyBookings.size || dirtyStudents.size || dirtyTeachers.size || dirtyActivityLogs.size);
  }

  function buildPatchSnapshot() {
    return {
      leads: [...dirtyLeads.entries()].map(([id, record]) => [id, safeJson(record)]),
      bookings: [...dirtyBookings.entries()].map(([id, record]) => [id, safeJson(record)]),
      students: [...dirtyStudents.entries()].map(([id, record]) => [id, safeJson(record)]),
      teachers: [...dirtyTeachers.entries()].map(([id, record]) => [id, safeJson(record)]),
      activityLogs: [...dirtyActivityLogs.entries()].map(([id, record]) => [id, safeJson(record)])
    };
  }

  function patchFromSnapshot(snapshot) {
    const updatedBy = currentUser()?.email || "crm";
    return {
      format: "classone_record_patch_v1",
      baseVersion: version,
      deviceId: deviceId(),
      updatedAt: nowISO(),
      updatedBy,
      changes: {
        leads: snapshot.leads.map(([, record]) => record),
        bookings: snapshot.bookings.map(([, record]) => record),
        students: snapshot.students.map(([, record]) => record),
        teachers: snapshot.teachers.map(([, record]) => record),
        activityLogs: snapshot.activityLogs.map(([, record]) => record)
      }
    };
  }

  function patchHasRecords(patch) {
    return Boolean(
      patch.changes.leads.length ||
      patch.changes.bookings.length ||
      patch.changes.students.length ||
      patch.changes.teachers.length ||
      patch.changes.activityLogs.length
    );
  }

  function clearSyncedSnapshot(snapshot) {
    const clearIfUnchanged = (map, id, sentRecord) => {
      const current = map.get(id);
      if (!current) return;
      if (JSON.stringify(safeJson(current)) === JSON.stringify(sentRecord)) map.delete(id);
    };
    snapshot.leads.forEach(([id, record]) => clearIfUnchanged(dirtyLeads, id, record));
    snapshot.bookings.forEach(([id, record]) => clearIfUnchanged(dirtyBookings, id, record));
    snapshot.students.forEach(([id, record]) => clearIfUnchanged(dirtyStudents, id, record));
    snapshot.teachers.forEach(([id, record]) => clearIfUnchanged(dirtyTeachers, id, record));
    snapshot.activityLogs.forEach(([id, record]) => clearIfUnchanged(dirtyActivityLogs, id, record));
  }

  async function saveState({ immediate = false, waitForActive = false } = {}) {
    if (!userCanEdit()) {
      setStatus("You do not have permission to edit CRM Leads.", "error");
      return false;
    }
    if (saving) {
      pendingSave = true;
      if (waitForActive) {
        for (let attempt = 0; attempt < 80 && saving; attempt += 1) await sleep(100);
        if (!saving) return saveState({ immediate, waitForActive: false });
      }
      return false;
    }
    saving = true;
    lastSaveErrorMessage = "";
    setStatus("Syncing CRM changes...");
    try {
      const prepareStarted = performance.now();
      const snapshot = buildPatchSnapshot();
      const patch = patchFromSnapshot(snapshot);
      if (!patchHasRecords(patch)) {
        setStatus("Saved.", "success");
        return true;
      }
      const body = JSON.stringify({
        key: DEFAULT_NEON.stateKey,
        patch,
        updatedBy: currentUser()?.email || "crm",
        userSession: sessionRecord()?.token || "",
        userEmail: currentUser()?.email || ""
      });
      perfInfo("patch prepared", {
        ms: Math.round(performance.now() - prepareStarted),
        bytes: byteSize(body),
        leads: patch.changes.leads.length,
        bookings: patch.changes.bookings.length,
        students: patch.changes.students.length,
        teachers: patch.changes.teachers.length,
        activityLogs: patch.changes.activityLogs.length,
        baseVersion: patch.baseVersion
      });
      try {
        const uploadStarted = performance.now();
        const saved = await apiFetch("/api/state-patch", { method: "POST", body });
        perfInfo("patch upload", {
          ms: Math.round(performance.now() - uploadStarted),
          version: Number(saved.version || 0),
          chunks: saved.totalChunks || 0
        });
        version = Number(saved.version || version + 1);
        clearSyncedSnapshot(snapshot);
      } catch (err) {
        if (err.status !== 409) throw err;
        setStatus("Merging CRM with latest Neon data...");
        const retryPatch = { ...patch, baseVersion: version, retryOf: patch.updatedAt, updatedAt: nowISO() };
        const retryStarted = performance.now();
        const saved = await apiFetch("/api/state-patch", {
          method: "POST",
          body: JSON.stringify({
            key: DEFAULT_NEON.stateKey,
            patch: retryPatch,
            updatedBy: currentUser()?.email || "crm",
            userSession: sessionRecord()?.token || "",
            userEmail: currentUser()?.email || ""
          })
        });
        perfInfo("patch retry upload", {
          ms: Math.round(performance.now() - retryStarted),
          version: Number(saved.version || 0),
          chunks: saved.totalChunks || 0
        });
        version = Number(saved.version || version + 1);
        clearSyncedSnapshot(snapshot);
      }
      setStatus(`Saved to Neon at ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`, "success");
      return true;
    } catch (err) {
      lastSaveErrorMessage = err.message || String(err);
      setStatus(`Save failed. Your change is still on this page: ${err.message}`, "error");
      return false;
    } finally {
      saving = false;
      if (pendingSave || hasDirtyChanges()) {
        pendingSave = false;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => saveState(), 250);
      }
    }
  }

  function queueSave(immediate = false) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveState({ immediate }), immediate ? 0 : 650);
  }

  function logAction(action, target, remark = "") {
    state.activityLogs ||= [];
    const log = {
      id: uid("log"),
      action,
      target,
      remark,
      createdAt: nowISO(),
      updatedAt: nowISO(),
      createdBy: currentUser()?.email || "crm"
    };
    state.activityLogs.unshift(log);
    markActivityLogDirty(log);
  }

  function visibleColumnKeys() {
    try {
      const saved = JSON.parse(storageGet(CRM_LEAD_COLUMN_KEY) || "[]");
      if (Array.isArray(saved) && saved.length) return saved.filter(key => COLUMNS.some(column => column.key === key));
    } catch (err) {}
    return [...DEFAULT_COLUMNS];
  }

  function setVisibleColumns(keys) {
    const valid = [...new Set(keys)].filter(key => COLUMNS.some(column => column.key === key));
    storageSet(CRM_LEAD_COLUMN_KEY, JSON.stringify(valid.length ? valid : DEFAULT_COLUMNS));
    renderLeads({ reset: true });
  }

  function monthLabel(key) {
    if (!key || key === "unknown") return "Unknown Month";
    const date = new Date(`${key}-01T12:00:00`);
    return Number.isNaN(date.getTime()) ? key : date.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  }

  function dateLabel(value) {
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }

  function timeLabel(value) {
    if (!value) return "";
    const [hh, mm] = String(value).split(":").map(Number);
    const date = new Date();
    date.setHours(hh || 0, mm || 0, 0, 0);
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function minutes(value) {
    const [hh, mm] = String(value || "").split(":").map(Number);
    return (hh || 0) * 60 + (mm || 0);
  }

  function dayName(date) {
    return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" });
  }

  function timeOptions() {
    const slots = [];
    for (let min = 8 * 60; min <= 21 * 60 + 30; min += 30) {
      slots.push(`${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`);
    }
    return slots;
  }

  function activeTeachers() {
    return (state.teachers || []).filter(teacher => !teacher.archived && !teacher.deleted && teacher.status !== "disabled");
  }

  function teacherById(id) {
    return activeTeachers().find(teacher => String(teacher.id || "") === String(id || "")) || null;
  }

  function teacherNameById(id) {
    const teacher = teacherById(id);
    return teacher ? (teacher.name || teacher.teacherName || "Teacher") : "";
  }

  function studentById(id) {
    return (state.students || []).find(student => String(student.id || "") === String(id || "")) || null;
  }

  function cleanName(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function nameKey(value) {
    return cleanName(value).toLowerCase();
  }

  function studentByName(name) {
    const key = nameKey(name);
    if (!key) return null;
    return (state.students || []).find(student => nameKey(student.name || student.studentName || "") === key) || null;
  }

  function normalizeSubjectsInput(value) {
    if (Array.isArray(value)) return [...new Set(value.map(item => String(item || "").trim()).filter(Boolean))];
    return [...new Set(String(value || "").split(",").map(item => item.trim()).filter(Boolean))];
  }

  function selectedEnrollmentSubjects() {
    return [...$("crmEnrollmentSubjectChecks").querySelectorAll("input:checked")].map(input => input.value);
  }

  function setSelectedEnrollmentSubjects(subjects) {
    const selected = new Set(normalizeSubjectsInput(subjects));
    $("crmEnrollmentSubjectChecks").innerHTML = LEAD_SUBJECTS.map(subject => `<label class="chip"><input type="checkbox" value="${escapeHtml(subject)}" ${selected.has(subject) ? "checked" : ""}> ${escapeHtml(subject)}</label>`).join("");
    renderEnrollmentSubjectOptions();
  }

  function selectedEnrollmentDays() {
    return [...$("crmEnrollmentDayChecks").querySelectorAll("input:checked")].map(input => input.value);
  }

  function selectedEnrollmentDay() {
    return selectedEnrollmentDays()[0] || "";
  }

  function setEnrollmentError(message = "") {
    const box = $("crmEnrollmentError");
    if (!box) return;
    box.textContent = message;
    box.classList.toggle("hide", !message);
  }

  function enrollmentContextName(lead) {
    return lead?.childName || lead?.parentName || lead?.parentPhone || "CRM lead";
  }

  function renderEnrollmentSubjectOptions() {
    const selected = selectedEnrollmentSubjects();
    const current = $("crmEnrollmentRegularSubject")?.value || selected[0] || "";
    if (!$("crmEnrollmentRegularSubject")) return;
    $("crmEnrollmentRegularSubject").innerHTML = selected.length
      ? selected.map(subject => `<option value="${escapeHtml(subject)}" ${subject === current ? "selected" : ""}>${escapeHtml(subject)}</option>`).join("")
      : `<option value="">Choose subject first</option>`;
  }

  function renderEnrollmentTeacherOptions(selected = "") {
    $("crmEnrollmentTeacher").innerHTML = teacherOptions(selected);
  }

  function renderEnrollmentTimeOptions(selected = "") {
    $("crmEnrollmentTime").innerHTML = `<option value="">Choose teacher first</option>`;
    $("crmEnrollmentTime").disabled = true;
  }

  function renderEnrollmentDayChecks(days = []) {
    const selected = new Set(days.slice(0, 1));
    const names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    $("crmEnrollmentDayChecks").innerHTML = names.map(day => `<label class="chip"><input type="checkbox" value="${escapeHtml(day)}" ${selected.has(day) ? "checked" : ""}> ${escapeHtml(day.slice(0, 3))}</label>`).join("");
  }

  function enforceSingleEnrollmentDay(changedInput = null) {
    const inputs = [...$("crmEnrollmentDayChecks").querySelectorAll("input")];
    if (changedInput?.checked) {
      inputs.forEach(input => {
        if (input !== changedInput) input.checked = false;
      });
      return changedInput.value;
    }
    const checked = inputs.find(input => input.checked);
    inputs.forEach(input => {
      input.checked = checked ? input === checked : false;
    });
    return checked?.value || "";
  }

  function addMonthsISO(dateISO, months) {
    const date = new Date(`${dateISO}T12:00:00`);
    if (Number.isNaN(date.getTime())) return "";
    date.setMonth(date.getMonth() + months);
    return dateOnly(date.toISOString());
  }

  function rangesOverlap(startA, endA, startB, endB) {
    const aStart = dateOnly(startA) || "0000-01-01";
    const aEnd = dateOnly(endA) || "9999-12-31";
    const bStart = dateOnly(startB) || "0000-01-01";
    const bEnd = dateOnly(endB) || "9999-12-31";
    return aStart <= bEnd && bStart <= aEnd;
  }

  function maxISODate(a, b) {
    a = dateOnly(a);
    b = dateOnly(b);
    if (!a) return b;
    if (!b) return a;
    return a > b ? a : b;
  }

  function minISODate(a, b) {
    a = dateOnly(a);
    b = dateOnly(b);
    if (!a) return b;
    if (!b) return a;
    return a < b ? a : b;
  }

  function recurringValidationEnd(startDate, endDate) {
    return dateOnly(endDate) || addMonthsISO(startDate, 12);
  }

  function timeRangeOverlaps(startA, durationA, startB, durationB) {
    const aStart = minutes(startA);
    const bStart = minutes(startB);
    const aEnd = aStart + Math.max(1, Number(durationA || 30));
    const bEnd = bStart + Math.max(1, Number(durationB || 30));
    return aStart < bEnd && bStart < aEnd;
  }

  function activeRecord(record) {
    if (!record) return false;
    if (record.archived || record.deleted || record.status === "deleted") return false;
    return true;
  }

  function activeLeaveRecord(leave) {
    return activeRecord(leave) && !["cancelled", "undone"].includes(String(leave.status || "active").toLowerCase());
  }

  function inactiveBookingStatus(status) {
    return ["cancelled", "public_holiday"].includes(String(status || "").toLowerCase());
  }

  function teacherGeneralOpenSlots(teacher, day) {
    return (teacher?.regularSlots || []).filter(slot => {
      if (!activeRecord(slot)) return false;
      if (String(slot.day || slot.weekday || "") !== day) return false;
      if (slot.studentName || slot.studentId || slot.locked) return false;
      if (slot.status === "off" || slot.unavailable) return false;
      return true;
    });
  }

  function teacherGeneralOpenTimes(teacher, day) {
    return [...new Set(teacherGeneralOpenSlots(teacher, day)
      .map(slot => slot.time || slot.startTime || "")
      .filter(Boolean))]
      .sort((a, b) => minutes(a) - minutes(b));
  }

  function teacherOpenSlotCovers(teacher, day, time, startDate, endDate) {
    return teacherGeneralOpenSlots(teacher, day).some(slot => {
      if (!timeRangeOverlaps(slot.time || slot.startTime || "", slot.minutes || slot.duration || 30, time, 30)) return false;
      if (!rangesOverlap(slot.startDate || "", slot.endDate || "", startDate, endDate)) return false;
      if (slot.startDate && dateOnly(slot.startDate) > startDate) return false;
      if (slot.endDate && dateOnly(slot.endDate) < endDate) return false;
      return true;
    });
  }

  function teacherRecurringConflict(teacher, day, time, startDate, endDate, ignoredStudentSlotId = "") {
    return (teacher?.regularSlots || []).find(slot => {
      if (!activeRecord(slot)) return false;
      if (String(slot.day || slot.weekday || "") !== day) return false;
      if (String(slot.studentSlotId || "") === String(ignoredStudentSlotId || "")) return false;
      if (!timeRangeOverlaps(slot.time || slot.startTime || "", slot.minutes || slot.duration || 30, time, 30)) return false;
      if (!rangesOverlap(slot.startDate || "", slot.endDate || "", startDate, endDate)) return false;
      if (slot.studentName || slot.studentId || slot.locked || slot.unavailable || slot.status === "off") return slot;
      return null;
    }) || null;
  }

  function dateInRange(date, startDate, endDate) {
    const iso = dateOnly(date);
    return iso && iso >= startDate && iso <= endDate;
  }

  function eachDateInRange(startDate, endDate, callback) {
    const current = new Date(`${startDate}T12:00:00`);
    const end = new Date(`${endDate}T12:00:00`);
    if (Number.isNaN(current.getTime()) || Number.isNaN(end.getTime())) return;
    while (current <= end) {
      const iso = dateOnly(current.toISOString());
      if (callback(iso) === true) return;
      current.setDate(current.getDate() + 1);
    }
  }

  function exactBookingConflict(teacherId, day, time, startDate, endDate, currentBookingId = "") {
    return (state.bookings || []).find(booking => {
      if (!activeRecord(booking)) return false;
      if (String(booking.id || "") === String(currentBookingId || "")) return false;
      if (String(booking.teacherId || "") !== String(teacherId || "")) return false;
      const date = dateOnly(booking.date);
      if (!dateInRange(date, startDate, endDate)) return false;
      if (dayName(date) !== day) return false;
      if (inactiveBookingStatus(booking.status)) return false;
      return timeRangeOverlaps(booking.time || booking.startTime || "", booking.minutes || booking.duration || 30, time, 30);
    }) || null;
  }

  function teacherLeaveConflict(teacherId, day, time, startDate, endDate) {
    return (state.teacherLeaves || []).find(leave => {
      if (!activeLeaveRecord(leave)) return false;
      if (String(leave.teacherId || "") !== String(teacherId || "")) return false;
      const leaveStart = dateOnly(leave.startDate || leave.date);
      const leaveEnd = dateOnly(leave.endDate || leave.date || leaveStart);
      if (!rangesOverlap(leaveStart, leaveEnd, startDate, endDate)) return false;
      let touchesDay = false;
      eachDateInRange(maxISODate(leaveStart, startDate), minISODate(leaveEnd, endDate), iso => {
        if (dayName(iso) === day) {
          touchesDay = true;
          return true;
        }
        return false;
      });
      if (!touchesDay) return false;
      const start = leave.startTime || leave.fromTime || "";
      const end = leave.endTime || leave.toTime || "";
      if (!start && !end) return true;
      const leaveStartMinutes = minutes(start || "00:00");
      const leaveEndMinutes = minutes(end || "23:59") + 1;
      const slotStart = minutes(time);
      const slotEnd = slotStart + 30;
      return slotStart < leaveEndMinutes && leaveStartMinutes < slotEnd;
    }) || null;
  }

  function publicHolidayConflict(day, startDate, endDate) {
    return (state.publicHolidays || []).find(holiday => {
      if (!activeRecord(holiday)) return false;
      const holidayStart = dateOnly(holiday.startDate || holiday.date);
      const holidayEnd = dateOnly(holiday.endDate || holiday.date || holidayStart);
      if (!rangesOverlap(holidayStart, holidayEnd, startDate, endDate)) return false;
      let touchesDay = false;
      eachDateInRange(maxISODate(holidayStart, startDate), minISODate(holidayEnd, endDate), iso => {
        if (dayName(iso) === day) {
          touchesDay = true;
          return true;
        }
        return false;
      });
      return touchesDay;
    }) || null;
  }

  function dateSpecificOverrideConflict(teacherId, day, time, startDate, endDate) {
    const teacher = teacherById(teacherId);
    return (teacher?.overrideSlots || []).find(slot => {
      if (!activeRecord(slot)) return false;
      if (!slot.date || !dateInRange(slot.date, startDate, endDate)) return false;
      if (dayName(slot.date) !== day) return false;
      if (!timeRangeOverlaps(slot.time || slot.startTime || "", slot.minutes || slot.duration || 30, time, 30)) return false;
      return slot.unavailable || ["off", "teacher_leave", "public_holiday"].includes(String(slot.status || "").toLowerCase());
    }) || null;
  }

  function enrollmentPendingConflict(candidate, ignoredId = "") {
    return enrollmentRegularSlotsDraft.find(slot => {
      if (String(slot.id || "") === String(ignoredId || "")) return false;
      if (String(slot.teacherId || "") !== String(candidate.teacherId || "")) return false;
      if (String(slot.day || "") !== String(candidate.day || "")) return false;
      if (!rangesOverlap(slot.startDate || "", slot.endDate || "", candidate.startDate || "", candidate.endDate || "")) return false;
      return timeRangeOverlaps(slot.time, 30, candidate.time, 30);
    }) || null;
  }

  function enrollmentAvailabilityReason(candidate) {
    const teacher = teacherById(candidate.teacherId);
    const startDate = dateOnly(candidate.startDate);
    const endDate = recurringValidationEnd(startDate, candidate.endDate);
    if (!teacher) return "Choose a valid active teacher.";
    if (candidate.subject && !(teacher.subjects || []).map(item => String(item || "").trim().toLowerCase()).includes(String(candidate.subject || "").trim().toLowerCase())) {
      return `${teacherNameById(candidate.teacherId)} does not teach ${candidate.subject}.`;
    }
    if (!startDate) return "Choose an effective start date first.";
    if (!candidate.day) return "Choose a day first.";
    if (!candidate.time) return "Choose an available time first.";
    if (!teacherOpenSlotCovers(teacher, candidate.day, candidate.time, startDate, endDate)) {
      return `${teacherNameById(candidate.teacherId)} is not open on ${candidate.day} at ${timeLabel(candidate.time)} for the selected period.`;
    }
    const recurring = teacherRecurringConflict(teacher, candidate.day, candidate.time, startDate, endDate, candidate.ignoredStudentSlotId || "");
    if (recurring) return `${teacherNameById(candidate.teacherId)} already has ${recurring.studentName || "another class"} on ${candidate.day} at ${timeLabel(recurring.time || candidate.time)}.`;
    const booking = exactBookingConflict(candidate.teacherId, candidate.day, candidate.time, startDate, endDate, candidate.currentBookingId || "");
    if (booking) return `${teacherNameById(candidate.teacherId)} already has ${booking.studentName || "another class"} on ${dateLabel(dateOnly(booking.date))} at ${timeLabel(booking.time || candidate.time)}.`;
    const leave = teacherLeaveConflict(candidate.teacherId, candidate.day, candidate.time, startDate, endDate);
    if (leave) return `${teacherNameById(candidate.teacherId)} is on leave during this selected period.`;
    const holiday = publicHolidayConflict(candidate.day, startDate, startDate);
    if (holiday) return `${teacherNameById(candidate.teacherId)} is unavailable because of ${holiday.name || "a public holiday"} on the effective start date.`;
    const override = dateSpecificOverrideConflict(candidate.teacherId, candidate.day, candidate.time, startDate, endDate);
    if (override) return `${teacherNameById(candidate.teacherId)} has this slot marked unavailable on ${dateLabel(dateOnly(override.date))}.`;
    const pending = enrollmentPendingConflict(candidate, candidate.ignoredStudentSlotId || "");
    if (pending) return `This enrollment form already includes ${teacherNameById(candidate.teacherId)} on ${candidate.day} at ${timeLabel(candidate.time)}.`;
    return "";
  }

  function availableEnrollmentTimes() {
    const teacherId = $("crmEnrollmentTeacher")?.value || "";
    const day = selectedEnrollmentDay();
    if (!teacherId) return { disabled: true, placeholder: "Choose teacher first", times: [] };
    if (!day) return { disabled: true, placeholder: "Choose day first", times: [] };
    const teacher = teacherById(teacherId);
    const times = teacherGeneralOpenTimes(teacher, day);
    return { disabled: !times.length, placeholder: times.length ? "Choose available time" : "No available times", times };
  }

  function refreshEnrollmentAvailableTimes() {
    const timeSelect = $("crmEnrollmentTime");
    if (!timeSelect) return;
    const requestId = ++enrollmentAvailabilityRequest;
    const previous = timeSelect.value;
    timeSelect.disabled = true;
    timeSelect.innerHTML = `<option value="">Loading available times...</option>`;
    requestAnimationFrame(() => {
      if (requestId !== enrollmentAvailabilityRequest) return;
      const result = availableEnrollmentTimes();
      const keepPrevious = previous && result.times.includes(previous);
      timeSelect.innerHTML = `<option value="">${escapeHtml(result.placeholder)}</option>${result.times.map(time => `<option value="${escapeHtml(time)}" ${keepPrevious && time === previous ? "selected" : ""}>${escapeHtml(timeLabel(time))}</option>`).join("")}`;
      timeSelect.disabled = result.disabled;
    });
  }

  function resetEnrollmentSlotInputs() {
    $("crmEnrollmentTeacher").value = "";
    $("crmEnrollmentTime").value = "";
    $("crmEnrollmentRegularStartDate").value = "";
    $("crmEnrollmentRegularEndDate").value = "";
    renderEnrollmentDayChecks();
    refreshEnrollmentAvailableTimes();
  }

  function renderEnrollmentRegularSlots() {
    const list = $("crmEnrollmentRegularSlotList");
    if (!list) return;
    if (!enrollmentRegularSlotsDraft.length) {
      list.innerHTML = `<div class="subtle">No regular class added yet.</div>`;
      return;
    }
    list.innerHTML = enrollmentRegularSlotsDraft.map(slot => `<div class="crm-enrollment-slot">
      <div><strong>${escapeHtml(teacherNameById(slot.teacherId) || "Teacher")}</strong><div class="subtle">${escapeHtml(slot.day)} · ${escapeHtml(timeLabel(slot.time))} · ${escapeHtml(slot.subject || "")}${slot.startDate ? ` · from ${escapeHtml(dateLabel(slot.startDate))}` : ""}${slot.endDate ? ` to ${escapeHtml(dateLabel(slot.endDate))}` : ""}</div></div>
      <button class="btn ghost small" type="button" data-remove-enrollment-slot="${escapeHtml(slot.id)}">Remove</button>
    </div>`).join("");
  }

  function addEnrollmentRegularSlot() {
    const teacherId = $("crmEnrollmentTeacher").value;
    const days = selectedEnrollmentDays();
    const time = $("crmEnrollmentTime").value;
    const subject = $("crmEnrollmentRegularSubject").value;
    const startDate = dateOnly($("crmEnrollmentRegularStartDate").value);
    const endDate = dateOnly($("crmEnrollmentRegularEndDate").value);
    if (!teacherId || !days.length || !time) return setEnrollmentError("Choose teacher, one day, and time first.");
    if (days.length > 1) return setEnrollmentError("Choose only one day per regular slot. Add another slot for another weekday.");
    if (!startDate) return setEnrollmentError("Choose an effective start date before adding the regular slot.");
    if (!selectedEnrollmentSubjects().includes(subject)) return setEnrollmentError("Choose a regular subject that is included under Subject Taken.");
    if (endDate && !startDate) return setEnrollmentError("Choose an effective start date when using an end date.");
    if (startDate && endDate && endDate < startDate) return setEnrollmentError("Effective end date cannot be before the start date.");
    const conflict = days.map(day => enrollmentAvailabilityReason({ teacherId, day, time, startDate, endDate, subject })).find(Boolean);
    if (conflict) {
      return setEnrollmentError(conflict);
    }
    days.forEach(day => {
      enrollmentRegularSlotsDraft.push({ id: uid("student_slot"), teacherId, day, time, subject, startDate: startDate || "", endDate: endDate || "", createdAt: nowISO(), updatedAt: nowISO() });
    });
    setEnrollmentError("");
    resetEnrollmentSlotInputs();
    renderEnrollmentRegularSlots();
  }

  function removeEnrollmentRegularSlot(id) {
    enrollmentRegularSlotsDraft = enrollmentRegularSlotsDraft.filter(slot => String(slot.id) !== String(id));
    renderEnrollmentRegularSlots();
    refreshEnrollmentAvailableTimes();
  }

  function validateEnrollmentRegularSlots() {
    for (const slot of enrollmentRegularSlotsDraft) {
      const reason = enrollmentAvailabilityReason({
        teacherId: slot.teacherId,
        day: slot.day,
        time: slot.time,
        subject: slot.subject,
        startDate: slot.startDate,
        endDate: slot.endDate,
        ignoredStudentSlotId: slot.id
      });
      if (reason) return { ok: false, slot, reason };
    }
    return { ok: true };
  }

  function syncEnrollmentSlotsToTeachers(student, previousSlots = [], nextSlotsInput = null) {
    const nextSlots = (nextSlotsInput || enrollmentRegularSlotsDraft).map(slot => ({ ...slot }));
    const nextIds = new Set(nextSlots.map(slot => slot.id));
    const previousIds = new Set(previousSlots.map(slot => slot.id).filter(Boolean));
    const affected = new Set([...previousSlots, ...nextSlots].map(slot => slot.teacherId).filter(Boolean));
    const now = nowISO();
    activeTeachers().forEach(teacher => {
      let changed = false;
      teacher.regularSlots ||= [];
      teacher.regularSlots = teacher.regularSlots.map(slot => {
        const linked = String(slot.studentId || "") === String(student.id || "") || previousIds.has(slot.studentSlotId);
        if (!linked || (slot.studentSlotId && nextIds.has(slot.studentSlotId))) return slot;
        changed = true;
        return { ...slot, deleted: true, archived: true, deletedAt: now, updatedAt: now, updatedBy: currentUser()?.email || "crm" };
      });
      nextSlots.forEach(studentSlot => {
        if (String(studentSlot.teacherId || "") !== String(teacher.id || "")) return;
        let teacherSlot = teacher.regularSlots.find(slot => slot.studentSlotId === studentSlot.id);
        if (!teacherSlot) {
          teacherSlot = { id: studentSlot.teacherSlotId || deterministicId("slot", studentSlot.id), source: "student-profile", locked: true, createdAt: now };
          teacher.regularSlots.push(teacherSlot);
        }
        Object.assign(teacherSlot, {
          studentId: student.id,
          studentSlotId: studentSlot.id,
          studentName: student.name,
          day: studentSlot.day,
          time: studentSlot.time,
          subject: studentSlot.subject,
          startDate: studentSlot.startDate || "",
          endDate: studentSlot.endDate || "",
          locked: true,
          unavailable: false,
          deleted: false,
          archived: false,
          updatedAt: now,
          updatedBy: currentUser()?.email || "crm"
        });
        changed = true;
      });
      if (changed || affected.has(teacher.id)) {
        teacher.updatedAt = now;
        teacher.updatedBy = currentUser()?.email || "crm";
        markTeacherDirty(teacher);
      }
    });
  }

  function studentIdForEnrollment(lead, name) {
    return $("crmEnrollmentStudentId").value
      || lead.linkedStudentId
      || lead.studentId
      || studentByName(name)?.id
      || deterministicId("student_crm", lead.id);
  }

  function enrollmentSlotRecordsForStudent(studentId) {
    const now = nowISO();
    return enrollmentRegularSlotsDraft.map(slot => ({
      ...slot,
      id: slot.id || uid("student_slot"),
      teacherSlotId: slot.teacherSlotId || deterministicId("slot", slot.id || `${studentId}_${slot.teacherId}_${slot.day}_${slot.time}`),
      studentId,
      type: "regular class",
      minutes: Number(slot.minutes || 30),
      startDate: dateOnly(slot.startDate),
      endDate: dateOnly(slot.endDate),
      createdAt: slot.createdAt || now,
      updatedAt: now,
      updatedBy: currentUser()?.email || "crm"
    }));
  }

  function registerStudentWithRegularClasses({ lead, studentData, regularSlots }) {
    const id = studentData.id;
    let student = studentById(id);
    const isNew = !student;
    if (!student) {
      student = { id, createdAt: nowISO(), regularSlots: [] };
      state.students.unshift(student);
    }
    const previousRegularSlots = Array.isArray(student.regularSlots) ? student.regularSlots.map(slot => ({ ...slot })) : [];
    Object.assign(student, {
      ...studentData,
      id,
      regularSlots,
      updatedAt: nowISO(),
      updatedBy: currentUser()?.email || "crm"
    });
    syncEnrollmentSlotsToTeachers(student, previousRegularSlots, regularSlots);
    markStudentDirty(student);
    return { student, isNew };
  }

  function leadSubject(lead) {
    if (Array.isArray(lead.subjects) && lead.subjects.length) return lead.subjects[0];
    return lead.subject || "";
  }

  function slotOpenForTeacher(teacherId, date, time, currentBookingId = "") {
    if (!teacherId || !date || !time) return false;
    const teacher = (state.teachers || []).find(item => String(item.id) === String(teacherId));
    if (!teacher) return false;
    const weekday = dayName(date);
    const hasOpenSlot = (teacher.regularSlots || []).some(slot => {
      const slotTime = String(slot.time || slot.startTime || "");
      if (slotTime !== time || String(slot.day || slot.weekday || "") !== weekday) return false;
      if (slot.studentName || slot.studentId) return false;
      if (slot.status === "off" || slot.unavailable) return false;
      if (slot.startDate && dateOnly(slot.startDate) > date) return false;
      if (slot.endDate && dateOnly(slot.endDate) < date) return false;
      return true;
    });
    const occupied = (state.bookings || []).some(booking => {
      if (String(booking.id || "") === String(currentBookingId || "")) return false;
      if (booking.archived || booking.deleted || booking.status === "deleted") return false;
      if (["cancelled", "teacher_leave", "public_holiday"].includes(String(booking.status || "").toLowerCase())) return false;
      return String(booking.teacherId || "") === String(teacherId)
        && dateOnly(booking.date) === date
        && String(booking.time || booking.startTime || "") === time;
    });
    return hasOpenSlot && !occupied;
  }

  function teacherOptions(selected = "") {
    return `<option value="">Choose teacher</option>${activeTeachers().map(teacher => `<option value="${escapeHtml(teacher.id)}" ${String(teacher.id) === String(selected) ? "selected" : ""}>${escapeHtml(teacher.name || teacher.teacherName || "Teacher")}</option>`).join("")}`;
  }

  function availableTimeOptions(lead, kind, teacherId, date, selected = "") {
    if (!teacherId) return `<option value="">Choose teacher first</option>`;
    if (!date) return `<option value="">Choose date first</option>`;
    const config = CRM_SESSION[kind];
    const currentBookingId = lead[config.booking] || "";
    const options = timeOptions().filter(time => slotOpenForTeacher(teacherId, date, time, currentBookingId));
    if (selected && !options.includes(selected)) options.push(selected);
    options.sort((a, b) => minutes(a) - minutes(b));
    return `<option value="">${options.length ? "Choose available slot" : "No available slots"}</option>${options.map(time => `<option value="${escapeHtml(time)}" ${time === selected ? "selected" : ""}>${escapeHtml(timeLabel(time))}${selected === time && !slotOpenForTeacher(teacherId, date, time, currentBookingId) ? " (existing booking)" : ""}</option>`).join("")}`;
  }

  function leadMatchesFilters(lead) {
    if (lead.archived || isOldImportedLead(lead)) return false;
    const month = $("leadMonthFilter")?.value || "all";
    const sales = $("leadSalesFilter")?.value || "all";
    const status = $("leadFilterStatus")?.value || "all";
    const urgency = $("leadFilterUrgency")?.value || "all";
    const search = String($("leadSearch")?.value || "").trim().toLowerCase();
    if (month !== "all" && monthKey(lead.createdAt || lead.addedAt || lead.date || lead.updatedAt) !== month) return false;
    if (sales !== "all" && leadSalespersonKey(lead) !== sales) return false;
    if (status !== "all" && leadStatus(lead) !== status) return false;
    if (urgency !== "all" && (lead.urgency || "warm") !== urgency) return false;
    if (search) {
      const text = [lead.childName, lead.parentName, lead.parentPhone, lead.parentEmail, lead.source, lead.salesperson, lead.notes].join(" ").toLowerCase();
      if (!text.includes(search)) return false;
    }
    const fieldFilters = {
      leadFilterChild: [lead.childName, lead.childAge].join(" "),
      leadFilterParent: [lead.parentName, lead.parentPhone].join(" "),
      leadFilterSubject: (lead.subjects || []).join(", "),
      leadFilterSource: lead.source || "",
      leadFilterSalesperson: lead.salesperson || "",
      leadFilterPackage: lead.packageInterested || "",
      leadFilterNotes: lead.notes || ""
    };
    for (const [id, value] of Object.entries(fieldFilters)) {
      const filter = String($(id)?.value || "").trim().toLowerCase();
      if (filter && !String(value || "").toLowerCase().includes(filter)) return false;
    }
    const from = $("leadFilterFollowFrom")?.value || "";
    const to = $("leadFilterFollowTo")?.value || "";
    if (from && (!lead.nextFollowUp || lead.nextFollowUp < from)) return false;
    if (to && (!lead.nextFollowUp || lead.nextFollowUp > to)) return false;
    const assessment = $("leadFilterAssessment")?.value || "";
    if (assessment && lead.assessmentDate !== assessment) return false;
    const trial = $("leadFilterTrial")?.value || "";
    if (trial && lead.trialDate !== trial && lead.trialDate2 !== trial) return false;
    return true;
  }

  function filteredLeads() {
    const leads = (state.leads || []).filter(leadMatchesFilters);
    if (currentSort.key) {
      const field = currentSort.key === "child" ? "childName" : currentSort.key === "parent" ? "parentName" : "";
      if (field) leads.sort((a, b) => {
        const compared = String(a[field] || "").localeCompare(String(b[field] || ""), undefined, { sensitivity: "base" });
        return (currentSort.direction === "asc" ? compared : -compared) || leadAddedTime(b) - leadAddedTime(a);
      });
      return leads;
    }
    return leads.sort((a, b) => leadAddedTime(b) - leadAddedTime(a) || leadLatestTime(b) - leadLatestTime(a));
  }

  function hydrateFilters() {
    const months = [...new Set((state.leads || []).filter(lead => !lead.archived && !isOldImportedLead(lead)).map(lead => monthKey(lead.createdAt || lead.addedAt || lead.date || lead.updatedAt)).filter(Boolean))].sort().reverse();
    $("leadMonthFilter").innerHTML = `<option value="all">All Months</option>${months.map(key => `<option value="${escapeHtml(key)}" ${key === CURRENT_MONTH ? "selected" : ""}>${escapeHtml(monthLabel(key))}</option>`).join("")}`;
    const sales = [...new Set((state.leads || []).map(leadSalespersonKey))].sort();
    $("leadSalesFilter").innerHTML = `<option value="all">All Sales</option>${sales.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}`;
    $("leadFilterStatus").innerHTML = `<option value="all">All Status</option>${LEAD_STATUSES.map(item => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("")}`;
    $("leadFilterUrgency").innerHTML = `<option value="all">All Urgency</option>${URGENCIES.map(item => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("")}`;
    $("leadStatus").innerHTML = LEAD_STATUSES.map(item => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("");
    $("leadUrgency").innerHTML = URGENCIES.map(item => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("");
    const packages = [...new Set([
      ...(state.students || []).map(student => student.package),
      ...(state.leads || []).map(lead => lead.packageInterested)
    ].filter(Boolean))].sort();
    if ($("packageOptions")) $("packageOptions").innerHTML = packages.map(pkg => `<option value="${escapeHtml(pkg)}"></option>`).join("");
  }

  function renderSummary() {
    const month = ($("leadMonthFilter")?.value || "all") === "all" ? CURRENT_MONTH : $("leadMonthFilter").value;
    const sales = $("leadSalesFilter")?.value || "all";
    const leads = (state.leads || [])
      .filter(lead => !lead.archived && !isOldImportedLead(lead))
      .filter(lead => monthKey(lead.createdAt || lead.addedAt || lead.date || lead.updatedAt) === month)
      .filter(lead => sales === "all" || leadSalespersonKey(lead) === sales);
    const contacted = leads.filter(lead => leadStatus(lead) !== "New Contact").length;
    const trialBooked = leads.filter(lead => leadStatus(lead) === "Trial Class" || lead.trialDate || lead.trialDate2 || lead.trialBookingId || lead.trialBookingId2).length;
    const enrolled = leads.filter(lead => isCrmFinalStatus(leadStatus(lead))).length;
    const pending = leads.filter(lead => !isCrmFinalStatus(leadStatus(lead)) && !["Lost", "Not Interested"].includes(leadStatus(lead))).length;
    $("leadMonthSummary").innerHTML = [
      ["Total Leads", leads.length],
      ["Contacted", contacted],
      ["Trial Booked", trialBooked],
      ["Registered", enrolled],
      ["Pending", pending]
    ].map(([label, value]) => `<div class="metric"><span class="subtle">${escapeHtml(label)}</span><strong>${value}</strong><span class="subtle">${escapeHtml(monthLabel(month))}</span></div>`).join("");
  }

  function renderReminders() {
    const box = $("leadReminderBox");
    if (!box) return;
    const today = dateOnly(new Date().toISOString());
    const reminders = (state.leads || []).filter(lead => !lead.archived && !isOldImportedLead(lead) && lead.nextFollowUp && lead.nextFollowUp <= today && !isCrmFinalStatus(leadStatus(lead)) && !["Lost", "Not Interested"].includes(leadStatus(lead)));
    box.innerHTML = `<button class="metric" id="openLeadActionModalBtn" style="width:100%;"><span class="subtle">CRM Needs Action</span><strong>${reminders.length}</strong><span class="subtle">Active leads that require follow-up or a status update.</span></button>`;
  }

  function renderColumnControls() {
    const visible = new Set(visibleColumnKeys());
    $("leadColumnsPanel").innerHTML = `
      <div class="row spread"><strong>Visible Columns</strong><span class="subtle">${visible.size}/${COLUMNS.length}</span></div>
      <div class="crm-column-grid">
        ${COLUMNS.map(column => `<label><input type="checkbox" data-crm-lead-column="${escapeHtml(column.key)}" ${visible.has(column.key) ? "checked" : ""}> ${escapeHtml(column.label)}</label>`).join("")}
      </div>
      <div class="row">
        <button type="button" class="btn ghost small" id="leadColumnsSelectAllBtn">Select All</button>
        <button type="button" class="btn ghost small" id="leadColumnsDefaultBtn">Reset to Default</button>
      </div>`;
  }

  function setWorkspaceExpanded(expanded) {
    const leadList = $("leadList");
    const button = $("expandCrmWorkspaceBtn");
    const scrollTop = leadList?.scrollTop || 0;
    const scrollLeft = leadList?.scrollLeft || 0;
    workspaceExpanded = Boolean(expanded);
    document.body.classList.toggle("crm-workspace-expanded", workspaceExpanded);
    if (button) {
      button.textContent = workspaceExpanded ? "× Exit Workspace" : "⛶ Expand Workspace";
      button.setAttribute("aria-expanded", workspaceExpanded ? "true" : "false");
      button.setAttribute("aria-label", workspaceExpanded ? "Exit CRM lead list workspace" : "Expand CRM lead list workspace");
      button.title = workspaceExpanded ? "Exit CRM lead list workspace" : "Expand CRM lead list workspace";
    }
    requestAnimationFrame(() => {
      const current = $("leadList");
      if (!current) return;
      current.scrollTop = scrollTop;
      current.scrollLeft = scrollLeft;
    });
  }

  function handleWorkspaceEscape(event) {
    if (event.key !== "Escape" || !workspaceExpanded) return;
    const modal = $("leadProfileModal");
    if (modal && !modal.classList.contains("hide")) return;
    event.preventDefault();
    setWorkspaceExpanded(false);
  }

  function sortIndicator(key) {
    if (currentSort.key !== key) return "↕";
    return currentSort.direction === "asc" ? "↑" : "↓";
  }

  function tableHeader() {
    return `<thead><tr>${visibleColumnKeys().map(key => {
      const column = COLUMNS.find(item => item.key === key);
      if (!column) return "";
      return column.sortable
        ? `<th data-crm-col="${escapeHtml(key)}"><button type="button" class="lead-sort-btn" data-lead-sort="${escapeHtml(key)}">${escapeHtml(column.label)} <span class="lead-sort-indicator">${sortIndicator(key)}</span></button></th>`
        : `<th data-crm-col="${escapeHtml(key)}">${escapeHtml(column.label)}</th>`;
    }).join("")}</tr></thead>`;
  }

  function selectOptions(values, selected) {
    return values.map(value => `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`).join("");
  }

  function getLeadSchedulingState(lead) {
    const status = String(leadStatus(lead) || "").trim().toLowerCase();
    const isAssessment = status.includes("assessment");
    const isTrial = status.includes("trial");
    return {
      assessment: isAssessment ? "active" : "readonly",
      trial1: isTrial ? "active" : "readonly",
      trial2: isTrial ? "active" : "readonly"
    };
  }

  function readonlySessionDisplay(lead, kind) {
    const config = CRM_SESSION[kind];
    const teacherId = lead[config.teacher] || (kind === "trial2" ? lead.trialTeacherId || "" : "");
    const date = lead[config.date] || "";
    const time = lead[config.time] || "";
    return `<div class="crm-session-editor readonly" data-lead-id="${escapeHtml(lead.id || "")}" data-schedule-type="${escapeHtml(kind)}">
      <strong>${escapeHtml(config.title)}</strong>
      <div class="crm-readonly-grid">
        <span>Teacher</span><b>${escapeHtml(teacherNameById(teacherId) || "—")}</b>
        <span>Date</span><b>${escapeHtml(date ? dateLabel(date) : "—")}</b>
        <span>Time</span><b>${escapeHtml(time ? timeLabel(time) : "—")}</b>
      </div>
    </div>`;
  }

  function sessionEditor(lead, kind, options = {}) {
    const config = CRM_SESSION[kind];
    const mode = options.forceActive ? "active" : getLeadSchedulingState(lead)[kind];
    if (mode !== "active") return readonlySessionDisplay(lead, kind);
    const teacherId = lead[config.teacher] || (kind === "trial2" ? lead.trialTeacherId || "" : "");
    const date = lead[config.date] || "";
    const time = lead[config.time] || "";
    const timeChoices = availableTimeOptions(lead, kind, teacherId, date, time);
    const timeDisabled = !teacherId || !date || (!time && timeChoices.includes("No available slots"));
    return `<div class="crm-session-editor active" data-lead-id="${escapeHtml(lead.id || "")}" data-schedule-type="${escapeHtml(kind)}">
      <strong>${escapeHtml(config.title)}</strong>
      <select data-crm-session="${escapeHtml(`${lead.id}|${kind}|teacher`)}" data-lead-id="${escapeHtml(lead.id || "")}" data-schedule-type="${escapeHtml(kind)}" data-field="teacher">${teacherOptions(teacherId)}</select>
      <input type="date" value="${escapeHtml(date)}" data-crm-session="${escapeHtml(`${lead.id}|${kind}|date`)}" data-lead-id="${escapeHtml(lead.id || "")}" data-schedule-type="${escapeHtml(kind)}" data-field="date" ${teacherId ? "" : "disabled"}>
      <select data-crm-session="${escapeHtml(`${lead.id}|${kind}|time`)}" data-lead-id="${escapeHtml(lead.id || "")}" data-schedule-type="${escapeHtml(kind)}" data-field="time" ${timeDisabled ? "disabled" : ""}>${timeChoices}</select>
    </div>`;
  }

  function scheduleCellHtml(lead, kind) {
    if (kind === "trial") return `${sessionEditor(lead, "trial1")}${sessionEditor(lead, "trial2")}`;
    return sessionEditor(lead, kind);
  }

  function updateLeadSchedulingState(leadId) {
    const lead = leadById(leadId);
    const row = document.querySelector(`[data-lead-row="${cssEscape(leadId)}"]`);
    if (!lead || !row) return;
    const assessment = row.querySelector('[data-crm-col="assessment"]');
    const trial = row.querySelector('[data-crm-col="trial"]');
    if (assessment) assessment.innerHTML = scheduleCellHtml(lead, "assessment");
    if (trial) trial.innerHTML = scheduleCellHtml(lead, "trial");
  }

  function updateProfileScheduling(lead) {
    const panel = $("leadProfileScheduling");
    if (!panel) return;
    if (!lead?.id) {
      panel.innerHTML = `<div class="subtle">Save the lead first before scheduling assessment or trial classes.</div>`;
      return;
    }
    panel.innerHTML = `
      <label>Assessment / Trial Scheduling</label>
      <div class="crm-profile-scheduling-grid">
        ${sessionEditor(lead, "assessment", { forceActive: true })}
        ${sessionEditor(lead, "trial1", { forceActive: true })}
        ${sessionEditor(lead, "trial2", { forceActive: true })}
      </div>
      <div class="subtle">Full Profile can edit all scheduling sections. Lead List quick editing follows the current lead status.</div>`;
  }

  function syncProfileScheduleDateInputs(lead) {
    if (!$("leadProfileModal") || $("leadProfileModal").classList.contains("hide")) return;
    if ($("leadId")?.value && String($("leadId").value) !== String(lead?.id || "")) return;
    if ($("leadAssessmentDate")) $("leadAssessmentDate").value = lead?.assessmentDate || "";
    if ($("leadTrialDate")) $("leadTrialDate").value = lead?.trialDate || "";
    if ($("leadTrialDate2")) $("leadTrialDate2").value = lead?.trialDate2 || "";
  }

  function cellHtml(key, lead) {
    const id = escapeHtml(lead.id || "");
    const cells = {
      created: `<td data-crm-col="created"><input type="date" value="${escapeHtml(leadAddedDate(lead))}" data-lead-quick="${id}|createdAt"></td>`,
      child: `<td data-crm-col="child"><input value="${escapeHtml(lead.childName || "")}" data-lead-quick="${id}|childName" placeholder="Child name"><input value="${escapeHtml(lead.childAge || "")}" data-lead-quick="${id}|childAge" placeholder="Age / year" style="margin-top:5px;"></td>`,
      parent: `<td data-crm-col="parent"><input value="${escapeHtml(lead.parentName || "")}" data-lead-quick="${id}|parentName" placeholder="Parent name"><input value="${escapeHtml(lead.parentPhone || "")}" data-lead-quick="${id}|parentPhone" placeholder="Phone / WhatsApp" style="margin-top:5px;"></td>`,
      phone: `<td data-crm-col="phone"><input value="${escapeHtml(lead.parentPhone || "")}" data-lead-quick="${id}|parentPhone" placeholder="Phone / WhatsApp"></td>`,
      email: `<td data-crm-col="email"><span class="subtle">${escapeHtml(lead.parentEmail || lead.email || "-")}</span></td>`,
      status: `<td data-crm-col="status"><select data-lead-quick="${id}|status">${selectOptions(LEAD_STATUSES, leadStatus(lead))}</select></td>`,
      salesperson: `<td data-crm-col="salesperson"><input value="${escapeHtml(lead.salesperson || "")}" data-lead-quick="${id}|salesperson" placeholder="Salesperson"></td>`,
      nextFollowUp: `<td data-crm-col="nextFollowUp"><input type="date" value="${escapeHtml(lead.nextFollowUp || "")}" data-lead-quick="${id}|nextFollowUp">${lead.followUpAuto ? `<span class="subtle">Auto-generated</span>` : ""}</td>`,
      source: `<td data-crm-col="source"><input value="${escapeHtml(lead.source || "")}" data-lead-quick="${id}|source" placeholder="Source"></td>`,
      remarks: `<td data-crm-col="remarks" style="min-width:220px;"><textarea data-lead-quick="${id}|notes" placeholder="Notes">${escapeHtml(lead.notes || "")}</textarea></td>`,
      subjects: `<td data-crm-col="subjects"><input value="${escapeHtml((lead.subjects || []).join(", "))}" data-lead-quick="${id}|subjects" placeholder="BC, BM"></td>`,
      urgency: `<td data-crm-col="urgency"><select data-lead-quick="${id}|urgency">${selectOptions(URGENCIES, lead.urgency || "warm")}</select></td>`,
      assessment: `<td data-crm-col="assessment">${scheduleCellHtml(lead, "assessment")}</td>`,
      trial: `<td data-crm-col="trial">${scheduleCellHtml(lead, "trial")}</td>`,
      package: `<td data-crm-col="package"><input value="${escapeHtml(lead.packageInterested || "")}" data-lead-quick="${id}|packageInterested" placeholder="Package"></td>`,
      actions: `<td data-crm-col="actions"><div class="row"><button class="btn small ghost" data-edit-lead="${id}">Full Profile</button><button class="btn small ghost" data-archive-lead="${id}">Archive</button></div></td>`
    };
    return cells[key] || "";
  }

  function groupedRows(leads) {
    const visible = visibleColumnKeys();
    const colspan = visible.length || 1;
    const groups = new Map();
    leads.slice(0, renderLimit).forEach(lead => {
      lead.id ||= uid("lead");
      const m = monthKey(lead.createdAt || lead.addedAt || lead.date || lead.updatedAt);
      const d = leadAddedDate(lead) || "unknown";
      if (!groups.has(m)) groups.set(m, new Map());
      if (!groups.get(m).has(d)) groups.get(m).set(d, []);
      groups.get(m).get(d).push(lead);
    });
    return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([m, dateGroups]) => {
      const monthCount = [...dateGroups.values()].reduce((sum, items) => sum + items.length, 0);
      const expanded = expandedMonths.has(m);
      let html = `<tr class="crm-month-row"><td colspan="${colspan}"><button class="crm-month-header" data-toggle-crm-month="${escapeHtml(m)}"><strong>${escapeHtml(monthLabel(m))} · ${monthCount} leads</strong><span class="chevron">${expanded ? "Collapse" : "Expand"}</span></button></td></tr>`;
      if (!expanded) return html;
      html += [...dateGroups.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([d, items]) => `
        <tr class="crm-date-row"><td colspan="${colspan}"><span>${escapeHtml(dateLabel(d))} · ${items.length} leads</span></td></tr>
        ${items.sort((a, b) => leadAddedTime(b) - leadAddedTime(a)).map(lead => `<tr data-lead-row="${escapeHtml(lead.id)}">${visible.map(key => cellHtml(key, lead)).join("")}</tr>`).join("")}
      `).join("");
      return html;
    }).join("");
  }

  function renderLeads({ reset = false } = {}) {
    const started = performance.now();
    if (reset) renderLimit = CRM_BATCH;
    const filterStarted = performance.now();
    const leads = filteredLeads();
    const filterMs = performance.now() - filterStarted;
    const signature = JSON.stringify({
      count: state.leads.length,
      limit: renderLimit,
      month: $("leadMonthFilter")?.value,
      sales: $("leadSalesFilter")?.value,
      status: $("leadFilterStatus")?.value,
      urgency: $("leadFilterUrgency")?.value,
      search: $("leadSearch")?.value,
      columns: visibleColumnKeys(),
      expanded: [...expandedMonths].sort(),
      sort: currentSort
    });
    if (signature === lastRenderedSignature && !reset) return;
    lastRenderedSignature = signature;
    renderColumnControls();
    renderSummary();
    renderReminders();
    const htmlStarted = performance.now();
    const html = `<div class="table-wrap"><table class="lead-table">${tableHeader()}<tbody>${groupedRows(leads)}</tbody></table></div>`;
    const htmlMs = performance.now() - htmlStarted;
    const insertStarted = performance.now();
    $("leadList").innerHTML = html;
    const insertMs = performance.now() - insertStarted;
    $("leadCountText").textContent = `${Math.min(renderLimit, leads.length)} of ${leads.length} leads shown`;
    perfInfo("renderLeads", {
      totalMs: Math.round(performance.now() - started),
      filterMs: Math.round(filterMs),
      htmlMs: Math.round(htmlMs),
      insertMs: Math.round(insertMs),
      rowsRendered: Math.min(renderLimit, leads.length),
      filteredLeads: leads.length,
      crmNodes: document.querySelectorAll("#crm *").length,
      inputs: document.querySelectorAll("#crm input").length,
      selects: document.querySelectorAll("#crm select").length,
      textareas: document.querySelectorAll("#crm textarea").length
    });
    setStatus(`CRM rendered in ${Math.round(performance.now() - started)} ms.`);
  }

  function leadById(id) {
    return (state.leads || []).find(lead => String(lead.id || "") === String(id || ""));
  }

  function updateLeadRowOrRender(leadId) {
    const lead = leadById(leadId);
    const row = document.querySelector(`[data-lead-row="${cssEscape(leadId)}"]`);
    if (!lead || !row || !leadMatchesFilters(lead)) {
      renderLeads({ reset: true });
      return;
    }
    row.innerHTML = visibleColumnKeys().map(key => cellHtml(key, lead)).join("");
    renderSummary();
    renderReminders();
  }

  function openEnrollmentStudentForm(lead, previousStatus = "", sourceControl = null) {
    if (!lead?.id) return;
    const existingStudent = studentById(lead.studentId) || studentByName(lead.childName);
    pendingEnrollment = {
      leadId: lead.id,
      previousStatus: previousStatus || leadStatus(lead),
      sourceControl,
      saving: false
    };
    enrollmentRegularSlotsDraft = existingStudent?.regularSlots ? existingStudent.regularSlots.map(slot => ({ ...slot })) : [];
    $("crmEnrollmentLeadId").value = lead.id;
    $("crmEnrollmentStudentId").value = existingStudent?.id || "";
    $("crmEnrollmentLeadContext").textContent = `Creating a student profile from: ${enrollmentContextName(lead)}`;
    $("crmEnrollmentStudentName").value = cleanName(existingStudent?.name || lead.childName || "");
    $("crmEnrollmentParentName").value = existingStudent?.parentName || lead.parentName || "";
    $("crmEnrollmentParentPhone").value = existingStudent?.parentPhone || lead.parentPhone || "";
    $("crmEnrollmentParentEmail").value = existingStudent?.parentEmail || lead.parentEmail || lead.email || "";
    $("crmEnrollmentStudentStatus").value = existingStudent?.status || "registered";
    $("crmEnrollmentRegisteredStatus").value = existingStudent?.registeredStatus || "new";
    $("crmEnrollmentPackage").value = existingStudent?.package || lead.packageInterested || "";
    $("crmEnrollmentPackageAmount").value = existingStudent?.packageAmount || "";
    $("crmEnrollmentPackageClasses").value = existingStudent?.packageClasses || "";
    $("crmEnrollmentRegisteredRemark").value = existingStudent?.registeredRemark || "";
    $("crmEnrollmentPackageNotes").value = existingStudent?.packageNotes || lead.notes || "";
    setSelectedEnrollmentSubjects(existingStudent?.subjects?.length ? existingStudent.subjects : normalizeSubjectsInput(lead.subjects || lead.subject || ""));
    renderEnrollmentTeacherOptions();
    renderEnrollmentTimeOptions();
    renderEnrollmentDayChecks();
    renderEnrollmentRegularSlots();
    refreshEnrollmentAvailableTimes();
    setEnrollmentError("");
    $("crmEnrollmentSaveBtn").disabled = false;
    $("crmEnrollmentStudentModal").classList.remove("hide");
    setTimeout(() => $("crmEnrollmentStudentName")?.focus(), 0);
  }

  function closeEnrollmentStudentForm(cancelled = true) {
    if (cancelled && pendingEnrollment) {
      const lead = leadById(pendingEnrollment.leadId);
      if (lead) {
        lead.status = pendingEnrollment.previousStatus || leadStatus(lead);
        updateLeadRowOrRender(lead.id);
      }
      if (pendingEnrollment.sourceControl) pendingEnrollment.sourceControl.value = pendingEnrollment.previousStatus || "";
    }
    $("crmEnrollmentStudentModal")?.classList.add("hide");
    pendingEnrollment = null;
    enrollmentRegularSlotsDraft = [];
    setEnrollmentError("");
  }

  async function saveEnrollmentStudentFromModal() {
    if (!pendingEnrollment || pendingEnrollment.saving) return;
    const lead = leadById($("crmEnrollmentLeadId").value);
    if (!lead) return setEnrollmentError("The CRM lead could not be found. Please refresh and try again.");
    const name = cleanName($("crmEnrollmentStudentName").value);
    const subjects = selectedEnrollmentSubjects();
    const packageName = $("crmEnrollmentPackage").value.trim();
    if (!name) return setEnrollmentError("Student name is required.");
    if (!subjects.length) return setEnrollmentError("Choose at least one subject taken.");
    if (!packageName) return setEnrollmentError("Choose or type the student's package first.");
    if (!enrollmentRegularSlotsDraft.length) return setEnrollmentError("Add at least one regular class teacher, day and time to complete enrollment.");
    const slotValidation = validateEnrollmentRegularSlots();
    if (!slotValidation.ok) {
      setEnrollmentError(`${slotValidation.reason} The student has not been created.`);
      refreshEnrollmentAvailableTimes();
      return;
    }
    pendingEnrollment.saving = true;
    $("crmEnrollmentSaveBtn").disabled = true;
    setEnrollmentError("");
    const rollbackState = {
      leads: safeJson(state.leads || []),
      students: safeJson(state.students || []),
      teachers: safeJson(state.teachers || []),
      activityLogs: safeJson(state.activityLogs || []),
      dirtyLeads: new Map(dirtyLeads),
      dirtyStudents: new Map(dirtyStudents),
      dirtyTeachers: new Map(dirtyTeachers),
      dirtyActivityLogs: new Map(dirtyActivityLogs)
    };
    try {
      setStatus("Creating student and regular classes...");
      const id = studentIdForEnrollment(lead, name);
      const regularSlots = enrollmentSlotRecordsForStudent(id);
      const { student, isNew } = registerStudentWithRegularClasses({
        lead,
        regularSlots,
        studentData: {
          id,
          name,
          parentName: $("crmEnrollmentParentName").value.trim(),
          parentPhone: $("crmEnrollmentParentPhone").value.trim(),
          parentEmail: $("crmEnrollmentParentEmail").value.trim(),
          subjects,
          subject: subjects[0] || "",
          package: packageName,
          packageAmount: Number($("crmEnrollmentPackageAmount").value || 0),
          packageClasses: Number($("crmEnrollmentPackageClasses").value || 0),
          packageNotes: $("crmEnrollmentPackageNotes").value.trim(),
          registeredStatus: $("crmEnrollmentRegisteredStatus").value || "new",
          registeredRemark: $("crmEnrollmentRegisteredRemark").value.trim(),
          status: $("crmEnrollmentStudentStatus").value || "registered",
          crmLeadId: lead.id,
          registeredAt: nowISO(),
          registeredBy: currentUser()?.email || "crm"
        }
      });
      Object.assign(lead, {
        status: CRM_REGISTERED_STATUS,
        pendingEnrollment: false,
        registeredAt: nowISO(),
        registeredBy: currentUser()?.email || "crm",
        enrolledAt: dateOnly(nowISO()),
        enrolledBy: currentUser()?.email || "crm",
        studentId: student.id,
        linkedStudentId: student.id,
        packageInterested: student.package,
        subjects: [...student.subjects],
        nextFollowUp: "",
        followUpAuto: true,
        statusChangedAt: nowISO(),
        updatedAt: nowISO(),
        updatedBy: currentUser()?.email || "crm"
      });
      markLeadDirty(lead);
      logAction(isNew ? "Student Added" : "Student Updated", student.name, `Created from CRM lead ${enrollmentContextName(lead)}.`);
      logAction("CRM Lead Registered", lead.childName || lead.parentName || lead.id, `Linked student: ${student.name}.`);
      const synced = await saveState({ immediate: true, waitForActive: true });
      if (!synced) throw new Error(lastSaveErrorMessage || "Unable to sync registration to Neon. Please retry.");
      $("crmEnrollmentStudentId").value = student.id;
      $("crmEnrollmentStudentModal").classList.add("hide");
      pendingEnrollment = null;
      enrollmentRegularSlotsDraft = [];
      updateLeadRowOrRender(lead.id);
      hydrateFilters();
      setStatus(`Student registered successfully. ${student.name} has been added to the Student List, and the regular class schedule has been added to the Weekly Timetable.`, "success");
    } catch (err) {
      state.leads = rollbackState.leads || [];
      state.students = rollbackState.students || [];
      state.teachers = rollbackState.teachers || [];
      state.activityLogs = rollbackState.activityLogs || [];
      dirtyLeads = rollbackState.dirtyLeads;
      dirtyStudents = rollbackState.dirtyStudents;
      dirtyTeachers = rollbackState.dirtyTeachers;
      dirtyActivityLogs = rollbackState.dirtyActivityLogs;
      clearTimeout(saveTimer);
      if (hasDirtyChanges()) queueSave();
      setEnrollmentError(`Student could not be registered. ${err.message || err}`);
      $("crmEnrollmentSaveBtn").disabled = false;
      pendingEnrollment.saving = false;
    }
  }

  function automaticFollowUp(lead) {
    const base = new Date();
    if (leadStatus(lead) === "New Contact") base.setDate(base.getDate() + 7);
    else if (leadStatus(lead) === "Follow Up") base.setDate(base.getDate() + 14);
    else base.setDate(base.getDate() + 7);
    return dateOnly(base.toISOString());
  }

  function updateLeadField(lead, field, value) {
    if (field === "status") value = canonicalLeadStatusAfterSave(value);
    if (field === "subjects") lead.subjects = [...new Set(String(value).split(",").map(item => item.trim()).filter(Boolean))];
    else if (field === "createdAt") lead.createdAt = value ? `${value}T12:00:00.000Z` : "";
    else lead[field] = value;
    if (field === "status") {
      lead.statusChangedAt = nowISO();
      if (!lead.nextFollowUp || lead.followUpAuto) {
        lead.nextFollowUp = automaticFollowUp(lead);
        lead.followUpAuto = true;
      }
    }
    if (field === "nextFollowUp") lead.followUpAuto = false;
    lead.updatedAt = nowISO();
    lead.updatedBy = currentUser()?.email || "crm";
    markLeadDirty(lead);
  }

  function updateFiltersSoon() {
    clearTimeout(window.__crmFilterTimer);
    window.__crmFilterTimer = setTimeout(() => renderLeads({ reset: true }), 180);
  }

  async function updateCrmSession(control) {
    const [leadId, kind, field] = String(control.dataset.crmSession || "").split("|");
    const lead = leadById(leadId);
    const config = CRM_SESSION[kind];
    if (!lead || !config) return;
    const inProfile = Boolean(control.closest("#leadProfileModal"));
    if (!inProfile && getLeadSchedulingState(lead)[kind] !== "active") return;
    const value = String(control.value || "");
    const previous = {
      teacherId: lead[config.teacher] || (kind === "trial2" ? lead.trialTeacherId || "" : ""),
      date: lead[config.date] || "",
      time: lead[config.time] || ""
    };
    const selection = {
      teacherId: previous.teacherId,
      date: previous.date,
      time: previous.time
    };
    if (field === "teacher") {
      selection.teacherId = value;
      if (kind === "trial1" && !lead.trialTeacherId2) lead.trialTeacherId2 = value;
    }
    if (field === "date") selection.date = value;
    if (field === "time") selection.time = value;
    const currentBookingId = lead[config.booking] || "";
    if (field === "time" && selection.teacherId && selection.date && selection.time && !slotOpenForTeacher(selection.teacherId, selection.date, selection.time, currentBookingId)) {
      control.value = previous.time || "";
      setStatus("This selected slot is not open for the chosen teacher.", "error");
      return;
    }
    if (field !== "time" && selection.teacherId && selection.date && selection.time && !slotOpenForTeacher(selection.teacherId, selection.date, selection.time, currentBookingId)) {
      selection.time = "";
    }
    lead[config.teacher] = selection.teacherId;
    lead[config.date] = selection.date;
    lead[config.time] = selection.time;
    if (selection.teacherId && selection.date && selection.time) {
      const bookingId = currentBookingId || uid("crm_booking");
      const teacher = (state.teachers || []).find(item => String(item.id) === String(selection.teacherId));
      let booking = (state.bookings || []).find(item => String(item.id) === String(bookingId));
      if (!booking) {
        booking = { id: bookingId, createdAt: nowISO(), source: "crm_leads", crmLeadId: lead.id, crmSessionKind: kind };
        state.bookings.push(booking);
      }
      Object.assign(booking, {
        teacherId: selection.teacherId,
        teacherName: teacher?.name || teacher?.teacherName || "",
        studentId: lead.studentId || "",
        studentName: lead.childName || lead.parentName || "CRM Lead",
        subject: leadSubject(lead),
        type: config.type,
        status: "booked",
        date: selection.date,
        day: dayName(selection.date),
        time: selection.time,
        updatedAt: nowISO(),
        updatedBy: currentUser()?.email || "crm"
      });
      markBookingDirty(booking);
      lead[config.booking] = booking.id;
      lead.status = config.status;
      lead.statusChangedAt = nowISO();
      logAction("CRM Session Rescheduled", lead.childName || lead.parentName || "Lead", `${config.title} set to ${selection.date} ${timeLabel(selection.time)}.`);
    }
    lead.updatedAt = nowISO();
    lead.updatedBy = currentUser()?.email || "crm";
    markLeadDirty(lead);
    queueSave(true);
    if (inProfile) {
      syncProfileScheduleDateInputs(lead);
      updateProfileScheduling(lead);
      updateLeadSchedulingState(lead.id);
    } else if (field !== "time") {
      updateLeadSchedulingState(lead.id);
    }
  }

  function openLeadModal(lead = null) {
    $("leadProfileModalTitle").textContent = lead ? "Edit Lead" : "Add Lead";
    $("leadId").value = lead?.id || "";
    $("leadParentName").value = lead?.parentName || "";
    $("leadParentPhone").value = lead?.parentPhone || "";
    $("leadChildName").value = lead?.childName || "";
    $("leadChildAge").value = lead?.childAge || "";
    $("leadSource").value = lead?.source || "";
    $("leadSalesperson").value = lead?.salesperson || "";
    $("leadStatus").value = leadStatus(lead || {});
    $("leadUrgency").value = lead?.urgency || "warm";
    $("leadMotherTongue").value = lead?.motherTongue || "";
    $("leadPackage").value = lead?.packageInterested || "";
    $("leadPreferredTime").value = lead?.preferredTime || "";
    $("leadNextFollowUp").value = lead?.nextFollowUp || "";
    $("leadAssessmentDate").value = lead?.assessmentDate || "";
    $("leadTrialDate").value = lead?.trialDate || "";
    $("leadTrialDate2").value = lead?.trialDate2 || "";
    $("leadStatusChangedAt").value = dateOnly(lead?.statusChangedAt || "");
    $("leadNotes").value = lead?.notes || "";
    const subjects = new Set(lead?.subjects || []);
    $("leadSubjectChecks").innerHTML = LEAD_SUBJECTS.map(subject => `<label class="chip"><input type="checkbox" value="${escapeHtml(subject)}" ${subjects.has(subject) ? "checked" : ""}> ${escapeHtml(subject)}</label>`).join("");
    updateProfileScheduling(lead);
    $("leadProfileModal").classList.remove("hide");
  }

  function closeModal() {
    $("leadProfileModal").classList.add("hide");
  }

  function saveLeadFromModal() {
    let lead = leadById($("leadId").value);
    const isNew = !lead;
    const requestedStatus = $("leadStatus").value;
    const previousStatus = leadStatus(lead || {});
    const hasLinkedStudent = Boolean((lead?.studentId && studentById(lead.studentId)) || (lead?.linkedStudentId && studentById(lead.linkedStudentId)));
    const shouldOpenEnrollment = isEnrollmentActionStatus(requestedStatus) && !hasLinkedStudent;
    if (!lead) {
      lead = { id: uid("lead"), createdAt: nowISO(), status: "New Contact", urgency: "warm" };
      state.leads.unshift(lead);
    }
    Object.assign(lead, {
      parentName: $("leadParentName").value.trim(),
      parentPhone: $("leadParentPhone").value.trim(),
      childName: $("leadChildName").value.trim(),
      childAge: $("leadChildAge").value.trim(),
      source: $("leadSource").value.trim(),
      salesperson: $("leadSalesperson").value.trim(),
      status: shouldOpenEnrollment ? (isEnrollmentActionStatus(previousStatus) ? "New Contact" : previousStatus) : canonicalLeadStatusAfterSave(requestedStatus),
      urgency: $("leadUrgency").value,
      motherTongue: $("leadMotherTongue").value.trim(),
      packageInterested: $("leadPackage").value.trim(),
      preferredTime: $("leadPreferredTime").value.trim(),
      nextFollowUp: $("leadNextFollowUp").value,
      assessmentDate: $("leadAssessmentDate").value,
      trialDate: $("leadTrialDate").value,
      trialDate2: $("leadTrialDate2").value,
      statusChangedAt: $("leadStatusChangedAt").value || lead.statusChangedAt || nowISO(),
      notes: $("leadNotes").value.trim(),
      subjects: [...$("leadSubjectChecks").querySelectorAll("input:checked")].map(input => input.value),
      updatedAt: nowISO(),
      updatedBy: currentUser()?.email || "crm"
    });
    if (!lead.nextFollowUp) {
      lead.nextFollowUp = automaticFollowUp(lead);
      lead.followUpAuto = true;
    }
    markLeadDirty(lead);
    logAction(isNew ? "CRM Lead Created" : "CRM Lead Updated", lead.childName || lead.parentName || lead.parentPhone || "Lead");
    closeModal();
    if (shouldOpenEnrollment) {
      updateLeadRowOrRender(lead.id);
      queueSave(true);
      openEnrollmentStudentForm(lead, lead.status);
      return;
    }
    hydrateFilters();
    renderLeads({ reset: true });
    queueSave(true);
  }

  function exportCsv() {
    const rows = filteredLeads();
    const headers = ["Created Date", "Child", "Parent", "Phone", "Status", "Salesperson", "Next Follow-up", "Source", "Subjects", "Notes"];
    const csv = [headers, ...rows.map(lead => [
      leadAddedDate(lead),
      lead.childName || "",
      lead.parentName || "",
      lead.parentPhone || "",
      leadStatus(lead),
      lead.salesperson || "",
      lead.nextFollowUp || "",
      lead.source || "",
      (lead.subjects || []).join(", "),
      lead.notes || ""
    ])].map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `crm-leads-${dateOnly(new Date().toISOString())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportPdf() {
    const rows = filteredLeads();
    const win = window.open("", "_blank");
    win.document.write(`<title>CRM Leads</title><style>body{font-family:Arial,sans-serif;padding:24px}table{width:100%;border-collapse:collapse;font-size:12px}td,th{border:1px solid #ddd;padding:6px;text-align:left}th{background:#eafbf4}</style><h1>CRM Leads</h1><table><thead><tr><th>No.</th><th>Created</th><th>Child</th><th>Parent</th><th>Phone</th><th>Status</th><th>Salesperson</th></tr></thead><tbody>${rows.map((lead, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(leadAddedDate(lead))}</td><td>${escapeHtml(lead.childName || "")}</td><td>${escapeHtml(lead.parentName || "")}</td><td>${escapeHtml(lead.parentPhone || "")}</td><td>${escapeHtml(leadStatus(lead))}</td><td>${escapeHtml(lead.salesperson || "")}</td></tr>`).join("")}</tbody></table>`);
    win.document.close();
    win.print();
  }

  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;
    $("openLeadModalBtn").onclick = () => openLeadModal();
    $("expandCrmWorkspaceBtn").onclick = () => setWorkspaceExpanded(!workspaceExpanded);
    $("saveLeadBtn").onclick = saveLeadFromModal;
    $("createStudentFromLeadBtn").onclick = () => {
      const lead = leadById($("leadId").value);
      if (!lead) {
        setStatus("Save this CRM lead first before creating a student profile.", "error");
        return;
      }
      closeModal();
      openEnrollmentStudentForm(lead, leadStatus(lead));
    };
    $("crmEnrollmentSaveBtn").onclick = saveEnrollmentStudentFromModal;
    $("crmEnrollmentCancelBtn").onclick = () => closeEnrollmentStudentForm(true);
    document.querySelectorAll("[data-enrollment-cancel]").forEach(btn => btn.onclick = () => closeEnrollmentStudentForm(true));
    $("crmEnrollmentAddSlotBtn").onclick = addEnrollmentRegularSlot;
    $("crmEnrollmentSubjectChecks").addEventListener("change", renderEnrollmentSubjectOptions);
    $("crmEnrollmentTeacher").addEventListener("change", () => {
      $("crmEnrollmentTime").value = "";
      refreshEnrollmentAvailableTimes();
    });
    $("crmEnrollmentDayChecks").addEventListener("change", event => {
      const input = event.target.closest("input");
      enforceSingleEnrollmentDay(input);
      $("crmEnrollmentTime").value = "";
      refreshEnrollmentAvailableTimes();
    });
    $("crmEnrollmentRegularSlotList").addEventListener("click", event => {
      const remove = event.target.closest("[data-remove-enrollment-slot]");
      if (remove) removeEnrollmentRegularSlot(remove.dataset.removeEnrollmentSlot);
    });
    document.querySelectorAll("[data-close]").forEach(btn => btn.onclick = closeModal);
    $("exportLeadListCsvBtn").onclick = exportCsv;
    $("exportLeadListPdfBtn").onclick = exportPdf;
    $("leadColumnsBtn").onclick = () => $("leadColumnsMenuWrap").classList.toggle("open");
    $("leadFiltersBtn").onclick = () => $("leadFiltersMenuWrap").classList.toggle("open");
    $("leadColumnsPanel").addEventListener("change", event => {
      const input = event.target.closest("[data-crm-lead-column]");
      if (!input) return;
      setVisibleColumns([...$("leadColumnsPanel").querySelectorAll("[data-crm-lead-column]:checked")].map(item => item.dataset.crmLeadColumn));
    });
    $("leadColumnsPanel").addEventListener("click", event => {
      if (event.target.id === "leadColumnsSelectAllBtn") setVisibleColumns(COLUMNS.map(column => column.key));
      if (event.target.id === "leadColumnsDefaultBtn") setVisibleColumns(DEFAULT_COLUMNS);
    });
    ["leadMonthFilter", "leadSalesFilter", "leadFilterStatus", "leadFilterUrgency"].forEach(id => $(id).addEventListener("change", () => renderLeads({ reset: true })));
    ["leadSearch", "leadFilterChild", "leadFilterParent", "leadFilterSubject", "leadFilterSource", "leadFilterSalesperson", "leadFilterFollowFrom", "leadFilterFollowTo", "leadFilterAssessment", "leadFilterTrial", "leadFilterPackage", "leadFilterNotes"].forEach(id => $(id).addEventListener("input", updateFiltersSoon));
    $("clearLeadColumnFiltersBtn").onclick = () => {
      ["leadFilterChild", "leadFilterParent", "leadFilterSubject", "leadFilterSource", "leadFilterSalesperson", "leadFilterFollowFrom", "leadFilterFollowTo", "leadFilterAssessment", "leadFilterTrial", "leadFilterPackage", "leadFilterNotes"].forEach(id => { $(id).value = ""; });
      $("leadFilterUrgency").value = "all";
      renderLeads({ reset: true });
    };
    $("leadList").addEventListener("scroll", () => {
      const node = $("leadList");
      if (node.scrollTop + node.clientHeight < node.scrollHeight - 240) return;
      const total = filteredLeads().length;
      if (renderLimit >= total) return;
      renderLimit = Math.min(total, renderLimit + CRM_BATCH);
      const top = node.scrollTop;
      renderLeads();
      requestAnimationFrame(() => { $("leadList").scrollTop = top; });
    });
    document.addEventListener("click", event => {
      const month = event.target.closest("[data-toggle-crm-month]");
      if (month) {
        const key = month.dataset.toggleCrmMonth;
        if (expandedMonths.has(key)) expandedMonths.delete(key);
        else expandedMonths.add(key);
        renderLeads();
        return;
      }
      const sort = event.target.closest("[data-lead-sort]");
      if (sort) {
        const key = sort.dataset.leadSort;
        currentSort = currentSort.key === key ? { key, direction: currentSort.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" };
        renderLeads({ reset: true });
        return;
      }
      const edit = event.target.closest("[data-edit-lead]");
      if (edit) {
        openLeadModal(leadById(edit.dataset.editLead));
        return;
      }
      const archive = event.target.closest("[data-archive-lead]");
      if (archive) {
        const lead = leadById(archive.dataset.archiveLead);
        if (!lead || !confirm(`Archive ${lead.childName || lead.parentName || "this lead"}?`)) return;
        lead.archived = true;
        lead.updatedAt = nowISO();
        lead.updatedBy = currentUser()?.email || "crm";
        markLeadDirty(lead);
        logAction("CRM Lead Archived", lead.childName || lead.parentName || "Lead");
        renderLeads({ reset: true });
        queueSave(true);
      }
    });
    document.addEventListener("change", event => {
      const quick = event.target.closest("[data-lead-quick]");
      if (quick) {
        const [leadId, field] = quick.dataset.leadQuick.split("|");
        const lead = leadById(leadId);
        if (!lead) return;
        const previousStatus = leadStatus(lead);
        const hasLinkedStudent = Boolean((lead.studentId && studentById(lead.studentId)) || (lead.linkedStudentId && studentById(lead.linkedStudentId)));
        if (field === "status" && isEnrollmentActionStatus(String(quick.value || "")) && !hasLinkedStudent) {
          quick.value = previousStatus;
          openEnrollmentStudentForm(lead, previousStatus, quick);
          return;
        }
        updateLeadField(lead, field, field === "status" ? canonicalLeadStatusAfterSave(String(quick.value || "").trim()) : String(quick.value || "").trim());
        logAction("CRM Lead Table Updated", lead.childName || lead.parentName || lead.parentPhone || "Lead", `Changed ${field}.`);
        renderSummary();
        renderReminders();
        if (field === "status") updateLeadSchedulingState(lead.id);
        queueSave();
        return;
      }
      const session = event.target.closest("[data-crm-session]");
      if (session) updateCrmSession(session);
    });
    document.addEventListener("keydown", handleWorkspaceEscape);
  }

  async function initCRM() {
    try {
      await ensureCrmMarkup();
      bindEvents();
      renderColumnControls();
      await loadState();
    } catch (err) {
      setStatus(`Unable to load CRM: ${err.message}`, "error");
      const target = $("leadList") || $("crmModuleMount") || $("crm");
      if (target) target.innerHTML = `<div class="empty">Unable to load CRM data. Please check API connection or sign in again from the main page.</div>`;
    }
  }

  function destroyCRM() {
    clearTimeout(saveTimer);
    clearTimeout(window.__crmFilterTimer);
    document.removeEventListener("keydown", handleWorkspaceEscape);
    setWorkspaceExpanded(false);
    saving = false;
    pendingSave = false;
    lastRenderedSignature = "";
    eventsBound = false;
  }

  window.initCRM = initCRM;
  window.destroyCRM = destroyCRM;
})();
