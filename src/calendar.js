import { createHash, randomUUID } from 'node:crypto';

export class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function parseDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError(`${label}: enter a valid date.`);
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new AppError(`${label}: enter a valid date.`);
  }
  return date;
}

function parseTime(value, label) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new AppError(`${label}: enter a valid time (HH:mm).`);
  }
  return value;
}

export function createPlan({ start, end, entry, exit } = {}) {
  const first = parseDate(start, 'Start date');
  const last = parseDate(end, 'End date');
  parseTime(entry, 'Clock-in time');
  parseTime(exit, 'Clock-out time');
  if (first > last) throw new AppError('The start date must be on or before the end date.');
  if (entry >= exit) {
    throw new AppError('Clock-out time must be after clock-in time on the same day. Overnight shifts are not supported.');
  }
  const days = [];
  for (const date = new Date(first); date <= last; date.setUTCDate(date.getUTCDate() + 1)) {
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) {
      days.push(date.toISOString().slice(0, 10));
    }
  }
  return { id: randomUUID(), start, end, entry, exit, days };
}

export function selectPunches(plan, selectedDates) {
  if (!Array.isArray(selectedDates) || selectedDates.length === 0) {
    throw new AppError('Select at least one weekday.');
  }
  const allowed = new Set(plan.days);
  if (selectedDates.some(date => typeof date !== 'string' || !allowed.has(date))) {
    throw new AppError('The selection contains dates outside the preview weekdays.');
  }
  return [...new Set(selectedDates)].sort().flatMap(date => [
    { date, time: plan.entry, direction: 'Entrada', type: 'Presencia' },
    { date, time: plan.exit, direction: 'Salida', type: 'Presencia' }
  ]);
}

export function punchKey(accountId, punch) {
  return createHash('sha256').update(JSON.stringify([
    accountId, punch.date, punch.time, punch.direction, punch.type
  ])).digest('hex');
}
