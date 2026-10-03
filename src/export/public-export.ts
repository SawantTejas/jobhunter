import { mkdirSync,readFileSync,renameSync,writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Profile } from '../model.ts';
import type { PublicEvent,PublicOpportunity,PublicSnapshot,PublicStatus } from '../../shared/public-model.ts';
import { validateSnapshot } from '../../shared/public-model.ts';
import { Store } from '../persistence/index.ts';
import { evaluate } from '../matching/index.ts';
import { text,contains } from '../normalization/index.ts';
import {families} from '../matching/roles.ts';
import {indiaLocation} from '../matching/location.ts';
export function safeText(value:string,max=320):string {
  return text(value).replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[email removed]')
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g,match=>match.replace(/\D/g,'').length>=10?'[phone removed]':match)
    .replace(/https?:\/\/\S+/gi,'[link removed]').slice(0,max);
}
export function publicUrl(value:string):string|undefined {
  try{
    const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||/^(localhost|127\.|0\.|10\.|192\.168\.|\[?::1)/i.test(u.hostname)||u.hostname.endsWith('.local'))return;
    if(/@|\b(?:resume|curriculum-vitae)\b/i.test(decodeURIComponent(u.pathname)))return;
    const allowed=new Set(['id','job','jobid','job_id','gh_jid','requisitionid','reqid','postingid','currentjobid','lang','locale']);
    for(const key of [...u.searchParams.keys()])if(!allowed.has(key.toLowerCase())||/@/.test(u.searchParams.get(key)??''))u.searchParams.delete(key);
    u.hash='';return u.toString();
  }catch{return;}
}
export class PublicExportService {
  snapshot(store:Store,profile:Profile,now=new Date().toISOString(),includeUnrecommended=false):PublicSnapshot {
    const facts=new Map(store.db.prepare('SELECT * FROM application_facts').all().map(f=>[String(f.opportunityId),{recordedAt:String(f.recordedAt),...(typeof f.matchScore==='number'?{matchScore:f.matchScore}:{}),...(f.postedAt?{postedAt:String(f.postedAt)}:{}),...(f.dateKind?{dateKind:String(f.dateKind)}:{}),skills:(JSON.parse(String(f.skillsJson)) as string[]).map(s=>safeText(s,50))}]));
    const events=new Map<string,PublicEvent[]>();
    for(const row of store.db.prepare("SELECT opportunityId,toStatus,changedAt FROM opportunity_status_events WHERE toStatus IN ('APPLIED','INTERVIEW','REJECTED','OFFER','WITHDRAWN') ORDER BY changedAt,id").all()){
      const id=String(row.opportunityId);events.set(id,[...(events.get(id)??[]),{status:String(row.toStatus) as PublicEvent['status'],at:String(row.changedAt)}]);
    }
    const sources=new Map<string,Set<string>>();
    for(const r of store.db.prepare('SELECT opportunityId,sourceUrl FROM opportunity_sources').all()){try{const host=new URL(String(r.sourceUrl)).hostname,id=String(r.opportunityId);if(!sources.has(id))sources.set(id,new Set());sources.get(id)!.add(host);}catch{}}
    const window=store.newWindow();
    const rows=store.list().map(o=>({o,e:evaluate(o,profile,Date.parse(now))})).filter(({o,e})=>
      includeUnrecommended||o.status==='SAVED'||o.appliedAt||['APPLIED','INTERVIEW','REJECTED','OFFER','WITHDRAWN'].includes(o.status)||(!e.filtered.length&&e.matchScore>=profile.minimumMatch&&['NEW','SAVED','OPENED'].includes(o.status)))
      .sort((a,b)=>b.e.rankScore-a.e.rankScore||a.o.id.localeCompare(b.o.id));
    const opportunities:PublicOpportunity[]=rows.map(({o,e})=>({
      // Explicit allowlist. Never spread the database object or its raw payload.
      id:o.id,title:safeText(o.title,180),company:safeText(o.companyOrClient,140),location:safeText(o.location,180),
      type:o.type,status:(o.status==='OPENED'?'NEW':o.status) as PublicStatus,
      confidence:e.confidence,availability:o.availability??(o.closed?'CLOSED':'ACTIVE'),
      recommended:!e.filtered.length&&e.matchScore>=profile.minimumMatch,
      newSinceSearch:!!window&&o.firstSeenAt>=window.from&&o.firstSeenAt<=window.to,
      intelligence:{reasons:e.reasons.map(r=>safeText(r,400)),exclusions:[...e.filtered,...(e.matchScore<profile.minimumMatch?[`Below recommendation threshold (${profile.minimumMatch})`]:[])].map(r=>safeText(r,250)),confidenceReasons:(e.confidenceReasons??[]).map(r=>safeText(r,200)),required:(e.requirements?.required??[]).map(s=>safeText(s,50)),preferred:(e.requirements?.preferred??[]).map(s=>safeText(s,50)),missingRequired:(e.requirements?.required??[]).filter(s=>!e.matched.includes(s)).map(s=>safeText(s,50)),education:(e.requirements?.education??[]).map(s=>safeText(s,100)),availabilityReason:safeText(o.availabilityReason??'Availability not independently checked',250)},
      matchScore:e.matchScore,description:safeText(o.description),freshness:e.freshness,
      ...(o.postedAt?{postedAt:o.postedAt}:{}),...(o.appliedAt?{appliedAt:o.appliedAt}:{}),...(o.interviewAt?{interviewAt:o.interviewAt}:{}),
      ...(publicUrl(o.canonicalUrl)?{applicationUrl:publicUrl(o.canonicalUrl)}:{}),
      source:[...(sources.get(o.id)??[])].join(', '),
      skills:e.matched.slice(0,8).map(s=>safeText(s,50)),
      history:events.get(o.id)??[],
      remoteType:safeText(o.remoteType,40),
      jobSkills:o.skills.map(s=>safeText(s,50)),
      roleFamilies:Object.entries(families).filter(([,f])=>f.titles.some(t=>contains(o.title,t))).map(([name])=>name),
      remoteScope:indiaLocation(o).remoteEligibility==='GLOBAL_ALLOWED'?'global':indiaLocation(o).remoteEligibility==='REGION_ALLOWED'?'regional':indiaLocation(o).remoteEligibility==='INDIA_ALLOWED'?'india':'unknown',
      ...(facts.has(o.id)?{applicationFacts:facts.get(o.id)}:{}),
    }));
    const snapshot:PublicSnapshot={schemaVersion:1,exportedAt:now,opportunities,timeZone:process.env.JOB_AGENT_TIME_ZONE??Intl.DateTimeFormat().resolvedOptions().timeZone,totalDiscovered:store.list().length,...(includeUnrecommended&&profile.dailyApplicationTarget?{dailyApplicationTarget:profile.dailyApplicationTarget}:{})};validateSnapshot(snapshot);return snapshot;
  }
  write(store:Store,profile:Profile,path:string):{changed:boolean;count:number} {
    const snapshot=this.snapshot(store,profile);
    try{const old=JSON.parse(readFileSync(path,'utf8'));validateSnapshot(old);if(old.timeZone===snapshot.timeZone&&old.totalDiscovered===snapshot.totalDiscovered&&old.exportedAt.slice(0,10)===snapshot.exportedAt.slice(0,10)&&JSON.stringify(old.opportunities)===JSON.stringify(snapshot.opportunities))return {changed:false,count:snapshot.opportunities.length};}catch{}
    mkdirSync(dirname(path),{recursive:true});const temp=`${path}.${process.pid}.tmp`;
    writeFileSync(temp,JSON.stringify(snapshot,null,2)+'\n',{mode:0o600});renameSync(temp,path);
    return {changed:true,count:snapshot.opportunities.length};
  }
}
