/**
 * IT HELP DESK FOR GOOGLE WORKSPACE  –  v3
 * -----------------------------------------
 * NEW INSTALL:          edit CONTACTS and CONFIG, then run setup().
 * ALREADY RAN v1 or v2: replace the old code with this file, edit CONTACTS and CONFIG,
 *                       then run upgrade(). Existing tickets, form, and triggers are kept.
 *
 * What it does:
 *   - Form -> ticket row with ID, priority, SLA due time
 *   - IT staff assign themselves; tickets in the Google category auto-assign to Michael,
 *     tickets in the Phone system category auto-assign to Cindy
 *   - Books 15-min follow-up #1 and #2 with the requester (timing by priority)
 *   - On "Resolved": cancels unused follow-ups and books a 15-min verification
 *   - Follow-ups only land in Follow-up Windows; IT Work Blocks and time off are protected
 *   - Dependency checkboxes (RCS, Paradigm, new HW/SW, new HW/SW version) + notes
 *   - Dependency alerts to Emilio & Josh
 *   - Emilio & Josh get an FYI when Michael's or Cindy's tickets are resolved, closed, or reopened
 *   - Emails, hourly overdue escalation, and a Dashboard tab
 */

// ======================= PEOPLE – EDIT THESE =======================
// Real addresses for the people below.
const CONTACTS = {
  EMILIO:  'esanfelice@msi-products.com',  // Emilio Sanfelice – all dependency alerts
  JOSH:    'jsiegle@msi-products.com',       // Josh Siegle – all dependency alerts
  MICHAEL: 'mjagmin@msi-products.com',    // Michael Jagmin – Google tickets
  CINDY:   'cjagmin@msi-products.com',      // Cindy Jagmin – phone system tickets
};

// ======================= CONFIG – EDIT THESE =======================
const CONFIG = {
  // Everyone who works tickets (alerts, "Assigned To" dropdown, auto-assign, calendar blocks).
  IT_STAFF: [CONTACTS.EMILIO, CONTACTS.JOSH],
  SUPPORT_NAME: 'IT Support',

  // Target time to FIRST RESPONSE, in clock hours.
  SLA_HOURS: { P1: 1, P2: 4, P3: 24, P4: 72 },

  // Tickets are NOT auto-assigned to IT staff – they assign themselves in the
  // "Assigned To" column. Only ROUTING_RULES with an assignTo auto-assign.

  // ---------- Follow-up & verification meetings ----------
  MEETING_MINUTES: 15,
  // Earliest time each meeting may be booked, in hours:
  //   first / second = hours after the ticket is submitted
  //   verify         = hours after the ticket is marked Resolved
  // The meeting goes in the next open slot at or after that time. null = skip it.
  FOLLOWUPS: {
    P1: { first: 0.25, second: 4,    verify: 24  },
    P2: { first: 2,    second: 24,   verify: 48  },
    P3: { first: 24,   second: 72,   verify: 72  },
    P4: { first: 48,   second: null, verify: 120 },
  },
  MIN_NOTICE_MINUTES: 15,  // never book a meeting sooner than this from now
  SEARCH_DAYS: 14,         // how far ahead to look for an open slot

  // ---------- Calendar blocks (24-hour times, script time zone) ----------
  // Routine follow-ups and verifications are ONLY booked inside these windows.
  FOLLOWUP_WINDOWS: {
    Mon: ['09:00-10:00', '15:00-16:00'],
    Tue: ['09:00-10:00', '15:00-16:00'],
    Wed: ['09:00-10:00', '15:00-16:00'],
    Thu: ['09:00-10:00', '15:00-16:00'],
    Fri: ['09:00-10:00'],
  },
  // Protected hands-on IT time. Shows as busy; follow-ups are never booked here
  // (except ANYTIME_PRIORITIES below).
  WORK_BLOCKS: {
    Mon: ['10:00-12:00', '13:00-15:00'],
    Tue: ['10:00-12:00', '13:00-15:00'],
    Wed: ['10:00-12:00', '13:00-15:00'],
    Thu: ['10:00-12:00', '13:00-15:00'],
    Fri: ['10:00-12:00'],
  },
  // Priorities that can be booked anywhere in WORK_HOURS (still avoiding other
  // meetings and time off), so critical issues aren't held for the next window.
  ANYTIME_PRIORITIES: ['P1'],
  WORK_HOURS: {
    Mon: ['08:00-17:00'], Tue: ['08:00-17:00'], Wed: ['08:00-17:00'],
    Thu: ['08:00-17:00'], Fri: ['08:00-17:00'],
  },
  WINDOW_TITLE: 'IT Follow-up Window',
  WORK_BLOCK_TITLE: 'IT Work Block',
  // All-day events on a tech's own calendar with these words count as a day off.
  TIME_OFF_WORDS: /\b(out of office|ooo|vacation|pto|time off|holiday|sick)\b/i,

  // ---------- Dependency assessment (checkbox columns) ----------
  // Renaming is fine. Don't add or remove items after setup()/upgrade() has run.
  DEPENDENCIES: [
    'RCS required',
    'Paradigm required',
    'New hardware/software required',
    'New hardware/software version required',
  ],

  // ---------- Notification routing ----------
  // Emailed when IT ticks ANY dependency box (once per box per ticket).
  DEPENDENCY_CONTACTS: [CONTACTS.EMILIO, CONTACTS.JOSH],
  // Optional extra people for one specific box, keyed by its exact DEPENDENCIES name.
  DEPENDENCY_EXTRA_CONTACTS: {
    // 'RCS required': ['someone@msi-products.com'],
  },
  // CC the requester on dependency alerts (the assigned tech is always CC'd).
  DEPENDENCY_CC_REQUESTER: true,

  // Routing is based ONLY on the Category the user picks on the form (not the
  // summary or description). When a new ticket's category is in a rule's list,
  // the rule's contacts are emailed and the ticket is assigned to assignTo.
  ROUTING_RULES: [
    {
      name: 'Google Workspace',
      notify: [CONTACTS.MICHAEL],
      assignTo: CONTACTS.MICHAEL,
      categories: ['Email / Google Workspace'],
    },
    {
      name: 'Phone system',
      notify: [CONTACTS.CINDY],
      assignTo: CONTACTS.CINDY,
      categories: ['Phone system (desk phones, voicemail, extensions)'],
    },
  ],

  // Extra people copied on EVERY new-ticket alert (in addition to IT_STAFF). Empty = none.
  NEW_TICKET_WATCHERS: [],
};

const URGENCY_OPTIONS = [
  { label: "Critical – I can't work at all", priority: 'P1' },
  { label: 'High – major problem, but I have a workaround', priority: 'P2' },
  { label: 'Normal – annoying, but not blocking my work', priority: 'P3' },
  { label: 'Low – question or request, no rush', priority: 'P4' },
];

const CATEGORIES = [
  'Hardware (computer, monitor, printer)',
  'Phone system (desk phones, voicemail, extensions)',
  'Software / applications',
  'Account & access (passwords, permissions)',
  'Network / internet / Wi-Fi',
  'Email / Google Workspace',
  'New equipment or software request',
  'Other',
];
// ===================================================================

