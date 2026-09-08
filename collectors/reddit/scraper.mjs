#!/usr/bin/env node
import { readFile,writeFile,mkdir,rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Finder } from './finder.mjs';
import { SUBREDDITS } from './collector.mjs';
import { acquireLock } from './instance-lock.mjs';
import { createDiscordDelivery,discordMessage } from './discord-delivery.mjs';

const ROOT=path.dirname(fileURLToPath(import.meta.url)),DATA=process.env.MEME_DATA_DIR||path.join(process.cwd(),'.data','reddit');
const USAGE=`S/TIER finder — the same collection and ranking engine as the local app.
Usage: node scraper.mjs [options]
  --subs a,b,c       Communities to include
  --keywords a,b    Filter titles and analyzed image text
  --min-score N     Minimum known upvotes (default 50)
  --time PERIOD     hour|day|week|month|year|all (collection covers 30 days)
  --out DIR         Gallery and downloads directory (default ./memes)
  --no-download     Export links only
  --fresh           Re-export images already downloaded
  --watch [MINS]    Repeat collection (default 15 minutes)
  --webhook URL     Explicit Discord destination; preserves delivery receipts
  --no-discord      Disable delivery, including configured webhooks
  --open            Open the gallery
  --no-search       Accepted for compatibility; collection is incremental
  --help            Show help
The CLI uses the running app when available; otherwise starts its shared engine.
Discord is off unless a webhook is explicitly configured in arguments, environment,
or config.json. At most one eligible meme is sent per three-minute interval.`;
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safe=s=>String(s).replace(/[^a-z0-9_-]/gi,'_').slice(0,75);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function readJson(file,fallback){try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw Error('Cannot read '+path.basename(file)+': '+e.message);}}
async function atomic(file,data){await writeFile(file+'.tmp',JSON.stringify(data,null,2));await rename(file+'.tmp',file);}
async function parse(argv){const cfg=await readJson(path.join(ROOT,'config.json'),{});const opts={subs:cfg.subs||SUBREDDITS,keywords:cfg.keywords||[],minScore:cfg.minScore??50,time:'week',out:'memes',webhook:cfg.webhook||process.env.DISCORD_WEBHOOK_URL||'',watch:0,download:true,fresh:false,open:false};
  for(let i=0;i<argv.length;i++){const next=()=>{if(!argv[i+1]||argv[i+1].startsWith('--'))throw Error('Missing value for '+argv[i]);return argv[++i];};switch(argv[i]){
    case '--subs':opts.subs=next().split(',').filter(Boolean);break;case '--keywords':opts.keywords=next().toLowerCase().split(',').filter(Boolean);break;
    case '--min-score':case '--min_score':opts.minScore=Number(next());break;case '--time':opts.time=next();break;case '--out':opts.out=next();break;case '--webhook':opts.webhook=next();break;
    case '--watch':opts.watch=argv[i+1]&&!argv[i+1].startsWith('--')?Number(next()):15;break;case '--no-discord':opts.webhook='';break;case '--no-download':opts.download=false;break;case '--fresh':opts.fresh=true;break;case '--open':opts.open=true;break;case '--no-search':break;case '--help':case '-h':opts.help=true;break;default:throw Error('Unknown option: '+argv[i]);}}
  if(!['hour','day','week','month','year','all'].includes(opts.time))throw Error('Invalid time window');if(!Number.isFinite(opts.minScore)||opts.minScore<0||!Number.isFinite(opts.watch)||opts.watch<0)throw Error('Invalid numeric option');if(opts.subs.some(s=>!/^\w{1,50}$/.test(s)))throw Error('Invalid subreddit');
  if(opts.webhook&&!/^https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[^/\s]+$/.test(opts.webhook))throw Error('Invalid Discord webhook URL');return opts;
}
function gallery(rows){return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>S/TIER gallery</title><style>body{background:#111210;color:#f2f0e9;font:16px 'Segoe UI',sans-serif;margin:32px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px}img{width:100%;height:340px;object-fit:contain;background:#1b1d19}a{color:#f5b63d}h2{font-size:17px}small{color:#abaea1}</style><h1>S/TIER · ${rows.length} finds</h1><main>${rows.map(p=>`<article>${p.file?`<img src="${escape(p.file)}" alt="${escape(p.title)}" loading="lazy">`:''}<h2><a href="${escape(p.permalink)}" rel="noopener noreferrer">${escape(p.title)}</a></h2><small>${p.tier} rank · r/${escape(p.subreddit)} · ↑ ${p.score??'unknown'}</small></article>`).join('')}</main></html>`;}
async function main(){
  if(process.argv.includes('--help')||process.argv.includes('-h')){console.log(USAGE);return;}
  const opts=await parse(process.argv.slice(2)),out=path.resolve(opts.out);await mkdir(out,{recursive:true});
  const base=process.env.X_MEDIA_URL||'http://127.0.0.1:'+(process.env.PORT||3000);let finder,release,remote=false;
  try{const r=await fetch(base+'/api/reddit/health',{signal:AbortSignal.timeout(1000)});const health=await r.json();remote=r.ok&&health.ready&&typeof health.revision==='number';}catch{}
  if(!remote){release=acquireLock(DATA);finder=new Finder(DATA,{offline:process.env.MEME_OFFLINE==='1'});finder.collector.subs=opts.subs;}
  const current=async id=>remote?(await fetch(base+'/api/reddit/memes/'+id).then(async r=>r.ok?(await r.json()).meme:null)):finder.get(id);
  const delivery=createDiscordDelivery({stateFile:path.join(out,'.discord-delivery.json'),visualHistoryFile:'',enabled:Boolean(opts.webhook),sendBacklog:true,resolveMeme:async id=>{const p=await current(id);return p&&!p.removed&&!p.unavailable&&!p.duplicateOf?p:null;},destinationChannels:async()=>['webhook'],sendMeme:async p=>{const r=await fetch(opts.webhook,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:discordMessage(p),allowed_mentions:{parse:[]}}),signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Discord HTTP '+r.status);}});
  let stopping=false;const stop=()=>{stopping=true;finder?.collector.stop();finder?.images.stop();finder?.vision.stop();if(finder)finder.stopping=true;};process.on('SIGINT',stop);process.on('SIGTERM',stop);
  try{do{
    console.log(remote?'Using the running finder’s collection.':'Refreshing the shared finder engine…');
    if(!remote)await finder.refresh();
    let rows=[];
    if(remote){let cursor='';do{const data=await fetch(base+'/api/reddit/memes?view=accepted&limit=200&cursor='+cursor).then(r=>r.json());if(!Array.isArray(data.memes))throw Error('Cannot read app collection');rows.push(...data.memes);cursor=data.nextCursor;}while(cursor);}
    else rows=finder.list({view:'accepted',limit:200}).memes;
    const seconds={hour:3600,day:86400,week:604800,month:2592000,year:2592000,all:2592000}[opts.time];
    rows=rows.filter(p=>p.isMeme&&opts.subs.some(s=>s.toLowerCase()===p.subreddit.toLowerCase())&&(!opts.minScore||Number.isFinite(p.score)&&p.score>=opts.minScore)&&p.created&&Date.now()-p.created*1000<=seconds*1000&&(!opts.keywords.length||opts.keywords.some(k=>(p.title+' '+(p.analysis?.visibleText||'')).toLowerCase().includes(k))));
    const index=await readJson(path.join(out,'.downloads.json'),{}),seen=new Set(await readJson(path.join(out,'.seen.json'),[]));let downloaded=0;
    for(const p of rows){if(stopping)break;if(opts.download&&(!index[p.id]||opts.fresh)){
      const entry=remote?await fetch(base+'/api/reddit/images/'+p.id).then(async r=>r.ok?{buf:Buffer.from(await r.arrayBuffer()),type:r.headers.get('content-type')}:null):await finder.images.get(p.imageUrl);
      if(entry){const ext=entry.type.includes('png')?'png':entry.type.includes('webp')?'webp':entry.type.includes('gif')?'gif':'jpg';const file=safe(p.id+'_'+p.title)+'.'+ext;await writeFile(path.join(out,file),entry.buf);index[p.id]=file;downloaded++;}}
      p.file=index[p.id]||null;seen.add(p.id);console.log(`${p.tier} · r/${p.subreddit} · ${p.title}`);
    }
    await atomic(path.join(out,'.downloads.json'),index);await atomic(path.join(out,'.seen.json'),[...seen]);await writeFile(path.join(out,'index.html'),gallery(rows));
    if(opts.webhook&&!stopping)await delivery.sync(rows);
    console.log(`${rows.length} finds, ${downloaded} downloads. Gallery: ${path.join(out,'index.html')}`);
    if(opts.open)spawn('explorer.exe',[path.join(out,'index.html')],{windowsHide:true,detached:true,stdio:'ignore'}).unref();
    if(!opts.watch||stopping)break;for(let i=0;i<opts.watch*60&&!stopping;i++)await sleep(1000);
  }while(!stopping);}finally{stop();await finder?.pendingWork;finder?.store.close();release?.();}
}
main().catch(error=>{console.error(error.message.replace(/https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\/\S+/g,'[webhook redacted]'));process.exitCode=1;});
