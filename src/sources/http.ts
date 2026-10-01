import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { SourceContext } from '../model.ts';
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
export class HttpClient implements SourceContext {
  cacheDir:string; lastRequest=0;
  constructor(cacheDir:string){this.cacheDir=cacheDir;}
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
    for(let attempt=0;attempt<3;attempt++) {
      await sleep(Math.max(0,1000-(Date.now()-this.lastRequest))); this.lastRequest=Date.now();
      let response:Response;
      try {response=await fetch(url,{signal:AbortSignal.timeout(20000),redirect:plain?'error':'follow',headers:{'User-Agent':'LocalOpportunityAgent/0.1','Accept':plain?'text/html,text/plain':'application/json'}});} catch(error) {if(attempt===2)throw error;await sleep(1000*2**attempt);continue;}
      if(response.status===429 || response.status>=500) {
        const retry=response.headers.get('retry-after'); const delay=retry?(Number.isFinite(Number(retry))?Number(retry)*1000:Date.parse(retry)-Date.now()):1000*2**attempt;
        if(attempt===2 || delay>60000)throw new Error(`HTTP ${response.status}; retry later (${retry??'retry limit'})`);
        await sleep(Math.max(1000,Number.isFinite(delay)?delay:1000));continue;
      }
      if(!response.ok)throw new Error(`HTTP ${response.status} for ${new URL(url).hostname}`);
      const body=await response.text(); if(body.length>25_000_000)throw new Error('Response exceeds 25 MB');
      const data:unknown=plain?body:JSON.parse(body); await writeFile(path,JSON.stringify({at:Date.now(),data}));return data;
    }
    throw new Error('Request failed');
  }
}
