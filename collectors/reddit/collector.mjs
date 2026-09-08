import { normalizeMeme, redditId } from './normalize-meme.mjs';
export const SUBREDDITS=['ProgrammerHumor','ProgrammerMemes','codingmemes','ClaudeAI','ChatGPT','LocalLLaMA','DeepSeek','singularity','OpenAI','ClaudeCode','vibecoding','ChatGPTCoding','cursor','GithubCopilot'];
const DAY=86400_000;
const ROOT='https://arctic-shift.photon-reddit.com/api/posts';

export class Collector {
  constructor(store,{fetchImpl=fetch,onPosts=async()=>{},onStatus=()=>{},subreddits=SUBREDDITS,now=()=>Date.now()}={}) {
    this.store=store;this.fetch=fetchImpl;this.onPosts=onPosts;this.onStatus=onStatus;this.subs=subreddits;this.now=now;this.running=null;
    this.controller=new AbortController();this.status={refreshing:false,scanned:0,found:0,lastRefresh:null,lastRefreshError:''};
  }
  stop(){this.controller.abort();}
  async request(url) {
    const response=await this.fetch(url,{headers:{'User-Agent':'S-TIER-TV/4.0 local personal app',Accept:'application/json'},signal:AbortSignal.any([this.controller.signal,AbortSignal.timeout(8000)])});
    if(!response.ok){const error=new Error('HTTP '+response.status);error.status=response.status;
      const retry=response.headers.get('retry-after');error.retryAfter=Number(retry)*1000||Math.max(0,Date.parse(retry)-this.now())||0;throw error;}
    return response.json();
  }
  async source(id,run) {
    const prior=this.store.job(id)||{};if(prior.retryAt>this.now())return;
    this.store.job(id,{...prior,state:'running',startedAt:this.now()});this.onStatus();
    try{
      const result=await run(prior);
      this.store.job(id,{...prior,...result,state:'healthy',failures:0,error:'',retryAt:0,lastSuccess:this.now()});
    }catch(error){const failures=(prior.failures||0)+1;
      this.store.job(id,{...prior,state:'degraded',failures,error:error.message,lastAttempt:this.now(),retryAt:this.now()+Math.max(error.retryAfter||0,Math.min(3600_000,30000*2**Math.min(failures,7)))});
    }finally{this.onStatus();}
  }
  async accept(rows,source) {
    this.status.scanned+=rows.length;
    const candidates=[];
    for(const raw of rows){
      // A fresh removal observation invalidates an already-stored post immediately.
      if(raw.over_18||raw.spoiler||raw.removed_by_category||raw._meta?.was_deleted_later){
        const known=this.store.getPost(raw.id);if(known)this.store.putPost({...known,removed:true,removalObservedAt:this.now()});continue;
      }
      const normalized=normalizeMeme({...raw,discoverySource:source,observedAt:this.now()});
      if(!normalized?.imageUrl)continue;
      // Keep visual candidates from AI communities even when the title is vague.
      if(!normalized.topicRelevant&&!/claude|chatgpt|deepseek|openai|llama|vibecoding|copilot|cursor/i.test(raw.subreddit||''))continue;
      if(normalized.created && this.now() - Number(normalized.created)*1000 > 30*DAY)continue;
      candidates.push(normalized);
    }
    this.status.found+=candidates.length;
    if(candidates.length)await this.onPosts(candidates);
    this.onStatus();
  }
  async archive(sub) {
    return this.source('archive:'+sub,async prior=>{
      const backfill=!prior.backfillAt||this.now()-prior.backfillAt>=DAY;
      const after=backfill?Math.floor((this.now()-30*DAY)/1000):Math.max(Math.floor((this.now()-30*DAY)/1000),(prior.cursor||0)-3600);
      let before=null,cursor=prior.cursor||0,complete=false;
      const pages=backfill&&sub==='ProgrammerHumor'?3:backfill?1:3;
      for(let page=0;page<pages;page++){
        const params=new URLSearchParams({subreddit:sub,over_18:'false',sort:'desc',limit:backfill?'auto':'100',after:String(after)});
        if(before)params.set('before',String(before));
        let body;
        try { body=await this.request(ROOT+'/search?'+params); }
        catch(error) {
          // Archive auto-sizing can time out on sparse tail pages. One bounded
          // explicit-size query can finish that window without restarting backfill.
          if(error.status!==422||error.retryAfter||params.get('limit')!=='auto')throw error;
          params.set('limit','100');body=await this.request(ROOT+'/search?'+params);
        }
        if(!Array.isArray(body.data))throw Error('Invalid archive listing');
        const rows=body.data;await this.accept(rows,'arctic');
        if(!rows.length){complete=true;break;}
        const dates=rows.map(r=>Number(r.created_utc)).filter(Number.isFinite);
        cursor=Math.max(cursor,...dates);const oldest=Math.min(...dates);
        if(!Number.isFinite(oldest)||oldest<=after+1||rows.length<(backfill?100:100)){complete=true;break;}
        before=oldest; // Inclusive overlap; IDs deduplicate without dropping same-second posts.
      }
      return {cursor:complete||backfill?cursor:prior.cursor||after,backfillAt:backfill?this.now():prior.backfillAt};
    });
  }
  async hot(sub) {
    return this.source('hot:'+sub,async()=>{
      const data=await this.request('https://meme-api.com/gimme/'+sub+'/50');
      if(!Array.isArray(data.memes))throw Error('Invalid hot listing');
      const posts=data.memes.filter(m=>!m.nsfw&&!m.spoiler&&redditId(m.postLink)).map(m=>({id:redditId(m.postLink),title:m.title,subreddit:m.subreddit,url:m.url,score:m.ups,permalink:m.postLink,discoverySource:'hot'}));
      // Refresh dates/flair for both new posts and promising existing posts.
      const ids=posts.map(p=>p.id);
      if(ids.length){try{const details=await this.request(ROOT+'/ids?ids='+ids.join(','));await this.accept(details.data||[],'arctic');}catch{}}
      await this.accept(posts,'hot');return {};
    });
  }
  refresh() {
    if(this.running)return this.running;
    this.running=this.run().finally(()=>this.running=null);return this.running;
  }
  async run() {
    Object.assign(this.status,{refreshing:true,scanned:0,found:0,lastRefreshError:''});this.onStatus();
    try{
      const tasks=[...this.subs.map(sub=>()=>this.archive(sub)),...['ProgrammerHumor','ChatGPT','ClaudeAI','ProgrammerMemes'].map(sub=>()=>this.hot(sub))];
      let index=0;await Promise.all(Array.from({length:4},async()=>{while(index<tasks.length&&!this.controller.signal.aborted)await tasks[index++]();}));
      if(!this.status.found&&!this.controller.signal.aborted){
        await this.source('reddit-json',async()=>{
          for(const sub of this.subs.slice(0,3)){
            const body=await this.request('https://www.reddit.com/r/'+sub+'/top.json?t=week&limit=100&raw_json=1');
            await this.accept((body.data?.children||[]).map(c=>c.data),'reddit-json');
          }return {};
        });
      }
      if(!this.status.found)this.status.lastRefreshError='No new candidates this time. Saved finds remain available.';
    }catch(error){this.status.lastRefreshError=error.message;}
    finally{this.status.refreshing=false;this.status.lastRefresh=this.now();this.store.meta('collector-status',this.status);this.onStatus();}
  }
}
