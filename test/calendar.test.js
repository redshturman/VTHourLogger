import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlan, selectPunches, punchKey } from '../src/calendar.js';

const period = { start: '2026-11-02', end: '2026-11-08', entry: '08:00', exit: '17:00' };

test('fechas inclusivas, solo de lunes a viernes, sin alterar horas', () => {
  const plan = createPlan(period);
  assert.deepEqual(plan.days, ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']);
  const punches = selectPunches(plan, ['2026-11-06', '2026-11-02', '2026-11-02']);
  assert.deepEqual(punches, [
    { date: '2026-11-02', time: '08:00', direction: 'Entrada', type: 'Presencia' },
    { date: '2026-11-02', time: '17:00', direction: 'Salida', type: 'Presencia' },
    { date: '2026-11-06', time: '08:00', direction: 'Entrada', type: 'Presencia' },
    { date: '2026-11-06', time: '17:00', direction: 'Salida', type: 'Presencia' }
  ]);
  assert.equal(punches.some(punch => 'reason' in punch || 'observations' in punch), false);
});

test('un día laborable, fin de semana y cambio de año', () => {
  assert.deepEqual(createPlan({ ...period, end: period.start }).days, [period.start]);
  assert.deepEqual(createPlan({ ...period, start: '2026-11-07', end: '2026-11-08' }).days, []);
  assert.deepEqual(createPlan({ ...period, start: '2026-12-31', end: '2027-01-04' }).days, [
    '2026-12-31', '2027-01-01', '2027-01-04'
  ]);
});

test('año bisiesto y cambio de horario de verano sin desplazamientos', () => {
  assert.deepEqual(createPlan({ ...period, start: '2024-02-28', end: '2024-03-01' }).days, [
    '2024-02-28', '2024-02-29', '2024-03-01'
  ]);
  assert.deepEqual(createPlan({ ...period, start: '2026-10-23', end: '2026-10-27' }).days, [
    '2026-10-23', '2026-10-26', '2026-10-27'
  ]);
});

test('dos meses generan exactamente 44 días y 88 solicitudes', () => {
  const plan = createPlan({ ...period, start: '2026-09-01', end: '2026-10-31' });
  assert.equal(plan.days.length, 44);
  assert.equal(selectPunches(plan, plan.days).length, 88);
});

test('rechaza fechas, horas y periodos inválidos', () => {
  for (const changes of [
    { start: '2026-02-30' }, { start: '2025-02-29' }, { end: '' },
    { start: '02/11/2026' }, { start: '2026-11-09' }, { entry: '24:00' },
    { exit: '17:60' }, { entry: '8:00' }, { exit: '08:00' },
    { entry: '22:00', exit: '06:00' }, { entry: null }
  ]) {
    assert.throws(() => createPlan({ ...period, ...changes }));
  }
});

test('rechaza selección vacía, fines de semana y fechas ajenas', () => {
  const plan = createPlan(period);
  for (const selected of [[], null, '2026-11-02', ['2026-11-07'], ['2026-12-01'], [null]]) {
    assert.throws(() => selectPunches(plan, selected));
  }
});

test('identificador de duplicado está aislado por cuenta y sentido', () => {
  const punch = selectPunches(createPlan(period), [period.start])[0];
  assert.equal(punchKey('account-a', punch), punchKey('account-a', { ...punch, status: 'submitted' }));
  assert.notEqual(punchKey('account-a', punch), punchKey('account-b', punch));
  assert.notEqual(punchKey('account-a', punch), punchKey('account-a', { ...punch, direction: 'Salida' }));
});

test('four punches alternate directions in time order and preserve existing journal keys', () => {
  const normal = createPlan(period);
  const lunch = createPlan({ ...period, mode: '4', lunchOut: '13:00', lunchIn: '14:00' });
  const selected = selectPunches(lunch, ['2026-11-06', '2026-11-02', '2026-11-02']);
  assert.equal(selected.length, 8);
  assert.deepEqual(selected.slice(0, 4), [
    { date: period.start, time: '08:00', direction: 'Entrada', type: 'Presencia' },
    { date: period.start, time: '13:00', direction: 'Salida', type: 'Presencia' },
    { date: period.start, time: '14:00', direction: 'Entrada', type: 'Presencia' },
    { date: period.start, time: '17:00', direction: 'Salida', type: 'Presencia' }
  ]);
  const original = selectPunches(normal, [period.start]);
  assert.equal(punchKey('account', original[0]), punchKey('account', selected[0]));
  assert.equal(punchKey('account', original[1]), punchKey('account', selected[3]));
  const twoMonths = createPlan({ ...period, start: '2026-09-01', end: '2026-10-31',
    mode: '4', lunchOut: '13:00', lunchIn: '14:00' });
  assert.equal(selectPunches(twoMonths, twoMonths.days).length, 176);
});

test('four punches require valid strictly increasing same-day lunch times', () => {
  for (const changes of [
    {}, { lunchOut: '13:00' }, { lunchOut: '8:30', lunchIn: '14:00' },
    { lunchOut: '13:00', lunchIn: '24:00' },
    { lunchOut: '08:00', lunchIn: '14:00' },
    { lunchOut: '07:00', lunchIn: '14:00' },
    { lunchOut: '14:00', lunchIn: '13:00' },
    { lunchOut: '13:00', lunchIn: '13:00' },
    { lunchOut: '13:00', lunchIn: '17:00' },
    { lunchOut: '13:00', lunchIn: '18:00' }
  ]) {
    assert.throws(() => createPlan({ ...period, mode: '4', ...changes }));
  }
  assert.throws(() => createPlan({ ...period, mode: '3' }));
  const normal = createPlan({ ...period, mode: '2', lunchOut: 'bad', lunchIn: 'bad' });
  assert.equal(normal.mode, '2');
  assert.equal('lunchOut' in normal, false);
  assert.equal(selectPunches(normal, [period.start]).length, 2);
});
