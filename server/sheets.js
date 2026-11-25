import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';
import { demo } from './data.js';

function readCredentials() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try { return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON); }
    catch { throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON must contain valid JSON.'); }
  }
  if (process.env.GOOGLE_SERVICE_ACCOUNT_FILE) {
    const file = path.resolve(process.cwd(), process.env.GOOGLE_SERVICE_ACCOUNT_FILE);
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { throw new Error('Could not read the configured Google service account file.'); }
  }
  return null;
}

const credentials = readCredentials();
const id = process.env.GOOGLE_SHEET_ID;
export const sheetsEnabled = Boolean(credentials && id);
let sheets;
if (sheetsEnabled) {
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  sheets = google.sheets({ version: 'v4', auth });
}

const tabs = {
  faculty: 'Faculty Directory',
  responsibilities: 'Responsibilities',
  tasks: 'Assigned Tasks',
  updates: 'Task Updates',
  reminders: 'Reminder Log',
};
const palette = ['violet', 'blue', 'rose', 'amber', 'teal', 'indigo'];
const truthy = value => ['true', 'yes', '1', 'active'].includes(String(value ?? '').trim().toLowerCase());
const normalizeStatus = value => {
  const status = String(value || '').trim().toLowerCase();
  if (['completed', 'complete', 'done', 'closed'].includes(status)) return 'Completed';
  if (['in progress', 'in-progress', 'ongoing', 'started'].includes(status)) return 'In progress';
  return 'Not started';
};
function dateValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString().slice(0, 10);
  }
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const parsed = new Date(raw);
  return Number.isNaN(parsed.valueOf()) ? '' : parsed.toISOString().slice(0, 10);
}
function parseTable(values = []) {
  const headers = (values[0] || []).map(value => String(value || '').trim());
  const rows = values.slice(1).map((row, index) => ({
    rowNumber: index + 2,
    values: row,
    record: Object.fromEntries(headers.map((header, col) => [header, row[col] ?? ''])),
  })).filter(row => row.values.some(value => value !== '' && value != null));
  return { headers, rows };
}
async function readTables() {
  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: id,
    ranges: Object.values(tabs).map(title => `'${title}'!A:Z`),
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const values = response.data.valueRanges || [];
  return Object.fromEntries(Object.keys(tabs).map((key, index) => [key, parseTable(values[index]?.values)]));
}
function findFacultyIds(candidate, faculty) {
  const key = String(candidate || '').trim().toLowerCase();
  if (!key) return [];
  const exact = faculty.filter(person => [person.id, person.email, person.username, person.name]
    .some(value => String(value || '').trim().toLowerCase() === key)).map(person => person.id);
  if (exact.length) return [...new Set(exact)];
  return [...new Set(faculty.filter(person => {
    const name = String(person.name || '').trim().toLowerCase();
    const id = String(person.id || '').trim().toLowerCase();
    const email = String(person.email || '').trim().toLowerCase();
    const username = String(person.username || '').trim().toLowerCase();
    return (name.length > 3 && key.includes(name)) || (id.length > 3 && key.includes(id)) || (email && key.includes(email)) || (username.length > 3 && key.includes(username));
  }).map(person => person.id))];
}
function mapTables(tableData) {
  const faculty = tableData.faculty.rows.map(({ record: r }, index) => ({
    id: String(r.faculty_id || ''), name: String(r.faculty_name || ''), email: String(r.email || ''),
    username: String(r.username || ''), passwordHash: String(r.password_hash || ''),
    title: String(r.academic_title || r.designation || r.title || 'Faculty'),
    department: String(r.department || 'Computer Science'), load: Number(r.load || 0), color: palette[index % palette.length],
    active: truthy(r.active),
  })).filter(person => person.id && person.active);
  const responsibilities = tableData.responsibilities.rows.map(({ record: r }) => ({
    id: String(r.responsibility_id || ''), title: String(r.responsibility_name || ''),
    facultyIds: findFacultyIds(r.assigned_faculty, faculty), facultyId: findFacultyIds(r.assigned_faculty, faculty)[0] || '', type: String(r.category || r.type || 'Administration'),
    description: String(r.description || ''), active: truthy(r.active),
  })).filter(item => item.id && item.active);
  const responsibilityById = new Map(tableData.responsibilities.rows.map(({ record: r }) => [String(r.responsibility_id || ''), r]));
  const tasks = tableData.tasks.rows.map(({ record: r }) => {
    const facultyIds = findFacultyIds(r.assigned_to, faculty);
    const responsibility = responsibilityById.get(String(r.responsibility_id || ''));
    return {
      id: String(r.task_id || ''), title: String(r.task_title || ''), facultyIds, facultyId: facultyIds[0] || '',
      responsibilityId: String(r.responsibility_id || ''),
      category: String(responsibility?.responsibility_name || r.category || 'Academic'),
      assignedDate: dateValue(r.assigned_date), startDate: dateValue(r.start_date), createdAt: dateValue(r.created_at),
      dueDate: dateValue(r.deadline), status: normalizeStatus(r.status), completionPercent: Math.max(0, Math.min(100, Number(r.completion_percent || 0))),
      priority: String(r.priority || 'Medium'), description: String(r.task_description || ''),
    };
  }).filter(task => task.id && task.title && !['cancelled', 'canceled', 'archived'].includes(String(
    tableData.tasks.rows.find(row => String(row.record.task_id) === task.id)?.record.status || '',
  ).toLowerCase()));
  return { faculty, responsibilities, tasks };
}
export async function getAll() {
  if (!sheetsEnabled) return structuredClone(demo);
  return mapTables(await readTables());
}

