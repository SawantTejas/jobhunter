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
export function smartRecruitersRecord(j:Obj,e:RegistryEntry,fallback:Obj={}):RawOpportunity {
  const loc=obj(j.location),sections=obj(obj(j.jobAd).sections);
  return {externalId:str(j.id)||str(fallback.id),employerJobId:str(j.refNumber),title:str(j.name),companyOrClient:str(obj(j.company).name)||e.company,
    description:Object.values(sections).map(s=>str(obj(s).text)).join(' '),location:[str(loc.city),str(loc.region),str(loc.country).toLowerCase()==='in'?'India':str(loc.country)].filter(Boolean).join(', '),
    remoteType:loc.remote===true?'remote':'unknown',employmentType:str(obj(j.typeOfEmployment).label),sourceUrl:str(j.applyUrl)||`https://jobs.smartrecruiters.com/${encodeURIComponent(e.board)}/${encodeURIComponent(str(j.id)||str(fallback.id))}`,
    postedAt:timestamp(j.releasedDate??fallback.releasedDate),dateKind:'published',authority:'employer',original:j};
}
export function structuredSource(e:RegistryEntry,p?:Profile):OpportunitySource|undefined {
  if(!['smartrecruiters','remotive','jobicy','himalayas'].includes(e.adapter))return;
  const notes:string[]=[];
  return {name:e.id,notes,async discover(c:SourceContext){
    notes.length=0;
    if(e.adapter==='smartrecruiters') {
      const base=`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(e.board)}/postings`;
      const checkpointKey='smartrecruiters:'+e.id;const state=(c.checkpoint?.(checkpointKey)??{}) as {page?:number;pending?:Obj[];done?:Record<string,number>};
      state.done??={};state.pending??=[];let listingPage=state.page??0;
      const summaries:Obj[]=[];const maxPages=e.maxPages??6, maxDetails=e.maxDetails??25;
      for(let page=0;page<maxPages;page++){
        const data=obj(await c.getJson(`${base}?country=in&limit=100&offset=${listingPage*100}`));const batch=rows(data.content);summaries.push(...batch);
        listingPage++;state.page=listingPage;
        if(batch.length<100||listingPage*100>=Number(data.totalFound)){state.page=0;break;}
        if(page===maxPages-1)notes.push(`PARTIAL: capped at ${maxPages} listing pages (${data.totalFound} available)`);
      }
      const terms=[...(p?.targetTitles??[]),...(p?.relatedTitles??[]),...(p?.strongSkills??[]),'software','developer','engineer'];
      const combined=[...new Map([...state.pending,...summaries].map(j=>[str(j.id),j])).values()];
      const candidates=combined.filter(j=>Date.now()-(state.done![str(j.id)]??0)>86400000).filter(j=>terms.some(t=>contains(str(j.name),t)))
        .sort((a,b)=>(state.done![str(a.id)]??0)-(state.done![str(b.id)]??0)||Number(Date.parse(str(b.releasedDate))>Date.now()-8*86400000)-Number(Date.parse(str(a.releasedDate))>Date.now()-8*86400000)||Number((p?.strongSkills??[]).some(s=>contains(str(b.name),s)))-Number((p?.strongSkills??[]).some(s=>contains(str(a.name),s)))||Date.parse(str(b.releasedDate))-Date.parse(str(a.releasedDate)));
      const offset=e.detailOffset??0;state.pending=candidates;c.checkpoint?.(checkpointKey,state);
      const titleExclusions=summaries.filter(j=>!terms.some(t=>contains(str(j.name),t))).length;
      notes.push(`Listing summaries: ${summaries.length}; pending detail candidates: ${candidates.length}; title exclusions: ${titleExclusions}; detail offset: ${offset}`);
      if(candidates.length>maxDetails)notes.push(`PARTIAL: fetching up to ${maxDetails}/${candidates.length} software detail records; configure maxDetails/detailOffset for further coverage`);
      const result:RawOpportunity[]=[];
      for(const row of candidates.slice(offset,offset+maxDetails))try {
        const j=obj(await c.getJson(`${base}/${encodeURIComponent(str(row.id))}`));result.push(smartRecruitersRecord(j,e,row));state.done![str(row.id)]=Date.now();state.pending=state.pending!.filter(x=>str(x.id)!==str(row.id));c.checkpoint?.(checkpointKey,state);
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
      const key='jobicy:'+e.id;const saved=(c.checkpoint?.(key)??{}) as {cursor?:string;started?:number};
      let cursor=Date.now()-(saved.started??0)<23*3600000?saved.cursor:undefined;const started=cursor?saved.started!:Date.now();const batch:Obj[]=[];const seenCursors=new Set<string>();
      for(let page=0;page<(e.maxPages??3);page++){
        let data:Obj;try{data=obj(await c.getJson('https://jobicy.com/api/v2/remote-jobs?count=100'+(cursor?'&cursor='+encodeURIComponent(cursor):''),3600000));}catch(error){if(cursor&&/HTTP 400/.test(String(error))){c.checkpoint?.(key,{});notes.push('PARTIAL: cursor expired; next run restarts at first page');break;}throw error;}
        batch.push(...rows(data.jobs));const next=str(data.nextCursor);if(next&&seenCursors.has(next)){notes.push('PARTIAL: repeated Jobicy cursor stopped');break;}if(next)seenCursors.add(next);cursor=next||undefined;c.checkpoint?.(key,{cursor,started});
        if(!cursor){if(data.nextCursor===undefined)notes.push('PARTIAL: endpoint supplied no continuation cursor; cannot paginate safely');break;}
        if(page===(e.maxPages??3)-1)notes.push('PARTIAL: Jobicy continuation saved for next run');
      }
      return [...new Map(batch.map(j=>[String(j.id),j])).values()].map(j=>({externalId:String(j.id??''),title:str(j.jobTitle),companyOrClient:str(j.companyName),description:str(j.jobDescription),sourceUrl:str(j.url),location:str(j.jobGeo),remoteType:'remote',employmentType:Array.isArray(j.jobType)?str(j.jobType[0]):str(j.jobType),postedAt:timestamp(j.pubDate),dateKind:'published',authority:'aggregator',original:j} satisfies RawOpportunity));
    }
    const result:RawOpportunity[]=[];
    // Profile-derived keywords; explicit IN filter is retained in returned geography.
    const allTerms=[...new Set([...(p?.strongSkills??[]),...(p?.targetTitles??[]),...(p?.relatedTitles??[]),'software developer'])];
    const checkpointKey='himalayas:'+e.id;const state=(c.checkpoint?.(checkpointKey)??{offset:0,pages:{}}) as {offset:number;pages:Record<string,number>};
    const terms=Array.from({length:Math.min(allTerms.length,e.maxQueries??8)},(_,i)=>allTerms[(state.offset+i)%allTerms.length]);
    const maxPages=e.maxPages??4;let pages=0;const seen=new Set<string>();
    for(const term of terms){
      const startPage=state.pages[term]??1;
      for(let step=0;step<maxPages;step++){const page=startPage+step;
      const data=obj(await c.getJson(`https://himalayas.app/jobs/api/search?country=IN&sort=recent&q=${encodeURIComponent(term)}&page=${page}`,86400000));pages++;
      const batch=rows(data.jobs);if(!batch.length){state.pages[term]=1;c.checkpoint?.(checkpointKey,state);break;}
      const fingerprint=batch.map(j=>str(j.guid)||str(j.applicationLink)).join('|');if(seen.has(term+'|'+fingerprint)){notes.push(`PARTIAL: repeated page stopped for ${term}`);state.pages[term]=1;c.checkpoint?.(checkpointKey,state);break;}seen.add(term+'|'+fingerprint);
      for(const j of batch){
        const restrictions=Array.isArray(j.locationRestrictions)?j.locationRestrictions:[];
        const locations=restrictions.map(l=>typeof l==='string'?l:str(obj(l).name)||str(obj(l).alpha2));
        result.push({externalId:str(j.guid)||str(j.applicationLink),title:str(j.title),companyOrClient:str(j.companyName),description:str(j.description)||str(j.excerpt),sourceUrl:str(j.applicationLink),
          location:locations.length?locations.map(x=>x==='IN'?'India':x).join(', '):'Worldwide',remoteType:'remote',employmentType:str(j.employmentType),postedAt:timestamp(j.pubDate),dateKind:'published',authority:'aggregator',closed:!!timestamp(j.expiryDate)&&Date.parse(timestamp(j.expiryDate)!)<Date.now(),original:j});
      }
      state.pages[term]=page+1;c.checkpoint?.(checkpointKey,state);
      if(step===maxPages-1)notes.push(`PARTIAL: ${term} checkpoint page ${page+1} saved after ${maxPages} pages`);
      }
    }
    state.offset=(state.offset+terms.length)%allTerms.length;c.checkpoint?.(checkpointKey,state);
    notes.push(`Profile queries: ${terms.length}; pages fetched: ${pages}; India plus worldwide results; daily cache. Configure maxQueries/maxPages to expand.`);
    return [...new Map(result.map(r=>[r.externalId,r])).values()];
  }};
}
