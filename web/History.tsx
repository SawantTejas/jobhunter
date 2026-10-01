import {useState} from 'react';
import type {Analytics} from './analytics.ts';
import {shiftDay} from './analytics.ts';
export function History({data}:{data:Analytics}){
  const [month,setMonth]=useState(data.today.slice(0,7)),[selected,setSelected]=useState(data.today);
  const first=month+'-01',offset=(new Date(first+'T12:00:00Z').getUTCDay()+6)%7;
  const cells=Array.from({length:42},(_,i)=>shiftDay(first,i-offset));
  const jobs=data.daily.get(selected)??[];
  const move=(n:number)=>{const d=new Date(first+'T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+n);setMonth(d.toISOString().slice(0,7));};
  return <section><div className="section-heading"><h2>Application history</h2><span className="muted">Dates in {data.timeZone}</span></div>
    <div className="calendar-controls"><button className="secondary" aria-label="Previous month" onClick={()=>move(-1)}>←</button><label>Month <input type="month" value={month} onChange={e=>{if(/^\d{4}-\d{2}$/.test(e.target.value))setMonth(e.target.value);}}/></label><button className="secondary" aria-label="Next month" onClick={()=>move(1)}>→</button><button className="secondary" onClick={()=>{setMonth(data.today.slice(0,7));setSelected(data.today);}}>Today</button></div>
    <div className="calendar">{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=><div className="weekday" key={d}>{d}</div>)}{cells.map(day=>{const count=data.daily.get(day)?.length??0;return <button key={day} className={`calendar-day heat-${Math.min(4,count===0?0:Math.ceil(count/3))} ${day.slice(0,7)!==month?'outside':''} ${day===selected?'selected':''}`} aria-pressed={day===selected} aria-label={`${day}: ${count} applications`} onClick={()=>setSelected(day)}><strong>{Number(day.slice(-2))}</strong><span>{count} <span className="calendar-word">applications</span></span></button>;})}</div>
    <p className="muted">Darker cells mean more applications: 0 · 1–3 · 4–6 · 7–9 · 10+. Counts reflect recorded applications, not targets.</p>
    <h3>{selected} — {jobs.length} applications</h3>
    {!jobs.length?<p>No recorded applications on this date.</p>:<div className="table-scroll"><table><thead><tr><th>Company / role</th><th>Location</th><th>Type</th><th>Current status</th><th>Match</th><th>Link</th></tr></thead><tbody>{jobs.map(j=><tr key={j.id}><td><strong>{j.company}</strong><br/>{j.title}</td><td>{j.location}</td><td>{j.type}</td><td>{j.status}</td><td>{j.matchScore}%</td><td>{j.applicationUrl&&<a href={j.applicationUrl} target="_blank" rel="noopener noreferrer">Original job ↗</a>}</td></tr>)}</tbody></table></div>}
    {data.unknownDates>0&&<p className="muted">{data.unknownDates} applications have no recorded application date and cannot be placed on the calendar.</p>}
  </section>;
}