const STATUSES = ['New', 'In Progress', 'Waiting on User', 'Waiting on Dependency', 'Resolved', 'Closed'];
const DONE = ['Resolved', 'Closed'];
const TICKETS_SHEET = 'Tickets';
const DASHBOARD_SHEET = 'Dashboard';
const TIME_OFF_SHEET = 'Time Off';
const DAY_KEYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_ENUM = { Sun: 'SUNDAY', Mon: 'MONDAY', Tue: 'TUESDAY', Wed: 'WEDNESDAY',
  Thu: 'THURSDAY', Fri: 'FRIDAY', Sat: 'SATURDAY' };

const Q = {
  NAME: 'Your name',
  CATEGORY: 'Category',
  URGENCY: 'How urgent is this?',
  SUMMARY: 'Short summary',
  DESCRIPTION: 'Describe the problem',
  LOCATION: 'Device or location (optional)',
};

const MEETING_LABELS = { f1: 'IT follow-up #1', f2: 'IT follow-up #2', v: 'IT verification' };
const MEETING_KINDS = ['f1', 'f2', 'v'];

const BASE_HEADERS = [
  'Ticket ID', 'Submitted', 'Requester Email', 'Name', 'Category', 'Priority',
  'Summary', 'Description', 'Device / Location', 'Status', 'Assigned To',
  'Response Due', 'First Response', 'Resolved', 'Resolution Notes',
  'Hours to Resolve', 'Escalated',
];
const HEADERS = BASE_HEADERS.concat(CONFIG.DEPENDENCIES, [
  'Dependency Notes', 'Follow-up 1', 'Follow-up 2', 'Verification', 'Reschedule', 'Event IDs',
  'Dependency Alerts Sent', 'Routing Alerts Sent',
]);

const COL = {
  ID: 1, SUBMITTED: 2, EMAIL: 3, NAME: 4, CATEGORY: 5, PRIORITY: 6,
  SUMMARY: 7, DESCRIPTION: 8, LOCATION: 9, STATUS: 10, ASSIGNED: 11,
  DUE: 12, FIRST_RESPONSE: 13, RESOLVED: 14, NOTES: 15, HOURS: 16, ESCALATED: 17,
};
COL.DEP_START = BASE_HEADERS.length + 1;
COL.DEP_NOTES = COL.DEP_START + CONFIG.DEPENDENCIES.length;
COL.f1 = COL.DEP_NOTES + 1;
COL.f2 = COL.DEP_NOTES + 2;
COL.v = COL.DEP_NOTES + 3;
COL.RESCHEDULE = COL.DEP_NOTES + 4;
COL.EVENT_IDS = COL.DEP_NOTES + 5;
COL.DEP_ALERTS = COL.DEP_NOTES + 6;
COL.ROUTE_ALERTS = COL.DEP_NOTES + 7;

// ======================= SETUP / UPGRADE ===========================

function setup() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('SS_ID')) {
    throw new Error('Setup already ran. To add new features to your existing help desk, run upgrade().');
  }
  const ss = SpreadsheetApp.create('IT Help Desk – Tickets');
  buildTicketsSheet_(ss.getSheets()[0].setName(TICKETS_SHEET));
  buildTimeOffSheet_(ss.insertSheet(TIME_OFF_SHEET));
  buildDashboard_(ss.insertSheet(DASHBOARD_SHEET));
  const form = buildForm_();

  props.setProperties({ SS_ID: ss.getId(), FORM_ID: form.getId(), NEXT_ID: '1' });
  ensureCalendar_();

  ScriptApp.newTrigger('onTicketSubmit').forForm(form).onFormSubmit().create();
  ScriptApp.newTrigger('onTicketEdit').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('checkSla').timeBased().everyHours(1).create();

  createRecurringBlocks();

  Logger.log('SETUP COMPLETE');
  Logger.log('Share with users (form link): ' + form.getPublishedUrl());
  Logger.log('Edit the form:                ' + form.getEditUrl());
  Logger.log('Ticket sheet for IT staff:    ' + ss.getUrl());
}

/** Adds new features to a help desk created with an earlier version. Safe to run more than once. */
function upgrade() {
  const props = PropertiesService.getScriptProperties();
  const ssId = props.getProperty('SS_ID');
  if (!ssId) throw new Error('No existing help desk found. Run setup() instead.');

  const ss = SpreadsheetApp.openById(ssId);
  buildTicketsSheet_(ss.getSheetByName(TICKETS_SHEET));
  const timeOff = ss.getSheetByName(TIME_OFF_SHEET);
  if (timeOff) applyTimeOffValidation_(timeOff);
  else buildTimeOffSheet_(ss.insertSheet(TIME_OFF_SHEET));
  buildDashboard_(ss.getSheetByName(DASHBOARD_SHEET) || ss.insertSheet(DASHBOARD_SHEET));
  ensureCalendar_();
  if (!props.getProperty('BLOCKS_CREATED')) createRecurringBlocks();

  // Refresh the form's category choices (adds "Phone system").
  try {
    const form = FormApp.openById(props.getProperty('FORM_ID'));
    const item = form.getItems(FormApp.ItemType.MULTIPLE_CHOICE)
      .find(i => i.getTitle() === Q.CATEGORY);
    if (item) item.asMultipleChoiceItem().setChoiceValues(CATEGORIES);
  } catch (err) {
    Logger.log('Could not update form categories: ' + err);
  }

  Logger.log('UPGRADE COMPLETE. Ticket sheet: ' + ss.getUrl());
}

/** Removes triggers and saved settings. Does NOT delete the Form, Sheet, or calendar. */
function resetSetup() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  PropertiesService.getScriptProperties().deleteAllProperties();
  Logger.log('Cleared. Delete the old Form, Sheet, and "IT Help Desk" calendar if you no longer need them.');
}

/** Creates the recurring Follow-up Window and IT Work Block events and invites IT staff. */
function createRecurringBlocks() {
  const cal = helpdeskCal_();
  const guests = CONFIG.IT_STAFF.join(',');

  const make = (title, schedule, description) => {
    const daysByRange = {};
    Object.keys(schedule).forEach(day =>
      schedule[day].forEach(r => (daysByRange[r] = daysByRange[r] || []).push(day)));

    Object.keys(daysByRange).forEach(r => {
      const days = daysByRange[r];
      const [start, end] = parseRange_(nextMatchingDay_(days), r);
      const rule = CalendarApp.newRecurrence().addWeeklyRule()
        .onlyOnWeekdays(days.map(d => CalendarApp.Weekday[WEEKDAY_ENUM[d]]));
      cal.createEventSeries(title, start, end, rule, { guests, sendInvites: true, description });
    });
  };

  make(CONFIG.WINDOW_TITLE, CONFIG.FOLLOWUP_WINDOWS,
    'Reserved for 15-minute ticket follow-ups and verifications. Booked automatically by the IT Help Desk.');
  make(CONFIG.WORK_BLOCK_TITLE, CONFIG.WORK_BLOCKS,
    'Protected time for hands-on IT work. Routine follow-ups are not booked here.');

  PropertiesService.getScriptProperties().setProperty('BLOCKS_CREATED', 'yes');
  Logger.log('Recurring Follow-up Windows and IT Work Blocks created.');
}

