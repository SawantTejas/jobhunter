import { randomUUID } from 'node:crypto';
import type { OpportunitySource, SourceContext, Profile } from '../model.ts';
import { Store } from '../persistence/index.ts';
import { normalize } from '../normalization/index.ts';
import { evaluate } from '../matching/index.ts';
import {pipelineDiagnostics} from './diagnostics.ts';
export async function discover(store:Store,sources:OpportunitySource[],context:SourceContext,profile:Profile) {
  const id=randomUUID();store.db.prepare('INSERT INTO search_runs(id,startedAt) VALUES (?,?)').run(id,new Date().toISOString());
  const touched=new Set<string>();
  const summary={attempted:sources.length,successful:0,partial:0,failed:0,raw:0,new:0,known:0,merged:0,invalid:0,hardFiltered:0,relevant:0,freshness:{} as Record<string,number>,sources:[] as Record<string,unknown>[],runPipeline:{} as ReturnType<typeof pipelineDiagnostics>,storedPipeline:{} as ReturnType<typeof pipelineDiagnostics>};
  for(const source of sources) {
    let count=0;
    const contribution={new:0,known:0,merged:0,invalid:0,relevant:0};
    try {
      const rows=await source.discover(context);count=rows.length;summary.raw+=count;
      for(const raw of rows)try{const o=normalize(raw,source.name);const outcome=store.upsert(o);summary[outcome]++;contribution[outcome]++;const r=store.db.prepare('SELECT opportunityId FROM opportunity_sources WHERE source=? AND externalId=?').get(source.name,o.externalId);if(r)touched.add(String(r.opportunityId));}catch(e){summary.invalid++;contribution.invalid++;console.error(`[${source.name}] record rejected: ${String(e)}`);}
      const relevantIds=store.db.prepare('SELECT DISTINCT opportunityId FROM opportunity_sources WHERE source=?').all(source.name).map(r=>String(r.opportunityId));
      contribution.relevant=store.list().filter(o=>relevantIds.includes(o.id)).filter(o=>{const e=evaluate(o,profile);return !e.filtered.length&&e.matchScore>=profile.minimumMatch;}).length;
      const partial=contribution.invalid>0||source.notes?.some(n=>n.startsWith('PARTIAL:'));
      summary.successful++;if(partial)summary.partial++;
      const details={source:source.name,status:partial?'partial':'working',raw:count,...contribution,retainedPipeline:pipelineDiagnostics(store.list().filter(o=>relevantIds.includes(o.id)),profile),notes:source.notes??[]};summary.sources.push(details);
      store.db.prepare('INSERT INTO source_runs(runId,source,success,rawCount,error,detailsJson) VALUES (?,?,?,?,?,?)').run(id,source.name,1,count,null,JSON.stringify(details));console.error(`[${source.name}] ${details.status}: ${count} records; ${contribution.new} new, ${contribution.merged} merged, ${contribution.relevant} relevant retained`);
    }catch(e){summary.failed++;const details={source:source.name,status:'failed',raw:count,...contribution,error:String(e)};summary.sources.push(details);store.db.prepare('INSERT INTO source_runs(runId,source,success,rawCount,error,detailsJson) VALUES (?,?,?,?,?,?)').run(id,source.name,0,count,String(e),JSON.stringify(details));console.error(`[${source.name}] FAILED: ${String(e)}`);}
  }
  // Counts below describe the current stored feed, including earlier discoveries.
  for(const o of store.list()){const e=evaluate(o,profile);if(e.filtered.length)summary.hardFiltered++;else if(e.matchScore>=profile.minimumMatch){summary.relevant++;summary.freshness[e.freshness]=(summary.freshness[e.freshness]??0)+1;}}
  summary.runPipeline=pipelineDiagnostics(store.list().filter(o=>touched.has(o.id)),profile);summary.storedPipeline=pipelineDiagnostics(store.list(),profile);
  console.error(`Pipeline: ${summary.raw} raw → ${summary.runPipeline.unique} unique touched → ${summary.runPipeline.eligible} eligible → ${summary.runPipeline.relevant} relevant. ${summary.invalid} invalid; ${summary.runPipeline.belowMatchThreshold} below match threshold.`);
  store.db.prepare('UPDATE search_runs SET finishedAt=?,summaryJson=? WHERE id=?').run(new Date().toISOString(),JSON.stringify(summary),id);return summary;
}
