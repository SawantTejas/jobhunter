import {existsSync,readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import type {Profile} from '../model.ts';
import type {ApplicationProfile} from './model.ts';
export function privateProfile(dataDir:string,candidate:Profile):ApplicationProfile {
  const path=join(dataDir,'application-profile.json');
  if(!existsSync(path)){
    mkdirSync(dataDir,{recursive:true});
    const seed:ApplicationProfile={contact:{},links:{},workHistory:[],education:[],workAuthorization:{},skillYears:{},resumes:[]};
    // Existing candidate data is inherited at read time, rather than copied and
    // allowed to drift. No contact, salary, education or skill-years are inferred.
    writeFileSync(path+'.tmp',JSON.stringify(seed,null,2)+'\n',{mode:0o600});renameSync(path+'.tmp',path);
  }
  const value=JSON.parse(readFileSync(path,'utf8')) as ApplicationProfile;
  validateProfile(value);
  return {...value,workHistory:value.workHistory.length?value.workHistory:(candidate.resumeEvidence?.workHistory??[]).map(w=>({company:w.company,startDate:w.startMonth,endDate:w.endMonth??undefined,current:w.endMonth===null})),
    experienceYears:value.experienceYears??candidate.yearsExperience,
    remotePreference:value.remotePreference??candidate.remotePreference,
    resumes:value.resumes.length?value.resumes:candidate.resumeEvidence?.file&&existsSync(candidate.resumeEvidence.file)?[{id:'existing-resume',label:'Existing resume',path:candidate.resumeEvidence.file}]:[]};
}
export function validateProfile(p:ApplicationProfile){
  if(!p||typeof p!=='object'||!p.contact||!p.links||!p.workAuthorization||!p.skillYears||!Array.isArray(p.workHistory)||!Array.isArray(p.education)||!Array.isArray(p.resumes))throw new Error('Invalid private application profile; use config/application-profile.example.json');
  for(const group of [p.contact,p.links])if(Object.values(group).some(v=>typeof v!=='string'||v.length>4000))throw new Error('Profile contact/link values must be strings');
  for(const key of ['noticePeriod','availableFrom','currentCtc','expectedCtc','remotePreference','defaultResumeId'] as const)if(p[key]!==undefined&&typeof p[key]!=='string')throw new Error(`Invalid ${key}`);
  for(const n of [p.experienceYears,...Object.values(p.skillYears)])if(n!==undefined&&(!Number.isFinite(n)||n<0||n>80))throw new Error('Experience must be between 0 and 80 years');
  if(p.relocation!==undefined&&typeof p.relocation!=='boolean')throw new Error('relocation must be true or false');
  for(const a of Object.values(p.workAuthorization))if(!a||Object.values(a).some(v=>typeof v!=='boolean'))throw new Error('Work authorization must contain confirmed booleans');
  for(const w of p.workHistory)if(typeof w.company!=='string'||['title','startDate','endDate'].some(k=>w[k as 'title']!==undefined&&typeof w[k as 'title']!=='string')||(w.current!==undefined&&typeof w.current!=='boolean'))throw new Error('Invalid work history');
  for(const e of p.education)if(typeof e.institution!=='string'||Object.values(e).some(v=>typeof v!=='string'))throw new Error('Invalid education');
  if(new Set(p.resumes.map(r=>r.id)).size!==p.resumes.length||p.resumes.some(r=>!r.id||typeof r.label!=='string'||typeof r.path!=='string'))throw new Error('Invalid resume variants');
  if(p.defaultResumeId&&!p.resumes.some(r=>r.id===p.defaultResumeId))throw new Error('defaultResumeId must reference a configured resume');
}
