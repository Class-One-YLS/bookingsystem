const API_KEY = 'CHANGE_THIS_PRIVATE_KEY';
const SHEETS = {
  teachers: 'Teachers',
  students: 'Students',
  tutorLeads: 'TutorCRM',
  bookings: 'Bookings',
  replacements: 'Replacements',
  replacementCredits: 'ReplacementCredits',
  publicHolidays: 'PublicHolidays',
  activityLogs: 'ActivityLog',
  settings: 'Settings'
};
const YLSO_SHEET = 'YLSO list';

function doGet(e) {
  try {
    assertKey_(e.parameter.key);
    if (e.parameter.action !== 'read') throw new Error('Unsupported action.');
    return json_({ ok: true, payload: readPayload_() });
  } catch (err) {
    return json_({ ok: false, error: err.message });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    assertKey_(body.key);
    if (body.action !== 'write') throw new Error('Unsupported action.');
    writePayload_(body.payload || {});
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: err.message });
  }
}

function setupClassOneWorkbook() {
  Object.values(SHEETS).forEach(name => getSheet_(name).clear());
  getSheet_(SHEETS.teachers).appendRow(['id', 'name', 'tier', 'rate', 'category', 'profitShare', 'subjects_json', 'photo', 'regular_slots_json', 'override_slots_json', 'status', 'archivedAt', 'updatedAt']);
  getSheet_(SHEETS.students).appendRow(['id', 'name', 'subject', 'package', 'packageAmount', 'packageClasses', 'packageNotes', 'status', 'registeredStatus', 'registeredRemark', 'regular_slots_json', 'teacherId', 'day', 'time']);
  getSheet_(SHEETS.tutorLeads).appendRow(['id', 'name', 'phone', 'category', 'status', 'rate', 'profitShare', 'subjects_json', 'onboarding_json', 'nextFollowUp', 'source', 'notes', 'syncedTeacherId', 'createdAt', 'updatedAt']);
  getSheet_(SHEETS.bookings).appendRow(['id', 'teacherId', 'studentId', 'studentName', 'subject', 'type', 'date', 'day', 'time', 'status', 'archived', 'minutes', 'createdAt', 'completedAt', 'updatedAt', 'remark', 'source', 'publicHolidayId', 'publicHolidayOverride']);
  getSheet_(SHEETS.replacements).appendRow(['id', 'bookingId', 'status', 'reason', 'replacementNeeded', 'studentName', 'subject', 'originalTeacherId', 'originalTeacherName', 'originalDate', 'originalTime', 'replacementTeacherId', 'replacementTeacherName', 'replacementDate', 'replacementTime', 'replacementBookingId', 'latestAction', 'lastActionAt', 'notes', 'createdAt', 'updatedAt']);
  getSheet_(SHEETS.replacementCredits).appendRow(['id', 'studentId', 'studentName', 'amount', 'used', 'reason', 'remark', 'sourceBookingId', 'status', 'usedByBookingIds_json', 'createdAt', 'updatedAt']);
  getSheet_(SHEETS.publicHolidays).appendRow(['id', 'startDate', 'endDate', 'date', 'name', 'replacementDefault', 'createdAt', 'updatedAt']);
  getSheet_(SHEETS.activityLogs).appendRow(['id', 'createdAt', 'user', 'type', 'target', 'beforeValue', 'afterValue', 'notes']);
  getSheet_(SHEETS.settings).appendRow(['key', 'value']);
  getSheet_(SHEETS.settings).appendRow(['version', '1']);
  getSheet_(SHEETS.settings).appendRow(['read_teacher_timetable_tabs', 'TRUE']);
}

function readPayload_() {
  return {
    teachers: readTeachers_(),
    students: readStudents_(),
    tutorLeads: readTutorLeads_(),
    bookings: readBookings_(),
    replacements: readReplacements_(),
    replacementCredits: readReplacementCredits_(),
    publicHolidays: readPublicHolidays_(),
    activityLogs: readActivityLogs_(),
    settings: { scriptUrl: '', apiKey: '' }
  };
}

function writePayload_(payload) {
  writeTeachers_(payload.teachers || []);
  writeStudents_(payload.students || []);
  writeTutorLeads_(payload.tutorLeads || []);
  writeBookings_(payload.bookings || []);
  writeReplacements_(payload.replacements || []);
  writeReplacementCredits_(payload.replacementCredits || []);
  writePublicHolidays_(payload.publicHolidays || []);
  writeActivityLogs_(payload.activityLogs || []);
}

