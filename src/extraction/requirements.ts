import type {Opportunity} from '../model.ts';
import {extractSkills,text} from '../normalization/index.ts';
export interface Requirements {
  required:string[]; preferred:string[]; mentioned:string[];
  education:string[]; experienceMin?:number; experienceMax?:number;
  location?:string; workMode?:'remote'|'hybrid'|'onsite'; employmentType?:string;
  evidence:'explicit'|'unclassified';
}
// Preserve section boundaries before normalizing HTML. Unqualified mentions are
// never silently promoted to mandatory requirements.
export function extractRequirements(description:string):Requirements {
  const required=new Set<string>(),preferred=new Set<string>(),mentioned=new Set(extractSkills(text(description)));
  let section:'required'|'preferred'|'mentioned'='mentioned';
  const lines=description.replace(/<\/(?:p|div|li|h[1-6])>|<br\s*\/?\s*>/gi,'\n').split(/\n|(?<=[.!?;])\s+/);
  for(const raw of lines){
    const line=text(raw);if(!line)continue;
    if(/^(?:responsibilities|about us|benefits|what we offer|about the company)\b/i.test(line))section='mentioned';
    const optional=/\b(?:preferred|nice[- ]to[- ]have|bonus|a plus|desirable|optional)\b/i.test(line);
    const mandatory=/\b(?:required|requirements|must[- ]have|must possess|essential|minimum qualifications|you must|strong (?:experience|proficiency) (?:in|with))\b/i.test(line);
    if(line.length<90&&/:$/.test(line)||/^(?:requirements|qualifications|nice to have|preferred skills|essential skills)$/i.test(line)){
      if(optional)section='preferred';else if(mandatory||/^qualifications/i.test(line))section='required';
    }
    const mode=/\b(?:not required|no experience (?:needed|required))\b/i.test(line)?'mentioned':optional?'preferred':mandatory?'required':section;
    if(mode==='mentioned')continue;
    for(const skill of extractSkills(line,mentioned))if(mode==='required')required.add(skill);else if(mode==='preferred')preferred.add(skill);
  }
  for(const s of required)preferred.delete(s);
  const plain=text(description);
  const range=plain.match(/\b(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\s*(?:years?|yrs?)\b(?:\s+of)?\s*(?:(?:professional|relevant|commercial|hands[- ]on|work)\s+)?experience/i);
  const minimum=plain.match(/\b(?:at least\s+|minimum(?: of)?\s+)?(\d{1,2})\+?\s*(?:years?|yrs?)\b(?:\s+of)?\s*(?:(?:professional|relevant|commercial|hands[- ]on|work)\s+)?experience/i);
  const education=[...new Set(plain.match(/\b(?:bachelor['’]?s?|master['’]?s?|B\.?Tech|B\.?E\.|M\.?Tech|MCA|BCA|Ph\.?D)(?:\s+degree)?(?:\s+in\s+(?:computer science|engineering|information technology))?/gi)??[])];
  const labeled=description.replace(/<\/(?:p|div|li)>|<br\s*\/?\s*>/gi,'\n').split('\n').map(text).join('\n');
  const location=labeled.match(/\b(?:job location|location)\s*:\s*([^\n.;]{2,100}?)(?=\s+(?:work mode|employment type|experience|salary|job type|requirements)\s*:|[\n.;]|$)/i)?.[1]?.trim();
  const mode=plain.match(/\b(?:work mode|workplace type|working arrangement)\s*:\s*(remote|hybrid|on[- ]?site)\b/i)?.[1]?.toLowerCase();
  const employmentType=plain.match(/\b(?:employment type|job type)\s*:\s*(full[- ]?time|part[- ]?time|contract|freelance|internship|temporary)\b/i)?.[1];
  return {required:[...required],preferred:[...preferred],mentioned:[...mentioned].filter(s=>!required.has(s)&&!preferred.has(s)),education,
    ...(location?{location}:{}),...(mode?{workMode:mode.startsWith('on')?'onsite':mode as 'remote'|'hybrid'}:{}),...(employmentType?{employmentType}:{}),
    ...(range?{experienceMin:Number(range[1]),experienceMax:Number(range[2])}:minimum?{experienceMin:Number(minimum[1])}:{}),evidence:required.size||preferred.size?'explicit':'unclassified'};
}
const cache=new WeakMap<Opportunity,Requirements>();
export function requirementsFor(o:Opportunity):Requirements{if(o.requirements)return o.requirements;const previous=cache.get(o);if(previous)return previous;const value=extractRequirements(o.description);cache.set(o,value);return value;}
export function confidenceFor(o:Opportunity):{confidence:'HIGH'|'MEDIUM'|'LOW';confidenceReasons:string[]}{
  const reasons:string[]=[];
  if(o.partial||o.description.startsWith('[PARTIAL'))return {confidence:'LOW',confidenceReasons:['Search metadata only; full job description was inaccessible']};
  if(o.description.length<500)reasons.push('Short or incomplete description');
  if(!o.location||o.remoteType==='unknown')reasons.push('Location or work mode is not fully specified');
  if(requirementsFor(o).evidence==='unclassified')reasons.push('Required and preferred skills are not explicitly classified');
  if(!o.postedAt)reasons.push('Posting date unknown');
  if(o.authority!=='employer')reasons.push('Employer-authored canonical data not confirmed');
  return {confidence:o.description.length<180?'LOW':o.authority==='employer'&&reasons.length<=1?'HIGH':'MEDIUM',confidenceReasons:reasons.length?reasons:['Detailed employer description with explicit requirements']};
}
