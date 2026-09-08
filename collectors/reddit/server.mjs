#!/usr/bin/env node
import { createServer } from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Finder } from './finder.mjs';
import { createLogger } from './logger.mjs';
import { acquireLock } from './instance-lock.mjs';
import { createDiscordDelivery } from './discord-delivery.mjs';

const directory=process.env.MEME_DATA_DIR||path.join(process.cwd(),'.data','reddit');
const logger=createLogger(directory);
let release;
try{release=acquireLock(directory);}catch(error){logger.error(error.message);process.exit(1);}
const clients=new Set();let stopping=false,refreshTimer,deliveryTimer,notifyTimer,legacyRedirect;
const legacyPlayers=new Map();
function notify(type){
  if(stopping||notifyTimer)return;
  notifyTimer=setTimeout(()=>{notifyTimer=null;for(const res of clients)res.write('event: update\ndata: '+JSON.stringify({type,revision:finder.revision})+'\n\n');},350);
}
let finder;
try{finder=new Finder(directory,{offline:process.env.MEME_OFFLINE==='1',onChange:notify,logger});}
catch(error){release();logger.error('Startup failed:',error.message);process.exit(1);}
const delivery=createDiscordDelivery({stateFile:path.join(directory,'runtime','discord-delivery.json'),logger,
  enabled:()=>!stopping&&process.env.MEME_DISCORD_ENABLED==='1'&&finder.store.settings().discordEnabled,
  resolveMeme:id=>{const p=finder.get(id),raw=finder.store.getPost(id);return p&&!raw?.removed&&!p.duplicateOf&&!p.unavailable?p:null;}});
await delivery.load();
const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(text.length>16384)throw Error('Request too large');}return text?JSON.parse(text):{};}
const stats=()=>({...finder.stats(),discord:delivery.status(),startedAt,offline:finder.offline});
const startedAt=new Date().toISOString();

