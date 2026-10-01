import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/persistence/index.ts';
import { normalize } from '../src/normalization/index.ts';
import { PublicExportService,publicUrl } from '../src/export/public-export.ts';
import { validateSnapshot } from '../shared/public-model.ts';
import { localApi } from '../src/local/http.ts';
import { publishDashboard,gitBinary } from '../src/publishing/publish.ts';
import type { Profile,RawOpportunity } from '../src/model.ts';
const profile=JSON.parse(readFileSync(new URL('../config/profile.example.json',import.meta.url),'utf8')) as Profile;
const raw:RawOpportunity={externalId:'one',title:'PHP Laravel Developer',companyOrClient:'Example',description:'Build Laravel PHP PostgreSQL REST APIs. Contact private@example.com or +91 7718988533.',location:'Mumbai, India',sourceUrl:'https://example.com/jobs/123?email=private@example.com&token=secret&jobId=123',original:{privateNotes:'PRIVATE_NOTES_SENTINEL',answers:'PRIVATE_ANSWERS_SENTINEL'}};
const fixture=()=>{const dir=mkdtempSync(join(tmpdir(),'v02-'));const store=new Store(join(dir,'db.sqlite'));const o=normalize(raw,'fixture');store.upsert(o);return {dir,store,o,close(){store.close();rmSync(dir,{recursive:true,force:true});}};};
test('application timestamps survive rediscovery; transitions are idempotent and reversible',()=>{
  const f=fixture();try{
    assert.throws(()=>f.store.status(f.o.id,'INTERVIEW'),/Applied/);
    f.store.status(f.o.id,'APPLIED',undefined,'2026-09-01T12:00:00Z');f.store.status(f.o.id,'APPLIED',undefined,'2026-09-02T12:00:00Z');
    f.store.status(f.o.id,'INTERVIEW',undefined,'2026-09-03T12:00:00Z');f.store.upsert(normalize(raw,'fixture'));
    const o=f.store.list()[0];assert.equal(o.status,'INTERVIEW');assert.equal(o.appliedAt,'2026-09-01T12:00:00Z');assert.equal(o.interviewAt,'2026-09-03T12:00:00Z');
    assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM opportunity_status_events').get()?.n,2);
    f.store.status(o.id,'NEW');assert.equal(f.store.list()[0].appliedAt,'2026-09-01T12:00:00Z');assert.equal(f.store.list()[0].interviewAt,'2026-09-03T12:00:00Z');
  }finally{f.close();}
});
test('public export whitelists fields, redacts contacts, retains tracked jobs and is stable when unchanged',()=>{
  const f=fixture();try{
    f.store.configure({...profile,...{email:'PROFILE_EMAIL_SENTINEL',salaryExpectations:'PRIVATE_SALARY_SENTINEL'}},[]);
    const exporter=new PublicExportService();const snapshot=exporter.snapshot(f.store,profile);const json=JSON.stringify(snapshot);
    for(const secret of ['private@example.com','7718988533','PROFILE_EMAIL_SENTINEL','PRIVATE_NOTES_SENTINEL','PRIVATE_ANSWERS_SENTINEL','PRIVATE_SALARY_SENTINEL','candidate_profile','rawJson','resumeEvidence'])assert.equal(json.includes(secret),false,secret);
    assert.equal(snapshot.opportunities[0].applicationUrl,'https://example.com/jobs/123?jobId=123');
    assert.throws(()=>validateSnapshot({...snapshot,profile}),/snapshot/);
    const file=join(f.dir,'jobs.json');assert.equal(exporter.write(f.store,profile,file).changed,true);assert.equal(exporter.write(f.store,profile,file).changed,false);
    f.store.status(f.o.id,'APPLIED');f.store.upsert(normalize({...raw,closed:true,location:'London'},'fixture'));
    assert.equal(exporter.snapshot(f.store,profile).opportunities.length,1);
    f.store.status(f.o.id,'IGNORED');assert.equal(exporter.snapshot(f.store,profile).opportunities[0].status,'IGNORED');
    assert.equal(publicUrl('javascript:alert(1)'),undefined);assert.equal(publicUrl('https://user:secret@example.com/job'),undefined);
  }finally{f.close();}
});
test('V0.1 populated database rebuild preserves references and does not invent old applied dates',()=>{
  const dir=mkdtempSync(join(tmpdir(),'v02-migration-'));const path=join(dir,'db.sqlite');const db=new DatabaseSync(path);
  db.exec('CREATE TABLE migrations(name TEXT PRIMARY KEY)');
  for(const name of ['001_initial.sql','002_discovery_quality.sql']){db.exec(readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8'));db.prepare('INSERT INTO migrations VALUES (?)').run(name);}
  db.exec("INSERT INTO opportunities(id,type,title,companyOrClient,description,location,remoteType,employmentType,canonicalUrl,firstSeenAt,lastSeenAt,discoveredAt,status) VALUES ('old','EMPLOYMENT','PHP','Example','PHP','Mumbai','onsite','full-time','https://example.com/old','2026-01-01','2026-01-01','2026-01-01','APPLIED'); INSERT INTO opportunity_sources VALUES ('legacy','old','old','https://example.com/old','{}','2026-01-01','2026-01-01'); INSERT INTO skills VALUES ('PHP'); INSERT INTO opportunity_skills VALUES ('old','PHP');");db.close();
  const store=new Store(path);try{assert.equal(store.list()[0].status,'APPLIED');assert.equal(store.list()[0].appliedAt,undefined);assert.deepEqual(store.list()[0].skills,['PHP']);assert.equal(store.references('old').length,1);assert.equal(store.db.prepare('PRAGMA foreign_key_check').all().length,0);store.status('old','INTERVIEW');assert.equal(store.list()[0].appliedAt,undefined);assert.ok(store.list()[0].interviewAt);}finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('local HTTP editor requires same-origin local headers and persists a real transition',async()=>{
  const f=fixture();let handler:ReturnType<typeof localApi>;
  const server=createServer((req,res)=>void handler(req,res,()=>{res.statusCode=404;res.end();}));
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address==='object');const port=address.port;
  const exporter=new PublicExportService();handler=localApi({read:()=>exporter.snapshot(f.store,profile),update:(id,status)=>{f.store.status(id,status);return exporter.snapshot(f.store,profile);},publish:async()=>({pushed:true})},port);
  const base=`http://127.0.0.1:${port}`;const headers={'X-JobHunter-Local':'1','Content-Type':'application/json'};
  try{
    assert.equal((await fetch(base+'/_local/opportunities')).status,403);
    assert.equal((await fetch(base+'/_local/opportunities',{headers:{...headers,Origin:'https://evil.example'}})).status,403);
    const response=await fetch(base+`/_local/opportunities/${f.o.id}/status`,{method:'PATCH',headers,body:JSON.stringify({status:'APPLIED'})});assert.equal(response.status,200);assert.equal(f.store.list()[0].status,'APPLIED');
    assert.equal((await fetch(base+`/_local/opportunities/${f.o.id}/status`,{method:'PATCH',headers,body:JSON.stringify({status:'APPLIED',privateNotes:'x'})})).status,400);
  }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));f.close();}
});
test('publish commits and pushes only public data, preserves unrelated staged edits, rejects private tracking',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'v02-git-'));const root=join(dir,'repo'),remote=join(dir,'remote.git');mkdirSync(root);
  const git=(...args:string[])=>execFileSync(gitBinary(),args,{cwd:root,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
  try{
    git('init','--bare',remote);git('init','-b','main');git('config','user.name','Local Test');git('config','user.email','test@example.invalid');
    for(const file of ['package.json','vite.config.ts','web/index.html','web/main.tsx','shared/public-model.ts','vercel.json','notes.txt','public/data/jobs.json']){mkdirSync(dirname(join(root,file)),{recursive:true});writeFileSync(join(root,file),'initial');}
    git('add','.');git('commit','-m','Initial fixture');git('remote','add','origin',remote);git('push','-u','origin','main');
    writeFileSync(join(root,'notes.txt'),'staged but private to this test');git('add','notes.txt');
    const result=await publishDashboard(root,()=>writeFileSync(join(root,'public/data/jobs.json'),'sanitized fixture'));
    assert.equal(result.pushed,true);assert.equal(git('show','--format=','--name-only','HEAD'),'public/data/jobs.json');assert.equal(git('diff','--cached','--name-only'),'notes.txt');
    mkdirSync(join(root,'data'));writeFileSync(join(root,'data/secret.json'),'secret');git('add','data/secret.json');
    await assert.rejects(publishDashboard(root,()=>{}),/private\/local/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
