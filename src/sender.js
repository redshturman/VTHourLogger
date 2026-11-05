import { AppError, punchKey } from './calendar.js';

export class BatchSender {
  constructor(journal, portal) {
    this.journal = journal;
    this.portal = portal;
    this.busy = false;
    this.results = [];
  }

  async send(punches, confirmed) {
    if (confirmed !== true) throw new AppError('Debes confirmar explícitamente el envío.');
    if (this.busy) throw new AppError('Ya hay un envío en curso.', 409);
    const status = this.portal.status();
    if (!status.canSend || !status.accountId) {
      throw new AppError('Envío bloqueado: falta verificar el formulario y la confirmación de guardado del portal autenticado. No se ha intentado ninguna solicitud.', 409);
    }
    this.busy = true;
    const results = punches.map(punch => ({ ...punch, status: 'not_attempted' }));
    this.results = results;
    try {
      for (const result of results) {
        const key = punchKey(status.accountId, result);
        // El historial solo informa; cada lote confirmado intenta toda la selección una vez.
        try {
          await this.journal.set(key, { ...result, status: 'uncertain' });
        } catch (error) {
          result.message = `No se pudo guardar el registro local: ${error.message}. No se ha intentado esta solicitud ni las siguientes.`;
          break;
        }
        try {
          result.status = 'sending';
          const receipt = await this.portal.submit(result, status.accountId);
          if (!receipt || receipt.confirmed !== true || !receipt.reference) {
            throw new Error('El portal no ha proporcionado una confirmación verificable.');
          }
          await this.journal.set(key, {
            ...result, status: receipt.existing ? 'existing' : 'submitted',
            reference: receipt.reference, directPunch: receipt.directPunch === true,
            ...(receipt.existing ? { portalStatus: receipt.portalStatus } : {})
          });
          result.status = receipt.existing ? 'skipped' : 'submitted';
          result.message = receipt.existing ? `Omitida, no creada de nuevo: ${receipt.reference}` : receipt.directPunch
            ? `El portal ha registrado el fichaje directamente, sin solicitud de aprobación: ${receipt.reference}. Lote detenido para revisión.`
            : `Solicitud creada: ${receipt.reference}. Pendiente de validación del supervisor.`;
          if (receipt.stop) break;
        } catch (error) {
          const outcome = ['not_attempted', 'failed'].includes(error.outcome) ? error.outcome : 'uncertain';
          result.status = 'uncertain';
          result.message = `No se puede confirmar el resultado: ${error.message}. Revisa el portal. Se continúa con el siguiente sin repetir este intento.`;
          try {
            await this.journal.set(key, {
              ...result, status: outcome, message: error.message,
              ...(typeof error.portalStatus === 'number' ? { portalStatus: error.portalStatus } : {})
            });
            result.status = outcome;
            if (outcome !== 'uncertain') {
              result.message = outcome === 'not_attempted'
                ? `No se ha enviado esta solicitud: ${error.message}. Se continúa con la siguiente.`
                : `Solicitud rechazada por el portal: ${error.message}. Se continúa con la siguiente.`;
            }
          } catch (journalError) {
            result.message += ` No se pudo persistir el resultado: ${journalError.message}. Se detiene el lote por el fallo de registro.`;
            break;
          }
        }
      }
      return results;
    } finally {
      this.busy = false;
    }
  }
}
