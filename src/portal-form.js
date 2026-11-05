// Se ejecuta dentro del portal. Bindings comprobados con el diagnóstico del usuario.
export function readPortalForm({ punch = null, identityOnly = false } = {}) {
  const app = window.VTPortal?.roApp;
  if (!app || app.loggedIn !== true || !app.companyID || !(Number(app.employeeId) > 0) ||
      typeof app.getServerUrl !== 'function' || app.impersonatedIDEmployee !== -1 || app.impersonateOnlyRequest) {
    throw new Error('Unable to verify the authenticated personal account. Employee impersonation is not supported.');
  }
  const rawServer = app.getServerUrl();
  if (typeof rawServer !== 'string' || !rawServer.trim()) {
    throw new Error('The portal did not provide its service address.');
  }
  // En el portal web getServerUrl devuelve /api/Portalsvcx.svc.
  const service = new URL(rawServer.toLowerCase(), location.href);
  if (service.protocol !== 'https:' || service.username || service.password || service.search || service.hash) {
    throw new Error('The request service does not have a valid HTTPS address.');
  }
  const server = service.href;
  const identity = JSON.stringify([server, app.companyID.toLowerCase(), String(app.employeeId)]);
  if (identityOnly) return { identity };
  if (!location.hash.startsWith('#forgottenPunch/')) {
    throw new Error('Open Request → Missing punch (Solicitar → Fichaje no realizado in Spanish) before connecting.');
  }
  const $ = window.jQuery;
  if (!$ || !window.ko || typeof window.WebServiceRobotics?.prototype.saveForbbidenPunch !== 'function' ||
      window.VTPortalUtils?.constants.OK.value !== 0) {
    throw new Error('The portal version does not match the supported integration.');
  }
  const element = binding => {
    const matches = [...document.querySelectorAll(`[data-bind="${binding}"]`)]
      .filter(node => node.getClientRects().length > 0);
    if (matches.length !== 1) throw new Error(`No unique visible control found: ${binding}.`);
    return matches[0];
  };
  const dateElement = element('dxDateBox: beginDate');
  const date = $(dateElement).dxDateBox('instance');
  const type = $(element('dxSelectBox: cmbforgottenPunchType')).dxSelectBox('instance');
  const direction = $(element('dxSelectBox: cmbRequestValue1')).dxSelectBox('instance');
  const reason = $(element('dxSelectBox: cmbRequestValue2')).dxSelectBox('instance');
  const remarks = $(element('dxTextArea: remarks')).dxTextArea('instance');
  const save = $(element('dxButton: btnSave')).dxButton('instance');
  const model = window.ko.dataFor(dateElement);
  if (!model || typeof model.requestId !== 'function' || (model.requestId() !== null && model.requestId() !== -1)) {
    throw new Error('The form is not a new request. An existing request will not be modified.');
  }
  if ([date, type, direction].some(widget => widget.option('readOnly') || widget.option('disabled')) ||
      save.option('disabled') || save.option('visible') === false) {
    throw new Error('The form does not allow creating this request.');
  }
  const originalType = type.option('value');
  // DevExtreme puede añadir un input oculto antes del texto visible del desplegable.
  if (originalType !== 1 && originalType !== '1') {
    throw new Error('The type must be Attendance (Presencia in Spanish). The app will not change the type automatically.');
  }
  const originalReason = reason.option('value');
  const originalRemarks = remarks.option('value');
  if ((originalReason !== null && originalReason !== undefined && originalReason !== '' && originalReason !== '-1' && originalReason !== -1) ||
      (originalRemarks !== null && originalRemarks !== undefined && originalRemarks !== '')) {
    throw new Error('Reason or Comments are not empty. Open a new request: these fields will not be cleared or changed.');
  }
  if (punch) {
    const desired = new Date(`${punch.date}T${punch.time}:00`);
    if (!Number.isFinite(desired.getTime()) || desired > new Date() ||
        !['Entrada', 'Salida'].includes(punch.direction) || punch.type !== 'Presencia') {
      throw new Error('Invalid date, time, or direction for a historical request.');
    }
    const localDate = value => {
      const pad = number => String(number).padStart(2, '0');
      return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
    };
    if (localDate(desired) !== `${punch.date}T${punch.time}`) {
      throw new Error('The specified time does not exist in the browser time zone.');
    }
    date.option('value', desired);
    direction.option('value', punch.direction === 'Entrada' ? 'E' : 'S');
    const actual = new Date(date.option('value'));
    if (localDate(actual) !== `${punch.date}T${punch.time}` || actual.getSeconds() !== 0 ||
        direction.option('value') !== (punch.direction === 'Entrada' ? 'E' : 'S') ||
        reason.option('value') !== originalReason || remarks.option('value') !== originalRemarks ||
        type.option('value') !== originalType) {
      throw new Error('The fields do not match after filling. Nothing will be saved.');
    }
  }
  const writeUrl = new URL(`${server}/SaveRequestForbiddenPunch`);
  if (writeUrl.protocol !== 'https:' || writeUrl.username || writeUrl.password || writeUrl.search || writeUrl.hash) {
    throw new Error('The request service does not have a valid HTTPS address.');
  }
  return {
    identity,
    writeUrl: writeUrl.href,
    reason: originalReason == null || originalReason === '' ? '-1' : String(originalReason),
    remarks: originalRemarks || '',
    date: date.option('value') instanceof Date ? date.option('value').toISOString() : null,
    direction: direction.option('value')
  };
}

export async function multipartFields(request) {
  const contentType = request.headers()['content-type'];
  const data = request.postDataBuffer();
  if (!contentType?.startsWith('multipart/form-data;') || !data) {
    throw new Error('The portal request format has changed. Saving was blocked.');
  }
  const form = await new Response(new Uint8Array(data), {
    headers: { 'Content-Type': contentType }
  }).formData();
  const fields = {};
  for (const [key, value] of form) {
    if (key in fields || typeof value !== 'string') throw new Error('Request contains unexpected or duplicate fields.');
    fields[key] = value;
  }
  return fields;
}
