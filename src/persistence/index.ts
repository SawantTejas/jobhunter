import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Opportunity, RegistryEntry, Profile, Status } from '../model.ts';
import { similar,authority } from './dedup.ts';
import {normalize} from '../normalization/index.ts';
import {smartRecruitersRecord,obj} from '../sources/structured.ts';
export { similar } from './dedup.ts';
const fields=['id','type','title','companyOrClient','description','location','remoteType','employmentType','canonicalUrl','postedAt','updatedAt','dateKind','firstSeenAt','lastSeenAt','discoveredAt','experienceMin','experienceMax','budgetMin','budgetMax','currency','budgetUnit','status','closed','employerJobId','authority','appliedAt','interviewAt','statusUpdatedAt','partial','availability','availabilityReason','availabilityCheckedAt'] as const;
export class Store {
  db:DatabaseSync;
  private cached:Opportunity[]|undefined;
  private dataVersion:number|undefined;
  constructor(path:string){mkdirSync(dirname(path),{recursive:true});this.db=new DatabaseSync(path);this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS migrations(name TEXT PRIMARY KEY)');
    const dir=new URL('../../migrations/',import.meta.url);
    for(const file of readdirSync(dir).filter(x=>x.endsWith('.sql')).sort())if(!this.db.prepare('SELECT 1 FROM migrations WHERE name=?').get(file)) {
      // SQLite table rebuilds must disable FK enforcement outside the transaction.
      this.db.exec('PRAGMA foreign_keys=OFF; BEGIN');try{
        this.db.exec(readFileSync(new URL(file,dir),'utf8'));
        if(this.db.prepare('PRAGMA foreign_key_check').all().length)throw new Error(`Foreign-key violation in migration ${file}`);
        this.db.prepare('INSERT INTO migrations VALUES (?)').run(file);this.db.exec('COMMIT');
      }catch(e){this.db.exec('ROLLBACK');throw e;}finally{this.db.exec('PRAGMA foreign_keys=ON');}
    }
  }
  configure(profile:Profile,registry:RegistryEntry[]) {
    this.db.prepare('INSERT OR REPLACE INTO candidate_profile VALUES (1,?,?)').run(JSON.stringify(profile),new Date().toISOString());
    this.db.exec('UPDATE source_registry SET enabled=0');
    const q=this.db.prepare('INSERT OR REPLACE INTO source_registry VALUES (?,?,?,?,?)');for(const r of registry)q.run(r.id,r.adapter,r.company,r.board,Number(r.enabled));
  }
  list():Opportunity[] {
    const version=Number(this.db.prepare('PRAGMA data_version').get()?.data_version);
    if(this.dataVersion!==version){this.cached=undefined;this.dataVersion=version;}
    if(this.cached)return this.cached;
    const skills=new Map<string,string[]>();for(const row of this.db.prepare('SELECT * FROM opportunity_skills').all()){const id=String(row.opportunityId);skills.set(id,[...(skills.get(id)??[]),String(row.skill)]);}
    this.cached=this.db.prepare('SELECT o.*, s.source,s.externalId,s.sourceUrl FROM opportunities o JOIN opportunity_sources s ON s.rowid=(SELECT MIN(rowid) FROM opportunity_sources WHERE opportunityId=o.id)').all().map(r=>{
      const value=Object.fromEntries(Object.entries(r).map(([k,v])=>[k,v===null?undefined:v]));
      return {...value,requirements:r.requirementsJson?JSON.parse(String(r.requirementsJson)):undefined,partial:!!r.partial,closed:!!r.closed,skills:skills.get(String(r.id))??[]} as unknown as Opportunity;
    });
    return this.cached;
  }
  references(id:string){return this.db.prepare('SELECT source,externalId,sourceUrl,firstSeenAt,lastSeenAt FROM opportunity_sources WHERE opportunityId=?').all(id);}
  upsert(o:Opportunity):'new'|'known'|'merged' {
    const ref=this.db.prepare('SELECT opportunityId FROM opportunity_sources WHERE source=? AND externalId=?').get(o.source,o.externalId);
    const all=this.list();
    let candidates=all.filter(x=>x.id===ref?.opportunityId||x.canonicalUrl===o.canonicalUrl||((x.source!==o.source||new URL(x.sourceUrl).hostname!==new URL(o.sourceUrl).hostname)&&similar(x,o)));
    // An aggregator lacking a requisition must not bridge two known, different requisitions.
    const requisitions=(x:Opportunity)=>new Set([x.employerJobId,...this.db.prepare('SELECT requisitionId FROM opportunity_sources WHERE opportunityId=? AND requisitionId IS NOT NULL').all(x.id).map(r=>String(r.requisitionId))].filter(Boolean));
    const identity=o.employerJobId??(candidates.find(x=>x.id===ref?.opportunityId)?.employerJobId);
    if(identity)candidates=candidates.filter(x=>[...requisitions(x)].every(id=>id===identity));
    else if(new Set(candidates.flatMap(x=>[...requisitions(x)])).size>1){
      // Ambiguous copy: attach only to an existing exact reference/URL, never merge both openings.
      candidates=candidates.filter(x=>x.id===ref?.opportunityId||x.canonicalUrl===o.canonicalUrl).slice(0,1);
    }
    const existing=candidates.find(x=>x.id===ref?.opportunityId)??candidates[0];
    const result=existing?(ref?'known':'merged'):'new';
    const incoming=o;
    if(existing) {
      const preferred=[o,...candidates].sort((a,b)=>authority(b)-authority(a))[0];
      const statusPriority:Record<Status,number>={NEW:0,OPENED:1,SAVED:2,APPLIED:3,INTERVIEW:4,REJECTED:5,OFFER:6,WITHDRAWN:7,IGNORED:8};
      const status=[...candidates].sort((a,b)=>statusPriority[b.status]-statusPriority[a.status])[0].status;
      const dated=[...candidates,o].filter(x=>x.postedAt).sort((a,b)=>authority(b)-authority(a)||Date.parse(a.postedAt!)-Date.parse(b.postedAt!))[0];
      o={...preferred,id:existing.id,status,firstSeenAt:candidates.map(x=>x.firstSeenAt).sort()[0],discoveredAt:candidates.map(x=>x.discoveredAt).sort()[0],lastSeenAt:o.lastSeenAt,
        postedAt:dated?.postedAt,dateKind:dated?.dateKind,skills:preferred.skills,
        appliedAt:candidates.flatMap(x=>x.appliedAt?[x.appliedAt]:[]).sort()[0],interviewAt:candidates.flatMap(x=>x.interviewAt?[x.interviewAt]:[]).sort()[0],
        statusUpdatedAt:candidates.flatMap(x=>x.statusUpdatedAt?[x.statusUpdatedAt]:[]).sort().at(-1)};
      if(!o.description)o.description=existing.description;
    }
    this.db.exec('BEGIN');try {
      for(const duplicate of candidates.filter(x=>x.id!==o.id)){
        this.db.prepare('INSERT INTO application_facts SELECT ?,recordedAt,matchScore,postedAt,dateKind,skillsJson FROM application_facts WHERE opportunityId=? ON CONFLICT(opportunityId) DO UPDATE SET recordedAt=excluded.recordedAt,matchScore=excluded.matchScore,postedAt=excluded.postedAt,dateKind=excluded.dateKind,skillsJson=excluded.skillsJson WHERE excluded.recordedAt<application_facts.recordedAt').run(o.id,duplicate.id);
        this.db.prepare('UPDATE OR IGNORE availability_observations SET opportunityId=? WHERE opportunityId=?').run(o.id,duplicate.id);
        this.db.prepare('DELETE FROM application_facts WHERE opportunityId=?').run(duplicate.id);
        this.db.prepare('UPDATE application_sessions SET jobId=? WHERE jobId=?').run(o.id,duplicate.id);
        this.db.prepare('UPDATE opportunity_status_events SET opportunityId=? WHERE opportunityId=?').run(o.id,duplicate.id);
        this.db.prepare('UPDATE opportunity_sources SET opportunityId=? WHERE opportunityId=?').run(o.id,duplicate.id);
        this.db.prepare('INSERT OR IGNORE INTO ignored_opportunities SELECT ?,reason,ignoredAt FROM ignored_opportunities WHERE opportunityId=?').run(o.id,duplicate.id);
        this.db.prepare('DELETE FROM ignored_opportunities WHERE opportunityId=?').run(duplicate.id);
        this.db.prepare('DELETE FROM opportunity_skills WHERE opportunityId=?').run(duplicate.id);
        this.db.prepare('DELETE FROM opportunities WHERE id=?').run(duplicate.id);
      }
      const canonicalEvidence=incoming.canonicalUrl===o.canonicalUrl&&incoming.authority==='employer';
      o.availability=existing?.availability??'ACTIVE';o.availabilityReason=existing?.availabilityReason;o.availabilityCheckedAt=existing?.availabilityCheckedAt;
      if(canonicalEvidence||!existing||(incoming.canonicalUrl===o.canonicalUrl&&incoming.closed===true)){o.availability=o.closed?'CLOSED':'ACTIVE';o.availabilityReason=o.closed?'Source explicitly reported closed':'Listing returned by discovery';o.availabilityCheckedAt=incoming.lastSeenAt;}
      // An aggregator copy cannot reopen a canonically closed listing.
      if(o.availability==='CLOSED')o.closed=true;
      const values=fields.map(f=>f==='closed'||f==='partial'?Number(!!o[f]):o[f]??null);
      this.db.prepare(`INSERT INTO opportunities (${fields.join(',')}) VALUES (${fields.map(()=>'?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${fields.filter(f=>f!=='id').map(f=>`${f}=excluded.${f}`).join(',')}`).run(...values);
      this.db.prepare('UPDATE opportunities SET requirementsJson=? WHERE id=?').run(o.requirements?JSON.stringify(o.requirements):null,o.id);
      this.db.prepare('INSERT INTO opportunity_sources(source,externalId,opportunityId,sourceUrl,rawJson,firstSeenAt,lastSeenAt,requisitionId) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(source,externalId) DO UPDATE SET opportunityId=excluded.opportunityId,rawJson=excluded.rawJson,sourceUrl=excluded.sourceUrl,lastSeenAt=excluded.lastSeenAt,requisitionId=COALESCE(excluded.requisitionId,opportunity_sources.requisitionId)').run(incoming.source,incoming.externalId,o.id,incoming.sourceUrl,JSON.stringify(incoming.original??incoming),incoming.firstSeenAt,incoming.lastSeenAt,incoming.employerJobId??null);
      this.db.prepare('DELETE FROM opportunity_skills WHERE opportunityId=?').run(o.id);
      for(const s of o.skills){this.db.prepare('INSERT OR IGNORE INTO skills VALUES (?)').run(s);this.db.prepare('INSERT OR IGNORE INTO opportunity_skills VALUES (?,?)').run(o.id,s);}
      this.db.exec('COMMIT');
      if(existing){this.cached=all.filter(x=>!candidates.some(c=>c.id===x.id));this.cached.push(o);}else all.push(o);
      return result;
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  newWindow(){
    const runs=this.db.prepare("SELECT startedAt,finishedAt,summaryJson FROM search_runs WHERE finishedAt IS NOT NULL ORDER BY startedAt DESC").all().filter(r=>{try{return JSON.parse(String(r.summaryJson)).successful>0;}catch{return false;}}).slice(0,2);
    return runs.length?{from:runs[1]?String(runs[1].finishedAt):String(runs[0].startedAt),to:String(runs[0].finishedAt)}:undefined;
  }
  observeAvailability(id:string,evidence:'ACTIVE'|'CLOSED'|'NOT_FOUND'|'INACCESSIBLE',url:string,now=new Date().toISOString()){
    const job=this.list().find(o=>o.id===id);if(!job||job.canonicalUrl!==url)return;
    this.db.prepare('INSERT OR IGNORE INTO availability_observations(opportunityId,observedAt,evidence,url) VALUES (?,?,?,?)').run(id,now,evidence,url);
    const previous=this.db.prepare("SELECT observedAt FROM availability_observations WHERE opportunityId=? AND evidence='ACTIVE' ORDER BY observedAt DESC LIMIT 1").get(id);
    const since=[job.lastSeenAt,String(previous?.observedAt??'')].sort().at(-1)!;
    const observations=this.db.prepare('SELECT observedAt,evidence FROM availability_observations WHERE opportunityId=? AND observedAt>=? ORDER BY observedAt').all(id,since);
    const missing=observations.filter(r=>r.evidence==='NOT_FOUND');
    const inaccessible=observations.filter(r=>r.evidence==='INACCESSIBLE');
    const repeated=(rows:typeof observations)=>rows.length>=2&&Date.parse(String(rows.at(-1)!.observedAt))-Date.parse(String(rows[0].observedAt))>=86400000;
    let state=job.availability??'ACTIVE',reason=job.availabilityReason??'';
    if(evidence==='ACTIVE'){state='ACTIVE';reason='Canonical listing observed active';}
    else if(evidence==='CLOSED'){state='CLOSED';reason='Canonical source explicitly reports closure';}
    else if(state!=='CLOSED'&&evidence==='NOT_FOUND'){state=repeated(missing)?'CLOSED':'POSSIBLY_CLOSED';reason=repeated(missing)?'Canonical URL returned 404/410 on repeated checks at least 24 hours apart':'Canonical URL returned 404/410; awaiting confirmation';}
    else if(state!=='CLOSED'&&repeated(inaccessible)){state='INACCESSIBLE';reason='Repeated access failures; closure is not confirmed';}
    this.db.prepare('UPDATE opportunities SET availability=?,availabilityReason=?,availabilityCheckedAt=?,closed=? WHERE id=?').run(state,reason,now,Number(state==='CLOSED'),id);if(evidence==='ACTIVE')this.db.prepare('UPDATE opportunities SET lastSeenAt=? WHERE id=?').run(now,id);this.cached=undefined;
  }
  markStale(now=new Date().toISOString()){
    // Missing from a capped/paginated source is never closure evidence.
    const cutoff=new Date(Date.parse(now)-30*86400000).toISOString();
    this.db.prepare("UPDATE opportunities SET availability='STALE',availabilityReason='Not observed for 30 days; availability unverified' WHERE availability='ACTIVE' AND lastSeenAt<?").run(cutoff);this.cached=undefined;
  }
  repairRequisitionCollisions(){
    const collisions=this.db.prepare('SELECT opportunityId FROM opportunity_sources WHERE requisitionId IS NOT NULL GROUP BY opportunityId HAVING COUNT(DISTINCT requisitionId)>1').all();
    const repaired:string[]=[];
    for(const collision of collisions){
      const original=this.list().find(o=>o.id===collision.opportunityId);if(!original)continue;
      const refs=this.db.prepare('SELECT * FROM opportunity_sources WHERE opportunityId=? AND requisitionId IS NOT NULL ORDER BY rowid').all(original.id);
      const keeper=refs.find(r=>r.sourceUrl===original.canonicalUrl)??refs.find(r=>r.requisitionId===original.employerJobId)??refs[0];
      this.db.prepare('UPDATE opportunities SET employerJobId=? WHERE id=?').run(keeper.requisitionId,original.id);this.cached=undefined;
      for(const ref of refs.filter(r=>r.requisitionId!==keeper.requisitionId)){
        const raw=obj(JSON.parse(String(ref.rawJson)));if(!raw.refNumber||!raw.jobAd)continue; // Only repair reconstructable structured records.
        const entry={id:String(ref.source),adapter:'smartrecruiters',board:'',company:original.companyOrClient,enabled:true};
        const record=smartRecruitersRecord(raw,entry);record.sourceUrl=String(ref.sourceUrl);
        const incoming=normalize(record,String(ref.source));incoming.firstSeenAt=String(ref.firstSeenAt);incoming.discoveredAt=String(ref.firstSeenAt);incoming.lastSeenAt=String(ref.lastSeenAt);
        // Temporarily omit this conflicting ref from the old group; upsert reassigns it atomically.
        this.db.prepare('UPDATE opportunity_sources SET requisitionId=NULL WHERE source=? AND externalId=?').run(ref.source,ref.externalId);
        try{this.upsert(incoming);repaired.push(`${ref.source}:${ref.externalId}`);}catch(error){this.db.prepare('UPDATE opportunity_sources SET requisitionId=? WHERE source=? AND externalId=?').run(ref.requisitionId,ref.source,ref.externalId);throw error;}
      }
    }
    return repaired;
  }
  status(id:string,status:Status,reason?:string,now=new Date().toISOString(),matchScore?:number) {
    this.db.exec('BEGIN');try{
      if(!this.db.prepare('SELECT 1 FROM opportunity_statuses WHERE name=?').get(status))throw new Error('Unknown status');
      const previous=this.db.prepare('SELECT status,appliedAt,interviewAt FROM opportunities WHERE id=?').get(id);
      if(!previous)throw new Error('Unknown opportunity');
      if(previous.status===status){this.db.exec('COMMIT');return;}
      if(['INTERVIEW','REJECTED','OFFER','WITHDRAWN'].includes(status)&&!['APPLIED','INTERVIEW','REJECTED','OFFER','WITHDRAWN'].includes(String(previous.status))&&!previous.appliedAt)throw new Error('Mark Applied before recording an application outcome');
      const appliedAt=status==='APPLIED'?(previous.appliedAt??now):previous.appliedAt;
      const interviewAt=status==='INTERVIEW'?(previous.interviewAt??now):previous.interviewAt;
      if(status==='APPLIED'&&!previous.appliedAt){
        const facts=this.db.prepare('SELECT postedAt,dateKind FROM opportunities WHERE id=?').get(id)!;
        const skills=this.db.prepare('SELECT skill FROM opportunity_skills WHERE opportunityId=? ORDER BY skill').all(id).map(r=>String(r.skill));
        this.db.prepare('INSERT OR IGNORE INTO application_facts VALUES (?,?,?,?,?,?)').run(id,now,matchScore??null,facts.postedAt,facts.dateKind,JSON.stringify(skills));
      }
      this.db.prepare('UPDATE opportunities SET status=?,appliedAt=?,interviewAt=?,statusUpdatedAt=? WHERE id=?').run(status,appliedAt,interviewAt,now,id);
      this.db.prepare('INSERT INTO opportunity_status_events(opportunityId,fromStatus,toStatus,changedAt) VALUES (?,?,?,?)').run(id,String(previous.status),status,now);
      if(status==='IGNORED')this.db.prepare('INSERT OR REPLACE INTO ignored_opportunities VALUES (?,?,?)').run(id,reason??null,now);
      this.db.exec('COMMIT');
      this.cached=undefined;
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  close(){this.db.close();}
}
