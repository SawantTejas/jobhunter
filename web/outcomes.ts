import type {PublicOpportunity} from '../shared/public-model.ts';
import {applicationDate,dayKey,reached,shiftDay,type Analytics} from './analytics.ts';
import {locationTags} from './locations.ts';
export interface Cohort {name:string;applications:number;interviews:number;rate:number}
export function cohorts(jobs:PublicOpportunity[],group:(j:PublicOpportunity)=>string[]):Cohort[]{
  const groups=new Map<string,PublicOpportunity[]>();for(const j of jobs)for(const name of new Set(group(j))){groups.set(name,[...(groups.get(name)??[]),j]);}
  return [...groups].map(([name,rows])=>({name,applications:rows.length,interviews:rows.filter(j=>reached(j,'INTERVIEW')).length,rate:100*rows.filter(j=>reached(j,'INTERVIEW')).length/rows.length})).sort((a,b)=>b.applications-a.applications||a.name.localeCompare(b.name));
}
export function skillsFor(job:PublicOpportunity):string[]{return job.applicationFacts?.skills??job.jobSkills??job.skills;}
export function primaryFamily(j:PublicOpportunity):string{
  const f=j.roleFamilies??[];for(const name of ['fullstack','backend','frontend','mobile','desktop','data','devops','software'])if(f.includes(name))return name;
  const title=j.title.toLowerCase();for(const [pattern,name] of [[/full[ -]?stack/,'Full stack'],[/backend|back end|php|laravel|api developer/,'Backend'],[/frontend|front end/,'Frontend'],[/android|ios|mobile|xamarin/,'Mobile'],[/software|developer|engineer/,'Software']] as [RegExp,string][])if(pattern.test(title))return name;
  return 'Other / unclassified';
}
export function outcomeLocation(j:PublicOpportunity):string{const tags=locationTags(j);return tags.find(t=>!['Remote','Other India','Remote India','Global Remote'].includes(t))??(tags.includes('Global Remote')?'Global Remote':tags.includes('Remote India')?'Remote India':tags.includes('Other India')?'Other India':'Other / unknown');}
export function scoreBucket(j:PublicOpportunity):string{const score=j.applicationFacts?.matchScore??j.matchScore;return score<50?'0–49%':score>=90?'90–100%':`${Math.floor(score/10)*10}–${Math.floor(score/10)*10+9}%`;}
export function appliedFreshness(j:PublicOpportunity):string{
  const applied=applicationDate(j),posted=j.applicationFacts?j.applicationFacts.postedAt:j.postedAt;
  if(!applied||!posted)return 'Unknown';const days=(Date.parse(applied)-Date.parse(posted))/86400000;
  if(days<0)return 'Unknown (reposted / conflicting dates)';
  return days<1?'< 1 day':days<3?'1–3 days':days<8?'3–7 days':days<31?'8–30 days':'31+ days';
}
export function cumulativeSeries(a:Analytics,period:number|'all'):{day:string;applications:number;interviews:number}[]{
  const interviewDates=a.applications.flatMap(j=>{const at=j.interviewAt??j.history?.find(e=>e.status==='INTERVIEW')?.at;return at?[dayKey(at,a.timeZone)]:[];});
  const first=[...a.days,...interviewDates.filter(d=>d<=a.today)].sort()[0]??a.today;
  const start=period==='all'?first:shiftDay(a.today,1-period);let applications=0,interviews=0;const result=[];
  for(const [day,jobs] of a.daily)if(day<start)applications+=jobs.length;for(const day of interviewDates)if(day<start)interviews++;
  const counts=new Map<string,number>();for(const day of interviewDates)counts.set(day,(counts.get(day)??0)+1);
  for(let day=start;day<=a.today;day=shiftDay(day,1)){applications+=a.daily.get(day)?.length??0;interviews+=counts.get(day)??0;result.push({day,applications,interviews});}return result;
}
