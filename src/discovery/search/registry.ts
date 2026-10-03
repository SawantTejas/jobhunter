import {existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {createHash} from 'node:crypto';
import type {RegistryEntry} from '../../model.ts';
export interface AtsTarget {adapter:string;board:string;jobId?:string}
export function identifyAts(value:string):AtsTarget|undefined {
  const u=new URL(value),parts=u.pathname.split('/').filter(Boolean),host=u.hostname.toLowerCase();
  if(['boards.greenhouse.io','job-boards.greenhouse.io'].includes(host)&&parts[0]&&(!parts[1]||parts[1]==='jobs'))return {adapter:'greenhouse',board:parts[0],jobId:parts[2]};
  if(host==='jobs.lever.co'&&parts[0])return {adapter:'lever',board:parts[0],jobId:parts[1]};
  if(host==='jobs.ashbyhq.com'&&parts[0])return {adapter:'ashby',board:parts[0],jobId:parts[1]};
  if(host==='jobs.smartrecruiters.com'&&parts[0])return {adapter:'smartrecruiters',board:parts[0],jobId:parts[1]?.split('-')[0]};
}
export function registerSource(entry:RegistryEntry,path='config/sources.json'):boolean {
  const rows:RegistryEntry[]=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):[];
  if(rows.some(r=>r.adapter===entry.adapter&&r.board.toLowerCase()===entry.board.toLowerCase()))return false;
  // Read immediately before the atomic replacement so user settings are preserved.
  if(rows.some(r=>r.id===entry.id))throw new Error('Discovered source ID collision');
  const temp=path+'.'+process.pid+'.tmp';writeFileSync(temp,JSON.stringify([...rows,entry],null,2)+'\n');renameSync(temp,path);return true;
}
export function registryEntry(target:AtsTarget|undefined,page:string,company:string):RegistryEntry {
  const adapter=target?.adapter??'company-page',board=target?.board??page;
  return {id:`discovered-${adapter}-${createHash('sha256').update(board.toLowerCase()).digest('hex').slice(0,12)}`,adapter,board,company,enabled:true,...(adapter==='smartrecruiters'?{maxPages:3,maxDetails:20}:{})};
}
