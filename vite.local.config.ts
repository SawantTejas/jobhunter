import {applicationApi} from './src/application/http.ts';
import {ApplicationService} from './src/application/service.ts';
import {loadConfig} from './src/config.ts';
import {withDashboardStore} from './src/local/dashboard-service.ts';
import { defineConfig,mergeConfig } from 'vite';
import base from './vite.config.ts';
import { localApi } from './src/local/http.ts';
import { readDashboard,updateDashboardStatus,publish } from './src/local/dashboard-service.ts';
export default mergeConfig(base,defineConfig({
  server:{host:'127.0.0.1',port:5173,strictPort:true,allowedHosts:['localhost','127.0.0.1'],fs:{strict:true,deny:['**/.env*','**/*.sqlite*','**/*.db','**/*.pdf','**/config/profile.json','**/config/sources.json','**/data/**','**/application-profile.json','**/assistant-pairing.json','**/private-resumes/**']}},
  plugins:[{name:'localhost-only-dashboard',apply:'serve',configureServer(server){
    const {dataDir}=loadConfig();
    server.middlewares.use(applicationApi(dataDir,action=>withDashboardStore((store,profile)=>action(new ApplicationService(store,profile,dataDir)))));
    server.middlewares.use(localApi({read:readDashboard,update:updateDashboardStatus,publish}));
  }}],
}));
