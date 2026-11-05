// Observa el callback que el propio portal usa para confirmar el botón Guardar.
export function installSaveObserver({ id, punch, reason, remarks }) {
  const prototype = window.WebServiceRobotics?.prototype;
  if (!prototype || typeof prototype.saveForbbidenPunch !== 'function') {
    throw new Error('No se puede observar el guardado de esta versión del portal.');
  }
  if (window.__visualtimeSaveObserver) throw new Error('Hay otra observación de guardado activa.');
  const original = prototype.saveForbbidenPunch;
  const state = { id, calls: 0, receipt: null, blocked: null, restores: [] };
  const wrapper = function (date, cause, comments, direction, acceptWarning, tcType) {
    state.calls++;
    if (state.calls !== 1 || typeof date?.format !== 'function' ||
        date.format('YYYY-MM-DD HH:mm') !== `${punch.date} ${punch.time}` ||
        String(cause) !== reason || comments !== remarks ||
        direction !== (punch.direction === 'Entrada' ? 'E' : 'S') ||
        acceptWarning !== false || String(tcType) !== '0') {
      state.blocked = 'El portal intentó repetir el guardado o enviar datos diferentes. Se bloqueó antes de enviarlos.';
      return;
    }
    const success = this.onSuccessCall;
    if (typeof success !== 'function') {
      state.blocked = 'No se encontró el callback de confirmación del portal. No se envió el guardado.';
      return;
    }
    const callback = function (receipt) {
      // Solo conservar el acuse mínimo, nunca credenciales ni contenido de la respuesta.
      if (typeof receipt?.Status === 'number') {
        state.receipt = { Status: receipt.Status, PunchWithoutRequest: receipt.PunchWithoutRequest === true };
      }
      return success.apply(this, arguments);
    };
    this.onSuccessCall = callback;
    const instance = this;
    state.restores.push(() => {
      if (instance.onSuccessCall === callback) instance.onSuccessCall = success;
    });
    return original.apply(this, arguments);
  };
  state.cleanup = () => {
    if (prototype.saveForbbidenPunch === wrapper) prototype.saveForbbidenPunch = original;
    for (const restore of state.restores) restore();
    delete window.__visualtimeSaveObserver;
  };
  window.__visualtimeSaveObserver = state;
  prototype.saveForbbidenPunch = wrapper;
}

export function removeSaveObserver(id) {
  const state = window.__visualtimeSaveObserver;
  if (state?.id === id) state.cleanup();
}
