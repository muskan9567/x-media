// Optional live verification. Explicit refreshes use the app's single queue and cooldown.
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.argv[2] || 'http://127.0.0.1:3000';
const accounts = process.argv.slice(3);
if (!accounts.length) throw new Error('Provide one or more public usernames to verify.');
const report = { testedAt: new Date().toISOString(), base, runs: [] };
const file = `.data/research/live-${report.testedAt.replace(/[:.]/g, '-')}.json`;
await mkdir('.data/research', { recursive: true });
const save = () => writeFile(file, JSON.stringify(report, null, 2));
const request = async (path, body) => {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
};
for (const username of accounts) {
  const started = Date.now();
  let view = await request('/api/media-archive/jobs', { username, refresh: true });
  const row = { username, jobId: view.job.id, before: view.result.items.length, progress: [] };
  report.runs.push(row);
  let previous;
  for (;;) {
    const progress = { status: view.job.status, postsScanned: view.job.postsScanned, batchesRead: view.job.batchesRead, media: view.result.items.length };
    if (JSON.stringify(progress) !== previous) {
      previous = JSON.stringify(progress); row.progress.push({ elapsedMs: Date.now() - started, ...progress });
      console.log(JSON.stringify({ username, ...progress })); await save();
    }
    if (!['queued', 'running'].includes(view.job.status)) break;
    if (Date.now() - started > 300000) {
      view = await request(`/api/media-archive/jobs/${row.jobId}`, { action: 'cancel' }); break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
    view = await request(`/api/media-archive/jobs/${row.jobId}`);
  }
  row.result = { status: view.job.status, source: view.source, message: view.job.message, retryAt: view.job.retryAt,
    postsScanned: view.job.postsScanned, newItems: view.job.newItems, media: view.result.items.length,
    videos: view.result.items.filter((i) => i.media.type === 'video').length,
    playableVideos: view.result.items.filter((i) => i.media.type === 'video' && i.media.variants.length).length,
    ids: view.result.items.map((i) => i.id) };
  await save(); console.log(JSON.stringify({ username, ...row.result, ids: undefined }));
  if (view.job.status === 'waiting') break;
}
console.log(`Saved verification: ${file}`);
