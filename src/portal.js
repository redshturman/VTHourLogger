import { chromium } from 'playwright';
import { AppError } from './calendar.js';
import { createHash, randomUUID } from 'node:crypto';
import { readPortalForm, multipartFields } from './portal-form.js';
import { installSaveObserver, removeSaveObserver } from './portal-observer.js';

const PORTAL_URL = 'https://vtportal.visualtime.net/index.aspx';

export class Portal {
  constructor({ responseTimeout = 45000 } = {}) {
    this.browser = null;
    this.page = null;
    this.opening = false;
    this.connection = null;
    this.prepared = false;
    this.busy = false;
    this.responseTimeout = responseTimeout;
  }

  status() {
    const browserOpen = Boolean(this.browser?.isConnected() && this.page && !this.page.isClosed());
    return {
      browserOpen,
      canPrepare: browserOpen && Boolean(this.connection),
      canSend: browserOpen && Boolean(this.connection) && this.prepared,
      accountId: browserOpen ? this.connection?.accountId || null : null,
      message: !this.connection
        ? 'Open a new request and verify the form. Nothing has been submitted yet.'
        : !this.prepared
          ? 'Form connected. Test filling without saving before confirming submission.'
          : 'Form filled without saving. Submission will only start after your explicit confirmation.'
    };
  }