/** Deletes the recurring blocks so you can change CONFIG and run createRecurringBlocks() again. */
function removeRecurringBlocks() {
  const cal = helpdeskCal_();
  const now = new Date();
  const seen = {};
  cal.getEvents(now, new Date(now.getTime() + 400 * 86400000)).forEach(ev => {
    const title = ev.getTitle();
    if (title !== CONFIG.WINDOW_TITLE && title !== CONFIG.WORK_BLOCK_TITLE) return;
    const id = ev.getId();
    if (seen[id]) return;
    seen[id] = true;
    try {
      if (ev.isRecurringEvent()) ev.getEventSeries().deleteEventSeries();
      else ev.deleteEvent();
    } catch (err) { /* already deleted */ }
  });
  PropertiesService.getScriptProperties().deleteProperty('BLOCKS_CREATED');
  Logger.log('Recurring blocks removed.');
}

// ========================= BUILD HELPERS ===========================

function buildForm_() {
  const form = FormApp.create('IT Support Request')
    .setDescription('Tell us what\'s wrong and we\'ll get back to you. ' +
      'If you can\'t work at all, choose "Critical". ' +
      'You\'ll receive short calendar invites for follow-up check-ins.')
    .setConfirmationMessage('Thanks! Your request was submitted. ' +
      'You\'ll get a confirmation email with your ticket number shortly.');

  try { form.setRequireLogin(true); } catch (err) { /* personal accounts */ }
  try {
    form.setEmailCollectionType(FormApp.EmailCollectionType.VERIFIED);
  } catch (err) {
    form.setCollectEmail(true);
  }

  form.addTextItem().setTitle(Q.NAME).setRequired(true);
  form.addMultipleChoiceItem().setTitle(Q.CATEGORY).setChoiceValues(CATEGORIES).setRequired(true);
  form.addMultipleChoiceItem().setTitle(Q.URGENCY)
    .setChoiceValues(URGENCY_OPTIONS.map(u => u.label)).setRequired(true);
  form.addTextItem().setTitle(Q.SUMMARY).setRequired(true);
  form.addParagraphTextItem().setTitle(Q.DESCRIPTION)
    .setHelpText('What happened, any error messages, and what you already tried.').setRequired(true);
  form.addTextItem().setTitle(Q.LOCATION)
    .setHelpText('e.g. "Dell laptop", "front desk printer", "Room 204"');

  try { if (typeof form.setPublished === 'function') form.setPublished(true); } catch (err) {}
  return form;
}

