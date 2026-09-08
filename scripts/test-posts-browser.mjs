import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const base = process.env.X_MEDIA_TEST_URL || 'http://127.0.0.1:3000';
const directory = '.impeccable/review/posts';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'], reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(20_000); page.setDefaultNavigationTimeout(60_000);
const errors = [], checks = [], layoutErrors = [];
page.on('pageerror', error => errors.push(error.message));
const pass = message => { checks.push(message); console.log('PASS', message); };
const api = async username => { const response = await fetch(`${base}/api/posts?username=${username}`); assert.equal(response.status, 200); return response.json(); };
const rows = () => page.locator('article[data-post-id]');
async function category(name) { await page.getByRole('button', { name, exact: true }).click(); await page.getByRole('button', { name, exact: true }).getAttribute('aria-pressed').then(value => assert.equal(value, 'true')); }
async function stop() {
  const stopButton = page.getByRole('button', { name: 'Stop collection', exact: true });
  if (await stopButton.count()) {
    const response = page.waitForResponse(r => r.url() === `${base}/api/posts` && r.request().method() === 'POST');
    await stopButton.click(); assert.equal((await response).status(), 200);
    await stopButton.waitFor({ state: 'hidden' });
  }
}
async function search(username) {
  await page.getByRole('textbox', { name: 'X username or profile link' }).fill(username);
  await page.getByRole('button', { name: 'Find tweets', exact: true }).click();
  await rows().first().waitFor({ timeout: 60_000 });
}
async function screen(name) {
  await page.locator('[data-sonner-toast]').waitFor({ state: 'hidden', timeout: 12000 });
  await page.screenshot({ path: `${directory}/${name}.png`, fullPage: false });
  const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  if (overflow.scroll > overflow.width) layoutErrors.push(`Horizontal overflow at ${name}: ${JSON.stringify(overflow)}`);
  const controls = [page.getByRole('link', { name: 'X Media home', exact: true }), page.getByRole('navigation', { name: 'Media source', exact: true }), page.getByRole('link', { name: 'Dashboard', exact: true }), page.getByRole('button', { name: 'Toggle color theme', exact: true })];
  const bounds = await Promise.all(controls.map(control => control.boundingBox()));
  for (let i = 0; i < bounds.length; i++) {
    const a = bounds[i]; if (!a || a.width === 0 || a.x < 0 || a.x + a.width > overflow.width + 1) { layoutErrors.push(`Header control ${i} is clipped at ${name}`); continue; }
    for (let j = i + 1; j < bounds.length; j++) { const b = bounds[j]; if (b && Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1) layoutErrors.push(`Header controls ${i}/${j} overlap at ${name}`); }
  }
}
try {
  await page.goto(`${base}/posts`);
  await page.getByRole('heading', { name: 'Find their best tweets.' }).waitFor();
  if (await page.locator('html').evaluate(node => node.classList.contains('dark'))) await page.getByRole('button', { name: 'Toggle color theme', exact: true }).click();
  await screen('empty-desktop');
  assert.equal(await page.getByRole('link', { name: 'Tweets', exact: true }).getAttribute('aria-current'), 'page');
  await page.getByRole('textbox', { name: 'X username or profile link' }).fill('bad username!');
  await page.getByRole('button', { name: 'Find tweets', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Enter a username' }).waitFor(); pass('input validation');
  await search('https://x.com/X');
  await stop();
  let view = await api('x'); assert.ok(view.posts.length); assert.equal(view.profile.username, 'x');
  assert.equal(new Set(view.posts.map(p => p.id)).size, view.posts.length); pass('live username collection, deduplication, stop and save');
  await category('Most popular');
  let numbers = await rows().evaluateAll(items => items.map(item => Number(item.dataset.likes || -1)));
  assert.deepEqual(numbers, [...numbers].sort((a, b) => b - a)); pass('popularity sorting');
  await category('Oldest');
  let dates = await rows().evaluateAll(items => items.map(item => item.dataset.date)); assert.deepEqual(dates, [...dates].sort());
  await category('Recent');
  dates = await rows().evaluateAll(items => items.map(item => item.dataset.date)); assert.deepEqual(dates, [...dates].sort().reverse()); pass('oldest and recent sorting');
  await category('Short bangers');
  if (!await rows().count() && view.canContinue) {
    await page.getByRole('button', { name: 'Continue older posts' }).click(); await rows().first().waitFor({ timeout: 60_000 }); await stop(); view = await api('x');
  }
  assert.ok(await rows().count(), 'Live X sample should include short text posts');
  const ids = await rows().evaluateAll(items => items.map(item => item.dataset.postId));
  for (const id of ids) { const post = view.posts.find(p => p.id === id); assert.ok(post && !post.hasMedia && !post.isReply && !post.isQuote && post.characterCount <= 140 && post.likes > 0); }
  await page.getByLabel('Maximum tweet length').selectOption('80');
  for (const id of await rows().evaluateAll(items => items.map(item => item.dataset.postId))) assert.ok(view.posts.find(p => p.id === id).characterCount <= 80);
  await page.getByLabel('Maximum tweet length').selectOption('280'); pass('short bangers, text-only eligibility, adjustable length');
  const text = await rows().first().locator('.posts-text').innerText();
  await rows().first().getByRole('button', { name: /Copy tweet/ }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), text); pass('copy text');
  assert.match(await rows().first().locator('a[aria-label^="Open tweet"]').getAttribute('href'), /^https:\/\/x.com\/x\/status\/\d+$/);
  await page.getByRole('searchbox', { name: 'Search within tweets' }).fill('zzzz_no_matching_phrase_9283');
  await page.getByRole('heading', { name: 'No tweets match this view' }).waitFor();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click(); await rows().first().waitFor();
  await page.getByLabel('Minimum likes', { exact: true }).fill('1000000000'); await page.getByRole('heading', { name: 'No tweets match this view' }).waitFor();
  await page.getByLabel('Minimum likes', { exact: true }).fill('0'); await rows().first().waitFor(); pass('keyword and minimum likes filters, empty and reset states');
  await page.getByLabel('Date range').selectOption('7');
  for (const date of await rows().evaluateAll(items => items.map(item => item.dataset.date))) assert.ok(Date.parse(date) >= Date.now() - 7 * 86400000);
  await page.getByLabel('Date range').selectOption('0'); pass('date range');
  await page.getByRole('button', { name: /^Filters/ }).click();
  assert.equal(await page.getByRole('checkbox', { name: /Include replies/ }).count(), 0);
  await category('Recent');
  assert.ok(view.posts.every(post => !post.isReply && !post.isQuote));
  assert.equal(await rows().count(), Math.min(view.posts.length, 30)); pass('original tweets only, with no reply toggle');
  if (await page.getByRole('button', { name: /Show 30 more/ }).count()) {
    await page.getByRole('button', { name: /Show 30 more/ }).click(); assert.ok(await rows().count() > 30); pass('result pagination');
  }
  await page.getByRole('button', { name: /^Filters/ }).click();
  await category('Short bangers'); await page.getByLabel('Maximum tweet length').selectOption('140');
  await page.evaluate(() => window.scrollTo(0, 0)); await screen('desktop');
  await page.setViewportSize({ width: 390, height: 844 }); await screen('mobile');
  await page.locator('.posts-results').scrollIntoViewIfNeeded(); await screen('mobile-results');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.setViewportSize({ width: 320, height: 760 }); await screen('mobile-320');
  await page.setViewportSize({ width: 1440, height: 1000 });
  if (!await page.locator('html').evaluate(node => node.classList.contains('dark'))) await page.getByRole('button', { name: 'Toggle color theme', exact: true }).click();
  await screen('dark-desktop'); pass('desktop, 390px, 320px layouts and theme');
  await page.reload(); await rows().first().waitFor(); assert.equal((await api('x')).posts.length, view.posts.length); pass('saved account reopening after reload');
  await search('@karpathy'); await stop();
  const second = await api('karpathy'); assert.ok(second.posts.length); assert.ok((await rows().first().innerText()).includes('@karpathy'));
  await page.getByRole('navigation', { name: 'Saved tweet accounts' }).getByRole('button', { name: /^@x\b/i }).click();
  await page.waitForFunction(() => document.querySelector('article')?.textContent.includes('@x')); pass('account switching and saved search selection');
  await page.getByRole('button', { name: 'Refresh latest', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[role=status]')?.textContent.includes('refresh') || document.querySelector('[role=status]')?.textContent.includes('Refreshing'));
  await stop(); assert.ok((await api('x')).posts.length >= view.posts.length); pass('refresh preserves saved history');
  assert.deepEqual(errors, []);
  assert.deepEqual(layoutErrors, []);
  await writeFile(`${directory}/results.json`, JSON.stringify({ checks, errors, liveAccounts: ['x', 'karpathy'] }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, checks, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${directory}/failure.png`, fullPage: true }).catch(() => {});
  console.log((await page.locator('body').innerText()).slice(0, 2500));
  throw error;
} finally { await browser.close(); }
