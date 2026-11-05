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