/** Builds or refreshes the Tickets tab. Keeps existing data. */
function buildTicketsSheet_(sheet) {
  if (sheet.getMaxRows() < 5000) sheet.insertRowsAfter(sheet.getMaxRows(), 5000 - sheet.getMaxRows());
  if (sheet.getMaxColumns() < HEADERS.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), HEADERS.length - sheet.getMaxColumns());
  }
  const n = sheet.getMaxRows() - 1;
  const nDeps = CONFIG.DEPENDENCIES.length;

  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
    .setFontWeight('bold').setFontColor('#ffffff').setBackground('#1f3864')
    .setWrap(true).setVerticalAlignment('middle');
  sheet.getRange(1, COL.DEP_START, 1, nDeps + 1).setBackground('#833c0b');
  sheet.getRange(1, COL.f1, 1, 4).setBackground('#375623');
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(1);

  const list = arr => SpreadsheetApp.newDataValidation()
    .requireValueInList(arr, true).setAllowInvalid(false).build();
  const checkbox = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  sheet.getRange(2, COL.STATUS, n).setDataValidation(list(STATUSES));
  // Allow more than one person (comma-separated), e.g. Google + phone tickets.
  sheet.getRange(2, COL.ASSIGNED, n).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(assignablePeople_(), true).setAllowInvalid(true)
    .setHelpText('Pick a person. For more than one, separate emails with a comma.').build());
  sheet.getRange(2, COL.DEP_START, n, nDeps).setDataValidation(checkbox);
  sheet.getRange(2, COL.RESCHEDULE, n).setDataValidation(checkbox);

  [COL.SUBMITTED, COL.DUE, COL.FIRST_RESPONSE, COL.RESOLVED, COL.ESCALATED, COL.f1, COL.f2, COL.v]
    .forEach(c => sheet.getRange(2, c, n).setNumberFormat('ddd yyyy-mm-dd h:mm am/pm'));

  const widths = { 1: 80, 2: 150, 3: 190, 4: 120, 5: 190, 6: 65, 7: 220, 8: 320, 9: 140,
    10: 150, 11: 190, 12: 150, 13: 150, 14: 150, 15: 260, 16: 95, 17: 150 };
  Object.keys(widths).forEach(c => sheet.setColumnWidth(Number(c), widths[c]));
  for (let i = 0; i < nDeps; i++) sheet.setColumnWidth(COL.DEP_START + i, 120);
  sheet.setColumnWidth(COL.DEP_NOTES, 240);
  [COL.f1, COL.f2, COL.v].forEach(c => sheet.setColumnWidth(c, 170));
  sheet.setColumnWidth(COL.RESCHEDULE, 95);
  sheet.hideColumns(COL.EVENT_IDS);
  sheet.getRange(1, COL.DEP_ALERTS, 1, 2).setBackground('#5b2c6f');
  [COL.DEP_ALERTS, COL.ROUTE_ALERTS].forEach(c => {
    sheet.setColumnWidth(c, 300);
    sheet.getRange(2, c, n).setWrap(true);
  });

  const A = colLetter_(COL.ID), J = colLetter_(COL.STATUS), L = colLetter_(COL.DUE);
  const all = sheet.getRange(2, 1, n, HEADERS.length);
  sheet.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=AND($${A}2<>"",$${J}2="New",$${L}2<NOW())`)
      .setBackground('#f4cccc').setRanges([all]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=OR($${J}2="Resolved",$${J}2="Closed")`)
      .setFontColor('#999999').setRanges([all]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('P1')
      .setFontColor('#cc0000').setBold(true)
      .setRanges([sheet.getRange(2, COL.PRIORITY, n)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Waiting on Dependency')
      .setBackground('#fce5cd').setRanges([sheet.getRange(2, COL.STATUS, n)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith('No open slot')
      .setBackground('#fff2cc').setRanges([sheet.getRange(2, COL.f1, n, 3)]).build(),
  ]);
}

function applyTimeOffValidation_(sh) {
  sh.getRange(2, 1, 998).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(assignablePeople_(), true).setAllowInvalid(false).build());
  sh.getRange(2, 2, 998, 2).setNumberFormat('yyyy-mm-dd')
    .setDataValidation(SpreadsheetApp.newDataValidation().requireDate().build());
}

function buildTimeOffSheet_(sh) {
  sh.getRange(1, 1, 1, 4)
    .setValues([['Staff Email (blank = whole team)', 'Start Date', 'End Date', 'Reason']])
    .setFontWeight('bold').setFontColor('#ffffff').setBackground('#1f3864');
  sh.setFrozenRows(1);
  applyTimeOffValidation_(sh);
  [240, 110, 110, 240].forEach((w, i) => sh.setColumnWidth(i + 1, w));
  sh.getRange('F1').setValue('Add vacation, PTO, and office holidays here. ' +
    'No follow-ups are booked for that person (or anyone, if email is blank) on these dates, ' +
    'and follow-ups for their tickets move to the next day they are in.').setWrap(true).setFontStyle('italic');
  sh.setColumnWidth(6, 320);
}

function buildDashboard_(sh) {
  sh.clear();
  const T = TICKETS_SHEET;
  const rng = c => `${T}!${colLetter_(c)}2:${colLetter_(c)}`;
  const open = `${rng(COL.STATUS)},"<>Resolved",${rng(COL.STATUS)},"<>Closed"`;

  const rows = [
    ['IT Help Desk Dashboard', ''],
    ['', ''],
    ['Open tickets', `=COUNTIFS(${rng(COL.ID)},"<>",${open})`],
    ['Overdue (no response, past due)', `=COUNTIFS(${rng(COL.STATUS)},"New",${rng(COL.DUE)},"<"&NOW())`],
    ['Submitted this month', `=COUNTIFS(${rng(COL.SUBMITTED)},">="&(EOMONTH(TODAY(),-1)+1))`],
    ['Resolved this month', `=COUNTIFS(${rng(COL.RESOLVED)},">="&(EOMONTH(TODAY(),-1)+1))`],
    ['Avg hours to resolve', `=IFERROR(ROUND(AVERAGE(${rng(COL.HOURS)}),1),"–")`],
    ['First responses within SLA',
      `=IFERROR(SUMPRODUCT((${rng(COL.FIRST_RESPONSE)}<>"")*(${rng(COL.FIRST_RESPONSE)}<=${rng(COL.DUE)}))` +
      `/COUNTIF(${rng(COL.FIRST_RESPONSE)},"<>"),"–")`],
    ['Meetings booked, next 7 days', '=' + MEETING_KINDS.map(k =>
      `COUNTIFS(${rng(COL[k])},">="&NOW(),${rng(COL[k])},"<"&(NOW()+7))`).join('+')],
    ['Meetings that need manual booking', '=' + MEETING_KINDS.map(k =>
      `COUNTIF(${rng(COL[k])},"No open slot*")`).join('+')],
  ];
  const slaRow = 8;

  const section = (title, items, formula) => {
    rows.push(['', ''], [title, 'Count']);
    items.forEach((item, i) => rows.push([item, formula(rows.length + 1, i)]));
  };
  section('By status', STATUSES, r => `=COUNTIF(${rng(COL.STATUS)},A${r})`);
  section('Open tickets by dependency', CONFIG.DEPENDENCIES,
    (r, i) => `=COUNTIFS(${rng(COL.DEP_START + i)},TRUE,${open})`);
  section('By category', CATEGORIES, r => `=COUNTIF(${rng(COL.CATEGORY)},A${r})`);

  sh.getRange(1, 1, rows.length, 2).setValues(rows);
  sh.getRange('A1').setFontSize(16).setFontWeight('bold');
  sh.getRange(slaRow, 2).setNumberFormat('0%');
  rows.forEach((r, i) => {
    if (r[1] === 'Count') sh.getRange(i + 1, 1, 1, 2).setFontWeight('bold').setBackground('#d9e2f3');
  });
  sh.setColumnWidth(1, 320);
  sh.setColumnWidth(2, 100);
}

// ========================= AUTOMATIONS =============================

/** Runs on every form submission. */
function onTicketSubmit(e) {
  const response = e.response;
  const answers = {};
  response.getItemResponses().forEach(ir => { answers[ir.getItem().getTitle()] = ir.getResponse(); });

  // Include questions added to the form later (file uploads become Drive links).
  const known = Object.values(Q);
  const extras = response.getItemResponses()
    .filter(ir => !known.includes(ir.getItem().getTitle()))
    .map(ir => {
      const v = ir.getResponse();
      const text = ir.getItem().getType() === FormApp.ItemType.FILE_UPLOAD
        ? v.map(id => 'https://drive.google.com/open?id=' + id).join(' ')
        : [].concat(v).join(', ');
      return ir.getItem().getTitle() + ': ' + text;
    });

  const submitted = response.getTimestamp();
  const urgency = URGENCY_OPTIONS.find(u => u.label === answers[Q.URGENCY]) || URGENCY_OPTIONS[2];
  const hours = CONFIG.SLA_HOURS[urgency.priority];
  const due = addHours_(submitted, hours);

  const t = {
    email: response.getRespondentEmail() || '',
    name: answers[Q.NAME] || '',
    category: answers[Q.CATEGORY] || '',
    priority: urgency.priority,
    summary: answers[Q.SUMMARY] || '',
    description: [answers[Q.DESCRIPTION] || ''].concat(extras).join('\n\n'),
    location: answers[Q.LOCATION] || '',
    deps: [],
    depNotes: '',
  };

  const sheet = getTicketsSheet_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let row;
  try {
    const props = PropertiesService.getScriptProperties();
    const num = Number(props.getProperty('NEXT_ID') || 1);
    t.id = 'IT-' + String(num).padStart(4, '0');
    props.setProperty('NEXT_ID', String(num + 1));
    t.assigned = matchRoutingRules_(t).map(m => m.rule.assignTo)
      .filter((x, i, a) => x && a.indexOf(x) === i).join(', ');

    row = lastTicketRow_(sheet) + 1;
    sheet.getRange(row, 1, 1, COL.DUE).setValues([[
      t.id, submitted, t.email, safe_(t.name), t.category, t.priority,
      safe_(t.summary), safe_(t.description), safe_(t.location), 'New', t.assigned, due,
    ]]);
    const N = colLetter_(COL.RESOLVED), B = colLetter_(COL.SUBMITTED);
    sheet.getRange(row, COL.HOURS)
      .setFormula(`=IF(${N}${row}="","",ROUND((${N}${row}-${B}${row})*24,1))`);
  } finally {
    lock.releaseLock();
  }

  // Book follow-ups (outside the lock; calendar calls can be slow).
  // Wrapped so a calendar problem can never stop IT from being notified.
  const events = {};
  const problems = [];
  try {
    const plan = CONFIG.FOLLOWUPS[t.priority] || {};
    let f1 = null;
    if (plan.first != null) f1 = bookInto_(sheet, row, t, events, 'f1', addHours_(submitted, plan.first));
    if (plan.second != null) {
      let earliest = addHours_(submitted, plan.second);
      if (f1 && f1.end > earliest.getTime()) earliest = new Date(f1.end);
      bookInto_(sheet, row, t, events, 'f2', earliest);
    }
  } catch (err) {
    problems.push('Meeting booking failed: ' + err);
  }
  try { saveEvents_(sheet, row, events); } catch (err) { problems.push('Could not save meeting IDs: ' + err); }
  t.events = events;
  const meetings = meetingLines_(events);

  // 1) IT STAFF – always notified about every new ticket, whatever the category.
  const routes = matchRoutingRules_(t);
  const routedTo = routes.length
    ? routes.map(m => `${m.rule.name} → ${m.rule.notify.join(', ')}`).join('; ')
    : 'none (general IT ticket)';
  const depCols = colLetter_(COL.DEP_START) + '–' + colLetter_(COL.DEP_NOTES);
  const watchers = CONFIG.NEW_TICKET_WATCHERS.filter(w => !CONFIG.IT_STAFF.includes(w));
  const itAlert = () => MailApp.sendEmail(Object.assign({
    to: CONFIG.IT_STAFF.join(','),
    subject: `${t.priority === 'P1' ? 'URGENT ' : ''}[${t.id}] ${t.priority} – ${t.summary}`,
    body:
      `New ticket ${t.id}\n\n` +
      `From: ${t.name} <${t.email}>\nCategory: ${t.category}\nPriority: ${t.priority}\n` +
      `Assigned to: ${t.assigned || 'UNASSIGNED – assign yourself in the Assigned To column'}\n` +
      `Also routed to: ${routedTo}\n` +
      `Response due: ${fmt_(due)}\n` +
      `Device/location: ${t.location || '–'}\n\n` +
      (meetings ? `Meetings booked:\n${meetings}\n\n` : 'No meetings could be booked automatically.\n\n') +
      (problems.length ? `PROBLEMS:\n${problems.join('\n')}\n\n` : '') +
      `${t.description}\n\n` +
      `Next step: assess dependencies (columns ${depCols}).\n` +
      `Open ticket: ${rowLink_(sheet, row)}`,
  }, watchers.length ? { cc: watchers.join(',') } : {}));
  try {
    itAlert();
  } catch (err) {
    Utilities.sleep(5000);   // one retry for a temporary mail hiccup
    itAlert();
  }

  // 2) Category routing (Michael / Cindy).
  try {
    routeTicket_(sheet, row, t);
  } catch (err) {
    MailApp.sendEmail(CONFIG.IT_STAFF.join(','), `[${t.id}] Routing email failed`,
      `The ${routedTo} notification for ${t.id} could not be sent: ${err}\n\n${rowLink_(sheet, row)}`);
  }

  // 3) Requester confirmation.
  if (t.email) {
    try {
      MailApp.sendEmail({
        to: t.email,
        subject: `[${t.id}] We received your request: ${t.summary}`,
        body:
          `Hi ${t.name},\n\n` +
          `Thanks for contacting ${CONFIG.SUPPORT_NAME}. Your ticket number is ${t.id}.\n\n` +
          `Summary: ${t.summary}\nPriority: ${t.priority}\n` +
          `You can expect a first response within ${hoursLabel_(hours)}.\n\n` +
          (meetings ? `We've scheduled short check-ins with you (calendar invites to follow):\n${meetings}\n\n` : '') +
          `If you have more details or screenshots, reply to this email and include ${t.id}.\n\n` +
          `– ${CONFIG.SUPPORT_NAME}`,
      });
    } catch (err) {
      Logger.log(`Requester confirmation for ${t.id} failed: ${err}`);
    }
  }
}

/** Runs when someone edits the Tickets sheet. */
function onTicketEdit(e) {
  if (!e || !e.range) return;
  const range = e.range;
  const sheet = range.getSheet();
  if (sheet.getName() !== TICKETS_SHEET || range.getRow() < 2 ||
      range.getNumRows() > 1 || range.getNumColumns() > 1) return;

  const row = range.getRow();
  const col = range.getColumn();
  const value = range.getValue();
  const t = rowToTicket_(sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0]);
  if (!t.id) return;
  const now = new Date();
  const events = t.events;
  const plan = CONFIG.FOLLOWUPS[t.priority] || {};

  // Ticking a dependency counts as IT's first response (the ticket has been assessed).
  const isDepCol = col >= COL.DEP_START && col < COL.DEP_START + CONFIG.DEPENDENCIES.length;
  if (isDepCol && value === true) {
    if (!t.firstResponse) sheet.getRange(row, COL.FIRST_RESPONSE).setValue(now);
    notifyDependencyContacts_(sheet, row, t, CONFIG.DEPENDENCIES[col - COL.DEP_START]);
  }

  if (col === COL.STATUS) {
    if (value && value !== 'New' && !t.firstResponse) {
      sheet.getRange(row, COL.FIRST_RESPONSE).setValue(now);
    }

    // Reopened: clear resolution, drop the verification, book a new follow-up.
    const reopened = DONE.includes(e.oldValue) && !DONE.includes(value);
    if (reopened) {
      sheet.getRange(row, COL.RESOLVED).clearContent();
      cancelIfUpcoming_(sheet, row, events, 'v', 'Cancelled – reopened');
      bookInto_(sheet, row, t, events, 'f2', addHours_(now, plan.first != null ? plan.first : 1));
      notifyItLifecycle_(sheet, row, t, 'Reopened', e, null);
    }

    if (value === 'Resolved') {
      if (!t.resolved) sheet.getRange(row, COL.RESOLVED).setValue(now);
      cancelIfUpcoming_(sheet, row, events, 'f1', 'Cancelled – resolved');
      cancelIfUpcoming_(sheet, row, events, 'f2', 'Cancelled – resolved');
      const v = plan.verify != null
        ? bookInto_(sheet, row, t, events, 'v', addHours_(now, plan.verify)) : null;
      notifyResolved_(t, v);
      notifyItLifecycle_(sheet, row, t, 'Resolved', e, v);
    } else if (value === 'Closed') {
      MEETING_KINDS.forEach(k => cancelIfUpcoming_(sheet, row, events, k, 'Cancelled – closed'));
      notifyItLifecycle_(sheet, row, t, 'Closed', e, null);
    } else if (value === 'Waiting on User') {
      notifyWaiting_(t);
    } else if (value === 'Waiting on Dependency') {
      notifyDependency_(t, events);
    }
    saveEvents_(sheet, row, events);
  }

  if (col === COL.ASSIGNED && value) {
    // Re-book upcoming meetings around the assignees' calendars, as close to the original times as possible.
    t.assigned = value;
    moveUpcoming_(sheet, row, t, events, old => Math.max(Date.now(), old.start));
    saveEvents_(sheet, row, events);
    const meetings = meetingLines_(events, true);
    let editor = '';
    try { editor = e.user ? String(e.user.getEmail()).toLowerCase() : ''; } catch (err) {}
    const notify = assignees_(value).filter(a => a !== editor);   // no email to yourself
    if (!notify.length) return;
    MailApp.sendEmail({
      to: notify.join(','),
      subject: `Assigned to you: [${t.id}] ${t.priority} – ${t.summary}`,
      body:
        `${t.id} has been assigned to you.\n\n` +
        `From: ${t.name} <${t.email}>\nPriority: ${t.priority}\n` +
        `Response due: ${t.due instanceof Date ? fmt_(t.due) : '–'}\n\n` +
        (meetings ? `Upcoming meetings:\n${meetings}\n\n` : '') +
        `${t.description}\n\nOpen ticket: ${rowLink_(sheet, row)}`,
    });
  }

  if (col === COL.RESCHEDULE && value === true) {
    // Push each upcoming meeting to the next open slot after its current time.
    const moved = moveUpcoming_(sheet, row, t, events, old => old.end);
    if (!moved) {
      if (t.status === 'Resolved') bookInto_(sheet, row, t, events, 'v', now);
      else if (!DONE.includes(t.status)) bookInto_(sheet, row, t, events, 'f2', now);
    }
    range.setValue(false);
    saveEvents_(sheet, row, events);
  }
}