function readTeachers_() {
  const profileTeachers = mergeProfileTeachers_(readObjects_(SHEETS.teachers).map(row => ({
    id: row.id,
    name: cleanTeacherName_(row.name),
    tier: row.tier || 'standard',
    rate: Number(row.rate || 0),
    category: row.category || 'freelance',
    profitShare: Number(row.profitShare || 0),
    subjects: normalizeSubjects_(parseJson_(row.subjects_json, [])),
    photo: row.photo || '',
    regularSlots: parseJson_(row.regular_slots_json, []),
    overrideSlots: parseJson_(row.override_slots_json, []),
    status: row.status || 'active',
    archivedAt: row.archivedAt || '',
    updatedAt: row.updatedAt || ''
  })).filter(t => t.id && t.name && !isImportedOnlyTeacher_(t)));
  if (getSetting_('read_teacher_timetable_tabs', 'TRUE') !== 'TRUE') return profileTeachers;
  return mergeTimetableTeachers_(profileTeachers, importTeacherTimetableTabs_());
}

function readStudents_() {
  const appStudents = readObjects_(SHEETS.students).map(row => ({
    id: row.id,
    name: cleanStudentName_(row.name),
    subject: row.subject,
    package: row.package || '',
    packageAmount: Number(row.packageAmount || 0),
    packageClasses: Number(row.packageClasses || 0),
    packageNotes: row.packageNotes || '',
    status: row.status || 'registered',
    registeredStatus: row.registeredStatus || 'active',
    registeredRemark: row.registeredRemark || '',
    regularSlots: parseJson_(row.regular_slots_json, legacyStudentRegularSlots_(row))
  })).filter(s => s.id && s.name);
  return mergeYlsoStudents_(appStudents, readYlsoStudents_());
}

function readTutorLeads_() {
  return readObjects_(SHEETS.tutorLeads).map(row => ({
    id: row.id,
    name: row.name || '',
    phone: row.phone || '',
    category: row.category || 'freelance',
    status: row.status || 'New Applicant',
    rate: Number(row.rate || 0),
    profitShare: Number(row.profitShare || 0),
    subjects: normalizeSubjects_(parseJson_(row.subjects_json, [])),
    onboarding: parseJson_(row.onboarding_json, []),
    nextFollowUp: row.nextFollowUp || '',
    source: row.source || '',
    notes: row.notes || '',
    syncedTeacherId: row.syncedTeacherId || '',
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || ''
  })).filter(t => t.id && t.name);
}

function readBookings_() {
  return readObjects_(SHEETS.bookings).map(row => ({
    id: row.id,
    teacherId: row.teacherId,
    studentId: row.studentId,
    studentName: cleanStudentName_(row.studentName),
    subject: row.subject,
    type: row.type,
    date: row.date,
    day: row.day,
    time: row.time,
    status: row.status || 'booked',
    archived: String(row.archived).toLowerCase() === 'true',
    minutes: Number(row.minutes || 25),
    createdAt: row.createdAt,
    completedAt: row.completedAt || '',
    updatedAt: row.updatedAt || '',
    remark: row.remark || '',
    source: row.source || '',
    publicHolidayId: row.publicHolidayId || '',
    publicHolidayOverride: String(row.publicHolidayOverride).toLowerCase() === 'true'
  })).filter(b => b.id);
}

function writeTeachers_(teachers) {
  const rows = teachers.filter(t => !isImportedOnlyTeacher_(t)).map(t => [
    t.id,
    t.name,
    t.tier || 'standard',
    Number(t.rate || 0),
    t.category || 'freelance',
    Number(t.profitShare || 0),
    JSON.stringify(normalizeSubjects_(t.subjects || [])),
    t.photo || '',
    JSON.stringify(t.regularSlots || []),
    JSON.stringify(t.overrideSlots || []),
    t.status || 'active',
    t.archivedAt || '',
    t.updatedAt || ''
  ]);
  writeRows_(SHEETS.teachers, ['id', 'name', 'tier', 'rate', 'category', 'profitShare', 'subjects_json', 'photo', 'regular_slots_json', 'override_slots_json', 'status', 'archivedAt', 'updatedAt'], rows);
}

