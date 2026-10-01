import { readFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Profile, RegistryEntry } from './model.ts';
export function loadConfig() {
  mkdirSync('config',{recursive:true});
  for(const name of ['profile','sources'])if(!existsSync(`config/${name}.json`)){copyFileSync(new URL(`../config/${name}.example.json`,import.meta.url),`config/${name}.json`);console.error(`Created config/${name}.json from EXAMPLE — edit it for your preferences.`);}
  const profile=JSON.parse(readFileSync('config/profile.json','utf8')) as Profile;
  const registry=JSON.parse(readFileSync('config/sources.json','utf8')) as RegistryEntry[];
  for(const field of ['targetTitles','relatedTitles','skills','strongSkills','secondarySkills','preferredLocations','acceptableTypes','acceptableEmploymentTypes','excludedRoles','excludedTechnologies','prioritizeKeywords','rejectKeywords'] as const)
    if(!Array.isArray(profile[field])||!profile[field].every(x=>typeof x==='string'))throw new Error(`Profile ${field} must be a string array`);
  if(!Number.isFinite(profile.yearsExperience)||profile.yearsExperience<0||!Number.isFinite(profile.minimumMatch)||profile.minimumMatch<0||profile.minimumMatch>100||!profile.freelance||!Array.isArray(profile.freelance.scopeKeywords))throw new Error('Invalid profile numbers or freelance preferences');
  if(!['any','remote','onsite'].includes(profile.remotePreference)||typeof profile.strictLocation!=='boolean')throw new Error('Invalid location preferences');
  if(profile.acceptableTypes.some(t=>!['EMPLOYMENT','CONTRACT','FREELANCE'].includes(t))||typeof profile.freelance.enabled!=='boolean'||!profile.freelance.scopeKeywords.every(x=>typeof x==='string')||typeof profile.freelance.currency!=='string'||!['project','hour'].includes(profile.freelance.budgetUnit))throw new Error('Invalid opportunity types or freelance settings');
  for(const v of [profile.experienceMin,profile.experienceMax,profile.freelance.minimumBudget])if(v!==null&&(!Number.isFinite(v)||v<0))throw new Error('Experience/budget limits must be nonnegative numbers or null');
  if(profile.indiaFirst!==undefined&&typeof profile.indiaFirst!=='boolean')throw new Error('indiaFirst must be boolean');
  if(profile.coreSkillGroups!==undefined&&(!Array.isArray(profile.coreSkillGroups)||!profile.coreSkillGroups.every(g=>Array.isArray(g)&&g.length>0&&g.every(s=>typeof s==='string'))))throw new Error('coreSkillGroups must be arrays of skill names');
  if(profile.roleFamilies!==undefined&&(!Array.isArray(profile.roleFamilies)||!profile.roleFamilies.every(s=>typeof s==='string')))throw new Error('roleFamilies must be an array');
  if(!Array.isArray(registry)||registry.some(r=>!r.id||!r.adapter||!r.company||!r.board||typeof r.enabled!=='boolean')||new Set(registry.map(r=>r.id)).size!==registry.length)throw new Error('Invalid or duplicate source registry entries');
  for(const r of registry)for(const v of [r.maxPages,r.maxDetails])if(v!==undefined&&(!Number.isInteger(v)||v<1||v>200))throw new Error(`Invalid request limit for ${r.id}`);
  return {profile,registry,dataDir:resolve(process.env.JOB_AGENT_DATA??'data')};
}
