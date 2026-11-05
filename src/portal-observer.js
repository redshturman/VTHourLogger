// Observa el callback que el propio portal usa para confirmar el botón Guardar.
export function installSaveObserver({ id, punch, reason, remarks }) {
  const prototype = window.WebServiceRobotics?.prototype;
  if (!prototype || typeof prototype.saveForbbidenPunch !== 'function') {
    throw new Error('Unable to observe saving in this portal version.');
  }
  if (window.__visualtimeSaveObserver) throw new Error('Another save observer is already active.');
  const original = prototype.saveForbbidenPunch;
  const state = { id, calls: 0, receipt: null, blocked: null, restores: [] };
  const wrapper = function (date, cause, comments, direction, acceptWarning, tcType) {
    state.calls++;
    if (state.calls !== 1 || typeof date?.format !== 'function' ||
        date.format('YYYY-MM-DD HH:mm') !== `${punch.date} ${punch.time}` ||
        String(cause) !== reason || comments !== remarks ||
        direction !== (punch.direction === 'Entrada' ? 'E' : 'S') ||
        acceptWarning !== false || String(tcType) !== '0') {
      state.blocked = 'The portal attempted to repeat a save or submit different data. It was blocked before submission.';
      return;
    }
    const success = this.onSuccessCall;
    if (typeof success !== 'function') {
      state.blocked = 'The portal confirmation callback was not found. The save was not submitted.';
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
