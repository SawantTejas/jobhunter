import type { PublicOpportunity,PublicSnapshot,PublicEvent } from '../shared/public-model.ts';
export const outcomeStatuses=['APPLIED','INTERVIEW','REJECTED','OFFER','WITHDRAWN'] as const;
export function reached(job:PublicOpportunity,status:PublicEvent['status']):boolean {
  return job.status===status||!!job.history?.some(e=>e.status===status)||(status==='INTERVIEW'&&!!job.interviewAt)||(status==='APPLIED'&&(!!job.appliedAt||outcomeStatuses.includes(job.status as typeof outcomeStatuses[number])));
}
export function applicationDate(job:PublicOpportunity):string|undefined {return job.appliedAt??job.history?.find(e=>e.status==='APPLIED')?.at;}
export function isApplication(job:PublicOpportunity):boolean {return !!applicationDate(job)||reached(job,'APPLIED');}
export function dayKey(timestamp:string,timeZone:string):string {
  const parts=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(timestamp));
  const part=(type:string)=>parts.find(p=>p.type===type)!.value;return `${part('year')}-${part('month')}-${part('day')}`;
}
// Calendar arithmetic on date-only keys: never add 24 hours to local instants across DST.
export function shiftDay(day:string,offset:number):string {const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);}
export function weekStart(day:string):string {return shiftDay(day,-((new Date(day+'T12:00:00Z').getUTCDay()+6)%7));}
export function locationGroup(location:string,remoteType=''):string {
  const s=location.toLowerCase();if(/\b(mumbai|navi mumbai|bombay|thane)\b/.test(s))return 'Mumbai / Navi Mumbai';
  if(/\b(bengaluru|bangalore)\b/.test(s))return 'Bengaluru';if(/\bpune\b/.test(s))return 'Pune';if(/\bhyderabad\b/.test(s))return 'Hyderabad';
  if((/\bremote\b/.test(s)||remoteType.toLowerCase()==='remote')&&/\bindia\b/.test(s))return 'Remote India';return 'Other';
}
export function sourceGroup(job:PublicOpportunity):string {
  // One source per application, attributed to the canonical application link.
  let host='';try{host=new URL(job.applicationUrl??'').hostname.toLowerCase();}catch{}
  if(!host)host=(job.source??'').split(',')[0].trim().toLowerCase();
  for(const [needle,label] of [['greenhouse','Greenhouse'],['lever.co','Lever'],['ashbyhq','Ashby'],['smartrecruiters','SmartRecruiters'],['myworkdayjobs','Workday'],['naukri','Naukri'],['linkedin','LinkedIn'],['indeed','Indeed'],['wellfound','Wellfound'],['himalayas','Himalayas'],['remotive','Remotive'],['jobicy','Jobicy'],['upwork','Upwork'],['freelancer','Freelancer'],['cutshort','Cutshort'],['instahyre','Instahyre'],['foundit','Foundit'],['hirist','Hirist'],['shine.com','Shine'],['timesjobs','TimesJobs'],['internshala','Internshala']])if(host.includes(needle))return label;
  return host?'Company Careers / Other':'Unknown';
}
export function distribution(jobs:PublicOpportunity[],group:(j:PublicOpportunity)=>string):[string,number][] {
  const counts=new Map<string,number>();for(const job of jobs){const key=group(job);counts.set(key,(counts.get(key)??0)+1);}return [...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
}
export function statusDistribution(jobs:PublicOpportunity[]):[string,number][] {
  const statuses=[...new Set<string>([...outcomeStatuses,...jobs.map(j=>j.status)])];
  return statuses.map(status=>[status.toLowerCase(),jobs.filter(j=>j.status===status).length]);
}
export function analytics(snapshot:PublicSnapshot,now=new Date().toISOString()){
  const timeZone=snapshot.timeZone??'Asia/Kolkata',today=dayKey(now,timeZone);
  const applications=snapshot.opportunities.filter(isApplication),daily=new Map<string,PublicOpportunity[]>();let unknownDates=0,futureDates=0;
  for(const job of applications){const at=applicationDate(job);if(!at){unknownDates++;continue;}const key=dayKey(at,timeZone);if(key>today){futureDates++;continue;}daily.set(key,[...(daily.get(key)??[]),job]);}
  const days=[...daily.keys()].sort();let longest=0,run=0,last='';for(const day of days){run=last&&shiftDay(last,1)===day?run+1:1;longest=Math.max(longest,run);last=day;}
  let current=0,cursor=daily.has(today)?today:shiftDay(today,-1);while(daily.has(cursor)){current++;cursor=shiftDay(cursor,-1);}
  const sum=(from:string,to:string)=>[...daily].reduce((n,[day,jobs])=>n+(day>=from&&day<=to?jobs.length:0),0);
  const week=weekStart(today),previousStart=shiftDay(week,-7),previousEnd=shiftDay(today,-7);
  const thisWeek=sum(week,today),previousComparable=sum(previousStart,previousEnd),previousWeek=sum(previousStart,shiftDay(week,-1));
  const interviews=applications.filter(j=>reached(j,'INTERVIEW')).length,offers=applications.filter(j=>reached(j,'OFFER')).length;
  const trend=previousComparable?100*(thisWeek-previousComparable)/previousComparable:null;
  return {timeZone,today,applications,daily,days,unknownDates,futureDates,longest,current,thisWeek,previousWeek,previousComparable,trend,
    todayCount:daily.get(today)?.length??0,thisMonth:sum(today.slice(0,7)+'-01',today),interviews,offers,
    rejected:applications.filter(j=>j.status==='REJECTED').length,
    conversion:applications.length?100*interviews/applications.length:null,
    average:days.length?[...daily.values()].reduce((n,j)=>n+j.length,0)/days.length:0};
}
export type Analytics=ReturnType<typeof analytics>;
export function timeSeries(a:Analytics,period:number|'all'):[string,number][] {
  const start=period==='all'?(a.days[0]??a.today):shiftDay(a.today,1-period),result:[string,number][]=[];
  for(let d=start;d<=a.today;d=shiftDay(d,1))result.push([d,a.daily.get(d)?.length??0]);return result;
}
