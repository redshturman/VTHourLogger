const $ = id => document.getElementById(id);
let token;
let plan = null;
let portal = { canSend: false, browserOpen: false };
let diagnostic = null;
let sending = false;
let operating = false;

function setupPickers() {
  for (const id of ['start', 'end', 'entry', 'exit']) {
    const input = $(id);
    const isDate = id === 'start' || id === 'end';
    const wrapper = document.createElement('div');
    wrapper.className = 'picker-field';
    input.replaceWith(wrapper);
    wrapper.append(input);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'secondary picker-toggle';
    toggle.textContent = isDate ? 'Calendario' : 'Hora';
    toggle.setAttribute('aria-label', `Elegir ${input.closest('label').firstChild.textContent.trim().toLowerCase()}`);
    const popup = document.createElement('div');
    popup.id = `${id}-picker`;
    popup.className = 'picker-popup';
    popup.setAttribute('role', 'group');
    popup.setAttribute('aria-label', toggle.getAttribute('aria-label'));
    popup.hidden = true;
    popup.addEventListener('click', event => {
      event.stopPropagation();
    });
    toggle.setAttribute('aria-controls', popup.id);
    toggle.setAttribute('aria-expanded', 'false');
    wrapper.append(toggle, popup);
    const close = () => {
      popup.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    };
    const choose = value => {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      close();
      input.focus();
    };
    const pad = number => String(number).padStart(2, '0');
    const button = (text, action, label = text) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.textContent = text;
      element.setAttribute('aria-label', label);
      element.addEventListener('click', action);
      return element;
    };
    let month;
    const renderCalendar = () => {
      popup.replaceChildren();
      const header = document.createElement('div');
      header.className = 'calendar-header';
      const title = document.createElement('strong');
      title.textContent = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(month);
      const move = offset => {
        month.setMonth(month.getMonth() + offset);
        renderCalendar();
      };
      header.append(button('<', () => move(-1), 'Mes anterior'), title, button('>', () => move(1), 'Mes siguiente'));
      const grid = document.createElement('div');
      grid.className = 'calendar-grid';
      for (const day of ['L', 'M', 'X', 'J', 'V', 'S', 'D']) {
        const label = document.createElement('span');
        label.textContent = day;
        grid.append(label);
      }
      const offset = (month.getDay() + 6) % 7;
      for (let index = 0; index < offset; index++) grid.append(document.createElement('span'));
      const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
      for (let day = 1; day <= count; day++) {
        const value = `${pad(day)}/${pad(month.getMonth() + 1)}/${month.getFullYear()}`;
        const option = button(String(day), () => choose(value), value);
        option.setAttribute('aria-pressed', String(input.value === value));
        grid.append(option);
      }
      popup.append(header, grid);
    };
    toggle.addEventListener('click', () => {
      if (!popup.hidden) return close();
      if (isDate) {
        const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(input.value);
        month = match ? new Date(Number(match[3]), Number(match[2]) - 1, 1) : new Date();
        month.setDate(1);
        renderCalendar();
      } else {
        popup.replaceChildren();
        const values = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(input.value);
        const selects = [24, 60].map((count, index) => {
          const label = document.createElement('label');
          label.textContent = index === 0 ? 'Hora (24 h)' : 'Minuto';
          const select = document.createElement('select');
          select.setAttribute('aria-label', label.textContent);
          for (let value = 0; value < count; value++) select.add(new Option(pad(value), pad(value)));
          select.value = values ? values[index + 1] : '00';
          label.append(select);
          popup.append(label);
          return select;
        });
        popup.append(button('Elegir', () => choose(`${selects[0].value}:${selects[1].value}`)));
      }
      popup.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      popup.querySelector('select, button')?.focus();
    });
    wrapper.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        toggle.focus();
      }
    });
    document.addEventListener('click', event => {
      if (!wrapper.contains(event.target)) close();
    });
  }
}

setupPickers();

