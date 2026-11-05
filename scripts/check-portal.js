import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { Portal } from '../src/portal.js';
import { BatchSender } from '../src/sender.js';
import { Journal } from '../src/journal.js';
import { createPlan, selectPunches } from '../src/calendar.js';
import { createApp } from '../src/server.js';
import { once } from 'node:events';

const html = `<!doctype html><html lang="es"><body>
<div data-bind="dxDateBox: beginDate"><input></div>
<div data-bind="dxSelectBox: cmbforgottenPunchType"><input value="Presencia"></div>
<div data-bind="dxSelectBox: cmbRequestValue1"><input value="Entrada"></div>
<div data-bind="dxSelectBox: cmbRequestValue2"><input></div>
<div data-bind="dxTextArea: remarks"><textarea></textarea></div>
<div data-bind="dxButton: btnSave" role="button" tabindex="0">Guardar</div>
<script>
window.changes = [];
const options = new Map([
  ['dxDateBox: beginDate', {value: new Date('2026-11-05T00:00:00')}],
  ['dxSelectBox: cmbforgottenPunchType', {value: 1}],
  ['dxSelectBox: cmbRequestValue1', {value: 'E'}],
  ['dxSelectBox: cmbRequestValue2', {value: null}],
  ['dxTextArea: remarks', {value: ''}],
  ['dxButton: btnSave', {visible: true}]
]);
window.fixtureOptions = options;
window.jQuery = element => {
  const binding = element.getAttribute('data-bind');
  const widget = { option(key, value) {
    if (arguments.length === 2) {
      options.get(binding)[key] = value;
      changes.push(binding);
    }
    return options.get(binding)[key];
  }};
  return {dxDateBox: () => widget, dxSelectBox: () => widget, dxTextArea: () => widget, dxButton: () => widget};
};
window.ko = {dataFor: () => ({requestId: () => null})};
window.WebServiceRobotics = function(success) { this.onSuccessCall = success; };
window.VTPortalUtils = {constants: {OK: {value: 0}}};
window.VTPortal = {
  roApp: {
    loggedIn: true, companyID: 'fixture-company', employeeId: 123,
    impersonatedIDEmployee: -1, impersonateOnlyRequest: false,
    getServerUrl: () => window.fixtureServerUrl || 'https://vtportal.visualtime.net/fixture-api',
    wsRequestCounter: () => 0
  },
  app: {navigate: route => {
    location.hash = route;
    if (window.delayedDirection) {
      const direction = document.querySelector('[data-bind="dxSelectBox: cmbRequestValue1"]');
      direction.hidden = true;
      setTimeout(() => { direction.hidden = false; }, 250);
    }
  }}
};
// El portal real sustituye la ruta inicial por Inicio al completar el arranque.
setTimeout(() => {
  VTPortal.app.navigate('home');
  window.fixtureStartupFinished = true;
}, 120);
WebServiceRobotics.prototype.saveForbbidenPunch = async function(date, cause, comments, direction, acceptWarning, tcType) {
  const data = new FormData();
  data.append('punchDate', window.tamper ? '1999-01-01 01:00' : date.format('YYYY-MM-DD HH:mm'));
  data.append('idCause', cause);
  data.append('comments', comments);
  data.append('direction', direction);
  data.append('acceptWarning', acceptWarning);
  data.append('tcType', tcType);
  try {
    const response = await fetch(VTPortal.roApp.getServerUrl().toLowerCase() + '/SaveRequestForbiddenPunch' +
      (window.querySuffix ? '?attempt=1' : ''), {method:'POST', body:data});
    const receipt = await response.json();
    (window.bypassObserver ? window.fixturePortalCallback : this.onSuccessCall)(receipt.d);
  } catch (error) {
    window.fixtureError = error.message;
  }
};
window.fixturePortalCallback = receipt => {
    if (receipt.Status === 0) location.hash = 'requestsList/1';
    if (receipt.Status === -50 || receipt.Status === -51) {
      const show = () => {
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      dialog.textContent = 'Ya existe una solicitud o fichaje';
      const close = document.createElement('button');
      close.textContent = 'Cerrar';
      close.onclick = () => dialog.remove();
      dialog.append(close);
      document.body.append(dialog);
      };
      setTimeout(show, 80);
    }
};
const service = new WebServiceRobotics(window.fixturePortalCallback);
document.querySelector('[data-bind="dxButton: btnSave"]').addEventListener('click', () => {
  const date = options.get('dxDateBox: beginDate').value;
  const pad = number => String(number).padStart(2, '0');
  const formatted = date.getFullYear() + '-' + pad(date.getMonth()+1) + '-' + pad(date.getDate()) +
    ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  const args = [
    {format: () => formatted}, options.get('dxSelectBox: cmbRequestValue2').value || '-1',
    options.get('dxTextArea: remarks').value,
    options.get('dxSelectBox: cmbRequestValue1').value, false, '0'
  ];
  service.saveForbbidenPunch(...args);
  if (window.repeatSave) service.saveForbbidenPunch(...args);
});
</script></body></html>`;