export async function getReminderHistory() {
  if (!sheetsEnabled) return [];
  const table = await readSingleTable(tabs.reminders);
  return table.rows.map(({ record }) => ({
    taskId: String(record.task_id || ''), facultyId: String(record.faculty_id || ''),
    type: String(record.reminder_type || '').toUpperCase(), status: String(record.delivery_status || '').toUpperCase(),
  }));
}
export async function appendReminderLogs(entries) {
  if (!sheetsEnabled || !entries.length) return;
  const table = await readSingleTable(tabs.reminders);
  if (!table.headers.length) throw new Error('The Reminder Log sheet is missing its header row.');
  const values = entries.map(entry => {
    const row = Array(table.headers.length).fill('');
    const fields = { reminder_id: entry.id, task_id: entry.taskId, faculty_id: entry.facultyId, reminder_type: entry.type, sent_at: entry.sentAt, delivery_status: entry.status };
    for (const [header, value] of Object.entries(fields)) {
      const col = table.headers.indexOf(header);
      if (col >= 0) row[col] = value;
    }
    return row;
  });
  await sheets.spreadsheets.values.append({ spreadsheetId: id, range: `'${tabs.reminders}'!A:Z`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values } });
}

function columnName(index) {
  let name = '';
  for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}
function text(value) { return value == null ? '' : String(value); }
async function updateExistingRows(tableName, entries, idHeader, fieldsForEntry) {
  const table = await readSingleTable(tableName);
  const idIndex = table.headers.indexOf(idHeader);
  if (idIndex < 0) throw new Error(`The ${tableName} sheet is missing its ${idHeader} column.`);
  const existing = new Map(table.rows.map(row => [String(row.values[idIndex] || ''), row]));
  const updates = [];
  const appIds = new Set(entries.map(item => String(item.id)));
  for (const item of entries) {
    const row = existing.get(String(item.id));
    if (row) {
      const fields = fieldsForEntry(item);
      for (const [header, value] of Object.entries(fields)) {
        const col = table.headers.indexOf(header);
        if (col >= 0) updates.push({ range: `'${tableName}'!${columnName(col)}${row.rowNumber}`, values: [[value]] });
      }
    } else {
      const values = Array(table.headers.length).fill('');
      const fields = { [idHeader]: item.id, ...fieldsForEntry(item) };
      for (const [header, value] of Object.entries(fields)) {
        const col = table.headers.indexOf(header);
        if (col >= 0) values[col] = value;
      }
      await sheets.spreadsheets.values.append({ spreadsheetId: id, range: `'${tableName}'!A:Z`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: [values] } });
    }
  }
  if (updates.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: id, requestBody: { valueInputOption: 'RAW', data: updates } });
  return { table, existing, appIds };
}
async function readSingleTable(title) {
  const response = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `'${title}'!A:Z`, valueRenderOption: 'UNFORMATTED_VALUE' });
  return parseTable(response.data.values);
}
async function appendStatusUpdate(taskId, facultyId, oldStatus, newStatus, completionPercent) {
  const table = await readSingleTable(tabs.updates);
  const fields = { update_id: `U-${Date.now()}`, task_id: taskId, faculty_id: facultyId, old_status: oldStatus, new_status: newStatus, completion_percent: completionPercent, updated_at: new Date().toISOString() };
  const values = Array(table.headers.length).fill('');
  for (const [header, value] of Object.entries(fields)) {
    const col = table.headers.indexOf(header);
    if (col >= 0) values[col] = value;
  }
  if (table.headers.length) await sheets.spreadsheets.values.append({ spreadsheetId: id, range: `'${tabs.updates}'!A:Z`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: [values] } });
}
export async function updateTaskStatus(taskId, facultyId, status, completionPercent) {
  if (!sheetsEnabled) {
    const task = demo.tasks.find(item => item.id === taskId && item.facultyId === facultyId);
    if (!task) return false;
    task.status = status;
    task.completionPercent = completionPercent;
    return true;
  }
  const table = await readSingleTable(tabs.tasks);
  const idIndex = table.headers.indexOf('task_id');
  const statusIndex = table.headers.indexOf('status');
  const assignedIndex = table.headers.indexOf('assigned_to');
  if ([idIndex, statusIndex, assignedIndex].some(index => index < 0)) throw new Error('The Assigned Tasks sheet is missing a required column.');
  const faculty = (await readSingleTable(tabs.faculty)).rows.map(({ record: r }) => ({ id: String(r.faculty_id || ''), name: String(r.faculty_name || ''), email: String(r.email || ''), username: String(r.username || '') }));
  const row = table.rows.find(item => String(item.values[idIndex] || '') === taskId);
  if (!row || !findFacultyIds(row.values[assignedIndex], faculty).includes(facultyId)) return false;
  let progressIndex = table.headers.indexOf('completion_percent');
  if (progressIndex < 0) {
    progressIndex = table.headers.length;
    await sheets.spreadsheets.values.update({ spreadsheetId: id, range: `'${tabs.tasks}'!${columnName(progressIndex)}1`, valueInputOption: 'RAW', requestBody: { values: [['completion_percent']] } });
  }
  const oldStatus = normalizeStatus(row.values[statusIndex]);
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: id, requestBody: { valueInputOption: 'RAW', data: [
    { range: `'${tabs.tasks}'!${columnName(statusIndex)}${row.rowNumber}`, values: [[status]] },
    { range: `'${tabs.tasks}'!${columnName(progressIndex)}${row.rowNumber}`, values: [[completionPercent]] },
  ] } });
  await appendStatusUpdate(taskId, facultyId, oldStatus, status, completionPercent);
  return true;
}
export async function saveAll(data) {
  if (!sheetsEnabled) { Object.assign(demo, structuredClone(data)); return; }
  const before = await readTables();
  await updateExistingRows(tabs.faculty, data.faculty || [], 'faculty_id', item => ({
    faculty_name: text(item.name), email: text(item.email), role: 'Faculty', active: 'TRUE',
  }));
  await updateExistingRows(tabs.responsibilities, data.responsibilities || [], 'responsibility_id', item => ({
    responsibility_name: text(item.title), assigned_faculty: (item.facultyIds?.length ? item.facultyIds : item.facultyId ? [item.facultyId] : []).join(', '), active: 'TRUE', description: text(item.description),
  }));
  await updateExistingRows(tabs.tasks, data.tasks || [], 'task_id', item => ({
    task_title: text(item.title), task_description: text(item.description), assigned_to: (item.facultyIds?.length ? item.facultyIds : item.facultyId ? [item.facultyId] : []).join(', '),
    assigned_date: text(item.assignedDate), start_date: text(item.startDate), deadline: text(item.dueDate), status: text(item.status), completion_percent: Number(item.completionPercent || 0), responsibility_id: text(item.responsibilityId || before.responsibilities.rows.find(({ record }) => String(record.responsibility_name || '') === text(item.category))?.record.responsibility_id),
  }));

  // Deletion in the dashboard archives rows instead of removing spreadsheet history.
  const facultyTable = await readSingleTable(tabs.faculty);
  const facultyIdCol = facultyTable.headers.indexOf('faculty_id');
  const activeCol = facultyTable.headers.indexOf('active');
  const facultyUpdates = facultyTable.rows.filter(row => !new Set((data.faculty || []).map(item => String(item.id))).has(String(row.values[facultyIdCol] || '')) && activeCol >= 0)
    .map(row => ({ range: `'${tabs.faculty}'!${columnName(activeCol)}${row.rowNumber}`, values: [['FALSE']] }));
  if (facultyUpdates.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: id, requestBody: { valueInputOption: 'RAW', data: facultyUpdates } });
  const responsibilityTable = await readSingleTable(tabs.responsibilities);
  const responsibilityIdCol = responsibilityTable.headers.indexOf('responsibility_id');
  const responsibilityActiveCol = responsibilityTable.headers.indexOf('active');
  const responsibilityUpdates = responsibilityTable.rows.filter(row => !new Set((data.responsibilities || []).map(item => String(item.id))).has(String(row.values[responsibilityIdCol] || '')) && responsibilityActiveCol >= 0)
    .map(row => ({ range: `'${tabs.responsibilities}'!${columnName(responsibilityActiveCol)}${row.rowNumber}`, values: [['FALSE']] }));
  if (responsibilityUpdates.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: id, requestBody: { valueInputOption: 'RAW', data: responsibilityUpdates } });

  const taskTable = await readSingleTable(tabs.tasks);
  const taskIdCol = taskTable.headers.indexOf('task_id');
  const taskStatusCol = taskTable.headers.indexOf('status');
  const currentTaskIds = new Set((data.tasks || []).map(item => String(item.id)));
  const archivedTasks = taskTable.rows.filter(row => !currentTaskIds.has(String(row.values[taskIdCol] || '')) && taskStatusCol >= 0 && !['cancelled', 'canceled'].includes(String(row.values[taskStatusCol] || '').toLowerCase()))
    .map(row => ({ range: `'${tabs.tasks}'!${columnName(taskStatusCol)}${row.rowNumber}`, values: [['Cancelled']] }));
  if (archivedTasks.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: id, requestBody: { valueInputOption: 'RAW', data: archivedTasks } });

  const oldTasks = new Map(before.tasks.rows.map(({ record }) => [String(record.task_id || ''), record]));
  for (const task of data.tasks || []) {
    const old = oldTasks.get(String(task.id));
    if (old && normalizeStatus(old.status) !== normalizeStatus(task.status)) await appendStatusUpdate(task.id, task.facultyId, normalizeStatus(old.status), normalizeStatus(task.status));
  }
}

export async function initializeSheets() {
  if (!sheetsEnabled) return;
  const response = await sheets.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties.title' });
  const titles = new Set((response.data.sheets || []).map(sheet => sheet.properties.title));
  for (const title of Object.values(tabs)) {
    if (!titles.has(title)) throw new Error(`The spreadsheet is missing its existing "${title}" tab. No tabs were created.`);
  }
}
