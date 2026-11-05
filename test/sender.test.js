import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPlan, selectPunches, punchKey } from '../src/calendar.js';
import { Journal } from '../src/journal.js';
import { BatchSender } from '../src/sender.js';

function punches() {
  const plan = createPlan({ start: '2026-11-02', end: '2026-11-03', entry: '08:00', exit: '17:00' });
  return selectPunches(plan, plan.days);
}

async function setup(t, submit) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'visualtime-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const journal = new Journal(path.join(dir, 'journal.json'));
  await journal.load();
  const portal = {
    status: () => ({ canSend: true, accountId: 'fixture-only' }),
    submit
  };
  return { journal, portal, sender: new BatchSender(journal, portal) };
}

test('solo envía confirmados y registra cada solicitud antes de escribir', async t => {
  const calls = [];
  const { sender, journal } = await setup(t, async punch => {
    assert.equal(journal.get(punchKey('fixture-only', punch)).status, 'uncertain');
    calls.push(punch);
    return { confirmed: true, reference: `fixture-${calls.length}` };
  });
  await assert.rejects(sender.send(punches(), false), /confirm/);
  assert.equal(calls.length, 0);
  const result = await sender.send(punches(), true);
  assert.equal(calls.length, 4);
  assert.deepEqual(result.map(item => item.status), ['submitted', 'submitted', 'submitted', 'submitted']);
});

test('después de reiniciar vuelve a enviar y omite solo el duplicado confirmado por el portal', async t => {
  let calls = 0;
  const { sender, journal, portal } = await setup(t, async () => {
    calls++;
    return { confirmed: true, reference: `fixture-${calls}`, existing: calls > 4, portalStatus: -51 };
  });
  await sender.send(punches(), true);
  const reloaded = new Journal(journal.filename);
  await reloaded.load();
  const results = await new BatchSender(reloaded, portal).send(punches(), true);
  assert.equal(calls, 8);
  assert.ok(results.every(item => item.status === 'skipped'));
});

test('resultado incierto pasa al siguiente y un nuevo lote confirmado vuelve a intentarlo', async t => {
  let calls = 0;
  const { sender, journal, portal } = await setup(t, async () => {
    if (++calls === 2) throw new Error('Conexión interrumpida');
    return { confirmed: true, reference: 'fixture-1', existing: calls > 2, portalStatus: -51 };
  });
  const result = await sender.send(punches(), true);
  assert.deepEqual(result.map(item => item.status), ['submitted', 'uncertain', 'skipped', 'skipped']);
  const reloaded = new Journal(journal.filename);
  await reloaded.load();
  const retry = await new BatchSender(reloaded, portal).send(punches(), true);
  assert.deepEqual(retry.map(item => item.status), ['skipped', 'skipped', 'skipped', 'skipped']);
  assert.equal(calls, 8);
});

test('sin confirmación verificable no marca éxito', async t => {
  const { sender } = await setup(t, async () => ({ confirmed: true }));
  const result = await sender.send(punches(), true);
  assert.deepEqual(result.map(item => item.status), ['uncertain', 'uncertain', 'uncertain', 'uncertain']);
});

test('intención incierta tras un cierre no bloquea un nuevo envío confirmado', async t => {
  let calls = 0;
  const { journal, portal } = await setup(t, async () => {
    calls++;
    return { confirmed: true, reference: 'acuse-nuevo' };
  });
  const first = punches()[0];
  await journal.set(punchKey('fixture-only', first), { ...first, status: 'uncertain' });
  const reloaded = new Journal(journal.filename);
  await reloaded.load();
  const result = await new BatchSender(reloaded, portal).send(punches(), true);
  assert.ok(result.every(item => item.status === 'submitted'));
  assert.equal(calls, 4);
});

test('adaptador no verificado bloquea antes de cualquier escritura', async t => {
  let calls = 0;
  const { sender, portal, journal } = await setup(t, async () => { calls++; });
  portal.status = () => ({ canSend: false, accountId: null });
  await assert.rejects(sender.send(punches(), true), /blocked/);
  assert.equal(calls, 0);
  assert.deepEqual(journal.records, {});
});

test('fallo de disco impide escribir en el portal', async t => {
  let calls = 0;
  const { sender, journal } = await setup(t, async () => { calls++; });
  journal.set = async () => { throw new Error('Disco no disponible'); };
  const result = await sender.send(punches(), true);
  assert.ok(result.every(item => item.status === 'not_attempted'));
  assert.match(result[0].message, /Disco no disponible/);
  assert.equal(calls, 0);
});

