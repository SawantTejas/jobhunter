import { defineConfig } from 'vite';
import { readdirSync,readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateSnapshot } from './shared/public-model.ts';
export default defineConfig({
  root:'web',publicDir:'../public',
  build:{outDir:'../dist',emptyOutDir:true,sourcemap:false},
  plugins:[{name:'public-export-boundary',buildStart(){
    const publicRoot=resolve('public');
    const files=readdirSync(publicRoot,{recursive:true,withFileTypes:true}).filter(e=>e.isFile()).map(e=>resolve(e.parentPath,e.name));
    if(files.some(file=>file!==resolve(publicRoot,'data/jobs.json')))throw new Error('Only sanitized data/jobs.json may be copied from public/.');
    validateSnapshot(JSON.parse(readFileSync(resolve(publicRoot,'data/jobs.json'),'utf8')));
  }}],
});
