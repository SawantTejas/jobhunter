// Injected on the user's click, in Chrome's ISOLATED world. No page messaging,
// network access, background scanning, navigation, Next or Submit actions.
(() => {
  if(globalThis.__jobFinderAssistant)return;
  const elements=new Map(),ids=new WeakMap();
  const clean=value=>String(value??'').replace(/\s+/g,' ').trim().slice(0,500);
  const pageUrl=()=>{const u=new URL(location.href);u.hash='';return u.href;};
  const visible=el=>el.isConnected&&!el.disabled&&!el.readOnly&&el.type!=='hidden'&&el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden';
  const labeled=el=>clean([...el.labels??[]].map(l=>l.textContent).join(' '));
  const aria=el=>clean(el.getAttribute('aria-label')||el.getAttribute('aria-labelledby')?.split(/\s+/).map(id=>document.getElementById(id)?.textContent??'').join(' '));
  const type=el=>el.tagName==='TEXTAREA'?'textarea':el.tagName==='SELECT'?'select':el.type;
  const signature=field=>JSON.stringify([field.label,field.name,field.ariaLabel,field.type,field.options]);
  function describe(el,group){
    const t=type(el),legend=el.closest('fieldset')?.querySelector('legend')?.textContent;
    const field={id:ids.get(el),label:clean(t==='radio'?(legend||aria(el.closest('[role=group]')??el)||el.parentElement?.parentElement?.querySelector('label')?.textContent):labeled(el)),name:clean(el.name||el.id).slice(0,200),placeholder:clean(el.getAttribute('placeholder')),ariaLabel:aria(el),nearby:clean(legend||el.parentElement?.textContent),type:t,tag:el.tagName.toLowerCase(),required:!!el.required,hasValue:t==='file'?!!el.files?.length:t==='checkbox'?el.checked:t==='radio'?group.some(e=>e.checked):!!el.value};
    if(t==='select')field.options=[...el.options].filter(o=>!o.disabled).slice(0,250).map(o=>({value:o.value.slice(0,500),label:clean(o.textContent)}));
    if(t==='radio')field.options=group.map(o=>({value:o.value.slice(0,500),label:labeled(o)||o.value}));
    return field;
  }
  function scan(){
    elements.clear();const fields=[],radios=new Set();
    const controls=[...document.querySelectorAll('input,textarea,select')].filter(visible);
    for(const el of controls){
      const t=type(el);if(!['text','email','tel','number','url','date','textarea','select','radio','checkbox','file','search'].includes(t))continue;
      let group=[el];if(t==='radio'&&el.name){group=controls.filter(e=>e.type==='radio'&&e.name===el.name&&e.form===el.form);if(radios.has(group[0]))continue;radios.add(group[0]);}
      if(!ids.has(el))ids.set(el,crypto.randomUUID());const field=describe(el,group);elements.set(field.id,{el,group,signature:signature(field)});fields.push(field);if(fields.length===200)break;
    }
    return {url:pageUrl(),fields};
  }
  function setNative(el,property,value){
    const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;
    const setter=Object.getOwnPropertyDescriptor(proto,property)?.set;if(!setter)throw new Error('Unsupported control');setter.call(el,value);
  }
  const notify=el=>{el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));};
  function fill(url,requests){
    if(pageUrl()!==url)throw new Error('Application page changed. Rescan before filling.');
    const filled=[],failed=[];
    for(const request of requests){
      try{
        const entry=elements.get(request.id);if(!entry)throw new Error('Field changed. Rescan.');const {el,group}=entry;
        if(!visible(el)||entry.signature!==signature(describe(el,group)))throw new Error('Field is hidden, disabled or changed. Rescan.');
        const field=describe(el,group);if(/password|captcha|consent|agree|privacy|terms|subscribe|signature|certify|declare|gender|ethnicity|disability|veteran/i.test(field.label+' '+field.name+' '+field.ariaLabel))throw new Error('Complete this protected field on the website');
        if(request.mode==='known'&&(field.hasValue||['file','checkbox','radio','textarea','date'].includes(field.type)))throw new Error('Needs individual confirmation');
        if(field.type==='file'){
          if(request.mode!=='resume'||!request.file||!/\b(resume|cv)\b/i.test(field.label+' '+field.ariaLabel+' '+field.name))throw new Error('Choose a resume for a recognized resume field');
          const {base64,name,mime}=request.file;const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));const transfer=new DataTransfer();transfer.items.add(new File([bytes],name,{type:mime}));setNative(el,'files',transfer.files);notify(el);
          if(!el.files?.length)throw new Error('Upload rejected; choose the file manually');
        }else if(field.type==='select'){
          if(el.multiple)throw new Error('Multi-select widgets require manual entry');
          const option=[...el.options].find(o=>!o.disabled&&(o.value===request.value||clean(o.textContent).toLowerCase()===clean(request.value).toLowerCase()));if(!option)throw new Error('No exact option; choose an option manually');setNative(el,'value',option.value);notify(el);if(el.value!==option.value)throw new Error('Page rejected the selection');
        }else if(field.type==='radio'){
          const option=group.find(o=>visible(o)&&(o.value===request.value||labeled(o).toLowerCase()===clean(request.value).toLowerCase()));if(!option)throw new Error('No exact radio option');setNative(option,'checked',true);notify(option);if(!option.checked)throw new Error('Page rejected the selection');
        }else if(field.type==='checkbox'){
          if(!['Yes','No'].includes(request.value))throw new Error('Choose Yes or No');setNative(el,'checked',request.value==='Yes');notify(el);if(el.checked!==(request.value==='Yes'))throw new Error('Page rejected the checkbox');
        }else{
          setNative(el,'value',request.value);notify(el);if(el.value!==request.value)throw new Error('Page changed or rejected the value; review manually');
        }
        filled.push(request.id);
      }catch(e){failed.push({id:request.id,error:e.message});}
    }
    return {filled,failed};
  }
  globalThis.__jobFinderAssistant={scan,fill};
})();
