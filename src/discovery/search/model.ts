import type {SourceContext} from '../../model.ts';
export interface SearchQuery {id:string;query:string;domain?:string}
export interface SearchResult {url:string;title?:string;content?:string}
export interface SearchPage {results:SearchResult[];hasMore:boolean;warnings?:string[]}
export interface SearchDiscoveryProvider {
  name:string; mode:'automatic'|'saved-results'|'unavailable';
  queries?:SearchQuery[];
  search(query:SearchQuery,page:number,context:SourceContext):Promise<SearchPage>;
}
export interface SearchConfig {
  provider:'tavily'|'none'|'searxng'|'mwmbl'|'saved-results';
  endpoint?:string; permissionConfirmed?:boolean; resultsFile?:string;
  queryLimit:number; pagesPerQuery:number; resultsPerPage:number; candidateLimit:number; openWebQueries:number;
}
export const searchDefaults:SearchConfig={provider:'tavily',queryLimit:20,pagesPerQuery:2,resultsPerPage:10,candidateLimit:40,openWebQueries:4};
