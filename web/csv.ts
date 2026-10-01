import type { PublicOpportunity } from '../shared/public-model.ts';
import { applicationDate,isApplication } from './analytics.ts';
export function csvCell(value:unknown):string {
  let s=String(value??'');
  // Excel formula injection protection, including formulas preceded by whitespace/control chars.
  if(/^[\s\u0000-\u001f]*[=+@-]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;
  return '"'+s.replace(/"/g,'""')+'"';
}
export function applicationCsv(jobs:PublicOpportunity[]):string {
  const rows:unknown[][]=[['Application ID','Company','Job Title','Location','Opportunity Type','Source','Match Score (current)','Posted Date','Applied Date','Interview Date','Current Status','Application URL']];
  for(const j of jobs.filter(isApplication))rows.push([j.id,j.company,j.title,j.location,j.type,j.source,j.matchScore,j.postedAt,applicationDate(j),j.interviewAt,j.status,j.applicationUrl]);
  return '\ufeff'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
export function downloadCsv(jobs:PublicOpportunity[],day:string){const url=URL.createObjectURL(new Blob([applicationCsv(jobs)],{type:'text/csv;charset=utf-8;'}));const a=document.createElement('a');a.href=url;a.download=`job-applications-${day}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
