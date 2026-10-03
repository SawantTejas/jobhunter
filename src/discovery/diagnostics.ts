import type {Opportunity,Profile,RegistryEntry} from '../model.ts';
import {evaluate} from '../matching/index.ts';
import type {Store} from '../persistence/index.ts';
import {loadDomains} from './web.ts';
import {indiaLocation} from '../matching/location.ts';
export function pipelineDiagnostics(rows:Opportunity[],profile:Profile){
  const result={unique:rows.length,locationFiltered:0,hardFiltered:0,eligible:0,belowMatchThreshold:0,relevant:0,filterReasons:{} as Record<string,number>,scoreReasons:{} as Record<string,number>,knownPostingDate:0,unknownPostingDate:0,olderThan30Days:0,minimumMatch:profile.minimumMatch};
  for(const o of rows){if(o.postedAt){result.knownPostingDate++;if(Date.now()-Date.parse(o.postedAt)>30*86400000)result.olderThan30Days++;}else result.unknownPostingDate++;
    if(profile.indiaFirst&&!indiaLocation(o).eligible)result.locationFiltered++;
    const e=evaluate(o,profile);if(e.filtered.length){result.hardFiltered++;for(const reason of new Set(e.filtered))result.filterReasons[reason]=(result.filterReasons[reason]??0)+1;continue;}
    result.eligible++;if(e.matchScore>=profile.minimumMatch){result.relevant++;continue;}result.belowMatchThreshold++;
    const reason=e.reasons.find(r=>r.startsWith('Important mismatches:')&&!r.endsWith('none explicit'))??e.reasons.find(r=>r.startsWith('Role family:'))??'Below configured minimum';result.scoreReasons[reason]=(result.scoreReasons[reason]??0)+1;
  }return result;
}
export function discoveryDiagnostics(store:Store,profile:Profile,registry:RegistryEntry[]){
  const domains=loadDomains();return {registry:{configuredSources:registry.length,enabledSources:registry.filter(r=>r.enabled).length,domains:domains.length,automaticDomains:domains.filter(d=>d.mode==='adapter').length,searchOnlyDomains:domains.filter(d=>d.mode==='discovery-only').length,preparedQueries:Number(store.db.prepare('SELECT COUNT(*) AS n FROM discovery_queries').get()?.n??0),limits:registry.filter(r=>r.enabled).map(r=>({source:r.id,adapter:r.adapter,maxPages:r.maxPages??null,maxDetails:r.maxDetails??null,maxQueries:r.maxQueries??null}))},stored:pipelineDiagnostics(store.list(),profile),latestRun:store.db.prepare('SELECT startedAt,finishedAt,summaryJson FROM search_runs ORDER BY startedAt DESC LIMIT 1').get(),notes:['Prepared web searches are not ingested opportunities.','Filter reason counts overlap; funnel stage counts do not.','Recency reduces ranking, not eligibility; unknown dates are retained.','Cross-source dedup retains every source reference.']};
}
