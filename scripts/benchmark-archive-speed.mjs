// Bounded, real production timing. Fresh runs contact the public media source.
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.argv[2] || 'http://127.0.0.1:3000';
const usernames = process.argv.slice(3);
if (!usernames.length) throw Error('Provide a saved public username, followed by any additional accounts to refresh.');
const report = { at: new Date().toISOString(), base, savedMs: [], fresh: [] };
const post = async (username, refresh = false) => {
  const response = await fetch(`${base}/api/media-archive/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, refresh }), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Error(`HTTP ${response.status}`);
  return response.json();
};
for (let i = 0; i < 5; i++) {
  const start = performance.now(); const view = await post(usernames[0]);
  report.savedMs.push(Math.round(performance.now() - start));
  if (view.source !== 'saved' || !view.result.items.length) throw Error('The first username must have a saved collection.');
}
for (const username of usernames) {
  const start = performance.now(), initial = await post(username, true);
  const row = { username, jobId: initial.job.id, progress: [] }; report.fresh.push(row);
  let finished = false;
  const controller = new AbortController(), deadline = setTimeout(() => controller.abort(), 120000);
  try {
    while (!finished && !controller.signal.aborted) {
      const response = await fetch(`${base}/api/media-archive/jobs/${row.jobId}/events`, { signal: controller.signal });
      if (!response.ok) throw Error(`Stream HTTP ${response.status}`);
      const reader = response.body.getReader(), decoder = new TextDecoder(); let buffered = '';
      try {
        while (!finished) {
          const next = await reader.read(); if (next.done) break;
          buffered += decoder.decode(next.value, { stream: true });
          let end;
          while ((end = buffered.indexOf('\n\n')) !== -1) {
            const event = buffered.slice(0, end); buffered = buffered.slice(end + 2);
            if (!event.startsWith('data: ')) continue;
            const view = JSON.parse(event.slice(6)), elapsedMs = Math.round(performance.now() - start);
            if (view.job.postsScanned > 0 && row.firstPageMs === undefined) row.firstPageMs = elapsedMs;
            const progress = { elapsedMs, status: view.job.status, posts: view.job.postsScanned, media: view.result.items.length, batches: view.job.batchesRead };
            row.progress.push(progress); console.log(JSON.stringify({ username, ...progress }));
            if (!['queued', 'running'].includes(view.job.status)) {
              Object.assign(row, { completeMs: elapsedMs, status: view.job.status, media: view.result.items.length,
                videos: view.result.items.filter(i => i.media.type === 'video').length, uniqueIds: new Set(view.result.items.map(i => i.id)).size });
              finished = true;
            }
          }
        }
      } finally { await reader.cancel().catch(() => {}); }
    }
  } catch (error) { row.error = error.message; }
  finally { clearTimeout(deadline); controller.abort(); }
  if (row.status === 'waiting' || row.error) break;
}
const file = `.data/research/speed-after-${report.at.replace(/[:.]/g, '-')}.json`;
await mkdir('.data/research', { recursive: true });
await writeFile(file, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ savedMs: report.savedMs, fresh: report.fresh.map(row => ({ ...row, progress: undefined })), file }));
