import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {analytics as calculate,dayKey,timeSeries,locationGroup,sourceGroup} from '../web/analytics.ts';
import {applicationCsv,csvCell} from '../web/csv.ts';
import {validateSnapshot,type PublicOpportunity,type PublicSnapshot} from '../shared/public-model.ts';
import {Store} from '../src/persistence/index.ts';
import {normalize} from '../src/normalization/index.ts';
import {PublicExportService} from '../src/export/public-export.ts';
import type {Profile} from '../src/model.ts';
const job=(id:string,at?:string,extra:Partial<PublicOpportunity>={}):PublicOpportunity=>({id,title:'Backend Developer',company:'Example',location:'Mumbai',type:'EMPLOYMENT',status:'APPLIED',matchScore:85,description:'Safe',freshness:'Unknown',skills:['PHP'],...(at?{appliedAt:at}:{}),...extra});
const snapshot=(jobs:PublicOpportunity[],now='2026-10-01T19:00:00Z'):PublicSnapshot=>({schemaVersion:1,exportedAt:now,timeZone:'Asia/Kolkata',totalDiscovered:100,opportunities:jobs});
const analytics=(s:PublicSnapshot)=>calculate(s,s.exportedAt);
test('calendar groups India midnight, month/week boundaries and leap/DST dates correctly',()=>{
  assert.equal(dayKey('2026-10-01T18:29:59Z','Asia/Kolkata'),'2026-10-01');
  assert.equal(dayKey('2026-10-01T18:30:00Z','Asia/Kolkata'),'2026-10-02');
  const a=analytics(snapshot([job('a','2026-09-30T18:29:00Z'),job('b','2026-09-30T18:30:00Z'),job('c','2026-10-01T18:30:00Z')]));
  assert.equal(a.thisMonth,2);assert.equal(a.todayCount,1);assert.equal(a.thisWeek,3);assert.equal(a.current,3);assert.equal(a.longest,3);
  const dst=analytics({...snapshot([job('a','2026-03-07T12:00:00Z'),job('b','2026-03-08T12:00:00Z'),job('c','2026-03-09T12:00:00Z')],'2026-03-09T18:00:00Z'),timeZone:'America/New_York'});
  assert.equal(dst.current,3);assert.equal(timeSeries(dst,7).length,7);
  const leap=analytics(snapshot([job('a','2024-02-28T08:00:00Z'),job('b','2024-02-29T08:00:00Z'),job('c','2024-03-01T08:00:00Z')],'2024-03-01T12:00:00Z'));assert.equal(leap.longest,3);
});
test('streak survives until end of day, breaks after a gap, ignores duplicate same-day events',()=>{
  const jobs=[job('a','2026-09-29T08:00:00Z'),job('b','2026-09-30T08:00:00Z'),job('c','2026-09-30T09:00:00Z')];
  const a=analytics(snapshot(jobs,'2026-10-01T08:00:00Z'));assert.equal(a.current,2);assert.equal(a.longest,2);assert.equal(a.average,1.5);
  assert.equal(analytics(snapshot(jobs,'2026-10-02T08:00:00Z')).current,0);
});
test('historical interviews survive rejection; offers do not fabricate interviews; missing dates remain unknown',()=>{
  const a=analytics(snapshot([job('a','2026-10-01T08:00:00Z',{status:'REJECTED',interviewAt:'2026-10-01T10:00:00Z'}),job('b',undefined,{status:'OFFER'}),job('c','2026-10-05T08:00:00Z'),job('d',undefined,{status:'NEW'})]));
  assert.equal(a.applications.length,3);assert.equal(a.interviews,1);assert.equal(a.offers,1);assert.equal(a.rejected,1);assert.equal(a.unknownDates,1);assert.equal(a.futureDates,1);assert.equal(a.todayCount,0);assert.equal(a.conversion,100/3);
  const empty=analytics(snapshot([]));assert.equal(empty.conversion,null);assert.equal(empty.average,0);assert.equal(empty.trend,null);assert.equal(empty.current,0);
});
test('trend compares equal weekdays and handles a zero baseline',()=>{
  const jobs=[job('a','2026-09-28T08:00:00Z'),job('b','2026-09-29T08:00:00Z'),job('c','2026-09-21T08:00:00Z'),job('d','2026-09-27T08:00:00Z')];
  const a=analytics(snapshot(jobs,'2026-09-29T10:00:00Z'));assert.equal(a.thisWeek,2);assert.equal(a.previousComparable,1);assert.equal(a.previousWeek,2);assert.equal(a.trend,100);
  assert.equal(timeSeries(a,7).at(-1)?.[1],1);
});
test('canonical source attribution counts a multi-source application once and location aliases work',()=>{
  assert.equal(sourceGroup(job('a',undefined,{source:'linkedin.com, greenhouse.io',applicationUrl:'https://job-boards.greenhouse.io/acme/jobs/1'})),'Greenhouse');
  assert.equal(locationGroup('Bangalore, India'),'Bengaluru');assert.equal(locationGroup('Navi Mumbai'),'Mumbai / Navi Mumbai');assert.equal(locationGroup('India','remote'),'Remote India');
});
test('CSV is safe, UTF-8 BOM, quoted, CRLF, formula protected and contains only applications',()=>{
  const csv=applicationCsv([job('a','2026-10-01T08:00:00Z',{company:'मुंबई, "Company"\nLimited',title:'=HYPERLINK("bad")'}),job('b',undefined,{status:'NEW',company:'SHOULD_NOT_EXPORT'})]);
  assert.ok(csv.startsWith('\ufeff'));assert.ok(csv.includes('मुंबई, ""Company""\nLimited'));assert.ok(csv.includes("'=HYPERLINK"));assert.ok(csv.endsWith('\r\n'));assert.ok(!csv.includes('SHOULD_NOT_EXPORT'));assert.equal(csvCell(' \t+cmd'), '"\' \t+cmd"');
});
test('status outcomes and rediscovery preserve original dates, publish only safe event fields',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jobhunter-v03-')),store=new Store(join(dir,'db.sqlite'));
  try{
    const raw={externalId:'1',title:'PHP Laravel Developer',companyOrClient:'Example',description:'PHP Laravel REST',location:'Mumbai',sourceUrl:'https://example.com/jobs/1'};
    const o=normalize(raw,'test');store.upsert(o);store.status(o.id,'APPLIED',undefined,'2026-09-29T08:00:00Z');store.status(o.id,'INTERVIEW',undefined,'2026-09-30T08:00:00Z');store.status(o.id,'REJECTED',undefined,'2026-10-01T08:00:00Z');store.upsert(normalize(raw,'test'));
    assert.equal(store.list()[0].appliedAt,'2026-09-29T08:00:00Z');assert.equal(store.list()[0].interviewAt,'2026-09-30T08:00:00Z');
    const profile=JSON.parse(readFileSync(new URL('../config/profile.example.json',import.meta.url),'utf8')) as Profile;
    const s=new PublicExportService().snapshot(store,profile);validateSnapshot(s);assert.equal(s.totalDiscovered,1);assert.deepEqual(s.opportunities[0].history?.map(e=>e.status),['APPLIED','INTERVIEW','REJECTED']);
    assert.throws(()=>validateSnapshot({...s,opportunities:[{...s.opportunities[0],history:[{status:'APPLIED',at:s.exportedAt,privateNote:'never allowed'}]}]}),/history/);
    // Emulate the V0.2 reset bug, then rerun migration 004 to recover recorded evidence.
    store.db.prepare('UPDATE opportunities SET appliedAt=NULL,interviewAt=NULL WHERE id=?').run(o.id);
    store.db.exec(readFileSync(new URL('../migrations/004_preserve_application_history.sql',import.meta.url),'utf8').replace('CREATE INDEX opportunity_events_by_job','CREATE INDEX IF NOT EXISTS opportunity_events_by_job'));
    assert.equal(store.db.prepare('SELECT appliedAt FROM opportunities WHERE id=?').get(o.id)?.appliedAt,'2026-09-29T08:00:00Z');
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
