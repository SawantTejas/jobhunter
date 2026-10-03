import {CandidateQueue,failureKind,type Candidate} from './queue.ts';
import {partialFromMetadata} from './partial.ts';
import {DatabaseSync} from 'node:sqlite';
import {existsSync,readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import type {OpportunitySource,Profile,RegistryEntry,RawOpportunity,SourceContext} from '../../model.ts';
import {normalize} from '../../normalization/index.ts';
import {loadDomains,type DomainEntry} from '../web.ts';
import {createProvider,loadSearchConfig} from './providers.ts';
import {QueryGenerator} from './queries.ts';
import {candidateUrl,PublicPageClient} from './network.ts';
import {extractCandidate} from './extraction.ts';
import {registerSource,identifyAts} from './registry.ts';
import {HttpClient} from '../../sources/http.ts';
import type {SearchConfig,SearchDiscoveryProvider,SearchQuery} from './model.ts';
export function matchesDomain(value:string,scope:string):boolean {
  const u=new URL(value),d=new URL('https://'+scope);if(d.hostname==='wellfound.com'&&(d.pathname==='/jobs'||d.pathname==='/')&&(u.hostname==='wellfound.com'||u.hostname==='www.wellfound.com'))return /^\/(?:jobs|role)(?:\/|$)/.test(u.pathname);return (u.hostname===d.hostname||u.hostname.endsWith('.'+d.hostname))&&(d.pathname==='/'||u.pathname===d.pathname||u.pathname.startsWith(d.pathname+'/'));
}
export interface SearchDependencies {provider:SearchDiscoveryProvider;queries:SearchQuery[];pages:SourceContext;api:SourceContext;register?:(entry:RegistryEntry)=>boolean;domains?:DomainEntry[];queue?:CandidateQueue}
export function searchSource(p:Profile,c:SearchConfig,deps:SearchDependencies):OpportunitySource {
  const notes:string[]=[];const diagnostics:Record<string,unknown>={provider:deps.provider.name,mode:deps.provider.mode};
  return {name:'search:'+deps.provider.name,kind:'search',notes,diagnostics,async discover(){
    const persistent=deps.queue??new CandidateQueue();
    notes.length=0;const records:RawOpportunity[]=[],queue:{url:string;queryId:string;via?:string;depth:number}[]=[],seen=new Set<string>();
    const domains:Record<string,{results:number;uniqueCandidates:number;extracted:number;failed:number;notJobs:number;deferred:number}>={};
    for(const d of deps.domains??[])domains[d.domain]={results:0,uniqueCandidates:0,extracted:0,failed:0,notJobs:0,deferred:0};
    const bucket=(value:string)=>{const host=(deps.domains??[]).find(d=>matchesDomain(value,d.domain))?.domain??new URL(value).hostname;return domains[host]??=( {results:0,uniqueCandidates:0,extracted:0,failed:0,notJobs:0,deferred:0});};
    const audit:{url:string;status:string;detail?:string;queryId:string;via?:string}[]=[],queryAudit:Record<string,unknown>[]=[];
    const counts={queriesPlanned:deps.queries.length,queriesAttempted:0,pagesFetched:0,searchDiscoveredUrls:0,duplicateUrls:0,invalidUrls:0,offDomainResults:0,uniqueCandidateUrls:0,linkedAtsUrls:0,linkedListingUrls:0,attemptedUrls:0,extractedUrls:0,extractedOpportunities:0,failedUrls:0,notJobUrls:0,deferredUrls:0,registeredSources:0,partialOpportunities:0};
    const enqueue=(value:string,queryId:string,via?:string,depth=0,position=queue.length,metadata?:import('./model.ts').SearchResult)=>{let cleaned:string;try{cleaned=candidateUrl(value);}catch{counts.invalidUrls++;audit.push({url:value.slice(0,2000),status:'invalid-url',queryId});return;}if(seen.has(cleaned)){counts.duplicateUrls++;return;}seen.add(cleaned);bucket(cleaned).uniqueCandidates++;const item={url:cleaned,queryId,depth,...(via?{via}:{}),...(metadata?{metadata}:{})};persistent.add(item);queue.splice(position,0,item);};
    if(deps.provider.mode==='unavailable')notes.push('PARTIAL: automated search disabled by configuration. Select provider tavily for free keyless search. Search-only domains contributed zero jobs.');
    let providerFailed=false;
    for(const q of deps.provider.mode==='unavailable'?[]:deps.queries){
      counts.queriesAttempted++;const fingerprints=new Set<string>();
      console.error(`[search] ${deps.provider.name}: query ${counts.queriesAttempted}/${deps.queries.length} (${q.domain??'open web'})`);
      for(let page=1;page<=(deps.provider.mode==='saved-results'?1:c.pagesPerQuery);page++){
        try{
          const data=await deps.provider.search(q,page,deps.api);counts.pagesFetched++;
          const fingerprint=data.results.map(r=>r.url).join('|');if(fingerprints.has(fingerprint)){notes.push('PARTIAL: repeated search page stopped');break;}fingerprints.add(fingerprint);
          queryAudit.push({id:q.id,query:q.query,domain:q.domain??'open-web',page,results:data.results.length,status:'completed'});
          for(const warning of data.warnings??[])notes.push('PARTIAL: '+warning);
          for(const r of data.results){counts.searchDiscoveredUrls++;try{bucket(candidateUrl(r.url)).results++;if(q.domain&&!matchesDomain(r.url,q.domain)){counts.offDomainResults++;continue;}}catch{}enqueue(r.url,q.id,undefined,0,queue.length,r);}
          if(!data.hasMore||!data.results.length)break;
          if(page===c.pagesPerQuery)notes.push(`PARTIAL: search page cap for ${q.id}`);
        }catch(error){queryAudit.push({id:q.id,page,status:'failed',error:String(error)});notes.push('PARTIAL: provider stopped after failure: '+String(error));providerFailed=true;break;}
      }if(providerFailed)break;
    }
    const attempted=new Set<string>();
    for(let i=0;i<c.candidateLimit&&deps.provider.mode!=='unavailable';i++){
      const item=persistent.next(attempted);if(!item)break;attempted.add(item.url);seen.add(item.url);const b=bucket(item.url);
      counts.attemptedUrls++;
      if(counts.attemptedUrls===1||counts.attemptedUrls%5===0)console.error(`[search] inspecting candidate ${counts.attemptedUrls}/${c.candidateLimit}; ${counts.extractedOpportunities} jobs extracted so far`);
      try{
        const extracted=await extractCandidate(item.url,deps.pages,p,item.depth===0);
        const valid=extracted.records.filter(r=>{try{normalize(r,'search-validation');return true;}catch{return false;}}).map(r=>({...r,externalId:`${new URL(r.sourceUrl).hostname}:${r.externalId}`}));
        if(valid.length){records.push(...valid);counts.extractedUrls++;counts.extractedOpportunities+=valid.length;b.extracted+=valid.length;audit.push({...item,status:'extracted',detail:`${valid.length} validated jobs`});
          const entry=extracted.registration;
          // Known portals are not registered as employer career pages.
          if(entry&&!(entry.adapter==='company-page'&&(deps.domains??[]).some(d=>matchesDomain(item.url,d.domain))))try{if(deps.register?.(entry))counts.registeredSources++;}catch(error){notes.push('PARTIAL: registry update failed: '+String(error));}
        }else{counts.notJobUrls++;b.notJobs++;audit.push({...item,status:extracted.links.length?'listing-links-only':'unsupported-page',detail:'No usable JobPosting data; snippet was not imported'});}
        persistent.finish(item,'INSPECTED',valid.length?'validated':extracted.links.length?'listing-links-only':'unsupported-page',valid.length?valid:undefined);
        // Inspect specific listing links before more category pages; bounded to two hops.
        if(item.depth<2)for(const link of [...extracted.links].reverse()){if(!seen.has(link)){if(identifyAts(link))counts.linkedAtsUrls++;else counts.linkedListingUrls++;}enqueue(link,item.queryId,item.url,item.depth+1,i+1);}
      }catch(error){const failure=failureKind(error);const partial=failure.state==='BLOCKED'?partialFromMetadata(item.metadata):undefined;
        if(partial){records.push(partial);counts.partialOpportunities++;}
        persistent.finish(item,failure.state,failure.kind,partial?[partial]:undefined);counts.failedUrls++;b.failed++;audit.push({...item,status:failure.kind,detail:String(error)});}
    }
    for(const item of persistent.pending()){counts.deferredUrls++;bucket(item.url).deferred++;audit.push({...item,status:'deferred-limit'});}
    counts.uniqueCandidateUrls=new Set([...seen,...persistent.pending().map(x=>x.url)]).size;
    Object.assign(diagnostics,{queueStates:persistent.states()});
    if(counts.failedUrls||counts.deferredUrls)notes.push(`PARTIAL: ${counts.failedUrls} inaccessible candidates; ${counts.deferredUrls} deferred by run cap`);
    Object.assign(diagnostics,counts,{safeRedirects:deps.pages instanceof PublicPageClient?deps.pages.redirects:[],status:deps.provider.mode==='unavailable'?'unavailable':providerFailed?'provider-failed':notes.some(n=>n.startsWith('PARTIAL:'))?'partial':'completed',domains,queries:queryAudit,candidates:audit});
    console.error(`[search] ${deps.provider.name}: ${counts.searchDiscoveredUrls} result URLs → ${counts.uniqueCandidateUrls} unique candidates → ${counts.extractedOpportunities} extracted jobs; ${counts.failedUrls} inaccessible, ${counts.notJobUrls} not jobs, ${counts.deferredUrls} deferred.`);
    const pendingOutputs=persistent.outputs().flatMap(r=>JSON.parse(String(r.result)) as RawOpportunity[]);
    if(!deps.queue){persistent.close();return records;}
    return pendingOutputs;
  }};
}
export function configuredSearch(p:Profile,dataDir:string,resultsFile?:string):OpportunitySource {
  try{
    const config=loadSearchConfig('config/search.json',resultsFile?{provider:'saved-results',resultsFile}:{});
    const provider=createProvider(config,join(dataDir,'search-api-cache')),domains=loadDomains(),cursorFile=join(dataDir,'search-provider-cursor.json');
    const cursor=existsSync(cursorFile)?JSON.parse(readFileSync(cursorFile,'utf8')):{offset:0};
    const offset=Number(cursor.offset);
    const queue=new CandidateQueue(join(dataDir,'search-queue.sqlite'));
    // Recover the last pre-queue run's uninspected candidates once, without requiring manual URLs.
    if(!queue.db.prepare("SELECT 1 FROM queue_meta WHERE key='legacy-import'").get()){
      const path=join(dataDir,'opportunities.sqlite');if(existsSync(path)){const old=new DatabaseSync(path,{readOnly:true});
        try{const row=old.prepare('SELECT summaryJson FROM search_runs WHERE finishedAt IS NOT NULL ORDER BY startedAt DESC LIMIT 1').get();
          const summaries=row?JSON.parse(String(row.summaryJson)).sources:[];
          for(const source of summaries??[])for(const item of source.search?.candidates??[])if(item.status==='deferred-limit')try{queue.add({url:candidateUrl(item.url),queryId:item.queryId??'legacy',depth:item.depth??0,via:item.via});}catch{}
        }finally{old.close();}}queue.db.prepare("INSERT INTO queue_meta VALUES ('legacy-import','done')").run();
    }
    if(!Number.isSafeInteger(offset)||offset<0)throw new Error('Invalid search cursor');
    // Reconsider only software-induced redirect loops once after preserving transport paths.
    if(!queue.db.prepare("SELECT 1 FROM queue_meta WHERE key='transport-path-v2'").get()){
      const path=join(dataDir,'opportunities.sqlite');if(existsSync(path)){const old=new DatabaseSync(path,{readOnly:true});try{
        const row=old.prepare('SELECT summaryJson FROM search_runs WHERE finishedAt IS NOT NULL ORDER BY startedAt DESC LIMIT 1').get();
        for(const source of row?JSON.parse(String(row.summaryJson)).sources??[]:[])for(const item of source.search?.candidates??[])
          if(/redirect limit/.test(item.detail??''))queue.db.prepare("UPDATE candidates SET state='PENDING',attempts=0,nextAttempt=0,reason='transport-path-fix' WHERE url=? AND reason='redirect-security-rejected'").run(item.url);
      }finally{old.close();}}queue.db.prepare("INSERT INTO queue_meta VALUES ('transport-path-v2','done')").run();
    }
    const queries=provider.queries??new QueryGenerator().generate(p,domains,config.queryLimit,config.openWebQueries,offset);
    const source=searchSource(p,config,{provider,queries,queue,pages:new PublicPageClient(join(dataDir,'search-page-cache')),api:new HttpClient(join(dataDir,'search-api-cache'),{retries:0,minIntervalMs:1500,followRedirects:false}),domains,register:e=>registerSource(e)});
    const original=source.discover;source.discover=async context=>{const rows=await original(context);if(provider.mode==='automatic'){mkdirSync(dataDir,{recursive:true});const completed=new Set((source.diagnostics!.queries as {id:string;status:string}[]).filter(q=>q.status==='completed').map(q=>q.id));const queried=queries.filter(q=>q.domain&&completed.has(q.id)).map(q=>q.domain!);const covered=[...new Set([...(cursor.covered??[]),...queried])];
      writeFileSync(cursorFile+'.tmp',JSON.stringify({offset:offset+queried.length,covered}));renameSync(cursorFile+'.tmp',cursorFile);
      Object.assign(source.diagnostics!,{domainsSearchedThisRun:new Set(queried).size,domainsSearchedSinceRotation:covered.length,domainsTotal:domains.filter(d=>d.mode!=='unavailable').length});
      console.error(`Domains searched this run: ${new Set(queried).size}/${domains.length}; since rotation began: ${covered.length}/${domains.length}`);}return rows;};source.acknowledge=()=>{queue.acknowledge();queue.close();};return source;
  }catch(error){return {name:'search:configuration',kind:'search',async discover(){throw error;}};}
}
