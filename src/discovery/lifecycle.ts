import {robotsAllowed} from '../sources/company-page.ts';
import {parseRecords} from './web.ts';
import {key,url as normalizedUrl} from '../normalization/index.ts';
import type {SourceContext} from '../model.ts';
import {Store} from '../persistence/index.ts';
// Small, independent canonical checks. A missing item in a capped source batch
// is not evidence that the employer closed it.
export async function checkAvailability(store:Store,pages:SourceContext,now=new Date().toISOString(),limit=6){
  const cutoff=new Date(Date.parse(now)-7*86400000).toISOString();
  const jobs=store.list().filter(o=>o.authority==='employer'&&o.availability!=='CLOSED'&&o.lastSeenAt<cutoff&&(!o.availabilityCheckedAt||o.availabilityCheckedAt<cutoff))
    .sort((a,b)=>(a.availabilityCheckedAt??a.lastSeenAt).localeCompare(b.availabilityCheckedAt??b.lastSeenAt)).slice(0,limit);
  const results:{id:string;url:string;evidence:string}[]=[];
  for(const job of jobs){
    try{
      const target=new URL(job.canonicalUrl);let policy='';
      try{policy=await pages.getText!(target.origin+'/robots.txt',86400000);}catch(e){if(!/^Error: HTTP 404$/.test(String(e)))throw new Error('Robots policy unavailable: '+String(e));}
      if(!robotsAllowed(policy,target.pathname+target.search))throw new Error('Robots policy disallows canonical check');
      const page=await pages.getText!(job.canonicalUrl,0);
      // Do not infer active from a generic 200 response or a careers landing page.
      let matching;try{matching=parseRecords(page,job.canonicalUrl).find(r=>normalizedUrl(r.canonicalUrl??r.sourceUrl)===job.canonicalUrl&&key(r.title)===key(job.title)&&key(r.companyOrClient)===key(job.companyOrClient));}catch{}
      if(matching){
        const evidence=matching.closed?'CLOSED':'ACTIVE';
        store.observeAvailability(job.id,evidence,job.canonicalUrl,now);results.push({id:job.id,url:job.canonicalUrl,evidence});
      }else{
        store.db.prepare('UPDATE opportunities SET availabilityCheckedAt=? WHERE id=?').run(now,job.id);
        results.push({id:job.id,url:job.canonicalUrl,evidence:'UNCONFIRMED'});
      }
    }catch(error){
      const evidence=/^Error: HTTP (404|410)$/.test(String(error))?'NOT_FOUND':'INACCESSIBLE';
      store.observeAvailability(job.id,evidence,job.canonicalUrl,now);results.push({id:job.id,url:job.canonicalUrl,evidence});
    }
  }
  store.markStale(now);return results;
}
