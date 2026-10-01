import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { loadConfig } from './config.ts';
import { Store } from './persistence/index.ts';
import { createSource } from './sources/index.ts';
import { HttpClient } from './sources/http.ts';
import { discover } from './discovery/index.ts';
import { evaluate } from './matching/index.ts';
import { loadDomains,writeWebPlan,importRecords } from './discovery/web.ts';
import type { Status } from './model.ts';
import { exportDashboard,publish } from './local/dashboard-service.ts';
const help=`Local Opportunity Agent
  init                        Initialize SQLite and editable example configs
  search                      Discover from enabled public sources
  list [fresh|recent|freelance|jobs|saved|all] [--limit N]
  show <id>                   Description, match reasons, source references
  open <id>                   Open original URL in your browser
  save|ignore|applied <id> [reason]
  stats                       Latest discovery summary and source errors
  sources                     Adapter health and discovery-only domains
  web-plan [--limit N] [--offset N] [--domain domain]
  import <file>               Import confirmed JSON or saved HTML/JSON-LD listings
  export-public              Write the sanitized public dashboard snapshot
  publish                    Export, commit only public data, push upstream
  sync                       Discover, then export and publish
Edit config/profile.json and config/sources.json. Scores are heuristics, not probabilities.`;
async function main(){
  const [command='help',arg,...rest]=process.argv.slice(2);if(command==='help'||command==='--help'){console.log(help);return;}
  if(command==='export-public'){console.log(exportDashboard());return;}
  if(command==='publish'){console.log(await publish());return;}
  const {profile,registry,dataDir}=loadConfig(),store=new Store(join(dataDir,'opportunities.sqlite'));
  try{
    store.configure(profile,registry);
    if(command==='sync'){
      const result=await discover(store,registry.filter(r=>r.enabled).map(r=>createSource(r,profile)),new HttpClient(join(dataDir,'cache')),profile);
      console.log(JSON.stringify(result,null,2));
      if(result.attempted>0&&result.failed===result.attempted)throw new Error('All discovery sources failed; public data was not published.');
      console.log(await publish());return;
    }
    if(command==='init'){console.log(`Database ready: ${dataDir}\nEdit config/profile.json before discovery.`);return;}
    if(command==='web-plan'||command==='search'){
      const args=[arg,...rest];const number=(flag:string,fallback:number)=>args.includes(flag)?Number(args[args.indexOf(flag)+1]):fallback;
      const offset=command==='search'?Number(store.db.prepare('SELECT COUNT(*) AS count FROM discovery_queries').get()?.count??0):number('--offset',0);
      const queries=writeWebPlan(profile,dataDir,number('--limit',31),offset,args.includes('--domain')?args[args.indexOf('--domain')+1]:undefined);
      for(const q of queries)store.db.prepare('INSERT OR IGNORE INTO discovery_queries VALUES (?,?,?,?,?)').run(q.id,q.domain,q.query,q.searchUrl,new Date().toISOString());
      (command==='search'?console.error:console.log)(`Prepared ${queries.length} domain-targeted search links: ${join(dataDir,'web-discovery.html')}\nDiscovery-only: these links have NOT been fetched or counted as opportunities.`);
      if(command==='web-plan')return;
      console.log(JSON.stringify(await discover(store,registry.filter(r=>r.enabled).map(r=>createSource(r,profile)),new HttpClient(join(dataDir,'cache')),profile),null,2));return;
    }
    if(command==='import'){
      if(!arg)throw new Error('Supply a JSON or saved HTML/JSON-LD file');const records=importRecords(arg);
      const domains=[...new Set(records.map(r=>new URL(r.sourceUrl).hostname))];
      const sources=domains.map(domain=>({name:`web:${domain}`,discover:async()=>records.filter(r=>new URL(r.sourceUrl).hostname===domain)}));
      console.log(JSON.stringify(await discover(store,sources,{getJson:async()=>{throw new Error('Import never fetches the network');}},profile),null,2));return;
    }
    if(command==='sources'){
      for(const source of registry){const latest=store.db.prepare('SELECT sr.* FROM source_runs sr JOIN search_runs r ON r.id=sr.runId WHERE sr.source=? ORDER BY r.startedAt DESC LIMIT 1').get(source.id);console.log(`${source.id} | ${source.enabled?'enabled':'disabled'} | ${latest?latest.detailsJson??(latest.success?'working':'failed'):'unverified'} `);}
      for(const domain of loadDomains())console.log(`${domain.domain} | ${domain.mode} | ${domain.note}`);return;
    }
    if(command==='stats'){console.log(store.db.prepare('SELECT * FROM search_runs ORDER BY startedAt DESC LIMIT 1').get()??'No runs');console.log(store.db.prepare('SELECT * FROM source_runs WHERE runId=(SELECT id FROM search_runs ORDER BY startedAt DESC LIMIT 1)').all());console.log(store.db.prepare('SELECT status,COUNT(*) AS count FROM opportunities GROUP BY status').all());return;}
    const all=store.list();
    if(command==='list'){
      const tokens=[arg,...rest];const i=tokens.indexOf('--limit'),limit=i>=0?Number(tokens[i+1]):30;if(!Number.isInteger(limit)||limit<1)throw new Error('Limit must be a positive integer');
      const rows=all.map(o=>({o,e:evaluate(o,profile)})).filter(({o,e})=>{
        if(arg==='all')return true;if(e.filtered.length||e.matchScore<profile.minimumMatch)return false;
        if(arg==='saved')return o.status==='SAVED';if(arg==='freelance')return o.type==='FREELANCE';if(arg==='jobs')return o.type!=='FREELANCE';
        if(arg==='fresh')return !!o.postedAt&&Date.now()-Date.parse(o.postedAt)<86400000;
        if(arg==='recent')return !!o.postedAt&&Date.now()-Date.parse(o.postedAt)<3*86400000;return true;
      }).sort((a,b)=>b.e.rankScore-a.e.rankScore||a.o.id.localeCompare(b.o.id));
      for(const {o,e}of rows.slice(0,limit))console.log(`${o.id.slice(0,8)} | ${e.matchScore}% match | rank ${e.rankScore} | ${e.freshness}\n${o.title} — ${o.companyOrClient}\n${o.location||'Location unknown'} · ${o.remoteType} · ${o.type} · ${o.status}\nMatched: ${e.matched.join(', ')||'none'}\nOther skills mentioned (requirements unclassified): ${e.missing.join(', ')||'none'}\n${e.reasons.join('\n')}\nSources: ${store.references(o.id).map(r=>`${r.source}: ${r.sourceUrl}`).join(' | ')}\n${e.filtered.length?'Filtered: '+e.filtered.join('; ')+'\n':''}`);
      console.log(`${rows.length} results. Showing up to ${limit}. Use show <id> or open <id>.`);return;
    }
    const matches=all.filter(o=>arg&&o.id.startsWith(arg));if(matches.length!==1)throw new Error('Supply a unique opportunity ID (or prefix)');const o=matches[0];
    if(command==='show'){console.log(JSON.stringify({...o,evaluation:evaluate(o,profile),sources:store.references(o.id)},null,2));return;}
    const statuses:Record<string,Status>={save:'SAVED',ignore:'IGNORED',applied:'APPLIED',open:'OPENED'};
    if(!statuses[command])throw new Error(help);
    if(command==='ignore'&&rest.length&&!['wrong stack','too senior','too junior','location','compensation','company','not interested','duplicate','other'].includes(rest.join(' ')))throw new Error('Use a documented ignore reason, e.g. "wrong stack" or "other"');
    if(command==='open'){
      const child=process.platform==='win32'?spawn('rundll32.exe',['url.dll,FileProtocolHandler',o.canonicalUrl],{stdio:'ignore',windowsHide:true}):spawn(process.platform==='darwin'?'open':'xdg-open',[o.canonicalUrl],{stdio:'ignore'});
      await new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`Browser launcher exited ${code}`)));});
    }
    if(command!=='open'||o.status==='NEW')store.status(o.id,statuses[command],rest.join(' ')||undefined);
    console.log(`${command}: ${o.title}`);
  }finally{store.close();}
}
main().catch(e=>{console.error(String(e));process.exitCode=1;});
