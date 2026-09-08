import { Store } from './store.mjs';
import { ImageCache } from './image-cache.mjs';
import { Collector } from './collector.mjs';
import { VisionJudge } from './vision.mjs';
import { normalizeMeme } from './normalize-meme.mjs';
import { rankPost, tasteProfile, selectBatch, postedAt, RANK_VERSION } from './ranking.mjs';
import { hammingDistance } from './asset-quality.mjs';

export class Finder {
  constructor(directory,{offline=false,onChange=()=>{},logger=console}={}) {
    this.store=new Store(directory);this.images=new ImageCache(this.store,{offline});this.vision=new VisionJudge(this.store,this.images);
    this.onChange=onChange;this.logger=logger;this.offline=offline;this.catalog=[];this.revision=1;this.pendingWork=null;this.storage={};this.stopping=false;
    this.collector=new Collector(this.store,{onPosts:posts=>this.ingest(posts),onStatus:()=>onChange('status')});
    Object.assign(this.collector.status,this.store.meta('collector-status')||{},{refreshing:false});
    const cached=this.store.meta('ranked-catalog');
    if(cached?.version===RANK_VERSION&&cached.visionInfluence===this.store.settings().visionInfluence&&Array.isArray(cached.rows)){
      const raw=new Map(this.store.posts().map(p=>[p.id,p])),reviews=this.store.reviews();
      this.catalog=cached.rows.filter(p=>raw.has(p.id)&&raw.get(p.id).imageUrl===p.imageUrl).map(p=>{
        const current=raw.get(p.id),review=reviews[p.id],accepted=review?.source==='automatic'?p.eligible:review?.verdict==='keep';
        return {...p,removed:current.removed,unavailable:current.unavailable||current.observedAt>p.observedAt,reviewStatus:review?.verdict==='reject'?'reject':accepted?'keep':'unreviewed',reviewSource:review?.source||null,favorite:Boolean(review?.favorite)};
      });
      this.profile=tasteProfile(this.store.tasteEvents(),this.catalog);this.revision=cached.revision||1;
    }else this.rebuild();
  }
  rebuild() {
    const posts=this.store.posts(), reviews=this.store.reviews();
    const normalized=posts.map(p=>{const n=normalizeMeme(p);return n?{...p,...n,asset:p.asset,assetVerified:p.assetVerified,unavailable:p.unavailable}:null;}).filter(Boolean);
    const populations=new Map();for(const p of normalized){if(!populations.has(p.subreddit))populations.set(p.subreddit,[]);populations.get(p.subreddit).push(p);}
    const useVision=this.store.settings().visionInfluence;
    this.catalog=normalized.map(post=>{
      const analysis=post.asset?.sha256?this.store.analysis(this.vision.keyFor(post)):null;
      const ranked=rankPost(post,{population:populations.get(post.subreddit),analysis,useVision,evidence:post});
      const review=reviews[post.id];
      const accepted=review?.source==='automatic'?ranked.eligible:review?.verdict==='keep';
      return {...ranked,reviewStatus:review?.verdict==='reject'?'reject':accepted?'keep':'unreviewed',reviewSource:review?.source||null,favorite:Boolean(review?.favorite)};
    }).sort((a,b)=>b.qualityScore-a.qualityScore||(b.score||0)-(a.score||0));
    // Only exact content or identical normalized pixels collapse automatically.
    const exact=new Map(), visual=new Map();
    const ordered=[...this.catalog].sort((a,b)=>Number(b.reviewStatus==='reject')-Number(a.reviewStatus==='reject'));
    for(const p of ordered){
      p.duplicateOf=null;p.similarTo=null;
      const pixelHash=p.asset?.visualVersion===2?p.asset.visualHash:null;
      const match=exact.get(p.asset?.sha256)||visual.get(pixelHash);
      if(match&&match.id!==p.id)p.duplicateOf=match.id;
      if(p.asset?.sha256)exact.set(p.asset.sha256,match||p);
      if(pixelHash)visual.set(pixelHash,match||p);
    }
    // Within two changed bits, at least two of four 16-bit blocks are identical.
    // Bucket candidates first, then verify the complete hash; avoid an all-pairs scan.
    const similarityBuckets=new Map(),similarityRows=this.catalog.filter(p=>!p.duplicateOf&&/^[a-f0-9]{16}$/i.test(p.asset?.differenceHash||''));
    for(const p of similarityRows)for(let block=0;block<4;block++){const key=block+':'+p.asset.differenceHash.slice(block*4,block*4+4);if(!similarityBuckets.has(key))similarityBuckets.set(key,[]);similarityBuckets.get(key).push(p);}
    for(const p of similarityRows){const candidates=new Set();for(let block=0;block<4;block++)for(const q of similarityBuckets.get(block+':'+p.asset.differenceHash.slice(block*4,block*4+4))||[])candidates.add(q);p.similarTo=[...candidates].find(q=>q.id!==p.id&&hammingDistance(p.asset.differenceHash,q.asset.differenceHash)<=2)?.id||null;}
    for(const p of this.catalog){if(p.eligible&&!p.removed&&!p.duplicateOf&&!reviews[p.id]){this.store.autoKeep(p.id);p.reviewStatus='keep';p.reviewSource='automatic';}}
    this.profile=tasteProfile(this.store.tasteEvents(),this.catalog);this.revision++;
    this.store.meta('ranked-catalog',{version:RANK_VERSION,visionInfluence:this.store.settings().visionInfluence,revision:this.revision,rows:this.catalog});
    this.onChange('catalog');
  }
  publicPost(p) {
    return {...p,thumbnailUrl:p.imageUrl?'/api/reddit/images/'+p.id+'?size=thumb':null,originalUrl:p.imageUrl?'/api/reddit/images/'+p.id:null};
  }
  list({view='explore',tier='',q='',source='',sort='best',cursor=0,limit=60}={}) {
    const query=String(q).slice(0,200).toLowerCase();
    let rows=this.catalog.filter(p=>!p.removed&&!p.duplicateOf&&p.reviewStatus!=='reject'&&p.assetVerified&&!p.unavailable);
    if(view==='saved')rows=rows.filter(p=>p.favorite);
    else if(view==='review')rows=rows.filter(p=>p.reviewStatus==='unreviewed');
    else if(view==='accepted'||view==='tv')rows=rows.filter(p=>p.reviewStatus==='keep');
    if(tier)rows=rows.filter(p=>p.tier===tier);
    if(source)rows=rows.filter(p=>p.subreddit===source);
    if(query)rows=rows.filter(p=>(p.title+' '+p.subreddit+' '+(p.analysis?.visibleText||'')+' '+p.tags.join(' ')).toLowerCase().includes(query));
    if(sort==='newest')rows.sort((a,b)=>postedAt(b)-postedAt(a));
    if(sort==='votes')rows.sort((a,b)=>(b.score||0)-(a.score||0));
    const start=Math.max(0,Number(cursor)||0),size=Math.min(200,Math.max(1,Number(limit)||60));
    return {memes:rows.slice(start,start+size).map(p=>this.publicPost(p)),total:rows.length,nextCursor:start+size<rows.length?String(start+size):null,revision:this.revision};
  }
  get(id){const p=this.catalog.find(p=>p.id===id);return p?this.publicPost(p):null;}
  picks({next=false}={}) {
    const reviews=this.store.reviews(),seen=this.store.seen();
    let batch=this.store.batch();
    const reserved=new Set(seen);
    if(next&&batch)batch.ids.forEach(id=>reserved.add(id));
    const candidates=selectBatch(this.catalog,{seen:reserved,reviews,profile:this.profile});
    if(!batch||next)batch=this.store.saveBatch(candidates.map(p=>p.id));
    const visible=batch.ids.map(id=>this.get(id)).filter(p=>p&&!p.removed&&!p.duplicateOf&&p.reviewStatus!=='reject'&&p.eligible&&!p.unavailable&&p.created&&Date.now()-postedAt(p)<=30*86400_000);
    const currentIds=new Set(batch.ids);
    return {batchId:batch.id,createdAt:batch.at,memes:visible,newAvailable:candidates.filter(p=>!currentIds.has(p.id)).length,
      seenIds:visible.filter(p=>seen.has(p.id)).map(p=>p.id),revision:this.revision};
  }
  feedback(id,action,reason){const eventId=this.store.feedback(id,action,reason);this.rebuild();return {eventId,meme:this.get(id)};}
  undo(eventId){const id=this.store.undo(eventId);this.rebuild();return this.get(id);}
  async ingest(posts) {
    if(this.stopping)return;
    this.store.transaction(()=>posts.forEach(p=>this.store.putPost(p)));
    // Persist discoveries immediately; a slow or broken source never blocks useful results.
    const pending=posts.map(p=>this.store.getPost(p.id)).filter(p=>!p.removed&&(!p.assetVerified||!p.assetCheckedAt)&&!(p.assetRetryAt>Date.now()))
      .sort((a,b)=>(b.qualityScore||0)-(a.qualityScore||0)).slice(0,32);
    for(let i=0;i<pending.length&&!this.stopping;i+=4){await Promise.all(pending.slice(i,i+4).map(p=>this.verify(p)));}
    if(!this.stopping)this.rebuild();
  }
  async verify(post){
    try{const verified=await this.images.verify(post);if(!this.stopping)this.store.putPost(verified);}
    catch(error){if(!this.stopping)this.store.putPost({...post,unavailable:true,assetError:error.message,assetRetryAt:Date.now()+3600_000});}
  }
  async refresh() {
    if(this.offline||this.stopping)return;
    if(this.pendingWork)return this.pendingWork;
    this.pendingWork=(async()=>{
      if(!this.legacyMigrated){await this.images.migrateLegacy();this.legacyMigrated=true;}
      await this.collector.refresh();
      const pending=this.store.posts().filter(p=>!p.removed&&(!p.assetVerified||!p.assetCheckedAt)&&!(p.assetRetryAt>Date.now()))
        .sort((a,b)=>(b.qualityScore||0)-(a.qualityScore||0)).slice(0,120);
      for(let i=0;i<pending.length&&!this.stopping;i+=4)await Promise.all(pending.slice(i,i+4).map(p=>this.verify(p)));
      if(this.stopping)return;
      this.rebuild();
      if(this.store.settings().visionEnabled){
        const available=this.catalog.filter(p=>p.assetVerified&&!p.unavailable&&!p.removed&&!p.duplicateOf&&p.reviewStatus!=='reject');
        const good=available.filter(p=>p.isMeme).slice(0,20),missed=available.filter(p=>!p.isMeme).slice(0,3);
        for(const post of [...good,...missed]){if(this.stopping)break;const result=await this.vision.analyze(post);if(result?.status==='budget-limited')break;}
        this.rebuild();
      }
      this.storage=await this.images.maintain();this.onChange('status');
    })().catch(error=>{this.logger.error('[finder]',error.message);this.collector.status.lastRefreshError=error.message;}).finally(()=>{this.pendingWork=null;this.onChange('status');});
    return this.pendingWork;
  }
  stats(){
    const active=this.catalog.filter(p=>p.reviewStatus==='keep'&&!p.removed&&!p.duplicateOf&&!p.unavailable);
    const tiers={S:0,A:0,B:0};active.forEach(p=>tiers[p.tier]++);
    const events=[...new Map(this.store.tasteEvents().map(e=>[e.post_id,e])).values()],positives=events.filter(e=>['keep','favorite'].includes(e.action)).length,decisions=events.filter(e=>['keep','favorite','reject'].includes(e.action)).length;
    return {...this.collector.status,refreshing:Boolean(this.pendingWork||this.collector.status.refreshing),total:active.length,tiers,pendingReview:this.list({view:'review',limit:1}).total,
      ready:true,backend:'arctic + hot',window:'month',revision:this.revision,sources:[...new Set(this.catalog.map(p=>p.subreddit))].sort(),
      rejected:Object.values(this.store.reviews()).filter(r=>r.verdict==='reject').length,
      saved:this.catalog.filter(p=>p.favorite).length,stored:this.catalog.length,storage:this.storage,
      taste:{explicitDecisions:decisions,positiveRate:decisions?positives/decisions:null,target:.8},vision:this.vision.status(),jobs:this.store.jobs()};
  }
}