/** Runs hourly: alerts IT about tickets still "New" past their response due time. */
function checkSla() {
  const sheet = getTicketsSheet_();
  const last = lastTicketRow_(sheet);
  if (last < 2) return;
  const data = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
  const now = new Date();

  data.forEach((r, i) => {
    const t = rowToTicket_(r);
    if (t.id && t.status === 'New' && t.due instanceof Date && t.due < now && !t.escalated) {
      MailApp.sendEmail({
        to: CONFIG.IT_STAFF.join(','),
        subject: `OVERDUE [${t.id}] ${t.priority} – no response yet: ${t.summary}`,
        body:
          `${t.id} passed its response target (${fmt_(t.due)}) and is still New.\n\n` +
          `From: ${t.name} <${t.email}>\nAssigned to: ${t.assigned || 'unassigned'}\n` +
          `Category: ${t.category}\n\nOpen ticket: ${rowLink_(sheet, i + 2)}`,
      });
      sheet.getRange(i + 2, COL.ESCALATED).setValue(now);
    }
  });
}

// ======================= MEETING SCHEDULING ========================

/** Books a meeting and records it in the row. Returns {id, start, end} or null. */
function bookInto_(sheet, row, t, events, kind, earliest) {
  const minStart = new Date(Date.now() + CONFIG.MIN_NOTICE_MINUTES * 60000);
  const from = earliest > minStart ? earliest : minStart;
  const people = assignees_(t.assigned);
  const slot = findSlot_(from, people, t.priority);

  if (!slot) {
    delete events[kind];
    sheet.getRange(row, COL[kind]).setValue('No open slot – book manually');
    return null;
  }
  const end = new Date(slot.getTime() + CONFIG.MEETING_MINUTES * 60000);
  const ev = helpdeskCal_().createEvent(`${MEETING_LABELS[kind]}: [${t.id}] ${t.summary}`, slot, end, {
    description: meetingDescription_(t, kind),
    // Unassigned tickets invite all IT staff; the invite moves to the assignee(s) once assigned.
    guests: [t.email].concat(people.length ? people : CONFIG.IT_STAFF).filter(Boolean).join(','),
    sendInvites: true,
  });
  const m = { id: ev.getId(), start: slot.getTime(), end: end.getTime() };
  events[kind] = m;
  sheet.getRange(row, COL[kind]).setValue(slot);
  return m;
}

