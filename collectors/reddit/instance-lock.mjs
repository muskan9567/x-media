import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
export function acquireLock(directory) {
  const folder=path.join(directory,'runtime');mkdirSync(folder,{recursive:true});const file=path.join(folder,'instance.lock');
  try { writeFileSync(file,String(process.pid),{flag:'wx'}); }
  catch(error) {
    if(error.code!=='EEXIST')throw error;
    const pid=Number(readFileSync(file,'utf8'));let alive=false;
    if(Number.isInteger(pid)&&pid>0){try{process.kill(pid,0);alive=true;}catch(e){if(e.code!=='ESRCH')alive=true;}}
    if(alive)throw Error('The meme finder is already running (PID '+pid+'). Use its local app or stop it before starting another collector.');
    unlinkSync(file);writeFileSync(file,String(process.pid),{flag:'wx'});
  }
  return ()=>{try{if(readFileSync(file,'utf8')===String(process.pid))unlinkSync(file);}catch{}};
}
