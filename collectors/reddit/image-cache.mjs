import { readFile, writeFile, mkdir, rename, unlink, stat, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { inspectImage } from './asset-quality.mjs';

const HOSTS = new Set(['i.redd.it','preview.redd.it','external-preview.redd.it','i.imgur.com']);
const MAX_FILE = 12*1024*1024;
export class ImageCache {
  constructor(store,{fetchImpl=fetch,offline=false,memoryBytes=256*1024*1024}={}) {
    this.store=store;this.fetch=fetchImpl;this.offline=offline;this.maxMemory=memoryBytes;
    this.memory=new Map();this.pending=new Map();this.bytes=0;this.controller=new AbortController();
    this.root=path.join(store.directory,'runtime','assets');
  }
  stop(){this.controller.abort();}
  async migrateLegacy(){
    const root=path.join(this.store.directory,'runtime','images');let files;
    try{files=await readdir(root);}catch(error){if(error.code==='ENOENT')return;throw error;}
    const urls=new Map(this.store.posts().filter(p=>p.imageUrl).map(p=>[createHash('sha256').update(p.imageUrl).digest('hex')+'.json',p.imageUrl]));
    for(const name of files){
      if(this.controller.signal.aborted)break;if(!/^[a-f0-9]{64}\.json$/.test(name))continue;
      if(urls.has(name)){await this.get(urls.get(name));continue;}
      const file=path.join(root,name);try{const old=JSON.parse(await readFile(file,'utf8'));await this.save('legacy:'+name,Buffer.from(old.data,'base64'),old.type);await unlink(file);}catch(error){if(error.code!=='ENOENT')this.lastError='Legacy image migration: '+error.message;}
    }
  }
  file(hash,thumb=false) { if(!/^[a-f0-9]{64}$/.test(hash))throw Error('Invalid asset hash');return path.join(this.root,hash+(thumb?'.webp':'.bin')); }
  remember(url,entry) {
    if(this.memory.has(url)){this.bytes-=this.memory.get(url).buf.length;this.memory.delete(url);}
    this.memory.set(url,entry);this.bytes+=entry.buf.length;
    while(this.bytes>this.maxMemory&&this.memory.size){const key=this.memory.keys().next().value;this.bytes-=this.memory.get(key).buf.length;this.memory.delete(key);}
    return entry;
  }
  async get(url) {
    let parsed;try{parsed=new URL(url);}catch{return null;}
    if(parsed.protocol!=='https:'||!HOSTS.has(parsed.hostname)||parsed.username||parsed.password)return null;
    if(this.memory.has(url)){const value=this.memory.get(url);this.store.asset(url);return this.remember(url,value);}
    if(this.pending.has(url))return this.pending.get(url);
    const pending=this.load(url).catch(error=>{this.lastError=error.message;return null;}).finally(()=>this.pending.delete(url));
    this.pending.set(url,pending);return pending;
  }
  async load(url) {
    const saved=this.store.asset(url);
    if(saved){try{return this.remember(url,{buf:await readFile(this.file(saved.hash)),type:saved.type,hash:saved.hash});}catch(error){if(error.code!=='ENOENT')throw error;}}
    const legacy=path.join(this.store.directory,'runtime','images',createHash('sha256').update(url).digest('hex')+'.json');
    try {
      const old=JSON.parse(await readFile(legacy,'utf8'));
      const entry=await this.save(url,Buffer.from(old.data,'base64'),old.type);
      await unlink(legacy);return entry;
    } catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}
    if(this.offline)return null;
    const response=await this.fetch(url,{redirect:'error',signal:AbortSignal.any([this.controller.signal,AbortSignal.timeout(12000)]),headers:{'User-Agent':'S-TIER-TV/4.0 personal meme finder'}});
    if(!response.ok)throw Error('Image HTTP '+response.status);
    const type=response.headers.get('content-type')||'';
    if(!type.startsWith('image/')||Number(response.headers.get('content-length'))>MAX_FILE){await response.body?.cancel();throw Error('Invalid image response');}
    let size=0;const chunks=[];
    for await(const chunk of response.body){size+=chunk.length;if(size>MAX_FILE)throw Error('Image exceeds 12 MB');chunks.push(chunk);}
    return this.save(url,Buffer.concat(chunks),type);
  }
  async save(url,buf,type) {
    if(buf.length>MAX_FILE)throw Error('Image exceeds 12 MB');
    const hash=createHash('sha256').update(buf).digest('hex');
    await mkdir(this.root,{recursive:true});
    // Content-addressed writes are atomic and identical for concurrent URLs.
    const temp=this.file(hash)+'.'+createHash('sha256').update(url).digest('hex').slice(0,12)+'.tmp';
    await writeFile(temp,buf);await rename(temp,this.file(hash));
    this.store.asset(url,{hash,type,bytes:buf.length});
    return this.remember(url,{buf,type,hash});
  }
  async thumbnail(url) {
    const entry=await this.get(url);if(!entry)return null;
    const target=this.file(entry.hash,true);
    try{return {buf:await readFile(target),type:'image/webp'};}catch{}
    const buf=await sharp(entry.buf,{limitInputPixels:40_000_000}).rotate().resize({width:640,height:640,fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer();
    await writeFile(target,buf);return {buf,type:'image/webp'};
  }
  async verify(post) {
    const entry=await this.get(post.imageUrl);if(!entry)throw Error('Image unavailable');
    const assessment=await inspectImage(entry.buf,entry.type);
    if(!assessment.usable)throw Error(assessment.assetWarnings.join('; ')||'Unusable image');
    const pixelHash=createHash('sha256').update(`${assessment.asset.width}x${assessment.asset.height}:`);
    for await(const chunk of sharp(entry.buf,{limitInputPixels:40_000_000}).rotate().removeAlpha().raw())pixelHash.update(chunk);
    assessment.asset.visualHash=pixelHash.digest('hex');
    assessment.asset.visualVersion=2;
    return {...post,assetVerified:true,assetQualityScore:assessment.assetQualityScore,asset:assessment.asset,
      assetSignals:assessment.assetSignals,assetWarnings:assessment.assetWarnings,unavailable:false,assetCheckedAt:Date.now()};
  }
  async maintain() {
    const protectedHashes=new Set(this.store.posts().filter(p=>this.store.review(p.id)?.favorite).map(p=>p.asset?.sha256).filter(Boolean));
    const assets=this.store.db.prepare('SELECT hash,MAX(bytes) AS bytes,MAX(accessed) AS accessed FROM assets GROUP BY hash ORDER BY accessed').all();
    let expendable=0,protectedBytes=0;
    for(const a of assets){try{a.bytes=(await stat(this.file(a.hash))).size;try{a.bytes+=(await stat(this.file(a.hash,true))).size;}catch{} }catch{a.bytes=0;}
      if(protectedHashes.has(a.hash))protectedBytes+=a.bytes;else expendable+=a.bytes;}
    const limit=this.store.settings().diskCacheMB*1024*1024;
    for(const asset of assets){
      if(expendable<=limit)break;
      if(protectedHashes.has(asset.hash))continue;
      for(const thumb of [false,true])await unlink(this.file(asset.hash,thumb)).catch(error=>{if(error.code!=='ENOENT')throw error;});
      this.store.db.prepare('DELETE FROM assets WHERE hash=?').run(asset.hash);expendable-=asset.bytes;
      for(const [url,item]of this.memory)if(item.hash===asset.hash){this.memory.delete(url);this.bytes-=item.buf.length;}
    }
    return {cacheBytes:expendable,savedBytes:protectedBytes,memoryBytes:this.bytes,limitBytes:limit};
  }
}
