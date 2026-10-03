import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CandidateQueue,failureKind} from '../src/discovery/search/queue.ts';
import {PublicPageClient} from '../src/discovery/search/network.ts';
import {matchesDomain} from '../src/discovery/search/index.ts';
import {partialFromMetadata} from '../src/discovery/search/partial.ts';
import {QueryGenerator} from '../src/discovery/search/queries.ts';
import {loadDomains} from '../src/discovery/web.ts';
import {normalize} from '../src/normalization/index.ts';
import {indiaLocation} from '../src/matching/location.ts';
import {evaluate} from '../src/matching/index.ts';
import {Store} from '../src/persistence/index.ts';
import {createSource} from '../src/sources/index.ts';
import type {Profile,SourceContext} from '../src/model.ts';
const profile:Profile={...JSON.parse(readFileSync(new URL('../config/profile.example.json',import.meta.url),'utf8')),indiaFirst:true};
const raw={externalId:'1',title:'Web Developer',companyOrClient:'Example',location:'Mumbai',description:'PHP Laravel PostgreSQL REST. Build reliable backend services and maintain software applications with automated testing and documentation.',sourceUrl:'https://example.com/job/1'};
test('persistent queue resumes deferred work with fair domains, preserves results, and does not repeat blocked URLs',()=>{
  const dir=mkdtempSync(join(tmpdir(),'queue-'));let q=new CandidateQueue(join(dir,'q.sqlite'));
  try{
    for(let n=0;n<500;n++)q.add({url:`https://portal${n%50}.com/job/${n}`,queryId:'q',depth:0},n+1);
    const attempted=new Set<string>(),domains=new Set<string>();
    for(let n=0;n<100;n++){const item=q.next(attempted)!;assert(item);attempted.add(item.url);if(n<50)domains.add(new URL(item.url).hostname);q.finish(item,n===0?'BLOCKED':'INSPECTED','test',n===1?[raw]:undefined);}
    assert.equal(domains.size,50);assert.equal(q.pending().length,400);q.close();q=new CandidateQueue(join(dir,'q.sqlite'));
    assert.equal(q.pending().length,400);assert.equal(q.outputs().length,1);assert(!attempted.has(q.next(new Set())!.url));q.acknowledge();assert.equal(q.outputs().length,0);
  }finally{q.close();rmSync(dir,{recursive:true,force:true});}
});
test('transient failure backoff survives restart and becomes terminal after three attempts',()=>{
  const q=new CandidateQueue();try{const item={url:'https://example.com/job/1',queryId:'q',depth:0};q.add(item,1);
    q.finish(item,'RETRYABLE','timeout',undefined,100);assert.equal(q.next(new Set(),101),undefined);
    assert(q.next(new Set(),3600100));q.finish(item,'RETRYABLE','timeout',undefined,3600100);q.finish(item,'RETRYABLE','timeout',undefined,10800100);
    assert.equal(q.states().FAILED,1);assert.equal(q.next(new Set(),1e15),undefined);
    assert.equal(failureKind(Error('HTTP 403')).state,'BLOCKED');assert.equal(failureKind(Error('AbortError')).state,'RETRYABLE');
  }finally{q.close();}
});
test('rotation covers every enabled domain before revisiting a cycle and changes subsequent query combinations',()=>{
  const domains=loadDomains().filter(d=>d.mode!=='unavailable'),g=new QueryGenerator();let offset=0;const seen=new Set<string>(),queries:string[]=[];
  while(offset<domains.length){const batch=g.generate(profile,domains,20,4,offset),targeted=batch.filter(q=>q.domain);targeted.forEach(q=>{seen.add(q.domain!);queries.push(q.query);});offset+=targeted.length;}
  assert.equal(seen.size,domains.length);assert.notDeepEqual(g.generate(profile,domains,20,4,0),g.generate(profile,domains,20,4,domains.length));
});
test('Wellfound accepts jobs and role listing paths but not unrelated pages or lookalike hosts',()=>{
  for(const path of ['/jobs/123-developer','/role/r/php-developer','/role/l/laravel-developer/india'])assert(matchesDomain('https://wellfound.com'+path,'wellfound.com/jobs'));
  for(const url of ['https://wellfound.com/company/foo','https://wellfound.com/blog/jobs','https://wellfound.com.attacker.com/role/foo'])assert(!matchesDomain(url,'wellfound.com/jobs'));
  assert(!matchesDomain('https://wellfound.com/blog/jobs','wellfound.com'));
});
test('unknown remote remains eligible but lower ranked; explicit foreign exclusions and stack mismatch remain excluded',()=>{
  const unknown=normalize({...raw,location:'Remote',remoteType:'remote'},'test'),india=normalize({...raw,location:'Remote India',remoteType:'remote'},'test');
  assert.equal(indiaLocation(unknown).remoteEligibility,'UNKNOWN');assert(indiaLocation(unknown).eligible);assert(evaluate(unknown,profile).matchScore<evaluate(india,profile).matchScore);
  assert.equal(indiaLocation(normalize({...raw,location:'Location not specified',remoteType:'remote'},'test')).remoteEligibility,'UNKNOWN');
  assert(indiaLocation(normalize({...raw,location:'Location not specified',remoteType:'remote'},'test')).eligible);
  assert.equal(indiaLocation(normalize({...raw,location:'Remote US',remoteType:'remote'},'test')).remoteEligibility,'INDIA_EXCLUDED');
  for(const location of ['US-only','EU-only','UK-only','Canada-only'])assert(!indiaLocation(normalize({...raw,location,remoteType:'remote'},'test')).eligible);
  for(const title of ['Web Developer','Web Application Developer','Software Developer','Software Engineer','Backend Developer','Backend Engineer','Full Stack Developer'])assert(evaluate(normalize({...raw,title},'test'),profile).matchScore>=25,title);
  assert(evaluate(normalize({...raw,title:'Java Spring Backend Engineer',description:'Required Java Spring PostgreSQL REST'},'test'),profile).matchScore<25);
});
test('metadata fallback requires an individual listing and explicit employer/role/location; never query-derived facts',()=>{
  const result={url:'https://in.linkedin.com/jobs/view/backend-developer-123',title:'Example hiring Backend Developer in Mumbai, Maharashtra, India | LinkedIn',content:raw.description+' Example is hiring a developer.'};
  assert(partialFromMetadata(result)?.description.startsWith('[PARTIAL'));assert.equal(partialFromMetadata({...result,url:'https://in.linkedin.com/jobs/search'}),undefined);
  assert.equal(partialFromMetadata({...result,title:'Backend jobs in Mumbai'}),undefined);assert.equal(partialFromMetadata({...result,content:'short'}),undefined);
});
test('public redirects recheck robots, preserve DNS restrictions and stop loops',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'redirect-'));
  class Fake extends PublicPageClient {
    protected override minimumIntervalMs=0;
    protected override async resolveHost(host:string){return [{address:host==='private.example.com'?'10.0.0.1':'8.8.8.8',family:4}];}
    protected override async requestPage(u:URL):Promise<string|{location:string;status:number}>{
      if(u.pathname==='/robots.txt')return u.hostname==='denied.example.com'?'User-agent: *\nDisallow: /':'';
      if(u.pathname==='/loop')return {location:'/loop',status:302};
      if(u.pathname==='/private')return {location:'https://private.example.com/job',status:302};
      if(u.pathname==='/denied')return {location:'https://denied.example.com/job',status:302};
      if(u.pathname==='/old')return {location:'/new',status:301};return 'validated public content';
    }
  }
  try{const c=new Fake(dir);assert.equal(await c.getText('https://example.com/old'),'validated public content');assert.equal(c.redirects.length,1);
    await assert.rejects(c.getText('https://example.com/private'),/non-public/);await assert.rejects(c.getText('https://example.com/denied'),/disallows/);await assert.rejects(c.getText('https://example.com/loop'),/redirect limit/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('redirect transport preserves required trailing slash without weakening URL security',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'slash-'));
  class Fake extends PublicPageClient {
    protected override minimumIntervalMs=0;
    protected override async resolveHost(){return [{address:'8.8.8.8',family:4}];}
    protected override async requestPage(u:URL):Promise<string|{location:string;status:number}>{
      if(u.pathname==='/robots.txt')return '';return u.pathname==='/job'?{location:'/job/',status:301}:'actual job page';
    }
  }
  try{assert.equal(await new Fake(dir).getText('https://example.com/job'),'actual job page');}finally{rmSync(dir,{recursive:true,force:true});}
});
test('new work cannot starve old work with an even number of active domains',()=>{
  const q=new CandidateQueue();try{
    for(const host of ['a.com','b.com'])q.add({url:`https://${host}/job/old`,queryId:'q',depth:0},1);
    const inspected:string[]=[];
    for(let n=0;n<8;n++){
      for(const host of ['a.com','b.com'])q.add({url:`https://${host}/job/new${n}`,queryId:'q',depth:0},n+10);
      const item=q.next(new Set())!;inspected.push(item.url);q.finish(item,'INSPECTED','test');
    }
    assert(inspected.includes('https://a.com/job/old'));assert(inspected.includes('https://b.com/job/old'));
  }finally{q.close();}
});
test('aggregator copies cannot merge distinct employer requisitions',()=>{
  const s=new Store(':memory:');try{
    s.upsert(normalize({...raw,employerJobId:'R1',authority:'employer'},'employer'));
    s.upsert(normalize({...raw,externalId:'2',sourceUrl:'https://example.com/job/2',employerJobId:'R2',authority:'employer'},'employer'));
    s.upsert(normalize({...raw,sourceUrl:'https://aggregator.com/job/1',authority:'aggregator'},'aggregator'));
    assert.equal(s.list().filter(o=>o.employerJobId).length,2);assert.equal(s.list().length,3);
  }finally{s.close();}
});
test('bounded direct sources resume SmartRecruiters details and real Jobicy cursors',async()=>{
  const state=new Map<string,unknown>(),details:string[]=[],urls:string[]=[];
  const c:SourceContext={checkpoint(k,v){if(v!==undefined)state.set(k,structuredClone(v));return structuredClone(state.get(k));},async getJson(url){urls.push(url);
    if(url.includes('jobicy'))return {jobs:[{id:url.includes('cursor=')?2:1}],nextCursor:url.includes('cursor=')?null:'opaque token'};
    const u=new URL(url);if(u.search)return {totalFound:4,content:Array.from({length:4},(_,i)=>({id:String(i),name:'PHP Developer',releasedDate:'2026-10-01T00:00:00Z'}))};
    details.push(u.pathname);return {id:u.pathname.split('/').at(-1),name:'PHP Developer',jobAd:{sections:{description:{text:raw.description}}},location:{city:'Mumbai',country:'IN'}};
  }};
  const e={id:'smart',adapter:'smartrecruiters',board:'example',company:'Example',enabled:true,maxDetails:2};
  await createSource(e,profile).discover(c);await createSource(e,profile).discover(c);assert.equal(new Set(details).size,4);
  const j={...e,id:'jobicy',adapter:'jobicy',maxPages:1};await createSource(j,profile).discover(c);await createSource(j,profile).discover(c);
  assert(urls.some(u=>u.includes('cursor=opaque%20token')));
});
test('historical requisition repair separates references without copying application history',()=>{
  const s=new Store(':memory:');try{
    const one=normalize({...raw,employerJobId:'R1',authority:'employer'},'smart');s.upsert(one);s.status(one.id,'APPLIED');
    const two=normalize({...raw,externalId:'2',sourceUrl:'https://example.com/job/2',employerJobId:'R2',authority:'employer',original:{id:'2',refNumber:'R2',name:raw.title,location:{city:'Mumbai',country:'IN'},jobAd:{sections:{description:{text:raw.description}}}}},'smart');s.upsert(two);
    s.db.prepare('UPDATE opportunity_sources SET opportunityId=? WHERE externalId=?').run(one.id,'2');s.db.prepare('DELETE FROM opportunity_skills WHERE opportunityId=?').run(two.id);s.db.prepare('DELETE FROM opportunities WHERE id=?').run(two.id);
    // A second connection is unnecessary: reopen via the public data-version invalidation path.
    s.db.exec('PRAGMA schema_version=100');
    assert.equal(s.repairRequisitionCollisions().length,1);
    const records=s.db.prepare('SELECT employerJobId,status FROM opportunities ORDER BY employerJobId').all();
    assert.deepEqual(records.map(r=>[r.employerJobId,r.status]),[['R1','APPLIED'],['R2','NEW']]);
    assert.equal(s.db.prepare('SELECT COUNT(DISTINCT opportunityId) AS n FROM opportunity_sources').get()!.n,2);
  }finally{s.close();}
});
test('Himalayas resumes per-term pages while rotating profile terms',async()=>{
  const state=new Map<string,unknown>(),seen:string[]=[];
  const c:SourceContext={checkpoint(k,v){if(v!==undefined)state.set(k,structuredClone(v));return structuredClone(state.get(k));},async getJson(url){seen.push(url);const u=new URL(url);return {jobs:[{guid:(u.searchParams.get('q')??'')+(u.searchParams.get('page')??''),title:'PHP Developer',description:raw.description,companyName:'Example',applicationLink:'https://example.com/job/'+u.searchParams.get('page')}]};}};
  const e={id:'h',adapter:'himalayas',board:'',company:'',enabled:true,maxPages:2,maxQueries:1};
  for(let n=0;n<3;n++)await createSource(e,{...profile,strongSkills:['PHP'],targetTitles:[],relatedTitles:[]}).discover(c);
  assert.deepEqual(seen.map(s=>new URL(s)).filter(u=>u.searchParams.get('q')==='PHP').map(u=>u.searchParams.get('page')),['1','2','3','4']);
});