/** Deletes a meeting if it hasn't happened yet. Returns the old meeting or null. */
function cancelIfUpcoming_(sheet, row, events, kind, label) {
  const m = events[kind];
  if (!m || m.start <= Date.now()) return null;
  try {
    const ev = helpdeskCal_().getEventById(m.id);
    if (ev) ev.deleteEvent();
  } catch (err) { /* already gone */ }
  delete events[kind];
  if (label) sheet.getRange(row, COL[kind]).setValue(label);
  return m;
}

/** Cancels and re-books every upcoming meeting. earliestFn(oldMeeting) -> ms timestamp. */
function moveUpcoming_(sheet, row, t, events, earliestFn) {
  let moved = 0;
  let floor = 0;
  MEETING_KINDS.forEach(kind => {
    const old = cancelIfUpcoming_(sheet, row, events, kind, null);
    if (!old) return;
    const m = bookInto_(sheet, row, t, events, kind, new Date(Math.max(earliestFn(old), floor)));
    if (m) floor = m.end;
    moved++;
  });
  return moved;
}

/** Finds the first free 15-minute-aligned slot at or after `earliest`. */
function findSlot_(earliest, people, priority) {
  const anytime = CONFIG.ANYTIME_PRIORITIES.includes(priority);
  const windows = anytime ? CONFIG.WORK_HOURS : CONFIG.FOLLOWUP_WINDOWS;
  const len = CONFIG.MEETING_MINUTES * 60000;
  const step = 15 * 60000;
  const from = Math.ceil(earliest.getTime() / step) * step;
  const firstDay = startOfDay_(new Date(from));

  for (let d = 0; d < CONFIG.SEARCH_DAYS; d++) {
    const day = new Date(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate() + d);
    const ranges = windows[DAY_KEYS[day.getDay()]] || [];
    const someoneOff = people.length ? people.some(p => isOff_(p, day)) : isOff_('', day);
    if (!ranges.length || someoneOff) continue;

    const avail = dayAvailability_(day, people, anytime);
    if (avail.off) continue;

    for (const r of ranges) {
      const [ws, we] = parseRange_(day, r);
      for (let t = Math.max(ws.getTime(), from); t + len <= we.getTime(); t += step) {
        if (!avail.busy.some(b => t < b.end && t + len > b.start)) return new Date(t);
      }
    }
  }
  return null;
}

/** Busy times for one day from the help desk calendar and each assignee's own calendar. */
function dayAvailability_(day, people, anytime) {
  const start = startOfDay_(day);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  const busy = [];
  let off = false;

  const consider = (ev, fromHelpdesk) => {
    const title = ev.getTitle() || '';
    if (title.startsWith(CONFIG.WINDOW_TITLE)) return;             // windows are where we WANT to book
    const isWorkBlock = title.startsWith(CONFIG.WORK_BLOCK_TITLE);
    if (isWorkBlock && anytime) return;                              // critical tickets may use work blocks
    if (ev.isAllDayEvent()) {
      if (CONFIG.TIME_OFF_WORDS.test(title)) off = true;
      return;
    }
    // Follow-ups for other people on the shared calendar don't block these assignees.
    if (fromHelpdesk && people.length && !isWorkBlock) {
      const guests = ev.getGuestList().map(g => g.getEmail().toLowerCase());
      if (!people.some(p => guests.includes(p))) return;
    }
    busy.push({ start: ev.getStartTime().getTime(), end: ev.getEndTime().getTime() });
  };

  helpdeskCal_().getEvents(start, end).forEach(ev => consider(ev, true));
  people.forEach(p => {
    const own = staffCal_(p);
    if (own) {
      try { own.getEvents(start, end).forEach(ev => consider(ev, false)); } catch (err) {}
    }
  });
  return { off, busy };
}

