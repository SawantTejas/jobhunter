import {canonicalSkill} from '../normalization/index.ts';
import {createHash} from 'node:crypto';
import type {ApplicationProfile,Field,Mapping} from './model.ts';
export const questionKey=(s:string)=>s.replace(/([a-z])([A-Z])/g,'$1 $2').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
const aliases:Record<string,string[]>={
  FIRST_NAME:['first name','given name'],LAST_NAME:['last name','family name','surname'],FULL_NAME:['full name','your full name'],
  EMAIL:['email','email address','your email address'],PHONE:['phone','phone number','mobile number','telephone number'],
  CITY:['city','current city'],COUNTRY:['country','country of residence','current country'],ADDRESS:['home address','mailing address'],POSTAL_CODE:['postal code','zip code','pin code'],
  LINKEDIN:['linkedin','linkedin profile','linkedin url','linkedin profile url'],GITHUB:['github','github profile','github url'],PORTFOLIO:['portfolio','portfolio url','personal website'],
  NOTICE_PERIOD:['notice period','what is your notice period','when can you join','joining availability','availability to join'],AVAILABLE_FROM:['available start date','joining date','earliest start date'],
  TOTAL_EXPERIENCE:['total experience','total years of experience','years of professional experience','total experience in years'],
  CURRENT_CTC:['current ctc','current annual compensation'],EXPECTED_CTC:['expected ctc','expected annual compensation'],
  RELOCATION:['are you willing to relocate','willing to relocate','open to relocation'],REMOTE_PREFERENCE:['work preference','remote preference'],
  CURRENT_COMPANY:['current employer','current company'],CURRENT_TITLE:['current job title','current designation'],
  EDUCATION_INSTITUTION:['university','college','educational institution','institution name'],EDUCATION_DEGREE:['degree','qualification','highest qualification'],EDUCATION_FIELD:['field of study','major'],
  RESUME:['resume','cv','upload resume','upload cv','resume cv','attach resume','attach cv'],
};
const sensitive=new Set(['NOTICE_PERIOD','AVAILABLE_FROM','TOTAL_EXPERIENCE','CURRENT_CTC','EXPECTED_CTC','RELOCATION','REMOTE_PREFERENCE','CURRENT_COMPANY','CURRENT_TITLE','EDUCATION_INSTITUTION','EDUCATION_DEGREE','EDUCATION_FIELD']);
const reserved=/password|captcha|one time password|verification code|credit card|bank account|social security|aadhaar|passport|consent|agree|privacy|terms|subscribe|signature|certify|declare|gender|ethnicity|race|disability|veteran/i;
export const customConcept=(question:string)=>'QUESTION_'+createHash('sha256').update(questionKey(question)).digest('hex');
export function conceptFor(field:Field):{concept?:string;high:boolean;reason:string;blocked?:boolean}{
  const primary=questionKey(field.label||field.ariaLabel),fallback=questionKey(field.name||field.placeholder);
  if(reserved.test(`${field.type} ${field.label} ${field.ariaLabel} ${field.name}`))return {high:false,blocked:true,reason:'Sensitive, consent, login or verification field: complete directly on the website'};
  if(/\b(?:reference|referee|emergency contact|spouse|parent details)\b/i.test(field.nearby))return {high:false,blocked:true,reason:'Third-party details: do not reuse your personal information; complete manually'};
  const identify=(q:string)=>{
    for(const [concept,phrases] of Object.entries(aliases))if(phrases.includes(q))return concept;
    const skill=q.match(/^(?:years (?:using|of experience (?:with|in)) (.+)|(.+?) experience(?: in years)?|how many years (?:of )?(?:experience (?:with|in) |using )(.+?)(?: do you have)?)$/);
    if(skill){const name=skill[1]??skill[2]??skill[3];if(!['work','professional','total','relevant'].includes(name))return 'SKILL_YEARS_'+questionKey(canonicalSkill(name)).toUpperCase().replace(/ /g,'_');}
    const countries=([['IN',/\bindia\b/],['US',/\b(?:united states|usa|us)\b/],['GB',/\b(?:united kingdom|uk)\b/],['CA',/\bcanada\b/]] as const).filter(([,pattern])=>pattern.test(q));
    const country=countries.length===1&&!/\b(?:not|without|except|unless)\b/.test(q)?countries[0][0]:undefined;
    if(country&&/\b(?:authorized|authorised|authorization|right to work|eligible to work)\b/.test(q))return 'WORK_AUTHORIZATION_'+country;
    if(country&&/\bsponsorship\b/.test(q)&&/\b(?:need|require|required|requiring)\b/.test(q))return 'SPONSORSHIP_'+country;
  };
  const concept=identify(primary);if(concept)return {concept,high:true,reason:'Exact label or recognized question pattern'};
  const fromName=identify(fallback);if(fromName)return {concept:fromName,high:false,reason:'Name/placeholder match; confirm what the field asks'};
  // Fuzzy aliases are suggestions only. A short/generic word cannot match a long question.
  const words=new Set(primary.split(' ').filter(Boolean));let best:{concept:string;score:number}|undefined;
  for(const [c,phrases] of Object.entries(aliases))for(const phrase of phrases){const tokens=new Set(phrase.split(' '));const score=[...words].filter(w=>tokens.has(w)).length/new Set([...words,...tokens]).size;if(words.size>=2&&score>=0.75&&(!best||score>best.score))best={concept:c,score};}
  if(best)return {concept:best.concept,high:false,reason:'Similar wording; confirmation required'};
  return {high:false,reason:'No reliable canonical concept; answer manually'};
}
export function profileValue(concept:string,p:ApplicationProfile):string|undefined {
  const current=p.workHistory.filter(w=>w.current);const company=current.length===1?current[0]:undefined;
  const values:Record<string,unknown>={FIRST_NAME:p.contact.firstName,LAST_NAME:p.contact.lastName,FULL_NAME:p.contact.fullName,EMAIL:p.contact.email,PHONE:p.contact.phone,CITY:p.contact.city,COUNTRY:p.contact.country,ADDRESS:p.contact.address,POSTAL_CODE:p.contact.postalCode,
    LINKEDIN:p.links.linkedin,GITHUB:p.links.github,PORTFOLIO:p.links.portfolio,NOTICE_PERIOD:p.noticePeriod,AVAILABLE_FROM:p.availableFrom,TOTAL_EXPERIENCE:p.experienceYears,CURRENT_CTC:p.currentCtc,EXPECTED_CTC:p.expectedCtc,RELOCATION:p.relocation,REMOTE_PREFERENCE:p.remotePreference,CURRENT_COMPANY:company?.company,CURRENT_TITLE:company?.title,EDUCATION_INSTITUTION:p.education.length===1?p.education[0].institution:undefined,EDUCATION_DEGREE:p.education.length===1?p.education[0].qualification:undefined,EDUCATION_FIELD:p.education.length===1?p.education[0].field:undefined};
  if(concept.startsWith('SKILL_YEARS_')){const key=Object.keys(p.skillYears).find(k=>questionKey(canonicalSkill(k)).toUpperCase().replace(/ /g,'_')===concept.slice(12));if(key)values[concept]=p.skillYears[key];}
  if(concept.startsWith('WORK_AUTHORIZATION_'))values[concept]=p.workAuthorization[concept.slice(19)]?.authorized;
  if(concept.startsWith('SPONSORSHIP_'))values[concept]=p.workAuthorization[concept.slice(12)]?.sponsorshipRequired;
  const value=values[concept];return value===undefined||value===''?undefined:typeof value==='boolean'?value?'Yes':'No':String(value);
}
export function mapField(field:Field,p:ApplicationProfile,answer:(concept:string)=>string|undefined):Mapping {
  const found=conceptFor(field),custom=customConcept(field.label||field.ariaLabel||field.name);
  if(found.blocked)return {fieldId:field.id,confidence:'UNKNOWN',reason:found.reason,blocked:true};
  if(field.type==='file')return {fieldId:field.id,concept:found.concept,confidence:found.concept==='RESUME'?'MEDIUM':'UNKNOWN',reason:'Choose a resume explicitly; other attachments are manual'};
  const concept=found.concept??custom,value=answer(concept)??(found.concept?profileValue(concept,p):undefined);
  if(value===undefined)return {fieldId:field.id,concept,confidence:'UNKNOWN',reason:found.concept?`${found.reason}; no confirmed value stored`:'Unknown question; no answer invented'};
  const restricted=(concept.startsWith('SKILL_YEARS_')&&!/years/i.test(field.label)&&field.type!=='number')||sensitive.has(concept)||concept.startsWith('WORK_AUTHORIZATION_')||concept.startsWith('SPONSORSHIP_')||concept.startsWith('QUESTION_')||['textarea','radio','checkbox','date'].includes(field.type)||field.hasValue;
  const optionMissing=field.options?.length&&!field.options.some(o=>questionKey(o.label)===questionKey(value)||o.value===value);
  const incompatible=field.type==='number'&&!/^\d+(?:\.\d+)?$/.test(value)||field.type==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)||field.type==='url'&&!/^https?:\/\//.test(value);
  return {fieldId:field.id,concept,value,confidence:incompatible?'LOW':found.high&&!restricted&&!optionMissing?'HIGH':'MEDIUM',reason:incompatible?'Stored answer does not match the input format':`${found.reason}${restricted?'; confirm this value for this application':''}${optionMissing?'; choose an available option':''}`};
}
