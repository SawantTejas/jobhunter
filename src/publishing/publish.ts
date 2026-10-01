import { execFile,spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join,resolve } from 'node:path';
const exec=promisify(execFile);
const dataPath='public/data/jobs.json';
export function gitBinary():string {
  if(process.env.JOB_AGENT_GIT)return process.env.JOB_AGENT_GIT;
  if(spawnSync('git',['--version'],{stdio:'ignore',windowsHide:true}).status===0)return 'git';
  const bundled=join(homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','native','git','cmd','git.exe');
  return process.platform==='win32'&&existsSync(bundled)?bundled:'git';
}
export async function publishDashboard(root:string,exportData:()=>unknown):Promise<{committed:boolean;pushed:boolean}> {
  exportData();
  const git=async(...args:string[])=>{
    try{return (await exec(gitBinary(),args,{cwd:root,timeout:120000,windowsHide:true,maxBuffer:4*1024*1024,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}})).stdout.trim();}
    catch(error){
      const stderr=String((error as {stderr?:string}).stderr??'');
      if(/index\.lock/i.test(stderr)&&/permission denied|access is denied/i.test(stderr))throw new Error('Git cannot write its index. Restart the dashboard from a normal PowerShell terminal: cd D:\\JobFinder; npm run dev. A dashboard started in a restricted coding environment may lack Git write access.');
      if(/index\.lock/i.test(stderr)&&/file exists/i.test(stderr))throw new Error('Another Git operation holds the repository lock. Let it finish, then retry publishing.');
      throw new Error(`Git ${args[0]} failed. Check the repository, remote, branch and existing local Git authentication in your terminal. No credentials are stored by JobHunter.`);
    }
  };
  const gitRoot=await git('rev-parse','--show-toplevel');
  if(resolve(gitRoot).toLowerCase()!==resolve(root).toLowerCase())throw new Error('Initialize a Git repository in the JobHunter folder, not a parent directory.');
  await git('rev-parse','--verify','HEAD');
  const branch=await git('symbolic-ref','--quiet','--short','HEAD');
  const upstream=await git('rev-parse','--abbrev-ref','--symbolic-full-name','@{upstream}');
  if(!upstream.includes('/'))throw new Error('Configure and push this branch upstream before publishing.');
  const remote=await git('config',`branch.${branch}.remote`),remoteRef=await git('config',`branch.${branch}.merge`);
  if(remote==='.'||!remoteRef.startsWith('refs/heads/'))throw new Error('Publishing needs a remote tracking branch.');
  // Never push a repository that currently tracks private local artifacts.
  const tracked=(await git('ls-files')).split('\n');
  const privatePath=(p:string)=>/^(?:data\/|node_modules\/|\.pnpm-store\/|config\/(?:profile|sources)\.json$|\.env(?:\.|$))/.test(p)&&p!=='.env.example'||/\.(?:sqlite(?:-wal|-shm)?|db|pdf)$/i.test(p);
  if(tracked.some(privatePath))throw new Error('Publishing blocked: this repository tracks private/local files. Remove them from Git and review its history first.');
  for(const required of ['package.json','vite.config.ts','web/index.html','web/main.tsx','shared/public-model.ts','vercel.json']){
    await git('cat-file','-e',`HEAD:${required}`);
    if(await git('status','--porcelain','--',required))throw new Error('Commit the V0.2 dashboard code before publishing data. The publish command only commits jobs.json.');
  }
  // Check pending history too; deleting a private file now cannot make it safe to push.
  const aheadFiles=(await git('log','--format=','--name-only',`${upstream}..HEAD`)).split('\n');
  if(aheadFiles.some(privatePath))throw new Error('Publishing blocked: unpushed history contains private files. Review those commits first.');
  await git('add','--',dataPath);
  const changed=!!(await git('diff','--cached','--name-only','--',dataPath));
  if(changed)await git('commit','--only','-m','Update public opportunity dashboard','--',dataPath);
  await git('push',remote,`HEAD:${remoteRef}`);
  return {committed:changed,pushed:true};
}
