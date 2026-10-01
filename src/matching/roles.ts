import { readFileSync } from 'node:fs';
import { contains, canonicalSkill } from '../normalization/index.ts';
import type { Opportunity, Profile } from '../model.ts';
export interface RoleFamily { titles:string[]; anchors:string[] }
export const families=JSON.parse(readFileSync(new URL('../../config/role-families.json',import.meta.url),'utf8')) as Record<string,RoleFamily>;
export function roleFit(o:Opportunity,p:Profile) {
  const selected=p.roleFamilies?.length?p.roleFamilies:Object.keys(families).filter(name=>families[name].titles.some(t=>[...p.targetTitles,...p.relatedTitles].some(x=>contains(x,t))));
  const matched=selected.filter(name=>families[name]?.titles.some(t=>contains(o.title,t)));
  const titleSkills=new Set(o.skills.filter(s=>contains(o.title,s)));
  const incompatibleFunction=/\b(project manager|product manager|program manager|engineering manager|sales|recruiter|marketing|support engineer|qa engineer|quality assurance|data scientist|machine learning|devops|site reliability)\b/i;
  const functionMismatch=incompatibleFunction.test(o.title)&&![...p.targetTitles,...p.relatedTitles].some(t=>incompatibleFunction.test(t));
  const related=!functionMismatch&&(matched.length>0||[...p.targetTitles,...p.relatedTitles].some(t=>contains(o.title,t)));
  const coreGroups=(p.coreSkillGroups?.length?p.coreSkillGroups:[p.strongSkills]).filter(g=>g.length).map(g=>g.map(canonicalSkill));
  const core=Math.max(0,...coreGroups.map(g=>g.filter(s=>o.skills.includes(s)).length/g.length));
  const anchors=[...new Set(Object.values(families).flatMap(f=>f.anchors))];
  const candidate=new Set([...p.skills,...p.strongSkills,...p.secondarySkills].map(canonicalSkill));
  const mismatches=anchors.filter(s=>o.skills.includes(s)&&!candidate.has(s));
  const dominantMismatch=mismatches.filter(s=>titleSkills.has(s)||new RegExp(`(?:required|must have|strong (?:experience|proficiency) (?:in|with))[^.!?]{0,50}\\b${s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'i').test(o.description));
  return {related,matched:related?matched:[],core,mismatches,dominantMismatch};
}
