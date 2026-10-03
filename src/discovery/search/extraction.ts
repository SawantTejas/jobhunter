import type {RawOpportunity,SourceContext,Profile,RegistryEntry} from '../../model.ts';
import {createSource} from '../../sources/index.ts';
import {robotsAllowed} from '../../sources/company-page.ts';
import {parseRecords} from '../web.ts';
import {text,url} from '../../normalization/index.ts';
import {candidateUrl} from './network.ts';
import {identifyAts,registryEntry} from './registry.ts';
import {obj,smartRecruitersRecord} from '../../sources/structured.ts';
export interface Extraction {records:RawOpportunity[];links:string[];registration?:RegistryEntry}
export function validJob(r:RawOpportunity):boolean{return !!text(r.title)&&!!text(r.companyOrClient)&&text(r.description).length>=40;}
// Search engines often return category pages. Schema ItemList links are candidates,
// not jobs: follow a bounded set on the same public site and validate each separately.
export function extractListingLinks(html:string,page:string):string[]{
  const links:string[]=[],host=new URL(page).hostname;
  function visit(v:unknown){
    if(Array.isArray(v)){v.forEach(visit);return;}if(!v||typeof v!=='object')return;
    const j=v as Record<string,unknown>;if(j['@graph'])visit(j['@graph']);
    const types=Array.isArray(j['@type'])?j['@type']:[j['@type']];
    if(types.includes('ItemList')&&Array.isArray(j.itemListElement))for(const item of j.itemListElement){
      const entry=obj(item),nested=entry.item,value=entry.url??(typeof nested==='string'?nested:obj(nested).url);
      if(typeof value!=='string')continue;
      try{const link=candidateUrl(new URL(value,page).toString()),u=new URL(link);if(u.hostname===host&&link!==page&&/\/(?:jobs?|careers?|positions?|openings?|vacanc(?:y|ies)|projects?)(?:\/|-)/i.test(u.pathname))links.push(link);}catch{}
    }
  }
  for(const s of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))try{visit(JSON.parse(s[1]));}catch{}
  return [...new Set(links)].slice(0,10);
}
export function extractJsonLd(html:string,page:string):RawOpportunity[]{
  const result:RawOpportunity[]=[];
  function visit(v:unknown){if(Array.isArray(v)){v.forEach(visit);return;}if(!v||typeof v!=='object')return;const j=v as Record<string,unknown>;if(j['@graph'])visit(j['@graph']);const types=Array.isArray(j['@type'])?j['@type']:[j['@type']];if(!types.includes('JobPosting'))return;
    try{const resolved={...j,url:typeof j.url==='string'?new URL(j.url,page).toString():page};for(const r of parseRecords(JSON.stringify(resolved),page)){candidateUrl(r.sourceUrl);if(validJob(r))result.push(r);}}catch{}
  }
  for(const s of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))try{visit(JSON.parse(s[1]));}catch{}
  return result;
}
export async function extractCandidate(page:string,c:SourceContext,p:Profile,followListingLinks=true):Promise<Extraction>{
  page=candidateUrl(page);const target=identifyAts(page);
  if(target){
    const entry=registryEntry(target,page,target.board);
    // A specific search result must not be lost to an India-only board query or detail cap.
    const rows=target.adapter==='smartrecruiters'&&target.jobId
      ?[smartRecruitersRecord(obj(await c.getJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(target.board)}/postings/${encodeURIComponent(target.jobId)}`)),entry)]
      :await createSource(entry,p).discover(c);
    const records=rows.filter(r=>validJob(r)&&(!target.jobId||r.externalId===target.jobId||url(r.sourceUrl)===url(page)));
    for(const r of records)candidateUrl(r.sourceUrl);
    if(!records.length)throw new Error('ATS endpoint returned no matching validated job');
    return {records,links:[],registration:{...entry,company:records[0].companyOrClient}};
  }
  if(!c.getText)throw new Error('Public page transport unavailable');const u=new URL(page);let robots:string;
  try{robots=await c.getText(u.origin+'/robots.txt',86400000);}catch(error){if(/^Error: HTTP 404$/.test(String(error)))robots='';else throw new Error('Robots policy unavailable: '+String(error));}
  if(!robotsAllowed(robots,u.pathname+u.search))throw new Error('Robots policy disallows this page');
  const html=await c.getText(page);if(/<title[^>]*>[^<]*(?:captcha|access denied|just a moment|sign in)/i.test(html))throw new Error('Authentication or anti-bot challenge; no bypass attempted');
  const structured=extractJsonLd(html,page);
  const records=structured.map(r=>({...r,sourceUrl:page,canonicalUrl:new URL(r.sourceUrl).hostname===u.hostname?r.sourceUrl:page,authority:'import' as const}));
  // Only follow visible links to recognized public ATS hosts, never arbitrary recursive crawling.
  const links=[...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi)].flatMap(m=>{try{const link=candidateUrl(new URL(m[1].replace(/&amp;/g,'&'),page).toString());return identifyAts(link)?[link]:[];}catch{return [];}});
  links.push(...structured.map(r=>r.sourceUrl).filter(value=>identifyAts(value)));
  if(followListingLinks)links.push(...extractListingLinks(html,page));
  return {records,links:[...new Set(links)].slice(0,10),...(records.length?{registration:registryEntry(undefined,page,records[0].companyOrClient)}:{})};
}
