import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {SearchDiscoveryProvider,SearchPage,SearchQuery} from './model.ts';

// Tavily officially supports keyless search. Never use an account key here:
// this provider cannot opt into billing, even if the environment contains a key.
export class TavilyKeylessProvider implements SearchDiscoveryProvider {
  name='tavily-keyless';mode='automatic' as const;
  private cacheDir:string;private limit:number;private request:typeof fetch;private lastRequest=0;
  constructor(cacheDir:string,limit=10,request:typeof fetch=fetch){this.cacheDir=cacheDir;this.limit=Math.min(limit,20);this.request=request;}
  async search(q:SearchQuery,page:number):Promise<SearchPage>{
    // Search has no page-number parameter; query rotation supplies breadth.
    if(page!==1)return {results:[],hasMore:false};
    const body=JSON.stringify({query:q.query,search_depth:'basic',topic:'general',max_results:this.limit,
      include_answer:false,include_raw_content:false,include_images:false,auto_parameters:false,
      ...(q.domain?{include_domains:[new URL('https://'+q.domain).hostname]}:{})});
    const file=join(this.cacheDir,'tavily-'+createHash('sha256').update(body).digest('hex')+'.json');
    try{const cached=JSON.parse(await readFile(file,'utf8'));if(Date.now()-cached.at<86400000&&Array.isArray(cached.page?.results))return cached.page;}catch{}
    const cooldownFile=join(this.cacheDir,'tavily-cooldown.json');let until=0;
    try{until=Number(JSON.parse(await readFile(cooldownFile,'utf8')).until);}catch{}
    if(until>Date.now())throw new Error(`Tavily free access paused until ${new Date(until).toISOString()} after a provider limit. Direct sources still run.`);
    await new Promise(r=>setTimeout(r,Math.max(0,1500-(Date.now()-this.lastRequest))));this.lastRequest=Date.now();
    const response=await this.request('https://api.tavily.com/search',{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),
      headers:{'Content-Type':'application/json','Accept':'application/json','X-Tavily-Access-Mode':'keyless','X-Client-Source':'jobhunter-keyless'},body});
    const raw=await response.text();if(raw.length>5_000_000)throw new Error('Search response exceeds 5 MB');
    let data:{results?:unknown[];error?:{code?:string;retry_after_seconds?:number}};
    try{data=JSON.parse(raw);}catch{throw new Error(`Tavily returned non-JSON (HTTP ${response.status}); no alternate access attempted`);}
    if(!response.ok||data.error){
      if([401,403,429,432,433].includes(response.status)||data.error){
        const retry=response.headers.get('retry-after');
        const delay=data.error?.retry_after_seconds??(retry?(Number.isFinite(Number(retry))?Number(retry):(Date.parse(retry)-Date.now())/1000):86400);
        until=Date.now()+Math.max(60,Number.isFinite(delay)?delay:86400)*1000;
        await mkdir(this.cacheDir,{recursive:true});await writeFile(cooldownFile,JSON.stringify({until}));
      }
      throw new Error(`Tavily keyless search stopped (HTTP ${response.status}${data.error?.code?'; '+data.error.code:''}); ${until?'retry after '+new Date(until).toISOString():'no automatic retries'}. No paid fallback.`);
    }
    if(!Array.isArray(data.results))throw new Error('Tavily response has no results array');
    // Cache only discovery metadata; never turn returned snippets into jobs.
    const results=data.results.flatMap(value=>{const r=value as {url?:unknown;title?:unknown;content?:unknown};return typeof r?.url==='string'?[{url:r.url,...(typeof r.title==='string'?{title:r.title}:{}),...(typeof r.content==='string'?{content:r.content}:{})}]:[];}).slice(0,this.limit);
    const result:SearchPage={results,hasMore:false};await mkdir(this.cacheDir,{recursive:true});await writeFile(file,JSON.stringify({at:Date.now(),page:result}));return result;
  }
}
