import { createHash, randomUUID } from 'node:crypto';

export class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function parseDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError(`${label}: introduce una fecha válida.`);
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new AppError(`${label}: introduce una fecha válida.`);
  }
  return date;
}

function parseTime(value, label) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new AppError(`${label}: introduce una hora válida (HH:mm).`);
  }
  return value;
}

export function createPlan({ start, end, entry, exit } = {}) {
  const first = parseDate(start, 'Fecha inicial');
  const last = parseDate(end, 'Fecha final');
  parseTime(entry, 'Entrada');
  parseTime(exit, 'Salida');
  if (first > last) throw new AppError('La fecha inicial debe ser anterior o igual a la final.');
  if (entry >= exit) {
    throw new AppError('La salida debe ser posterior a la entrada del mismo día. No se admiten turnos nocturnos.');
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
    throw new AppError('Selecciona al menos un día laborable.');
  }
  const allowed = new Set(plan.days);
  if (selectedDates.some(date => typeof date !== 'string' || !allowed.has(date))) {
    throw new AppError('La selección contiene fechas ajenas a la vista previa.');
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