function message(text, error = false) {
  for (const id of ['message', 'preview-message', 'connection-message']) {
    $(id).textContent = text;
    $(id).className = error ? 'feedback error' : 'feedback';
    $(id).hidden = !text;
  }
}

async function api(url, data) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Visualtime-Token': token },
    body: JSON.stringify(data || {})
  });
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.error || 'No se ha podido completar la operación.');
    error.results = body.results;
    throw error;
  }
  return body;
}

function selectedDates() {
  return [...document.querySelectorAll('#days input:not([data-weekend]):checked')].map(input => input.value);
}

function updateSelection() {
  const count = selectedDates().length;
  $('summary').textContent = `${count} días · ${count * 2} solicitudes`;
  $('all-days').checked = count > 0 && count === plan.days.length;
  $('all-days').indeterminate = count > 0 && count < plan.days.length;
  $('all-days').disabled = plan.days.length === 0 || sending;
  $('send').disabled = !portal.canSend || count === 0 || sending || operating;
  $('prepare').disabled = !portal.canPrepare || count === 0 || sending || operating;
  document.querySelectorAll('#days input').forEach(input => {
    input.disabled = sending || input.hasAttribute('data-weekend');
    input.closest('tr').classList.toggle('excluded', !input.checked);
  });
}

function formatDate(date) {
  return new Intl.DateTimeFormat('es-ES', {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC'
  }).format(new Date(`${date}T00:00:00Z`));
}

function formatDetail(text) {
  return text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, '$3/$2/$1');
}

function cell(row, text) {
  const td = document.createElement('td');
  td.textContent = text;
  row.append(td);
  return td;
}

function renderPlan() {
  $('days').replaceChildren();
  const rows = document.createDocumentFragment();
  const weekdays = new Set(plan.days);
  for (const day = new Date(`${plan.start}T00:00:00Z`), end = new Date(`${plan.end}T00:00:00Z`);
    day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10);
    const weekend = !weekdays.has(date);
    const row = document.createElement('tr');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = date;
    checkbox.checked = !weekend;
    if (weekend) {
      checkbox.dataset.weekend = '';
      checkbox.disabled = true;
    }
    checkbox.setAttribute('aria-label', `Incluir ${formatDate(date)}`);
    checkbox.addEventListener('change', updateSelection);
    cell(row, '').append(checkbox);
    cell(row, `${formatDate(date)}${weekend ? ' · Fin de semana' : ''}`);
    cell(row, weekend ? '—' : plan.entry);
    cell(row, weekend ? '—' : plan.exit);
    rows.append(row);
  }
  $('days').append(rows);
  $('preview').hidden = false;
  $('empty').hidden = plan.days.length > 0;
  updateSelection();
}

function renderPortal() {
  $('inspect').disabled = !portal.browserOpen || sending || operating;
  $('connect').disabled = !portal.browserOpen || sending || operating;
  $('open-portal').disabled = sending || operating;
  $('connection-badge').textContent = portal.canSend ? 'Listo' : portal.canPrepare ? 'Conectado' : 'Pendiente';
  $('integration-title').textContent = sending ? 'Enviando solicitudes · no cierres la aplicación'
    : portal.canSend ? 'Carga comprobada · pendiente de tu confirmación'
      : portal.canPrepare ? 'Conectado · prueba la carga sin guardar' : 'Conecta el formulario para empezar';
  $('send-help').textContent = portal.message || 'Conecta el formulario para empezar.';
  if (plan) updateSelection();
}

function renderResults(results) {
  $('results').replaceChildren();
  const names = { sending: 'Enviando…', submitted: 'Enviada', skipped: 'Omitida (el portal indica que existe)', failed: 'Rechazada', uncertain: 'Incierto · revisar portal', not_attempted: 'No intentada' };
  for (const result of results) {
    const row = document.createElement('tr');
    cell(row, `${formatDetail(result.date)} ${result.time}`);
    cell(row, result.direction);
    cell(row, names[result.status] || result.status);
    cell(row, formatDetail(result.message || 'No se ha intentado el envío.'));
    $('results').append(row);
  }
  const count = status => results.filter(result => result.status === status).length;
  $('results-summary').textContent = `${count('submitted')} enviadas · ${count('skipped')} omitidas · ${count('sending')} en curso · ${count('failed')} rechazadas · ${count('uncertain')} inciertas · ${count('not_attempted')} no intentadas. Enviada no significa aprobada.`;
  $('results-panel').hidden = false;
}

