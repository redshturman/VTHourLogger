import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Journal } from '../src/journal.js';

test('local activity uses attendance dates, preserves uncertain outcomes and survives restart', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vt-activity-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const journal = new Journal(path.join(dir, 'journal.json'));
  await journal.load();
  assert.equal(journal.activity(), null);
  await journal.set('entry', { date: '2026-10-30', status: 'submitted' });
  await journal.set('later-entry', { date: '2026-11-03', status: 'submitted' });
  await journal.set('later-exit', { date: '2026-11-03', status: 'uncertain' });
  await journal.set('old-created-last', { date: '2026-09-01', status: 'submitted' });
  const expected = {
    latestDate: '2026-11-03', latestSubmittedDate: '2026-11-03',
    submitted: 1, existing: 0, failed: 0, uncertain: 1, notAttempted: 0
  };
  assert.deepEqual(journal.activity(), expected);
  const reloaded = new Journal(journal.filename);
  await reloaded.load();
  assert.deepEqual(reloaded.activity(), expected);
  await reloaded.set('future-failure', { date: '2026-11-04', status: 'failed' });
  assert.equal(reloaded.activity().latestDate, '2026-11-04');
  assert.equal(reloaded.activity().latestSubmittedDate, '2026-11-03');
  assert.equal(reloaded.activity().failed, 1);
});
