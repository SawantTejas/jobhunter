import type { Opportunity } from '../model.ts';
import { contains, key } from '../normalization/index.ts';
const cities = [
  ['Mumbai','Navi Mumbai','Bombay','Thane'], ['Bengaluru','Bangalore'], ['Pune'], ['Hyderabad','Secunderabad'],
];
const otherIndia = ['India','Chennai','Delhi','New Delhi','Noida','Gurugram','Gurgaon','Kolkata','Ahmedabad','Jaipur','Indore','Kochi','Cochin','Coimbatore','Chandigarh','Mohali','Surat','Nagpur','Vadodara','Bhubaneswar','Lucknow','Thiruvananthapuram','Trivandrum','Mysore','Mysuru','Mangalore','Mangaluru','Visakhapatnam','Vijayawada','Nashik','Karnataka','Maharashtra','Telangana','Tamil Nadu','Kerala','Gujarat'];
export function locationKey(value:string):string {
  return key(value).replace(/\bbangalore\b/g,'bengaluru').replace(/\bbombay\b/g,'mumbai').replace(/\bgurgaon\b/g,'gurugram').replace(/\s+/g,' ').trim();
}
export function indiaLocation(o:Opportunity):{eligible:boolean; score:number; reason:string} {
  const location=locationKey(o.location);
  const remote=o.remoteType==='remote'||contains(location,'remote');
  const indiaExcluded=/\b(?:excluding|except|not (?:available|open) (?:in|to (?:applicants from|candidates from)))\s+india\b|\bindia(?:n applicants|n candidates)?\s+(?:is |are )?(?:not eligible|not supported|excluded)\b/i.test(o.location+' '+o.description);
  if(indiaExcluded)return {eligible:false,score:0,reason:'Listing explicitly excludes applicants from India'};
  const restricted=/\b(?:us|usa|united states|uk|united kingdom|europe|eu|canada|australia)\s*(?:residents?\s*)?only\b/i.test(o.location+' '+o.description)
    || /\b(?:must|need to|required to)\s+(?:be\s+)?(?:based|reside|live|located)\s+in\s+(?:the\s+)?(?:us|usa|united states|uk|united kingdom|canada|europe|australia)\b/i.test(o.description);
  const explicitIndiaRemote=/\bremote\s*(?:[-–:,/()]|from|within|in|across|based in|available in)*\s*india\b|\bindia\s*[-–:,/()]*\s*remote\b/i.test(o.location+' '+o.description)
    || /\b(?:applicants|candidates|applications)\s+from\s+india\s+(?:are\s+)?(?:welcome|eligible|accepted)\b/i.test(o.description);
  const rank=cities.findIndex(group=>group.some(city=>contains(location,city)));
  const domestic=rank>=0||otherIndia.some(city=>contains(location,city));
  if(restricted)return {eligible:false,score:0,reason:'Explicit foreign residency restriction; India eligibility not confirmed'};
  if(domestic){
    if(remote)return {eligible:true,score:78,reason:'Remote India — verify timezone and residency details'};
    return {eligible:true,score:rank>=0?[100,94,88,82][rank]:65,reason:rank>=0?`India city priority ${rank+1}: ${cities[rank][0]}`:'Other Indian location'};
  }
  if(explicitIndiaRemote)return {eligible:true,score:78,reason:'Explicitly accepts remote applicants from India'};
  const worldwide=/\b(worldwide|anywhere in the world|all countries|global remote)\b/i.test(o.location)||/^anywhere$/i.test(o.location.trim());
  if(o.type==='FREELANCE'&&worldwide)return {eligible:true,score:78,reason:'Freelance project explicitly open worldwide; verify client conditions'};
  return {eligible:false,score:0,reason:worldwide?'Worldwide employment listing; explicit India eligibility not provided':o.location?'No confirmed Indian work location or remote India eligibility':'Location and India eligibility unknown'};
}
