import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import type {SearchResult} from './model.ts';
export type CandidateState='PENDING'|'INSPECTED'|'BLOCKED'|'FAILED'|'RETRYABLE';
export interface Candidate {url:string;queryId:string;depth:number;via?:string;metadata?:SearchResult}
export class CandidateQueue {
  db:DatabaseSync;
  constructor(path=':memory:'){
    if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});this.db=new DatabaseSync(path);
    this.db.exec(`PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS candidates(
      url TEXT PRIMARY KEY,domain TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'PENDING',
      firstSeen INTEGER NOT NULL,lastSeen INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,
      nextAttempt INTEGER NOT NULL DEFAULT 0,reason TEXT,result TEXT);
      CREATE INDEX IF NOT EXISTS candidates_due ON candidates(state,nextAttempt);
      CREATE TABLE IF NOT EXISTS domain_turns(domain TEXT PRIMARY KEY,lastTurn INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS queue_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
    if(!this.db.prepare('PRAGMA table_info(candidates)').all().some(r=>r.name==='inspectedAt'))this.db.exec('ALTER TABLE candidates ADD COLUMN inspectedAt INTEGER NOT NULL DEFAULT 0');
    if(!this.db.prepare('PRAGMA table_info(domain_turns)').all().some(r=>r.name==='lastPickNewest'))this.db.exec('ALTER TABLE domain_turns ADD COLUMN lastPickNewest INTEGER NOT NULL DEFAULT -1');
  }
  add(item:Candidate,now=Date.now()):boolean {
    const domain=new URL(item.url).hostname.replace(/^(www|in)\./,'');
    const result=this.db.prepare('INSERT OR IGNORE INTO candidates(url,domain,payload,firstSeen,lastSeen) VALUES (?,?,?,?,?)').run(item.url,domain,JSON.stringify(item),now,now);
    if(!result.changes){
      const old=this.db.prepare('SELECT payload,state,reason,inspectedAt FROM candidates WHERE url=?').get(item.url)!;
      const previous=JSON.parse(String(old.payload)) as Candidate;
      const changed=item.metadata&&JSON.stringify([item.metadata.title,item.metadata.content])!==JSON.stringify([previous.metadata?.title,previous.metadata?.content]);
      // Revisit changed metadata and linking pages after a week, not unchanged jobs
      // or access-blocked domains. Retain old terminal payloads until acknowledged.
      if(old.state==='INSPECTED'&&now-Number(old.inspectedAt)>=7*86400000&&(changed||old.reason==='listing-links-only'))this.db.prepare("UPDATE candidates SET state='PENDING',attempts=0,nextAttempt=0 WHERE url=? AND result IS NULL").run(item.url);
    }
    if(!result.changes)this.db.prepare('UPDATE candidates SET lastSeen=?,payload=CASE WHEN ? THEN ? ELSE payload END WHERE url=?').run(now,Number(!!item.metadata),JSON.stringify(item),item.url);
    return !!result.changes;
  }
  next(excluded:Set<string>,now=Date.now()):Candidate|undefined {
    const due=this.db.prepare(`SELECT c.*,COALESCE(d.lastTurn,0) AS turn,COALESCE(d.lastPickNewest,-1) AS lastPickNewest FROM candidates c LEFT JOIN domain_turns d ON d.domain=c.domain
      WHERE c.state IN ('PENDING','RETRYABLE') AND c.nextAttempt<=? ORDER BY turn,firstSeen,url`).all(now).filter(r=>!excluded.has(String(r.url)));
    if(!due.length)return;
    const domain=String(due[0].domain),rows=due.filter(r=>r.domain===domain);
    // Alternate newest and oldest within each domain, so a continuous stream cannot starve old work.
    const turn=Number(this.db.prepare('SELECT COALESCE(MAX(lastTurn),0) AS n FROM domain_turns').get()!.n)+1;
    const previous=Number(rows[0].lastPickNewest),newest=previous<0?turn%2===1:previous===0;
    const row=newest?rows.at(-1)!:rows[0];
    this.db.prepare('INSERT INTO domain_turns(domain,lastTurn,lastPickNewest) VALUES (?,?,?) ON CONFLICT(domain) DO UPDATE SET lastTurn=excluded.lastTurn,lastPickNewest=excluded.lastPickNewest').run(domain,turn,Number(newest));
    return JSON.parse(String(row.payload)) as Candidate;
  }
  finish(item:Candidate,state:CandidateState,reason:string,result?:unknown,now=Date.now()){
    const attempts=Number(this.db.prepare('SELECT attempts FROM candidates WHERE url=?').get(item.url)?.attempts??0)+1;
    if(state==='RETRYABLE'&&attempts>=3)state='FAILED';
    const next=state==='RETRYABLE'?now+Math.min(7*86400000,3600000*2**(attempts-1)):0;
    this.db.prepare('UPDATE candidates SET state=?,attempts=?,nextAttempt=?,reason=?,result=?,inspectedAt=? WHERE url=?').run(state,attempts,next,reason,result?JSON.stringify(result):null,now,item.url);
  }
  pending():Candidate[]{return this.db.prepare("SELECT payload FROM candidates WHERE state IN ('PENDING','RETRYABLE')").all().map(r=>JSON.parse(String(r.payload)));}
  states(){return Object.fromEntries(this.db.prepare('SELECT state,COUNT(*) AS n FROM candidates GROUP BY state').all().map(r=>[String(r.state),Number(r.n)]));}
  // Retain extracted payload until SQLite ingestion acknowledges it; a crash cannot lose completed work.
  outputs(){return this.db.prepare('SELECT url,result FROM candidates WHERE result IS NOT NULL').all();}
  acknowledge(){this.db.prepare('UPDATE candidates SET result=NULL WHERE result IS NOT NULL').run();}
  close(){this.db.close();}
}
export function failureKind(error:unknown):{kind:string;state:CandidateState}{
  const s=String(error);
  if(/disallows/.test(s))return {kind:'robots-disallowed',state:'BLOCKED'};
  if(/403/.test(s))return {kind:'http-403',state:'BLOCKED'};
  if(/401|Authentication|challenge|denial/.test(s))return {kind:'access-blocked',state:'BLOCKED'};
  if(/non-public|public HTTPS|redirect.*security|redirect limit/i.test(s))return {kind:'redirect-security-rejected',state:'BLOCKED'};
  if(/timeout|abort/i.test(s))return {kind:'timeout',state:'RETRYABLE'};
  if(/429|HTTP 5\d\d|ENOTFOUND|ECONN|Robots policy unavailable/i.test(s))return {kind:'transient-network',state:'RETRYABLE'};
  return {kind:'extraction-failure',state:'FAILED'};
}
