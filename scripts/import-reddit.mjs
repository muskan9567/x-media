import { DatabaseSync, backup } from 'node:sqlite';
import { cp, mkdir, access, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tables = ['posts', 'reviews', 'feedback', 'seen', 'batches', 'jobs', 'analyses', 'assets', 'spending'];
export async function importReddit(source, destination) {
  source = path.resolve(source); destination = path.resolve(destination);
  if (source === destination || destination.startsWith(source + path.sep)) throw Error('Choose a separate destination for the merged collection.');
  try { await access(destination); throw Error('Destination already exists. Existing Reddit data will not be overwritten.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const staging = destination + '.import-' + Date.now();
  let original, copied;
  try {
    original = new DatabaseSync(path.join(source, 'runtime', 'finder.sqlite'), { readOnly: true });
    await mkdir(path.join(staging, 'runtime'), { recursive: true });
    // SQLite's backup API includes committed WAL data and produces a consistent snapshot.
    await backup(original, path.join(staging, 'runtime', 'finder.sqlite'));
    copied = new DatabaseSync(path.join(staging, 'runtime', 'finder.sqlite'), { readOnly: true });
    if (copied.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw Error('Imported database failed its integrity check.');
    const counts = Object.fromEntries(tables.map(table => [table, copied.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n]));
    const files = ['runtime/assets', 'runtime/images', 'runtime/discord-delivery.json', 'memes'];
    for (const file of files) {
      try { await cp(path.join(source, file), path.join(staging, file), { recursive: true, errorOnExist: true }); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    let originals = 0;
    for (const { hash } of copied.prepare('SELECT DISTINCT hash FROM assets').all()) {
      if (!/^[a-f0-9]{64}$/i.test(hash)) throw Error('Invalid image hash in the existing collection.');
      try { await access(path.join(staging, 'runtime', 'assets', hash + '.bin')); originals++; }
      catch { /* Evicted expendable cache entries retain metadata and can be fetched again. */ }
    }
    const report = { importedAt: new Date().toISOString(), source, destination, counts, cachedOriginals: originals };
    await writeFile(path.join(staging, 'import-report.json'), JSON.stringify(report, null, 2) + '\n');
    copied.close(); copied = null; original.close(); original = null;
    await rename(staging, destination);
    return report;
  } catch (error) {
    copied?.close(); original?.close();
    if (path.dirname(staging) === path.dirname(destination) && path.basename(staging).startsWith(path.basename(destination) + '.import-')) await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw Error('Usage: node scripts/import-reddit.mjs <old-project> [destination]');
  console.log(JSON.stringify(await importReddit(process.argv[2], process.argv[3] || path.join(process.cwd(), '.data', 'reddit')), null, 2));
}
