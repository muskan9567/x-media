import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { chromium } from 'playwright-core';
const base=process.env.X_MEDIA_TEST_URL||'http://127.0.0.1:3000';
const health=await fetch(base+'/api/reddit/health').then(r=>r.json());assert.equal(health.offline,true,'Run this smoke test against an offline copy of Reddit data.');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write'],reducedMotion:'reduce'});
context.setDefaultTimeout(15000);context.setDefaultNavigationTimeout(60000);const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));const checks=[];checks.push=(...items)=>{console.log("PASS",...items);return Array.prototype.push.apply(checks,items);};
async function ready(){await page.locator('article').first().waitFor();await page.getByText('Loading memes…',{exact:true}).waitFor({state:'hidden'});}
async function action(button){const response=page.waitForResponse(r=>r.url().includes('/api/reddit/feedback/')&&r.request().method()==='POST');await button.click();const result=await(await response).json();assert.ok(result.eventId,JSON.stringify(result));return result;}
try{
await page.goto(base+'/reddit');await ready();assert.equal(await page.locator('article').count(),60);
await page.getByRole('button',{name:'Load more',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('article').length===120);checks.push('pagination');
await page.getByRole('textbox',{name:'Search memes'}).fill('Posting AI Slop');await page.waitForFunction(()=>document.querySelectorAll('article').length===1);checks.push('search');
await page.getByLabel('Rank',{exact:true}).selectOption('S');await page.getByText('No memes match this view',{exact:true}).waitFor();checks.push('rank and empty state');
await page.getByLabel('Rank',{exact:true}).selectOption('A');await ready();
await page.getByLabel('Community',{exact:true}).selectOption('starterpacks');await ready();checks.push('community filter');
await page.getByLabel('Sort memes').selectOption('newest');await ready();
const original=await page.locator('article').first().getByRole('button',{name:/^Save /}).getAttribute('aria-label');
await action(page.locator('article').first().getByRole('button',{name:/^Save /}));await page.getByRole('button',{name:'Undo',exact:true}).click();await page.locator('article').first().getByRole('button',{name:original,exact:true}).waitFor();checks.push('save and undo');
const saved=await action(page.locator('article').first().getByRole('button',{name:/^Save /}));
await page.getByRole('navigation',{name:'Reddit views'}).getByRole('link',{name:'Saved',exact:true}).click();await ready();assert.ok((await page.locator('article').innerText()).includes('Posting AI Slop'));
await page.reload();await ready();checks.push('saved persistence');
await page.locator('article').first().getByRole('button',{name:/^View /}).click();const dialog=page.getByRole('dialog');await dialog.waitFor();await page.waitForFunction(()=>{const image=document.querySelector('[role=dialog] img');return image?.complete&&image.naturalWidth>0;});assert.ok((await dialog.boundingBox()).width>=700);checks.push('original image viewer');
const downloadPromise=page.waitForEvent('download');await dialog.getByRole('link',{name:'Download original'}).click();const download=await downloadPromise;assert.ok((await stat(await download.path())).size>1000);checks.push('original download');
await dialog.getByRole('button',{name:'Copy image'}).click();await dialog.getByText('Image copied',{exact:true}).waitFor();checks.push('copy image');
await dialog.getByRole('button',{name:'Zoom',exact:true}).click();await dialog.getByRole('button',{name:'Fit image',exact:true}).waitFor();await page.keyboard.press('Escape');
await page.request.post(base+'/api/reddit/undo',{data:{eventId:saved.eventId}});checks.push('zoom and escape');
await page.goto(base+'/reddit/review');await ready();const review=await action(page.locator('article').first().getByRole('button',{name:'Keep',exact:true}));await page.getByRole('button',{name:'Undo',exact:true}).click();assert.ok(review.eventId);checks.push('review keep and undo');
await page.locator('article').first().getByRole('button',{name:/^View /}).click();await dialog.waitFor();await dialog.getByLabel('Rejection reason').selectOption('off_topic');await action(dialog.getByRole('button',{name:'Reject',exact:true}));await dialog.waitFor({state:'hidden'});await page.getByRole('button',{name:'Undo',exact:true}).click();checks.push('reject with reason and undo');
await page.goto(base+'/reddit/picks');await page.getByRole('button',{name:'Next batch',exact:true}).waitFor();await page.getByRole('button',{name:'Next batch',exact:true}).click();checks.push('recommendation batches');
await page.goto(base+'/reddit/settings');await page.getByRole('button',{name:'Save settings',exact:true}).waitFor();await page.getByRole('spinbutton',{name:'TV interval (seconds)'}).fill('9');await page.getByRole('button',{name:'Save settings',exact:true}).click();await page.getByText('Settings saved',{exact:true}).waitFor();await page.reload();assert.equal(await page.getByRole('spinbutton',{name:'TV interval (seconds)'}).inputValue(),'9');checks.push('settings persistence');
await page.goto(base+'/reddit/tv');await page.getByRole('button',{name:'Pause TV'}).waitFor();await page.getByRole('button',{name:'Pause TV'}).click();await page.getByRole('button',{name:'Play TV'}).waitFor();await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByRole('button',{name:'View',exact:true}).click();await dialog.waitFor();await page.keyboard.press('Escape');checks.push('TV playback, pause, next, viewer');
await page.goto(base+'/');await page.getByRole('heading',{name:'Public X videos, together'}).waitFor();assert.equal(await page.getByRole('button',{name:'Find media',exact:true}).count(),1);assert.equal(await page.getByRole('textbox',{name:'X username'}).count(),1);checks.push('X home and source navigation');
await page.getByRole('navigation',{name:'Media source'}).getByRole('link',{name:'Reddit',exact:true}).click();await ready();await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'.impeccable/review/desktop.png'});
await page.getByRole('button',{name:'Toggle color theme'}).click();await page.screenshot({path:'.impeccable/review/desktop-light.png'});
await page.locator('article').first().getByRole('button',{name:/^View /}).click();await dialog.waitFor();await page.screenshot({path:'.impeccable/review/viewer.png',animations:'disabled'});await page.keyboard.press('Escape');
await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.impeccable/review/mobile.png'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
await page.locator('article').first().getByRole('button',{name:/^View /}).click();await dialog.waitFor();assert.ok((await dialog.boundingBox()).width>=389);await page.screenshot({path:'.impeccable/review/mobile-viewer.png',animations:'disabled'});checks.push('desktop/mobile, light/dark, full-width mobile viewer');
assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:checks.length,checks,errors},null,2));
}finally{await browser.close();}
