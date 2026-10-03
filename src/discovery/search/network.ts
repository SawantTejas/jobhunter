import {lookup} from 'node:dns/promises';
import {get} from 'node:https';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {SourceContext} from '../../model.ts';
import {url as normalizeUrl} from '../../normalization/index.ts';
import {robotsAllowed} from '../../sources/company-page.ts';
export function candidateUrl(value:string):string {
  const u=new URL(normalizeUrl(value));
  if(u.protocol!=='https:'||u.port||!u.hostname.includes('.')||/[\[\]:]/.test(u.hostname)||/^(localhost|127\.|0\.|10\.|192\.168\.)|\.(localhost|local|internal|test|invalid)$/i.test(u.hostname))throw new Error('Not a public HTTPS candidate URL');
  return u.toString();
}
// Identity normalization is not safe for HTTP routing: /job and /job/ may differ.
export function transportUrl(value:string):string {candidateUrl(value);const u=new URL(value);u.hash='';return u.toString();}
export function publicIPv4(address:string):boolean {
  const octets=address.split('.').map(Number);if(octets.length!==4||octets.some(n=>!Number.isInteger(n)||n<0||n>255))return false;
  const [a,b,c]=octets;return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===88&&c===99)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
}
// Untrusted search-result URLs must never reach loopback/LAN/cloud metadata.
// Resolve once, reject private addresses, and pin that address to the TLS request.
export class PublicPageClient implements SourceContext {
  private lastRequest=0;private blocked=new Set<string>();
  protected minimumIntervalMs=1500;
  constructor(cacheDir:string){this.cacheDir=cacheDir;}private cacheDir:string;
  redirects:{from:string;to:string;status:number}[]=[];
  async getText(value:string,ttl=6*3600000,hops=0):Promise<string>{
    if(hops>5)throw new Error('redirect limit/security rejected');
    const valueUrl=transportUrl(value),u=new URL(valueUrl);if(this.blocked.has(u.hostname))throw new Error('Host stopped after denial/rate limit');
    const file=join(this.cacheDir,createHash('sha256').update(valueUrl).digest('hex')+'.json');
    try{const old=JSON.parse(await readFile(file,'utf8'));if(Date.now()-old.at<ttl&&typeof old.body==='string')return old.body;}catch{}
    const addresses=await this.resolveHost(u.hostname);if(!addresses.length||addresses.some(a=>!publicIPv4(a.address)))throw new Error('Candidate resolves to a non-public address');
    await new Promise(r=>setTimeout(r,Math.max(0,this.minimumIntervalMs-(Date.now()-this.lastRequest))));this.lastRequest=Date.now();
    const response=await this.requestPage(u,addresses);
    let body:string;
    if(typeof response==='string')body=response;
    else {
      const target=transportUrl(new URL(response.location,u).toString()),next=new URL(target);
      // Every destination is revalidated and DNS-pinned by getText. Check its robots policy first.
      // A robots.txt redirect is itself a policy lookup and cannot recursively request robots.txt.
      if(u.pathname!=='/robots.txt'){
        let policy='';try{policy=await this.getText(next.origin+'/robots.txt',86400000,hops+1);}catch(e){if(!/^Error: HTTP 404$/.test(String(e)))throw new Error('Robots policy unavailable: '+String(e));}
        if(!robotsAllowed(policy,next.pathname+next.search))throw new Error('Robots policy disallows redirected page');
      }
      body=await this.getText(target,ttl,hops+1);this.redirects.push({from:valueUrl,to:target,status:response.status});
      // Do not cache redirected bodies under the old URL: future requests must recheck target policy.
      return body;
    }
    await mkdir(this.cacheDir,{recursive:true});await writeFile(file,JSON.stringify({at:Date.now(),body}));return body;
  }
  protected resolveHost(host:string){return lookup(host,{family:4,all:true});}
  protected async requestPage(u:URL,addresses:{address:string;family:number}[]):Promise<string|{location:string;status:number}>{
    return new Promise<string|{location:string;status:number}>((resolve,reject)=>{
      const req=get(u,{agent:false,family:4,signal:AbortSignal.timeout(20000),lookup:(_host,_opts,cb)=>cb(null,addresses[0].address,4),headers:{'User-Agent':'LocalOpportunityAgent/0.4','Accept':'text/html,application/ld+json,application/json,text/plain','Accept-Encoding':'identity'}},res=>{
        const status=res.statusCode??0;if(status===401||status===403||status===429)this.blocked.add(u.hostname);
        if([301,302,303,307,308].includes(status)&&res.headers.location){res.resume();resolve({location:res.headers.location,status});return;}
        if(status<200||status>=300){res.resume();reject(new Error(`HTTP ${status}${status>=300&&status<400?' redirect not followed':''}`));return;}
        const chunks:Buffer[]=[];let size=0;res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>5_000_000){req.destroy(new Error('Page exceeds 5 MB'));return;}chunks.push(chunk);});res.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));res.on('error',reject);
      });req.on('error',reject);
    });
  }
  async getJson(value:string,ttl?:number):Promise<unknown>{return JSON.parse(await this.getText(value,ttl));}
}
