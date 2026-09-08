#!/usr/bin/env node
import { readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { Store } from './store.mjs';
import { acquireLock } from './instance-lock.mjs';
import { VISION_MODEL,VISION_VERSION } from './vision.mjs';
import { evaluateHoldout } from './evaluation.mjs';
const args=process.argv.slice(2),input=args.find(a=>!a.startsWith('--'));
if(!input){console.log('Usage: node evaluate.mjs labels.json [--prepare | --activate]\nStop the app first. --prepare exports up to 80 candidate images for blind human labels.\nSet acceptable to true/false; leave split=holdout and labelSource=human.\nEvaluation uses existing shadow analyses, never makes paid requests. --activate only unlocks ranking after a pass.');process.exit(0);}
const directory=process.env.MEME_DATA_DIR||path.join(process.cwd(),'.data','reddit');let store,release;
try{
  release=acquireLock(directory);store=new Store(directory);
  if(args.includes('--prepare')){
    const groups=new Map();for(const p of store.posts().filter(p=>p.assetVerified&&!p.removed&&!p.unavailable)){if(!groups.has(p.subreddit))groups.set(p.subreddit,[]);groups.get(p.subreddit).push(p);}
    const selected=[],hashes=new Set();let added=true;while(selected.length<80&&added){added=false;for(const rows of groups.values()){const p=rows.shift();if(!p)continue;added=true;if(hashes.has(p.asset.sha256))continue;hashes.add(p.asset.sha256);selected.push({id:p.id,sha256:p.asset.sha256,imageUrl:p.imageUrl,title:p.title,subreddit:p.subreddit,split:'holdout',labelSource:'human',acceptable:null});if(selected.length>=80)break;}}
    await writeFile(input,JSON.stringify(selected,null,2),{flag:'wx'});console.log('Exported '+selected.length+' blind label candidates to '+input);
  }else{
    const raw=await readFile(input,'utf8'),labels=JSON.parse(raw);if(!Array.isArray(labels))throw Error('Labels must be an array');
    const records=labels.map(row=>{const post=store.getPost(row.id);if(post?.asset?.sha256!==row.sha256)throw Error('Image changed or missing: '+row.id);return {...row,post,analysis:store.analysis(`${row.sha256}:${VISION_MODEL}:${VISION_VERSION}`)};});
    const report={...evaluateHoldout(records),labelsHash:createHash('sha256').update(raw).digest('hex')};
    await writeFile(input+'.report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
    if(args.includes('--activate')){if(!report.passed)throw Error('Evaluation did not pass. Rankings remain unchanged.');store.meta('vision-validated',report);console.log('Validation recorded. Image ranking can now be enabled in Settings.');}
    if(!report.passed)process.exitCode=1;
  }
}catch(error){console.error(error.message);process.exitCode=1;}finally{store?.close();release?.();}
