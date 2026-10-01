import { defineConfig,mergeConfig } from 'vite';
import base from './vite.config.ts';
import { localApi } from './src/local/http.ts';
import { readDashboard,updateDashboardStatus,publish } from './src/local/dashboard-service.ts';
export default mergeConfig(base,defineConfig({
  server:{host:'127.0.0.1',port:5173,strictPort:true,allowedHosts:['localhost','127.0.0.1'],fs:{strict:true,deny:['**/.env*','**/*.sqlite*','**/*.db','**/*.pdf','**/config/profile.json','**/config/sources.json','**/data/**']}},
  plugins:[{name:'localhost-only-dashboard',apply:'serve',configureServer(server){
    server.middlewares.use(localApi({read:readDashboard,update:updateDashboardStatus,publish}));
  }}],
}));
