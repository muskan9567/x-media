import { mkdirSync, existsSync, statSync, renameSync, appendFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
export function createLogger(directory) {
  const folder=path.join(directory,'runtime');mkdirSync(folder,{recursive:true});const file=path.join(folder,'finder.log');
  const write=(level,values)=>{
    const message=values.map(String).join(' ').replace(/Bearer\s+\S+/gi,'Bearer [redacted]').replace(/sk-[a-zA-Z0-9_-]+/g,'[redacted]');
    try{
      if(existsSync(file)&&statSync(file).size>2*1024*1024){
        if(existsSync(file+'.3'))unlinkSync(file+'.3');
        for(let i=2;i>=1;i--)if(existsSync(file+'.'+i))renameSync(file+'.'+i,file+'.'+(i+1));
        renameSync(file,file+'.1');
      }
      appendFileSync(file,JSON.stringify({at:new Date().toISOString(),level,message})+'\n');
    }catch{console.error('Could not write finder log');}
    console[level==='error'?'error':'log'](message);
  };
  return {log:(...args)=>write('info',args),warn:(...args)=>write('warn',args),error:(...args)=>write('error',args)};
}
