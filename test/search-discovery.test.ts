import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Profile,SourceContext} from '../src/model.ts';
import {QueryGenerator} from '../src/discovery/search/queries.ts';
import {searchDefaults,type SearchDiscoveryProvider} from '../src/discovery/search/model.ts';
import {searchSource,matchesDomain} from '../src/discovery/search/index.ts';
import {extractCandidate,extractJsonLd} from '../src/discovery/search/extraction.ts';
import {candidateUrl,publicIPv4} from '../src/discovery/search/network.ts';
import {SearxngProvider,SavedResultsProvider,createProvider,loadSearchConfig} from '../src/discovery/search/providers.ts';
import {identifyAts,registerSource,registryEntry} from '../src/discovery/search/registry.ts';
import {Store} from '../src/persistence/index.ts';
import {discover} from '../src/discovery/index.ts';
import {normalize} from '../src/normalization/index.ts';
const profile=JSON.parse(readFileSync(new URL('../config/profile.example.json',import.meta.url),'utf8')) as Profile;
const description='PHP Laravel PostgreSQL REST Vue. Develop and maintain backend APIs and scalable reliable services with testing, documentation and a collaborative software engineering team.';
const schema={'@type':'JobPosting',identifier:'123',title:'Backend Developer',hiringOrganization:{name:'Example'},description,jobLocation:{address:{addressLocality:'Mumbai',addressCountry:'IN'}}};
const html=(data:unknown)=>`<script type="application/ld+json">${JSON.stringify(data)}</script>`;
const queries=[{id:'q',query:'backend India'}];
const provider=(urls:string[]):SearchDiscoveryProvider=>({name:'fixture',mode:'automatic',async search(){return {results:urls.map(url=>({url,title:'A search snippet is not a job'})),hasMore:false};}});
const api:SourceContext={async getJson(){throw new Error('Unexpected network access');}};

test('generated queries cover extensible domains, open web, role skills and rotating places',()=>{
  const domains=Array.from({length:25},(_,n)=>({domain:`portal${n}.com`,mode:'discovery-only' as const,kind:'employment' as const,note:''}));
  const generator=new QueryGenerator();const batches=Array.from({length:8},(_,n)=>generator.generate({...profile,indiaFirst:true},domains,20,4,n*20));
  assert.ok(batches.every(b=>b.length<=20&&b.filter(q=>!q.domain).length===4));
  assert.equal(new Set(batches.flat().filter(q=>q.domain).map(q=>q.domain)).size,25);
  const text=batches.flat().map(q=>q.query).join(' ');for(const term of ['Mumbai','Navi Mumbai','Bengaluru','Bangalore','Pune','Hyderabad','APAC'])assert.ok(text.includes(term));
  assert.ok(text.includes(profile.strongSkills[0]));assert.ok(text.includes('careers apply'));
  assert.ok(batches.every(b=>new Set(b.map(q=>q.query)).size===b.length));
});

test('untrusted URL checks reject internal addresses and enforce domain path boundaries',()=>{
  for(const value of ['http://example.com/job','https://localhost/job','https://127.0.0.1/job','https://10.0.0.1/job','https://[::1]/job','https://example.com:8443/job','https://user:pass@example.com/job'])assert.throws(()=>candidateUrl(value));
  for(const ip of ['172.16.0.1','169.254.169.254','192.168.1.2','100.64.0.1','198.18.0.1','224.0.0.1'])assert.equal(publicIPv4(ip),false);
  assert.equal(publicIPv4('8.8.8.8'),true);
  assert.ok(matchesDomain('https://in.linkedin.com/jobs/view/1','linkedin.com/jobs'));
  assert.equal(matchesDomain('https://linkedin.com.attacker.com/jobs/1','linkedin.com/jobs'),false);
  assert.equal(matchesDomain('https://linkedin.com/jobs-other/1','linkedin.com/jobs'),false);
});