function importTeacherTimetableTabs_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const systemNames = Object.values(SHEETS).concat([YLSO_SHEET]).map(normalize_);
  const imported = [];
  ss.getSheets().forEach(sheet => {
    if (systemNames.indexOf(normalize_(sheet.getName())) !== -1) return;
    const parsed = parseTeacherTimetableSheet_(sheet);
    if (parsed) imported.push(parsed);
  });
  return imported;
}

function parseTeacherTimetableSheet_(sheet) {
  const range = sheet.getDataRange();
  const display = range.getDisplayValues();
  const headerRow = 2;
  const dayColumns = getB3ToH3DayColumns_(display);
  if (headerRow < 0 || dayColumns.length < 5) return null;

  const teacherName = cleanTeacherName_(sheet.getName());
  const regularSlots = [];
  for (let r = headerRow + 1; r < display.length; r++) {
    const time = parseTime_(display[r][0]);
    if (!time) continue;
    dayColumns.forEach(dayCol => {
      const raw = String(display[r][dayCol.col] || '').trim();
      if (isOffCell_(raw)) return;
      regularSlots.push({
        id: slotId_(teacherName, dayCol.day, time),
        day: dayCol.day,
        time: time,
        subject: inferSubjectFromText_(raw),
        source: 'teacher-sheet',
        locked: raw !== '',
        studentName: cleanStudentName_(raw)
      });
    });
  }
  if (!regularSlots.length) return null;
  return {
    id: teacherIdFromName_(teacherName),
    name: teacherName,
    tier: 'standard',
    rate: 0,
    subjects: inferSubjectsFromSlots_(regularSlots),
    photo: '',
    regularSlots: regularSlots,
    overrideSlots: []
  };
}

function getB3ToH3DayColumns_(display) {
  if (display.length < 3) return [];
  const cols = [];
  for (let c = 1; c <= 7; c++) {
    const day = dayFromHeader_(normalize_(display[2][c]));
    if (day) cols.push({ day: day, col: c });
  }
  return cols;
}

function mergeTimetableTeachers_(profileTeachers, importedTeachers) {
  const result = profileTeachers.map(t => Object.assign({}, t));
  importedTeachers.forEach(imported => {
    const existing = result.find(t => normalize_(t.name) === normalize_(imported.name) || t.id === imported.id);
    if (existing) {
      existing.regularSlots = imported.regularSlots;
      if (!existing.subjects || !existing.subjects.length) existing.subjects = imported.subjects || [];
    }
  });
  return result;
}

function mergeProfileTeachers_(teachers) {
  const result = [];
  teachers.forEach(teacher => {
    if (isImportedOnlyTeacher_(teacher)) return;
    const key = normalize_(cleanTeacherName_(teacher.name));
    if (!key) return;
    const existing = result.find(item => normalize_(cleanTeacherName_(item.name)) === key);
    if (!existing) {
      result.push(teacher);
      return;
    }
    existing.name = cleanTeacherName_(existing.name || teacher.name);
    existing.tier = existing.tier && existing.tier !== 'standard' ? existing.tier : (teacher.tier || existing.tier || 'standard');
    existing.category = existing.category || teacher.category || 'freelance';
    existing.rate = Number(existing.rate || 0) || Number(teacher.rate || 0);
    existing.profitShare = Number(existing.profitShare || 0) || Number(teacher.profitShare || 0);
    existing.subjects = normalizeSubjects_([].concat(existing.subjects || [], teacher.subjects || []));
    existing.photo = existing.photo || teacher.photo || '';
    existing.regularSlots = mergeSlots_(existing.regularSlots || [], teacher.regularSlots || []);
    existing.overrideSlots = mergeSlots_(existing.overrideSlots || [], teacher.overrideSlots || []);
    existing.status = existing.status === 'active' || teacher.status === 'active' ? 'active' : (existing.status || teacher.status || 'active');
    existing.updatedAt = existing.updatedAt || teacher.updatedAt || '';
  });
  return result;
}

function isImportedOnlyTeacher_(teacher) {
  const regularSlots = teacher.regularSlots || [];
  const overrideSlots = teacher.overrideSlots || [];
  const hasOnlyTeacherSheetSlots = regularSlots.length > 0 && regularSlots.every(slot => slot.source === 'teacher-sheet');
  const hasProfileData = (teacher.subjects || []).length || teacher.photo || Number(teacher.rate || 0) || Number(teacher.profitShare || 0) || (teacher.tier && teacher.tier !== 'standard') || (teacher.category && teacher.category !== 'freelance') || overrideSlots.length;
  return hasOnlyTeacherSheetSlots && !hasProfileData;
}

