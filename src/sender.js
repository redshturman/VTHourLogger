import { AppError, punchKey } from './calendar.js';

export class BatchSender {
  constructor(journal, portal) {
    this.journal = journal;
    this.portal = portal;
    this.busy = false;
    this.results = [];
  }

  async send(punches, confirmed) {
    if (confirmed !== true) throw new AppError('You must explicitly confirm submission.');
    if (this.busy) throw new AppError('A batch is already running.', 409);
    const status = this.portal.status();
    if (!status.canSend || !status.accountId) {
      throw new AppError('Submission blocked: verify the authenticated portal form and test filling it first. No requests have been attempted.', 409);
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
          result.message = `Unable to save the local journal: ${error.message}. This request and the following ones have not been attempted.`;
          break;
        }
        try {
          result.status = 'sending';
          const receipt = await this.portal.submit(result, status.accountId);
          if (!receipt || receipt.confirmed !== true || !receipt.reference) {
            throw new Error('The portal did not provide a verifiable confirmation.');
          }
          await this.journal.set(key, {
            ...result, status: receipt.existing ? 'existing' : 'submitted',
            reference: receipt.reference, directPunch: receipt.directPunch === true,
            ...(receipt.existing ? { portalStatus: receipt.portalStatus } : {})
          });
          result.status = receipt.existing ? 'skipped' : 'submitted';
          result.message = receipt.existing ? `Skipped, not created again: ${receipt.reference}` : receipt.directPunch
            ? `The portal recorded the punch directly, without an approval request: ${receipt.reference}. Batch stopped for review.`
            : `Request created: ${receipt.reference}. Awaiting supervisor approval.`;
          if (receipt.stop) break;
        } catch (error) {
          const outcome = ['not_attempted', 'failed'].includes(error.outcome) ? error.outcome : 'uncertain';
          result.status = 'uncertain';
          result.message = `Unable to confirm the outcome: ${error.message}. Check the portal. Continuing with the next item without retrying this attempt.`;
          try {
            await this.journal.set(key, {
              ...result, status: outcome, message: error.message,
              ...(typeof error.portalStatus === 'number' ? { portalStatus: error.portalStatus } : {})
            });
            result.status = outcome;
            if (outcome !== 'uncertain') {
              result.message = outcome === 'not_attempted'
                ? `This request was not submitted: ${error.message}. Continuing with the next item.`
                : `Request rejected by the portal: ${error.message}. Continuing with the next item.`;
            }
          } catch (journalError) {
            result.message += ` Unable to persist the result: ${journalError.message}. Batch stopped because the journal could not be saved.`;
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
