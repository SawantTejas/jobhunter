import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {timingSafeEqual} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {ApplicationService} from './service.ts';
export interface Pairing {extensionId:string;token:string}
export function applicationApi(dataDir:string,withService:<T>(run:(service:ApplicationService)=>T)=>T,port=5173){
  return async(req:IncomingMessage,res:ServerResponse,next:()=>void)=>{
    const path=(req.url??'').split('?')[0];if(!path.startsWith('/_assistant/')){next();return;}
    const send=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
    if(req.headers.host!==`127.0.0.1:${port}`||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??'')){send(403,{error:'Loopback only'});return;}
    let pairing:Pairing;try{pairing=JSON.parse(readFileSync(join(dataDir,'assistant-pairing.json'),'utf8'));}catch{send(403,{error:'Run npm run assistant:setup -- YOUR_EXTENSION_ID first'});return;}
    if(!pairing||!/^[a-p]{32}$/.test(pairing.extensionId??'')||!/^[a-f0-9]{64}$/.test(pairing.token??'')){send(403,{error:'Invalid pairing file; run assistant:setup again'});return;}
    const origin=`chrome-extension://${pairing.extensionId}`;
    if(req.headers.origin&&req.headers.origin!==origin){send(403,{error:'Extension origin is not paired'});return;}
    if(req.method==='OPTIONS'){
      if(req.headers.origin!==origin){send(403,{error:'Unpaired origin'});return;}
      res.writeHead(204,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, X-JobFinder-Token, X-JobFinder-Extension','Access-Control-Allow-Private-Network':'true','Vary':'Origin'});res.end();return;
    }
    const token=req.headers['x-jobfinder-token'];
    if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||typeof pairing.token!=='string'||token.length!==pairing.token.length||!timingSafeEqual(Buffer.from(token),Buffer.from(pairing.token))||req.headers['x-jobfinder-extension']!==pairing.extensionId){send(403,{error:'Pair the extension with the local secret'});return;}
    res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
    try{
      if(req.method==='GET'&&path==='/_assistant/context'){send(200,withService(s=>s.context()));return;}
      if(req.method!=='POST'||!req.headers['content-type']?.startsWith('application/json')){send(400,{error:'Expected JSON POST'});return;}
      let body='';for await(const chunk of req){body+=String(chunk);if(Buffer.byteLength(body)>512000){send(413,{error:'Request too large'});return;}}
      const input:unknown=JSON.parse(body);if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid request');const value=input as Record<string,unknown>;
      const result=withService(s=>{switch(path){
        case '/_assistant/analyze':return s.analyze(value);
        case '/_assistant/filled':return s.filled(value);
        case '/_assistant/answer':return s.saveAnswer(value);
        case '/_assistant/resume':return s.resume(value.id);
        case '/_assistant/complete':return s.complete(value);
        default:throw new Error('Unknown assistant action');
      }});send(200,result);
    }catch(e){send(400,{error:e instanceof Error?e.message:'Application assistant failed'});}
  };
}
