import assert from 'node:assert/strict';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
const base = process.env.X_MEDIA_TEST_URL || 'http://127.0.0.1:3000';
assert.equal(process.env.FOLDERS_TEST, '1', 'Start X Media with MEDIA_FOLDERS_DIR pointing to an isolated QA directory, then set FOLDERS_TEST=1.');
const get = async path => { const response = await fetch(base + path); assert.ok(response.ok, `${path}: ${response.status}`); return response.json(); };
assert.deepEqual((await get('/api/folders')).folders, [], 'The QA folder store must start empty.');
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
context.setDefaultTimeout(20000); context.setDefaultNavigationTimeout(60000);
const page = await context.newPage(), errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
const pass = name => { checks.push(name); console.log('PASS', name); };
const picker = () => page.getByRole('dialog', { name: 'Organize in folders' });
async function openPicker(button) { await button.click(); await picker().getByRole('button', { name: 'Save folders', exact: true }).waitFor(); await picker().getByText('Loading your folders…', { exact: true }).waitFor({ state: 'hidden' }); }
async function createInPicker(name) { await picker().getByRole('textbox', { name: 'New folder', exact: true }).fill(name); await picker().getByRole('button', { name: 'Create folder', exact: true }).click(); await picker().getByRole('checkbox', { name: new RegExp(name) }).waitFor(); }
async function savePicker() { const response = page.waitForResponse(r => r.url().endsWith('/api/folders/memberships') && r.request().method() === 'PUT'); await picker().getByRole('button', { name: 'Save folders', exact: true }).click(); assert.equal((await response).status(), 200); await picker().waitFor({ state: 'hidden' }); }
async function settled() { await page.waitForFunction(() => [...document.querySelectorAll('[role=dialog]')].every(dialog => getComputedStyle(dialog).opacity === '1')); await page.waitForFunction(() => [...document.querySelectorAll('article img, [role=dialog] img')].every(image => image.complete)); }
async function shot(name) { await settled(); await page.screenshot({ path: `.impeccable/review/folders-${name}.png`, animations: 'disabled' }); }
try {
  await mkdir('.impeccable/review', { recursive: true });
  await page.goto(base + '/folders'); await page.getByRole('heading', { name: 'A place for every collection' }).waitFor(); pass('empty library and browse actions');
  await page.getByRole('link', { name: 'Browse Reddit', exact: true }).click(); await page.locator('article').first().waitFor();
  await openPicker(page.locator('article').first().getByRole('button', { name: 'Folders', exact: true }));
  await createInPicker('Coding memes'); await createInPicker('Share later'); await savePicker();
  let folders = (await get('/api/folders')).folders; const coding = folders.find(f => f.name === 'Coding memes'), later = folders.find(f => f.name === 'Share later');
  assert.deepEqual(folders.map(f => f.count), [1, 1]); pass('create folders from a Reddit card and assign to multiple folders');
  const redditItem = (await get(`/api/folders/${coding.id}`)).items[0];
  const bytes = await fetch(base + redditItem.previewUrl); assert.ok(bytes.ok); assert.ok((await bytes.arrayBuffer()).byteLength > 1000); pass('preserved Reddit original');
  await openPicker(page.locator('article').first().getByRole('button', { name: 'Folders', exact: true }));
  assert.equal(await picker().getByRole('checkbox', { name: /Coding memes/ }).isChecked(), true);
  await picker().getByRole('checkbox', { name: /Coding memes/ }).uncheck(); await picker().getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal((await get(`/api/folders/${coding.id}`)).items.length, 1); pass('cancel leaves placements intact');
  await openPicker(page.locator('article').nth(1).getByRole('button', { name: 'Folders', exact: true })); await picker().getByRole('checkbox', { name: /Coding memes/ }).check(); await savePicker();
  const jobs = await get('/api/media-archive/jobs'); let view;
  for (const job of jobs.jobs) { const candidate = await get(`/api/media-archive/jobs/${job.id}`); if (candidate.result.items.some(item => item.media.type === 'video')) { view = candidate; break; } }
  assert.ok(view, 'A real saved X video is required for mixed-source verification.');
  await page.evaluate(id => localStorage.setItem('signaldesk.archive.job', id), view.job.id);
  await page.goto(base + '/'); await page.locator('article').first().waitFor();
  await openPicker(page.locator('article').first().getByRole('button', { name: 'Folders', exact: true })); await picker().getByRole('checkbox', { name: /Coding memes/ }).check(); await savePicker(); pass('X media card placement');
  await page.getByRole('navigation', { name: 'Media source' }).getByRole('link', { name: 'Folders', exact: true }).click(); await page.getByRole('link', { name: /Coding memes 3 items/ }).waitFor();
  await shot('index-desktop'); await page.getByRole('link', { name: /Coding memes 3 items/ }).click(); await page.waitForFunction(() => document.querySelectorAll('article').length === 3); await page.reload(); await page.waitForFunction(() => document.querySelectorAll('article').length === 3); pass('mixed-source folder navigation and reload persistence');
  await page.getByRole('textbox', { name: 'Search folder media' }).fill('unlikely-query-no-match'); await page.getByRole('heading', { name: 'No matches found' }).waitFor(); await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByRole('combobox', { name: 'Media source' }).selectOption('reddit'); assert.equal(await page.locator('article').count(), 2); await page.getByRole('combobox', { name: 'Media source' }).selectOption('all'); pass('search and source filters');
  await shot('desktop'); const wasDark = await page.evaluate(() => document.documentElement.classList.contains('dark')); await page.getByRole('button', { name: 'Toggle color theme' }).click(); await page.waitForFunction(wasDark => document.documentElement.classList.contains('dark') !== wasDark, wasDark); await shot('desktop-alternate');
  await page.locator('article').first().getByRole('button', { name: /^View / }).click(); const viewer = page.getByRole('dialog'); await viewer.locator('video').waitFor(); assert.ok((await viewer.locator('video source').getAttribute('src')).includes('/api/media-archive/jobs/')); await page.keyboard.press('Escape'); pass('X video viewer uses the existing streaming route');
  await page.locator('article').nth(1).getByRole('button', { name: /^View / }).click(); await viewer.locator('img').waitFor(); await settled(); assert.ok(await viewer.locator('img').evaluate(image => image.naturalWidth > 0));
  const download = page.waitForEvent('download'); await viewer.getByRole('link', { name: 'Download original' }).click(); assert.ok((await stat(await (await download).path())).size > 1000); pass('Reddit folder viewer and original download');
  await openPicker(viewer.getByRole('button', { name: 'Folders', exact: true })); await shot('picker-desktop'); await page.keyboard.press('Escape'); await picker().waitFor({state:'hidden'}); await viewer.getByRole('heading').waitFor(); await page.keyboard.press('Escape'); pass('nested picker and Escape focus handling');
  await page.setViewportSize({ width: 390, height: 844 }); await shot('mobile'); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.locator('article').nth(1).getByRole('button', { name: /^View / }).click(); await viewer.locator('img').waitFor(); await shot('viewer-mobile'); assert.ok((await viewer.boundingBox()).width >= 389);
  await openPicker(viewer.getByRole('button', { name: 'Folders', exact: true })); await shot('picker-mobile'); assert.ok((await picker().boundingBox()).width <= 390); await page.keyboard.press('Escape'); await picker().waitFor({state:'hidden'}); await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 320, height: 720 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); pass('390px and 320px layouts, full-width viewer, responsive picker');
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.getByRole('button', { name: 'Rename', exact: true }).click(); await page.getByRole('textbox', { name: 'Folder name' }).fill('Coding collection'); await page.getByRole('button', { name: 'Save name' }).click(); await page.getByRole('heading', { name: 'Coding collection', exact: true }).waitFor(); pass('rename folder');
  await openPicker(page.locator('article').first().getByRole('button', { name: 'Folders', exact: true })); await picker().getByRole('checkbox', { name: /Coding collection/ }).uncheck(); await picker().getByRole('checkbox', { name: /Share later/ }).check(); await savePicker(); await page.waitForFunction(() => document.querySelectorAll('article').length === 2); pass('move an item between folders');
  await page.locator('article').first().getByRole('button', { name: /^Remove / }).click(); await page.waitForFunction(() => document.querySelectorAll('article').length === 1); pass('remove an individual placement');
  await page.getByRole('button', { name: 'Delete', exact: true }).click(); await page.getByRole('button', { name: 'Delete folder', exact: true }).click(); await page.waitForURL(base + '/folders'); await page.getByRole('link', { name: /Share later 2 items/ }).waitFor();
  assert.equal((await get(`/api/folders/${later.id}`)).items.length, 2); assert.equal((await get(`/api/reddit/memes/${redditItem.reference.id}`)).meme.id, redditItem.reference.id); pass('delete folder preserves other placements and source media');
  assert.deepEqual(errors, []); await writeFile('.impeccable/review/folders-test-result.json', JSON.stringify({ passed: checks.length, checks, errors, remainingFolderId: later.id }, null, 2)); console.log(JSON.stringify({ passed: checks.length, checks, errors }, null, 2));
} finally { await browser.close(); }
