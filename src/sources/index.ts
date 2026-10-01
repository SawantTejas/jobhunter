import { readFile } from 'node:fs/promises';
import type { OpportunitySource, RawOpportunity, RegistryEntry, SourceContext, Profile } from '../model.ts';
import { structuredSource } from './structured.ts';
import { companyPage } from './company-page.ts';
type Obj = Record<string,unknown>;
const obj=(v:unknown):Obj=>v!==null&&typeof v==='object'?v as Obj:{};
const str=(v:unknown):string=>typeof v==='string'?v:'';
function rows(v:unknown): Obj[] { if(!Array.isArray(v)) throw new Error('Source response is not a job array'); return v.map(obj); }
export function createSource(e: RegistryEntry,p?:Profile): OpportunitySource {
  if(e.adapter==='company-page')return companyPage(e);
  const structured=structuredSource(e,p);if(structured)return structured;
  return {name:e.id,async discover(c:SourceContext):Promise<RawOpportunity[]> {
    const board=encodeURIComponent(e.board);
    if(e.adapter==='json') return rows(JSON.parse(await readFile(e.board,'utf8'))) as unknown as RawOpportunity[];
    if(e.adapter==='greenhouse') {
      const data=obj(await c.getJson(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`));
      return rows(data.jobs).map(j=>({externalId:String(j.id??''),employerJobId:str(j.requisition_id),authority:'employer',title:str(j.title),companyOrClient:e.company,description:str(j.content),location:str(obj(j.location).name),sourceUrl:str(j.absolute_url),updatedAt:str(j.updated_at),original:j}));
    }
    if(e.adapter==='lever') {
      const jobs=rows(await c.getJson(`https://api.lever.co/v0/postings/${board}?mode=json`));
      return jobs.map(j=>({externalId:str(j.id),authority:'employer',title:str(j.text),companyOrClient:e.company,
        description:[str(j.descriptionPlain)||str(j.description),...(Array.isArray(j.lists)?j.lists.map(x=>str(obj(x).text)+' '+str(obj(x).content)):[]),str(j.additionalPlain)].join(' '),
        location:str(obj(j.categories).location),employmentType:str(obj(j.categories).commitment),remoteType:str(j.workplaceType),sourceUrl:str(j.hostedUrl)||str(j.applyUrl),original:j}));
    }
    if(e.adapter==='ashby') {
      const data=obj(await c.getJson(`https://api.ashbyhq.com/posting-api/job-board/${board}`));
      return rows(data.jobs).filter(j=>j.isListed!==false).map(j=>({externalId:str(j.id)||str(j.jobUrl),authority:'employer',title:str(j.title),companyOrClient:e.company,description:str(j.descriptionPlain)||str(j.descriptionHtml),
        location:[str(j.location),...(Array.isArray(j.secondaryLocations)?j.secondaryLocations.map(x=>str(obj(x).location)):[])].filter(Boolean).join(' / '),
        remoteType:str(j.workplaceType)||(j.isRemote===true?'remote':''),employmentType:str(j.employmentType),sourceUrl:str(j.jobUrl),postedAt:str(j.publishedAt),dateKind:'published',original:j}));
    }
    throw new Error(`Adapter '${e.adapter}' is not implemented. Use a permitted public API/feed or local JSON import; no authenticated scraping.`);
  }};
}
