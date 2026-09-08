import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,writeFile,stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { Store,mergePost } from './store.mjs';
import { Finder } from './finder.mjs';
import { Collector } from './collector.mjs';
import { ImageCache } from './image-cache.mjs';
import { VisionJudge,REQUEST_RESERVE } from './vision.mjs';
import { rankPost,tasteProfile,personalizedScore,selectBatch } from './ranking.mjs';
import { acquireLock } from './instance-lock.mjs';
import { evaluateHoldout } from './evaluation.mjs';
import { VISION_MODEL,VISION_VERSION } from './vision.mjs';
import { createDiscordDelivery } from './discord-delivery.mjs';

const DAY=86400000;
const fixture=(id='abc123',extra={})=>({id,title:'When Claude fixes one tiny bug',subreddit:'ProgrammerHumor',flair:'Meme',score:500,created:Math.floor(Date.now()/1000),imageUrl:'https://i.redd.it/'+id+'.png',images:['https://i.redd.it/'+id+'.png'],assetVerified:true,assetCheckedAt:Date.now(),assetQualityScore:92,asset:{sha256:createHash('sha256').update(id).digest('hex'),differenceHash:'0123456789abcdef'},...extra});
async function temp(run){const directory=await mkdtemp(path.join(tmpdir(),'meme-v4-test-'));try{await run(directory);}finally{assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir())+path.sep+'meme-v4-test-'));await rm(directory,{recursive:true,force:true});}}
const response=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json',...headers}});
const goodAnalysis={visibleText:'one small bug, ten new bugs',topicRelevant:true,isMeme:true,format:'reaction',joke:'Fixing the bug causes more bugs.',humor:88,readability:95,confidence:.9,tags:['coding']};