  async open() {
    if (this.opening) throw new AppError('The browser is opening.', 409);
    if (this.status().browserOpen) {
      await this.page.bringToFront();
      return this.status();
    }
    this.opening = true;
    try {
      await this.close();
      this.browser = await chromium.launch({ channel: 'msedge', headless: false });
      const context = await this.browser.newContext({ locale: 'es-ES', timezoneId: 'Europe/Madrid' });
      this.page = await context.newPage();
      await this.page.goto(PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      return this.status();
    } catch (error) {
      await this.close();
      throw new AppError(`Unable to open Microsoft Edge: ${error.message}. Check that it is installed and try again.`, 503);
    } finally {
      this.opening = false;
    }
  }

  async inspect() {
    if (!this.status().browserOpen) throw new AppError('Open the portal browser first.', 409);
    const url = new URL(this.page.url());
    if (url.origin !== 'https://vtportal.visualtime.net' || !url.hash.startsWith('#forgottenPunch')) {
      throw new AppError('In Edge, sign in and open Request → Missing punch (Solicitar → Fichaje no realizado in Spanish). Do not click Save. Then inspect again.', 409);
    }
    // Solo se extrae estructura; no se leen valores introducidos ni datos de autenticación.
    const structure = await this.page.evaluate(() => {
      const visible = element => element.getClientRects().length > 0;
      const describe = element => ({
        tag: element.tagName.toLowerCase(),
        id: element.id || null,
        name: element.getAttribute('name'),
        type: element.getAttribute('type'),
        role: element.getAttribute('role'),
        binding: element.getAttribute('data-bind'),
        label: element.getAttribute('aria-label') ||
          [...(element.labels || [])].map(label => label.textContent.trim()).join(' ') || null,
        labelledBy: element.getAttribute('aria-labelledby'),
        className: element.getAttribute('class'),
        ...(element.tagName === 'SELECT'
          ? { options: [...element.options].map(option => option.textContent.trim()) }
          : {})
      });
      return {
        labels: [...document.querySelectorAll('label')].filter(visible).map(label => ({
          text: label.textContent.trim(), for: label.htmlFor || null
        })),
        widgets: [...document.querySelectorAll('[data-bind]')]
          .filter(element => visible(element) && /^dx(DateBox|SelectBox|TextArea|Button):/.test(element.getAttribute('data-bind')))
          .map(element => ({
            ...describe(element),
            fieldLabels: [...(element.closest('.dx-field')?.querySelectorAll(':scope > span[data-bind^="text:"]') || [])]
              .map(label => label.textContent.trim())
          })),
        controls: [...document.querySelectorAll('input:not([type="password"]):not([type="hidden"]), select, textarea, [role="combobox"], [role="textbox"]')]
          .filter(visible).map(describe),
        buttons: [...document.querySelectorAll('button, [role="button"], input[type="submit"], a')]
          .filter(visible).map(element => ({
            ...describe(element),
            text: element.tagName === 'INPUT' ? null : element.textContent.trim().slice(0, 120),
            title: element.getAttribute('title'),
            children: [...element.querySelectorAll('i, svg, span')].map(child => ({
              tag: child.tagName.toLowerCase(),
              className: child.getAttribute('class'),
              ariaLabel: child.getAttribute('aria-label')
            }))
          })),
        frames: document.querySelectorAll('iframe').length
      };
    });
    return {
      inspectedAt: new Date().toISOString(),
      page: `${url.origin}${url.pathname}#forgottenPunch…`,
      readOnly: true,
      ...structure,
      warning: 'Structure diagnostic, not submission verification. No fields were changed and Save was not clicked. Review the diagnostic before sharing. Portal labels retain their original language.'
    };
  }

  requirePage() {
    if (!this.status().browserOpen) throw new AppError('Open the portal from this app and connect again.', 409);
    const url = new URL(this.page.url());
    if (url.origin !== 'https://vtportal.visualtime.net') {
      throw new AppError('The browser is not on the Visualtime portal.', 409);
    }
  }

  accountId(identity) {
    return createHash('sha256').update(identity).digest('hex');
  }

  async verify() {
    if (this.busy) throw new AppError('A portal operation is already running.', 409);
    this.connection = null;
    this.prepared = false;
    this.requirePage();
    try {
      const form = await this.page.evaluate(readPortalForm);
      this.connection = { accountId: this.accountId(form.identity), writeUrl: form.writeUrl };
      return this.status();
    } catch (error) {
      throw new AppError(`Unable to connect the form: ${error.message}`, 409);
    }
  }

  async checkAccount(accountId) {
    this.requirePage();
    const { identity } = await this.page.evaluate(readPortalForm, { identityOnly: true });
    if (this.accountId(identity) !== accountId || this.connection?.accountId !== accountId) {
      this.connection = null;
      this.prepared = false;
      throw new AppError('The portal account has changed. Connect again; nothing will be saved.', 409);
    }
  }

  async fill(punch, accountId) {
    await this.checkAccount(accountId);
    // No solapar una escritura pendiente con el siguiente elemento del lote.
    await this.page.waitForFunction(() => window.VTPortal.roApp.wsRequestCounter() === 0,
      null, { timeout: this.responseTimeout });
    const close = this.page.getByRole('button', { name: 'Cerrar', exact: true }).filter({ visible: true });
    if (await close.count() === 1) {
      await close.click({ timeout: 10000 });
      await close.waitFor({ state: 'hidden', timeout: 10000 });
    }
    const route = `forgottenPunch/-1/${punch.date}`;
    // El enrutador conserva vistas y servicios entre solicitudes. Recrear el
    // documento evita cargar o guardar sobre una vista anterior en transición.
    await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    try {
      await this.page.waitForFunction(() => {
        const app = window.VTPortal?.roApp;
        const route = location.hash.slice(1).split('/')[0];
        return app?.loggedIn === true && typeof app.wsRequestCounter === 'function' &&
          app.wsRequestCounter() === 0 && ['home', 'myTeamEmployees'].includes(route) &&
          typeof window.VTPortal.app?.navigate === 'function';
      }, null, { timeout: 30000 });
    } catch (error) {
      if (error.name !== 'TimeoutError') throw error;
      throw new Error('The portal did not finish starting after reloading. Check Edge for a sign-in prompt. Save has not been clicked.');
    }
    await this.checkAccount(accountId);
    await this.page.evaluate(route => window.VTPortal.app.navigate(route), route);
    await this.page.waitForFunction(route => {
      if (decodeURIComponent(location.hash.slice(1)) !== route) return false;
      const bindings = [
        ['dxDateBox: beginDate', 'dxDateBox'],
        ['dxSelectBox: cmbforgottenPunchType', 'dxSelectBox'],
        ['dxSelectBox: cmbRequestValue1', 'dxSelectBox'],
        ['dxSelectBox: cmbRequestValue2', 'dxSelectBox'],
        ['dxTextArea: remarks', 'dxTextArea'],
        ['dxButton: btnSave', 'dxButton']
      ];
      const controls = bindings.map(([binding]) =>
        [...document.querySelectorAll(`[data-bind="${binding}"]`)]
          .filter(element => element.getClientRects().length > 0));
      if (controls.some(matches => matches.length !== 1)) return false;
      const model = window.ko.dataFor(controls[0][0]);
      if (!model || typeof model.requestId !== 'function' ||
          (model.requestId() != null && model.requestId() !== -1) ||
          window.VTPortal.roApp.wsRequestCounter() !== 0) return false;
      // La ruta y el contador pueden estar listos antes de los widgets condicionales.
      try {
        return bindings.every(([, plugin], index) => {
          const widget = window.jQuery(controls[index][0])[plugin]('instance');
          return widget && typeof widget.option === 'function' &&
            !widget.option('disabled') && !widget.option('readOnly') &&
            widget.option('visible') !== false;
        });
      } catch {
        // DevExtreme aún está inicializando los widgets; solo se espera, nunca se guarda.
        return false;
      }
    }, route, { timeout: 30000 });
    await this.checkAccount(accountId);
    const form = await this.page.evaluate(readPortalForm, { punch });
    if (this.accountId(form.identity) !== accountId || form.writeUrl !== this.connection.writeUrl) {
      throw new Error('The account or service changed while filling the form. Nothing will be saved.');
    }
    return form;
  }

  async prepare(punch) {
    if (this.busy) throw new AppError('A portal operation is already running.', 409);
    const status = this.status();
    if (!status.canPrepare) throw new AppError('Verify the authenticated form first.', 409);
    this.busy = true;
    this.prepared = false;
    try {
      await this.fill(punch, status.accountId);
      this.prepared = true;
      await this.page.bringToFront();
      return {
        portal: this.status(), punch, saved: false,
        message: 'Date, time, and direction filled in Edge. Save has NOT been clicked. Check the fields, then return to the app to confirm the batch.'
      };
    } catch (error) {
      throw new AppError(`Unable to prepare the form: ${error.message}`, 409);
    } finally {
      this.busy = false;
    }
  }

  async submit(punch, expectedAccountId) {
    const status = this.status();
    if (!status.canSend || this.busy || status.accountId !== expectedAccountId) {
      const error = new AppError('Connect the form and test filling without saving before submitting. The account must match the confirmed account.', 409);
      error.outcome = 'not_attempted';
      throw error;
    }
    this.busy = true;
    let guard;
    let clicked = false;
    let blocked = null;
    let releasedCount = 0;
    let rejected = false;
    const observerId = randomUUID();
    let observerInstalled = false;
    let responseListener;
    try {
      const form = await this.fill(punch, status.accountId);
      let requestCount = 0;
      let releasedRequest = null;
      let networkReceipt = null;
      const matches = value => {
        const actual = new URL(value);
        const expected = new URL(form.writeUrl);
        return actual.origin.toLowerCase() === expected.origin.toLowerCase() &&
          actual.pathname.toLowerCase() === expected.pathname.toLowerCase();
      };
      guard = async route => {
        const request = route.request();
        if (!matches(request.url())) return route.fallback();
        if (request.method() === 'OPTIONS') return route.fallback();
        try {
          if (request.method() !== 'POST' || ++requestCount !== 1) {
            throw new Error('The portal attempted an unexpected or repeated submission.');
          }
          const fields = await multipartFields(request);
          const expected = {
            punchDate: `${punch.date} ${punch.time}`,
            idCause: form.reason,
            comments: form.remarks,
            direction: punch.direction === 'Entrada' ? 'E' : 'S',
            acceptWarning: 'false',
            tcType: '0'
          };
          if (Object.keys(fields).length !== Object.keys(expected).length ||
              Object.entries(expected).some(([key, value]) => fields[key] !== value)) {
            throw new Error('Outgoing data does not match the confirmed request. Submission was blocked.');
          }
          await this.checkAccount(status.accountId);
          releasedRequest = request;
          releasedCount++;
          await route.fallback();
        } catch (error) {
          blocked = error;
          await route.abort('blockedbyclient');
          await this.page.evaluate(({ id, message }) => {
            const state = window.__visualtimeSaveObserver;
            if (state?.id === id) state.blocked = message;
          }, { id: observerId, message: error.message });
        }
      };
      responseListener = async response => {
        if (response.request() !== releasedRequest) return;
        try {
          if (!response.ok()) {
            networkReceipt = { error: `The service returned HTTP ${response.status()}.` };
            return;
          }
          const body = await response.json();
          networkReceipt = typeof body?.d?.Status === 'number'
            ? { receipt: { Status: body.d.Status, PunchWithoutRequest: body.d.PunchWithoutRequest === true } }
            : { error: 'The service response does not contain a valid result code.' };
        } catch (error) {
          networkReceipt = { error: `Unable to read the service acknowledgement: ${error.message}` };
        }
      };
      this.page.on('response', responseListener);
      await this.page.route('**/*', guard);
      await this.page.evaluate(installSaveObserver, {
        id: observerId, punch, reason: form.reason, remarks: form.remarks
      });
      observerInstalled = true;
      // Solo este clic puede escribir; nunca se llama directamente al servicio del portal.
      clicked = true;
      await this.page.locator('[data-bind="dxButton: btnSave"]:visible').click({ timeout: 10000 });
      const deadline = Date.now() + this.responseTimeout;
      while (!networkReceipt) {
        const failure = await this.page.evaluate(id => {
          const state = window.__visualtimeSaveObserver;
          return state?.id === id && state.blocked && state.calls <= 1 ? state.blocked : null;
        }, observerId);
        if (failure) throw new Error(failure);
        if (Date.now() >= deadline) {
          throw new Error(`No service acknowledgement received (${requestCount} requests observed). Saving will not be retried.`);
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      const observed = await this.page.evaluate(id => {
        const state = window.__visualtimeSaveObserver;
        if (state?.id !== id) throw new Error('The save observer was lost.');
        return { receipt: state.receipt, blocked: state.blocked, calls: state.calls };
      }, observerId);
      if (blocked) throw blocked;
      if (observed.blocked) {
        const error = new Error(observed.blocked);
        // Si hubo una petición anterior, su resultado sigue siendo incierto.
        if (requestCount === 0 && observed.calls === 1) blocked = error;
        throw error;
      }
      if (networkReceipt.error) throw new Error(networkReceipt.error);
      if (observed.receipt && observed.receipt.Status !== networkReceipt.receipt.Status) {
        throw new Error('The callback and service response do not match. Check the portal.');
      }
      const receipt = { d: networkReceipt.receipt };
      if (receipt?.d?.Status === -50 || receipt?.d?.Status === -51) {
        const code = receipt.d.Status;
        const close = this.page.getByRole('button', { name: 'Cerrar', exact: true }).filter({ visible: true });
        await close.waitFor({ state: 'visible', timeout: 10000 });
        const detail = await this.page.evaluate(() => {
          const dialogs = [...document.querySelectorAll('[role="dialog"], .dx-dialog')]
            .filter(element => element.getClientRects().length > 0);
          return [...new Set(dialogs.map(element => element.textContent.trim()))].join('\n').slice(0, 2000);
        });
        await close.click({ timeout: 10000 });
        await close.waitFor({ state: 'hidden', timeout: 10000 });
        if (code === -50) {
          rejected = true;
          const error = new Error(
            `The portal rejected ${punch.date} ${punch.time} ${punch.direction === 'Entrada' ? 'Clock in' : 'Clock out'} as a repeated request (Status=-50). ` +
            'No new request was created and an existing visible request has not been verified.' +
            (detail ? ` Original portal message: ${detail}` : '')
          );
          error.portalStatus = code;
          throw error;
        }
        return {
          confirmed: true,
          existing: true,
          portalStatus: code,
          reference: 'The portal reports that a punch already exists for this date and time.'
        };
      }
      if (receipt?.d?.Status !== 0) {
        rejected = typeof receipt?.d?.Status === 'number';
        const error = new Error(`The portal did not confirm the request (Status=${receipt?.d?.Status ?? 'unknown'}). Warnings will not be accepted automatically.`);
        error.portalStatus = receipt?.d?.Status;
        throw error;
      }
      await this.page.waitForFunction(() => !location.hash.startsWith('#forgottenPunch/'), null, { timeout: 10000 });
      return {
        confirmed: true,
        reference: `Portal acknowledgement Status=0 · ${punch.date} ${punch.time} ${punch.direction === 'Entrada' ? 'Clock in' : 'Clock out'}`,
        directPunch: receipt.d.PunchWithoutRequest === true,
        stop: receipt.d.PunchWithoutRequest === true
      };
    } catch (error) {
      const failure = new AppError(`${clicked ? 'Save not confirmed' : 'Save has not been clicked'}: ${error.message}`, 409);
      failure.outcome = !clicked || (blocked && releasedCount === 0) ? 'not_attempted' : rejected ? 'failed' : 'uncertain';
      failure.portalStatus = error.portalStatus;
      throw failure;
    } finally {
      this.busy = false;
      if (responseListener) this.page.off('response', responseListener);
      if (observerInstalled && !this.page.isClosed()) await this.page.evaluate(removeSaveObserver, observerId);
      if (guard) await this.page.unroute('**/*', guard);
    }
  }

  async close() {
    const browser = this.browser;
    this.browser = null;
    this.page = null;
    this.connection = null;
    this.prepared = false;
    if (browser) await browser.close();
  }
}
