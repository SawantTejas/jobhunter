import type {SearchResult} from './model.ts';
import type {RawOpportunity} from '../../model.ts';
import {candidateUrl} from './network.ts';
// Only a specific listing with explicit employer/title/location in the provider title.
// Query geography, URL slugs and generic snippets are not evidence of eligibility.
export function partialFromMetadata(result?:SearchResult):RawOpportunity|undefined {
  if(!result?.title||!result.content||result.content.length<80)return;
  let url:URL;try{url=new URL(candidateUrl(result.url));}catch{return;}
  if(!/(^|\.)linkedin\.com$/.test(url.hostname)||!/^\/jobs\/view\/[^/]+/.test(url.pathname))return;
  const match=/^(.{2,100}?) hiring (.{3,120}?) in (.{2,100}?)(?:\s*\|\s*LinkedIn)?$/i.exec(result.title);
  if(!match||!/\b(developer|engineer|programmer|architect)\b/i.test(match[2]))return;
  const [,company,title,location]=match;
  if(!result.content.toLowerCase().includes(company.toLowerCase()))return;
  return {externalId:result.url,title,companyOrClient:company,location,sourceUrl:result.url,
    description:'[PARTIAL — search metadata only; original page inaccessible. Verify all details before applying.] '+result.content,
    authority:'aggregator',original:{partial:true,evidence:'search-result-title-and-content',metadata:result}};
}