test('fallo al persistir acuses registra incertidumbre y permite nuevos intentos confirmados', async t => {
  let calls = 0;
  const { sender, journal, portal } = await setup(t, async () => ({ confirmed: true, reference: `fixture-${++calls}` }));
  const set = journal.set.bind(journal);
  journal.set = async (key, record) => {
    if (record.status === 'submitted') throw new Error('Disco desconectado tras guardar');
    await set(key, record);
  };
  const result = await sender.send(punches(), true);
  assert.equal(result[0].status, 'uncertain');
  assert.equal(calls, 4);
  const reloaded = new Journal(journal.filename);
  await reloaded.load();
  const retry = await new BatchSender(reloaded, portal).send(punches(), true);
  assert.ok(retry.every(item => item.status === 'submitted'));
  assert.equal(calls, 8);
});

test('impide lotes concurrentes', async t => {
  let release;
  const receipt = new Promise(resolve => { release = resolve; });
  const { sender } = await setup(t, async () => receipt);
  const first = sender.send(punches().slice(0, 1), true);
  await assert.rejects(sender.send(punches(), true), /already running/);
  release({ confirmed: true, reference: 'fixture-1' });
  await first;
});

test('registro dañado no se ignora ni se sobrescribe', async t => {
  const { journal } = await setup(t, async () => {});
  await writeFile(journal.filename, '{ broken', 'utf8');
  await assert.rejects(new Journal(journal.filename).load());
  await writeFile(journal.filename, '{"version":0,"records":{}}', 'utf8');
  await assert.rejects(new Journal(journal.filename).load(), /damaged/);
});

test('fallo antes de enviar permite nuevo intento confirmado sin crear una incertidumbre falsa', async t => {
  let calls = 0;
  const { sender, journal } = await setup(t, async () => {
    if (++calls === 1) {
      const error = new Error('El formulario no estaba abierto');
      error.outcome = 'not_attempted';
      throw error;
    }
    return { confirmed: true, reference: 'fixture-2' };
  });
  const first = await sender.send(punches().slice(0, 1), true);
  assert.equal(first[0].status, 'not_attempted');
  assert.equal(journal.get(punchKey('fixture-only', punches()[0])).status, 'not_attempted');
  const second = await sender.send(punches().slice(0, 1), true);
  assert.equal(second[0].status, 'submitted');
  assert.equal(calls, 2);
});

test('rechazo explícito se informa y continúa; otro lote confirmado vuelve a intentarlo', async t => {
  let calls = 0;
  const { sender, journal, portal } = await setup(t, async () => {
    calls++;
    const error = new Error('Status=-23');
    error.outcome = 'failed';
    throw error;
  });
  const result = await sender.send(punches(), true);
  assert.deepEqual(result.map(item => item.status), ['failed', 'failed', 'failed', 'failed']);
  const reloaded = new Journal(journal.filename);
  await reloaded.load();
  const retry = await new BatchSender(reloaded, portal).send(punches(), true);
  assert.equal(retry[0].status, 'failed');
  assert.equal(calls, 8);
});

test('vuelve a comprobar en el portal enviados y duplicados antiguos antes de continuar', async t => {
  const calls = [];
  const { sender, journal } = await setup(t, async punch => {
    calls.push(punch);
    return { confirmed: true, reference: 'fixture-remaining', existing: calls.length < 4, portalStatus: -50 };
  });
  const items = punches();
  for (const punch of items.slice(0, 2)) {
    await journal.set(punchKey('fixture-only', punch), { ...punch, status: 'submitted' });
  }
  await journal.set(punchKey('fixture-only', items[2]), {
    ...items[2], status: 'failed',
    message: 'Guardado no confirmado: El portal no confirmó la solicitud (Status=-50). No se aceptarán advertencias automáticamente.'
  });
  const result = await sender.send(items, true);
  assert.deepEqual(result.map(item => item.status), ['skipped', 'skipped', 'skipped', 'submitted']);
  assert.deepEqual(calls.map(item => [item.date, item.time, item.direction]),
    items.map(item => [item.date, item.time, item.direction]));
});

test('recrea registros borrados aunque consten enviados o existentes en disco', async t => {
  const { sender, journal, portal } = await setup(t, async () => ({
    confirmed: true, reference: 'nuevo-acuse'
  }));
  const items = punches();
  for (const [index, item] of items.entries()) {
    await journal.set(punchKey('fixture-only', item), {
      ...item, status: index % 2 ? 'existing' : 'submitted', portalStatus: -51
    });
  }
  const reloaded = new Journal(journal.filename);
  await reloaded.load();
  const result = await new BatchSender(reloaded, portal).send(items, true);
  assert.ok(result.every(item => item.status === 'submitted'));
  assert.ok(Object.values(reloaded.records).every(item => item.reference === 'nuevo-acuse'));
  assert.equal(sender.busy, false);
});