function mergeSlots_(a, b) {
  const seen = {};
  return [].concat(a || [], b || []).filter(slot => {
    const key = [slot.id, slot.day, slot.date, slot.time, slot.subject, slot.studentName].join('|');
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function writeStudents_(students) {
  const rows = students.map(s => [
    s.id,
    s.name,
    s.subject,
    s.package || '',
    Number(s.packageAmount || 0),
    Number(s.packageClasses || 0),
    s.packageNotes || '',
    s.status || 'registered',
    s.registeredStatus || 'active',
    s.registeredRemark || '',
    JSON.stringify(s.regularSlots || legacyStudentRegularSlots_(s)),
    s.teacherId || '',
    s.day || '',
    s.time || ''
  ]);
  writeRows_(SHEETS.students, ['id', 'name', 'subject', 'package', 'packageAmount', 'packageClasses', 'packageNotes', 'status', 'registeredStatus', 'registeredRemark', 'regular_slots_json', 'teacherId', 'day', 'time'], rows);
  // Do not write back to YLSO list. It is an imported source tab and must not be cleared by app sync.
}

function writeTutorLeads_(leads) {
  const rows = leads.map(lead => [
    lead.id,
    lead.name || '',
    lead.phone || '',
    lead.category || 'freelance',
    lead.status || 'New Applicant',
    Number(lead.rate || 0),
    Number(lead.profitShare || 0),
    JSON.stringify(normalizeSubjects_(lead.subjects || [])),
    JSON.stringify(lead.onboarding || []),
    lead.nextFollowUp || '',
    lead.source || '',
    lead.notes || '',
    lead.syncedTeacherId || '',
    lead.createdAt || '',
    lead.updatedAt || ''
  ]);
  writeRows_(SHEETS.tutorLeads, ['id', 'name', 'phone', 'category', 'status', 'rate', 'profitShare', 'subjects_json', 'onboarding_json', 'nextFollowUp', 'source', 'notes', 'syncedTeacherId', 'createdAt', 'updatedAt'], rows);
}

function readYlsoStudents_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(YLSO_SHEET);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 4) return [];
  const values = sheet.getRange(4, 3, lastRow - 3, 2).getDisplayValues();
  return values.map((row, index) => {
    const name = cleanStudentName_(row[0]);
    const packageName = String(row[1] || '').trim();
    if (!name || name.toLowerCase() === 'student' || name.toLowerCase() === 'student name') return null;
    return {
      id: 'ylso_' + normalize_(name),
      name: name,
      subject: '',
      package: packageName,
      packageAmount: 0,
      packageClasses: 0,
      packageNotes: '',
      status: 'registered',
      regularSlots: [],
      ylsoRow: index + 4
    };
  }).filter(Boolean);
}

function mergeYlsoStudents_(appStudents, ylsoStudents) {
  const result = appStudents.map(s => {
    const copy = Object.assign({}, s);
    copy.name = cleanStudentName_(copy.name);
    return copy;
  });
  ylsoStudents.forEach(imported => {
    const existing = result.find(s => normalize_(cleanStudentName_(s.name)) === normalize_(cleanStudentName_(imported.name)));
    if (existing) {
      existing.package = existing.package || imported.package;
      existing.ylsoRow = imported.ylsoRow;
    } else {
      result.push(imported);
    }
  });
  return result;
}

function writeYlsoStudents_(students) {
  // Deprecated safety stub. Keep this function so older calls do nothing instead of editing YLSO list.
}

function getYlsoSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(YLSO_SHEET) || ss.insertSheet(YLSO_SHEET);
}

function writeBookings_(bookings) {
  const rows = bookings.map(b => [
    b.id,
    b.teacherId,
    b.studentId || '',
    cleanStudentName_(b.studentName),
    b.subject,
    b.type,
    b.date,
    b.day,
    b.time,
    b.status || 'booked',
    Boolean(b.archived),
    Number(b.minutes || 25),
    b.createdAt || '',
    b.completedAt || '',
    b.updatedAt || '',
    b.remark || '',
    b.source || '',
    b.publicHolidayId || '',
    Boolean(b.publicHolidayOverride)
  ]);
  writeRows_(SHEETS.bookings, ['id', 'teacherId', 'studentId', 'studentName', 'subject', 'type', 'date', 'day', 'time', 'status', 'archived', 'minutes', 'createdAt', 'completedAt', 'updatedAt', 'remark', 'source', 'publicHolidayId', 'publicHolidayOverride'], rows);
}

