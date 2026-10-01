// This is the entire browser/public contract. Never import the private model here.
export type PublicStatus = 'NEW' | 'SAVED' | 'APPLIED' | 'INTERVIEW' | 'REJECTED' | 'OFFER' | 'WITHDRAWN';
export interface PublicOpportunity {
  id:string; title:string; company:string; location:string;
  type:'EMPLOYMENT'|'CONTRACT'|'FREELANCE'; status:PublicStatus;
  matchScore:number; description:string; freshness:string;
  postedAt?:string; appliedAt?:string; interviewAt?:string;
  applicationUrl?:string; source?:string; skills:string[];
}
export interface PublicSnapshot { schemaVersion:1; exportedAt:string; opportunities:PublicOpportunity[] }
export const publicFields=['id','title','company','location','type','status','matchScore','description','freshness','postedAt','appliedAt','interviewAt','applicationUrl','source','skills'] as const;
export function validateSnapshot(value:unknown):asserts value is PublicSnapshot {
  if(!value||typeof value!=='object')throw new Error('Invalid dashboard data');
  const data=value as Record<string,unknown>;
  if(Object.keys(data).some(k=>!['schemaVersion','exportedAt','opportunities'].includes(k))||data.schemaVersion!==1||typeof data.exportedAt!=='string'||!Number.isFinite(Date.parse(data.exportedAt))||!Array.isArray(data.opportunities))throw new Error('Invalid dashboard snapshot');
  const ids=new Set<string>();
  for(const item of data.opportunities){
    if(!item||typeof item!=='object'||Object.keys(item).some(k=>!(publicFields as readonly string[]).includes(k)))throw new Error('Unexpected public opportunity field');
    const row=item as Record<string,unknown>;
    for(const key of ['id','title','company','location','description','freshness'])if(typeof row[key]!=='string')throw new Error(`Invalid public ${key}`);
    if(ids.has(row.id as string))throw new Error('Duplicate public ID');ids.add(row.id as string);
    if(!['EMPLOYMENT','CONTRACT','FREELANCE'].includes(String(row.type))||!['NEW','SAVED','APPLIED','INTERVIEW','REJECTED','OFFER','WITHDRAWN'].includes(String(row.status)))throw new Error('Invalid public type/status');
    if(typeof row.matchScore!=='number'||!Number.isFinite(row.matchScore)||row.matchScore<0||row.matchScore>100||!Array.isArray(row.skills)||!row.skills.every(s=>typeof s==='string'))throw new Error('Invalid public score/skills');
    for(const key of ['postedAt','appliedAt','interviewAt'])if(row[key]!==undefined&&(typeof row[key]!=='string'||!Number.isFinite(Date.parse(row[key] as string))))throw new Error('Invalid public date');
    if(row.source!==undefined&&typeof row.source!=='string')throw new Error('Invalid source');
    if(row.applicationUrl!==undefined){const u=new URL(String(row.applicationUrl));if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw new Error('Unsafe application link');}
  }
}
