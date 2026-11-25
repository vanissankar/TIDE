import { appendReminderLogs, getAll, getReminderHistory, sheetsEnabled } from './sheets.js';

const dayInIndia = date => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
};
const dateNumber = date => Date.parse(`${date}T00:00:00.000Z`);
const midpointDate = (start, deadline) => {
  const startTime = dateNumber(start);
  const endTime = dateNumber(deadline);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) return '';
  const halfDays = Math.ceil((endTime - startTime) / 2 / 86400000);
  return new Date(startTime + halfDays * 86400000).toISOString().slice(0, 10);
};

async function sendEmail({ to, subject, text, idempotencyKey }) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({ from: process.env.REMINDER_FROM_EMAIL, to: [to], subject, text }),
  });
  if (!response.ok) throw new Error(`Email provider returned HTTP ${response.status}.`);
}

export async function sendDeadlineReminders({ now = new Date(), dryRun = false } = {}) {
  if (!sheetsEnabled) return { sent: 0, planned: 0, skippedMissingEmail: 0, reason: 'Google Sheets is not configured.' };
  const [data, history] = await Promise.all([getAll(), getReminderHistory()]);
  const today = dayInIndia(now);
  const delivered = new Set(history.filter(entry => entry.status === 'SENT')
    .map(entry => `${entry.taskId}|${entry.facultyId}|${entry.type}`));
  const facultyById = new Map(data.faculty.map(person => [person.id, person]));
  const planned = [];
  let skippedMissingEmail = 0;

  for (const task of data.tasks) {
    if (!task.dueDate || task.status === 'Completed') continue;
    const start = task.assignedDate || task.startDate || task.createdAt;
    const halfway = start ? midpointDate(start, task.dueDate) : '';
    const types = [];
    if (halfway && halfway < task.dueDate && halfway === today) types.push('HALFWAY');
    if (task.dueDate === today) types.push('DEADLINE');
    if (!types.length) continue;

    for (const facultyId of task.facultyIds || [task.facultyId]) {
      const person = facultyById.get(facultyId);
      if (!person) continue;
      const email = String(person.email || '').trim();
      if (!email || !email.includes('@')) { skippedMissingEmail++; continue; }
      for (const type of types) {
        const key = `${task.id}|${facultyId}|${type}`;
        if (delivered.has(key)) continue;
        const subject = type === 'DEADLINE'
          ? `Due today: ${task.title}`
          : `Workload check-in: ${task.title}`;
        const text = type === 'DEADLINE'
          ? `Hello ${person.name},\n\nThis is a reminder that “${task.title}” is due today (${task.dueDate}). Please update its status in the CSE Faculty Workload Monitoring System.\n`
          : `Hello ${person.name},\n\nThis is the halfway reminder for “${task.title}”. Its deadline is ${task.dueDate}. Please review your progress and update its status in the CSE Faculty Workload Monitoring System.\n`;
        planned.push({ key, task, person, email, type, subject, text });
      }
    }
  }

  if (!dryRun && planned.length && (!process.env.RESEND_API_KEY || !process.env.REMINDER_FROM_EMAIL)) {
    throw new Error('Set RESEND_API_KEY and REMINDER_FROM_EMAIL to enable email delivery.');
  }
  if (dryRun) return { sent: 0, planned: planned.length, skippedMissingEmail };

  const logs = [];
  let sent = 0;
  for (const item of planned) {
    let status = 'FAILED';
    try {
      await sendEmail({ to: item.email, subject: item.subject, text: item.text, idempotencyKey: `cse-${item.key.replaceAll('|', '-')}-${today}` });
      status = 'SENT';
      sent++;
    } catch (error) {
      console.error('Reminder email failed:', error.message);
    }
    logs.push({
      id: `REM-${Date.now()}-${logs.length + 1}`, taskId: item.task.id, facultyId: item.person.id,
      type: item.type, sentAt: new Date().toISOString(), status,
    });
  }
  await appendReminderLogs(logs);
  return { sent, planned: planned.length, skippedMissingEmail };
}
