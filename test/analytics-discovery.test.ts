import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/persistence/index.ts';
import {normalize} from '../src/normalization/index.ts';
import {evaluate} from '../src/matching/index.ts';
import {indiaLocation} from '../src/matching/location.ts';
import {pipelineDiagnostics} from '../src/discovery/diagnostics.ts';
import {createSource} from '../src/sources/index.ts';
import {PublicExportService} from '../src/export/public-export.ts';
import {validateSnapshot,type PublicOpportunity} from '../shared/public-model.ts';
import {analytics} from '../web/analytics.ts';
import {locationTags} from '../web/locations.ts';
import {cohorts,skillsFor,cumulativeSeries,appliedFreshness,scoreBucket} from '../web/outcomes.ts';
import type {Profile} from '../src/model.ts';
const profile:Profile={...JSON.parse(readFileSync(new URL('../config/profile.example.json',import.meta.url),'utf8')),indiaFirst:true};
const raw={externalId:'1',title:'Laravel Backend Developer',companyOrClient:'Example',description:'PHP Laravel PostgreSQL REST Vue',location:'Mumbai',sourceUrl:'https://example.com/jobs/1'};
const job=(id:string,extra:Partial<PublicOpportunity>={}):PublicOpportunity=>({id,title:'Backend Developer',company:'Example',location:'Mumbai',type:'EMPLOYMENT',status:'APPLIED',matchScore:85,description:'Safe',freshness:'Unknown',skills:['PHP'],appliedAt:'2026-09-25T08:00:00Z',...extra});
test('India-compatible remote geography includes global and broad Asia but excludes explicit restrictions',()=>{
  for(const location of ['Worldwide','Global Remote','Remote APAC','Remote Asia','Remote South Asia','Remote India'])assert.equal(indiaLocation(normalize({...raw,location,remoteType:'remote'},'fixture')).eligible,true,location);
  for(const location of ['Remote US-only','Remote EU-only','Remote UK-only','Remote Canada-only','Worldwide except India','APAC Singapore only','Remote Southeast Asia','APAC excluding India'])assert.equal(indiaLocation(normalize({...raw,location,remoteType:'remote'},'fixture')).eligible,false,location);
  assert.equal(indiaLocation(normalize({...raw,location:'Remote APAC',description:raw.description+' Must be based in Singapore.',remoteType:'remote'},'fixture')).eligible,false);
});
test('location filters distinguish Navi Mumbai, normalize Bangalore and expose remote scopes',()=>{
  assert.deepEqual(locationTags({location:'Navi Mumbai, India'}),['Navi Mumbai']);
  assert.deepEqual(locationTags({location:'Bangalore, India'}),['Bengaluru']);
  assert.ok(locationTags({location:'Worldwide',remoteType:'remote',remoteScope:'global'}).includes('Global Remote'));
  assert.ok(locationTags({location:'India',remoteType:'remote'}).includes('Remote India'));
});
test('Himalayas paginates India plus worldwide, deduplicates results and stops empty pages',async()=>{
  const requests:string[]=[];const source=createSource({id:'h',adapter:'himalayas',company:'Feed',board:'',enabled:true,maxQueries:1,maxPages:4},profile);
  const result=await source.discover({getJson:async url=>{requests.push(url);const page=Number(new URL(url).searchParams.get('page'));return {jobs:page<3?[{guid:String(page),title:'Laravel Developer',companyName:'Example',applicationLink:`https://example.com/jobs/${page}`,locationRestrictions:page===1?['IN']:[]}]:[]};}});
  assert.equal(requests.length,3);assert.equal(result.length,2);assert.equal(result[1].location,'Worldwide');assert.ok(requests.every(url=>url.includes('country=IN')&&!url.includes('exclude_worldwide')));
});
test('diagnostic stages reconcile without counting overlapping reasons as separate jobs',()=>{
  const d=pipelineDiagnostics([normalize(raw,'a'),normalize({...raw,location:'London'},'b'),normalize({...raw,title:'Java Spring Developer',description:'Java Spring PostgreSQL REST'},'c')],profile);
  assert.equal(d.unique,3);assert.equal(d.hardFiltered,1);assert.equal(d.eligible,2);assert.equal(d.belowMatchThreshold,1);assert.equal(d.relevant,1);assert.equal(d.unknownPostingDate,3);
});
test('skill cohorts count every job keyword once and retain interviews after rejection',()=>{
  const jobs=[job('1',{status:'REJECTED',jobSkills:['PHP','Redis','Redis'],interviewAt:'2026-09-28T08:00:00Z'}),job('2',{jobSkills:['PHP','AWS']})];
  const c=cohorts(jobs,skillsFor);assert.deepEqual(c.find(r=>r.name==='PHP'),{name:'PHP',applications:2,interviews:1,rate:50});assert.equal(c.find(r=>r.name==='Redis')?.applications,1);assert.equal(c.find(r=>r.name==='AWS')?.rate,0);
});
test('cumulative interviews use interview dates with a carried baseline and freshness never uses discovery',()=>{
  const a=analytics({schemaVersion:1,exportedAt:'2026-10-01T12:00:00Z',timeZone:'Asia/Kolkata',opportunities:[job('1',{interviewAt:'2026-09-30T08:00:00Z'}),job('2',{appliedAt:'2026-10-01T08:00:00Z'})]},'2026-10-01T12:00:00Z');
  assert.deepEqual(cumulativeSeries(a,3),[{day:'2026-09-29',applications:1,interviews:0},{day:'2026-09-30',applications:1,interviews:1},{day:'2026-10-01',applications:2,interviews:1}]);
  assert.equal(appliedFreshness(job('1')),'Unknown');assert.match(appliedFreshness(job('1',{postedAt:'2026-10-01T08:00:00Z'})),/Unknown/);
  const frozen=job('1',{matchScore:20,postedAt:'2026-10-01T08:00:00Z',applicationFacts:{recordedAt:'2026-09-25T08:00:00Z',matchScore:93,postedAt:'2026-09-25T06:00:00Z',skills:['Redis']}});
  assert.equal(scoreBucket(frozen),'90–100%');assert.equal(appliedFreshness(frozen),'< 1 day');assert.deepEqual(skillsFor(frozen),['Redis']);
});
test('application facts survive rediscovery and concurrent local status changes; public whitelist rejects private facts',()=>{
  const dir=mkdtempSync(join(tmpdir(),'analytics-')),path=join(dir,'db.sqlite'),store=new Store(path);let editor:Store|undefined;
  try{
    const o=normalize({...raw,postedAt:'2026-09-24T08:00:00Z'},'fixture');store.upsert(o);store.list();editor=new Store(path);
    editor.status(o.id,'APPLIED',undefined,'2026-09-25T08:00:00Z',92);editor.status(o.id,'INTERVIEW',undefined,'2026-09-26T08:00:00Z');
    store.upsert(normalize({...raw,postedAt:'2026-10-01T08:00:00Z',description:'Java Spring'},'fixture'));
    assert.equal(store.list()[0].status,'INTERVIEW');const snapshot=new PublicExportService().snapshot(store,profile);validateSnapshot(snapshot);
    const facts=snapshot.opportunities[0].applicationFacts!;assert.equal(facts.matchScore,92);assert.equal(facts.postedAt,'2026-09-24T08:00:00.000Z');assert.ok(facts.skills.includes('Laravel'));
    assert.throws(()=>validateSnapshot({...snapshot,opportunities:[{...snapshot.opportunities[0],applicationFacts:{...facts,privateNote:'never publish'}}]}),/application facts/);
  }finally{editor?.close();store.close();rmSync(dir,{recursive:true,force:true});}
});

test('currency or geography PHP does not make an accountant a developer',()=>{assert.ok(evaluate(normalize({...raw,title:'Accountant, Client Management (Remote India, PHP)'},'fixture'),profile).matchScore<25);});
