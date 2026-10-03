import {extractRequirements} from '../extraction/requirements.ts';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Opportunity, RawOpportunity } from '../model.ts';
export const dictionary = JSON.parse(readFileSync(new URL('../../config/skills.json', import.meta.url), 'utf8')) as Record<string,string[]>;
export function text(value: string): string {
  value=value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'');
  return value.replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/<[^>]*>/g,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&nbsp;/gi,' ').replace(/\s+/g,' ').trim();
}
export const key = (s: string) => text(s).toLowerCase().replace(/[^\p{L}\p{N}+#.]+/gu,' ').trim();
const patterns=new Map<string,RegExp>();
function pattern(needle:string):RegExp {
  const normalized=key(needle);const previous=patterns.get(normalized);if(previous)return previous;
  const escaped=normalized.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const expression=escaped?new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`,'i'):/(?!)/;
  patterns.set(normalized,expression);return expression;
}
const skillAliases=new Map(Object.entries(dictionary).flatMap(([name,aliases])=>[name,...aliases].map(alias=>[key(alias),name] as const)));
export function contains(haystack: string, needle: string): boolean {
  return pattern(needle).test(key(haystack));
}
export function canonicalSkill(s: string): string { return skillAliases.get(key(s))??text(s); }
export function extractSkills(s: string,allowed?:ReadonlySet<string>): string[] { const normalized=key(s);return Object.entries(dictionary).filter(([k,a])=>(!allowed||allowed.has(k))&&(k==='Go'?a:[k,...a]).some(x=>pattern(x).test(normalized))).map(([k])=>k); }
export function url(s: string): string {
  const u=new URL(s); if (!['http:','https:'].includes(u.protocol) || u.username || u.password) throw new Error('Expected a public HTTP(S) URL');
  u.hash=''; for(const k of [...u.searchParams.keys()]) if (/^(utm_|ref$|source$|tracking)/i.test(k)) u.searchParams.delete(k);
  if(/(^|\.)(lever\.co|ashbyhq\.com)$/.test(u.hostname))u.pathname=u.pathname.replace(/\/(apply|application)\/?$/,'');
  if(/(^|\.)greenhouse\.io$/.test(u.hostname))u.hostname=u.hostname.replace(/^boards\./,'job-boards.');
  u.searchParams.sort(); return u.toString().replace(/\/$/,'');
}
function date(s?: string): string | undefined { if(!s) return; const n=Date.parse(s); return Number.isFinite(n)&&n<=Date.now()+300000?new Date(n).toISOString():undefined; }
export function normalize(r: RawOpportunity, source: string, now=new Date().toISOString()): Opportunity {
  if(!r || typeof r.title!=='string' || !r.title.trim() || typeof r.externalId!=='string' || !r.externalId || typeof r.description!=='string' || typeof r.companyOrClient!=='string') throw new Error('Invalid opportunity fields');
  if(r.type && !['EMPLOYMENT','CONTRACT','FREELANCE'].includes(r.type)) throw new Error('Invalid opportunity type');
  for(const field of ['experienceMin','experienceMax','budgetMin','budgetMax'] as const)if(r[field]!==undefined&&(!Number.isFinite(r[field])||r[field]!<0))throw new Error(`Invalid ${field}`);
  if(r.skills!==undefined&&(!Array.isArray(r.skills)||!r.skills.every(x=>typeof x==='string')))throw new Error('Invalid skills');
  const requirements=r.requirements??extractRequirements(r.description);
  const description=text(r.description), location=text(r.location||requirements.location||'');
  const employment=key(r.employmentType||requirements.employmentType||'').replace(/[-\s]/g,'');
  const employmentType=employment.includes('freelance')?'freelance':employment.includes('contract')?'contract':({fulltime:'full-time',permanent:'full-time',parttime:'part-time',temporary:'temporary',intern:'internship',internship:'internship'} as Record<string,string>)[employment]??'unknown';
  const titleType=/^freelance\b|\(freelance\)/i.test(r.title)?'FREELANCE':/\bcontractual\b|\(contract\)|- contract\b/i.test(r.title)?'CONTRACT':undefined;
  const remote=key(r.remoteType||requirements.workMode||location);
  const range=description.match(/\b(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\s+years?\s+(?:of\s+)?(?:professional\s+)?experience/i);
  const minimum=description.match(/\b(\d{1,2})\+?\s+years?\s+(?:of\s+)?(?:professional\s+)?experience/i);
  return {...r,requirements,partial:r.partial??!!(r.original&&typeof r.original==='object'&&'partial' in r.original&&r.original.partial),id:randomUUID(),source,title:text(r.title),companyOrClient:text(r.companyOrClient),description,location,
    canonicalUrl:url(r.canonicalUrl??r.sourceUrl),sourceUrl:url(r.sourceUrl),postedAt:date(r.postedAt),updatedAt:date(r.updatedAt),dateKind:/^\d{4}-\d\d-\d\d$/.test(r.postedAt??'')?'date-only':r.dateKind,
    remoteType:contains(remote,'hybrid')?'hybrid':contains(remote,'remote')?'remote':/onsite|on site/.test(remote)?'onsite':'unknown',
    employmentType,type:r.type??titleType??(employmentType==='freelance'?'FREELANCE':['contract','temporary'].includes(employmentType)?'CONTRACT':'EMPLOYMENT'),
    skills:[...new Set([...(r.skills??[]).map(canonicalSkill),...extractSkills(`${r.title} ${description}`)])],
    experienceMin:r.experienceMin??requirements.experienceMin??(range?Number(range[1]):minimum?Number(minimum[1]):undefined),experienceMax:r.experienceMax??requirements.experienceMax??(range?Number(range[2]):undefined),
    firstSeenAt:now,lastSeenAt:now,discoveredAt:now,status:'NEW'};
}