function meetingDescription_(t, kind) {
  const purpose = {
    f1: 'First follow-up: confirm the problem, gather any missing details, and agree on next steps.',
    f2: 'Second follow-up: progress update and any open questions.',
    v: 'Verification: confirm the fix is working. If all is well, IT will close the ticket.',
  }[kind];
  const deps = t.deps && t.deps.length
    ? `\nDependencies: ${t.deps.join(', ')}${t.depNotes ? ' – ' + t.depNotes : ''}` : '';
  return `${purpose}\n\n` +
    `Ticket: ${t.id}\nSummary: ${t.summary}\nPriority: ${t.priority}\n` +
    `Requester: ${t.name} <${t.email}>\nIT contact: ${t.assigned || CONFIG.SUPPORT_NAME}${deps}\n\n` +
    `Description:\n${t.description}\n\n` +
    `Can't make this time? Use "Propose a new time" on the invite, or reply to IT with ${t.id}.`;
}

function meetingLines_(events, upcomingOnly) {
  return MEETING_KINDS
    .filter(k => events[k] && (!upcomingOnly || events[k].start > Date.now()))
    .map(k => `  ${MEETING_LABELS[k]}: ${fmt_(new Date(events[k].start))}`)
    .join('\n');
}

// ======================= TIME OFF & ASSIGNMENT =====================

let _timeOff = null;
function readTimeOff_() {
  if (_timeOff) return _timeOff;
  const ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SS_ID'));
  const sh = ss.getSheetByName(TIME_OFF_SHEET);
  if (!sh || sh.getLastRow() < 2) return (_timeOff = []);
  _timeOff = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues()
    .filter(r => r[1] instanceof Date)
    .map(r => ({
      email: String(r[0] || '').toLowerCase(),
      start: startOfDay_(r[1]).getTime(),
      end: startOfDay_(r[2] instanceof Date ? r[2] : r[1]).getTime(),
    }));
  return _timeOff;
}

/** True if this person (or the whole team) is off on this date. */
function isOff_(email, day) {
  const d = startOfDay_(day).getTime();
  const e = (email || '').toLowerCase();
  return readTimeOff_().some(r => (!r.email || r.email === e) && r.start <= d && r.end >= d);
}

// ========================= NOTIFICATIONS ===========================

function notifyResolved_(t, verification) {
  if (!t.email) return;
  MailApp.sendEmail({
    to: t.email,
    subject: `[${t.id}] Resolved: ${t.summary}`,
    body:
      `Hi ${t.name},\n\nYour ticket ${t.id} has been marked resolved.\n\n` +
      (t.notes ? `What we did:\n${t.notes}\n\n` : '') +
      (verification
        ? `We've scheduled a ${CONFIG.MEETING_MINUTES}-minute verification check on ` +
          `${fmt_(new Date(verification.start))} to make sure everything is working. ` +
          `A calendar invite is on its way.\n\n`
        : '') +
      `If the problem isn't fixed, reply to this email and we'll reopen it.\n\n– ${CONFIG.SUPPORT_NAME}`,
  });
}

function notifyWaiting_(t) {
  if (!t.email) return;
  MailApp.sendEmail({
    to: t.email,
    subject: `[${t.id}] We need a bit more info: ${t.summary}`,
    body:
      `Hi ${t.name},\n\nWe're working on ${t.id} but need more information from you ` +
      `before we can continue. Someone from IT will follow up shortly, or you can reply ` +
      `to this email with any details you think will help.\n\n– ${CONFIG.SUPPORT_NAME}`,
  });
}

function notifyDependency_(t, events) {
  if (!t.email) return;
  const deps = t.deps.length ? t.deps.map(d => '  • ' + d).join('\n') : '  • Details to follow from IT';
  const upcoming = meetingLines_(events, true);
  MailApp.sendEmail({
    to: t.email,
    subject: `[${t.id}] Update: waiting on a dependency – ${t.summary}`,
    body:
      `Hi ${t.name},\n\nWe've assessed ${t.id}. Before we can finish, we need:\n${deps}\n\n` +
      (t.depNotes ? `Notes: ${t.depNotes}\n\n` : '') +
      `This may take a little longer than usual. We'll keep you posted.\n\n` +
      (upcoming ? `Upcoming check-ins:\n${upcoming}\n\n` : '') +
      `– ${CONFIG.SUPPORT_NAME}`,
  });
}

/** Routing rules whose category list includes this ticket's category. */
function matchRoutingRules_(t) {
  return CONFIG.ROUTING_RULES
    .filter(rule => (rule.categories || []).includes(t.category))
    .map(rule => ({ rule }));
}

/** Assigned To cell -> list of lowercase emails ("a@x.com, b@x.com" -> [a, b]). */
function assignees_(value) {
  return String(value || '').split(/[,;]/).map(x => x.trim().toLowerCase())
    .filter((x, i, a) => x && a.indexOf(x) === i);
}

/** Everyone who can appear in the Assigned To and Time Off dropdowns. */
function assignablePeople_() {
  return CONFIG.IT_STAFF.concat(CONFIG.ROUTING_RULES.map(r => r.assignTo))
    .filter((x, i, a) => x && a.indexOf(x) === i);
}

/** New-ticket routing by category: emails each matching rule's contacts. */
function routeTicket_(sheet, row, t) {
  const log = [];
  matchRoutingRules_(t).forEach(({ rule }) => {
    if (!rule.notify.length) return;
    const assignedHere = assignees_(t.assigned).includes(String(rule.assignTo || '').toLowerCase());
    const meetings = meetingLines_(t.events || {});
    MailApp.sendEmail({
      to: rule.notify.join(','),
      subject: `${assignedHere ? 'Assigned to you' : rule.name + ' ticket'}: [${t.id}] ${t.priority} – ${t.summary}`,
      body:
        `${t.id} was submitted under the "${t.category}" category` +
        `${assignedHere ? ' and has been assigned to you' : ''}.\n\n` +
        `From: ${t.name} <${t.email}>\nCategory: ${t.category}\nPriority: ${t.priority}\n` +
        `Assigned to: ${t.assigned || 'unassigned'}\nDevice/location: ${t.location || '–'}\n\n` +
        `Summary: ${t.summary}\n\n${t.description}\n\n` +
        (meetings ? `Meetings booked:\n${meetings}\n\n` : '') +
        `Open ticket: ${rowLink_(sheet, row)}`,
    });
    log.push(`${rule.name} → ${rule.notify.join(', ')} (${fmt_(new Date())})`);
  });
  if (log.length) sheet.getRange(row, COL.ROUTE_ALERTS).setValue(log.join('\n'));
}

