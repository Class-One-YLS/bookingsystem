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
  const CRM_BATCH = 70;
  const CURRENT_MONTH = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const LEAD_STATUSES = ["New Contact", "Follow Up", "Assessment", "Trial Class", "Enrolled", "No Response", "Not Interested", "Lost"];
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

  const $ = id => document.getElementById(id);
  const safeJson = value => JSON.parse(JSON.stringify(value || null));
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch]));
  const dateOnly = value => String(value || "").slice(0, 10);
  const uid = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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
  const isOldImportedLead = lead => Boolean(lead.oldImported || lead.importedFromSheet || lead.monthlyTabImported);

  function storageGet(key) {
    try { return localStorage.getItem(key) || sessionStorage.getItem(key) || ""; } catch (err) { return ""; }
  }

  function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (err) {}
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
    const result = await apiFetch(`/api/state?key=${encodeURIComponent(DEFAULT_NEON.stateKey)}`, { method: "GET" });
    state = result.data || {};
    version = Number(result.version || state.settings?.neonVersion || 0);
    state.leads ||= [];
    state.teachers ||= [];
    state.bookings ||= [];
    state.activityLogs ||= [];
    if (!hasCrmAccess()) {
      $("crmContent").innerHTML = `<div class="panel"><h2>No Access</h2><p class="subtle">You do not have permission to access CRM Leads.</p><a class="btn ghost" href="./index.html">Back to Dashboard</a></div>`;
      return;
    }
    hydrateFilters();
    renderLeads({ reset: true });
    setStatus(`CRM loaded in ${Math.round(performance.now() - lastLoadStartedAt)} ms.`);
  }

  function sharedPayload() {
    return safeJson(state);
  }

  function mergeLeads(remote, local) {
    const map = new Map((remote.leads || []).map(item => [String(item.id || ""), item]));
    (local.leads || []).forEach(lead => {
      const id = String(lead.id || "");
      if (!id) return;
      const existing = map.get(id);
      if (!existing || leadLatestTime(lead) >= leadLatestTime(existing)) map.set(id, lead);
    });
    remote.leads = [...map.values()];
    const logMap = new Map((remote.activityLogs || []).map(log => [String(log.id || ""), log]));
    (local.activityLogs || []).forEach(log => { if (log?.id && !logMap.has(String(log.id))) logMap.set(String(log.id), log); });
    remote.activityLogs = [...logMap.values()];
    return remote;
  }

  async function saveState({ immediate = false } = {}) {
    if (!userCanEdit()) {
      setStatus("You do not have permission to edit CRM Leads.", "error");
      return false;
    }
    if (saving) {
      pendingSave = true;
      return false;
    }
    saving = true;
    setStatus("Syncing CRM changes...");
    try {
      let payload = sharedPayload();
      try {
        const saved = await apiFetch("/api/state", {
          method: "PUT",
          body: JSON.stringify({
            key: DEFAULT_NEON.stateKey,
            data: payload,
            expectedVersion: version,
            updatedBy: currentUser()?.email || "crm",
            userSession: sessionRecord()?.token || "",
            userEmail: currentUser()?.email || ""
          })
        });
        version = Number(saved.version || version + 1);
      } catch (err) {
        if (err.status !== 409) throw err;
        setStatus("Merging CRM with latest Neon data...");
        const latest = await apiFetch(`/api/state?key=${encodeURIComponent(DEFAULT_NEON.stateKey)}`, { method: "GET" });
        payload = mergeLeads(latest.data || {}, state);
        const saved = await apiFetch("/api/state", {
          method: "PUT",
          body: JSON.stringify({
            key: DEFAULT_NEON.stateKey,
            data: payload,
            expectedVersion: Number(latest.version || 0),
            updatedBy: currentUser()?.email || "crm",
            userSession: sessionRecord()?.token || "",
            userEmail: currentUser()?.email || ""
          })
        });
        version = Number(saved.version || latest.version || version + 1);
        state = payload;
      }
      setStatus(`Saved to Neon at ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`, "success");
      return true;
    } catch (err) {
      setStatus(`Save failed. Your change is still on this page: ${err.message}`, "error");
      return false;
    } finally {
      saving = false;
      if (pendingSave || immediate) {
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
    state.activityLogs.unshift({
      id: uid("log"),
      action,
      target,
      remark,
      createdAt: nowISO(),
      updatedAt: nowISO(),
      createdBy: currentUser()?.email || "crm"
    });
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
    return `<option value="">${options.length ? "Choose available slot" : "No open slots"}</option>${options.map(time => `<option value="${escapeHtml(time)}" ${time === selected ? "selected" : ""}>${escapeHtml(timeLabel(time))}${selected === time && !slotOpenForTeacher(teacherId, date, time, currentBookingId) ? " (current)" : ""}</option>`).join("")}`;
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
    const enrolled = leads.filter(lead => leadStatus(lead) === "Enrolled").length;
    const pending = leads.filter(lead => !["Enrolled", "Lost", "Not Interested"].includes(leadStatus(lead))).length;
    $("leadMonthSummary").innerHTML = [
      ["Total Leads", leads.length],
      ["Contacted", contacted],
      ["Trial Booked", trialBooked],
      ["Enrolled", enrolled],
      ["Pending", pending]
    ].map(([label, value]) => `<div class="metric"><span class="subtle">${escapeHtml(label)}</span><strong>${value}</strong><span class="subtle">${escapeHtml(monthLabel(month))}</span></div>`).join("");
  }

  function renderReminders() {
    const box = $("leadReminderBox");
    if (!box) return;
    const today = dateOnly(new Date().toISOString());
    const reminders = (state.leads || []).filter(lead => !lead.archived && !isOldImportedLead(lead) && lead.nextFollowUp && lead.nextFollowUp <= today && !["Enrolled", "Lost", "Not Interested"].includes(leadStatus(lead)));
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

  function sessionEditor(lead, kind) {
    const config = CRM_SESSION[kind];
    const teacherId = lead[config.teacher] || (kind === "trial2" ? lead.trialTeacherId || "" : "");
    const date = lead[config.date] || "";
    const time = lead[config.time] || "";
    return `<div class="crm-session-editor">
      <strong>${escapeHtml(config.title)}</strong>
      <select data-crm-session="${escapeHtml(`${lead.id}|${kind}|teacher`)}">${teacherOptions(teacherId)}</select>
      <input type="date" value="${escapeHtml(date)}" data-crm-session="${escapeHtml(`${lead.id}|${kind}|date`)}" ${teacherId ? "" : "disabled"}>
      <select data-crm-session="${escapeHtml(`${lead.id}|${kind}|time`)}" ${teacherId && date ? "" : "disabled"}>${availableTimeOptions(lead, kind, teacherId, date, time)}</select>
    </div>`;
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
      assessment: `<td data-crm-col="assessment">${sessionEditor(lead, "assessment")}</td>`,
      trial: `<td data-crm-col="trial">${sessionEditor(lead, "trial1")}${sessionEditor(lead, "trial2")}</td>`,
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
    const leads = filteredLeads();
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
    $("leadList").innerHTML = `<div class="table-wrap"><table class="lead-table">${tableHeader()}<tbody>${groupedRows(leads)}</tbody></table></div>`;
    $("leadCountText").textContent = `${Math.min(renderLimit, leads.length)} of ${leads.length} leads shown`;
    setStatus(`CRM rendered in ${Math.round(performance.now() - started)} ms.`);
  }

  function leadById(id) {
    return (state.leads || []).find(lead => String(lead.id || "") === String(id || ""));
  }

  function automaticFollowUp(lead) {
    const base = new Date();
    if (leadStatus(lead) === "New Contact") base.setDate(base.getDate() + 7);
    else if (leadStatus(lead) === "Follow Up") base.setDate(base.getDate() + 14);
    else base.setDate(base.getDate() + 7);
    return dateOnly(base.toISOString());
  }

  function updateLeadField(lead, field, value) {
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
    const value = String(control.value || "");
    const selection = {
      teacherId: lead[config.teacher] || (kind === "trial2" ? lead.trialTeacherId || "" : ""),
      date: lead[config.date] || "",
      time: lead[config.time] || ""
    };
    if (field === "teacher") {
      selection.teacherId = value;
      if (kind === "trial1" && !lead.trialTeacherId2) lead.trialTeacherId2 = value;
    }
    if (field === "date") selection.date = value;
    if (field === "time") selection.time = value;
    lead[config.teacher] = selection.teacherId;
    lead[config.date] = selection.date;
    lead[config.time] = selection.time;
    if (selection.teacherId && selection.date && selection.time) {
      const bookingId = lead[config.booking] || uid("crm_booking");
      if (!slotOpenForTeacher(selection.teacherId, selection.date, selection.time, bookingId)) {
        control.value = lead[config.time] || "";
        alert("This selected slot is not open for the chosen teacher.");
        renderLeads();
        return;
      }
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
      lead[config.booking] = booking.id;
      lead.status = config.status;
      lead.statusChangedAt = nowISO();
      logAction("CRM Session Rescheduled", lead.childName || lead.parentName || "Lead", `${config.title} set to ${selection.date} ${timeLabel(selection.time)}.`);
    }
    lead.updatedAt = nowISO();
    lead.updatedBy = currentUser()?.email || "crm";
    queueSave(true);
    renderLeads();
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
    $("leadProfileModal").classList.remove("hide");
  }

  function closeModal() {
    $("leadProfileModal").classList.add("hide");
  }

  function saveLeadFromModal() {
    let lead = leadById($("leadId").value);
    const isNew = !lead;
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
      status: $("leadStatus").value,
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
    logAction(isNew ? "CRM Lead Created" : "CRM Lead Updated", lead.childName || lead.parentName || lead.parentPhone || "Lead");
    closeModal();
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
    $("createStudentFromLeadBtn").onclick = () => { window.location.href = "./index.html#students"; };
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
        updateLeadField(lead, field, String(quick.value || "").trim());
        logAction("CRM Lead Table Updated", lead.childName || lead.parentName || lead.parentPhone || "Lead", `Changed ${field}.`);
        renderSummary();
        renderReminders();
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
