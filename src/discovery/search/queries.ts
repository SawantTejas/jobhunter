import {createHash} from 'node:crypto';
import type {Profile} from '../../model.ts';
import {families} from '../../matching/roles.ts';
import {generateQueries,type DomainEntry} from '../web.ts';
import type {SearchQuery} from './model.ts';
export const queryId=(s:string)=>createHash('sha256').update(s).digest('hex').slice(0,16);
export class QueryGenerator {
  generate(p:Profile,domains:DomainEntry[],limit:number,openWeb:number,offset=0):SearchQuery[]{
    if(!Number.isInteger(limit)||limit<1||limit>200||!Number.isInteger(openWeb)||openWeb<0||openWeb>limit||!Number.isSafeInteger(offset)||offset<0)throw new Error('Invalid query budget');
    const expanded={...p,relatedTitles:[...new Set([...p.relatedTitles,...(p.roleFamilies??[]).flatMap(f=>families[f]?.titles.slice(0,2)??[])])]};
    const result:SearchQuery[]=limit>openWeb?generateQueries(expanded,domains,limit-openWeb,offset):[];
    const roles=[...new Set([...p.targetTitles,...expanded.relatedTitles,...p.strongSkills.map(s=>s+' developer')])];
    const places=[...new Set([...p.preferredLocations,'Mumbai','Navi Mumbai','Pune','Bengaluru','Bangalore','Hyderabad','Remote India','Worldwide remote','APAC remote','Asia remote'])];
    for(let n=0;n<openWeb&&roles.length;n++){
      const i=offset+n,role=roles[i%roles.length],skill=p.strongSkills[i%Math.max(1,p.strongSkills.length)]??'';
      const query=[role,role.toLowerCase().includes(skill.toLowerCase())?'':skill,places[Math.floor(i/roles.length)%places.length],p.freelance.enabled&&i%5===4?'freelance contract project':'careers apply'].filter(Boolean).join(' ');
      result.push({id:queryId(query),query});
    }
    return [...new Map(result.map(q=>[q.query,q])).values()];
  }
}
