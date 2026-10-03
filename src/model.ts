import type {Requirements} from './extraction/requirements.ts';
export type OpportunityType = 'EMPLOYMENT' | 'CONTRACT' | 'FREELANCE';
export type Status = 'NEW' | 'SAVED' | 'OPENED' | 'IGNORED' | 'APPLIED' | 'INTERVIEW' | 'REJECTED' | 'OFFER' | 'WITHDRAWN';
export interface RawOpportunity {
  externalId: string; title: string; companyOrClient: string; description: string;
  location?: string; remoteType?: string; employmentType?: string; type?: OpportunityType;
  sourceUrl: string; canonicalUrl?: string; postedAt?: string; updatedAt?: string;
  dateKind?: 'posted' | 'published' | 'date-only'; skills?: string[]; experienceMin?: number; experienceMax?: number;
  employerJobId?: string; authority?: 'employer' | 'aggregator' | 'import';
  budgetMin?: number; budgetMax?: number; currency?: string; budgetUnit?: 'project' | 'hour'; closed?: boolean;
  original?: unknown; requirements?:Requirements; partial?:boolean;
}
export interface Opportunity extends RawOpportunity {
  id: string; source: string; canonicalUrl: string; location: string; remoteType: string;
  employmentType: string; type: OpportunityType; skills: string[];
  firstSeenAt: string; lastSeenAt: string; discoveredAt: string; status: Status;
  availability?:'ACTIVE'|'POSSIBLY_CLOSED'|'CLOSED'|'STALE'|'INACCESSIBLE'; availabilityReason?:string; availabilityCheckedAt?:string;
  appliedAt?: string; interviewAt?: string; statusUpdatedAt?: string;
}
export interface RegistryEntry { id: string; adapter: string; company: string; board: string; enabled: boolean; maxPages?: number; maxDetails?: number; maxQueries?:number; detailOffset?:number }
export interface SourceContext { getJson(url: string, ttlMs?: number): Promise<unknown>; getText?(url:string,ttlMs?:number):Promise<string>; checkpoint?(key:string,value?:unknown):unknown }
export interface OpportunitySource { acknowledge?():void; name: string; kind?:'direct'|'search'; notes?: string[]; diagnostics?:Record<string,unknown>; discover(context: SourceContext): Promise<RawOpportunity[]> }
export interface Profile {
  targetTitles: string[]; relatedTitles: string[]; skills: string[]; strongSkills: string[]; secondarySkills: string[];
  yearsExperience: number; preferredLocations: string[]; strictLocation: boolean;
  remotePreference: 'any' | 'remote' | 'onsite'; acceptableTypes: OpportunityType[]; acceptableEmploymentTypes: string[];
  experienceMin: number | null; experienceMax: number | null; excludedRoles: string[]; excludedTechnologies: string[];
  prioritizeKeywords: string[]; rejectKeywords: string[]; minimumMatch: number;
  dailyApplicationTarget?:number;
  indiaFirst?: boolean;
  coreSkillGroups?: string[][];
  roleFamilies?: string[];
  resumeEvidence?: { file: string; extractedAt: string; facts: string[]; workHistory?: {company:string;startMonth:string;endMonth:string|null}[] };
  freelance: { enabled: boolean; scopeKeywords: string[]; minimumBudget: number | null; currency: string; budgetUnit: 'project' | 'hour' };
}
export interface Evaluation { confidence?:'HIGH'|'MEDIUM'|'LOW'; confidenceReasons?:string[]; requirements?:Requirements;  matchScore: number; freshnessScore: number; rankScore: number; freshness: string; matched: string[]; missing: string[]; reasons: string[]; filtered: string[] }
export interface ScoringStrategy { score(o: Opportunity, p: Profile): Omit<Evaluation, 'freshnessScore' | 'rankScore' | 'freshness' | 'filtered'> }
