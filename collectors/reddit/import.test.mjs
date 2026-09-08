import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from './store.mjs';
import { importReddit } from '../../scripts/import-reddit.mjs';

test('migration includes committed WAL, preserves decisions and images, and never overwrites a collection', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'x-media-import-'));
  const source = path.join(root, 'source'), target = path.join(root, 'target');
  const store = new Store(source); let imported;
  try {
    store.putPost({ id: 'abc123', title: 'A saved meme' });
    const eventId = store.feedback('abc123', 'favorite'); store.markSeen('abc123'); store.saveBatch(['abc123']);
    const hash = 'a'.repeat(64); store.asset('https://i.redd.it/test.png', { hash, type: 'image/png', bytes: 5 });
    await mkdir(path.join(source, 'runtime', 'assets'), { recursive: true });
    await writeFile(path.join(source, 'runtime', 'assets', hash + '.bin'), 'image');
    const result = await importReddit(source, target);
    assert.equal(result.counts.posts, 1); assert.equal(result.counts.feedback, 1); assert.equal(result.cachedOriginals, 1);
    imported = new Store(target); assert.equal(imported.review('abc123').favorite, 1); assert.ok(imported.seen().has('abc123'));
    assert.deepEqual(imported.batch().ids, ['abc123']);
    imported.undo(eventId); assert.equal(imported.review('abc123'), null); assert.equal(store.review('abc123').favorite, 1);
    assert.equal(await readFile(path.join(target, 'runtime', 'assets', hash + '.bin'), 'utf8'), 'image');
    await assert.rejects(importReddit(source, target), /already exists/);
  } finally {
    imported?.close(); store.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep + 'x-media-import-'));
    await rm(root, { recursive: true, force: true });
  }
});
