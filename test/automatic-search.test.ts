import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TavilyKeylessProvider} from '../src/discovery/search/tavily.ts';
import {createProvider,loadSearchConfig} from '../src/discovery/search/providers.ts';
import {searchSource} from '../src/discovery/search/index.ts';
import {searchDefaults} from '../src/discovery/search/model.ts';
import {extractListingLinks} from '../src/discovery/search/extraction.ts';
import type {Profile,SourceContext} from '../src/model.ts';
import {Store} from '../src/persistence/index.ts';
import {discover} from '../src/discovery/index.ts';
const profile=JSON.parse(readFileSync(new URL('../config/profile.example.json',import.meta.url),'utf8')) as Profile;
const query={id:'q',query:'site:example.com Laravel Mumbai',domain:'example.com'};
const description='PHP Laravel PostgreSQL REST Vue. Build and maintain backend services, documented APIs and automated tests for our collaborative software engineering team.';
const html=(value:unknown)=>`<script type="application/ld+json">${JSON.stringify(value)}</script>`;

test('no-configuration discovery chooses automatic keyless search',()=>{
  const c=loadSearchConfig('missing-config-for-default-test.json');assert.equal(c.provider,'tavily');assert.equal(createProvider(c).name,'tavily-keyless');assert.equal(createProvider(c).mode,'automatic');
});

test('keyless search sends no credentials or AI-answer requests, and caches public metadata without treating generic snippets as jobs',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jobhunter-keyless-'));let requests=0;
  try{
    const request:typeof fetch=async(url,init)=>{
      requests++;assert.equal(url,'https://api.tavily.com/search');assert.equal(init?.method,'POST');assert.equal(init?.redirect,'error');
      const headers=new Headers(init?.headers);assert.equal(headers.get('authorization'),null);assert.equal(headers.get('X-Tavily-Access-Mode'),'keyless');
      const body=JSON.parse(String(init?.body));assert.equal(body.query,query.query);assert.deepEqual(body.include_domains,['example.com']);assert.equal(body.include_answer,false);assert.equal(body.include_raw_content,false);assert.equal(body.auto_parameters,false);assert.equal(body.search_depth,'basic');
      return new Response(JSON.stringify({results:[{url:'https://example.com/job/123',title:'Developer',content:'generic snippet is retained only as evidence'}]}));
    };
    const provider=new TavilyKeylessProvider(dir,10,request),a=await provider.search(query,1);assert.equal(a.results.length,1);assert.equal(a.hasMore,false);
    assert.deepEqual(await new TavilyKeylessProvider(dir,10,request).search(query,1),a);assert.equal(requests,1);
    assert.equal((await provider.search(query,2)).results.length,0);assert.equal(requests,1);
    assert.ok(readFileSync(join(dir,readdirSync(dir)[0]),'utf8').includes('generic snippet is retained only as evidence'));
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('provider rate limits persist across restarts and never trigger paid fallback or retry',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jobhunter-cap-'));let requests=0;
  try{
    const request:typeof fetch=async()=>{requests++;return new Response(JSON.stringify({error:{code:'keyless_limit',retry_after_seconds:3600}}),{status:429,headers:{'retry-after':'3600'}});};
    await assert.rejects(new TavilyKeylessProvider(dir,10,request).search(query,1),/No paid fallback/);
    await assert.rejects(new TavilyKeylessProvider(dir,10,request).search({...query,query:'another'},1),/paused until/);assert.equal(requests,1);
    const state=JSON.parse(readFileSync(join(dir,'tavily-cooldown.json'),'utf8'));assert.ok(state.until>Date.now()+3500000);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('successful HTTP error envelopes and malformed provider responses are not search results',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jobhunter-envelope-'));try{
    await assert.rejects(new TavilyKeylessProvider(dir,10,async()=>new Response('<html>Challenge</html>')).search(query,1),/non-JSON/);
    await assert.rejects(new TavilyKeylessProvider(dir,10,async()=>new Response(JSON.stringify({error:{code:'keyless_limit',retry_after_seconds:60}}))).search(query,1),/keyless_limit/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('structured listing links are bounded, same-host, and never inferred from breadcrumbs',()=>{
  const content=html({'@graph':[{'@type':'BreadcrumbList',itemListElement:[{url:'https://example.com/jobs/breadcrumb'}]},{'@type':'ItemList',itemListElement:[{url:'https://other.com/job/not-allowed'},{item:{url:'/job/123'}},...Array.from({length:15},(_,n)=>({url:'/job/'+n}))]}]});
  const links=extractListingLinks(content,'https://example.com/jobs');assert.equal(links.length,10);assert.equal(links[0],'https://example.com/job/123');assert.ok(links.every(url=>url.startsWith('https://example.com/job/')));
});

test('automatic provider → category → validated job → SQLite needs no user-supplied URLs',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jobhunter-auto-flow-')),store=new Store(join(dir,'db.sqlite'));let calls=0;
  const transport:SourceContext={async getJson(){throw Error('Unexpected call');},async getText(url){
    if(url.endsWith('/robots.txt'))return '';
    if(url.endsWith('/jobs'))return html({'@type':'ItemList',itemListElement:[{url:'https://example.com/job/123'}]});
    return html({'@type':'JobPosting',identifier:'123',title:'Backend Developer',hiringOrganization:{name:'Example'},description,jobLocation:{address:{addressLocality:'Mumbai',addressCountry:'IN'}}})+html({'@type':'ItemList',itemListElement:[{url:'https://example.com/job/unbounded-crawl'}]});
  }};
  try{
    const provider=new TavilyKeylessProvider(join(dir,'cache'),10,async()=>{calls++;return new Response(JSON.stringify({results:[{url:'https://example.com/jobs'}]}));});
    const source=searchSource(profile,searchDefaults,{provider,queries:[query],api:transport,pages:transport});
    const result=await discover(store,[source],transport,profile);
    assert.equal(calls,1);assert.equal(result.searchExtractedOpportunities,1);assert.equal(result.runPipeline.relevant,1);assert.equal(store.list()[0].location,'Mumbai, India');
    assert.equal(source.diagnostics?.searchDiscoveredUrls,1);assert.equal(source.diagnostics?.linkedListingUrls,1);assert.equal(source.diagnostics?.uniqueCandidateUrls,2);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('one blocked query cannot consume the candidate budget before later job domains',async()=>{
  const inspected:string[]=[];
  const source=searchSource(profile,{...searchDefaults,candidateLimit:2},{queries:[{id:'blocked',query:'first'},{id:'working',query:'second'}],api:{async getJson(){return {};}},pages:{async getJson(){return {};},async getText(url){if(url.endsWith('robots.txt'))return '';inspected.push(url);if(url.includes('blocked.com'))throw Error('HTTP 403');return html({'@type':'JobPosting',title:'Backend Developer',description,hiringOrganization:{name:'Example'}});}},provider:{name:'fixture',mode:'automatic',async search(q){return {results:q.id==='blocked'?Array.from({length:10},(_,n)=>({url:`https://blocked.com/job/${n}`})):[{url:'https://working.com/job/1'}],hasMore:false};}}});
  assert.equal((await source.discover({async getJson(){return {};}})).length,1);assert.equal(inspected.length,2);assert.equal(inspected[1],'https://working.com/job/1');
});