/** Dependency alert: emails the dependency contacts once per box per ticket. */
function notifyDependencyContacts_(sheet, row, t, dep) {
  const sent = String(t.depAlerts || '');
  if (sent.split('\n').some(line => line.startsWith(dep + ' →'))) return;

  const to = CONFIG.DEPENDENCY_CONTACTS.concat(CONFIG.DEPENDENCY_EXTRA_CONTACTS[dep] || [])
    .filter((x, i, a) => x && a.indexOf(x) === i);
  if (!to.length) return;
  const cc = [CONFIG.DEPENDENCY_CC_REQUESTER ? t.email : ''].concat(assignees_(t.assigned))
    .filter(x => x && !to.includes(x));

  const all = t.deps.length ? t.deps.map(d => '  • ' + d).join('\n') : '  • ' + dep;
  const upcoming = meetingLines_(t.events || {}, true);
  MailApp.sendEmail(Object.assign({
    to: to.join(','),
    subject: `[${t.id}] Dependency: ${dep} – ${t.summary}`,
    body:
      `IT has flagged ticket ${t.id} as needing: ${dep}\n\n` +
      `All dependencies on this ticket so far:\n${all}\n\n` +
      (t.depNotes ? `Dependency notes: ${t.depNotes}\n\n` : '') +
      `Requester: ${t.name} <${t.email}>\nPriority: ${t.priority}\n` +
      `Assigned to: ${t.assigned || 'unassigned'}\nCategory: ${t.category}\n\n` +
      `Summary: ${t.summary}\n\n${t.description}\n\n` +
      (upcoming ? `Upcoming meetings:\n${upcoming}\n\n` : '') +
      `IT staff – open ticket: ${rowLink_(sheet, row)}`,
  }, cc.length ? { cc: cc.join(',') } : {}));

  const line = `${dep} → ${to.join(', ')} (${fmt_(new Date())})`;
  sheet.getRange(row, COL.DEP_ALERTS).setValue(sent ? sent + '\n' + line : line);
}

/**
 * Keeps IT staff in the loop when a ticket owned by someone outside IT_STAFF
 * (e.g. Michael's Google tickets, Cindy's phone tickets) is resolved, closed, or reopened.
 */
function notifyItLifecycle_(sheet, row, t, event, e, verification) {
  const itStaff = CONFIG.IT_STAFF.map(x => x.toLowerCase());
  const owners = assignees_(t.assigned);
  if (!owners.some(a => !itStaff.includes(a))) return;   // IT's own tickets: no FYI needed

  let editor = '';
  try { editor = e && e.user ? String(e.user.getEmail()) : ''; } catch (err) {}
  const hours = sheet.getRange(row, COL.HOURS).getValue();

  try {
    MailApp.sendEmail({
      to: CONFIG.IT_STAFF.join(','),
      subject: `FYI ${event}: [${t.id}] ${t.priority} – ${t.summary}`,
      body:
        `${t.id} was marked ${event}${editor ? ' by ' + editor : ''}.\n\n` +
        `Assigned to: ${t.assigned}\nRequester: ${t.name} <${t.email}>\n` +
        `Category: ${t.category}\nPriority: ${t.priority}\n` +
        (event === 'Resolved' && hours !== '' ? `Time to resolve: ${hours} hours\n` : '') +
        (t.deps && t.deps.length ? `Dependencies: ${t.deps.join(', ')}\n` : '') +
        `\nResolution notes: ${t.notes || '(none entered)'}\n` +
        (verification ? `Verification meeting: ${fmt_(new Date(verification.start))}\n` : '') +
        `\nOpen ticket: ${rowLink_(sheet, row)}`,
    });
  } catch (err) {
    Logger.log(`IT lifecycle FYI for ${t.id} failed: ${err}`);
  }
}

// ============================ HELPERS ==============================

function ensureCalendar_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('CAL_ID');
  if (id && CalendarApp.getCalendarById(id)) return;
  const cal = CalendarApp.createCalendar('IT Help Desk', {
    timeZone: Session.getScriptTimeZone(),
    summary: 'Ticket follow-ups, verifications, and IT time blocks. Managed by the IT Help Desk script.',
  });
  props.setProperty('CAL_ID', cal.getId());
}

let _helpdeskCal = null;
function helpdeskCal_() {
  if (!_helpdeskCal) {
    _helpdeskCal = CalendarApp.getCalendarById(
      PropertiesService.getScriptProperties().getProperty('CAL_ID'));
  }
  return _helpdeskCal;
}

const _staffCals = {};
/** The tech's own calendar, if this account can see it. Otherwise null. */
function staffCal_(email) {
  if (!email) return null;
  if (email in _staffCals) return _staffCals[email];
  let cal = null;
  try {
    if (email.toLowerCase() === Session.getEffectiveUser().getEmail().toLowerCase()) {
      cal = CalendarApp.getDefaultCalendar();
    } else {
      cal = CalendarApp.getCalendarById(email) ||
        CalendarApp.subscribeToCalendar(email, { hidden: true, selected: false });
    }
  } catch (err) {
    cal = null;
  }
  _staffCals[email] = cal;
  return cal;
}

function getTicketsSheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SS_ID');
  return SpreadsheetApp.openById(id).getSheetByName(TICKETS_SHEET);
}

/** Last row that has a Ticket ID (ignores stray checkbox values further down). */
function lastTicketRow_(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return 1;
  const ids = sheet.getRange(2, COL.ID, last - 1, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) if (ids[i][0] !== '') return i + 2;
  return 1;
}

function rowToTicket_(r) {
  const g = c => r[c - 1];
  let events = {};
  try { events = JSON.parse(g(COL.EVENT_IDS) || '{}'); } catch (err) { events = {}; }
  return {
    id: g(COL.ID), email: g(COL.EMAIL), name: g(COL.NAME), category: g(COL.CATEGORY),
    priority: g(COL.PRIORITY), summary: g(COL.SUMMARY), description: g(COL.DESCRIPTION),
    status: g(COL.STATUS), assigned: g(COL.ASSIGNED), due: g(COL.DUE),
    firstResponse: g(COL.FIRST_RESPONSE), resolved: g(COL.RESOLVED), notes: g(COL.NOTES),
    escalated: g(COL.ESCALATED),
    deps: CONFIG.DEPENDENCIES.filter((d, i) => r[COL.DEP_START - 1 + i] === true),
    depNotes: g(COL.DEP_NOTES),
    depAlerts: g(COL.DEP_ALERTS),
    events,
  };
}

function saveEvents_(sheet, row, events) {
  sheet.getRange(row, COL.EVENT_IDS).setValue(JSON.stringify(events));
}

function rowLink_(sheet, row) {
  return sheet.getParent().getUrl() + '#gid=' + sheet.getSheetId() + '&range=A' + row;
}

/** Stops user-typed text that starts with = + - @ from being run as a formula. */
function safe_(v) {
  return (typeof v === 'string' && /^[=+\-@]/.test(v)) ? "'" + v : v;
}

function parseRange_(day, range) {
  const [a, b] = range.split('-').map(s => s.trim().split(':').map(Number));
  return [
    new Date(day.getFullYear(), day.getMonth(), day.getDate(), a[0], a[1] || 0),
    new Date(day.getFullYear(), day.getMonth(), day.getDate(), b[0], b[1] || 0),
  ];
}

function nextMatchingDay_(dayKeys) {
  const today = startOfDay_(new Date());
  for (let i = 0; i < 7; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    if (dayKeys.includes(DAY_KEYS[d.getDay()])) return d;
  }
  return today;
}

function startOfDay_(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addHours_(d, h) {
  return new Date(d.getTime() + h * 3600 * 1000);
}

function colLetter_(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function fmt_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'EEE MMM d, h:mm a');
}

function hoursLabel_(h) {
  if (h < 24) return h + (h === 1 ? ' hour' : ' hours');
  const d = h / 24;
  return d + (d === 1 ? ' day' : ' days');
}
