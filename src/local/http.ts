import type { IncomingMessage,ServerResponse } from 'node:http';
import type { PublicSnapshot } from '../../shared/public-model.ts';
import type { Status } from '../model.ts';
export interface DashboardActions {read():PublicSnapshot;update(id:string,status:Status):PublicSnapshot;publish():Promise<unknown>}
const localStatuses:Status[]=['NEW','SAVED','APPLIED','INTERVIEW','REJECTED','OFFER','WITHDRAWN'];
export function localApi(actions:DashboardActions,port=5173){
  let publishing=false;
  return async(req:IncomingMessage,res:ServerResponse,next:()=>void)=>{
    const path=(req.url??'').split('?')[0];if(!path.startsWith('/_local/')){next();return;}
    const send=(code:number,data:unknown)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
    const hosts=[`127.0.0.1:${port}`,`localhost:${port}`];
    const remote=req.socket.remoteAddress;
    if(!hosts.includes(req.headers.host??'')||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote??'')||req.headers['x-jobhunter-local']!=='1'||(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)){
      send(403,{error:'Local dashboard requests must come from the same localhost origin.'});return;
    }
    try{
      if(req.method==='GET'&&path==='/_local/opportunities'){send(200,actions.read());return;}
      if(req.method==='POST'&&path==='/_local/publish'){
        if(publishing){send(409,{error:'Publishing is already running.'});return;}
        publishing=true;try{send(200,await actions.publish());}finally{publishing=false;}return;
      }
      const match=path.match(/^\/_local\/opportunities\/([a-zA-Z0-9-]+)\/status$/);
      if(req.method==='PATCH'&&match){
        if(!req.headers['content-type']?.startsWith('application/json')){send(415,{error:'Expected JSON'});return;}
        let body='';for await(const chunk of req){body+=String(chunk);if(body.length>2048){send(413,{error:'Request too large'});return;}}
        let input:unknown;try{input=JSON.parse(body);}catch{send(400,{error:'Invalid JSON'});return;}
        if(!input||typeof input!=='object'||Object.keys(input).some(k=>k!=='status')||!localStatuses.includes((input as {status:Status}).status)){send(400,{error:'Choose NEW, SAVED, APPLIED, INTERVIEW, REJECTED, OFFER or WITHDRAWN'});return;}
        send(200,actions.update(match[1],(input as {status:Status}).status));return;
      }
      send(404,{error:'Unknown local dashboard action'});
    }catch(error){send(400,{error:error instanceof Error?error.message:'Local operation failed'});}
  };
}
