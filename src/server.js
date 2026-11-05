import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { AppError, createPlan, selectPunches } from './calendar.js';
import { Journal } from './journal.js';
import { BatchSender } from './sender.js';
import { Portal } from './portal.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']]
]);

async function bodyOf(request) {
  let text = '';
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 65536) throw new AppError('La solicitud es demasiado grande.', 413);
    text += chunk.toString('utf8');
  }
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body');
    return body;
  } catch {
    throw new AppError('La solicitud debe contener un objeto JSON válido.');
  }
}

export async function createApp({ journalPath = path.join(root, 'data', 'journal.json'), portal = new Portal() } = {}) {
  const journal = new Journal(journalPath);
  await journal.load();
  const sender = new BatchSender(journal, portal);
  const token = randomBytes(32).toString('hex');
  let plan = null;
  let closing = false;
  const server = http.createServer(async (request, response) => {
    const host = `127.0.0.1:${server.address().port}`;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const json = (status, data) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(data));
    };
    try {
      if (request.headers.host !== host) throw new AppError('Host local no permitido.', 403);
      if (closing) throw new AppError('La aplicación se está cerrando.', 503);
      if (request.headers.origin && request.headers.origin !== `http://${host}`) {
        throw new AppError('Origen no permitido.', 403);
      }
      if (request.url === '/api/state' && request.method === 'GET') {
        return json(200, { token, portal: portal.status(), batch: { busy: sender.busy, results: sender.results } });
      }
      if (request.url.startsWith('/api/')) {
        if (request.method !== 'POST') throw new AppError('Método no permitido.', 405);
        if (request.headers['x-visualtime-token'] !== token) throw new AppError('Sesión local no válida. Recarga la página.', 403);
        if (!request.headers['content-type']?.startsWith('application/json')) {
          throw new AppError('Se requiere Content-Type application/json.', 415);
        }
        const body = await bodyOf(request);
        switch (request.url) {
          case '/api/preview':
            plan = createPlan(body);
            return json(200, plan);
          case '/api/portal/open':
            return json(200, await portal.open());
          case '/api/portal/inspect':
            return json(200, await portal.inspect());
          case '/api/portal/verify':
            if (sender.busy) throw new AppError('Ya hay un envío en curso.', 409);
            return json(200, await portal.verify());
          case '/api/portal/prepare': {
            if (!plan || plan.id !== body.planId) throw new AppError('La vista previa ha caducado. Genérala de nuevo.', 409);
            if (sender.busy) throw new AppError('Ya hay un envío en curso.', 409);
            const punches = selectPunches(plan, body.selectedDates);
            return json(200, await portal.prepare(punches[0]));
          }
          case '/api/send': {
            if (!plan || plan.id !== body.planId) throw new AppError('La vista previa ha caducado. Genérala de nuevo.', 409);
            const punches = selectPunches(plan, body.selectedDates);
            if (body.confirmed !== true) throw new AppError('Falta la confirmación explícita de envío.');
            try {
              return json(200, { results: await sender.send(punches, body.confirmed) });
            } catch (error) {
              if (!(error instanceof AppError)) throw error;
              return json(error.status, {
                error: error.message,
                results: punches.map(punch => ({ ...punch, status: 'not_attempted' }))
              });
            }
          }
          default:
            throw new AppError('Ruta no encontrada.', 404);
        }
      }
      const asset = assets.get(request.url);
      if (!asset || request.method !== 'GET') throw new AppError('Ruta no encontrada.', 404);
      const content = await readFile(path.join(root, 'public', asset[0]));
      response.writeHead(200, { 'Content-Type': asset[1] });
      response.end(content);
    } catch (error) {
      if (!(error instanceof AppError)) console.error('Error de la aplicación:', error);
      json(error instanceof AppError ? error.status : 500, {
        error: error instanceof AppError ? error.message : 'Error interno. Consulta la consola; no reintentes un envío sin revisar el portal.'
      });
    }
  });
  return {
    server,
    async close() {
      closing = true;
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await portal.close();
    }
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const app = await createApp();
    app.server.on('error', error => {
      console.error(`No se puede iniciar VisualTimeSetter: ${error.message}`);
      process.exitCode = 1;
    });
    app.server.listen(4317, '127.0.0.1', () => {
      const url = 'http://127.0.0.1:4317';
      console.log(`VisualTimeSetter: ${url}\nSolo acceso local. Cierra con Ctrl+C. Conecta el formulario y prueba la carga sin guardar antes de confirmar el envío.`);
      if (process.env.VISUALTIME_OPEN === '1') {
        const browser = spawn('explorer.exe', [url], { stdio: 'ignore' });
        browser.on('error', error => console.error(`Abre ${url} en tu navegador. ${error.message}`));
      }
    });
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      try {
        await app.close();
      } catch (error) {
        console.error('Error al cerrar:', error);
        process.exitCode = 1;
      }
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  } catch (error) {
    console.error(`No se puede iniciar VisualTimeSetter: ${error.message}`);
    process.exitCode = 1;
  }
}
