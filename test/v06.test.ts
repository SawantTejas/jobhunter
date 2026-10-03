import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {runInNewContext} from 'node:vm';
import {Store} from '../src/persistence/index.ts';
import {normalize} from '../src/normalization/index.ts';
import {PublicExportService} from '../src/export/public-export.ts';
import {analytics} from '../web/analytics.ts';
import {privateProfile} from '../src/application/profile.ts';
import {mapField,conceptFor} from '../src/application/mapping.ts';
import {ApplicationService} from '../src/application/service.ts';
import {applicationApi} from '../src/application/http.ts';
import type {ApplicationProfile,Field} from '../src/application/model.ts';
import type {Profile} from '../src/model.ts';
const candidate:Profile=JSON.parse(readFileSync(new URL('../config/profile.example.json',import.meta.url),'utf8'));
const profile:ApplicationProfile={contact:{firstName:'PRIVATE_NAME_SENTINEL',email:'private@example.invalid'},links:{github:'https://github.com/example'},workHistory:[],education:[],experienceYears:3,noticePeriod:'30 days',expectedCtc:'12 LPA',workAuthorization:{IN:{authorized:true}},skillYears:{Laravel:2},resumes:[]};
const field=(label:string,extra:Partial<Field>={}):Field=>({id:randomUUID(),label,name:'',ariaLabel:'',placeholder:'',nearby:'',type:'text',tag:'input',required:false,hasValue:false,...extra});
const fixture=()=>{const dir=mkdtempSync(join(tmpdir(),'v06-')),store=new Store(join(dir,'jobs.sqlite'));const job=normalize({externalId:'1',title:'Backend Developer',companyOrClient:'Example',description:'PHP Laravel PostgreSQL REST JavaScript. Build reliable backend services.',location:'Mumbai',sourceUrl:'https://example.invalid/jobs/1'},'fixture');store.upsert(job);writeFileSync(join(dir,'application-profile.json'),JSON.stringify(profile));const service=new ApplicationService(store,candidate,dir);return {dir,store,job,service,close(){store.close();rmSync(dir,{recursive:true,force:true});}};};
test('deterministic aliases, confirmed facts, sensitive suggestions and unknown long-form questions',()=>{
  for(const label of ['Notice period','When can you join?','Joining availability'])assert.equal(conceptFor(field(label)).concept,'NOTICE_PERIOD');
  for(const label of ['Years using Laravel','Laravel experience'])assert.equal(conceptFor(field(label)).concept,'SKILL_YEARS_LARAVEL');
  assert.equal(mapField(field('First name'),profile,()=>undefined).confidence,'HIGH');
  assert.equal(mapField(field('Email',{hasValue:true}),profile,()=>undefined).confidence,'MEDIUM');
  assert.equal(mapField(field('',{name:'firstName'}),profile,()=>undefined).confidence,'MEDIUM');
  assert.equal(mapField(field('Years using Laravel',{type:'number'}),profile,()=>undefined).value,'2');
  assert.equal(mapField(field('Years using Python'),profile,()=>undefined).confidence,'UNKNOWN');
  assert.equal(mapField(field('Are you authorized to work in India?'),profile,()=>undefined).confidence,'MEDIUM');
  assert.equal(mapField(field('Are you authorized to work in the United States?'),profile,()=>undefined).confidence,'UNKNOWN');
  assert.equal(mapField(field('Are you NOT authorized to work in India?'),profile,()=>undefined).confidence,'UNKNOWN');
  assert.equal(mapField(field('Are you authorized to work in India and Canada?'),profile,()=>undefined).confidence,'UNKNOWN');
  assert.equal(mapField(field('First name',{nearby:'Emergency contact'}),profile,()=>undefined).blocked,true);
  assert.equal(mapField(field('Expected CTC',{type:'number'}),profile,()=>undefined).confidence,'LOW');
  assert.equal(mapField(field('Why do you want to work here?',{type:'textarea'}),profile,()=>undefined).confidence,'UNKNOWN');
  assert.equal(mapField(field('I agree to the terms',{type:'checkbox'}),profile,()=> 'Yes').blocked,true);
  assert.equal(mapField(field('Resume',{type:'file'}),profile,()=>undefined).confidence,'MEDIUM');
});
test('private profile inherits factual experience/history without fabricating contacts or skill years',()=>{
  const dir=mkdtempSync(join(tmpdir(),'v06-profile-'));try{
    const p=privateProfile(dir,{...candidate,resumeEvidence:{file:'missing-resume.pdf',extractedAt:'2026-01-01',facts:[],workHistory:[{company:'Actual company',startMonth:'2023-01',endMonth:null}]}});
    assert.equal(p.experienceYears,candidate.yearsExperience);assert.equal(p.workHistory[0].company,'Actual company');assert.equal(p.workHistory[0].title,undefined);assert.deepEqual(p.contact,{});assert.deepEqual(p.skillYears,{});assert.deepEqual(p.resumes,[]);
    const stored=JSON.parse(readFileSync(join(dir,'application-profile.json'),'utf8'));assert.equal(stored.experienceYears,undefined);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('sessions retain multiple steps, reusable confirmed answers, manual completion and existing history',()=>{
  const f=fixture();try{
    const first=field('First name'),question=field('Why do you want to work here?',{type:'textarea'}),url='https://example.invalid/apply';
    const a=f.service.analyze({jobId:f.job.id,url,fields:[first,question]});assert.equal(a.fields[1].mapping.confidence,'UNKNOWN');
    assert.throws(()=>f.service.saveAnswer({sessionId:a.sessionId,fieldId:'absent',answer:'bad'}));
    f.service.saveAnswer({sessionId:a.sessionId,fieldId:question.id,answer:'PRIVATE_ANSWER_SENTINEL'});
    const again=f.service.analyze({sessionId:a.sessionId,jobId:f.job.id,url,fields:[first,question]});assert.equal(again.fields[1].mapping.value,'PRIVATE_ANSWER_SENTINEL');assert.equal(again.fields[1].mapping.confidence,'MEDIUM');
    f.service.filled({sessionId:a.sessionId,url,ids:[first.id,question.id]});
    const next=field('Phone');f.service.analyze({sessionId:a.sessionId,jobId:f.job.id,url:url+'/step2',fields:[next]});
    const session=f.store.db.prepare('SELECT * FROM application_sessions WHERE id=?').get(a.sessionId)!;assert.equal(JSON.parse(String(session.detectedJson)).length,3);assert.equal(JSON.parse(String(session.filledJson)).length,2);
    assert.throws(()=>f.service.filled({sessionId:a.sessionId,url,ids:[first.id]}),/Rescan/);
    assert.throws(()=>f.service.complete({sessionId:a.sessionId}),/yourself/);assert.equal(f.store.list()[0].status,'NEW');
    f.service.complete({sessionId:a.sessionId,manuallySubmitted:true});f.service.complete({sessionId:a.sessionId,manuallySubmitted:true});
    assert.equal(f.store.list()[0].status,'APPLIED');assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM opportunity_status_events').get()?.n,1);
    f.store.status(f.job.id,'INTERVIEW');f.service.complete({sessionId:a.sessionId,manuallySubmitted:true});assert.equal(f.store.list()[0].status,'INTERVIEW');
    const snapshot=new PublicExportService().snapshot(f.store,candidate),json=JSON.stringify(snapshot);
    for(const secret of ['PRIVATE_NAME_SENTINEL','private@example.invalid','PRIVATE_ANSWER_SENTINEL','12 LPA','application_answers','application_sessions','detectedJson'])assert.ok(!json.includes(secret),secret);
    assert.equal(analytics(snapshot).todayCount,1);assert.ok(f.store.list()[0].appliedAt);assert.ok(f.store.db.prepare('SELECT completedAt FROM application_sessions WHERE id=?').get(a.sessionId)?.completedAt);
  }finally{f.close();}
});
test('resume access is restricted to configured variants and never accepts a supplied path',()=>{
  const f=fixture();try{
    const path=join(f.dir,'resume.pdf');writeFileSync(path,'%PDF-1.4 PRIVATE_RESUME_SENTINEL');writeFileSync(join(f.dir,'application-profile.json'),JSON.stringify({...profile,resumes:[{id:'backend',label:'Backend CV',path}],defaultResumeId:'backend'}));
    const context=f.service.context();assert.equal(context.resumes[0].label,'Backend CV');assert.ok(!JSON.stringify(context).includes(path));assert.ok(!JSON.stringify(context).includes('PRIVATE_NAME_SENTINEL'));
    const file=f.service.resume('backend');assert.equal(file.mime,'application/pdf');assert.ok(Buffer.from(file.base64,'base64').toString().includes('PRIVATE_RESUME_SENTINEL'));
    assert.throws(()=>f.service.resume(path),/Unknown/);assert.throws(()=>f.service.resume('../../config/profile.json'),/Unknown/);
  }finally{f.close();}
});
test('late canonical deduplication retains assistant sessions and application history',()=>{
  const f=fixture();try{
    const started=f.service.analyze({jobId:f.job.id,url:'https://example.invalid/apply',fields:[field('First name')]});f.store.status(f.job.id,'APPLIED');
    const copy=normalize({...f.job,externalId:'portal-2',sourceUrl:'https://portal.invalid/2',canonicalUrl:'https://portal.invalid/2'},'portal');f.store.upsert(copy);assert.equal(f.store.list().length,2);
    f.store.upsert(normalize({...copy,canonicalUrl:f.job.canonicalUrl,authority:'employer'},'portal'));
    assert.equal(f.store.list().length,1);const remaining=f.store.list()[0];assert.equal(remaining.status,'APPLIED');assert.equal(f.store.db.prepare('SELECT jobId FROM application_sessions WHERE id=?').get(started.sessionId)?.jobId,remaining.id);assert.equal(f.store.db.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{f.close();}
});
test('extension API requires paired secret, extension identity, origin and loopback host',async()=>{
  const f=fixture(),extensionId='a'.repeat(32),token='1'.repeat(64);writeFileSync(join(f.dir,'assistant-pairing.json'),JSON.stringify({extensionId,token}));
  let handler:ReturnType<typeof applicationApi>;const server=createServer((req,res)=>void handler(req,res,()=>{res.statusCode=404;res.end();}));
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const addr=server.address();assert.ok(addr&&typeof addr==='object');handler=applicationApi(f.dir,fn=>fn(f.service),addr.port);
  const root=`http://127.0.0.1:${addr.port}/_assistant/context`,headers={'X-JobFinder-Token':token,'X-JobFinder-Extension':extensionId,Origin:'chrome-extension://'+extensionId};
  try{
    assert.equal((await fetch(root)).status,403);assert.equal((await fetch(root,{headers:{...headers,Origin:'https://jobs.example'}})).status,403);
    assert.equal((await fetch(root,{headers:{...headers,'X-JobFinder-Token':'é'.repeat(64)}})).status,403);
    assert.equal((await fetch(root,{headers:{...headers,'X-JobFinder-Extension':'b'.repeat(32)}})).status,403);
    const response=await fetch(root,{headers});assert.equal(response.status,200);assert.equal(response.headers.get('Access-Control-Allow-Origin'),headers.Origin);
    assert.equal((await fetch(root,{method:'OPTIONS',headers:{Origin:'https://jobs.example'}})).status,403);
    assert.equal((await fetch(root,{method:'OPTIONS',headers:{Origin:headers.Origin}})).status,204);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));f.close();}
});
test('content script detects fields, uses native setters/events, preserves existing values and never submits',()=>{
  const events:string[]=[];
  class Input {
    tagName='INPUT';type='text';name='';id='';placeholder='';disabled=false;readOnly=false;isConnected=true;required=false;form={submit(){throw new Error('Must never submit');}};labels:{textContent:string}[];parentElement={textContent:''};_value='';_checked=false;
    constructor(label:string){this.labels=[{textContent:label}];}
    get value(){return this._value;}set value(v:string){this._value=v;}
    get checked(){return this._checked;}set checked(v:boolean){this._checked=v;}
    getClientRects(){return [{}];}getAttribute(){return null;}closest(){return null;}
    dispatchEvent(e:{type:string}){events.push(e.type);return true;}
  }
  const first=new Input('First name'),email=new Input('Email');email.value='already@filled.invalid';const consent=new Input('I agree to terms');consent.type='checkbox';const hidden=new Input('Hidden');hidden.type='hidden';
  const context:{__jobFinderAssistant?:{scan():{fields:Field[];url:string};fill(url:string,requests:unknown[]):{filled:string[];failed:unknown[]}};[k:string]:unknown}={document:{querySelectorAll:()=>[first,email,consent,hidden],getElementById:()=>null},location:{href:'https://example.invalid/apply'},URL,crypto:{randomUUID},getComputedStyle:()=>({visibility:'visible'}),HTMLInputElement:Input,HTMLSelectElement:Input,HTMLTextAreaElement:Input,Event:class{type:string;constructor(type:string){this.type=type;}}};
  runInNewContext(readFileSync(new URL('../extension/content.js',import.meta.url),'utf8'),context);const script=context.__jobFinderAssistant!,scan=script.scan();assert.equal(scan.fields.length,3);
  const result=script.fill(scan.url,[{id:scan.fields[0].id,value:'Confirmed',mode:'known'},{id:scan.fields[1].id,value:'overwrite',mode:'known'},{id:scan.fields[2].id,value:'Yes',mode:'confirm'}]);
  assert.equal(result.filled.length,1);assert.equal(result.failed.length,2);assert.equal(first.value,'Confirmed');assert.equal(email.value,'already@filled.invalid');assert.equal(consent.checked,false);assert.deepEqual(events,['input','change']);
  assert.throws(()=>script.fill('https://other.invalid',[]),/changed/);
});
test('content script fills only explicitly confirmed radio/checkbox and exact select options',()=>{
  class Control {
    tagName='INPUT';type='text';name='';id='';disabled=false;readOnly=false;isConnected=true;required=false;form=null;labels:{textContent:string}[];parentElement={textContent:''};options:{value:string;textContent:string;disabled:boolean}[]=[];_value='';_checked=false;
    constructor(label:string){this.labels=[{textContent:label}];}
    get value(){return this._value;}set value(v:string){this._value=v;}
    get checked(){return this._checked;}set checked(v:boolean){this._checked=v;}
    getClientRects(){return [{}];}getAttribute(){return null;}closest(selector:string){return this.type==='radio'&&selector==='fieldset'?{querySelector:()=>({textContent:'Are you authorized to work in India?'})}:null;}
    dispatchEvent(){return true;}
  }
  const select=new Control('Notice period');select.tagName='SELECT';select.options=[{value:'30',textContent:'30 days',disabled:false}];
  const radio=new Control('Yes');radio.type='radio';radio.name='authorized';radio.value='yes';const checkbox=new Control('Are you willing to relocate?');checkbox.type='checkbox';
  const context:any={document:{querySelectorAll:()=>[select,radio,checkbox],getElementById:()=>null},location:{href:'https://example.invalid/apply'},URL,crypto:{randomUUID},getComputedStyle:()=>({visibility:'visible'}),HTMLInputElement:Control,HTMLSelectElement:Control,HTMLTextAreaElement:Control,Event:class{}};
  runInNewContext(readFileSync(new URL('../extension/content.js',import.meta.url),'utf8'),context);const script=context.__jobFinderAssistant,scan=script.scan();
  assert.equal(scan.fields[1].label,'Are you authorized to work in India?');
  const known=script.fill(scan.url,[{id:scan.fields[1].id,value:'Yes',mode:'known'}]);assert.equal(known.failed.length,1);assert.equal(radio.checked,false);
  const confirmed=script.fill(scan.url,[{id:scan.fields[0].id,value:'30 days',mode:'confirm'},{id:scan.fields[1].id,value:'yes',mode:'confirm'},{id:scan.fields[2].id,value:'Yes',mode:'confirm'}]);
  assert.equal(confirmed.filled.length,3);assert.equal(select.value,'30');assert.equal(radio.checked,true);assert.equal(checkbox.checked,true);
  assert.equal(script.fill(scan.url,[{id:scan.fields[0].id,value:'90 days',mode:'confirm'}]).failed.length,1);
});