test('extraction requires JobPosting data, handles relative URLs, and respects robots',async()=>{
  assert.equal(extractJsonLd('<h1>Developer</h1><p>Apply now</p>','https://example.com/job').length,0);
  const rows=extractJsonLd('<script type="application/ld+json">broken</script>'+html({'@graph':[{...schema,url:'/job/123'}]}),'https://example.com/careers');
  assert.equal(rows[0].sourceUrl,'https://example.com/job/123');assert.equal(rows[0].postedAt,'');
  let requests=0;await assert.rejects(extractCandidate('https://example.com/job',{...api,async getText(){requests++;return 'User-agent: *\nDisallow: /job';}},profile),/disallows/);assert.equal(requests,1);
  const result=await extractCandidate('https://example.com/job',{...api,async getText(url){return url.endsWith('robots.txt')?'':html({...schema,url:'https://jobs.lever.co/example/abc'})+'<a href="https://jobs.lever.co/example/abc">Apply</a>';}},profile);
  assert.equal(result.records[0].canonicalUrl,'https://example.com/job');assert.deepEqual(result.links,['https://jobs.lever.co/example/abc']);
});

test('provider pagination is explicit; malformed responses fail; saved batches reject duplicate queries',async()=>{
  const search=new SearxngProvider('https://search.example.com/search',2);let requested='';
  const page=await search.search(queries[0],2,{async getJson(url){requested=url;return {results:[{url:'https://one.com/job'},{url:'https://two.com/job'},{url:'https://three.com/job'}]};}});
  assert.equal(new URL(requested).searchParams.get('pageno'),'2');assert.equal(page.results.length,2);assert.ok(page.warnings?.length);
  await assert.rejects(search.search(queries[0],1,{async getJson(){return '<html>CAPTCHA</html>';}}),/results array/);
  const dir=mkdtempSync(join(tmpdir(),'search-provider-'));try{
    const file=join(dir,'saved.json');writeFileSync(file,'\uFEFF'+JSON.stringify({queries:[{query:'PHP Mumbai',results:[{url:'https://example.com/job'}]}]}));
    const saved=new SavedResultsProvider(file);assert.equal((await saved.search(saved.queries[0],1)).results.length,1);
    writeFileSync(file,JSON.stringify({queries:[{query:'a',results:[]},{query:'a',results:[]}]}));assert.throws(()=>new SavedResultsProvider(file),/Duplicate/);
    writeFileSync(file,JSON.stringify({provider:'searxng',endpoint:'https://search.example.com/search'}));assert.throws(()=>loadSearchConfig(file),/permissionConfirmed/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('candidate limits, failures, domain restrictions and URL duplicates have honest diagnostics',async()=>{
  const pages:SourceContext={...api,async getText(url){if(url.endsWith('robots.txt'))return '';if(url.includes('/blocked'))throw new Error('HTTP 403');return url.includes('/snippet')?'<h1>A result snippet</h1>':html(schema);}};
  const source=searchSource(profile,{...searchDefaults,candidateLimit:4},{api,pages,queries:[{...queries[0],domain:'example.com'}],provider:provider(['https://example.com/job?utm_source=x','https://example.com/job','https://other.com/job','https://example.com/blocked','https://example.com/snippet','https://example.com/deferred'])});
  assert.equal((await source.discover(api)).length,2);const d=source.diagnostics!;
  assert.equal(d.searchDiscoveredUrls,6);assert.equal(d.uniqueCandidateUrls,4);assert.equal(d.duplicateUrls,1);assert.equal(d.offDomainResults,1);assert.equal(d.failedUrls,1);assert.equal(d.notJobUrls,1);assert.equal(d.deferredUrls,0);
});

test('provider failure stops further searches while existing direct sources still finish',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'search-isolation-')),store=new Store(join(dir,'db.sqlite'));try{
    let calls=0;const broken=searchSource(profile,searchDefaults,{queries:[...queries,{id:'next',query:'next'}],api,pages:api,provider:{name:'broken',mode:'automatic',async search(){calls++;throw new Error('HTTP 429');}}});
    const raw={externalId:'1',title:'Backend Developer',companyOrClient:'Example',description,sourceUrl:'https://example.com/job',location:'Mumbai'};
    const result=await discover(store,[broken,{name:'direct',discover:async()=>[raw]},searchSource(profile,searchDefaults,{queries,api,pages:api,provider:createProvider({...searchDefaults,provider:'none'})})],api,profile);
    assert.equal(calls,1);assert.equal(result.failed,1);assert.equal(result.unavailable,1);assert.equal(result.successful,1);assert.equal(result.directSourceOpportunities,1);assert.equal(result.searchExtractedOpportunities,0);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('search imports merge across portals, preserve status, and retain per-domain counts',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'search-merge-')),store=new Store(join(dir,'db.sqlite'));try{
    const source=searchSource(profile,searchDefaults,{queries,api,pages:{...api,async getText(url){return url.endsWith('robots.txt')?'':html(schema);}},provider:provider(['https://one.com/job','https://two.com/job'])});
    const run=await discover(store,[source],api,profile);assert.equal(run.searchExtractedOpportunities,2);assert.equal(run.deduplicatedRecords,1);assert.equal(store.list().length,1);assert.equal(store.references(store.list()[0].id).length,2);
    const first=store.list()[0];store.status(first.id,'APPLIED');
    store.upsert(normalize({...first,externalId:'ats',sourceUrl:'https://jobs.lever.co/example/ats',canonicalUrl:'https://jobs.lever.co/example/ats',authority:'employer'},'direct-ats'));
    assert.equal(store.list()[0].status,'APPLIED');assert.equal(store.list()[0].canonicalUrl,'https://jobs.lever.co/example/ats');assert.equal(store.references(first.id).length,3);
    const counts=run.sources[0].domainPipeline as Record<string,{unique:number}>;assert.equal(counts['one.com'].unique,1);assert.equal(counts['two.com'].unique,1);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('ATS extraction selects the actual job; registration preserves existing disabled entries',async()=>{
  const target=identifyAts('https://jobs.lever.co/example/abc')!;assert.equal(target.jobId,'abc');
  const result=await extractCandidate('https://jobs.lever.co/example/abc',{async getJson(){return [{id:'abc',text:'Backend Developer',descriptionPlain:description,hostedUrl:'https://jobs.lever.co/example/abc',categories:{location:'Mumbai'}},{id:'def',text:'Other',descriptionPlain:description,hostedUrl:'https://jobs.lever.co/example/def'}];}},profile);
  assert.equal(result.records.length,1);assert.ok(result.registration);
  const dir=mkdtempSync(join(tmpdir(),'search-registry-'));try{
    const file=join(dir,'sources.json'),entry=registryEntry(target,'https://jobs.lever.co/example/abc','Example');
    writeFileSync(file,JSON.stringify([{...entry,enabled:false}]));assert.equal(registerSource(entry,file),false);assert.equal(JSON.parse(readFileSync(file,'utf8'))[0].enabled,false);
    assert.equal(registerSource(registryEntry({...target,board:'another'},'https://jobs.lever.co/another/abc','Another'),file),true);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('specific SmartRecruiters search results fetch details without India-board or pagination restrictions',async()=>{
  let requested='';const result=await extractCandidate('https://jobs.smartrecruiters.com/Example/123-backend-developer',{async getJson(url){requested=url;return {id:'123',name:'Backend Developer',company:{name:'Example'},location:{city:'Worldwide',remote:true},jobAd:{sections:{jobDescription:{text:description}}}};}},profile);
  assert.equal(requested,'https://api.smartrecruiters.com/v1/companies/Example/postings/123');assert.equal(result.records.length,1);assert.equal(result.records[0].location,'Worldwide');
});

test('repeated provider pages stop and identical external IDs on different portals remain independent',async()=>{
  let calls=0;const source=searchSource(profile,{...searchDefaults,pagesPerQuery:5},{queries,api,pages:{...api,async getText(url){return url.endsWith('robots.txt')?'':html({...schema,hiringOrganization:{name:new URL(url).hostname}});}},provider:{name:'repeat',mode:'automatic',async search(){calls++;return {results:[{url:'https://one.com/job'},{url:'https://two.com/job'}],hasMore:true};}}});
  const rows=await source.discover(api);assert.equal(calls,2);assert.equal(rows.length,2);assert.notEqual(rows[0].externalId,rows[1].externalId);assert.ok(source.notes?.some(n=>n.includes('repeated search page')));
});
