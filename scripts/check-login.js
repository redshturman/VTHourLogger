import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { observeLogin, fillLogin, validateCredentials } from '../src/credentials.js';

assert.throws(() => validateCredentials({ client: 'test', user: 'test', password: '' }));
assert.deepEqual(validateCredentials({ client: 'test', user: 'test', password: 'fixture-only', token: 'discard' }),
  { client: 'test', user: 'test', password: 'fixture-only' });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  const captures = [];
  await page.exposeBinding('visualtimeRememberLogin', (_, value) => captures.push(value));
  await page.addInitScript(observeLogin);
  await page.route('**/*', route => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><body>
      <div data-bind="dxTextBox: txtClient, dxValidator: requiredField"><input readonly></div>
      <div data-bind="dxTextBox: txtUsername, dxValidator: requiredField"><input></div>
      <div data-bind="dxTextBox: txtPwd, dxValidator: requiredField"><input type="password"></div>
      <div id="popup" hidden>
        <div data-bind="dxTextBox: txtClientLocation"><input></div>
        <button data-bind="dxButton: btnAcceptMTConf">Accept</button>
      </div>
      <button data-bind="dxButton: btnLogin">Sign in</button>
      <script>
        window.VTPortal = {roApp: {loggedIn: false}};
        window.jQuery = element => ({dxTextBox: () => ({option: () => element.querySelector('input').value})});
        document.querySelector('[data-bind^="dxTextBox: txtClient,"]').onclick = () => { popup.hidden = false; };
        document.querySelector('[data-bind="dxButton: btnAcceptMTConf"]').onclick = () => {
          document.querySelector('[data-bind^="dxTextBox: txtClient,"] input').value =
            document.querySelector('#popup input').value;
          popup.hidden = true;
        };
        document.querySelector('[data-bind="dxButton: btnLogin"]').onclick = () => {
          if (window.allowLogin) {
            VTPortal.roApp.loggedIn = true;
            location.hash = 'home';
          }
        };
      </script>`
  }));
  await page.goto('https://vtportal.visualtime.net/2/indexv2.aspx#login');
  const credentials = { client: 'fixture-client', user: 'fixture-user', password: 'fixture-only' };
  await fillLogin(page, credentials);
  assert.equal(await page.locator('[type="password"]').inputValue(), credentials.password);
  assert.equal(captures.length, 0);
  await page.locator('[data-bind="dxButton: btnLogin"]').click();
  await page.waitForTimeout(350);
  assert.equal(captures.length, 0, 'Failed login must not save credentials.');
  await page.evaluate(() => { window.allowLogin = true; });
  await page.locator('[data-bind="dxButton: btnLogin"]').click();
  await page.waitForFunction(() => location.hash === '#home');
  await page.waitForTimeout(350);
  assert.deepEqual(captures, [credentials]);
  console.log('Login fixture OK: client popup, automatic fill, no automatic submit, capture only after successful login. No real credentials read or written.');
} finally {
  await browser.close();
}
