import { readFile, open, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const filename = fileURLToPath(new URL('../.credentials', import.meta.url));

export function validateCredentials(value) {
  if (!value || !['client', 'user', 'password'].every(key =>
    typeof value[key] === 'string' && value[key].length > 0 && value[key].length <= 4096)) {
    throw new Error('Invalid saved login. Client, user, and password are required.');
  }
  return { client: value.client, user: value.user, password: value.password };
}

export async function loadCredentials() {
  let text;
  try {
    text = await readFile(filename, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error('Unable to read .credentials. Check file permissions.');
  }
  try {
    return validateCredentials(JSON.parse(text));
  } catch {
    throw new Error('Invalid .credentials file. Remove it or correct its client, user, and password fields.');
  }
}

export async function saveCredentials(value) {
  const credentials = validateCredentials(value);
  const temp = `${filename}.tmp`;
  const file = await open(temp, 'w', 0o600);
  try {
    await file.writeFile(JSON.stringify(credentials, null, 2), 'utf8');
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temp, filename);
}

// Runs only on the portal origin; no credentials are sent to the local UI.
export function observeLogin() {
  if (location.origin !== 'https://vtportal.visualtime.net') return;
  let pending = null;
  let saving = false;
  const read = binding => {
    const element = [...document.querySelectorAll('[data-bind]')].find(element =>
      element.getAttribute('data-bind').startsWith(`dxTextBox: ${binding}`) &&
      element.getClientRects().length > 0);
    return element ? window.jQuery(element).dxTextBox('instance').option('value') : null;
  };
  document.addEventListener('click', event => {
    if (event.target.closest('[data-bind="dxButton: btnRedirectToSSO"], [data-bind="dxButton: btnRecover"]')) {
      pending = null;
      return;
    }
    if (!location.hash.startsWith('#login') || !event.target.closest('[data-bind="dxButton: btnLogin"]')) return;
    pending = { client: read('txtClient'), user: read('txtUsername'), password: read('txtPwd') };
  }, true);
  document.addEventListener('keyup', event => {
    if (event.key === 'Enter' && location.hash.startsWith('#login')) {
      pending = { client: read('txtClient'), user: read('txtUsername'), password: read('txtPwd') };
    }
  }, true);
  const timer = setInterval(async () => {
    if (!pending || saving || window.VTPortal?.roApp?.loggedIn !== true) return;
    saving = true;
    clearInterval(timer);
    try {
      await window.visualtimeRememberLogin(pending);
    } catch {
      // The page can close while the local save binding is in flight.
      console.error('Unable to remember the portal login. Check the local app status.');
    } finally {
      pending = null;
    }
  }, 250);
}

export async function fillLogin(page, credentials) {
  const widget = binding => page.locator(`[data-bind^="dxTextBox: ${binding}"]:visible`);
  await widget('txtClient').waitFor({ timeout: 30000 });
  await widget('txtClient').click();
  const client = widget('txtClientLocation').locator('input');
  await client.fill(credentials.client);
  await page.locator('[data-bind="dxButton: btnAcceptMTConf"]:visible').click();
  await client.waitFor({ state: 'hidden', timeout: 30000 });
  await widget('txtUsername').locator('input').fill(credentials.user);
  await widget('txtPwd').locator('input').fill(credentials.password);
  // Leave the final sign-in click to the user (including any SSO/MFA).
}
