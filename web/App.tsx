import { useEffect,useState } from 'react';
import type { PublicOpportunity,PublicSnapshot,PublicStatus } from '../shared/public-model.ts';
import type { OpportunityRepository } from './repositories/OpportunityRepository.ts';
import {analytics} from './analytics.ts';
import {Overview,AnalyticsView} from './AnalyticsView.tsx';
import {History} from './History.tsx';
import {downloadCsv} from './csv.ts';
import {locationOptions,locationTags} from './locations.ts';
type Tab='opportunities'|'applied'|'interviews'|'history'|'analytics';
const tabs:Tab[]=['opportunities','applied','interviews','history','analytics'];
const labels:Record<Tab,string>={opportunities:'Opportunities',applied:'Applied',interviews:'Interviews',history:'Calendar / History',analytics:'Analytics'};
const tabFor=(status:PublicStatus):Tab=>status==='INTERVIEW'?'interviews':['NEW','SAVED'].includes(status)?'opportunities':'applied';
export function App({repository}:{repository:OpportunityRepository}){
  const [snapshot,setSnapshot]=useState<PublicSnapshot|null>(null),[tab,setTab]=useState<Tab>('opportunities');
  const [query,setQuery]=useState(''),[kind,setKind]=useState('ALL'),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [location,setLocation]=useState('All');
  const [now,setNow]=useState(()=>new Date().toISOString());
  useEffect(()=>{const timer=setInterval(()=>setNow(new Date().toISOString()),60000);return ()=>clearInterval(timer);},[]);
  async function refresh(){setBusy(true);setError('');try{setSnapshot(await repository.list());}catch(e){setError(String(e instanceof Error?e.message:e));}finally{setBusy(false);}}
  useEffect(()=>{void refresh();},[repository]);
  async function update(job:PublicOpportunity,status:PublicStatus){
    setBusy(true);setError('');setNotice('');try{setSnapshot(await repository.updateStatus(job.id,status));setTab(tabFor(status));setNotice(`${job.title}: ${status.toLowerCase()}. Saved locally; publish when ready to share.`);}catch(e){setError(String(e instanceof Error?e.message:e));}finally{setBusy(false);}
  }
  async function publish(){setBusy(true);setError('');setNotice('Publishing dashboard…');try{await repository.publish();setNotice('Public data pushed to GitHub. Vercel will deploy it through your Git integration.');}catch(e){setNotice('');setError(String(e instanceof Error?e.message:e));}finally{setBusy(false);}}
  const jobs=snapshot?.opportunities??[];
  const data=snapshot?analytics(snapshot,now):null;
  const feed=['opportunities','applied','interviews'].includes(tab);
  const date=(value?:string)=>value?new Date(value).toLocaleDateString(undefined,{timeZone:data?.timeZone??'Asia/Kolkata',day:'numeric',month:'short',year:'numeric'}):'Not recorded';
  const visible=jobs.filter(j=>tabFor(j.status)===tab&&(kind==='ALL'||j.type===kind)&&(location==='All'||locationTags(j).includes(location))&&`${j.title} ${j.company} ${j.location} ${(j.jobSkills??j.skills).join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  return <main>
    <header><div><p className="eyebrow">JOBHUNTER</p><h1>Opportunities & progress</h1><p className="muted">{repository.editable?'Your local dashboard. Changes are saved on this laptop.':'A shared view of current opportunities and application progress.'}</p></div>
      <div className="header-actions"><span className="mode">{repository.editable?'Local · editable':'Public · read only'}</span>{repository.editable&&<button disabled={busy} onClick={()=>void publish()}>Publish Dashboard</button>}</div>
    </header>
    <nav aria-label="Application stages">{tabs.map(t=><button key={t} className={tab===t?'tab active':'tab'} aria-pressed={tab===t} onClick={()=>setTab(t)}>{['opportunities','applied','interviews'].includes(t)&&<strong>{jobs.filter(j=>tabFor(j.status)===t).length}</strong>} {labels[t]}</button>)}</nav>
    {data&&tab==='opportunities'&&<Overview data={data}/>}
    <section className="toolbar no-print" aria-label="Dashboard controls">{feed&&<><input aria-label="Search opportunities" placeholder="Search title, company, location or skill" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Opportunity type" value={kind} onChange={e=>setKind(e.target.value)}><option value="ALL">All types</option><option value="EMPLOYMENT">Employment</option><option value="CONTRACT">Contract</option><option value="FREELANCE">Freelance</option></select><select aria-label="Location filter" value={location} onChange={e=>setLocation(e.target.value)}>{locationOptions.map(l=><option key={l}>{l}</option>)}</select></>}<button className="secondary" disabled={busy} onClick={()=>void refresh()}>Refresh</button>{data&&<button className="secondary" onClick={()=>downloadCsv(jobs,data.today)}>Export CSV</button>}</section>
    {error&&<p className="error" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
    {data&&snapshot&&tab==='analytics'&&<AnalyticsView snapshot={snapshot} data={data}/>}
    {data&&tab==='history'&&<History data={data}/>}
    {feed&&<div className="section-heading"><h2>{labels[tab]}</h2><span className="muted">{visible.length} shown{snapshot&&` · ${repository.editable?'Loaded':'Published'} ${date(snapshot.exportedAt)}`}</span></div>}
    {!snapshot&&!error&&<p role="status">Loading opportunities…</p>}
    {feed&&snapshot&&!visible.length&&<section className="empty"><h3>{query||kind!=='ALL'?'No matches for these filters':`No ${labels[tab].toLowerCase()} yet`}</h3><p>{tab==='opportunities'?'Discover locally and publish to update this feed.':repository.editable?'Update a job’s status when you reach this stage.':'Progress will appear after the next dashboard publication.'}</p></section>}
    {feed&&<section className="cards" aria-label={labels[tab]}>{visible.map(job=><article key={job.id}>
      <div className="card-top"><span className="type">{job.type.toLowerCase()}</span>{tab==='opportunities'?<span className="score">{job.matchScore}% match</span>:<span className="type">{job.status.toLowerCase()}</span>}</div>
      <h3>{job.title}</h3><p className="company">{job.company}</p><p className="muted">{job.location||'Location not specified'}</p>
      {tab==='opportunities'?<><p className="freshness">{job.freshness}{job.postedAt&&` · ${date(job.postedAt)}`}</p><p className="description">{job.description}</p><div className="skills" aria-label="Matched skills">{job.skills.map(skill=><span key={skill}>{skill}</span>)}</div></>:<dl><div><dt>Applied</dt><dd>{date(job.appliedAt)}</dd></div>{job.status==='INTERVIEW'&&<div><dt>Interview stage since</dt><dd>{date(job.interviewAt)}</dd></div>}</dl>}
      {job.source&&<p className="source">Source: {job.source}</p>}
      <div className="actions">{job.applicationUrl&&<a className="button secondary" href={job.applicationUrl} target="_blank" rel="noopener noreferrer">{tab==='opportunities'?'Apply ↗':'Original job ↗'}</a>}
        {repository.editable&&tab==='opportunities'&&<button disabled={busy} onClick={()=>void update(job,'APPLIED')}>Mark Applied</button>}
        {repository.editable&&job.status==='APPLIED'&&<button disabled={busy} onClick={()=>void update(job,'INTERVIEW')}>Mark Interview</button>}
      </div>
      {repository.editable&&<label className="status-control">Update status <select aria-label={`Status for ${job.title}`} disabled={busy} value={job.status} onChange={e=>void update(job,e.target.value as PublicStatus)}><option value="NEW">New</option><option value="SAVED">Saved</option><option value="APPLIED">Applied</option>{(['APPLIED','INTERVIEW','REJECTED','OFFER','WITHDRAWN'].includes(job.status)||job.appliedAt)&&<><option value="INTERVIEW">Interview</option><option value="REJECTED">Rejected</option><option value="OFFER">Offer</option><option value="WITHDRAWN">Withdrawn</option></>}{job.status==='IGNORED'&&<option value="IGNORED">Ignored</option>}</select></label>}
    </article>)}</section>}
    <footer>{repository.editable?'Status changes stay local until you publish. Apply opens the employer website; JobHunter never submits an application.':'Read-only snapshot. Posting dates and availability come from the original sources.'}</footer>
  </main>;
}
