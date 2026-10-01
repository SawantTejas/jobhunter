import type { OpportunitySource, Profile, RawOpportunity, RegistryEntry, SourceContext } from '../model.ts';
import { contains } from '../normalization/index.ts';
export type Obj=Record<string,unknown>;
export const obj=(v:unknown):Obj=>v!==null&&typeof v==='object'?v as Obj:{};
export const str=(v:unknown):string=>typeof v==='string'?v:'';
export function rows(v:unknown):Obj[]{if(!Array.isArray(v))throw new Error('Expected jobs array in source response');return v.map(obj);}
export function timestamp(v:unknown):string|undefined {
  if(typeof v!=='number'&&typeof v!=='string')return;
  // Zoned ISO strings and documented Unix timestamps only; don't assume a timezone.
  if(typeof v==='string'&&!/^\d{4}-\d\d-\d\d$|[zZ]$|[+-]\d\d:\d\d$/.test(v))return;
  const date=new Date(typeof v==='number'&&v<1e12?v*1000:v);return Number.isFinite(date.getTime())?date.toISOString():undefined;
}
export function structuredSource(e:RegistryEntry,p?:Profile):OpportunitySource|undefined {
  if(!['smartrecruiters','remotive','jobicy','himalayas'].includes(e.adapter))return;
  const notes:string[]=[];
  return {name:e.id,notes,async discover(c:SourceContext){
    notes.length=0;
    if(e.adapter==='smartrecruiters') {
      const base=`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(e.board)}/postings`;
      const summaries:Obj[]=[];const maxPages=e.maxPages??6, maxDetails=e.maxDetails??25;
      for(let page=0;page<maxPages;page++){
        const data=obj(await c.getJson(`${base}?country=in&limit=100&offset=${page*100}`));const batch=rows(data.content);summaries.push(...batch);
        if(batch.length<100||summaries.length>=Number(data.totalFound))break;
        if(page===maxPages-1)notes.push(`PARTIAL: capped at ${maxPages} listing pages (${data.totalFound} available)`);
      }
      const terms=[...(p?.targetTitles??[]),...(p?.relatedTitles??[]),...(p?.strongSkills??[]),'software','developer','engineer'];
      const candidates=summaries.filter(j=>terms.some(t=>contains(str(j.name),t)))
        .sort((a,b)=>Number(Date.parse(str(b.releasedDate))>Date.now()-8*86400000)-Number(Date.parse(str(a.releasedDate))>Date.now()-8*86400000)||Number((p?.strongSkills??[]).some(s=>contains(str(b.name),s)))-Number((p?.strongSkills??[]).some(s=>contains(str(a.name),s)))||Date.parse(str(b.releasedDate))-Date.parse(str(a.releasedDate)));
      if(candidates.length>maxDetails)notes.push(`PARTIAL: fetched ${maxDetails}/${candidates.length} software detail records; increase maxDetails for full coverage`);
      const result:RawOpportunity[]=[];
      for(const row of candidates.slice(0,maxDetails))try {
        const j=obj(await c.getJson(`${base}/${encodeURIComponent(str(row.id))}`));const loc=obj(j.location);const sections=obj(obj(j.jobAd).sections);
        result.push({externalId:str(j.id)||str(row.id),employerJobId:str(j.refNumber),title:str(j.name),companyOrClient:str(obj(j.company).name)||e.company,
          description:Object.values(sections).map(s=>str(obj(s).text)).join(' '),location:[str(loc.city),str(loc.region),str(loc.country)==='in'?'India':str(loc.country)].filter(Boolean).join(', '),
          remoteType:loc.remote===true?'remote':'unknown',employmentType:str(obj(j.typeOfEmployment).label),sourceUrl:str(j.applyUrl)||`https://jobs.smartrecruiters.com/${encodeURIComponent(e.board)}/${encodeURIComponent(str(j.id)||str(row.id))}`,
          postedAt:timestamp(j.releasedDate??row.releasedDate),dateKind:'published',authority:'employer',original:j});
      }catch(error){notes.push(`PARTIAL: detail ${row.id} failed: ${String(error)}`);}
      if(candidates.length&&!result.length)throw new Error('All SmartRecruiters detail requests failed');
      return result;
    }
    if(e.adapter==='remotive') {
      notes.push('Feed delayed by provider by 24h; publication time is on Remotive, not necessarily the employer posting time. Unzoned dates remain unknown.');
      const data=obj(await c.getJson('https://remotive.com/api/remote-jobs?category=software-dev',6*3600000));
      return rows(data.jobs).map(j=>({externalId:String(j.id??''),title:str(j.title),companyOrClient:str(j.company_name),description:str(j.description),sourceUrl:str(j.url),location:str(j.candidate_required_location),remoteType:'remote',employmentType:str(j.job_type),postedAt:timestamp(j.publication_date),dateKind:'published',authority:'aggregator',original:j} satisfies RawOpportunity));
    }
    if(e.adapter==='jobicy') {
      const data=obj(await c.getJson('https://jobicy.com/api/v2/remote-jobs?count=100',3600000));
      notes.push('PARTIAL: latest 100 remote listings; unzoned publication dates remain unknown.');
      return rows(data.jobs).map(j=>({externalId:String(j.id??''),title:str(j.jobTitle),companyOrClient:str(j.companyName),description:str(j.jobDescription),sourceUrl:str(j.url),location:str(j.jobGeo),remoteType:'remote',employmentType:Array.isArray(j.jobType)?str(j.jobType[0]):str(j.jobType),postedAt:timestamp(j.pubDate),dateKind:'published',authority:'aggregator',original:j} satisfies RawOpportunity));
    }
    const result:RawOpportunity[]=[];
    // Profile-derived keywords; explicit IN filter is retained in returned geography.
    const terms=[...new Set(p?.strongSkills?.length?p.strongSkills:['software'])].slice(0,3);
    for(const term of terms){
      const data=obj(await c.getJson(`https://himalayas.app/jobs/api/search?country=IN&exclude_worldwide=true&sort=recent&q=${encodeURIComponent(term)}&page=1`,86400000));
      for(const j of rows(data.jobs)){
        const restrictions=Array.isArray(j.locationRestrictions)?j.locationRestrictions:[];
        const locations=restrictions.map(l=>typeof l==='string'?l:str(obj(l).name)||str(obj(l).alpha2));
        result.push({externalId:str(j.guid)||str(j.applicationLink),title:str(j.title),companyOrClient:str(j.companyName),description:str(j.description)||str(j.excerpt),sourceUrl:str(j.applicationLink),
          location:locations.length?locations.map(x=>x==='IN'?'India':x).join(', '):'Worldwide',remoteType:'remote',employmentType:str(j.employmentType),postedAt:timestamp(j.pubDate),dateKind:'published',authority:'aggregator',closed:!!timestamp(j.expiryDate)&&Date.parse(timestamp(j.expiryDate)!)<Date.now(),original:j});
      }
    }
    notes.push('PARTIAL: first page for up to 3 profile core-skill queries; provider refreshes daily.');
    return [...new Map(result.map(r=>[r.externalId,r])).values()];
  }};
}
