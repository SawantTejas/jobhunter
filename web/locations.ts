import type {PublicOpportunity} from '../shared/public-model.ts';
export const locationOptions=['All','Mumbai','Navi Mumbai','Pune','Bengaluru','Hyderabad','Remote','Other India','Remote India','Global Remote'];
export function locationTags(job:Pick<PublicOpportunity,'location'|'remoteType'|'remoteScope'>):string[]{
  const s=job.location.toLowerCase(),tags:string[]=[];
  if(/\bnavi mumbai\b/.test(s))tags.push('Navi Mumbai');else if(/\b(mumbai|bombay|thane)\b/.test(s))tags.push('Mumbai');
  if(/\b(bangalore|bengaluru)\b/.test(s))tags.push('Bengaluru');if(/\bpune\b/.test(s))tags.push('Pune');if(/\b(hyderabad|secunderabad)\b/.test(s))tags.push('Hyderabad');
  const domestic=/\b(india|chennai|delhi|noida|gurugram|gurgaon|kolkata|jaipur|ahmedabad|indore|kochi|coimbatore|chandigarh|mohali|nagpur|surat)\b/.test(s);
  if(!tags.length&&domestic)tags.push('Other India');
  if(job.remoteType==='remote'||/\bremote\b/.test(s)||['india','global','regional'].includes(job.remoteScope??'')){
    tags.push('Remote');if(job.remoteScope==='india'||domestic)tags.push('Remote India');else if(['global','regional'].includes(job.remoteScope??'')||/\b(worldwide|global|apac|asia|anywhere)\b/.test(s))tags.push('Global Remote');
  }return tags;
}
