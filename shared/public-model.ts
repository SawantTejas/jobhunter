// This is the entire browser/public contract. Never import the private model here.
export type PublicStatus = 'NEW' | 'SAVED' | 'APPLIED' | 'INTERVIEW' | 'REJECTED' | 'OFFER' | 'WITHDRAWN' | 'IGNORED';
export interface PublicEvent {status:'APPLIED'|'INTERVIEW'|'REJECTED'|'OFFER'|'WITHDRAWN'; at:string}
export interface PublicOpportunity {
  id:string; title:string; company:string; location:string;
  type:'EMPLOYMENT'|'CONTRACT'|'FREELANCE'; status:PublicStatus;
  matchScore:number; description:string; freshness:string;
  postedAt?:string; appliedAt?:string; interviewAt?:string;
  applicationUrl?:string; source?:string; skills:string[];
  history?:PublicEvent[];
  remoteType?:string;
}
export interface PublicSnapshot { schemaVersion:1; exportedAt:string; opportunities:PublicOpportunity[]; timeZone?:string; totalDiscovered?:number }
export const publicFields=['id','title','company','location','type','status','matchScore','description','freshness','postedAt','appliedAt','interviewAt','applicationUrl','source','skills','history','remoteType'] as const;
export function validateSnapshot(value:unknown):asserts value is PublicSnapshot {
  if(!value||typeof value!=='object')throw new Error('Invalid dashboard data');
  const data=value as Record<string,unknown>;
  if(Object.keys(data).some(k=>!['schemaVersion','exportedAt','opportunities','timeZone','totalDiscovered'].includes(k))||data.schemaVersion!==1||typeof data.exportedAt!=='string'||!Number.isFinite(Date.parse(data.exportedAt))||!Array.isArray(data.opportunities))throw new Error('Invalid dashboard snapshot');
  if(data.timeZone!==undefined){if(typeof data.timeZone!=='string')throw new Error('Invalid timezone');new Intl.DateTimeFormat('en',{timeZone:data.timeZone}).format();}
  if(data.totalDiscovered!==undefined&&(!Number.isSafeInteger(data.totalDiscovered)||Number(data.totalDiscovered)<data.opportunities.length))throw new Error('Invalid discovered count');
  const ids=new Set<string>();
  for(const item of data.opportunities){
    if(!item||typeof item!=='object'||Object.keys(item).some(k=>!(publicFields as readonly string[]).includes(k)))throw new Error('Unexpected public opportunity field');
    const row=item as Record<string,unknown>;
    for(const key of ['id','title','company','location','description','freshness'])if(typeof row[key]!=='string')throw new Error(`Invalid public ${key}`);
    if(ids.has(row.id as string))throw new Error('Duplicate public ID');ids.add(row.id as string);
    if(!['EMPLOYMENT','CONTRACT','FREELANCE'].includes(String(row.type))||!['NEW','SAVED','APPLIED','INTERVIEW','REJECTED','OFFER','WITHDRAWN','IGNORED'].includes(String(row.status)))throw new Error('Invalid public type/status');
    if(row.history!==undefined){if(!Array.isArray(row.history))throw new Error('Invalid history');for(const e of row.history){if(!e||typeof e!=='object'||Object.keys(e).some(k=>!['status','at'].includes(k))||!['APPLIED','INTERVIEW','REJECTED','OFFER','WITHDRAWN'].includes(e.status)||typeof e.at!=='string'||!Number.isFinite(Date.parse(e.at)))throw new Error('Invalid public history event');}}
    if(typeof row.matchScore!=='number'||!Number.isFinite(row.matchScore)||row.matchScore<0||row.matchScore>100||!Array.isArray(row.skills)||!row.skills.every(s=>typeof s==='string'))throw new Error('Invalid public score/skills');
    for(const key of ['postedAt','appliedAt','interviewAt'])if(row[key]!==undefined&&(typeof row[key]!=='string'||!Number.isFinite(Date.parse(row[key] as string))))throw new Error('Invalid public date');
    if(row.source!==undefined&&typeof row.source!=='string')throw new Error('Invalid source');
    if(row.remoteType!==undefined&&typeof row.remoteType!=='string')throw new Error('Invalid remote type');
    if(row.applicationUrl!==undefined){const u=new URL(String(row.applicationUrl));if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw new Error('Unsafe application link');}
  }
}