$('period-form').addEventListener('input', () => {
  plan = null;
  $('preview').hidden = true;
  $('results-panel').hidden = true;
  message('');
});

$('period-form').addEventListener('submit', async event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  for (const field of ['start', 'end']) {
    const [day, month, year] = values[field].split('/');
    values[field] = `${year}-${month}-${day}`;
  }
  [...$('period-form').elements].forEach(element => { element.disabled = true; });
  message('');
  try {
    plan = await api('/api/preview', values);
    renderPlan();
  } catch (error) {
    message(error.message, true);
  } finally {
    [...$('period-form').elements].forEach(element => { element.disabled = false; });
  }
});

$('all-days').addEventListener('change', event => {
  document.querySelectorAll('#days input:not([data-weekend])').forEach(input => { input.checked = event.target.checked; });
  updateSelection();
});

$('open-portal').addEventListener('click', async () => {
  $('open-portal').disabled = true;
  message('Abriendo Edge. Inicia sesión en la ventana del portal, no en esta aplicación.');
  try {
    portal = await api('/api/portal/open');
    renderPortal();
    message('En Edge, abre Solicitar → Fichaje no realizado y vuelve aquí. No pulses Guardar.');
  } catch (error) {
    message(error.message, true);
  } finally {
    $('open-portal').disabled = false;
  }
});

$('inspect').addEventListener('click', async () => {
  $('inspect').disabled = true;
  try {
    diagnostic = await api('/api/portal/inspect');
    $('diagnostic-content').textContent = JSON.stringify(diagnostic, null, 2);
    $('diagnostic').hidden = false;
    $('diagnostic').open = true;
    message('Estructura leída sin modificar el formulario. Para cargar las horas, pulsa Conectar formulario y después Probar carga sin guardar.');
  } catch (error) {
    message(error.message, true);
  } finally {
    $('inspect').disabled = false;
  }
});

$('connect').addEventListener('click', async () => {
  if (operating || sending) return;
  operating = true;
  renderPortal();
  $('connect').textContent = 'Comprobando formulario…';
  message('Comprobando la cuenta y los controles del formulario. No se cambiarán campos ni se guardará nada.');
  try {
    portal = await api('/api/portal/verify');
    message('Formulario conectado sin modificarlo. Genera o revisa tu periodo y pulsa Probar carga sin guardar.');
  } catch (error) {
    portal.canPrepare = false;
    portal.canSend = false;
    message(error.message, true);
  } finally {
    operating = false;
    $('connect').textContent = 'Conectar formulario';
    renderPortal();
  }
});

$('prepare').addEventListener('click', async () => {
  if (!plan || operating || sending) return;
  const dates = selectedDates();
  if (!dates.length) return;
  operating = true;
  [...$('period-form').elements].forEach(element => { element.disabled = true; });
  renderPortal();
  message('Cargando la primera entrada seleccionada en Edge. No se guardará ninguna solicitud.');
  try {
    const result = await api('/api/portal/prepare', { planId: plan.id, selectedDates: dates });
    portal = result.portal;
    message(result.message);
  } catch (error) {
    portal.canSend = false;
    message(error.message, true);
  } finally {
    operating = false;
    [...$('period-form').elements].forEach(element => { element.disabled = false; });
    renderPortal();
  }
});

