import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { createApp } from '../src/server.js';
import { Portal } from '../src/portal.js';

const dir = await mkdtemp(path.join(os.tmpdir(), 'visualtime-ui-'));
let browser;
let app;
try {
  app = await createApp({ journalPath: path.join(dir, 'journal.json') });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const url = `http://127.0.0.1:${app.server.address().port}`;
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1200, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.locator('#generate:enabled').waitFor();
  await page.locator('#start').fill('01/09/2026');
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  await page.getByRole('button', { name: 'Choose start date', exact: true }).click();
  assert.equal(await page.locator('#start-picker strong').textContent(), 'September 2026');
  await page.locator('#start-picker').getByRole('button', { name: 'Previous month', exact: true }).click();
  await page.locator('#start-picker').getByRole('button', { name: 'Next month', exact: true }).click();
  await page.locator('#start-picker').getByRole('button', { name: '02/09/2026', exact: true }).click();
  assert.equal(await page.locator('#start').inputValue(), '02/09/2026');
  assert.equal(await page.locator('#start-picker').isHidden(), true);
  await page.locator('#start').fill('01/09/2026');
  await page.locator('#end').fill('31/10/2026');
  await page.locator('#entry').fill('08:15');
  await page.locator('#exit').fill('16:45');
  await page.getByRole('button', { name: 'Choose clock-out time', exact: true }).click();
  await page.locator('#exit-picker').getByLabel('Hour (24 h)').selectOption('18');
  await page.locator('#exit-picker').getByLabel('Minute', { exact: true }).selectOption('30');
  await page.locator('#exit-picker').getByRole('button', { name: 'Choose', exact: true }).click();
  assert.equal(await page.locator('#exit').inputValue(), '18:30');
  await page.locator('#exit').fill('16:45');
  assert.equal(await page.locator('#entry').inputValue(), '08:15');
  assert.equal(await page.locator('#exit').inputValue(), '16:45');
  await page.locator('#exit').fill('24:00');
  assert.equal(await page.locator('#exit').evaluate(element => element.checkValidity()), false);
  await page.locator('#exit').fill('16:45');
  await page.locator('#end').fill('31/02/2026');
  await page.locator('#generate').click();
  await page.locator('#message:not([hidden])').waitFor();
  assert.match(await page.locator('#message').textContent(), /End date: enter a valid date/);
  assert.equal(await page.locator('#preview').isHidden(), true);
  await page.locator('#end').fill('31/10/2026');
  await page.locator('#generate').click();
  await page.locator('#preview').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#days input').count(), 61);
  assert.equal(await page.locator('#days input[data-weekend]').count(), 17);
  assert.equal(await page.locator('#days input[data-weekend]:checked').count(), 0);
  assert.equal(await page.locator('#days input[data-weekend]:disabled').count(), 17);
  assert.match(await page.locator('#days tr').first().textContent(), /01\/09\/2026/);
  assert.match(await page.locator('#days tr').first().textContent(), /Tuesday/);
  assert.match(await page.locator('#days tr').nth(4).textContent(), /Weekend/);
  assert.equal(await page.locator('#summary').textContent(), '44 days · 88 requests');
  await page.locator('#days input').nth(1).uncheck();
  assert.equal(await page.locator('#summary').textContent(), '43 days · 86 requests');
  assert.equal(await page.locator('#all-days').evaluate(element => element.indeterminate), true);
  assert.equal(await page.locator('#send').isDisabled(), true);
  assert.equal(await page.locator('#days tr').first().locator('td').nth(2).textContent(), '08:15');
  await page.locator('#all-days').check();
  assert.equal(await page.locator('#summary').textContent(), '44 days · 88 requests');
  assert.equal(await page.locator('#days input[data-weekend]:checked').count(), 0);
  assert.equal(await page.locator('#days input[data-weekend]:disabled').count(), 17);
  await page.locator('#all-days').uncheck();
  assert.equal(await page.locator('#summary').textContent(), '0 days · 0 requests');
  await page.locator('#all-days').check();
  assert.equal(await page.locator('#summary').textContent(), '44 days · 88 requests');
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: path.join('test-results', 'preview.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Choose clock-out time', exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#exit-picker').isHidden(), true);
  await page.locator('#start').fill('07/11/2026');
  assert.equal(await page.locator('#preview').isHidden(), true);
  await page.locator('#end').fill('08/11/2026');
  await page.locator('#generate').click();
  await page.locator('#empty').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#days input').count(), 2);
  assert.equal(await page.locator('#days input:checked').count(), 0);
  assert.equal(await page.locator('#days input:disabled').count(), 2);
  assert.equal(await page.locator('#all-days').isDisabled(), true);
  await page.locator('#entry').fill('22:00');
  await page.locator('#exit').fill('06:00');
  await page.locator('#generate').click();
  await page.locator('#message').filter({ hasText: 'Overnight shifts are not supported' }).waitFor();

  // Este HTML es una fixture, no evidencia de compatibilidad con el portal real.
  const fixture = await browser.newPage();
  await fixture.route('**/*', route => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html lang="es"><body>
      <label for="when">Fecha y hora</label><input id="when" value="NO_COMPARTIR">
      <label for="direction">Sentido</label><select id="direction"><option>Entrada</option><option>Salida</option></select>
      <div class="dx-field"><span data-bind="text: lblInitialDate">Fecha y hora</span><div data-bind="dxDateBox: beginDate">Widget de prueba</div></div>
      <input type="password" id="secret" value="PASSWORD_SECRETO">
      <input type="hidden" name="token" value="TOKEN_SECRETO">
      <textarea id="observations">DATOS_PRIVADOS</textarea>
      <button onclick="window.saved=true">Guardar</button>
    </body></html>`
  }));
  await fixture.goto('https://vtportal.visualtime.net/2/index2.aspx#forgottenPunch-fixture');
  const inspector = new Portal();
  inspector.browser = browser;
  inspector.page = fixture;
  const diagnostic = await inspector.inspect();
  const serialized = JSON.stringify(diagnostic);
  for (const secret of ['NO_COMPARTIR', 'PASSWORD_SECRETO', 'TOKEN_SECRETO', 'DATOS_PRIVADOS']) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.equal(diagnostic.readOnly, true);
  assert.equal(diagnostic.controls.length, 3);
  assert.equal(diagnostic.widgets[0].binding, 'dxDateBox: beginDate');
  assert.deepEqual(diagnostic.widgets[0].fieldLabels, ['Fecha y hora']);
  assert.equal(await fixture.locator('#when').inputValue(), 'NO_COMPARTIR');
  assert.equal(await fixture.evaluate(() => window.saved), undefined);
  assert.equal(inspector.status().canSend, false);
  await assert.rejects(inspector.submit(), /Connect the form/);
  await fixture.goto('https://vtportal.visualtime.net/2/index2.aspx#home');
  await assert.rejects(inspector.inspect(), /Solicitar/);
  assert.deepEqual(errors, []);
  console.log('UI OK: 44 días/88 solicitudes, exclusión, selección total, horario, móvil, errores y bloqueo de envío.');
  console.log('Inspección OK sobre fixture interceptada: solo lectura, sin valores ni contraseñas. No se contactó con el portal real.');
} finally {
  if (browser) await browser.close();
  if (app) await app.close();
  await rm(dir, { recursive: true, force: true });
}
