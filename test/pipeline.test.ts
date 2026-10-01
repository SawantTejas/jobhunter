import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalize,extractSkills } from '../src/normalization/index.ts';
import { evaluate,freshness,hardFilter } from '../src/matching/index.ts';
import { Store } from '../src/persistence/index.ts';
import { discover } from '../src/discovery/index.ts';
import { createSource } from '../src/sources/index.ts';
import type { Profile,RawOpportunity } from '../src/model.ts';
const profile=JSON.parse(readFileSync(new URL('../config/profile.example.json',import.meta.url),'utf8')) as Profile;
const raw:RawOpportunity={externalId:'123',title:'Backend Developer',companyOrClient:'Example',description:'PHP Laravel PostgreSQL REST Vue Redis. 3–5 years experience. Develop maintain and deploy scalable reliable services for customers with a collaborative engineering team and strong attention to quality testing performance security and documentation.',sourceUrl:'https://example.com/jobs/123?utm_source=test',location:'Mumbai',postedAt:'2026-01-01T00:00:00Z'};
test('normalization, aliases, URL cleanup and honest dates',()=>{
  const o=normalize({...raw,postedAt:undefined,updatedAt:'2026-01-01'},'a');assert.equal(o.postedAt,undefined);assert.match(freshness(o).freshness,/unknown/);assert.equal(o.canonicalUrl,'https://example.com/jobs/123');assert.equal(o.experienceMin,3);assert.equal(o.experienceMax,5);
  assert.deepEqual(extractSkills('postgres js restful'),['PostgreSQL','REST','JavaScript']);assert.equal(extractSkills('javascript').includes('Java'),false);
});
test('freshness boundaries and strategies',()=>{
  const o=normalize(raw,'a');const at=Date.parse(o.postedAt!);
  for(const [hours,label]of [[0,'JUST POSTED'],[6,'FRESH'],[24,'RECENT'],[72,'THIS WEEK'],[192,'OLDER']] as const)assert.equal(freshness(o,at+hours*3600000).freshness,label);
  const e=evaluate(o,profile);assert.ok(e.matchScore>65);assert.ok(e.missing.includes('Redis'));assert.equal(e.filtered.length,0);
  assert.ok(hardFilter({...o,experienceMin:10},{...profile,experienceMax:5}).includes('Too senior'));
  assert.equal(hardFilter({...o,type:'FREELANCE',budgetMax:10,currency:'EUR',budgetUnit:'project'},{...profile,freelance:{...profile.freelance,minimumBudget:100}}).length,0);
});
test('dedup preserves references, timestamps and saved status; source failure isolation',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'job-agent-'));const store=new Store(join(dir,'test.sqlite'));
  try{
    const first=normalize(raw,'a','2026-01-01T00:00:00Z');assert.equal(store.upsert(first),'new');store.status(first.id,'SAVED');
    assert.equal(store.upsert(normalize({...raw,externalId:'other',sourceUrl:'https://other.example/jobs/123'},'b','2026-01-02T00:00:00Z')),'merged');
    assert.equal(store.list().length,1);assert.equal(store.references(first.id).length,2);assert.equal(store.list()[0].status,'SAVED');assert.equal(store.list()[0].firstSeenAt,first.firstSeenAt);
    const summary=await discover(store,[{name:'broken',discover:async()=>{throw new Error('offline');}},{name:'working',discover:async()=>[{...raw,externalId:'next',title:'Different role',sourceUrl:'https://example.com/next'}]}],{getJson:async()=>[]},profile);
    assert.equal(summary.failed,1);assert.equal(summary.successful,1);assert.equal(summary.new,1);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('public adapters preserve source-specific date meanings',async()=>{
  const entry={id:'test',company:'Company',board:'board',enabled:true};
  const gh=await createSource({...entry,adapter:'greenhouse'}).discover({getJson:async()=>({jobs:[{id:1,title:'Engineer',content:'PHP',absolute_url:'https://example.com/1',updated_at:'2026-01-01'}]})});assert.equal(gh[0].postedAt,undefined);
  const lever=await createSource({...entry,adapter:'lever'}).discover({getJson:async()=>[{id:'1',text:'Engineer',descriptionPlain:'PHP',hostedUrl:'https://example.com/1',categories:{commitment:'Contract'}}]});assert.equal(normalize(lever[0],'lever').type,'CONTRACT');
  const ashby=await createSource({...entry,adapter:'ashby'}).discover({getJson:async()=>({jobs:[{title:'Engineer',jobUrl:'https://example.com/1',publishedAt:'2026-01-01',isListed:true},{isListed:false}]})});assert.equal(ashby.length,1);assert.equal(ashby[0].dateKind,'published');
});
test('freelance JSON vertical slice, repeat discovery, ignored feedback and reopening database',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'job-agent-'));const path=join(dir,'db.sqlite');let store=new Store(path);
  try {
    const board=join(dir,'freelance.json');writeFileSync(board,JSON.stringify([{...raw,type:'FREELANCE',budgetMin:500,budgetMax:1000,currency:'USD',budgetUnit:'project'}]));
    const sources=[createSource({id:'freelance',company:'Client',adapter:'json',board,enabled:true})];
    assert.equal((await discover(store,sources,{getJson:async()=>[]},profile)).new,1);
    assert.equal((await discover(store,sources,{getJson:async()=>[]},profile)).known,1);
    const o=store.list()[0];assert.equal(o.type,'FREELANCE');assert.ok(evaluate(o,profile).matchScore>50);
    store.status(o.id,'IGNORED','wrong stack');store.close();store=new Store(path);
    assert.deepEqual(evaluate(store.list()[0],profile).filtered,['Ignored']);assert.equal(store.db.prepare('SELECT reason FROM ignored_opportunities').get()?.reason,'wrong stack');
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('dedup does not merge separate postings, IDs from different boards, or materially different descriptions',()=>{
  const dir=mkdtempSync(join(tmpdir(),'job-agent-'));const store=new Store(join(dir,'db.sqlite'));
  try {
    store.upsert(normalize(raw,'a'));
    assert.equal(store.upsert(normalize({...raw,companyOrClient:'Other company',sourceUrl:'https://example.com/other'},'b')),'new');
    assert.equal(store.upsert(normalize({...raw,postedAt:'2026-02-01',sourceUrl:'https://example.com/repost'},'c')),'new');
    assert.equal(store.list().length,3);
    assert.throws(()=>normalize({...raw,sourceUrl:'javascript:alert(1)'},'bad'));
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