function readReplacements_() {
  return readObjects_(SHEETS.replacements).map(row => ({
    id: row.id,
    bookingId: row.bookingId,
    status: row.status || 'Action Needed',
    reason: row.reason || '',
    replacementNeeded: String(row.replacementNeeded).toLowerCase() === 'true',
    studentName: cleanStudentName_(row.studentName),
    subject: row.subject || '',
    originalTeacherId: row.originalTeacherId || '',
    originalTeacherName: row.originalTeacherName || '',
    originalDate: row.originalDate || '',
    originalTime: row.originalTime || '',
    replacementTeacherId: row.replacementTeacherId || '',
    replacementTeacherName: row.replacementTeacherName || '',
    replacementDate: row.replacementDate || '',
    replacementTime: row.replacementTime || '',
    replacementBookingId: row.replacementBookingId || '',
    latestAction: row.latestAction || '',
    lastActionAt: row.lastActionAt || '',
    notes: row.notes || '',
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || ''
  })).filter(r => r.id);
}

function writeReplacements_(replacements) {
  const rows = replacements.map(r => [
    r.id,
    r.bookingId || '',
    r.status || 'Action Needed',
    r.reason || '',
    Boolean(r.replacementNeeded),
    cleanStudentName_(r.studentName),
    r.subject || '',
    r.originalTeacherId || '',
    r.originalTeacherName || '',
    r.originalDate || '',
    r.originalTime || '',
    r.replacementTeacherId || '',
    r.replacementTeacherName || '',
    r.replacementDate || '',
    r.replacementTime || '',
    r.replacementBookingId || '',
    r.latestAction || '',
    r.lastActionAt || '',
    r.notes || '',
    r.createdAt || '',
    r.updatedAt || ''
  ]);
  writeRows_(SHEETS.replacements, ['id', 'bookingId', 'status', 'reason', 'replacementNeeded', 'studentName', 'subject', 'originalTeacherId', 'originalTeacherName', 'originalDate', 'originalTime', 'replacementTeacherId', 'replacementTeacherName', 'replacementDate', 'replacementTime', 'replacementBookingId', 'latestAction', 'lastActionAt', 'notes', 'createdAt', 'updatedAt'], rows);
}

function readReplacementCredits_() {
  return readObjects_(SHEETS.replacementCredits).map(row => ({
    id: row.id,
    studentId: row.studentId || '',
    studentName: cleanStudentName_(row.studentName),
    amount: Number(row.amount || 0),
    used: Number(row.used || 0),
    reason: row.reason || '',
    remark: row.remark || '',
    sourceBookingId: row.sourceBookingId || '',
    status: row.status || 'active',
    usedByBookingIds: parseJson_(row.usedByBookingIds_json, []),
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || ''
  })).filter(r => r.id);
}

function writeReplacementCredits_(credits) {
  const rows = credits.map(c => [
    c.id,
    c.studentId || '',
    cleanStudentName_(c.studentName),
    Number(c.amount || 0),
    Number(c.used || 0),
    c.reason || '',
    c.remark || '',
    c.sourceBookingId || '',
    c.status || 'active',
    JSON.stringify(c.usedByBookingIds || []),
    c.createdAt || '',
    c.updatedAt || ''
  ]);
  writeRows_(SHEETS.replacementCredits, ['id', 'studentId', 'studentName', 'amount', 'used', 'reason', 'remark', 'sourceBookingId', 'status', 'usedByBookingIds_json', 'createdAt', 'updatedAt'], rows);
}

function readPublicHolidays_() {
  return readObjects_(SHEETS.publicHolidays).map(row => ({
    id: row.id,
    startDate: row.startDate || row.date || '',
    endDate: row.endDate || row.date || row.startDate || '',
    date: row.date || row.startDate || '',
    name: row.name || 'Public Holiday',
    replacementDefault: row.replacementDefault || 'yes',
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || ''
  })).filter(r => r.id && r.startDate);
}

function writePublicHolidays_(holidays) {
  const rows = holidays.map(h => [
    h.id,
    h.startDate || h.date || '',
    h.endDate || h.date || h.startDate || '',
    h.date || h.startDate || '',
    h.name || 'Public Holiday',
    h.replacementDefault || 'yes',
    h.createdAt || '',
    h.updatedAt || ''
  ]);
  writeRows_(SHEETS.publicHolidays, ['id', 'startDate', 'endDate', 'date', 'name', 'replacementDefault', 'createdAt', 'updatedAt'], rows);
}