$('download').addEventListener('click', () => {
  if (!diagnostic) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(diagnostic, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'visualtime-formulario.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$('send').addEventListener('click', async () => {
  if (!plan || !portal.canSend || sending || operating) return;
  const dates = selectedDates();
  if (!dates.length) return;
  if (!window.confirm(`Se intentarán ${dates.length * 2} fichajes en ${dates.length} días, de ${plan.entry} a ${plan.exit}.\n\nSe volverán a intentar todos, aunque consten enviados, rechazados o inciertos en el journal. Si uno falla o ya existe, se registrará y se pasará al siguiente sin repetirlo en este lote.\n\nUn resultado incierto anterior podría haberse guardado: revisa el portal. El journal no bloqueará el nuevo intento que confirmas ahora.\n\nConfirma que son las horas realmente trabajadas y que has excluido días no trabajados. Motivo y Observaciones no se tocarán.\n\nLas solicitudes requieren validación del supervisor. ¿Enviar?`)) return;
  sending = true;
  $('generate').disabled = true;
  [...$('period-form').elements].forEach(element => { element.disabled = true; });
  renderPortal();
  message(`Enviando ${dates.length * 2} solicitudes. No manipules Edge, no pulses su disquete y no cierres esta aplicación. El resultado se actualizará debajo.`);
  const progress = setInterval(async () => {
    try {
      const response = await fetch('/api/state');
      if (!response.ok) throw new Error('No se puede consultar el progreso.');
      const state = await response.json();
      if (state.batch?.results.length) renderResults(state.batch.results);
    } catch (error) {
      message(`No se puede consultar el progreso: ${error.message}. No reintentes ni cierres la aplicación; espera el resultado.`, true);
    }
  }, 1000);
  try {
    const response = await api('/api/send', { planId: plan.id, selectedDates: dates, confirmed: true });
    renderResults(response.results);
    message('Proceso detenido o finalizado. Consulta el resultado de cada solicitud antes de actuar.');
  } catch (error) {
    if (error.results) renderResults(error.results);
    message(`${error.message}\nSi se ha perdido la conexión durante el envío, no reintentes: el resultado puede ser incierto. Revisa el portal y conserva el registro local.`, true);
  } finally {
    clearInterval(progress);
    sending = false;
    [...$('period-form').elements].forEach(element => { element.disabled = false; });
    try {
      const response = await fetch('/api/state');
      if (!response.ok) throw new Error('No se puede consultar el estado final.');
      const state = await response.json();
      portal = state.portal;
    } catch (error) {
      portal.canSend = false;
      message(`${error.message} Revisa los resultados antes de reintentar.`, true);
    }
    renderPortal();
  }
});

async function init() {
  $('generate').disabled = true;
  $('open-portal').disabled = true;
  try {
    const response = await fetch('/api/state');
    if (!response.ok) throw new Error('No se puede conectar con la aplicación local.');
    const state = await response.json();
    token = state.token;
    portal = state.portal;
    if (state.batch?.results.length) renderResults(state.batch.results);
    renderPortal();
    $('generate').disabled = false;
    $('open-portal').disabled = false;
    if (state.batch?.busy) {
      sending = true;
      [...$('period-form').elements].forEach(element => { element.disabled = true; });
      renderPortal();
      message('Hay un envío en curso. No se iniciará otro; espera el resultado sin manipular Edge.');
      const progress = setInterval(async () => {
        try {
          const response = await fetch('/api/state');
          if (!response.ok) throw new Error('No se puede consultar el progreso.');
          const current = await response.json();
          portal = current.portal;
          renderResults(current.batch.results);
          if (!current.batch.busy) {
            clearInterval(progress);
            sending = false;
            [...$('period-form').elements].forEach(element => { element.disabled = false; });
            message('Proceso detenido o finalizado. Revisa el resultado por solicitud antes de actuar.');
          }
          renderPortal();
        } catch (error) {
          message(`${error.message} No reintentes: el envío puede seguir activo.`, true);
        }
      }, 1000);
    }
  } catch (error) {
    message(`${error.message} Comprueba la consola de VisualTimeSetter y recarga la página.`, true);
  }
}
init();
