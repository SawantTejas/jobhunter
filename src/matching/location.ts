import type { Opportunity } from '../model.ts';
import { contains, key } from '../normalization/index.ts';
const cities = [
  ['Mumbai','Navi Mumbai','Bombay','Thane'], ['Bengaluru','Bangalore'], ['Pune'], ['Hyderabad','Secunderabad'],
];
const otherIndia = ['India','Chennai','Delhi','New Delhi','Noida','Gurugram','Gurgaon','Kolkata','Ahmedabad','Jaipur','Indore','Kochi','Cochin','Coimbatore','Chandigarh','Mohali','Surat','Nagpur','Vadodara','Bhubaneswar','Lucknow','Thiruvananthapuram','Trivandrum','Mysore','Mysuru','Mangalore','Mangaluru','Visakhapatnam','Vijayawada','Nashik','Karnataka','Maharashtra','Telangana','Tamil Nadu','Kerala','Gujarat'];
export function locationKey(value:string):string {
  return key(value).replace(/\bbangalore\b/g,'bengaluru').replace(/\bbombay\b/g,'mumbai').replace(/\bgurgaon\b/g,'gurugram').replace(/\s+/g,' ').trim();
}
export type RemoteEligibility='INDIA_ALLOWED'|'GLOBAL_ALLOWED'|'REGION_ALLOWED'|'INDIA_EXCLUDED'|'UNKNOWN';
export function indiaLocation(o:Opportunity):{eligible:boolean; score:number; reason:string; remoteEligibility?:RemoteEligibility} {
  const location=locationKey(o.location);
  const remote=o.remoteType==='remote'||contains(location,'remote');
  const indiaExcluded=/\b(?:excluding|except|not (?:available|open) (?:in|to (?:applicants from|candidates from)))\s+india\b|\bindia(?:n applicants|n candidates)?\s+(?:is |are )?(?:not eligible|not supported|excluded)\b/i.test(o.location+' '+o.description);
  if(indiaExcluded)return {eligible:false,score:0,remoteEligibility:'INDIA_EXCLUDED',reason:'Listing explicitly excludes applicants from India'};
  const foreign='(?:us|usa|united states|uk|united kingdom|europe|eu|canada|australia|singapore|japan|new zealand|philippines|indonesia|malaysia|vietnam|south korea|hong kong|china|taiwan|thailand)';
  const restricted=new RegExp(`\\b${foreign}\\s*[-–:]?\\s*(?:residents?\\s*)?only\\b`,'i').test(o.location+' '+o.description)
    || new RegExp(`\\b(?:must|need to|required to)\\s+(?:be\\s+)?(?:based|reside|live|located)\\s+in\\s+(?:the\\s+)?${foreign}\\b`,'i').test(o.description);
  const explicitIndiaRemote=/\bremote\s*(?:[-–:,/()]|from|within|in|across|based in|available in)*\s*india\b|\bindia\s*[-–:,/()]*\s*remote\b/i.test(o.location+' '+o.description)
    || /\b(?:applicants|candidates|applications)\s+from\s+india\s+(?:are\s+)?(?:welcome|eligible|accepted)\b/i.test(o.description);
  const rank=cities.findIndex(group=>group.some(city=>contains(location,city)));
  const domestic=rank>=0||otherIndia.some(city=>contains(location,city));
  if(restricted)return {eligible:false,score:0,remoteEligibility:'INDIA_EXCLUDED',reason:'Explicit foreign residency restriction; India eligibility not confirmed'};
  if(domestic){
    if(remote)return {eligible:true,score:78,remoteEligibility:'INDIA_ALLOWED',reason:'Remote India — verify timezone and residency details'};
    return {eligible:true,score:rank>=0?[100,94,88,82][rank]:65,reason:rank>=0?`India city priority ${rank+1}: ${cities[rank][0]}`:'Other Indian location'};
  }
  if(explicitIndiaRemote)return {eligible:true,score:78,remoteEligibility:'INDIA_ALLOWED',reason:'Explicitly accepts remote applicants from India'};
  const worldwide=/\b(worldwide|anywhere in the world|all countries|global remote)\b/i.test(o.location)||/^anywhere$/i.test(o.location.trim());
  const globalPermission=worldwide||/\b(?:work|apply|hire|hiring)\s+(?:remotely\s+)?(?:from\s+)?(?:anywhere in the world|worldwide)\b/i.test(o.description);
  const regional=/\b(?:apac|asia pacific|asia-pacific|asia|south asia)\b/i.test(o.location)&&! /\b(?:southeast|south east|east asia|central asia)\b/i.test(o.location);
  if((remote||o.type==='FREELANCE')&&globalPermission)return {eligible:true,score:76,remoteEligibility:'GLOBAL_ALLOWED',reason:'Worldwide remote — India included unless explicitly restricted'};
  if(remote&&regional)return {eligible:true,score:74,remoteEligibility:'REGION_ALLOWED',reason:'Asia/APAC remote — India-compatible region; verify timezone requirements'};
  if(remote){
    const foreignLocation=new RegExp(`\\b(?:${foreign}|germany|france|spain|italy|netherlands|ireland|poland|portugal|brazil|mexico|latam|latin america|north america|emea|southeast asia|south east asia|east asia|central asia|africa|middle east|oceania|ca|gb|au|nz|sg|jp|de|fr|es|it|nl|pl|london|new york|san francisco|toronto|berlin|indianapolis)\\b`,'i').test(location);
    if(foreignLocation)return {eligible:false,score:0,remoteEligibility:'INDIA_EXCLUDED',reason:'Remote location is restricted to a foreign geography; India eligibility not confirmed'};
    return {eligible:true,score:35,remoteEligibility:'UNKNOWN',reason:'Remote eligibility unknown — verify India eligibility before applying'};
  }
  return {eligible:false,score:0,reason:worldwide?'Worldwide employment listing; explicit India eligibility not provided':o.location?'No confirmed Indian work location or remote India eligibility':'Location and India eligibility unknown'};
}