const dir = await mkdtemp(path.join(os.tmpdir(), 'visualtime-portal-test-'));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ locale: 'es-ES', timezoneId: 'Europe/Madrid' });
  let requests = 0;
  let reply = () => ({ d: { Status: 0, PunchWithoutRequest: false } });
  const unexpected = [];
  const writes = [];
  let documentLoads = 0;
  // Todas las URL se interceptan. Ninguna solicitud de esta prueba llega al portal real.
  await context.route('**/*', async route => {
    const request = route.request();
    if (request.method() === 'GET' && request.resourceType() === 'document') {
      documentLoads++;
      return route.fulfill({ contentType: 'text/html', body: html });
    }
    if (request.method() === 'OPTIONS' && request.url() === 'https://service.visualtime.net/fixture-api/SaveRequestForbiddenPunch') {
      return route.fulfill({ status: 204, headers: {
        'Access-Control-Allow-Origin': 'https://vtportal.visualtime.net',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': '*'
      } });
    }
    if (request.method() === 'POST' && [
      'https://vtportal.visualtime.net/fixture-api/SaveRequestForbiddenPunch',
      'https://vtportal.visualtime.net/api/portalsvcx.svc/SaveRequestForbiddenPunch',
      'https://service.visualtime.net/fixture-api/SaveRequestForbiddenPunch'
    ].includes(request.url().split('?')[0])) {
      requests++;
      writes.push(request.postDataBuffer().toString());
      const body = reply(requests);
      return route.fulfill({
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': 'https://vtportal.visualtime.net' },
        body: typeof body === 'string' ? body : JSON.stringify(body)
      });
    }
    unexpected.push(request.url());
    await route.abort();
  });
  const plan = createPlan({ start: '2026-09-01', end: '2026-09-02', entry: '08:15', exit: '16:45' });
  const punches = selectPunches(plan, plan.days);
  let sequence = 0;
  async function setup() {
    requests = 0;
    reply = () => ({ d: { Status: 0, PunchWithoutRequest: false } });
    const page = await context.newPage();
    await page.goto('https://vtportal.visualtime.net/2/indexv2.aspx#forgottenPunch/-1/2026-11-05');
    await page.waitForFunction(() => window.fixtureStartupFinished === true);
    await page.evaluate(() => VTPortal.app.navigate('forgottenPunch/-1/2026-11-05'));
    const portal = new Portal({ responseTimeout: 800 });
    portal.browser = browser;
    portal.page = page;
    await portal.verify();
    assert.equal(portal.status().canPrepare, true);
    assert.equal(portal.status().canSend, false);
    await assert.rejects(portal.submit(punches[0], portal.status().accountId), /prueba la carga/);
    await portal.prepare(punches[0]);
    assert.equal(requests, 0);
    assert.equal(portal.status().canSend, true);
    const journal = new Journal(path.join(dir, `journal-${++sequence}.json`));
    await journal.load();
    return { page, portal, journal, sender: new BatchSender(journal, portal) };
  }

  const success = await setup();
  const initialLoads = documentLoads;
  assert.equal(await success.page.evaluate(() => fixtureOptions.get('dxSelectBox: cmbRequestValue2').value), null);
  assert.equal(await success.page.evaluate(() => fixtureOptions.get('dxTextArea: remarks').value), '');
  const sent = await success.sender.send(punches, true);
  assert.deepEqual(sent.map(result => result.status), ['submitted', 'submitted', 'submitted', 'submitted']);
  assert.equal(requests, 4);
  assert.equal(documentLoads - initialLoads, 4, 'Cada fichaje debe usar un documento nuevo, también dentro del mismo día.');
  assert.equal(writes.length, 4);
  for (const [index, punch] of punches.entries()) {
    assert.ok(writes[index].includes(`${punch.date} ${punch.time}`));
    assert.match(writes[index], new RegExp(`name="direction"\\r\\n\\r\\n${punch.direction === 'Entrada' ? 'E' : 'S'}\\r\\n`));
  }
  assert.deepEqual(await success.page.evaluate(() => [...new Set(changes)]), [
    'dxDateBox: beginDate', 'dxSelectBox: cmbRequestValue1'
  ]);
  const reloaded = new Journal(success.journal.filename);
  await reloaded.load();
  reply = () => ({ d: { Status: -51 } });
  const duplicate = await new BatchSender(reloaded, success.portal).send(punches, true);
  assert.ok(duplicate.every(result => result.status === 'skipped'));
  assert.equal(requests, 8);
  reply = count => ({ d: { Status: count === 9 ? 0 : -51 } });
  const recreated = await new BatchSender(reloaded, success.portal).send(punches, true);
  assert.deepEqual(recreated.map(result => result.status), ['submitted', 'skipped', 'skipped', 'skipped']);
  assert.equal(requests, 12);
  await success.page.close();

  const partial = await setup();
  reply = count => count === 2 ? '{"unexpected":true}' : { d: { Status: 0 } };
  const stopped = await partial.sender.send(punches, true);
  assert.deepEqual(stopped.map(result => result.status), ['submitted', 'uncertain', 'submitted', 'submitted']);
  assert.equal(requests, 4);
  assert.equal(partial.portal.status().canSend, true);
  await partial.page.close();

  const tampered = await setup();
  await tampered.page.addInitScript(() => { window.tamper = true; });
  const blocked = await tampered.sender.send(punches, true);
  assert.equal(blocked[0].status, 'not_attempted');
  assert.match(blocked[0].message, /no coinciden/);
  assert.equal(requests, 0);
  await tampered.page.close();

  const switched = await setup();
  await switched.page.evaluate(() => { VTPortal.roApp.employeeId = 999; });
  const changed = await switched.sender.send(punches, true);
  assert.equal(changed[0].status, 'not_attempted');
  assert.match(changed[0].message, /cuenta/);
  assert.equal(requests, 0);
  await switched.page.close();

  const switchedOnReload = await setup();
  await switchedOnReload.page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => { VTPortal.roApp.employeeId = 999; });
  });
  const changedOnReload = await switchedOnReload.sender.send(punches, true);
  assert.ok(changedOnReload.every(result => result.status === 'not_attempted'));
  assert.match(changedOnReload[0].message, /cuenta/);
  assert.equal(requests, 0);
  await switchedOnReload.page.close();

  const direct = await setup();
  reply = () => ({ d: { Status: 0, PunchWithoutRequest: true } });
  const directResult = await direct.sender.send(punches, true);
  assert.deepEqual(directResult.map(result => result.status), ['submitted', 'not_attempted', 'not_attempted', 'not_attempted']);
  assert.match(directResult[0].message, /directamente/);
  assert.equal(requests, 1);
  await direct.page.close();

  const rejected = await setup();
  reply = () => ({ d: { Status: -23 } });
  const rejection = await rejected.sender.send(punches, true);
  assert.equal(rejection[0].status, 'failed');
  assert.match(rejection[0].message, /Status=-23/);
  assert.equal(requests, 4);
  await rejected.page.close();

  const duplicatePortal = await setup();
  await duplicatePortal.page.addInitScript(() => { window.querySuffix = true; });
  reply = count => ({ d: { Status: count === 1 ? -50 : count === 2 ? -51 : 0 } });
  const duplicateResults = await duplicatePortal.sender.send(punches, true);
  assert.deepEqual(duplicateResults.map(result => result.status), ['failed', 'skipped', 'submitted', 'submitted']);
  assert.equal(requests, 4);
  assert.equal(await duplicatePortal.page.getByRole('dialog').count(), 0);
  assert.equal(Object.values(duplicatePortal.journal.records).filter(record => record.status === 'existing').length, 1);
  const duplicateReloaded = new Journal(duplicatePortal.journal.filename);
  await duplicateReloaded.load();
  reply = () => ({ d: { Status: -50 } });
  const existingRetry = await new BatchSender(duplicateReloaded, duplicatePortal.portal).send(punches, true);
  assert.ok(existingRetry.every(result => result.status === 'failed'));
  assert.equal(requests, 8);
  await duplicatePortal.page.close();

  const missingCallback = await setup();
  await missingCallback.page.addInitScript(() => { window.bypassObserver = true; });
  reply = count => ({ d: { Status: count === 1 ? -51 : count === 2 ? -50 : 0 } });
  const missingCallbackResults = await missingCallback.sender.send(punches, true);
  assert.deepEqual(missingCallbackResults.map(result => result.status), ['skipped', 'failed', 'submitted', 'submitted']);
  assert.equal(requests, 4);
  assert.equal(await missingCallback.page.getByRole('dialog').count(), 0);
  await missingCallback.page.close();

  const repeatedCall = await setup();
  await repeatedCall.page.addInitScript(() => { window.repeatSave = sessionStorage.getItem('disableRepeat') !== 'true'; });
  reply = () => ({ d: { Status: -51 } });
  const repeatedResults = await repeatedCall.sender.send(punches, true);
  assert.equal(repeatedResults[0].status, 'uncertain');
  assert.equal(requests, 4);
  assert.ok(repeatedResults.every(result => result.status === 'uncertain'));
  assert.equal(await repeatedCall.page.evaluate(() => Boolean(window.__visualtimeSaveObserver)), false);
  await repeatedCall.page.evaluate(() => { sessionStorage.setItem('disableRepeat', 'true'); });
  const repeatedRetry = await repeatedCall.sender.send(punches, true);
  assert.ok(repeatedRetry.every(result => result.status === 'skipped'));
  assert.equal(requests, 8);
  await repeatedCall.page.close();

  const validation = await setup();
  await validation.page.evaluate(() => { fixtureOptions.get('dxSelectBox: cmbRequestValue2').value = '123'; });
  await assert.rejects(validation.portal.verify(), /no están vacíos/);
  assert.equal(validation.portal.status().canSend, false);
  assert.equal(requests, 0);
  await validation.page.evaluate(() => { fixtureOptions.get('dxSelectBox: cmbRequestValue2').value = null; });
  await validation.portal.verify();
  await assert.rejects(validation.portal.prepare({ ...punches[0], date: '2099-01-01' }), /histórica/);
  await assert.rejects(validation.portal.prepare({ ...punches[0], date: '2026-03-29', time: '02:30' }), /no existe/);
  assert.equal(requests, 0);
  await validation.page.close();

  const crossOrigin = await setup();
  await crossOrigin.page.addInitScript(() => { window.fixtureServerUrl = 'https://service.visualtime.net/fixture-api'; });
  await crossOrigin.page.evaluate(() => { window.fixtureServerUrl = 'https://service.visualtime.net/fixture-api'; });
  await crossOrigin.portal.verify();
  await crossOrigin.portal.prepare(punches[0]);
  const crossOriginResults = await crossOrigin.sender.send(punches.slice(0, 1), true);
  assert.equal(crossOriginResults[0].status, 'submitted');
  assert.equal(requests, 1);
  await crossOrigin.page.close();

  const relative = await setup();
  await relative.page.addInitScript(() => { window.fixtureServerUrl = '/api/Portalsvcx.svc'; });
  await relative.page.evaluate(() => { window.fixtureServerUrl = '/api/Portalsvcx.svc'; });
  await relative.portal.verify();
  assert.equal(relative.portal.connection.writeUrl, 'https://vtportal.visualtime.net/api/portalsvcx.svc/SaveRequestForbiddenPunch');
  await relative.portal.prepare(punches[0]);
  assert.equal(requests, 0);
  const relativeResults = await relative.sender.send(punches.slice(0, 1), true);
  assert.equal(relativeResults[0].status, 'submitted');
  assert.equal(requests, 1);
  await relative.page.close();

  const delayed = await setup();
  const firstOnly = await delayed.sender.send(punches.slice(0, 1), true);
  assert.equal(firstOnly[0].status, 'submitted');
  assert.equal(requests, 1);
  await delayed.page.addInitScript(() => { window.delayedDirection = true; });
  reply = count => ({ d: { Status: count === 2 ? -51 : 0 } });
  const delayedResults = await delayed.sender.send(punches, true);
  assert.deepEqual(delayedResults.map(result => result.status), ['skipped', 'submitted', 'submitted', 'submitted']);
  assert.equal(requests, 5);
  reply = () => ({ d: { Status: -51 } });
  const delayedRetry = await delayed.sender.send(punches, true);
  assert.ok(delayedRetry.every(result => result.status === 'skipped'));
  assert.equal(requests, 9);
  await delayed.page.close();

  const hiddenInput = await setup();
  await hiddenInput.page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const type = document.querySelector('[data-bind="dxSelectBox: cmbforgottenPunchType"]');
      const hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.value = '1';
      type.prepend(hidden);
      fixtureOptions.get('dxSelectBox: cmbforgottenPunchType').value = '1';
    });
  });
  await hiddenInput.page.evaluate(() => {
    const type = document.querySelector('[data-bind="dxSelectBox: cmbforgottenPunchType"]');
    const hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.value = '1';
    type.prepend(hidden);
    fixtureOptions.get('dxSelectBox: cmbforgottenPunchType').value = '1';
  });
  await hiddenInput.portal.verify();
  await hiddenInput.portal.prepare(punches[0]);
  assert.equal(hiddenInput.portal.status().canSend, true);
  assert.equal(await hiddenInput.page.evaluate(() => fixtureOptions.get('dxSelectBox: cmbforgottenPunchType').value), '1');
  assert.equal(requests, 0);
  await hiddenInput.page.evaluate(() => {
    fixtureOptions.get('dxSelectBox: cmbforgottenPunchType').value = 2;
  });
  await assert.rejects(hiddenInput.portal.verify(), /debe ser Presencia/);
  assert.equal(requests, 0);
  await hiddenInput.page.close();

  const integrated = await setup();
  await integrated.portal.verify();
  const app = await createApp({
    portal: integrated.portal,
    journalPath: path.join(dir, 'ui-journal.json')
  });
  const ui = await browser.newPage({ locale: 'es-ES' });
  try {
    app.server.listen(0, '127.0.0.1');
    await once(app.server, 'listening');
    await ui.goto(`http://127.0.0.1:${app.server.address().port}`);
    await ui.locator('#generate:enabled').waitFor();
    await ui.locator('#start').fill('01/09/2026');
    await ui.locator('#end').fill('01/09/2026');
    await ui.locator('#entry').fill('08:15');
    await ui.locator('#exit').fill('16:45');
    await ui.locator('#generate').click();
    await integrated.page.evaluate(() => { fixtureOptions.get('dxSelectBox: cmbforgottenPunchType').value = 2; });
    await ui.locator('#connect').click();
    await ui.locator('#connection-message').filter({ hasText: 'debe ser Presencia' }).waitFor();
    assert.equal(await ui.locator('#connection-message').isVisible(), true);
    assert.equal(await ui.locator('#prepare').isDisabled(), true);
    assert.equal(await ui.locator('#send').isDisabled(), true);
    assert.equal(requests, 0);
    await integrated.page.evaluate(() => { fixtureOptions.get('dxSelectBox: cmbforgottenPunchType').value = 1; });
    await ui.locator('#connect').click();
    await ui.locator('#prepare:enabled').waitFor();
    await ui.locator('#connection-message').filter({ hasText: 'Formulario conectado' }).waitFor();
    await ui.locator('#prepare').click();
    await ui.locator('#send:enabled').waitFor();
    assert.equal(requests, 0);
    ui.once('dialog', dialog => dialog.dismiss());
    await ui.locator('#send').click();
    assert.equal(requests, 0);
    ui.once('dialog', dialog => dialog.accept());
    await ui.locator('#send').click();
    await ui.locator('#results-summary').filter({ hasText: '2 enviadas' }).waitFor();
    assert.equal(requests, 2);
    await ui.locator('#send:enabled').waitFor();
    assert.equal(await ui.locator('#results tr').count(), 2);
    assert.match(await ui.locator('#results tr').first().textContent(), /01\/09\/2026 08:15/);
    assert.equal((await ui.locator('#results').textContent()).includes('2026-09-01'), false);
    reply = () => ({ d: { Status: -51 } });
    ui.once('dialog', dialog => dialog.accept());
    await ui.locator('#send').click();
    await ui.locator('#results-summary').filter({ hasText: '2 omitidas' }).waitFor();
    assert.equal(requests, 4);
    await ui.locator('#send:enabled').waitFor();
    // Los dos registros han sido borrados en el portal simulado.
    reply = () => ({ d: { Status: 0 } });
    ui.once('dialog', dialog => dialog.accept());
    await ui.locator('#send').click();
    await ui.locator('#results-summary').filter({ hasText: '2 enviadas' }).waitFor();
    assert.equal(requests, 6);
  } finally {
    await ui.close();
    // El portal usa el mismo navegador de todas las fixtures; no cerrar ese navegador desde la app.
    integrated.portal.close = async () => { await integrated.page.close(); };
    await app.close();
  }
  assert.deepEqual(unexpected, []);
  console.log('Adaptador OK en fixture aislada: callbacks, duplicados con query y modal retrasado, bloqueo de doble invocación, continuación tras fallo y nuevos intentos confirmados sin veto del journal.');
  console.log('Flujo UI→servidor→adaptador OK: conectar, cargar sin guardar, cancelar, confirmar 2 solicitudes y omitir duplicados.');
  console.log('No se han creado solicitudes reales. Esta prueba no acredita un guardado en la cuenta del usuario.');
} finally {
  await browser.close();
  await rm(dir, { recursive: true, force: true });
}
