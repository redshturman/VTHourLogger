import { mkdir, readFile, open, rename } from 'node:fs/promises';
import path from 'node:path';

export class Journal {
  constructor(filename) {
    this.filename = filename;
    this.records = {};
  }

  async load() {
    let text;
    try {
      text = await readFile(this.filename, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return;
    }
    const data = JSON.parse(text);
    if (data.version !== 1 || !data.records || typeof data.records !== 'object' || Array.isArray(data.records)) {
      throw new Error('The local journal is damaged. Submissions cannot continue.');
    }
    this.records = data.records;
  }

  get(key) {
    return this.records[key];
  }

  activity() {
    const records = Object.values(this.records).filter(record =>
      typeof record.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(record.date));
    if (!records.length) return null;
    const latestDate = records.map(record => record.date).sort().at(-1);
    const latest = records.filter(record => record.date === latestDate);
    const count = status => latest.filter(record => record.status === status).length;
    return {
      latestDate,
      latestSubmittedDate: records.filter(record => record.status === 'submitted')
        .map(record => record.date).sort().at(-1) || null,
      submitted: count('submitted'),
      existing: count('existing'),
      failed: count('failed'),
      uncertain: count('uncertain'),
      notAttempted: count('not_attempted')
    };
  }

  async set(key, record) {
    const records = { ...this.records, [key]: { ...record, updatedAt: new Date().toISOString() } };
    await mkdir(path.dirname(this.filename), { recursive: true });
    const temp = `${this.filename}.tmp`;
    const file = await open(temp, 'w', 0o600);
    try {
      await file.writeFile(JSON.stringify({ version: 1, records }, null, 2), 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temp, this.filename);
    this.records = records;
  }
}
