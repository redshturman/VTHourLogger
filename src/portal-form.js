// Se ejecuta dentro del portal. Bindings comprobados con el diagnóstico del usuario.
export function readPortalForm({ punch = null, identityOnly = false } = {}) {
  const app = window.VTPortal?.roApp;
  if (!app || app.loggedIn !== true || !app.companyID || !(Number(app.employeeId) > 0) ||
      typeof app.getServerUrl !== 'function' || app.impersonatedIDEmployee !== -1 || app.impersonateOnlyRequest) {
    throw new Error('No se puede verificar la cuenta personal autenticada. No se admiten suplantaciones de empleado.');
  }
  const rawServer = app.getServerUrl();
  if (typeof rawServer !== 'string' || !rawServer.trim()) {
    throw new Error('El portal no ha proporcionado la dirección de su servicio.');
  }
  // En el portal web getServerUrl devuelve /api/Portalsvcx.svc.
  const service = new URL(rawServer.toLowerCase(), location.href);
  if (service.protocol !== 'https:' || service.username || service.password || service.search || service.hash) {
    throw new Error('El servicio de solicitudes no tiene una dirección HTTPS válida.');
  }
  const server = service.href;
  const identity = JSON.stringify([server, app.companyID.toLowerCase(), String(app.employeeId)]);
  if (identityOnly) return { identity };
  if (!location.hash.startsWith('#forgottenPunch/')) {
    throw new Error('Abre Solicitar → Fichaje no realizado antes de conectar.');
  }
  const $ = window.jQuery;
  if (!$ || !window.ko || typeof window.WebServiceRobotics?.prototype.saveForbbidenPunch !== 'function' ||
      window.VTPortalUtils?.constants.OK.value !== 0) {
    throw new Error('La versión del portal no coincide con la integración verificada.');
  }
  const element = binding => {
    const matches = [...document.querySelectorAll(`[data-bind="${binding}"]`)]
      .filter(node => node.getClientRects().length > 0);
    if (matches.length !== 1) throw new Error(`No hay un control único visible: ${binding}.`);
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
    throw new Error('El formulario no es una solicitud nueva. No se modificará una solicitud existente.');
  }
  if ([date, type, direction].some(widget => widget.option('readOnly') || widget.option('disabled')) ||
      save.option('disabled') || save.option('visible') === false) {
    throw new Error('El formulario no permite crear la solicitud.');
  }
  const originalType = type.option('value');
  // DevExtreme puede añadir un input oculto antes del texto visible del desplegable.
  if (originalType !== 1 && originalType !== '1') {
    throw new Error('El tipo debe ser Presencia. La aplicación no cambiará el tipo automáticamente.');
  }
  const originalReason = reason.option('value');
  const originalRemarks = remarks.option('value');
  if ((originalReason !== null && originalReason !== undefined && originalReason !== '' && originalReason !== '-1' && originalReason !== -1) ||
      (originalRemarks !== null && originalRemarks !== undefined && originalRemarks !== '')) {
    throw new Error('Motivo u Observaciones no están vacíos. Abre una solicitud nueva: no se borrarán ni cambiarán estos campos.');
  }
  if (punch) {
    const desired = new Date(`${punch.date}T${punch.time}:00`);
    if (!Number.isFinite(desired.getTime()) || desired > new Date() ||
        !['Entrada', 'Salida'].includes(punch.direction) || punch.type !== 'Presencia') {
      throw new Error('Fecha, hora o sentido no válidos para una solicitud histórica.');
    }
    const localDate = value => {
      const pad = number => String(number).padStart(2, '0');
      return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
    };
    if (localDate(desired) !== `${punch.date}T${punch.time}`) {
      throw new Error('La hora indicada no existe en la zona horaria del navegador.');
    }
    date.option('value', desired);
    direction.option('value', punch.direction === 'Entrada' ? 'E' : 'S');
    const actual = new Date(date.option('value'));
    if (localDate(actual) !== `${punch.date}T${punch.time}` || actual.getSeconds() !== 0 ||
        direction.option('value') !== (punch.direction === 'Entrada' ? 'E' : 'S') ||
        reason.option('value') !== originalReason || remarks.option('value') !== originalRemarks ||
        type.option('value') !== originalType) {
      throw new Error('La comprobación de los campos después de la carga no coincide. No se guardará.');
    }
  }
  const writeUrl = new URL(`${server}/SaveRequestForbiddenPunch`);
  if (writeUrl.protocol !== 'https:' || writeUrl.username || writeUrl.password || writeUrl.search || writeUrl.hash) {
    throw new Error('El servicio de solicitudes no tiene una dirección HTTPS válida.');
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
    throw new Error('El portal ha cambiado el formato de la solicitud. Se ha bloqueado el guardado.');
  }
  const form = await new Response(new Uint8Array(data), {
    headers: { 'Content-Type': contentType }
  }).formData();
  const fields = {};
  for (const [key, value] of form) {
    if (key in fields || typeof value !== 'string') throw new Error('Solicitud con campos inesperados o duplicados.');
    fields[key] = value;
  }
  return fields;
}
