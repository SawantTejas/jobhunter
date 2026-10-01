import { parseRecords } from '../discovery/web.ts';
import type { OpportunitySource, RegistryEntry } from '../model.ts';
// Longest matching rule, allow wins ties. Combine matching user-agent groups.
export function robotsAllowed(robots:string,path:string):boolean {
  const groups:{agents:string[];rules:{allow:boolean;pattern:string}[]}[]=[];let current={agents:[] as string[],rules:[] as {allow:boolean;pattern:string}[]};
  for(const line of robots.split(/\r?\n/)){
    const match=line.split('#')[0].trim().match(/^([^:]+):\s*(.*)$/);if(!match)continue;
    const field=match[1].toLowerCase(),value=match[2].trim();
    if(field==='user-agent'){
      if(current.rules.length){groups.push(current);current={agents:[],rules:[]};}
      current.agents.push(value.toLowerCase());
    }else if(['allow','disallow'].includes(field)&&current.agents.length)current.rules.push({allow:field==='allow',pattern:value});
  }
  groups.push(current);
  const specific=groups.filter(g=>g.agents.some(a=>a!=='*'&&'localopportunityagent'.includes(a)));
  const selected=specific.length?specific:groups.filter(g=>g.agents.includes('*'));
  const rules=selected.flatMap(g=>g.rules).filter(r=>r.pattern&&new RegExp('^'+r.pattern.replace(/[.+?^{}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*')).test(path)).sort((a,b)=>b.pattern.length-a.pattern.length||Number(b.allow)-Number(a.allow));
  return rules[0]?.allow??true;
}
export function companyPage(e:RegistryEntry):OpportunitySource {
  return {name:e.id,notes:['PARTIAL: configured public page only; no recursive crawling or JavaScript execution'],async discover(c){
    if(!c.getText)throw new Error('HTTP text transport unavailable');
    const page=new URL(e.board);if(page.protocol!=='https:'||page.username||page.password)throw new Error('Company page must be an HTTPS URL');
    // Fail closed on robots fetch errors or redirects; never work around a block.
    const robots=await c.getText(`${page.origin}/robots.txt`,86400000);
    if(!robotsAllowed(robots,page.pathname+page.search))throw new Error('Company robots policy disallows this page');
    const records=parseRecords(await c.getText(page.toString(),6*3600000),page.toString());
    return records.map(r=>({...r,authority:new URL(r.sourceUrl).hostname===page.hostname?'employer' as const:'import' as const}));
  }};
}
