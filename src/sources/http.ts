import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { SourceContext } from '../model.ts';
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {dirname} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
export class HttpClient implements SourceContext {
  cacheDir:string; lastRequest=0;
  private options:{retries?:number;minIntervalMs?:number;followRedirects?:boolean};
  constructor(cacheDir:string,options:{retries?:number;minIntervalMs?:number;followRedirects?:boolean}={}){this.cacheDir=cacheDir;this.options=options;}
  checkpoint(key:string,value?:unknown):unknown {
    const dir=join(this.cacheDir,'checkpoints');mkdirSync(dir,{recursive:true});const path=join(dir,createHash('sha256').update(key).digest('hex')+'.json');
    if(value!==undefined){writeFileSync(path+'.tmp',JSON.stringify(value));renameSync(path+'.tmp',path);return value;}
    if(existsSync(path))return JSON.parse(readFileSync(path,'utf8'));
    // One-time continuity from existing source observations, avoiding the already fetched first detail batch.
    const dbPath=join(dirname(this.cacheDir),'opportunities.sqlite');
    if(key.startsWith('smartrecruiters:')&&existsSync(dbPath)){
      const db=new DatabaseSync(dbPath,{readOnly:true});try{return {done:Object.fromEntries(db.prepare('SELECT externalId,lastSeenAt FROM opportunity_sources WHERE source=?').all(key.slice(16)).map(r=>[String(r.externalId),Date.parse(String(r.lastSeenAt))]))};}finally{db.close();}
    }
    return undefined;
  }
  async getJson(url:string,ttlMs=3600000):Promise<unknown> {
    return this.request(url,ttlMs,false);
  }
  async getText(url:string,ttlMs=3600000):Promise<string> {
    return this.request(url,ttlMs,true) as Promise<string>;
  }
  private async request(url:string,ttlMs:number,plain:boolean):Promise<unknown> {
    await mkdir(this.cacheDir,{recursive:true});
    const path=join(this.cacheDir,createHash('sha256').update((plain?'text:':'')+url).digest('hex')+'.json');
    try {const cached=JSON.parse(await readFile(path,'utf8')); if(Date.now()-cached.at<ttlMs)return cached.data;} catch{}
    const retries=this.options.retries??2;
    for(let attempt=0;attempt<=retries;attempt++) {
      await sleep(Math.max(0,(this.options.minIntervalMs??1000)-(Date.now()-this.lastRequest))); this.lastRequest=Date.now();
      let response:Response;
      try {response=await fetch(url,{signal:AbortSignal.timeout(20000),redirect:plain||this.options.followRedirects===false?'error':'follow',headers:{'User-Agent':'LocalOpportunityAgent/0.1','Accept':plain?'text/html,text/plain':'application/json'}});} catch(error) {if(attempt===retries)throw error;await sleep(1000*2**attempt);continue;}
      if(response.status===429 || response.status>=500) {
        const retry=response.headers.get('retry-after'); const delay=retry?(Number.isFinite(Number(retry))?Number(retry)*1000:Date.parse(retry)-Date.now()):1000*2**attempt;
        if(attempt===retries || delay>60000)throw new Error(`HTTP ${response.status}; retry later (${retry??'retry limit'})`);
        await sleep(Math.max(1000,Number.isFinite(delay)?delay:1000));continue;
      }
      if(!response.ok)throw new Error(`HTTP ${response.status} for ${new URL(url).hostname}`);
      const body=await response.text(); if(body.length>25_000_000)throw new Error('Response exceeds 25 MB');
      const data:unknown=plain?body:JSON.parse(body); await writeFile(path,JSON.stringify({at:Date.now(),data}));return data;
    }
    throw new Error('Request failed');
  }
}
