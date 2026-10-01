import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Profile, RawOpportunity } from '../model.ts';
import { obj,str } from '../sources/structured.ts';
import { url,extractSkills,canonicalSkill } from '../normalization/index.ts';
export interface DomainEntry {domain:string;mode:'adapter'|'discovery-only'|'unavailable';kind:'employment'|'freelance';note:string}
export interface WebQuery {id:string;domain:string;query:string;searchUrl:string}
export function loadDomains():DomainEntry[]{
  const domains=JSON.parse(readFileSync(new URL('../../config/domains.json',import.meta.url),'utf8')) as DomainEntry[];
  if(!Array.isArray(domains)||domains.some(d=>!/^([a-z0-9-]+\.)+[a-z]{2,}(\/[a-z0-9/-]+)?$/.test(d.domain)||!['adapter','discovery-only','unavailable'].includes(d.mode)||!['employment','freelance'].includes(d.kind)))throw new Error('Invalid domain registry');
  return domains;
}
export function generateQueries(p:Profile,domains:DomainEntry[],limit=31,offset=0):WebQuery[]{
  if(!Number.isInteger(limit)||limit<1||limit>200||!Number.isInteger(offset)||offset<0)throw new Error('Query limit must be 1–200; offset must be nonnegative');
  domains=domains.filter(d=>d.mode!=='unavailable');if(!domains.length)return [];
  const roles=[...new Set([...p.targetTitles,...p.relatedTitles,...p.strongSkills.map(s=>`${s} developer`)])].filter(Boolean);
  if(!roles.length)return [];
  const skills=[...new Set(p.strongSkills.length?p.strongSkills:p.skills)];
  const places=p.indiaFirst?['"Mumbai"','"Navi Mumbai"','("Bengaluru" OR "Bangalore")','"Pune"','"Hyderabad"','"Remote India"','"India"','(remote AND (worldwide OR APAC OR Asia))']:(p.preferredLocations.length?p.preferredLocations:['remote']).map(x=>JSON.stringify(x));
  const results:WebQuery[]=[];const seen=new Set<string>();
  // Domain-first round robin: all domains get coverage before repeating combinations.
  const total=domains.length*roles.length*places.length;
  for(let n=0;n<Math.min(total,limit);n++){const i=(offset+n)%total;
    const d=domains[i%domains.length];if(d.mode==='unavailable')continue;
    const round=Math.floor(i/domains.length),domainIndex=i%domains.length,role=roles[(round+domainIndex)%roles.length],place=places[(Math.floor(round/roles.length)+domainIndex)%places.length];
    const roleSkills=extractSkills(role);
    const skill=skills.find(s=>roleSkills.includes(canonicalSkill(s)))??roleSkills.find(s=>[...p.skills,...p.strongSkills,...p.secondarySkills].map(canonicalSkill).includes(s))??skills[Math.floor(round/roles.length/places.length)%Math.max(1,skills.length)]??'';
    const query=`site:${d.domain} ${role} ${roleSkills.length?'':skill} ${d.kind==='freelance'?'(freelance OR contract OR project) (India OR worldwide OR remote)':place+' jobs'}`.replace(/\s+/g,' ').trim();
    if(seen.has(query))continue;seen.add(query);
    const id=createHash('sha256').update(query).digest('hex').slice(0,16);
    results.push({id,domain:d.domain,query,searchUrl:`https://www.google.com/search?q=${encodeURIComponent(query)}`});
  }
  return results;
}
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function writeWebPlan(p:Profile,dataDir:string,limit=31,offset=0,domain?:string){
  const domains=loadDomains().filter(d=>!domain||d.domain===domain);
  const queries=generateQueries(p,domains,limit,offset);mkdirSync(dataDir,{recursive:true});
  writeFileSync(join(dataDir,'web-queries.json'),JSON.stringify(queries,null,2));
  writeFileSync(join(dataDir,'web-discovery.html'),`<!doctype html><meta charset="utf-8"><title>Opportunity search plan</title><h1>Domain-targeted discovery</h1><p>These are search links, not ingested opportunities. Open selected searches in your browser. Search-engine recency is not proof of posting age. Import confirmed listings with the CLI.</p><ol>${queries.map(q=>`<li><a href="${escape(q.searchUrl)}" target="_blank" rel="noreferrer">${escape(q.query)}</a></li>`).join('\n')}</ol>`);
  return queries;
}
// Accept saved public page HTML/JSON-LD, or manually confirmed RawOpportunity
// arrays. Search snippets alone are never promoted to confirmed job records.
export function importRecords(path:string):RawOpportunity[]{
  return parseRecords(readFileSync(path,'utf8'));
}
export function parseRecords(content:string,fallbackUrl?:string):RawOpportunity[]{
  const records:unknown[]=[];
  if(/^\s*</.test(content)){
    for(const match of content.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))records.push(JSON.parse(match[1]));
  }else records.push(JSON.parse(content));
  const result:RawOpportunity[]=[];
  function visit(value:unknown){
    if(Array.isArray(value)){value.forEach(visit);return;}
    const j=obj(value);if(j['@graph'])visit(j['@graph']);
    if(j.externalId&&j.sourceUrl){result.push(j as unknown as RawOpportunity);return;}
    const types=Array.isArray(j['@type'])?j['@type']:[j['@type']];if(!types.includes('JobPosting'))return;
    const sourceUrl=url(str(j.url)||fallbackUrl||'');const locs=Array.isArray(j.jobLocation)?j.jobLocation:[j.jobLocation];
    const place=locs.map(l=>{const a=obj(obj(l).address);const country=typeof a.addressCountry==='string'?a.addressCountry:str(obj(a.addressCountry).name);return [str(a.addressLocality),str(a.addressRegion),country==='IN'?'India':country].filter(Boolean).join(', ');}).filter(Boolean);
    const eligibility=Array.isArray(j.applicantLocationRequirements)?j.applicantLocationRequirements:[j.applicantLocationRequirements];
    place.push(...eligibility.map(l=>str(obj(l).name)).filter(Boolean));
    const identifier=typeof j.identifier==='string'?j.identifier:str(obj(j.identifier).value);
    result.push({externalId:identifier||sourceUrl,employerJobId:identifier||undefined,title:str(j.title),companyOrClient:str(obj(j.hiringOrganization).name),description:str(j.description),sourceUrl,location:place.join(' / '),remoteType:j.jobLocationType==='TELECOMMUTE'?'remote':undefined,
      employmentType:Array.isArray(j.employmentType)?str(j.employmentType[0]):str(j.employmentType),postedAt:str(j.datePosted),updatedAt:str(j.dateModified),closed:!!str(j.validThrough)&&Date.parse(str(j.validThrough))<Date.now(),authority:'import',original:j});
  }
  records.forEach(visit);if(!result.length)throw new Error('No RawOpportunity or JobPosting records found. Search snippets are not imported.');return result;
}
