import type { Opportunity, Profile, Evaluation, ScoringStrategy } from '../model.ts';
import { contains, key, canonicalSkill } from '../normalization/index.ts';
import { indiaLocation } from './location.ts';
import { roleFit } from './roles.ts';
export function freshness(o:Opportunity, now=Date.now()) {
  if(!o.postedAt)return {freshness:'New to us — posting date unknown',freshnessScore:Math.max(2,8*Math.exp(-(now-Date.parse(o.firstSeenAt))/86400000/7))};
  const hours=Math.max(0,(now-Date.parse(o.postedAt))/3600000);
  return {freshness:(hours<6&&o.dateKind!=='date-only'?'JUST POSTED':hours<24?'FRESH':hours<72?'RECENT':hours<192?'THIS WEEK':'OLDER')+(o.dateKind==='published'?' (last published)':o.dateKind==='date-only'?' (posting date only; time unknown)':''),freshnessScore:100*Math.exp(-hours/72)};
}
export function hardFilter(o:Opportunity,p:Profile):string[] {
  const reasons:string[]=[]; const all=o.title+' '+o.description;
  if(o.status==='IGNORED')reasons.push('Ignored'); if(o.closed)reasons.push('Closed');
  if(!p.acceptableTypes.includes(o.type))reasons.push('Opportunity type');
  if(p.acceptableEmploymentTypes.length && o.employmentType!=='unknown'&&!p.acceptableEmploymentTypes.includes(o.employmentType))reasons.push('Employment type');
  if(p.excludedRoles.some(x=>contains(o.title,x)))reasons.push('Excluded role');
  if(p.excludedTechnologies.some(x=>o.skills.includes(canonicalSkill(x))))reasons.push('Excluded technology');
  if(p.rejectKeywords.some(x=>contains(all,x)))reasons.push('Rejected keyword');
  if(p.remotePreference==='remote'&&o.remoteType==='onsite')reasons.push('Onsite role');
  if(p.remotePreference==='remote'&&o.remoteType==='hybrid')reasons.push('Hybrid role');
  if(p.remotePreference==='onsite'&&o.remoteType==='remote')reasons.push('Remote role');
  if(p.indiaFirst&&!indiaLocation(o).eligible)reasons.push(indiaLocation(o).reason);
  if(!p.indiaFirst&&p.strictLocation&&p.preferredLocations.length&&o.location&&!p.preferredLocations.some(x=>contains(o.location,x))&&!/worldwide|anywhere|global/i.test(o.location))reasons.push('Location outside configured locations (remote may be geographically restricted)');
  if(p.experienceMax!==null&&o.experienceMin!==undefined&&o.experienceMin>p.experienceMax)reasons.push('Too senior');
  if(p.experienceMin!==null&&o.experienceMax!==undefined&&o.experienceMax<p.experienceMin)reasons.push('Too junior');
  if(o.type==='FREELANCE') {
    if(!p.freelance.enabled)reasons.push('Freelance disabled');
    if(p.freelance.minimumBudget!==null&&o.currency===p.freelance.currency&&o.budgetUnit===p.freelance.budgetUnit&&o.budgetMax!==undefined&&o.budgetMax<p.freelance.minimumBudget)reasons.push('Below minimum budget');
  }
  return reasons;
}
function titleSimilarity(a:string,b:string):number {const x=new Set(key(a).split(' ')),y=new Set(key(b).split(' '));return [...x].filter(t=>y.has(t)).length/Math.max(x.size,y.size,1);}
function base(o:Opportunity,p:Profile,freelance:boolean) {
  const candidate=[...new Set([...p.skills,...p.strongSkills,...p.secondarySkills].map(canonicalSkill))];
  const matched=o.skills.filter(s=>candidate.includes(s)), missing=o.skills.filter(s=>!candidate.includes(s));
  const weight=(s:string)=>p.strongSkills.map(canonicalSkill).includes(s)?2:p.secondarySkills.map(canonicalSkill).includes(s)?0.5:1;
  const skill=candidate.length?matched.reduce((n,s)=>n+weight(s),0)/candidate.reduce((n,s)=>n+weight(s),0):0;
  const title=Math.max(0,...[...p.targetTitles,...p.relatedTitles].map(t=>titleSimilarity(t,o.title)));
  const compatible=o.experienceMin===undefined?0.5:p.yearsExperience>=o.experienceMin&&(o.experienceMax===undefined||p.yearsExperience<=o.experienceMax)?1:0;
  const location=p.preferredLocations.length===0?0.5:p.preferredLocations.some(x=>contains(o.location,x))?1:0;
  const keywords=p.prioritizeKeywords.length?p.prioritizeKeywords.filter(x=>contains(o.title+' '+o.description,x)).length/p.prioritizeKeywords.length:0;
  const scope=p.freelance.scopeKeywords.length?p.freelance.scopeKeywords.filter(x=>contains(o.title+' '+o.description,x)).length/p.freelance.scopeKeywords.length:title;
  const budget=o.currency===p.freelance.currency&&o.budgetUnit===p.freelance.budgetUnit&&o.budgetMin!==undefined&&p.freelance.minimumBudget!==null?Number(o.budgetMin>=p.freelance.minimumBudget):0.5;
  const role=roleFit(o,p);
  const geo=p.indiaFirst?indiaLocation(o).score/100:location;
  let score=freelance?45*role.core+20*skill+15*scope+10*budget+10*geo:40*role.core+15*skill+15*Number(role.related)+10*compatible+20*geo;
  score+=5*keywords;
  // Infrastructure overlap cannot rescue an incompatible primary stack.
  if(role.core===0)score=Math.min(score,24);
  else if(role.core<0.5)score=Math.min(score,44);
  if(role.dominantMismatch.length)score=Math.min(score,24);
  if(!freelance&&!role.related)score=Math.min(score,24);
  const seniorityMismatch=!freelance&&p.yearsExperience<6&&/\b(staff|principal|architect|director|head of)\b/i.test(o.title);
  if(seniorityMismatch)score=Math.min(score,35);
  if(o.experienceMin!==undefined&&o.experienceMin>p.yearsExperience+2)score=Math.min(score,24);
  const matchScore=Math.round(Math.min(100,score));
  return {matchScore,matched,missing,reasons:[
    `Role family: ${role.related?role.matched.join(', ')||'target title':'not confirmed'}; core skill coverage: ${Math.round(role.core*100)}%`,
    `Important mismatches: ${role.dominantMismatch.join(', ')||(!role.core?role.mismatches.join(', ')||'no core stack evidence':'none explicit')}`,
    ...(seniorityMismatch?['Seniority review: title suggests a more senior role than the configured experience']:[]),
    `Title similarity: ${Math.round(title*100)}%`, `Experience: ${o.experienceMin??'?'}–${o.experienceMax??'?'} years; ${o.experienceMin===undefined?'unknown':compatible?'compatible':'review required'}`,
    `Location: ${o.location||'unknown'} / ${o.remoteType}; ${p.indiaFirst?indiaLocation(o).reason:location===1?'preferred location':'verify eligibility'}`,
    ...(freelance?[`Budget: ${o.budgetMin??'?'}–${o.budgetMax??'?'} ${o.currency??''} / ${o.budgetUnit??'unknown'}; currencies and units are not converted`]:[])]};
}
export const employmentStrategy:ScoringStrategy={score:(o,p)=>base(o,p,false)};
export const freelanceStrategy:ScoringStrategy={score:(o,p)=>base(o,p,true)};
export function evaluate(o:Opportunity,p:Profile,now=Date.now()):Evaluation {
  const filtered=hardFilter(o,p);
  if(filtered.length)return {...freshness(o,now),matchScore:0,rankScore:0,matched:[],missing:[],reasons:[],filtered};
  const score=(o.type==='FREELANCE'?freelanceStrategy:employmentStrategy).score(o,p),fresh=freshness(o,now);
  const freshWeight=o.type==='FREELANCE'?0.7:0.65;
  const days=o.postedAt?(now-Date.parse(o.postedAt))/86400000:0;
  const stalePenalty=days>90?0.1:days>30?0.35:1;
  // Multiply by fit so very fresh weak matches cannot outrank good matches.
  return {...score,...fresh,reasons:[...score.reasons,...(stalePenalty<1?[`Stale listing: ${Math.floor(days)} days since posted/published; rank reduced`]:[])],rankScore:Math.round(score.matchScore*((1-freshWeight)+freshWeight*fresh.freshnessScore/100)*stalePenalty),filtered};
}
