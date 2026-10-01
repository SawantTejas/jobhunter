import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Profile, RawOpportunity } from '../src/model.ts';
import { normalize } from '../src/normalization/index.ts';
import { evaluate } from '../src/matching/index.ts';
import { indiaLocation } from '../src/matching/location.ts';
import { Store } from '../src/persistence/index.ts';
import { generateQueries,importRecords,loadDomains } from '../src/discovery/web.ts';
import { createSource } from '../src/sources/index.ts';
import { robotsAllowed } from '../src/sources/company-page.ts';
const p:Profile={...JSON.parse(readFileSync(new URL('../config/profile.example.json',import.meta.url),'utf8')),indiaFirst:true};
const raw:RawOpportunity={externalId:'php-1',title:'Backend Software Engineer',companyOrClient:'Example Pvt Ltd',description:'PHP Laravel PostgreSQL REST Vue. 3–5 years experience. Build maintain test and deploy reliable scalable backend services for our global customers with a collaborative team committed to security quality performance stability observability documentation and automated testing.',sourceUrl:'https://example.com/jobs/1',location:'Mumbai, India'};
test('Indian city ordering, country restrictions, remote eligibility and freelance exception',()=>{
  const scores=['Mumbai','Bangalore','Pune','Hyderabad','Remote India','Chennai'].map(location=>indiaLocation(normalize({...raw,location},'fixture')).score);
  assert.deepEqual(scores,[100,94,88,82,78,65]);
  for(const location of ['Remote US','Remote in US','Fort Wayne, IN, USA','London','Worldwide','Remote','Indianapolis'])assert.equal(indiaLocation(normalize({...raw,location,remoteType:'remote'},'fixture')).eligible,false,location);
  assert.equal(indiaLocation(normalize({...raw,location:'Worldwide',type:'FREELANCE'},'fixture')).eligible,true);
  assert.equal(indiaLocation(normalize({...raw,location:'Worldwide except India',type:'FREELANCE'},'fixture')).eligible,false);
  assert.equal(indiaLocation(normalize({...raw,location:'London',remoteType:'remote',description:raw.description+' Candidates from India are welcome.'},'fixture')).eligible,true);
  assert.equal(indiaLocation(normalize({...raw,location:'India',description:raw.description+' Must be based in the United States.'},'fixture')).eligible,false);
});
test('primary stack outweighs common backend infrastructure and dates do not rescue mismatch',()=>{
  const good=evaluate(normalize(raw,'a'),p);
  const java=evaluate(normalize({...raw,title:'Java Spring Backend Engineer',description:'Java Spring PostgreSQL REST. Strong experience in Java.',postedAt:new Date().toISOString()},'a'),p);
  assert.ok(good.matchScore>=80);assert.ok(java.matchScore<25);assert.ok(good.rankScore>java.rankScore);
  assert.ok(java.reasons.some(r=>r.includes('Java')));
  const now=Date.now();const fresh=evaluate(normalize({...raw,postedAt:new Date(now-3600000).toISOString()},'a'),p,now);
  const old=evaluate(normalize({...raw,postedAt:new Date(now-30*86400000).toISOString()},'a'),p,now);
  const unknown=evaluate(normalize({...raw,updatedAt:new Date(now).toISOString()},'a'),p,now);
  assert.ok(fresh.rankScore>old.rankScore+25);assert.match(unknown.freshness,/unknown/);assert.ok(unknown.rankScore<fresh.rankScore);
});
test('cross-portal merge prefers employer, preserves every source and saved state',()=>{
  const dir=mkdtempSync(join(tmpdir(),'v01-'));const store=new Store(join(dir,'db.sqlite'));
  try{
    for(const host of ['linkedin.com','naukri.com','in.indeed.com'])store.upsert(normalize({...raw,location:'Bangalore, India',sourceUrl:`https://${host}/jobs/123`,authority:'aggregator'},host));
    const id=store.list()[0].id;store.status(id,'SAVED');
    store.upsert(normalize({...raw,companyOrClient:'Example',location:'Bengaluru',sourceUrl:'https://job-boards.greenhouse.io/example/jobs/123',authority:'employer'},'greenhouse'));
    assert.equal(store.list().length,1);assert.equal(store.references(id).length,4);assert.equal(store.list()[0].status,'SAVED');assert.match(store.list()[0].canonicalUrl,/greenhouse/);
    store.close();const reopened=new Store(join(dir,'db.sqlite'));assert.equal(reopened.list().length,1);reopened.close();
  }finally{try{store.close();}catch{}rmSync(dir,{recursive:true,force:true});}
});
test('late canonical evidence consolidates existing rows without unique URL failure',()=>{
  const dir=mkdtempSync(join(tmpdir(),'v01-'));const store=new Store(join(dir,'db.sqlite'));
  try{
    store.upsert(normalize({...raw,description:'Brief syndicated listing'},'portal'));
    store.upsert(normalize({...raw,sourceUrl:'https://jobs.lever.co/example/123',authority:'employer'},'lever'));
    assert.equal(store.list().length,2);
    store.upsert(normalize({...raw,canonicalUrl:'https://jobs.lever.co/example/123'},'portal'));
    assert.equal(store.list().length,1);assert.equal(store.references(store.list()[0].id).length,2);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('V0 migration retains data and applies once',()=>{
  const dir=mkdtempSync(join(tmpdir(),'v01-'));const path=join(dir,'db.sqlite');const old=new DatabaseSync(path);
  old.exec('CREATE TABLE migrations(name TEXT PRIMARY KEY)');old.exec(readFileSync(new URL('../migrations/001_initial.sql',import.meta.url),'utf8'));old.exec("INSERT INTO migrations VALUES ('001_initial.sql'); INSERT INTO candidate_profile VALUES (1,'{}','2026-01-01')");old.close();
  let store:Store|undefined;
  try{store=new Store(path);assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM migrations').get()?.n,4);assert.equal(store.db.prepare('SELECT profileJson FROM candidate_profile').get()?.profileJson,'{}');store.close();store=new Store(path);assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM migrations').get()?.n,4);}finally{store?.close();rmSync(dir,{recursive:true,force:true});}
});
test('search plans are bounded and profile-derived; imported JSON-LD retains actual dates',()=>{
  const domains=loadDomains();const queries=generateQueries(p,domains,31);assert.equal(queries.length,31);assert.equal(new Set(queries.map(q=>q.id)).size,31);assert.ok(queries.every(q=>[...p.targetTitles,...p.relatedTitles].some(t=>q.query.includes(t))&&q.query.includes('PHP')));assert.ok(queries.some(q=>q.query.includes('Bengaluru')));assert.ok(queries.some(q=>q.query.includes('Pune')));
  assert.notDeepEqual(generateQueries(p,domains,31,31),queries);assert.ok(generateQueries({...p,targetTitles:['Rust Engineer'],relatedTitles:[],strongSkills:['Rust']},domains,1)[0].query.includes('Rust'));
  const dir=mkdtempSync(join(tmpdir(),'v01-'));try{
    const path=join(dir,'saved.html');writeFileSync(path,`<script type="application/ld+json">${JSON.stringify({'@type':'JobPosting',title:'PHP Developer',description:'Laravel PHP',url:'https://example.com/jobs/2',hiringOrganization:{name:'Example'},dateModified:'2026-01-01',jobLocationType:'TELECOMMUTE',applicantLocationRequirements:{'@type':'Country',name:'India'}})}</script>`);
    const records=importRecords(path);assert.equal(records.length,1);assert.equal(records[0].postedAt,'');assert.equal(normalize(records[0],'import').postedAt,undefined);assert.equal(records[0].location,'India');
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('SmartRecruiters uses India filter, detail cap, and publication provenance',async()=>{
  const requested:string[]=[];const source=createSource({id:'sr',adapter:'smartrecruiters',company:'Example',board:'Example',enabled:true,maxDetails:1},p);
  const data=await source.discover({getJson:async url=>{requested.push(url);return url.includes('?')?{content:[{id:'1',name:'PHP Developer'},{id:'2',name:'PHP Developer'}],totalFound:2}:{id:'1',name:'PHP Developer',location:{city:'Mumbai',country:'in'},releasedDate:'2026-01-01T00:00:00Z',jobAd:{sections:{jobDescription:{text:'PHP Laravel'}}}};}});
  assert.equal(data.length,1);assert.ok(requested[0].includes('country=in'));assert.match(data[0].location!,/India/);assert.equal(data[0].dateKind,'published');assert.ok(source.notes?.some(n=>n.startsWith('PARTIAL:')));
});
test('company pages respect robots and parse only JobPosting structured data',async()=>{
  assert.equal(robotsAllowed('User-agent: *\nDisallow: /private\nAllow: /private/jobs','/private/jobs/1'),true);
  assert.equal(robotsAllowed('User-agent: *\nDisallow: /search','/search?q=php'),false);
  assert.equal(robotsAllowed('User-agent: *\nDisallow: /jobs$','/jobs/1'),true);
  assert.equal(robotsAllowed('User-agent: *\nDisallow: /jobs$','/jobs'),false);
  const source=createSource({id:'page',adapter:'company-page',company:'Example',board:'https://example.com/jobs/1',enabled:true});
  let fetched=false;
  await assert.rejects(source.discover({getJson:async()=>({}),getText:async url=>{if(url.endsWith('robots.txt'))return 'User-agent: *\nDisallow: /';fetched=true;return '';}}),/disallows/);assert.equal(fetched,false);
  const rows=await source.discover({getJson:async()=>({}),getText:async url=>url.endsWith('robots.txt')?'User-agent: *\nAllow: /':`<script type="application/ld+json">${JSON.stringify({'@type':'JobPosting',title:'Laravel Developer',description:'PHP Laravel',hiringOrganization:{name:'Example'},datePosted:'2026-01-01'})}</script>`});
  assert.equal(rows[0].authority,'employer');assert.equal(rows[0].sourceUrl,'https://example.com/jobs/1');assert.equal(normalize(rows[0],'page').dateKind,'date-only');
});
test('mandatory unsupported framework and senior title are explained',()=>{
  const o=normalize({...raw,title:'PHP Symfony Engineer',description:raw.description+' Laravel-only experience is not qualifying; Symfony is mandatory.'},'a');
  const e=evaluate(o,p);assert.ok(e.matchScore<25);assert.ok(e.reasons.some(r=>r.includes('Symfony')));
  const staff=evaluate(normalize({...raw,title:'Principal PHP Developer'},'a'),p);assert.ok(staff.matchScore<=35);assert.ok(staff.reasons.some(r=>r.includes('Seniority review')));
});
test('alternative stacks admit Node/FastAPI without admitting management or far-too-senior work',()=>{
  const multi={...p,skills:[...p.skills,'Node.js','Python','FastAPI'],strongSkills:['PHP','Laravel','Node.js','FastAPI'],coreSkillGroups:[['PHP','Laravel'],['JavaScript','Node.js'],['Python','FastAPI']],roleFamilies:['backend','software','fullstack','mobile']};
  for(const description of ['Node.js JavaScript REST PostgreSQL','Python FastAPI PostgreSQL REST'])assert.ok(evaluate(normalize({...raw,description},'a'),multi).matchScore>75);
  assert.ok(evaluate(normalize({...raw,title:'Project Manager (Web and Mobile applications)'},'a'),multi).matchScore<25);
  assert.ok(evaluate(normalize({...raw,experienceMin:10,experienceMax:12},'a'),multi).matchScore<25);
  assert.ok(evaluate(normalize({...raw,experienceMin:10,experienceMax:12},'a'),{...multi,prioritizeKeywords:['Laravel']}).matchScore<25);
  assert.equal(normalize({...raw,title:'Senior Full Stack Developer (Remote, Contractual)'},'a').type,'CONTRACT');
});
