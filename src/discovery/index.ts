import {checkAvailability} from './lifecycle.ts';
import { randomUUID } from 'node:crypto';
import type { OpportunitySource, SourceContext, Profile } from '../model.ts';
import { Store } from '../persistence/index.ts';
import { normalize } from '../normalization/index.ts';
import { evaluate } from '../matching/index.ts';
import {pipelineDiagnostics} from './diagnostics.ts';
export async function discover(store:Store,sources:OpportunitySource[],context:SourceContext,profile:Profile,lifecyclePages?:SourceContext) {
  const repaired=store.repairRequisitionCollisions();
  if(repaired.length)console.error(`Separated conflicting employer requisitions: ${repaired.join(', ')}. Existing application history stays on the original record.`);
  const id=randomUUID();store.db.prepare('INSERT INTO search_runs(id,startedAt) VALUES (?,?)').run(id,new Date().toISOString());
  const beforeIds=new Set(store.list().map(o=>o.id));
  const touched=new Set<string>();
  const summary={attempted:sources.length,successful:0,partial:0,failed:0,unavailable:0,directSourceOpportunities:0,searchExtractedOpportunities:0,deduplicatedRecords:0,raw:0,new:0,known:0,merged:0,invalid:0,hardFiltered:0,relevant:0,freshness:{} as Record<string,number>,sources:[] as Record<string,unknown>[],runPipeline:{} as ReturnType<typeof pipelineDiagnostics>,storedPipeline:{} as ReturnType<typeof pipelineDiagnostics>};
  for(const source of sources) {
    let count=0;
    const contribution={new:0,known:0,merged:0,invalid:0,relevant:0};
    try {
      const rows=await source.discover(context);count=rows.length;summary.raw+=count;
      if(source.kind==='search')summary.searchExtractedOpportunities+=count;else summary.directSourceOpportunities+=count;
      for(const raw of rows)try{const o=normalize(raw,source.name);const outcome=store.upsert(o);summary[outcome]++;contribution[outcome]++;const r=store.db.prepare('SELECT opportunityId FROM opportunity_sources WHERE source=? AND externalId=?').get(source.name,o.externalId);if(r)touched.add(String(r.opportunityId));}catch(e){summary.invalid++;contribution.invalid++;console.error(`[${source.name}] record rejected: ${String(e)}`);}
      if(!contribution.invalid)source.acknowledge?.();
      const relevantIds=store.db.prepare('SELECT DISTINCT opportunityId FROM opportunity_sources WHERE source=?').all(source.name).map(r=>String(r.opportunityId));
      contribution.relevant=store.list().filter(o=>relevantIds.includes(o.id)).filter(o=>{const e=evaluate(o,profile);return !e.filtered.length&&e.matchScore>=profile.minimumMatch;}).length;
      const partial=contribution.invalid>0||source.notes?.some(n=>n.startsWith('PARTIAL:'));
      const unavailable=source.diagnostics?.status==='unavailable',failed=source.diagnostics?.status==='provider-failed'&&!count;
      if(unavailable)summary.unavailable++;else if(failed)summary.failed++;else {summary.successful++;if(partial)summary.partial++;}
      const byDomain:Record<string,Set<string>>={};
      for(const raw of rows)try{const ref=store.db.prepare('SELECT opportunityId FROM opportunity_sources WHERE source=? AND externalId=?').get(source.name,raw.externalId);if(ref){const host=new URL(raw.sourceUrl).hostname;(byDomain[host]??=new Set()).add(String(ref.opportunityId));}}catch{/* Invalid source URLs were already reported during normalization. */}
      const domainPipeline=Object.fromEntries(Object.entries(byDomain).map(([domain,ids])=>[domain,pipelineDiagnostics(store.list().filter(o=>ids.has(o.id)),profile)]));
      const details={source:source.name,kind:source.kind??'direct',status:unavailable?'unavailable':failed?'failed':partial?'partial':'working',raw:count,...contribution,domainPipeline,retainedPipeline:pipelineDiagnostics(store.list().filter(o=>relevantIds.includes(o.id)),profile),notes:source.notes??[],...(source.diagnostics?{search:source.diagnostics}:{})};summary.sources.push(details);
      store.db.prepare('INSERT INTO source_runs(runId,source,success,rawCount,error,detailsJson) VALUES (?,?,?,?,?,?)').run(id,source.name,Number(!unavailable&&!failed),count,failed?'Search provider failed':unavailable?'Search provider unavailable':null,JSON.stringify(details));console.error(`[${source.name}] ${details.status}: ${count} records; ${contribution.new} new, ${contribution.merged} merged, ${contribution.relevant} relevant retained`);
    }catch(e){summary.failed++;const details={source:source.name,status:'failed',raw:count,...contribution,error:String(e)};summary.sources.push(details);store.db.prepare('INSERT INTO source_runs(runId,source,success,rawCount,error,detailsJson) VALUES (?,?,?,?,?,?)').run(id,source.name,0,count,String(e),JSON.stringify(details));console.error(`[${source.name}] FAILED: ${String(e)}`);}
  }
  const observedAt=new Date().toISOString();
  for(const source of summary.sources){
    const candidates=(source.search as {candidates?:{url:string;status:string;detail?:string}[]}|undefined)?.candidates??[];
    for(const item of candidates){
      if(!/HTTP (?:404|410)|http-403|access-blocked|timeout|transient-network/.test(`${item.status} ${item.detail??''}`))continue;
      const job=store.list().find(o=>o.canonicalUrl===item.url);if(!job)continue;
      store.observeAvailability(job.id,/HTTP (?:404|410)/.test(item.detail??'')?'NOT_FOUND':'INACCESSIBLE',item.url,observedAt);
    }
  }
  if(lifecyclePages)Object.assign(summary,{availabilityChecks:await checkAvailability(store,lifecyclePages,observedAt)});
  store.markStale(observedAt);
  // Counts below describe the current stored feed, including earlier discoveries.
  for(const o of store.list()){const e=evaluate(o,profile);if(e.filtered.length)summary.hardFiltered++;else if(e.matchScore>=profile.minimumMatch){summary.relevant++;summary.freshness[e.freshness]=(summary.freshness[e.freshness]??0)+1;}}
  summary.runPipeline=pipelineDiagnostics(store.list().filter(o=>touched.has(o.id)),profile);summary.storedPipeline=pipelineDiagnostics(store.list(),profile);
  summary.deduplicatedRecords=summary.raw-summary.invalid-summary.runPipeline.unique;
  const newJobs=store.list().filter(o=>!beforeIds.has(o.id));
  const newRelevant=newJobs.filter(o=>{const e=evaluate(o,profile);return !e.filtered.length&&e.matchScore>=profile.minimumMatch;});
  const daily={newOpportunities:newJobs.length,recommended:newRelevant.length,strongMatches:newRelevant.filter(o=>evaluate(o,profile).matchScore>=75).length,postedUnder24h:newRelevant.filter(o=>o.postedAt&&Date.now()-Date.parse(o.postedAt)<86400000).length,remote:newRelevant.filter(o=>o.remoteType==='remote').length,freelance:newRelevant.filter(o=>o.type==='FREELANCE').length};
  Object.assign(summary,{daily});
  console.error(`New this run: ${daily.newOpportunities} records; ${daily.recommended} recommended; ${daily.strongMatches} strong matches; ${daily.postedUnder24h} posted <24h; ${daily.remote} remote; ${daily.freelance} freelance (last four counts are recommended new jobs).`);
  console.error(`Pipeline: ${summary.raw} raw → ${summary.runPipeline.unique} unique touched → ${summary.runPipeline.eligible} eligible → ${summary.runPipeline.relevant} relevant. ${summary.invalid} invalid; ${summary.runPipeline.belowMatchThreshold} below match threshold.`);
  store.db.prepare('UPDATE search_runs SET finishedAt=?,summaryJson=? WHERE id=?').run(new Date().toISOString(),JSON.stringify(summary),id);return summary;
}