test('migration preserves uncertain reviews, backups, metadata and rejects without training taste',()=>temp(async dir=>{
  await writeFile(path.join(dir,'pool-cache.json'),JSON.stringify([fixture()]));
  await writeFile(path.join(dir,'meme-reviews.json'),JSON.stringify({abc123:{verdict:'keep'},xyz123:{verdict:'reject',source:'manual',meme:fixture('xyz123')}}));
  let s=new Store(dir);assert.equal(s.posts().length,2);assert.equal(s.review('abc123').source,'legacy_unknown');assert.equal(s.review('xyz123').verdict,'reject');assert.equal(s.tasteEvents().length,0);assert.ok((await stat(path.join(s.meta('migration-v4').backup,'pool-cache.json'))).isFile());s.close();
  s=new Store(dir);assert.equal(s.posts().length,2);assert.equal(s.tasteEvents().length,0);s.close();
}));
test('metadata merge keeps dates, votes and tombstones; changing images invalidates old analysis',()=>{
  const first=fixture('a',{removed:true,provenance:['arctic']});const merged=mergePost(first,{id:'a',created:null,score:null,flair:'',removed:false,discoverySource:'hot'});assert.equal(merged.created,first.created);assert.equal(merged.score,500);assert.equal(merged.flair,'Meme');assert.equal(merged.removed,true);assert.deepEqual(merged.provenance,['arctic','hot']);
  const next=mergePost(first,{imageUrl:'https://i.redd.it/changed.png'});assert.equal(next.assetVerified,undefined);assert.equal(next.assetCheckedAt,undefined);
});
test('transaction rollback and persistent undo restore the exact previous review',()=>temp(async dir=>{
  let s=new Store(dir);s.putPost(fixture());s.autoKeep('abc123');assert.throws(()=>s.transaction(()=>{s.putPost(fixture('xyz'));throw Error('failure');}));assert.equal(s.getPost('xyz'),null);
  const saved=s.feedback('abc123','favorite');const reject=s.feedback('abc123','reject','not_funny');assert.throws(()=>s.undo(saved),/most recent/);s.close();s=new Store(dir);s.undo(reject);assert.equal(s.review('abc123').favorite,1);s.undo(saved);assert.equal(s.review('abc123').source,'automatic');assert.equal(s.tasteEvents().length,0);s.close();
}));
test('stable recommendation batches survive changes and restarts; rejected and seen do not enter new batches',()=>temp(async dir=>{
  let f=new Finder(dir,{offline:true});for(let i=1;i<=25;i++)f.store.putPost(fixture('a'+i));f.rebuild();const before=f.picks();assert.equal(before.memes.length,20);assert.deepEqual(f.picks().memes.map(p=>p.id),before.memes.map(p=>p.id));
  f.store.markSeen(before.memes[0].id);f.store.putPost(fixture('winner',{score:100000}));f.rebuild();assert.deepEqual(f.picks().memes.map(p=>p.id),before.memes.map(p=>p.id));f.feedback(before.memes[1].id,'reject','not_funny');assert.equal(f.picks().memes.length,19);f.store.close();
  f=new Finder(dir,{offline:true});assert.equal(f.picks().batchId,before.batchId);const next=f.picks({next:true});assert.ok(next.memes.every(p=>!before.memes.some(old=>old.id===p.id)));f.store.close();
}));
test('only identical image content collapses; nearby perceptual hashes remain distinct',()=>temp(async dir=>{
  const f=new Finder(dir,{offline:true});f.store.putPost(fixture('a'));f.store.putPost(fixture('b'));f.store.putPost(fixture('c',{asset:fixture('a').asset}));f.rebuild();assert.equal(f.list({view:'explore'}).total,2);assert.ok(f.get('b').similarTo);assert.equal(f.get('c').duplicateOf,'a');f.feedback('a','reject','not_funny');assert.equal(f.list({view:'explore'}).total,1);f.store.close();
}));
test('freshness, low evidence, editorial posts and community diversity gate For You',()=>{
  const good=rankPost(fixture());assert.equal(good.eligible,true);
  for(const extra of [{score:null},{score:1},{assetVerified:false},{assetQualityScore:30},{title:'New Claude model benchmark released',score:90000},{title:'I built an AI tool for your team',subreddit:'OpenAI',score:90000}])assert.equal(rankPost(fixture('n',extra)).eligible,false,JSON.stringify(extra));
  const other=rankPost(fixture('other',{subreddit:'ProgrammerMemes',score:30}));const selected=selectBatch([good,rankPost(fixture('b')),other]);assert.notEqual(selected[0].subreddit,selected[1].subreddit);
  assert.equal(selectBatch([rankPost(fixture('old',{created:(Date.now()-31*DAY)/1000})),rankPost(fixture('future',{created:(Date.now()+DAY)/1000}))]).length,0);
  assert.notEqual(rankPost(fixture('vague',{title:'Claude'})).tier,'S');
});
test('taste is bounded, explicit, reversible, and scrolling or seen rejection is neutral',()=>{
  const p=rankPost(fixture()),neutral=tasteProfile([], [p]);assert.equal(personalizedScore(p,neutral).taste,0);
  assert.equal(tasteProfile([{post_id:p.id,action:'reject',reason:'seen'}],[p]).size,0);
  const liked=tasteProfile([{post_id:p.id,action:'favorite'}],[p]);assert.ok(personalizedScore(p,liked).taste>0);assert.ok(personalizedScore(p,liked).taste<=10);
  assert.equal(tasteProfile([{post_id:p.id,action:'favorite'},{post_id:p.id,action:'clear'}],[p]).size,0);
});
test('incremental collector overlaps cursors, stores independent failures and preserves partial discoveries',()=>temp(async dir=>{
  const s=new Store(dir),now=Date.now(),calls=[];let fail=false;
  const c=new Collector(s,{now:()=>now,onPosts:async posts=>posts.forEach(p=>s.putPost(p)),fetchImpl:async url=>{calls.push(new URL(url));if(url.includes('Broken'))return response({},429,{'retry-after':'120'});if(fail)throw Error('timeout');return response({data:[{...fixture(),url:'https://i.redd.it/abc123.png',created_utc:Math.floor(now/1000)-10}]});}});
  await c.archive('ProgrammerHumor');const cursor=s.job('archive:ProgrammerHumor').cursor;assert.equal(s.posts().length,1);await c.archive('Broken');assert.equal(s.job('archive:Broken').state,'degraded');assert.equal(s.job('archive:Broken').retryAt,now+120000);await c.archive('ProgrammerHumor');assert.equal(Number(calls.at(-1).searchParams.get('after')),cursor-3600);
  fail=true;await c.archive('ProgrammerHumor');assert.equal(s.job('archive:ProgrammerHumor').cursor,cursor);assert.equal(s.posts().length,1);await c.accept([{id:'abc123',removed_by_category:'moderator'}],'arctic');assert.equal(s.getPost('abc123').removed,true);s.close();
}));
test('archive finishes a sparse auto-sized tail with one bounded fallback and commits its cursor',()=>temp(async dir=>{
  const s=new Store(dir),now=Date.now(),newest=Math.floor(now/1000)-10,calls=[];
  const c=new Collector(s,{now:()=>now,onPosts:async posts=>posts.forEach(p=>s.putPost(p)),fetchImpl:async url=>{
    const params=new URL(url).searchParams;calls.push({limit:params.get('limit'),before:params.get('before')});
    if(!params.has('before'))return response({data:Array.from({length:100},(_,i)=>({...fixture('tail'+i),url:'https://i.redd.it/tail'+i+'.png',created_utc:newest-i}))});
    return params.get('limit')==='auto'?response({error:'Timeout. Maybe slow down a bit'},422):response({data:[]});
  }});
  await c.archive('ProgrammerHumor');
  assert.deepEqual(calls.map(c=>c.limit),['auto','auto','100']);assert.equal(calls[1].before,calls[2].before);
  assert.equal(s.posts().length,100);assert.equal(s.job('archive:ProgrammerHumor').state,'healthy');
  assert.equal(s.job('archive:ProgrammerHumor').cursor,newest);assert.equal(s.job('archive:ProgrammerHumor').backfillAt,now);s.close();
}));
test('image cache shares requests, bounds memory, creates thumbnails and survives restart',()=>temp(async dir=>{
  const s=new Store(dir),buf=await sharp({create:{width:640,height:480,channels:3,background:'#ad843c'}}).png().toBuffer();let calls=0;
  const images=new ImageCache(s,{memoryBytes:100,fetchImpl:async()=>{calls++;return new Response(buf,{headers:{'content-type':'image/png'}});}});
  const url='https://i.redd.it/a.png';const results=await Promise.all(Array.from({length:10},()=>images.get(url)));assert.equal(calls,1);assert.ok(results.every(r=>r.hash===results[0].hash));assert.ok(images.bytes<=100);assert.equal((await images.thumbnail(url)).type,'image/webp');
  const offline=new ImageCache(s,{offline:true});assert.deepEqual((await offline.get(url)).buf,buf);assert.equal(await images.get('https://example.com/private'),null);assert.equal(await images.get('https://i.redd.it@127.0.0.1/a.png'),null);s.close();
}));
test('cache eviction protects saved originals even over its expendable limit',()=>temp(async dir=>{
  const s=new Store(dir);s.settings({diskCacheMB:64});const images=new ImageCache(s);const saved=await images.save('https://i.redd.it/saved.png',Buffer.from('saved'),'image/png');s.putPost(fixture('saved',{asset:{sha256:saved.hash}}));s.feedback('saved','favorite');
  for(let i=0;i<7;i++)await images.save('https://i.redd.it/'+i+'.png',Buffer.alloc(10*1024*1024,i),'image/png');const report=await images.maintain();assert.ok(report.cacheBytes<=64*1024*1024);assert.equal(report.savedBytes,5);assert.equal((await images.get('https://i.redd.it/saved.png')).buf.toString(),'saved');s.close();
}));
test('daily/monthly/image reservations are atomic, persist on uncertainty, and reset on UTC boundaries',()=>temp(async dir=>{
  let s=new Store(dir);const now=Date.UTC(2026,8,4,23,59);assert.equal(s.reserve('a',.01,now),null);s.settings({visionEnabled:true,dailyBudget:.02,monthlyBudget:.04,dailyImages:2});
  const ids=await Promise.all(Array.from({length:10},()=>Promise.resolve(s.reserve('a',.01,now))));assert.equal(ids.filter(Boolean).length,2);s.close();s=new Store(dir);assert.equal(s.reserve('b',.01,now),null);assert.ok(s.reserve('b',.01,now+DAY));assert.ok(s.reserve('b',.01,now+DAY));assert.equal(s.reserve('b',.01,now+2*DAY),null);assert.ok(s.reserve('b',.01,Date.UTC(2026,9,1)));s.close();
}));
test('vision stays off without opt-in; deduplicates calls and caches structured results in shadow mode',()=>temp(async dir=>{
  const s=new Store(dir),buf=await sharp({create:{width:100,height:100,channels:3,background:'#fff'}}).png().toBuffer();let calls=0;
  const v=new VisionJudge(s,{get:async()=>({buf})},{key:'fake-test-key',fetchImpl:async(url,opts)=>{calls++;const input=JSON.parse(opts.body);assert.equal(input.store,false);assert.equal(input.tools,undefined);assert.equal(input.text.format.strict,true);return response({usage:{input_tokens:100,output_tokens:100},output:[{content:[{type:'output_text',text:JSON.stringify(goodAnalysis)}]}]});}});
  assert.equal(await v.analyze(fixture()),null);assert.equal(calls,0);s.settings({visionEnabled:true});const results=await Promise.all([v.analyze(fixture()),v.analyze(fixture())]);assert.equal(calls,1);assert.equal(results[0].status,'complete');await v.analyze(fixture());assert.equal(calls,1);assert.equal(s.settings().visionInfluence,false);assert.throws(()=>s.settings({visionInfluence:true}),/held-out/);assert.ok(s.spending().daily<REQUEST_RESERVE);
  const ordinary=rankPost(fixture());assert.equal(rankPost(fixture(),{analysis:{...goodAnalysis,status:'complete',humor:0}}).qualityScore,ordinary.qualityScore);assert.equal(rankPost(fixture(),{analysis:{...goodAnalysis,status:'complete',humor:0},useVision:true}).eligible,false);s.close();
}));
test('vision timeout or malformed response preserves a conservative budget reservation and cooldown',()=>temp(async dir=>{
  const s=new Store(dir);s.settings({visionEnabled:true});const buf=await sharp({create:{width:20,height:20,channels:3,background:'#fff'}}).png().toBuffer();let calls=0;const v=new VisionJudge(s,{get:async()=>({buf})},{key:'fake-test-key',fetchImpl:async()=>{calls++;throw Error('timeout');}});const a=await v.analyze(fixture());assert.equal(a.status,'error');assert.equal(s.spending().daily,REQUEST_RESERVE);await v.analyze(fixture());assert.equal(calls,1);s.close();
}));
test('singleton lock refuses an active process and permits restart after release',()=>temp(async dir=>{const release=acquireLock(dir);assert.throws(()=>acquireLock(dir),/already running/);release();const again=acquireLock(dir);again();}));
test('filtering 1,000 posts stays within a 100 ms interaction budget',()=>temp(async dir=>{const f=new Finder(dir,{offline:true});f.catalog=Array.from({length:1000},(_,i)=>({...rankPost(fixture('a'+i)),reviewStatus:'keep'}));const start=performance.now();for(let i=0;i<20;i++)f.list({view:'explore',q:'claude',sort:'newest'});const average=(performance.now()-start)/20;assert.ok(average<100,'filter average '+average+' ms');console.log('1,000-post filter average: '+average.toFixed(2)+' ms');f.store.close();}));
test('image ranking activation requires a diverse human holdout and measured precision',()=>{
  const rows=Array.from({length:40},(_,i)=>({labelSource:'human',split:'holdout',acceptable:i<20,post:fixture('a'+i,{subreddit:['ProgrammerHumor','ProgrammerMemes','ClaudeAI'][i%3]}),analysis:{...goodAnalysis,isMeme:i<20,humor:i<20?88:10,status:'complete',model:VISION_MODEL,version:VISION_VERSION}}));
  assert.equal(evaluateHoldout(rows).passed,true);assert.equal(evaluateHoldout(rows.slice(0,10)).passed,false);assert.equal(evaluateHoldout(rows.map(r=>({...r,analysis:{...r.analysis,isMeme:true,humor:88}}))).passed,false);
  assert.equal(evaluateHoldout(rows.map(r=>({...r,labelSource:'automatic'}))).passed,false);
});
test('Discord revalidates immediately before each channel and retains partial receipts',()=>temp(async dir=>{
  let kept=true,sends=0;const p={...rankPost(fixture()),reviewStatus:'keep'};
  const d=createDiscordDelivery({stateFile:path.join(dir,'delivery.json'),visualHistoryFile:'',enabled:true,sendBacklog:true,resolveMeme:()=>kept?p:null,destinationChannels:async()=>['one','two'],sendMeme:async()=>{sends++;kept=false;},logger:{log(){},warn(){}}});
  await d.sync([p]);assert.equal(sends,1);assert.equal(d.status().pending,0);assert.equal(d.status().sent,1);
}));
test('invalid vision JSON cannot affect rankings and still consumes a request reservation',()=>temp(async dir=>{
  const s=new Store(dir);s.settings({visionEnabled:true});const buf=await sharp({create:{width:20,height:20,channels:3,background:'#fff'}}).png().toBuffer();const v=new VisionJudge(s,{get:async()=>({buf})},{key:'fake-test-key',fetchImpl:async()=>response({output_text:'not json'})});assert.equal((await v.analyze(fixture())).status,'error');assert.equal(s.spending().daily,REQUEST_RESERVE);s.close();
}));
