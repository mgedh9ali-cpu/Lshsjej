import { DatabaseSync, backup } from 'node:sqlite';
import { chmodSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const destination = process.argv[2];
if (!destination) throw Error('Usage: node scripts/backup.mjs path/to/new-backup.sqlite');
const target = resolve(destination);
const source = resolve(process.env.SCHOOL_DB || 'data/school.sqlite');
if (source === target) throw Error('Backup path must differ from source');
mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
const staging = target + '.' + randomUUID() + '.tmp';
const live = new DatabaseSync(source, { readOnly: true });
process.umask(0o077);
try {
  await backup(live, staging);
  const copy = new DatabaseSync(staging, { readOnly: true });
  try {
    if (copy.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw Error('Integrity check failed');
  } finally { copy.close(); }
  chmodSync(staging, 0o600);
  renameSync(staging, target);
  console.log('Backup verified:', target);
} finally {
  live.close();
  rmSync(staging, { force: true });
}
