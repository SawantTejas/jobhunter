import { join } from 'node:path';
import { loadConfig } from '../config.ts';
import { Store } from '../persistence/index.ts';
import { PublicExportService } from '../export/public-export.ts';
import { publishDashboard } from '../publishing/publish.ts';
import type { Status } from '../model.ts';
const exporter=new PublicExportService();
export function withDashboardStore<T>(action:(store:Store,profile:ReturnType<typeof loadConfig>['profile'])=>T):T {
  const {profile,dataDir}=loadConfig();const store=new Store(join(dataDir,'opportunities.sqlite'));
  try{return action(store,profile);}finally{store.close();}
}
export const readDashboard=()=>withDashboardStore((store,profile)=>exporter.snapshot(store,profile));
export const exportDashboard=()=>withDashboardStore((store,profile)=>exporter.write(store,profile,join(process.cwd(),'public','data','jobs.json')));
export function updateDashboardStatus(id:string,status:Status){return withDashboardStore((store,profile)=>{
  store.status(id,status);return exporter.snapshot(store,profile);
});}
export const publish=()=>publishDashboard(process.cwd(),exportDashboard);
