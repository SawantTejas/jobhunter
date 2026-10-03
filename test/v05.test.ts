import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {extractRequirements,confidenceFor} from '../src/extraction/requirements.ts';
import {normalize} from '../src/normalization/index.ts';
import {evaluate} from '../src/matching/index.ts';
import {Store} from '../src/persistence/index.ts';
import {PublicExportService} from '../src/export/public-export.ts';
import {CandidateQueue} from '../src/discovery/search/queue.ts';
import {checkAvailability} from '../src/discovery/lifecycle.ts';
import {actionableInsights} from '../web/outcomes.ts';
import {analytics} from '../web/analytics.ts';
import type {Profile,RawOpportunity} from '../src/model.ts';
const profile:Profile=JSON.parse(readFileSync(new URL('../config/profile.example.json',import.meta.url),'utf8'));
const raw:RawOpportunity={externalId:'1',title:'Backend Developer',companyOrClient:'Example',description:'Requirements:\nPHP Laravel PostgreSQL REST.\n3–5 years of professional experience.\nPreferred skills:\nRedis AWS.\nBachelor degree in computer science.',location:'Mumbai, India',remoteType:'hybrid',authority:'employer',sourceUrl:'https://careers.example.com/jobs/1',postedAt:'2026-10-01T00:00:00Z'};
const fixture=()=>{const dir=mkdtempSync(join(tmpdir(),'v05-')),store=new Store(join(dir,'db.sqlite'));return {store,close(){store.close();rmSync(dir,{recursive:true,force:true});}};};
test('requirements distinguish sections, mentions, education and experience without an LLM',()=>{
  const r=extractRequirements('<h2>Requirements:</h2><ul><li>PHP Laravel PostgreSQL REST</li></ul><h2>Preferred skills:</h2><p>Redis AWS</p><h2>About us:</h2><p>We use Python.</p><p>3–5 years of professional experience. Bachelor degree in computer science.</p>');
  assert.deepEqual(r.required,['PHP','Laravel','PostgreSQL','REST']);assert.deepEqual(r.preferred,['Redis','AWS']);assert.ok(r.mentioned.includes('Python'));assert.equal(r.experienceMin,3);assert.equal(r.experienceMax,5);assert.ok(r.education.length);
  assert.equal(extractRequirements('We build PHP and Laravel services.').required.length,0);
  const facts=normalize({...raw,location:undefined,remoteType:undefined,description:'Location: Bengaluru, India\nWork mode: Remote\nEmployment type: Contract\nRequired: PHP Laravel.'},'test');
  assert.equal(facts.location,'Bengaluru, India');assert.equal(facts.remoteType,'remote');assert.equal(facts.type,'CONTRACT');
  assert.equal(extractRequirements('AWS not required.').required.length,0);
});
test('mandatory gaps reduce fit more than optional gaps; incompatible required stack is capped',()=>{
  const optional=evaluate(normalize(raw,'test'),profile);
  const mandatory=evaluate(normalize({...raw,description:raw.description.replace('Preferred skills:','Requirements:')},'test'),profile);
  assert.ok(optional.matchScore>mandatory.matchScore);assert.ok(optional.reasons.includes('Core requirements: 4/4'));
  const java=evaluate(normalize({...raw,description:'Requirements:\nJava Spring PostgreSQL REST.\nPreferred skills:\nPHP Laravel.'},'test'),profile);
  assert.ok(java.matchScore<25);assert.ok(java.reasons.some(r=>r.includes('Java')));
});
test('filtered jobs retain match explanations and metadata stays low confidence after persistence',()=>{
  const f=fixture();try{
    const o=normalize({...raw,location:'US only',remoteType:'remote',original:{partial:true}},'test');f.store.upsert(o);
    const restored=f.store.list()[0],e=evaluate(restored,profile);assert.ok(e.filtered.length);assert.ok(e.reasons.length);assert.equal(e.rankScore,0);assert.equal(e.confidence,'LOW');assert.deepEqual(restored.requirements?.required,['PHP','Laravel','PostgreSQL','REST']);
    const exporter=new PublicExportService();assert.equal(exporter.snapshot(f.store,profile).opportunities.length,0);
    const local=exporter.snapshot(f.store,profile,undefined,true);assert.equal(local.opportunities.length,1);assert.ok(local.opportunities[0].intelligence?.exclusions.length);
    assert.equal(confidenceFor(normalize({...raw,description:raw.description+' We build reliable services for customers.'.repeat(20)},'test')).confidence,'HIGH');
    assert.equal(confidenceFor(normalize({...raw,authority:'aggregator',description:raw.description+' We build reliable services for customers.'.repeat(20)},'test')).confidence,'MEDIUM');
  }finally{f.close();}
});
test('lifecycle needs canonical repeated evidence and preserves application history',()=>{
  const f=fixture();try{
    const o=normalize(raw,'test','2026-09-01T00:00:00Z');f.store.upsert(o);f.store.status(o.id,'APPLIED',undefined,'2026-09-02T00:00:00Z');
    f.store.observeAvailability(o.id,'NOT_FOUND','https://aggregator.example/1','2026-10-01T00:00:00Z');assert.equal(f.store.list()[0].availability,'ACTIVE');
    f.store.observeAvailability(o.id,'NOT_FOUND',o.canonicalUrl,'2026-10-01T00:00:00Z');assert.equal(f.store.list()[0].availability,'POSSIBLY_CLOSED');
    f.store.observeAvailability(o.id,'NOT_FOUND',o.canonicalUrl,'2026-10-01T01:00:00Z');assert.equal(f.store.list()[0].availability,'POSSIBLY_CLOSED');
    f.store.observeAvailability(o.id,'NOT_FOUND',o.canonicalUrl,'2026-10-02T00:00:00Z');assert.equal(f.store.list()[0].availability,'CLOSED');
    assert.equal(f.store.list()[0].status,'APPLIED');assert.equal(f.store.list()[0].appliedAt,'2026-09-02T00:00:00Z');assert.ok(evaluate(f.store.list()[0],profile).filtered.includes('Closed'));
    assert.equal(new PublicExportService().snapshot(f.store,profile).opportunities.length,1);
    f.store.upsert(normalize(raw,'test','2026-10-03T00:00:00Z'));assert.equal(f.store.list()[0].availability,'ACTIVE');
    f.store.observeAvailability(o.id,'INACCESSIBLE',o.canonicalUrl,'2026-10-04T00:00:00Z');assert.equal(f.store.list()[0].availability,'ACTIVE');
    f.store.observeAvailability(o.id,'INACCESSIBLE',o.canonicalUrl,'2026-10-05T00:00:00Z');assert.equal(f.store.list()[0].availability,'INACCESSIBLE');assert.equal(f.store.list()[0].closed,false);
  }finally{f.close();}
});
test('new window skips failed runs and optional target does not affect streak or leak profile',()=>{
  const f=fixture();try{
    for(const [id,day,successful] of [['one','01',1],['two','02',1],['failed','03',0]] as const)f.store.db.prepare('INSERT INTO search_runs VALUES (?,?,?,?)').run(id,`2026-10-${day}T00:00:00Z`,`2026-10-${day}T01:00:00Z`,JSON.stringify({successful}));
    f.store.upsert(normalize(raw,'test','2026-10-02T00:30:00Z'));const exporter=new PublicExportService();
    const local=exporter.snapshot(f.store,{...profile,dailyApplicationTarget:10},'2026-10-03T00:00:00Z',true);assert.equal(local.opportunities[0].newSinceSearch,true);assert.equal(local.dailyApplicationTarget,10);
    assert.equal(exporter.snapshot(f.store,{...profile,dailyApplicationTarget:10}).dailyApplicationTarget,undefined);
    local.opportunities[0].appliedAt='2026-10-03T06:00:00Z';local.opportunities[0].status='APPLIED';assert.equal(analytics(local,'2026-10-03T07:00:00Z').current,1);
  }finally{f.close();}
});
test('lifecycle checks respect robots and use matching structured closure evidence',async()=>{
  const f=fixture();try{
    const o=normalize(raw,'test','2026-09-01T00:00:00Z');f.store.upsert(o);const requests:string[]=[];
    await checkAvailability(f.store,{getJson:async()=>({}),getText:async url=>{requests.push(url);return 'User-agent: *\nDisallow: /';}},'2026-10-03T00:00:00Z');
    assert.deepEqual(requests,['https://careers.example.com/robots.txt']);assert.equal(f.store.list()[0].closed,false);
    const result=await checkAvailability(f.store,{getJson:async()=>({}),getText:async url=>url.endsWith('robots.txt')?'User-agent: *\nAllow: /':JSON.stringify({'@type':'JobPosting',title:raw.title,description:raw.description,hiringOrganization:{name:raw.companyOrClient},url:raw.sourceUrl,validThrough:'2026-09-01T00:00:00Z'})},'2026-10-12T00:00:00Z');
    assert.equal(result[0].evidence,'CLOSED');assert.equal(f.store.list()[0].availability,'CLOSED');
  }finally{f.close();}
});
test('unchanged candidate metadata stays terminal; changed metadata is revisited after cooldown',()=>{
  const q=new CandidateQueue();try{
    const item={url:raw.sourceUrl,queryId:'q',depth:0,metadata:{url:raw.sourceUrl,title:'Original',content:'Old description'}};
    q.add(item,1);q.finish(item,'INSPECTED','validated',undefined,2);q.add(item,8*86400000);assert.equal(q.next(new Set(),8*86400000),undefined);
    q.add({...item,metadata:{...item.metadata,content:'Changed requirements'}},8*86400000);assert.ok(q.next(new Set(),8*86400000));
  }finally{q.close();}
});
test('actionable insights require ten applications and display actual interview counts',()=>{
  const jobs=Array.from({length:10},(_,i)=>({id:String(i),title:'PHP Developer',company:'Example',location:'Mumbai',type:'EMPLOYMENT' as const,status:'APPLIED' as const,matchScore:80,description:'',freshness:'',skills:['PHP'],appliedAt:'2026-10-01',...(i<2?{interviewAt:'2026-10-02'}:{})}));
  assert.equal(actionableInsights(jobs.slice(0,9)).length,0);const php=actionableInsights(jobs).find(g=>g.dimension==='Skills')!.rows[0];assert.equal(php.applications,10);assert.equal(php.interviews,2);assert.equal(php.rate,20);
});