function readActivityLogs_() {
  return readObjects_(SHEETS.activityLogs).map(row => ({
    id: row.id,
    createdAt: row.createdAt || '',
    user: row.user || '',
    type: row.type || '',
    target: row.target || '',
    beforeValue: row.beforeValue || '',
    afterValue: row.afterValue || '',
    notes: row.notes || ''
  })).filter(log => log.id);
}

function writeActivityLogs_(logs) {
  const rows = logs.slice(0, 2500).map(log => [
    log.id,
    log.createdAt || '',
    log.user || '',
    log.type || '',
    log.target || '',
    log.beforeValue || '',
    log.afterValue || '',
    log.notes || ''
  ]);
  writeRows_(SHEETS.activityLogs, ['id', 'createdAt', 'user', 'type', 'target', 'beforeValue', 'afterValue', 'notes'], rows);
}

function readObjects_(sheetName) {
  const sheet = getSheet_(sheetName);
  const values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) return [];
  const headers = values[0].map(String);
  return values.slice(1).filter(row => row.some(Boolean)).map(row => {
    const obj = {};
    headers.forEach((header, i) => obj[header] = row[i]);
    return obj;
  });
}

function writeRows_(sheetName, headers, rows) {
  const sheet = getSheet_(sheetName);
  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  sheet.autoResizeColumns(1, headers.length);
}

function getSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function getSetting_(key, fallback) {
  const rows = readObjects_(SHEETS.settings);
  const row = rows.find(r => String(r.key || '').trim() === key);
  return row ? String(row.value || '').trim().toUpperCase() : fallback;
}

function dayFromHeader_(value) {
  const map = {
    mon: 'Monday',
    monday: 'Monday',
    tue: 'Tuesday',
    tues: 'Tuesday',
    tuesday: 'Tuesday',
    wed: 'Wednesday',
    wednesday: 'Wednesday',
    thu: 'Thursday',
    thur: 'Thursday',
    thurs: 'Thursday',
    thursday: 'Thursday',
    fri: 'Friday',
    friday: 'Friday',
    sat: 'Saturday',
    saturday: 'Saturday',
    sun: 'Sunday',
    sunday: 'Sunday'
  };
  return map[value] || '';
}

function parseTime_(value) {
  const text = String(value || '').trim().toUpperCase();
  const match = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/);
  if (!match) return '';
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = match[3];
  if (meridiem === 'PM' && hour !== 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
}

function cleanTeacherName_(name) {
  return String(name || '')
    .replace(/^\d{4}\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function teacherIdFromName_(name) {
  return 'teacher_' + normalize_(name);
}

function slotId_(teacherName, day, time) {
  return ['slot', normalize_(teacherName), normalize_(day), time.replace(':', '')].join('_');
}

function isOffCell_(value) {
  return normalize_(value) === 'off';
}

function legacyStudentRegularSlots_(row) {
  if (!row || (!row.teacherId && !row.day && !row.time)) return [];
  return [{
    id: 'student_slot_' + normalize_([row.teacherId, row.day, row.time, row.subject].join('_')),
    teacherId: row.teacherId || '',
    day: row.day || '',
    time: row.time || '',
    subject: row.subject || ''
  }];
}

function inferSubjectFromText_(value) {
  return '';
}

function inferSubjectsFromSlots_(slots) {
  return normalizeSubjects_(slots.map(s => s.subject).filter(Boolean));
}

function normalizeSubject_(subject) {
  return String(subject || '').trim().toUpperCase() === 'BC' ? 'CN' : subject;
}

function normalizeSubjects_(subjects) {
  return unique_((subjects || []).map(normalizeSubject_).filter(Boolean));
}

function cleanStudentName_(value) {
  return String(value || '')
    .replace(/\s*\((?:BC|CN|BM|PK|SOK|PHONICS|CREATIVE MATHS)\)\s*$/ig, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function unique_(items) {
  const seen = {};
  return items.filter(item => {
    const key = String(item || '');
    if (!key || seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function normalize_(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseJson_(value, fallback) {
  try {
    if (!value) return fallback;
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

function assertKey_(key) {
  if (!API_KEY || API_KEY === 'CHANGE_THIS_PRIVATE_KEY') throw new Error('Set API_KEY in Code.gs first.');
  if (key !== API_KEY) throw new Error('Invalid API key.');
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
