export type Confidence='HIGH'|'MEDIUM'|'LOW'|'UNKNOWN';
export interface ApplicationProfile {
  contact:{firstName?:string;lastName?:string;fullName?:string;email?:string;phone?:string;city?:string;country?:string;address?:string;postalCode?:string};
  links:{linkedin?:string;github?:string;portfolio?:string};
  workHistory:{company:string;title?:string;startDate?:string;endDate?:string;current?:boolean}[];
  education:{institution:string;qualification?:string;field?:string;startDate?:string;endDate?:string}[];
  experienceYears?:number;
  noticePeriod?:string; availableFrom?:string; currentCtc?:string; expectedCtc?:string;
  workAuthorization:Record<string,{authorized?:boolean;sponsorshipRequired?:boolean}>;
  relocation?:boolean;remotePreference?:string;skillYears:Record<string,number>;
  resumes:{id:string;label:string;path:string}[];defaultResumeId?:string;
}
export interface Field {
  id:string;label:string;name:string;placeholder:string;ariaLabel:string;nearby:string;
  type:string;tag:string;required:boolean;hasValue:boolean;
  options?:{value:string;label:string}[];
}
export interface Mapping {fieldId:string;concept?:string;confidence:Confidence;reason:string;value?:string;blocked?:boolean}
export interface DetectedField extends Field {pageUrl:string;mapping:Mapping}
export interface FilledField {id:string;pageUrl:string;concept?:string;filledAt:string}
