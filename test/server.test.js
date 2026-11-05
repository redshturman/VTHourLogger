import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';

test('HTTP local: vista previa, selección y envío bloqueado sin solicitudes reales', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'visualtime-http-'));
  const app = await createApp({ journalPath: path.join(dir, 'journal.json') });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const url = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  const state = await (await fetch(`${url}/api/state`)).json();
  assert.equal(state.portal.canSend, false);
  const post = (route, body, headers = {}) => fetch(`${url}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Visualtime-Token': state.token, ...headers },
    body: JSON.stringify(body)
  });
  const home = await fetch(url);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Conecta el formulario para empezar/);
  assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await post('/api/preview', {}, { Origin: 'https://example.invalid' })).status, 403);
  assert.equal((await post('/api/preview', {}, { 'X-Visualtime-Token': '' })).status, 403);
  const foreignHostStatus = await new Promise((resolve, reject) => {
    const request = http.get(`${url}/api/state`, { headers: { Host: 'example.invalid' } }, response => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on('error', reject);
  });
  assert.equal(foreignHostStatus, 403);
  const malformed = await fetch(`${url}/api/preview`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Visualtime-Token': state.token }, body: '{invalid'
  });
  assert.equal(malformed.status, 400);
  const response = await post('/api/preview', { start: '2026-11-02', end: '2026-11-06', entry: '08:15', exit: '16:45' });
  assert.equal(response.status, 200);
  const plan = await response.json();
  assert.equal(plan.days.length, 5);
  const selection = { planId: plan.id, selectedDates: ['2026-11-02', '2026-11-06'], confirmed: true };
  assert.equal((await post('/api/send', { ...selection, planId: 'alterado' })).status, 409);
  assert.equal((await post('/api/send', { ...selection, selectedDates: ['2026-11-07'] })).status, 400);
  assert.equal((await post('/api/send', { ...selection, confirmed: false })).status, 400);
  const blocked = await post('/api/send', selection);
  assert.equal(blocked.status, 409);
  const report = await blocked.json();
  assert.match(report.error, /bloqueado/);
  assert.equal(report.results.length, 4);
  assert.ok(report.results.every(result => result.status === 'not_attempted'));
  assert.deepEqual(report.results.map(result => result.time), ['08:15', '16:45', '08:15', '16:45']);
  assert.equal((await post('/api/portal/inspect', {})).status, 409);
  assert.equal((await fetch(`${url}/data/journal.json`)).status, 404);
});
