const $=id=>document.getElementById(id);
const apiRoot='http://127.0.0.1:5173/_assistant/';
let tab,context,state={fields:[]},token='',busy=false;
const key=()=>`application-tab-${tab.id}`;
const say=text=>{$('message').textContent=text;};
const pageUrl=value=>{const u=new URL(value);u.hash='';return u.href;};
async function api(path,body){
  const response=await fetch(apiRoot+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-JobFinder-Token':token,'X-JobFinder-Extension':chrome.runtime.id},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000),cache:'no-store'});
  const result=await response.json();if(!response.ok)throw new Error(result.error??'Local service failed');return result;
}
async function storeState(){await chrome.storage.session.set({[key()]:state});}
function run(action){return async()=>{if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);say('');try{await action();}catch(e){say(e.message||String(e));}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);$('fill').disabled=!state.fields?.some(f=>f.mapping.confidence==='HIGH');$('complete').disabled=!state.sessionId||!$('submitted').checked;}};}
function jobs(){const selected=state.jobId||$('job').value,q=$('job-search').value.toLowerCase();$('job').replaceChildren(new Option('Choose the opportunity you are applying to',''));const filtered=context.jobs.filter(j=>`${j.company} ${j.title}`.toLowerCase().includes(q));for(const j of filtered.slice(0,150))$('job').add(new Option(`${j.company} — ${j.title}`,j.id));if(selected&&!Array.from($('job').options).some(o=>o.value===selected)){const j=context.jobs.find(j=>j.id===selected);if(j)$('job').add(new Option(`${j.company} — ${j.title}`,j.id));}$('job').value=selected;}
async function connect(){context=await api('context');jobs();$('resume').replaceChildren(new Option('Choose a resume',''));for(const r of context.resumes)$('resume').add(new Option(r.label,r.id));$('resume').value=state.resumeId||context.defaultResumeId||'';}
async function detect(){
  const jobId=$('job').value;if(!jobId)throw new Error('Choose an opportunity first');
  await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});
  const result=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>globalThis.__jobFinderAssistant.scan()});
  const scan=result[0]?.result;if(!scan)throw new Error('This page cannot be inspected');
  const previous=state.jobId===jobId&&!state.completed?state.sessionId:undefined;
  const analyzed=await api('analyze',{...scan,jobId,sessionId:previous});state={...analyzed,jobId,url:scan.url,resumeId:$('resume').value};await storeState();$('submitted').checked=false;render();
}
async function fill(requests,resumeId){
  const result=await chrome.scripting.executeScript({target:{tabId:tab.id},func:(url,values)=>globalThis.__jobFinderAssistant?.fill(url,values),args:[state.url,requests]});
  const outcome=result[0]?.result;if(!outcome)throw new Error('Page navigated or reloaded. Rescan the form.');
  if(outcome.filled.length)await api('filled',{sessionId:state.sessionId,url:state.url,ids:outcome.filled,...(resumeId?{resumeId}:{})});
  say(`${outcome.filled.length} fields filled. Review the page before submitting.${outcome.failed.length?'\n'+outcome.failed.map(f=>f.error).join('\n'):''}`);
  for(const id of outcome.filled){const row=state.fields.find(f=>f.field.id===id);if(row){row.field.hasValue=true;row.mapping.confidence='MEDIUM';row.mapping.reason='Filled — review on the website';}}
  await storeState();return outcome;
}
function render(){
  $('fields').replaceChildren();const counts={HIGH:0,MEDIUM:0,LOW:0,UNKNOWN:0};for(const row of state.fields??[])counts[row.mapping.confidence]++;
  $('summary').textContent=`${state.fields?.length??0} fields detected · ${counts.HIGH} known · ${counts.MEDIUM} need confirmation · ${counts.LOW+counts.UNKNOWN} unknown/low`;
  for(const {field,mapping} of state.fields??[]){
    const card=document.createElement('div');card.className='field';const title=document.createElement('strong');title.textContent=field.label||field.ariaLabel||field.name||'Unlabelled field';card.append(title);
    if(mapping.confidence==='LOW'&&mapping.value!==undefined){const suggestion=document.createElement('p');suggestion.textContent=`Stored value (check format): ${mapping.value}`;card.append(suggestion);}
    const detail=document.createElement('small');detail.textContent=`${mapping.confidence} · ${mapping.concept?.startsWith('QUESTION_')?'Custom question':mapping.concept||'Unmapped'} · ${mapping.reason}`;card.append(detail);
    if(mapping.blocked){$('fields').append(card);continue;}
    if(field.type==='file'){
      if(mapping.concept==='RESUME'){const button=document.createElement('button');button.textContent='Attach chosen resume';button.onclick=run(async()=>{const resumeId=$('resume').value;if(!resumeId)throw new Error('Choose a resume variant first');const file=await api('resume',{id:resumeId});await fill([{id:field.id,mode:'resume',file}],resumeId);state.resumeId=resumeId;await storeState();render();});card.append(button);}
      else{const note=document.createElement('p');note.textContent='Choose this attachment manually on the website.';card.append(note);}
    }else{
      let input;if(['select','radio','checkbox'].includes(field.type)){input=document.createElement('select');input.add(new Option('Choose an answer',''));const options=field.type==='checkbox'?[{label:'Yes',value:'Yes'},{label:'No',value:'No'}]:field.options??[];for(const o of options)input.add(new Option(o.label,o.value));const chosen=options.find(o=>o.value===mapping.value||o.label.toLowerCase()===String(mapping.value).toLowerCase());input.value=chosen?.value??'';}
      else{input=document.createElement(field.type==='textarea'?'textarea':'input');if(field.type!=='textarea')input.type=['email','tel','number','url','date'].includes(field.type)?field.type:'text';input.value=mapping.value??'';}
      input.setAttribute('aria-label',`Answer for ${title.textContent}`);card.append(input);
      const save=document.createElement('input');save.type='checkbox';const label=document.createElement('label');label.append(save,document.createTextNode(' Save confirmed answer for future forms'));card.append(label);
      const button=document.createElement('button');button.textContent=field.hasValue?'Confirm & replace':'Confirm & fill';button.onclick=run(async()=>{if(!input.value)throw new Error('Enter or choose an answer first');const value=input.value;const result=await fill([{id:field.id,mode:'confirm',value}]);if(result.filled.includes(field.id)&&save.checked){const answer=['select','radio'].includes(field.type)?input.selectedOptions[0].textContent:value;await api('answer',{sessionId:state.sessionId,fieldId:field.id,answer});}render();});card.append(button);
    }
    $('fields').append(card);
  }
  $('fill').disabled=busy||!state.fields?.some(f=>f.mapping.confidence==='HIGH');$('complete').disabled=busy||!state.sessionId||!$('submitted').checked;
}
$('extension-id').textContent=`Extension ID: ${chrome.runtime.id}`;
$('pair').onclick=run(async()=>{token=$('secret').value.trim();if(!/^[a-f0-9]{64}$/.test(token))throw new Error('Paste the pairing secret from assistant:setup');await api('context');await chrome.storage.local.set({pairingToken:token});$('secret').value='';await connect();$('pairing').open=false;say('Paired with your local JobFinder.');});
$('job-search').oninput=()=>{if(context)jobs();};
$('job').onchange=run(async()=>{state={fields:[],jobId:$('job').value};await storeState();$('submitted').checked=false;render();});
$('detect').onclick=run(detect);
$('fill').onclick=run(async()=>{await fill(state.fields.filter(r=>r.mapping.confidence==='HIGH'&&r.mapping.value!==undefined).map(r=>({id:r.field.id,value:r.mapping.value,mode:'known'})));render();});
$('submitted').onchange=()=>{$('complete').disabled=busy||!state.sessionId||!$('submitted').checked;};
$('complete').onclick=run(async()=>{if(!$('submitted').checked)throw new Error('Submit manually first');await api('complete',{sessionId:state.sessionId,manuallySubmitted:true});state.completed=true;state.fields=[];await storeState();$('submitted').checked=false;render();say('Marked Applied locally. Refresh JobFinder to see it in tracking and analytics.');});
await run(async()=>{
  [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab?.id||!/^https?:/.test(tab.url??''))throw new Error('Open a normal application webpage first');
  token=(await chrome.storage.local.get('pairingToken')).pairingToken??'';
  state=(await chrome.storage.session.get(key()))[key()]??{fields:[]};
  // Keep the session across multi-step navigation but never fill stale descriptors.
  if(state.url!==pageUrl(tab.url))state.fields=[];
  if(!token){$('pairing').open=true;say('Load the extension, run assistant:setup with the ID above, and paste its secret.');return;}
  await connect();if(!state.jobId){const matches=context.jobs.filter(j=>pageUrl(j.url)===pageUrl(tab.url));if(matches.length===1){state.jobId=matches[0].id;jobs();}}
  render();
})();
