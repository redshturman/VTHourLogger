const $ = id => document.getElementById(id);
let token;
let plan = null;
let portal = { canSend: false, browserOpen: false };
let diagnostic = null;
let sending = false;
let operating = false;

function setupPickers() {
  for (const id of ['start', 'end', 'entry', 'lunchOut', 'lunchIn', 'exit']) {
    const input = $(id);
    const isDate = id === 'start' || id === 'end';
    const wrapper = document.createElement('div');
    wrapper.className = 'picker-field';
    input.replaceWith(wrapper);
    wrapper.append(input);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'secondary picker-toggle';
    toggle.textContent = isDate ? 'Calendar' : 'Time';
    toggle.setAttribute('aria-label', `Choose ${input.closest('label').firstChild.textContent.trim().toLowerCase()}`);
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
      title.textContent = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(month);
      const move = offset => {
        month.setMonth(month.getMonth() + offset);
        renderCalendar();
      };
      header.append(button('<', () => move(-1), 'Previous month'), title, button('>', () => move(1), 'Next month'));
      const grid = document.createElement('div');
      grid.className = 'calendar-grid';
      for (const day of ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']) {
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
          label.textContent = index === 0 ? 'Hour (24 h)' : 'Minute';
          const select = document.createElement('select');
          select.setAttribute('aria-label', label.textContent);
          for (let value = 0; value < count; value++) select.add(new Option(pad(value), pad(value)));
          select.value = values ? values[index + 1] : '00';
          label.append(select);
          popup.append(label);
          return select;
        });
        popup.append(button('Choose', () => choose(`${selects[0].value}:${selects[1].value}`)));
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

function updateMode() {
  const lunch = $('mode').value === '4';
  document.querySelectorAll('[data-lunch]').forEach(label => {
    label.hidden = !lunch;
    label.querySelector('input').required = lunch;
    if (!lunch) label.querySelectorAll('.picker-popup').forEach(popup => { popup.hidden = true; });
  });
}

$('mode').addEventListener('change', updateMode);
updateMode();

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
    const error = new Error(body.error || 'The operation could not be completed.');
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
  $('summary').textContent = `${count} days · ${count * Number(plan.mode)} requests`;
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
  return new Intl.DateTimeFormat('en-GB', {
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
  const lunch = plan.mode === '4';
  document.querySelectorAll('[data-lunch-column]').forEach(header => { header.hidden = !lunch; });
  $('requests-per-day').textContent = `${plan.mode} requests per day`;
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
    checkbox.setAttribute('aria-label', `Include ${formatDate(date)}`);
    checkbox.addEventListener('change', updateSelection);
    cell(row, '').append(checkbox);
    cell(row, `${formatDate(date)}${weekend ? ' · Weekend' : ''}`);
    cell(row, weekend ? '—' : plan.entry);
    if (lunch) {
      cell(row, weekend ? '—' : plan.lunchOut);
      cell(row, weekend ? '—' : plan.lunchIn);
    }
    cell(row, weekend ? '—' : plan.exit);
    rows.append(row);
  }
  $('days').append(rows);
  $('preview').hidden = false;
  $('empty').hidden = plan.days.length > 0;
  updateSelection();
}

function renderPortal() {
  $('login-message').textContent = portal.loginMessage || '';
  $('inspect').disabled = !portal.browserOpen || sending || operating;
  $('connect').disabled = !portal.browserOpen || sending || operating;
  $('open-portal').disabled = sending || operating;
  $('connection-badge').textContent = portal.canSend ? 'Ready' : portal.canPrepare ? 'Connected' : 'Pending';
  $('integration-title').textContent = sending ? 'Submitting requests · do not close the app'
    : portal.canSend ? 'Test fill complete · awaiting your confirmation'
      : portal.canPrepare ? 'Connected · test filling without saving' : 'Connect the form to get started';
  $('send-help').textContent = portal.message || 'Connect the form to get started.';
  if (plan) updateSelection();
}

function renderResults(results) {
  $('results').replaceChildren();
  const names = { sending: 'Submitting…', submitted: 'Submitted', skipped: 'Skipped (portal reports it exists)', failed: 'Rejected', uncertain: 'Uncertain · check portal', not_attempted: 'Not attempted' };
  for (const result of results) {
    const row = document.createElement('tr');
    cell(row, `${formatDetail(result.date)} ${result.time}`);
    cell(row, result.direction === 'Entrada' ? 'Clock in' : result.direction === 'Salida' ? 'Clock out' : result.direction);
    cell(row, names[result.status] || result.status);
    cell(row, formatDetail(result.message || 'Submission has not been attempted.'));
    $('results').append(row);
  }
  const count = status => results.filter(result => result.status === status).length;
  $('results-summary').textContent = `${count('submitted')} submitted · ${count('skipped')} skipped · ${count('sending')} in progress · ${count('failed')} rejected · ${count('uncertain')} uncertain · ${count('not_attempted')} not attempted. Submitted does not mean approved.`;
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
  message('Opening Edge. Sign in in the portal window, not in this app.');
  try {
    portal = await api('/api/portal/open');
    renderPortal();
    message('In Edge, open Request → Missing punch (Solicitar → Fichaje no realizado in Spanish), then return here. Do not click Save.');
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
    message('Form structure read without changing it. To fill in working hours, click Connect form, then Test fill without saving.');
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
  $('connect').textContent = 'Checking form…';
  message('Checking the account and form controls. No fields will be changed and nothing will be saved.');
  try {
    portal = await api('/api/portal/verify');
    message('Form connected without changes. Generate or review your date range, then click Test fill without saving.');
  } catch (error) {
    portal.canPrepare = false;
    portal.canSend = false;
    message(error.message, true);
  } finally {
    operating = false;
    $('connect').textContent = 'Connect form';
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
  message('Filling in the first selected clock-in in Edge. No requests will be saved.');
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
  link.download = 'visualtime-form.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$('send').addEventListener('click', async () => {
  if (!plan || !portal.canSend || sending || operating) return;
  const dates = selectedDates();
  if (!dates.length) return;
  const count = dates.length * Number(plan.mode);
  const schedule = `Clock in ${plan.entry}${plan.mode === '4' ? ` → Lunch clock out ${plan.lunchOut} → Lunch return ${plan.lunchIn}` : ''} → Clock out ${plan.exit}`;
  if (!window.confirm(`This will attempt ${count} punches across ${dates.length} days.\n${schedule}\n\nAll selected punches will be attempted again, even if the journal records them as submitted, rejected, or uncertain. Failures and existing punches will be recorded, then the batch will continue without retrying that item in this batch.\n\nA previous uncertain attempt may have been saved: check the portal. The journal will not block the new attempt you are confirming now.\n\nConfirm these are the hours you actually worked and that you have excluded days you did not work. Reason and Comments will not be changed.\n\nRequests require supervisor approval. Submit?`)) return;
  sending = true;
  $('generate').disabled = true;
  [...$('period-form').elements].forEach(element => { element.disabled = true; });
  renderPortal();
  message(`Submitting ${count} requests. Do not interact with Edge, click its Save button, or close this app. Results will update below.`);
  const progress = setInterval(async () => {
    try {
      const response = await fetch('/api/state');
      if (!response.ok) throw new Error('Unable to retrieve progress.');
      const state = await response.json();
      if (state.batch?.results.length) renderResults(state.batch.results);
    } catch (error) {
      message(`Unable to retrieve progress: ${error.message}. Do not retry or close the app; wait for the result.`, true);
    }
  }, 1000);
  try {
    const response = await api('/api/send', { planId: plan.id, selectedDates: dates, confirmed: true });
    renderResults(response.results);
    message('Batch stopped or completed. Review the result of each request before taking further action.');
  } catch (error) {
    if (error.results) renderResults(error.results);
    message(`${error.message}\nIf the connection was lost during submission, do not retry: the outcome may be uncertain. Check the portal and keep the local journal.`, true);
  } finally {
    clearInterval(progress);
    sending = false;
    [...$('period-form').elements].forEach(element => { element.disabled = false; });
    try {
      const response = await fetch('/api/state');
      if (!response.ok) throw new Error('Unable to retrieve the final status.');
      const state = await response.json();
      portal = state.portal;
    } catch (error) {
      portal.canSend = false;
      message(`${error.message} Review the results before retrying.`, true);
    }
    renderPortal();
  }
});

async function init() {
  $('generate').disabled = true;
  $('open-portal').disabled = true;
  try {
    const response = await fetch('/api/state');
    if (!response.ok) throw new Error('Unable to connect to the local app.');
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
      message('A batch is already running. No other batch will start; wait for the result without interacting with Edge.');
      const progress = setInterval(async () => {
        try {
          const response = await fetch('/api/state');
          if (!response.ok) throw new Error('Unable to retrieve progress.');
          const current = await response.json();
          portal = current.portal;
          renderResults(current.batch.results);
          if (!current.batch.busy) {
            clearInterval(progress);
            sending = false;
            [...$('period-form').elements].forEach(element => { element.disabled = false; });
            message('Batch stopped or completed. Review each request result before taking further action.');
          }
          renderPortal();
        } catch (error) {
          message(`${error.message} Do not retry: the batch may still be running.`, true);
        }
      }, 1000);
    }
  } catch (error) {
    message(`${error.message} Check the VisualTimeSetter console and reload the page.`, true);
  }
}
init();