const server=createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try{
    const url=new URL(req.url,'http://'+req.headers.host),p=url.pathname;
    if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))return json(res,403,{error:'Local access only'});
    if(!['GET','HEAD'].includes(req.method)&&req.headers.origin&&req.headers.origin!==url.origin)return json(res,403,{error:'Origin mismatch'});
    if(stopping)return json(res,503,{error:'App is stopping'});
    if(p==='/api/events'&&req.method==='GET'){
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});res.write(': connected\n\n');clients.add(res);
      req.on('close',()=>clients.delete(res));return;
    }
    if(p==='/api/status'){const snapshot=stats(),discord=delivery.status();return json(res,200,{...snapshot,schemaVersion:1,botId:'reddit-meme-sender',observedAt:new Date().toISOString(),version:'4.0.0',state:snapshot.jobs.some(j=>j.state==='degraded')?'degraded':'healthy',activity:snapshot.refreshing?'running':'idle',message:snapshot.lastRefreshError||snapshot.total+' keepers available',outbox:{transport:'notes-overlay',enabled:discord.enabled,cadenceSeconds:180,pendingCount:discord.pending,lastSentAt:discord.lastSuccessAt,nextSendAt:discord.nextDeliveryAt,items:delivery.preview()}});}
    if(['/api/stats','/api/health'].includes(p))return json(res,200,stats());
    if(p==='/api/settings'){
      if(req.method==='PATCH'||req.method==='POST'){const patch=await body(req);finder.store.settings(patch);finder.rebuild();notify('settings');}
      else if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
      return json(res,200,{settings:finder.store.settings(),vision:finder.vision.status(),validated:finder.store.visionValidated()});
    }
    if(p==='/api/picks')return json(res,200,finder.picks({next:req.method==='POST'}));
    if(p==='/api/memes'){
      const options=Object.fromEntries(url.searchParams);options.view ||= options.review==='unreviewed'?'review':'accepted';
      return json(res,200,{...finder.list(options),stats:stats(),tier:options.tier||'ALL',review:options.review||null});
    }
    if(p==='/api/feed'){
      const rows=finder.list({view:'tv',limit:200}).memes;
      if(req.headers.accept?.includes('text/event-stream')){
        const player={id:randomUUID(),index:0,timer:null};
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});res.write('retry: 3000\n\n');
        const emit=()=>{const usable=rows.filter(p=>{const current=finder.get(p.id);return current&&current.reviewStatus==='keep'&&!current.removed&&!current.unavailable&&!current.duplicateOf;});const position=usable.length?player.index%usable.length:0;res.write('event: meme\ndata: '+JSON.stringify({clientId:player.id,reason:'client-playback',meme:usable[position]||null,position:position+1,nextTick:Date.now()+finder.store.settings().tvSeconds*1000,stats:stats(),upNext:usable.slice(position+1,position+7),history:[]})+'\n\n');};
        player.advance=()=>{player.index++;emit();};legacyPlayers.set(player.id,player);clients.add(res);emit();player.timer=setInterval(player.advance,finder.store.settings().tvSeconds*1000);
        req.on('close',()=>{clearInterval(player.timer);legacyPlayers.delete(player.id);clients.delete(res);});return;
      }
      return json(res,200,{current:rows[0]||null,queue:rows.slice(1,11),history:[],memes:rows,seenIds:[...finder.store.seen()],tickMs:finder.store.settings().tvSeconds*1000,...stats()});
    }
    if(p==='/api/skip'&&req.method==='POST'){const data=await body(req);legacyPlayers.get(data.clientId)?.advance();res.writeHead(204);res.end();return;}
    if(p==='/api/history'){const rows=finder.store.db.prepare('SELECT id FROM seen ORDER BY at DESC LIMIT 40').all();return json(res,200,{aired:rows.map(r=>finder.get(r.id)).filter(p=>p&&!p.removed&&p.reviewStatus!=='reject')});}
    if(p==='/api/refresh'&&req.method==='POST'){void finder.refresh();const snapshot=stats();return json(res,202,{ok:true,...snapshot,stats:snapshot});}
    let match;
    if((match=p.match(/^\/api\/memes\/([a-z0-9]+)$/i))&&req.method==='GET'){const meme=finder.get(match[1]);return json(res,meme?200:404,meme?{meme}:{error:'Meme not found'});}
    if((match=p.match(/^\/api\/(feedback|reviews)\/([a-z0-9]+)$/i))&&req.method==='POST'){
      const data=await body(req),action=data.action||data.verdict;
      const result=finder.feedback(match[2],action,data.reason);return json(res,200,{ok:true,...result,verdict:result.meme?.reviewStatus,stats:stats()});
    }
    if(p==='/api/undo'&&req.method==='POST'){const data=await body(req);return json(res,200,{meme:finder.undo(data.eventId)});}
    if((match=p.match(/^\/api\/seen\/([a-z0-9]+)$/i))&&req.method==='POST'){finder.store.markSeen(match[1]);notify('seen');return json(res,200,{ok:true});}
    if(p==='/api/discord/preview')return json(res,200,{...delivery.status(),memes:delivery.preview()});
    if((match=p.match(/^\/(?:api\/images|download)\/([a-z0-9]+)$/i))||p==='/img'){
      const meme=match?finder.get(match[1]):null;
      if(match&&(!meme||meme.removed))return json(res,404,{error:'Image not found'});
      const imageUrl=meme?.imageUrl||url.searchParams.get('u');
      const image=url.searchParams.get('size')==='thumb'?await finder.images.thumbnail(imageUrl):await finder.images.get(imageUrl);
      if(!image)return json(res,502,{error:'This image is unavailable. Try opening the Reddit post.'});
      res.setHeader('Content-Type',image.type);res.setHeader('Cache-Control','private, max-age=86400');
      if(p.startsWith('/download/')){const ext=image.type.includes('png')?'png':image.type.includes('webp')?'webp':image.type.includes('gif')?'gif':'jpg';res.setHeader('Content-Disposition','attachment; filename="meme-'+meme.id+'.'+ext+'"');}
      res.end(image.buf);return;
    }
    return json(res,404,{error:'Not found'});
  }catch(error){logger.warn('Request failed',req.method,req.url?.split('?')[0],error.message);if(!res.headersSent)json(res,error.message==='Meme not found'?404:400,{error:error.message});else res.end();}
});
server.requestTimeout=20000;server.headersTimeout=15000;
server.on('error',error=>{logger.error(error.code==='EADDRINUSE'?'Port is already in use. The existing app may still be running.':error.message);void shutdown(1);});
server.listen(Number(process.env.PORT??8321),'127.0.0.1',()=>{
  logger.log('Reddit collector ready at http://localhost:'+server.address().port);
  process.send?.({port:server.address().port});
  if(process.env.MEME_LEGACY_REDIRECT_PORT){
    const destination=new URL(process.env.X_MEDIA_URL||'http://127.0.0.1:3000');
    if(!['localhost','127.0.0.1','[::1]'].includes(destination.hostname))throw Error('The merged app URL must be local.');
    legacyRedirect=createServer((req,res)=>{
      const url=new URL(req.url,'http://127.0.0.1');
      const page=url.pathname.replace(/^\//,'');
      const next=['saved','review','tv','settings','explore'].includes(page)?'/reddit/'+page:page.startsWith('api/')?'/api/reddit/'+page.slice(4):page.startsWith('download/')?'/api/reddit/'+page:'/reddit';
      res.writeHead(307,{Location:destination.origin+next+url.search,'Cache-Control':'no-store'});res.end();
    });
    legacyRedirect.on('error',error=>logger.warn('Old bookmark redirect unavailable:',error.message));
    legacyRedirect.listen(Number(process.env.MEME_LEGACY_REDIRECT_PORT),'127.0.0.1');
  }
  refreshTimer=setInterval(()=>void finder.refresh(),Math.max(60000,Number(process.env.MEME_REFRESH_MS)||180000));refreshTimer.unref();
  deliveryTimer=setInterval(()=>{if(delivery.status().enabled)void delivery.sync(finder.list({view:'tv',limit:200}).memes).catch(e=>logger.error(e.message));},10000);deliveryTimer.unref();
  if(!finder.offline)setTimeout(()=>void finder.refresh(),100);
});
const heartbeat=setInterval(()=>{for(const res of clients)res.write(': heartbeat\n\n');},25000);heartbeat.unref();
async function shutdown(code=0){
  if(stopping)return;stopping=true;finder.stopping=true;finder.collector.stop();finder.images.stop();finder.vision.stop();
  clearInterval(refreshTimer);clearInterval(deliveryTimer);clearInterval(heartbeat);clearTimeout(notifyTimer);
  for(const res of clients)res.end();
  legacyRedirect?.close();legacyRedirect?.closeAllConnections();
  const closed=new Promise(resolve=>server.close(resolve));server.closeIdleConnections();
  await Promise.allSettled([finder.pendingWork,closed,...finder.images.pending.values()]);
  try{finder.store.close();}catch(e){logger.error(e.message);}release();logger.log('Finder stopped cleanly');process.exit(code);
}
process.on('SIGINT',()=>void shutdown());process.on('SIGTERM',()=>void shutdown());
process.on('unhandledRejection',error=>logger.error('Background task failed:',error?.message||error));

process.on('disconnect',()=>void shutdown());
process.on('message',message=>{if(message==='shutdown')void shutdown();});
