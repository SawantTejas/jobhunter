import {randomUUID} from 'node:crypto';
import {readFileSync,statSync} from 'node:fs';
import {basename,extname} from 'node:path';
import type {Store} from '../persistence/index.ts';
import type {Profile} from '../model.ts';
import {evaluate} from '../matching/index.ts';
import {privateProfile} from './profile.ts';
import {conceptFor,customConcept,mapField} from './mapping.ts';
import type {DetectedField,Field,FilledField} from './model.ts';
const string=(v:unknown,max=2000)=>{if(typeof v!=='string'||v.length>max)throw new Error('Invalid text value');return v;};
export function pageUrl(v:unknown){const u=new URL(string(v,4000));if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw new Error('Expected an application HTTP(S) URL');u.hash='';return u.toString();}
export function fieldsInput(value:unknown):Field[]{
  if(!Array.isArray(value)||value.length>200)throw new Error('At most 200 fields per page');
  const ids=new Set<string>();return value.map(v=>{
    if(!v||typeof v!=='object'||typeof v.required!=='boolean'||typeof v.hasValue!=='boolean')throw new Error('Invalid field');
    const id=string(v.id,100);if(ids.has(id))throw new Error('Duplicate field identifier');ids.add(id);
    const type=string(v.type,30),tag=string(v.tag,30);if(!['text','email','tel','number','url','date','textarea','select','radio','checkbox','file','search'].includes(type))throw new Error('Unsupported field type');
    if(v.options!==undefined&&(!Array.isArray(v.options)||v.options.length>250))throw new Error('Invalid field options');
    return {id,type,tag,label:string(v.label,500),name:string(v.name,200),placeholder:string(v.placeholder,500),ariaLabel:string(v.ariaLabel,500),nearby:string(v.nearby,500),required:v.required,hasValue:v.hasValue,
      ...(v.options?{options:v.options.map((o:{value:unknown;label:unknown})=>({value:string(o.value,500),label:string(o.label,500)}))}:{})};
  });
}
export class ApplicationService {
  constructor(privateStore:Store,candidate:Profile,dataDir:string){this.store=privateStore;this.candidate=candidate;this.dataDir=dataDir;}
  private store:Store;private candidate:Profile;private dataDir:string;
  private profile(){return privateProfile(this.dataDir,this.candidate);}
  private answer=(concept:string)=>this.store.db.prepare('SELECT answer FROM application_answers WHERE concept=?').get(concept)?.answer as string|undefined;
  context(){const p=this.profile();return {jobs:this.store.list().map(o=>({id:o.id,title:o.title,company:o.companyOrClient,url:o.canonicalUrl,status:o.status})),resumes:p.resumes.map(r=>({id:r.id,label:r.label})),defaultResumeId:p.defaultResumeId??(p.resumes.length===1?p.resumes[0].id:undefined)};}
  private session(id:unknown){const row=this.store.db.prepare('SELECT * FROM application_sessions WHERE id=?').get(string(id,100));if(!row)throw new Error('Unknown application session');return row;}
  analyze(input:Record<string,unknown>){
    const fields=fieldsInput(input.fields),url=pageUrl(input.url),jobId=string(input.jobId,100);
    if(!this.store.list().some(o=>o.id===jobId))throw new Error('Choose an existing JobFinder opportunity');
    const old=input.sessionId?this.session(input.sessionId):undefined;
    if(old&&(old.jobId!==jobId||old.completedAt))throw new Error('Start a new session for this opportunity');
    const id=old?String(old.id):randomUUID(),now=new Date().toISOString(),profile=this.profile();
    const mapped=fields.map(field=>({...field,pageUrl:url,mapping:mapField(field,profile,this.answer)}));
    const previous:DetectedField[]=old?JSON.parse(String(old.detectedJson)):[];
    const detected=[...previous.filter(f=>f.pageUrl!==url),...mapped];
    if(detected.length>1000)throw new Error('Session field limit reached');
    const unknown=detected.filter(f=>['UNKNOWN','LOW'].includes(f.mapping.confidence)).map(f=>({id:f.id,pageUrl:f.pageUrl,label:f.label}));
    if(old)this.store.db.prepare('UPDATE application_sessions SET url=?,detectedJson=?,unknownJson=? WHERE id=?').run(url,JSON.stringify(detected),JSON.stringify(unknown),id);
    else this.store.db.prepare('INSERT INTO application_sessions(id,jobId,url,startedAt,detectedJson,unknownJson) VALUES (?,?,?,?,?,?)').run(id,jobId,url,now,JSON.stringify(detected),JSON.stringify(unknown));
    return {sessionId:id,fields:mapped.map(f=>({field:f,mapping:f.mapping}))};
  }
  filled(input:Record<string,unknown>){
    const session=this.session(input.sessionId),url=pageUrl(input.url);if(session.completedAt||session.url!==url)throw new Error('Rescan the current page before updating this session');
    if(!Array.isArray(input.ids)||input.ids.length>200)throw new Error('Invalid filled fields');
    const detected:DetectedField[]=JSON.parse(String(session.detectedJson)),filled:FilledField[]=JSON.parse(String(session.filledJson));
    for(const id of input.ids){const field=detected.find(f=>f.id===id&&f.pageUrl===url);if(!field||field.mapping.blocked)throw new Error('Unknown or protected field');if(!filled.some(f=>f.id===id&&f.pageUrl===url))filled.push({id:String(id),pageUrl:url,concept:field.mapping.concept,filledAt:new Date().toISOString()});}
    const unknown=detected.filter(f=>['LOW','UNKNOWN'].includes(f.mapping.confidence)&&!filled.some(g=>g.id===f.id&&g.pageUrl===f.pageUrl)).map(f=>({id:f.id,pageUrl:f.pageUrl,label:f.label}));
    let resumeId=session.resumeId;if(input.resumeId!==undefined){resumeId=string(input.resumeId,100);if(!this.profile().resumes.some(r=>r.id===resumeId))throw new Error('Unknown resume');if(!input.ids.some(id=>detected.some(f=>f.id===id&&f.type==='file'&&f.mapping.concept==='RESUME')))throw new Error('No resume field filled');}
    this.store.db.prepare('UPDATE application_sessions SET filledJson=?,unknownJson=?,resumeId=? WHERE id=?').run(JSON.stringify(filled),JSON.stringify(unknown),resumeId??null,session.id);return {filled:filled.length,unknown:unknown.length};
  }
  saveAnswer(input:Record<string,unknown>){
    const session=this.session(input.sessionId);if(session.completedAt)throw new Error('Session is already completed');
    const field=(JSON.parse(String(session.detectedJson)) as DetectedField[]).find(f=>f.id===input.fieldId&&f.pageUrl===session.url);
    if(!field||field.mapping.blocked||field.type==='file')throw new Error('This field cannot be stored as a reusable answer');
    const answer=string(input.answer,10000);if(!answer.trim())throw new Error('Empty answers are not saved');
    const question=field.label||field.ariaLabel||field.name;if(!question.trim())throw new Error('Unlabelled fields cannot have reusable answers');const concept=conceptFor(field).concept??customConcept(question);
    this.store.db.prepare('INSERT INTO application_answers VALUES (?,?,?,?) ON CONFLICT(concept) DO UPDATE SET question=excluded.question,answer=excluded.answer,confirmedAt=excluded.confirmedAt').run(concept,question,answer,new Date().toISOString());return {saved:true,concept};
  }
  resume(id:unknown){
    const variant=this.profile().resumes.find(r=>r.id===id);if(!variant)throw new Error('Unknown resume variant');
    const extension=extname(variant.path).toLowerCase(),types:Record<string,string>={'.pdf':'application/pdf','.doc':'application/msword','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
    if(!types[extension])throw new Error('Resume must be PDF, DOC or DOCX');const stat=statSync(variant.path);if(!stat.isFile()||stat.size>10*1024*1024)throw new Error('Resume must be a file of at most 10 MB');
    return {name:basename(variant.path),mime:types[extension],base64:readFileSync(variant.path).toString('base64')};
  }
  complete(input:Record<string,unknown>){
    const session=this.session(input.sessionId);if(input.manuallySubmitted!==true)throw new Error('Confirm that you submitted the application yourself');
    const job=this.store.list().find(o=>o.id===session.jobId);if(!job)throw new Error('Opportunity no longer exists');
    if(!['INTERVIEW','REJECTED','OFFER','WITHDRAWN'].includes(job.status))this.store.status(job.id,'APPLIED',undefined,undefined,evaluate(job,this.candidate).matchScore);
    this.store.db.prepare('UPDATE application_sessions SET completedAt=COALESCE(completedAt,?) WHERE id=?').run(new Date().toISOString(),session.id);return {applied:true};
  }
}
