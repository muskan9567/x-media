import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const base = process.env.X_MEDIA_TEST_URL || 'http://127.0.0.1:3000';
const directory = '.impeccable/review/posts-free';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(25_000);
const checks = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
const pass = message => { checks.push(message); console.log('PASS', message); };
const get = async path => { const response = await fetch(base + path); assert.equal(response.status, 200); return response.json(); };
async function screenshot(name, width) {
  await page.setViewportSize({ width, height: width < 700 ? 844 : 1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}px`);
  const controls = [page.getByRole('link', { name: 'X Media home', exact: true }), page.getByRole('navigation', { name: 'Media source', exact: true }), page.getByRole('link', { name: 'Dashboard', exact: true }), page.getByRole('button', { name: 'Toggle color theme', exact: true })];
  const bounds = await Promise.all(controls.map(control => control.boundingBox()));
  for (let i = 0; i < bounds.length; i++) {
    const a = bounds[i]; assert.ok(a && a.x >= 0 && a.x + a.width <= width + 1, `Clipped header at ${width}px`);
    for (let j = i + 1; j < bounds.length; j++) {
      const b = bounds[j];
      assert.ok(!b || Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) <= 1 || Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) <= 1, `Overlapping header at ${width}px`);
    }
  }
  await page.screenshot({ path: `${directory}/${name}.png`, fullPage: false });
}
try {
  assert.deepEqual(await get('/api/posts/connection'), { configured: true, source: 'timeline', free: true });
  let attempts = 0;
  await page.route('**/api/posts', route => route.request().method() === 'GET' && attempts++ === 0 ? route.abort('failed') : route.continue());
  await page.goto(`${base}/posts?user=x`);
  await page.getByRole('alert').filter({ hasText: 'Cannot reach X Media' }).waitFor();
  await page.locator('article').first().waitFor();
  await page.getByRole('alert').filter({ hasText: 'Cannot reach X Media' }).waitFor({ state: 'hidden' });
  assert.ok(attempts >= 2); await page.unroute('**/api/posts');
  pass('Initial server failure reconnects automatically and restores saved tweets');
  assert.equal(await page.locator('input[type=password]').count(), 0);
  assert.ok(await page.getByText('Free to use. No API key needed.', { exact: true }).isVisible());
  pass('Free collection is active with no API-token form');

  const before = await get('/api/posts?username=x');
  const originalIds = before.posts.map(post => post.id).sort();
  assert.ok(originalIds.length > 0, 'The existing X collection is required for this smoke test');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export JSON', exact: true }).click();
  const download = await downloadEvent;
  const archive = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(archive.format, 'x-media-posts');
  assert.deepEqual(archive.posts.map(post => post.id).sort(), originalIds);
  assert.equal(archive.cursor, undefined); assert.equal(archive.runId, undefined);
  pass('Export downloads the entire real saved collection without job metadata');

  await page.getByRole('button', { name: 'Import archive', exact: true }).click();
  await page.getByLabel('Archive data files').setInputFiles({ name: 'bad.js', mimeType: 'text/javascript', buffer: Buffer.from('window.YTD.tweets.part0 = []; throw Error("must never execute")') });
  await page.getByRole('button', { name: 'Import selected files', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'could not read archive data' }).waitFor();
  assert.deepEqual((await get('/api/posts?username=x')).posts.map(post => post.id).sort(), originalIds);
  pass('Invalid executable upload is rejected without changing saved tweets');

  await page.getByLabel('Archive data files').setInputFiles({ name: 'x-tweets.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(archive)) });
  await page.getByRole('button', { name: 'Import selected files', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Archive saved for @x.' }).waitFor();
  assert.deepEqual((await get('/api/posts?username=x')).posts.map(post => post.id).sort(), originalIds);
  pass('Real JSON archive import roundtrips without duplicates or lost posts');

  const nativeAccount = [{ account: { accountId: archive.profile.id, username: archive.profile.username, accountDisplayName: archive.profile.name, email: 'must-be-stripped@example.test' } }];
  const nativeTweets = archive.posts.slice(0, 2).map(post => ({ tweet: { id_str: post.id, full_text: post.text, created_at: post.createdAt, favorite_count: String(post.likes ?? 0), retweet_count: String(post.reposts ?? 0) } }));
  let submitted;
  const watch = request => { if (request.url() === `${base}/api/posts/import`) submitted = request.postData(); };
  page.on('request', watch);
  await page.getByLabel('Archive data files').setInputFiles([
    { name: 'account.js', mimeType: 'text/javascript', buffer: Buffer.from(`window.YTD.account.part0 = ${JSON.stringify(nativeAccount)};`) },
    { name: 'tweets.js', mimeType: 'text/javascript', buffer: Buffer.from(`window.YTD.tweets.part0 = ${JSON.stringify(nativeTweets)};`) },
  ]);
  await page.getByRole('button', { name: 'Import selected files', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Archive saved for @x.' }).waitFor();
  page.off('request', watch);
  assert.ok(submitted && !submitted.includes('must-be-stripped'));
  assert.deepEqual((await get('/api/posts?username=x')).posts, before.posts);
  pass('Native account.js and tweets.js import strips private fields and preserves current metrics');

  await screenshot('desktop-import', 1440);
  await screenshot('mobile-import', 390);
  await screenshot('mobile-320-import', 320);
  await page.getByRole('button', { name: 'Close import', exact: true }).click();
  await page.getByRole('button', { name: 'Toggle color theme', exact: true }).click();
  await screenshot('alternate-theme-desktop', 1440);
  pass('Desktop and narrow mobile layouts keep navigation, upload, and actions visible');

  await page.route('**/api/posts?username=x', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary connection test' }) }));
  await page.getByRole('alert').filter({ hasText: 'Temporary connection test' }).waitFor();
  assert.ok(await page.locator('article').count());
  await page.unroute('**/api/posts?username=x');
  await page.getByRole('alert').filter({ hasText: 'Temporary connection test' }).waitFor({ state: 'hidden' });
  pass('Polling outage retains displayed tweets and recovers automatically');
  await page.reload(); await page.locator('article').first().waitFor();
  assert.deepEqual((await get('/api/posts?username=x')).posts.map(post => post.id).sort(), originalIds);
  assert.deepEqual(errors, []);
  pass('Saved collection survives reload with no browser errors');
  await writeFile(`${directory}/results.json`, JSON.stringify({ checks, errors, liveAccount: 'x', syntheticPostsSaved: 0 }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${directory}/failure.png`, fullPage: true }).catch(() => {});
  console.error((await page.locator('body').innerText()).slice(0, 3000));
  throw error;
} finally { await browser.close(); }
