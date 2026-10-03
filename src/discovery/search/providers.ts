import {existsSync,readFileSync} from 'node:fs';
import type {SourceContext} from '../../model.ts';
import {queryId} from './queries.ts';
import {searchDefaults,type SearchConfig,type SearchDiscoveryProvider,type SearchQuery,type SearchPage} from './model.ts';
import {TavilyKeylessProvider} from './tavily.ts';
export function loadSearchConfig(path='config/search.json',overrides:Partial<SearchConfig>={}):SearchConfig {
  const c={...searchDefaults,...(existsSync(path)?JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,'')):{}),...overrides};
  if(!['tavily','none','searxng','mwmbl','saved-results'].includes(c.provider))throw new Error('Unknown search provider');
  for(const [key,max] of [['queryLimit',200],['pagesPerQuery',5],['resultsPerPage',50],['candidateLimit',500],['openWebQueries',200]] as const)
    if(!Number.isInteger(c[key])||c[key]<(key==='openWebQueries'?0:1)||c[key]>max)throw new Error('Invalid search '+key);
  if(c.openWebQueries>c.queryLimit)throw new Error('Open-web query budget exceeds total budget');
  if(c.provider==='searxng'){
    if(!c.endpoint||c.permissionConfirmed!==true)throw new Error('SearXNG needs an endpoint and permissionConfirmed=true for an instance you operate or are permitted to use');
    const u=new URL(c.endpoint);if(u.username||u.password||u.search||u.hash||!(u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw new Error('SearXNG endpoint must be HTTPS (or loopback HTTP), without credentials/query parameters');
  }
  if(c.provider==='saved-results'&&typeof c.resultsFile!=='string')throw new Error('Saved-results provider requires resultsFile');
  return c;
}
function pageResults(data:unknown,limit:number):SearchPage {
  const d=data as {results?:unknown[];unresponsive_engines?:unknown[]};if(!d||!Array.isArray(d.results))throw new Error('Search provider did not return a results array; HTML challenges are unsupported');
  const results=d.results.flatMap(r=>{const v=r as {url?:unknown;title?:unknown};return typeof v?.url==='string'?[{url:v.url,...(typeof v.title==='string'?{title:v.title}:{})}]:[];});
  return {results:results.slice(0,limit),hasMore:results.length>0,warnings:[...(results.length>limit?[`Result cap: retained ${limit}/${results.length} URLs`]:[]),...(d.unresponsive_engines?.length?['Some upstream search engines did not respond']:[])]};
}
export class SearxngProvider implements SearchDiscoveryProvider {
  name='searxng';mode='automatic' as const;
  constructor(privateEndpoint:string,limit=10){this.endpoint=privateEndpoint;this.limit=limit;}
  private endpoint:string;private limit:number;
  async search(q:SearchQuery,page:number,c:SourceContext){const u=new URL(this.endpoint);u.searchParams.set('q',q.query);u.searchParams.set('format','json');u.searchParams.set('pageno',String(page));u.searchParams.set('categories','general');return pageResults(await c.getJson(u.toString(),86400000),this.limit);}
}
export class MwmblProvider implements SearchDiscoveryProvider {
  name='mwmbl';mode='automatic' as const;
  constructor(limit=10){this.limit=limit;}private limit:number;
  async search(q:SearchQuery,page:number,c:SourceContext){if(page>1)return {results:[],hasMore:false};const result=pageResults(await c.getJson(`https://api.mwmbl.org/api/v2/search/?q=${encodeURIComponent(q.query)}`,86400000),this.limit);return {...result,hasMore:false};}
}
export class SavedResultsProvider implements SearchDiscoveryProvider {
  name='saved-results';mode='saved-results' as const;queries:SearchQuery[];private batches:Map<string,SearchPage>;
  constructor(path:string){
    const data=JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,'')) as {queries?:{query:string;domain?:string;results:unknown[]}[]};
    if(!Array.isArray(data.queries)||data.queries.length>200)throw new Error('Saved results must contain queries (at most 200)');
    this.queries=data.queries.map(q=>{if(typeof q.query!=='string'||!q.query.trim()||q.query.length>2000||q.domain!==undefined&&(typeof q.domain!=='string'||!/^([a-z0-9-]+\.)+[a-z]{2,}(\/[a-z0-9/-]+)?$/.test(q.domain)))throw new Error('Invalid saved query');return {id:queryId(q.query),query:q.query,...(q.domain?{domain:q.domain}:{})};});
    if(new Set(this.queries.map(q=>q.id)).size!==this.queries.length)throw new Error('Duplicate saved queries; combine their results into one query');
    this.batches=new Map(data.queries.map((q,i)=>[this.queries[i].id,{...pageResults(q,500),hasMore:false}]));
  }
  async search(q:SearchQuery,page:number){return page===1?(this.batches.get(q.id)??{results:[],hasMore:false}):{results:[],hasMore:false};}
}
export function createProvider(c:SearchConfig,cacheDir='data/search-api-cache'):SearchDiscoveryProvider {
  if(c.provider==='tavily')return new TavilyKeylessProvider(cacheDir,c.resultsPerPage);
  if(c.provider==='searxng')return new SearxngProvider(c.endpoint!,c.resultsPerPage);
  if(c.provider==='mwmbl')return new MwmblProvider(c.resultsPerPage);
  if(c.provider==='saved-results')return new SavedResultsProvider(c.resultsFile!);
  return {name:'none',mode:'unavailable',async search(){return {results:[],hasMore:false};}};
}
