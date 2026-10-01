import type { Opportunity } from '../model.ts';
import { key } from '../normalization/index.ts';
import { locationKey } from '../matching/location.ts';
export const companyKey=(s:string)=>key(s).replace(/\b(inc|incorporated|pvt|private|ltd|limited|llc|corporation)\b\.?/g,'').replace(/\s+/g,' ').trim();
const tokens=(s:string)=>new Set(key(s).split(' ').filter(Boolean));
function similarity(a:string,b:string){const x=tokens(a),y=tokens(b);return [...x].filter(t=>y.has(t)).length/Math.max(1,new Set([...x,...y]).size);}
export function similar(a:Opportunity,b:Opportunity):boolean {
  if(a.type!==b.type||!companyKey(a.companyOrClient)||companyKey(a.companyOrClient)!==companyKey(b.companyOrClient))return false;
  if(a.employerJobId&&b.employerJobId)return a.employerJobId===b.employerJobId;
  if(a.postedAt&&b.postedAt&&Math.abs(Date.parse(a.postedAt)-Date.parse(b.postedAt))>7*86400000)return false;
  const title=(s:string)=>key(s).replace(/\b(sr|jr)\b/g,t=>t==='sr'?'senior':'junior');
  if(similarity(title(a.title),title(b.title))<0.8)return false;
  const x=locationKey(a.location),y=locationKey(b.location);
  if(!x||!y||!(x===y||x.includes(y)||y.includes(x)))return false;
  return tokens(a.description).size>=20&&tokens(b.description).size>=20&&similarity(a.description,b.description)>=0.75;
}
export function authority(o:Opportunity):number {
  if(o.authority==='employer')return 3;
  if(/(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com|myworkdayjobs\.com)$/.test(new URL(o.canonicalUrl).hostname))return 3;
  return o.authority==='aggregator'?1:0;
}
