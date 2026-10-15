const byId = id => document.getElementById(id);
const method = byId('method'), route = byId('route'), body = byId('body');
const sendButton = byId('send-request'), writeGuard = byId('write-guard'), queryParams = byId('query-params');
const tokenRequestButton = byId('request-token'), toastRegion = byId('toast-region');
const DB_NAME = 'ApiPublicacaoTester', DB_VERSION = 1, LEGACY_HISTORY_KEY = 'apiTester.savedRequests.v1';
const STORAGE_MIGRATION_KEY = 'apiStudio.sqliteMigration.v1';
const TOKEN_REQUEST_CONFIG_KEY = 'tokenRequestConfig';
const DB_STORES = ['history','collections','environments','settings'];
const writeMethods = new Set(['POST','PUT','PATCH','DELETE']), toastTimers = new Map();
const RunnerLogic = window.ApiStudioRunner;
const parseJsonPath = RunnerLogic.parseJsonPath, jsonPathValue = RunnerLogic.jsonPathValue;
const themes = new Set(['dracula','monokai','one-dark','nord','solarized-dark','github-dark']);
const fontFamilies = new Map([
  ['fira-code','"Fira Code", "Cascadia Code", "IBM Plex Mono", monospace'],
  ['jetbrains-mono','"JetBrains Mono", "Cascadia Code", "IBM Plex Mono", monospace'],
  ['cascadia-code','"Cascadia Code", "Cascadia Mono", "IBM Plex Mono", monospace'],
  ['cascadia-mono','"Cascadia Mono", "IBM Plex Mono", monospace'],
  ['ibm-plex-mono','"IBM Plex Mono", "Fira Code", monospace']
]);
const DEFAULT_FONT = 'fira-code', DEFAULT_UI_SCALE = 1.2, MIN_UI_SCALE = 0.8, MAX_UI_SCALE = 1.5;
let legacyDbPromise, toastId = 0, queryId = 0, collections = [], environments = [], environmentDraft = [], activeEnvironmentId = '', activeTheme = 'dracula', activeFont = DEFAULT_FONT, activeScale = DEFAULT_UI_SCALE, actionDialogQueue = Promise.resolve();
let activeSaved = null, selectedContainer = { collectionId:'', folderId:'' }, collapsed = new Set(), baseUrlAuto = true;
let runnerEntries = [], runnerFailedCases = [], runnerBusy = false, runnerStopRequested = false;
let quickOpenEntries = [], quickOpenActiveIndex = 0;
const WORKSPACE_TABS_KEY = 'workspaceTabs', MAX_WORKSPACE_TABS = RunnerLogic.maxWorkspaceTabs;
let workspaceTabs = [], activeWorkspaceTabId = '', workspaceTabsSaveTimer = 0, workspaceTabsStorageWarning = false, workspaceTabsLoading = false;
let responseBodyState = RunnerLogic.parseResponseBody(''), responseBodyView = 'pretty', responseTreeSource = null;
let tokenRequestConfig = RunnerLogic.normalizeTokenRequestConfig();

function openLegacyDb() {
  if (legacyDbPromise) return legacyDbPromise;
  legacyDbPromise = new Promise((resolve,reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of ['history','collections','environments','settings'])
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name,{keyPath:name === 'settings' ? 'key' : 'id'});
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || Error('Banco local indisponível.'));
    request.onblocked = () => reject(Error('Feche outras abas do Vortix e tente novamente.'));
  });
  return legacyDbPromise;
}
async function legacyDbRead(store) {
  const db = await openLegacyDb();
  return new Promise((resolve,reject) => {
    const request = db.transaction(store,'readonly').objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || Error('Falha ao ler o banco local.'));
  });
}
async function migrateLegacyDb() {
  try{if(localStorage.getItem(STORAGE_MIGRATION_KEY)==='done')return;}catch{}
  const legacy = {};
  for (const store of DB_STORES) legacy[store] = await legacyDbRead(store);
  let legacyHistory='',legacyHistoryImported=false;try{legacyHistory=localStorage.getItem(LEGACY_HISTORY_KEY)||'';}catch{}
  if (legacyHistory && !legacy.history.length) {
    try {
      const old = JSON.parse(legacyHistory);
      if (Array.isArray(old)){legacy.history=old.filter(entry=>entry?.id);legacyHistoryImported=true;}
    } catch { /* preserve malformed legacy data for recovery */ }
  }
  for (const store of DB_STORES) {
    const records = legacy[store];
    const batchSize = store === 'history' ? 1 : 50;
    for (let index=0;index<records.length;index+=batchSize) {
      const response = await fetch(`/api/storage/${store}/import`,{method:'POST',headers:{'Content-Type':'application/json','X-Api-Studio':'1'},cache:'no-store',body:JSON.stringify(records.slice(index,index+batchSize))});
      if (!response.ok) throw Error('Migração local interrompida. Os dados antigos continuam no navegador; tente novamente.');
    }
  }
  try{localStorage.setItem(STORAGE_MIGRATION_KEY,'done');if(legacyHistoryImported)localStorage.removeItem(LEGACY_HISTORY_KEY);}catch{}
}
async function dbRead(store,key) {
  const url=`/api/storage/${encodeURIComponent(store)}${key===undefined?'':'?key='+encodeURIComponent(key)}`;
  const response=await fetch(url,{headers:{'X-Api-Studio':'1'},cache:'no-store'});
  if(!response.ok)throw Error('Falha ao ler o banco local.');
  return response.json();
}
async function dbWrite(store,value,remove=false) {
  const url=remove==='clear'?`/api/storage/${encodeURIComponent(store)}`:remove?`/api/storage/${encodeURIComponent(store)}?key=${encodeURIComponent(value)}`:`/api/storage/${encodeURIComponent(store)}`;
  const response=await fetch(url,{method:remove?'DELETE':'POST',headers:{'Content-Type':'application/json','X-Api-Studio':'1'},cache:'no-store',body:remove?undefined:JSON.stringify(value)});
  if(!response.ok)throw Error('Falha ao gravar no banco local.');
}
const newId = () => crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
async function initializeDb() {
  await migrateLegacyDb();
  collections = await dbRead('collections');
  if (!collections.length) {
    collections = [{id:newId(),name:'Minha coleção',folders:[],requests:[]}];
    await dbWrite('collections',collections[0]);
  }
  environments = await dbRead('environments');
  if (!environments.length) {
    environments = [{id:newId(),name:'Local',group:'Local',variables:{}}];
    await dbWrite('environments',environments[0]);
  }
  for(const env of environments){if(!env.group){env.group='Local';await dbWrite('environments',env);}}
  if(!selectedContainer.collectionId)selectedContainer={collectionId:collections[0].id,folderId:''};
  const active = await dbRead('settings','activeEnvironmentId');
  activeEnvironmentId = environments.some(x=>x.id===active?.value) ? active.value : environments[0].id;
  await dbWrite('settings',{key:'activeEnvironmentId',value:activeEnvironmentId});
  const savedTheme = await dbRead('settings','activeTheme');
  activeTheme = themes.has(savedTheme?.value) ? savedTheme.value : 'dracula';
  const savedFont = await dbRead('settings','fontFamily');
  activeFont = fontFamilies.has(savedFont?.value) ? savedFont.value : DEFAULT_FONT;
  const savedScale = await dbRead('settings','uiScale');
  activeScale = Number.isFinite(savedScale?.value) ? Math.max(MIN_UI_SCALE,Math.min(MAX_UI_SCALE,savedScale.value)) : DEFAULT_UI_SCALE;
}
function dismissToast(id) {
  const item=toastRegion.querySelector(`[data-toast-id="${id}"]`); if(!item)return;
  clearTimeout(toastTimers.get(id));toastTimers.delete(id);item.remove();
}
function showToast(title,message,kind='info',duration) {
  const id=String(++toastId), item=document.createElement('section');
  item.className=`toast toast--${kind}`;item.dataset.toastId=id;item.setAttribute('role',kind==='error'?'alert':'status');item.setAttribute('aria-live',kind==='error'?'assertive':'polite');
  const heading=document.createElement('h3');heading.className='toast-title';heading.textContent=title;
  const detail=document.createElement('p');detail.className='toast-message';detail.textContent=message;
  const close=document.createElement('button');close.className='toast-close';close.type='button';close.textContent='Fechar';close.setAttribute('aria-label','Fechar notificação');close.onclick=()=>dismissToast(id);
  item.append(heading,detail,close);toastRegion.prepend(item);
  while(toastRegion.children.length>3)dismissToast(toastRegion.lastElementChild.dataset.toastId);
  if(duration!==0)toastTimers.set(id,setTimeout(()=>dismissToast(id),duration??(kind==='error'?8000:5000)));
  return id;
}
function showActionDialog(options={}) {
  const open = () => new Promise(resolve => {
    const dialog=byId('action-dialog'),form=byId('action-dialog-form'),input=byId('action-dialog-input'),select=byId('action-dialog-select');
    const inputWrap=byId('action-dialog-input-wrap'),selectWrap=byId('action-dialog-select-wrap');
    const inputLabel=byId('action-dialog-input-label'),selectLabel=byId('action-dialog-select-label');
    const title=byId('action-dialog-title'),description=byId('action-dialog-description');
    const detail=byId('action-dialog-detail'),warning=byId('action-dialog-warning');
    const confirmButton=byId('action-dialog-confirm'),cancelButton=byId('action-dialog-cancel'),closeButton=byId('action-dialog-close');
    const hasInput=!!options.inputLabel,hasSelect=Array.isArray(options.selectOptions)&&options.selectOptions.length>0;
    byId('action-dialog-eyebrow').textContent=options.eyebrow||'CONFIRMAÇÃO';
    title.textContent=options.title||'Confirmar ação';
    description.textContent=options.description||'';
    description.hidden=!options.description;
    detail.textContent=options.detail||'';
    detail.hidden=!options.detail;
    warning.textContent=options.warning||'';
    warning.hidden=!options.warning;
    warning.classList.toggle('action-dialog-warning--danger',!!options.danger);
    inputWrap.hidden=!hasInput;
    selectWrap.hidden=!hasSelect;
    if(hasInput){
      inputLabel.textContent=options.inputLabel;
      input.type=options.inputType==='password'?'password':'text';
      input.maxLength=Number.isInteger(options.maxLength)?options.maxLength:100;
      input.value=String(options.inputValue??'');
      input.placeholder=options.placeholder||'';
      input.autocomplete=input.type==='password'?'new-password':'off';
    }
    if(hasSelect){
      selectLabel.textContent=options.selectLabel||'Ação';
      select.replaceChildren();
      for(const item of options.selectOptions){
        const option=document.createElement('option');
        option.value=String(item.value);option.textContent=String(item.label);select.append(option);
      }
      select.value=String(options.selectValue??options.selectOptions[0].value);
    }
    confirmButton.textContent=options.confirmLabel||'Confirmar';
    confirmButton.className='button '+(options.danger?'danger':'primary');
    cancelButton.textContent=options.cancelLabel||'Cancelar';
    let settled=false;
    const cleanup=()=>{
      form.removeEventListener('submit',onSubmit);
      dialog.removeEventListener('cancel',onCancel);
      cancelButton.removeEventListener('click',onCancelClick);
      closeButton.removeEventListener('click',onCancelClick);
    };
    const finish=result=>{
      if(settled)return;
      settled=true;cleanup();
      if(dialog.open)dialog.close();
      resolve(result);
    };
    const onSubmit=event=>{
      event.preventDefault();
      const value=hasInput?input.value:hasSelect?select.value:true;
      finish({confirmed:true,value});
    };
    const onCancel=event=>{event.preventDefault();finish({confirmed:false,value:null});};
    const onCancelClick=()=>finish({confirmed:false,value:null});
    form.addEventListener('submit',onSubmit);
    dialog.addEventListener('cancel',onCancel);
    cancelButton.addEventListener('click',onCancelClick);
    closeButton.addEventListener('click',onCancelClick);
    dialog.showModal();
    if(hasInput)input.focus();
    else if(hasSelect)select.focus();
    else confirmButton.focus();
  });
  const pending=actionDialogQueue.then(open,open);
  actionDialogQueue=pending.then(()=>undefined,()=>undefined);
  return pending;
}
async function confirmWithDialog(options) {
  const result=await showActionDialog(options);
  return result.confirmed;
}
async function promptWithDialog(options) {
  const result=await showActionDialog(options);
  return result.confirmed?result.value:null;
}
function isSensitiveName(name) {
  const n=String(name).toLowerCase().replaceAll('_','').replaceAll('-','').replaceAll(' ','');
  return ['authorization','auth','bearer','token','secret','password','passwd','senha','credential','cookie','apikey','privatekey'].some(x=>n.includes(x));
}
function scrubCredentialText(value) {const i=value.toLowerCase().indexOf('bearer ');return i<0?value:`${value.slice(0,i)}Bearer [removido]`;}
function sanitizeBearer(value) {const t=String(value||'').trim().replace(/^Bearer\s+/i,'');return t.length<=8192&&!/[\r\n]/.test(t)?t:'';}
function normalizeAuthType(value,bearerToken=''){
  const type=String(value||'').trim();if(type==='api-key')return'apiKey';
  return['none','bearer','basic','apiKey'].includes(type)?type:(bearerToken?'bearer':'none');
}
function authFieldsFromForm(resolveValue=value=>value,includeCredentials=true){
  const authType=normalizeAuthType(byId('auth-type').value,byId('bearer-token').value),resolve=value=>resolveValue(String(value??''));
  return{authType,
    bearerToken:authType==='bearer'&&includeCredentials?sanitizeBearer(resolve(byId('bearer-token').value)):'',
    basicUsername:authType==='basic'&&includeCredentials?resolve(byId('basic-username').value):'',
    basicPassword:authType==='basic'&&includeCredentials?resolve(byId('basic-password').value):'',
    apiKeyName:authType==='apiKey'?byId('api-key-name').value.trim():'',
    apiKeyLocation:authType==='apiKey'&&byId('api-key-location').value==='query'?'query':'header',
    apiKeyValue:authType==='apiKey'&&includeCredentials?resolve(byId('api-key-value').value):''};
}
function applyAuthFields(request={}){
  const type=normalizeAuthType(request.authType,request.bearerToken);
  byId('auth-type').value=type;
  byId('bearer-token').value=type==='bearer'?sanitizeBearer(request.bearerToken):'';
  byId('basic-username').value=type==='basic'?String(request.basicUsername||''):'';
  byId('basic-password').value=type==='basic'?String(request.basicPassword||''):'';
  byId('api-key-name').value=type==='apiKey'?String(request.apiKeyName||''):'';
  byId('api-key-location').value=type==='apiKey'&&request.apiKeyLocation==='query'?'query':'header';
  byId('api-key-value').value=type==='apiKey'?String(request.apiKeyValue||''):'';
  updateAuthTypeUi();
}
function updateAuthTypeUi(){
  const type=normalizeAuthType(byId('auth-type').value,byId('bearer-token').value);byId('auth-type').value=type;
  byId('auth-bearer-fields').hidden=type!=='bearer';byId('auth-basic-fields').hidden=type!=='basic';byId('auth-api-key-fields').hidden=type!=='apiKey';
  byId('api-key-query-warning').hidden=type!=='apiKey'||byId('api-key-location').value!=='query';
  byId('auth-type-badge').textContent=type==='apiKey'?'API Key':type==='basic'?'Basic':type==='none'?'Sem auth':'Bearer';
}
function hasAuthCredentials(request){return!!(request?.bearerToken||request?.basicUsername||request?.basicPassword||request?.apiKeyValue);}
function authTypeLabel(request){const type=normalizeAuthType(request?.authType,request?.bearerToken);return type==='apiKey'?'API Key':type==='basic'?'Basic Auth':type==='bearer'?'Bearer':'sem autenticação';}
function protectTemplates(value) {
  const templates=[];const protectedValue=String(value||'').replace(/\{\{\s*([^{}]+?)\s*\}\}/g,match=>{const marker=`codexvar${templates.length}token`;templates.push(match);return marker;});
  return{value:protectedValue,restore:text=>String(text).replace(/codexvar(\d+)token/gi,(_,index)=>templates[Number(index)]||'')};
}
function sanitizeBase(value) {
  const source=String(value||'').trim();if(/^\{\{\s*[^{}]+\s*\}\}=?\/?$/.test(source))return{value:source.replace(/\/+$/,''),redacted:false};
  const protectedText=protectTemplates(source);
  try {const u=new URL(protectedText.value),redacted=!!(u.username||u.password||u.search||u.hash);u.username='';u.password='';u.search='';u.hash='';const raw=u.toString(),safe=raw.endsWith('/')?raw.slice(0,-1):raw;return{value:protectedText.restore(safe),redacted};}
  catch{return{value:protectedText.restore(protectedText.value),redacted:false};}
}
function sanitizeRoute(value) {
  const protectedText=protectTemplates(value);
  try {const u=new URL(protectedText.value,'http://localhost');let redacted=!!u.hash;u.hash='';const params=[...u.searchParams.entries()];u.search='';for(const[key,paramValue]of params){if(isSensitiveName(key)&&!/^codexvar\d+token$/i.test(paramValue)){redacted=true;continue;}u.searchParams.append(key,paramValue);}const raw=u.pathname+u.search,clean=scrubCredentialText(raw),safe=protectedText.restore(clean);return{value:safe,redacted:redacted||clean!==raw};}
  catch{return{value:protectedText.restore(protectedText.value),redacted:false};}
}
function splitRoute(value){return RunnerLogic.splitRoute(value);}
function sanitizeHeaders(value) {
  let redacted=false;const lines=[];
  for(const line of String(value).split('\n')){if(!line.trim())continue;const i=line.indexOf(':');if(i<=0){redacted=true;continue;}const name=line.slice(0,i).trim();if(!name||isSensitiveName(name)){redacted=true;continue;}const raw=line.slice(i+1).trim(),safe=scrubCredentialText(raw);redacted||=raw!==safe;lines.push(`${name}: ${safe}`);}
  return{value:lines.join('\n'),redacted};
}
function scrubJson(value,state) {
  if(Array.isArray(value))return value.map(x=>scrubJson(x,state));
  if(value&&typeof value==='object'){const safe={};for(const[k,v]of Object.entries(value)){if(isSensitiveName(k)&&!(typeof v==='string'&&/^\{\{\s*[^{}]+\s*\}\}$/.test(v.trim()))){state.redacted=true;continue;}safe[k]=scrubJson(v,state);}return safe;}
  if(typeof value==='string'){const safe=scrubCredentialText(value);state.redacted||=safe!==value;return safe;}return value;
}
function sanitizeBody(value) {
  const source=String(value||'');if(!source.trim())return{value:'',redacted:false};
  try{const state={redacted:false},parsed=JSON.parse(source),safe=scrubJson(parsed,state),text=JSON.stringify(safe,null,2);if(text.length>850000)return{value:'',redacted:true};return{value:text,redacted:state.redacted};}
  catch{
    const form=protectTemplates(source),pairs=form.value.split('&');
    if(source.includes('=')&&pairs.every(pair=>pair.includes('='))){const safe=new URLSearchParams();let redacted=false;for(const[key,value]of new URLSearchParams(form.value)){if(isSensitiveName(key)){redacted=true;continue;}const scrubbed=scrubCredentialText(value);redacted||=scrubbed!==value;safe.append(key,scrubbed);}const text=form.restore(safe.toString());return text.length<=850000?{value:text,redacted}:{value:'',redacted:true};}
    const credentialKey=/["']?(?:authorization|auth|bearer|token|secret|password|passwd|senha|credential|cookie|api[_-]?key|private[_-]?key)["']?\s*:/i.test(source)||/Bearer\s+[^\s"']+/i.test(source);return source.length<=850000&&!credentialKey?{value:source,redacted:false}:{value:'',redacted:true};
  }
}
function createQueryParamRow(name='',value='') {
  const n=++queryId,row=document.createElement('div');row.className='query-param-row';
  const nl=document.createElement('label');nl.htmlFor=`query-param-${n}-name`;nl.textContent='Chave';
  const ni=document.createElement('input');ni.id=nl.htmlFor;ni.type='text';ni.autocomplete='off';ni.spellcheck=false;ni.value=name;ni.dataset.queryName='';ni.setAttribute('aria-label','Chave do parâmetro');
  const nf=document.createElement('div');nf.append(nl,ni);
  const vl=document.createElement('label');vl.htmlFor=`query-param-${n}-value`;vl.textContent='Valor';
  const vi=document.createElement('input');vi.id=vl.htmlFor;vi.type=isSensitiveName(name)?'password':'text';vi.autocomplete=isSensitiveName(name)?'new-password':'off';vi.spellcheck=false;vi.value=value;vi.dataset.queryValue='';vi.setAttribute('aria-label','Valor do parâmetro');
  const vf=document.createElement('div');vf.append(vl,vi);
  const remove=document.createElement('button');remove.className='button secondary';remove.type='button';remove.textContent='×';remove.setAttribute('aria-label',`Remover parâmetro ${n}`);
  remove.onclick=()=>{row.remove();byId('confirm-test-data').checked=false;updateGuard();updateParamsCount();};
  ni.oninput=()=>{const secret=isSensitiveName(ni.value.trim());vi.type=secret?'password':'text';vi.autocomplete=secret?'new-password':'off';byId('confirm-test-data').checked=false;updateGuard();updateParamsCount();};
  vi.oninput=()=>{byId('confirm-test-data').checked=false;updateGuard();updateParamsCount();};row.append(nf,vf,remove);return row;
}
function renderQueryParams(entries){queryParams.replaceChildren();for(const [k,v]of entries)queryParams.append(createQueryParamRow(k,v));updateParamsCount();}
function addQueryParamRow(k='',v=''){const row=createQueryParamRow(k,v);queryParams.append(row);row.querySelector('[data-query-name]').focus();updateParamsCount();}
function updateParamsCount(){byId('params-count').textContent=String([...queryParams.children].filter(r=>r.querySelector('[data-query-name]').value.trim()).length);}
function buildRequestRoute(resolveValues=false,allowEmpty=false){
  let path=route.value.trim();if(!path&&allowEmpty)return'';if(!path.startsWith('/')||path.startsWith('//')||path.includes('?')||path.includes('#')||path.includes('\\')||path.includes('://'))throw Error('Informe um caminho iniciado por /. Use Params para a query.');
  if(resolveValues)path=applyEnvironment(path);
  const pairs=[];for(const row of queryParams.children){let k=row.querySelector('[data-query-name]').value.trim(),v=row.querySelector('[data-query-value]').value;if(!k&&!v)continue;if(!k)throw Error('Informe a chave de cada parâmetro preenchido.');if(resolveValues){k=applyEnvironment(k);v=applyEnvironment(v);}pairs.push(`${encodeParam(k)}=${encodeParam(v)}`);}
  return path+(pairs.length?'?'+pairs.join('&'):'');
}
function encodeParam(value){const templates=[];const text=String(value).replace(/\{\{\s*([^{}]+?)\s*\}\}/g,match=>{const marker=`APITESTTEMPLATE${templates.length}X`;templates.push(match);return marker;});return encodeURIComponent(text).replace(/APITESTTEMPLATE(\d+)X/g,(_,index)=>templates[Number(index)]||'');}
function tokenRequestConfigFromForm(){return RunnerLogic.normalizeTokenRequestConfig({route:byId('token-route').value,clientIdField:byId('token-client-id-field').value,clientSecretField:byId('token-client-secret-field').value,credentialMode:byId('token-credential-mode').value});}
function tokenRequestConfigStorageKey(){return TOKEN_REQUEST_CONFIG_KEY+':'+(activeEnvironmentId||'default');}
async function persistTokenRequestConfig(showError=false){
  try{tokenRequestConfig=tokenRequestConfigFromForm();await dbWrite('settings',{key:tokenRequestConfigStorageKey(),value:tokenRequestConfig});updateTokenButton();return true;}
  catch(error){if(showError)showToast('Configuração de token inválida',error.message||'Revise rota e nomes de campos.','error');return false;}
}
async function loadTokenRequestConfig(){
  const saved=await dbRead('settings',tokenRequestConfigStorageKey());tokenRequestConfig=RunnerLogic.normalizeTokenRequestConfig(saved?.value);
  byId('token-route').value=tokenRequestConfig.route;byId('token-client-id-field').value=tokenRequestConfig.clientIdField;byId('token-client-secret-field').value=tokenRequestConfig.clientSecretField;byId('token-credential-mode').value=tokenRequestConfig.credentialMode;updateTokenButton();
}
function updateTokenButton(){let config;try{config=tokenRequestConfigFromForm();}catch{tokenRequestButton.disabled=true;return;}tokenRequestButton.disabled=!config.route||!byId('token-client-id').value.trim()||!byId('token-client-secret').value;}
function remoteHttpWarning(origin){return `HTTP em ${origin} não cifra tráfego; credenciais, headers e body podem ser observados na rede.`;}
async function renderHistory(){
  const list=byId('request-history');list.replaceChildren();
  try{
    const entries=(await dbRead('history')).sort((a,b)=>Date.parse(b.savedAt||'')-Date.parse(a.savedAt||''));
    byId('history-count').textContent=String(entries.length);byId('clear-history').disabled=!entries.length;
    if(!entries.length){const empty=document.createElement('p');empty.className='history-empty';empty.textContent='Nenhuma requisição no histórico.';list.append(empty);return;}
    for(const entry of entries){
      const item=document.createElement('article');item.className='history-item';const info=document.createElement('div');info.className='history-info';
      const title=document.createElement('p');title.className='history-title';const m=document.createElement('span');m.className=`history-method ${String(entry.method||'GET').toLowerCase()}`;m.textContent=entry.method||'GET';
      const path=document.createElement('span');path.className='history-route';path.textContent=entry.route||'/api/';title.append(m,path);info.append(title);
      const actions=document.createElement('div');actions.className='history-actions';
      const load=document.createElement('button');load.className='button secondary';load.type='button';load.textContent='↩';load.title='Carregar';load.setAttribute('aria-label','Carregar '+(entry.route||'request'));load.onclick=()=>loadHistoryEntry(entry);
      const remove=document.createElement('button');remove.className='button secondary';remove.type='button';remove.textContent='×';remove.title='Excluir';remove.setAttribute('aria-label','Excluir '+(entry.route||'request'));remove.onclick=()=>removeHistory(entry.id);
      actions.append(load,remove);item.append(info,actions);list.append(item);
    }
  }catch{byId('history-count').textContent='–';byId('clear-history').disabled=true;const e=document.createElement('p');e.className='history-empty';e.textContent='Banco local indisponível.';list.append(e);}
}
async function saveHistory(request){
  const base=sanitizeBase(request.baseUrl),path=sanitizeRoute(request.route),headers=sanitizeHeaders(request.headers),payload=sanitizeBody(request.body);
  const saveAuth=request.saveBearerToken===true,authType=normalizeAuthType(request.authType,request.bearerToken);
  const bearerToken=saveAuth&&authType==='bearer'?sanitizeBearer(request.bearerToken):'';
  const basicUsername=saveAuth&&authType==='basic'?String(request.basicUsername||''):'';
  const basicPassword=saveAuth&&authType==='basic'?String(request.basicPassword||''):'';
  const apiKeyName=authType==='apiKey'?String(request.apiKeyName||'').trim():'';
  const apiKeyLocation=authType==='apiKey'&&request.apiKeyLocation==='query'?'query':'header';
  const apiKeyValue=saveAuth&&authType==='apiKey'?String(request.apiKeyValue||''):'';
  const authOmitted=!!request.authOmitted||(hasAuthCredentials(request)&&!saveAuth);
  if(!base.value||!path.value)return;
  const tokenRequest=!!request.tokenRequest,entry={
    id:newId(),savedAt:new Date().toISOString(),method:['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(request.method)?request.method:'GET',
    baseUrl:base.value,route:path.value,headers:headers.value,body:payload.value,authType,bearerToken,basicUsername,basicPassword,apiKeyName,apiKeyLocation,apiKeyValue,authOmitted,tokenRequest,allowInsecureHttp:request.allowInsecureHttp===true,
    tokenCredentialMode:tokenRequest?(request.tokenCredentialMode==='query'?'query':'body'):'',tokenClientId:tokenRequest?String(request.tokenClientId||'').trim():'',
    tokenClientIdField:tokenRequest?String(request.tokenClientIdField||'client_id'):'',tokenClientSecretField:tokenRequest?String(request.tokenClientSecretField||'client_secret'):'',
    redacted:base.redacted||path.redacted||headers.redacted||payload.redacted||authOmitted,
    captureResponseVariable:!!request.captureResponseVariable,responseVariableName:String(request.responseVariableName||''),responseValueSource:request.responseValueSource==='text'?'text':'json',responseJsonPath:String(request.responseJsonPath||''),responseSuccessOnly:request.responseSuccessOnly!==false,
    responseTests:RunnerLogic.normalizeResponseTests(request.responseTests)
  };
  try{await dbWrite('history',entry);byId('history-panel').open=true;await renderHistory();const message=entry.redacted?'Campos sensíveis foram omitidos conforme a opção de salvamento.':saveAuth&&hasAuthCredentials(entry)?'Request e credenciais de Auth salvas no banco local.':'Request salva sem credenciais de Auth.';showToast('Histórico salvo',message,'success',3500);}
  catch{showToast('Histórico indisponível','O navegador não permitiu salvar; a requisição seguirá normalmente.','warning');}
}
function applyHistoryEntry(entry,notify=true){
  byId('base-url').value=entry.baseUrl||'';baseUrlAuto=false;byId('allow-insecure-http').checked=entry.allowInsecureHttp===true;method.value=['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(entry.method)?entry.method:'GET';
  const parts=splitRoute(sanitizeRoute(String(entry.route||'')).value);route.value=parts.route;renderQueryParams(parts.params);
  byId('headers').value=sanitizeHeaders(String(entry.headers||'')).value;body.value=entry.tokenRequest?'':sanitizeBody(String(entry.body||'')).value;
  applyAuthFields(entry);if(hasAuthCredentials(entry))byId('save-token-history').checked=true;
  byId('token-client-id').value=entry.tokenRequest?String(entry.tokenClientId||''):'';byId('token-client-secret').value='';
  byId('token-credential-mode').value=entry.tokenCredentialMode==='query'?'query':'body';if(entry.tokenRequest){byId('token-route').value=parts.route;byId('token-client-id-field').value=entry.tokenClientIdField||'client_id';byId('token-client-secret-field').value=entry.tokenClientSecretField||'client_secret';tokenRequestConfig=RunnerLogic.normalizeTokenRequestConfig({route:parts.route,clientIdField:byId('token-client-id-field').value,clientSecretField:byId('token-client-secret-field').value,credentialMode:byId('token-credential-mode').value});}byId('token-helper').open=!!entry.tokenRequest;updateTokenButton();clearWriteConfirmation();updateGuard();updateCopyButtons();renderBodyHighlight();updateJsonTools();
  byId('capture-response-variable').checked=!!entry.captureResponseVariable;byId('response-variable-name').value=entry.responseVariableName||'token';byId('response-value-source').value=entry.responseValueSource==='text'?'text':'json';byId('response-json-path').value=entry.responseJsonPath||'access_token';byId('response-success-only').checked=entry.responseSuccessOnly!==false;byId('response-variable-result').hidden=true;updateResponseCaptureUi();setResponseTests(entry.responseTests||[]);
  activeSaved=null;byId('request-title').textContent='Histórico · '+(entry.route||'request');setEditorTab('params');
  if(notify)showToast('Requisição carregada',hasAuthCredentials(entry)?authTypeLabel(entry)+' recuperada; credenciais podem expirar.':'Params, headers e body recuperados. Credenciais foram omitidas ou precisam ser informadas.','info');
}
function tokenHistorySnapshot(request){
  return{baseUrl:request.baseUrl,route:request.route,method:'POST',headers:request.headers,body:'',authType:request.authType||'none',bearerToken:request.authType==='bearer'&&request.saveBearerToken?request.bearerToken:'',basicUsername:request.authType==='basic'&&request.saveBearerToken?request.basicUsername:'',basicPassword:request.authType==='basic'&&request.saveBearerToken?request.basicPassword:'',apiKeyName:request.authType==='apiKey'?request.apiKeyName:'',apiKeyLocation:request.apiKeyLocation==='query'?'query':'header',apiKeyValue:request.authType==='apiKey'&&request.saveBearerToken?request.apiKeyValue:'',authOmitted:hasAuthCredentials(request)&&!request.saveBearerToken,allowInsecureHttp:request.allowInsecureHttp===true,saveBearerToken:request.saveBearerToken===true,tokenRequest:true,tokenCredentialMode:request.tokenCredentialMode==='query'?'query':'body',tokenClientId:'',tokenClientIdField:request.tokenClientIdField,tokenClientSecretField:request.tokenClientSecretField};
}
function loadHistoryEntry(entry){openHistoryRequestInTab(entry);}
async function removeHistory(id){try{await dbWrite('history',id,true);await renderHistory();showToast('Item removido','Requisição removida do histórico local.','info');}catch{showToast('Histórico indisponível','Não foi possível atualizar o histórico.','error');}}
async function clearHistory(){
  const count=Number(byId('history-count').textContent)||0;
  if(!count||!(await confirmWithDialog({eyebrow:'HISTÓRICO',title:'Limpar histórico?',description:'As '+count+' requisições salvas neste navegador serão removidas.',confirmLabel:'Limpar histórico',danger:true})))return;
  try{await dbWrite('history',null,'clear');await renderHistory();showToast('Histórico limpo','Requisições removidas deste navegador.','success');}
  catch{showToast('Histórico indisponível','Não foi possível limpar o histórico.','error');}
}

function findCollection(id){return collections.find(x=>x.id===id);}
function findFolder(collection,id){if(!id)return collection;for(const folder of collection?.folders||[]){if(folder.id===id)return folder;const child=findFolder(folder,id);if(child)return child;}return null;}
function findParent(collection,id,parent=collection){for(const folder of parent?.folders||[]){if(folder.id===id)return parent;const found=findParent(collection,id,folder);if(found)return found;}return null;}
function selectContainer(collectionId,folderId=''){selectedContainer={collectionId,folderId};renderCollectionTree();}
function findFolderPath(collection,id,path=[]){for(const folder of collection?.folders||[]){const next=[...path,folder.name];if(folder.id===id)return next;const found=findFolderPath(folder,id,next);if(found)return found;}return null;}
function runnerWriteCases(cases){return cases.filter(item=>!item.request.tokenRequest&&writeMethods.has(String(item.request.method||'GET').toUpperCase()));}
async function confirmRunnerRemoteHttp(cases){
  const origins=RunnerLogic.remoteHttpOrigins(cases,getEnvironment().variables||{}),queryKeyCases=cases.filter(item=>item?.request?.authType==='apiKey'&&item.request.apiKeyLocation==='query');
  if(!origins.length&&!queryKeyCases.length)return true;
  const warnings=[];
  if(origins.length)warnings.push('Headers, bodies e credenciais podem ser observados na rede.');
  if(queryKeyCases.length)warnings.push('API Keys na query podem aparecer em logs e históricos do servidor.');
  const detail=[...origins,...(queryKeyCases.length?['API Key em query: '+queryKeyCases.length+' request(s)']:[])].join('\n');
  return confirmWithDialog({eyebrow:'TRANSPORTE E CREDENCIAIS',title:origins.length?'Executar Runner sem HTTPS?':'Executar Runner com API Key na query?',description:'Confira os destinos antes da execução.',detail,warning:warnings.join(' '),confirmLabel:'Executar Runner',danger:true});
}
function renderRunnerPlan(entries){
  const list=byId('runner-plan-list');list.replaceChildren();
  for(const entry of entries){
    const row=document.createElement('div');row.className='runner-plan-item';
    const badge=document.createElement('span');badge.className=`method-dot ${String(entry.request.method||'GET').toLowerCase()}`;badge.textContent=String(entry.request.method||'GET').toUpperCase();
    const copy=document.createElement('div');copy.className='runner-item-copy';
    const name=document.createElement('strong');name.textContent=entry.request.name||entry.request.route||'Request';copy.append(name);
    const path=document.createElement('small');path.textContent=entry.request.tokenRequest?'Credenciais exigem o fluxo Solicitar token.':entry.path;copy.append(path);
    row.append(badge,copy);list.append(row);
  }
}
function renderRunnerCases(cases){
  const list=byId('runner-results');list.replaceChildren();
  for(const item of cases){
    const row=document.createElement('article');row.className='runner-result-item';row.dataset.state='pending';
    const badge=document.createElement('span');badge.className=`method-dot ${String(item.request.method||'GET').toLowerCase()}`;badge.textContent=String(item.request.method||'GET').toUpperCase();
    const copy=document.createElement('div');copy.className='runner-item-copy';
    const name=document.createElement('strong');name.textContent=item.request.name||item.request.route||'Request';copy.append(name);
    const path=document.createElement('small');path.textContent=`${item.path} · Conjunto ${item.datasetNumber}`;copy.append(path);
    const state=document.createElement('span');state.className='runner-state';state.textContent='Aguardando';
    const details=document.createElement('details');details.hidden=true;const summary=document.createElement('summary');summary.textContent='Detalhes da resposta';const pre=document.createElement('pre');details.append(summary,pre);
    row.append(badge,copy,state,details);list.append(row);item.view={row,state,details,summary,pre};
  }
}
function setRunnerCase(item,state,text,detail='',responseBody=''){
  if(!item.view)return;item.view.row.dataset.state=state;item.view.state.textContent=text;
  const pieces=[detail,responseBody].filter(Boolean);item.view.details.hidden=pieces.length===0;
  if(pieces.length){item.view.summary.textContent=detail||'Body da resposta';item.view.pre.textContent=responseBody;}
}
function runnerBodyPreview(value){
  const raw=String(value??'');if(!raw)return'';const sanitized=sanitizeBody(raw);if(!sanitized.value)return sanitized.redacted?'Body omitido por conter dados sensíveis.':'';
  return sanitized.value.length>6000?sanitized.value.slice(0,6000)+'\n… Body truncado na visualização.':sanitized.value;
}
function showRunnerError(message){const error=byId('runner-error');error.textContent=message;error.hidden=false;}
function clearRunnerError(){const error=byId('runner-error');error.textContent='';error.hidden=true;}
function fitRunnerDialog(){
  const scale=Math.max(MIN_UI_SCALE,activeScale||1),height=window.visualViewport?.height||window.innerHeight,width=window.visualViewport?.width||window.innerWidth,dialog=byId('runner-dialog');
  dialog.style.maxHeight=`${Math.max(240,Math.min(820,(height-40)/scale))}px`;
  dialog.style.width=`${Math.max(240,Math.min(760,(width-40)/scale))}px`;
}
function openRunnerDialog(){
  const collection=findCollection(selectedContainer.collectionId),target=findFolder(collection,selectedContainer.folderId);
  if(!collection||!target){showToast('Seleção indisponível','Selecione uma coleção ou pasta válida.','error');return;}
  const folderPath=selectedContainer.folderId?findFolderPath(collection,selectedContainer.folderId):[];
  const ancestors=selectedContainer.folderId?[collection.name,...(folderPath||[]).slice(0,-1)]:[];
  runnerEntries=RunnerLogic.flattenRequests(target,ancestors);
  if(!runnerEntries.length){showToast('Sem requests','A seleção não contém requests salvas para executar.','info');return;}
  const targetPath=[collection.name,...(folderPath||[])].join(' / '),writes=runnerEntries.filter(entry=>!entry.request.tokenRequest&&writeMethods.has(String(entry.request.method||'GET').toUpperCase())).length;
  byId('runner-target-title').textContent=targetPath;byId('runner-plan-count').textContent=`${runnerEntries.length} requests · ${writes} ${writes===1?'gravação':'gravações'}`;
  byId('runner-write-guard').hidden=!writes;byId('runner-write-description').textContent=writes?`${writes===1?'1 chamada':`${writes} chamadas`} POST, PUT, PATCH ou DELETE podem alterar dados.`:'';
  byId('runner-confirm-writes').checked=false;byId('runner-write-phrase').value='';byId('runner-datasets').value='';byId('runner-delay').value='0';byId('runner-stop-on-error').checked=true;
  renderRunnerPlan(runnerEntries);byId('runner-results').replaceChildren();byId('runner-progress').hidden=true;byId('runner-progress').value=0;byId('runner-progress-label').textContent='';byId('runner-summary').hidden=true;byId('rerun-failed').hidden=true;byId('stop-runner').hidden=true;clearRunnerError();byId('start-runner').disabled=false;byId('runner-options').disabled=false;
  fitRunnerDialog();byId('runner-dialog').showModal();
}
async function confirmRunnerWrites(cases){
  const writes=runnerWriteCases(cases);if(!writes.length)return true;
  if(!byId('runner-confirm-writes').checked||byId('runner-write-phrase').value.trim()!=='TESTE'){
    showRunnerError('Confirme que os dados são de teste e digite TESTE antes de executar gravações.');byId('runner-write-phrase').focus();return false;
  }
  const destinations=[];
  for(const item of writes.slice(0,12)){
    try{const request=RunnerLogic.prepareSavedRequest(item.request,getEnvironment().variables||{},item.dataset,true);destinations.push(`${request.method} ${sanitizeBase(request.baseUrl).value}${sanitizeRoute(request.route).value}`);}
    catch{destinations.push(`${String(item.request.method).toUpperCase()} · ${item.path}`);}
  }
  if(writes.length>destinations.length)destinations.push(`… e mais ${writes.length-destinations.length} gravações`);
  return confirmWithDialog({eyebrow:'RUNNER DE TESTE',title:`Executar ${writes.length} gravações?`,description:`A sequência inclui ${writes.length} POST, PUT, PATCH ou DELETE.`,detail:destinations.join('\n'),warning:'A confirmação vale para todas as gravações desta execução. Confira ambiente, URLs e dados descartáveis.',confirmLabel:'Executar gravações',danger:true});
}
function requestRunnerStop(){if(!runnerBusy)return;runnerStopRequested=true;byId('stop-runner').disabled=true;byId('stop-runner').textContent='Parando…';byId('runner-progress-label').textContent='A request atual terminará antes de parar.';}
function updateRunnerOptionsDisabled(disabled){byId('runner-options').disabled=disabled;byId('start-runner').disabled=disabled;byId('cancel-runner').disabled=disabled;byId('close-runner').disabled=disabled;}
async function runRunnerCases(cases,options,allowWrites){
  const runCases=[...cases];runnerBusy=true;runnerStopRequested=false;runnerFailedCases=[];clearRunnerError();renderRunnerCases(runCases);
  const progress=byId('runner-progress');progress.hidden=false;progress.max=Math.max(1,runCases.length);progress.value=0;byId('runner-progress-label').textContent=`0 / ${runCases.length}`;byId('runner-summary').hidden=true;byId('rerun-failed').hidden=true;byId('stop-runner').hidden=false;byId('stop-runner').disabled=false;byId('stop-runner').textContent='Parar após esta request';updateRunnerOptionsDisabled(true);
  const started=performance.now();let passed=0,failed=0,skipped=0,processed=0,stoppedByFailure=false;
  for(let index=0;index<runCases.length;index++){
    const item=runCases[index];
    if(runnerStopRequested){for(let rest=index;rest<runCases.length;rest++){setRunnerCase(runCases[rest],'skipped','Parada solicitada');skipped++;}break;}
    byId('runner-progress-label').textContent=`${index+1} / ${runCases.length} · Conjunto ${item.datasetNumber}`;setRunnerCase(item,'running','Executando…');
    const requestStarted=performance.now();let caseFailed=false,caseStatus='Falha',caseDetail='',responseBody='';
    try{
      const request=RunnerLogic.prepareSavedRequest(item.request,getEnvironment().variables||{},item.dataset,allowWrites);
      const {proxyStatus,result}=await executeApiRequest(request),status=Number(result.status)||0,tests=RunnerLogic.evaluateResponseTests(request.responseTests,result),failedTests=tests.filter(item=>!item.passed),hasTests=tests.length>0;
      responseBody=runnerBodyPreview(result.body);caseStatus=status?`${status} ${result.reason||''}`.trim():`Proxy ${proxyStatus}`;
      const details=[];const httpFailed=!!result.error||proxyStatus>=400||status<200||status>=300&&!hasTests;
      if(result.error||proxyStatus>=400)details.push(result.error||`Servidor local respondeu HTTP ${proxyStatus}.`);
      else if(status<200||status>=300&&!hasTests)details.push('A request não retornou status 2xx.');
      if(failedTests.length)details.push('Falharam: '+failedTests.map(item=>item.label).join('; '));
      else if(hasTests)details.push(`${tests.length}/${tests.length} testes passaram.`);
      if(!result.error&&proxyStatus<400&&status>=200&&status<300){
        const captured=await captureResponseVariable(request,result,true);
        if(!captured.ok){caseFailed=true;details.push(captured.error||'Falha ao salvar variável de resposta.');}
        else if(captured.captured)details.push(`{{${captured.name}}} salva no ambiente ${captured.environment}.`);
      }
      caseFailed=caseFailed||httpFailed||failedTests.length>0;caseDetail=details.join(' ');
    }catch(error){caseFailed=true;caseStatus='Falha';caseDetail=error.message||'Não foi possível preparar ou enviar esta request.';}
    caseStatus+=` · ${Math.round(performance.now()-requestStarted)} ms`;
    processed++;progress.value=processed;
    if(caseFailed){failed++;runnerFailedCases.push(item);setRunnerCase(item,'failure',caseStatus,caseDetail,responseBody);}
    else{passed++;setRunnerCase(item,'success',caseStatus,caseDetail,responseBody);}
    if(caseFailed&&options.stopOnError){stoppedByFailure=true;for(let rest=index+1;rest<runCases.length;rest++){setRunnerCase(runCases[rest],'skipped','Parada após falha');skipped++;}break;}
    if(options.delay>0&&index<runCases.length-1){byId('runner-progress-label').textContent=`${processed} / ${runCases.length} · aguardando ${options.delay} ms`;await new Promise(resolve=>setTimeout(resolve,options.delay));}
  }
  const elapsed=((performance.now()-started)/1000).toFixed(1),summary=`${passed} concluídas · ${failed} falhas · ${skipped} não executadas · ${elapsed}s`+(stoppedByFailure?' · parada na primeira falha':'')+(runnerStopRequested?' · parada solicitada':'');
  byId('runner-progress-label').textContent=`${processed} / ${runCases.length}`;byId('runner-summary').textContent=summary;byId('runner-summary').hidden=false;byId('stop-runner').hidden=true;byId('stop-runner').disabled=false;byId('stop-runner').textContent='Parar após esta request';updateRunnerOptionsDisabled(false);runnerBusy=false;
  byId('rerun-failed').hidden=runnerFailedCases.length===0;
  showToast(failed?'Runner finalizado com falhas':'Runner finalizado',summary,failed?'warning':'success');
}
async function startRunnerFromForm(event){
  event.preventDefault();if(runnerBusy)return;clearRunnerError();
  try{
    const datasets=RunnerLogic.parseDataSets(byId('runner-datasets').value),total=runnerEntries.length*datasets.length;
    if(total>500)throw Error('A execução excede o limite de 500 requests. Reduza os conjuntos de dados ou selecione uma pasta menor.');
    const delay=Number(byId('runner-delay').value);if(!Number.isInteger(delay)||delay<0||delay>5000)throw Error('O intervalo precisa ficar entre 0 e 5000 ms.');
    const cases=[];for(let datasetIndex=0;datasetIndex<datasets.length;datasetIndex++)for(const entry of runnerEntries)cases.push({...entry,dataset:datasets[datasetIndex],datasetNumber:datasetIndex+1});
    const writes=runnerWriteCases(cases);
    if(writes.length&&!(await confirmRunnerWrites(cases)))return;
    if(!(await confirmRunnerRemoteHttp(cases)))return;
    await runRunnerCases(cases,{delay,stopOnError:byId('runner-stop-on-error').checked},writes.length>0);
  }catch(error){showRunnerError(error.message||'Revise as opções do Runner.');}
}
async function rerunRunnerFailures(){
  if(runnerBusy||!runnerFailedCases.length)return;const cases=[...runnerFailedCases],writes=runnerWriteCases(cases);
  try{if(writes.length&&!(await confirmRunnerWrites(cases)))return;if(!(await confirmRunnerRemoteHttp(cases)))return;await runRunnerCases(cases,{delay:Number(byId('runner-delay').value)||0,stopOnError:byId('runner-stop-on-error').checked},writes.length>0);}
  catch(error){showRunnerError(error.message||'Revise as opções do Runner.');}
}
function activeWorkspaceTab(){return workspaceTabs.find(tab=>tab.id===activeWorkspaceTabId)||null;}
function captureResponseTestDraft(){return[...byId('response-tests-list').querySelectorAll('.response-test-row')].map(row=>({id:row.dataset.testId,target:row.querySelector('.response-test-target').value,path:row.querySelector('.response-test-path').value,operator:row.querySelector('.response-test-operator').value,expected:row.querySelector('.response-test-expected').value}));}
function captureWorkspaceDraft(){
  return{title:byId('request-title').textContent||'Nova requisição',method:method.value,baseUrl:byId('base-url').value,baseUrlAuto,allowInsecureHttp:byId('allow-insecure-http').checked,route:route.value,params:[...queryParams.children].map(row=>[row.querySelector('[data-query-name]').value,row.querySelector('[data-query-value]').value]),headers:byId('headers').value,body:body.value,...authFieldsFromForm(value=>value,true),saveBearerToken:byId('save-token-history').checked,tokenClientId:byId('token-client-id').value,tokenCredentialMode:byId('token-credential-mode').value,tokenHelperOpen:byId('token-helper').open,captureResponseVariable:byId('capture-response-variable').checked,responseVariableName:byId('response-variable-name').value,responseValueSource:byId('response-value-source').value,responseJsonPath:byId('response-json-path').value,responseSuccessOnly:byId('response-success-only').checked,responseTests:captureResponseTestDraft(),activeSaved:activeSaved?{...activeSaved}:null,collectionId:selectedContainer.collectionId,folderId:selectedContainer.folderId,editorSection:document.querySelector('[data-editor-tab][aria-selected="true"]')?.dataset.editorTab||'params'};
}
function restoreResponseTestDraft(tests){
  const list=byId('response-tests-list');list.replaceChildren();
  for(const source of(Array.isArray(tests)?tests:[]).slice(0,20)){
    const target=source?.target==='status'?'status':'json',fallback=target==='status'?{id:String(source.id||newId()),target,operator:'equals',expected:'200'}:{id:String(source?.id||newId()),target,path:'data.id',operator:'exists',expected:''},row=createResponseTestRow(fallback);
    const targetField=row.querySelector('.response-test-target');targetField.value=target;updateResponseTestRow(row,true);
    row.querySelector('.response-test-path').value=String(source?.path??'');row.querySelector('.response-test-expected').value=String(source?.expected??'');
    const operator=row.querySelector('.response-test-operator');operator.value=String(source?.operator||'');row.dataset.operator=operator.value;updateResponseTestRow(row,false);list.append(row);
  }
  renderResponseTestResults([]);
}
function renderWorkspaceTabs(){
  const list=byId('workspace-tabs');if(!list)return;list.replaceChildren();
  for(const tab of workspaceTabs){
    const item=document.createElement('div');item.className='workspace-tab-item';item.setAttribute('role','presentation');
    const select=document.createElement('button');select.className='workspace-tab';select.type='button';select.setAttribute('role','tab');select.setAttribute('aria-selected',String(tab.id===activeWorkspaceTabId));select.setAttribute('aria-controls','request-workspace-panel');select.tabIndex=tab.id===activeWorkspaceTabId?0:-1;select.dataset.workspaceTabId=tab.id;select.title=tab.title;select.onclick=()=>void activateWorkspaceTab(tab.id);
    const methodName=String(tab.request?.method||tab.rawDraft?.method||'GET').toUpperCase(),methodClass=['get','post','put','patch','delete'].includes(methodName.toLowerCase())?` ${methodName.toLowerCase()}`:'';
    const badge=document.createElement('span');badge.className='workspace-tab-method'+methodClass;badge.textContent=methodName;
    const name=document.createElement('span');name.className='workspace-tab-name';name.textContent=tab.title||'Nova requisição';select.append(badge,name);
    if(tab.dirty){const dirty=document.createElement('span');dirty.className='workspace-tab-dirty';dirty.setAttribute('aria-hidden','true');select.append(dirty);select.setAttribute('aria-label',`${tab.title||'Nova requisição'} com alterações não salvas`);}
    item.append(select);
    const close=document.createElement('button');close.className='workspace-tab-close';close.type='button';close.dataset.closeWorkspaceTab=tab.id;close.setAttribute('aria-label','Fechar '+(tab.title||'Nova requisição'));close.title='Fechar aba';close.innerHTML='<svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m4 4 8 8M12 4l-8 8"></path></svg>';close.onclick=event=>{event.stopPropagation();void closeWorkspaceTab(tab.id);};item.append(close);list.append(item);
  }
}
function persistableWorkspaceTabs(){return RunnerLogic.normalizeWorkspaceTabs({activeId:activeWorkspaceTabId,tabs:workspaceTabs.map(({id,title,request,activeSaved,collectionId,folderId,editorSection,saveBearerToken,dirty})=>({id,title,request,activeSaved,collectionId,folderId,editorSection,saveBearerToken,dirty}))});}
async function persistWorkspaceTabsNow(){
  try{await dbWrite('settings',{key:WORKSPACE_TABS_KEY,value:persistableWorkspaceTabs()});workspaceTabsStorageWarning=false;}
  catch{if(!workspaceTabsStorageWarning){showToast('Abas não salvas','O banco local não conseguiu persistir as abas abertas.','warning');workspaceTabsStorageWarning=true;}}
}
function scheduleWorkspaceTabsPersist(){clearTimeout(workspaceTabsSaveTimer);workspaceTabsSaveTimer=setTimeout(()=>void persistWorkspaceTabsNow(),250);}
function syncActiveWorkspaceTab(markDirty=false){
  if(workspaceTabsLoading)return activeWorkspaceTab();
  const tab=activeWorkspaceTab();if(!tab)return null;const draft=captureWorkspaceDraft();tab.rawDraft=draft;tab.title=draft.title||tab.title;tab.activeSaved=draft.activeSaved;tab.collectionId=draft.collectionId;tab.folderId=draft.folderId;tab.editorSection=draft.editorSection;tab.saveBearerToken=draft.saveBearerToken;
  if(markDirty)tab.dirty=true;
  try{tab.request=getSnapshot();}catch{}
  renderWorkspaceTabs();scheduleWorkspaceTabsPersist();return tab;
}
function clearWorkspaceResponse(){showResponse('Aguardando envio','idle','','');byId('response-variable-result').hidden=true;renderResponseTestResults([]);}
function applyWorkspaceDraft(draft){
  method.value=['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(draft.method)?draft.method:'GET';byId('base-url').value=draft.baseUrl||'';baseUrlAuto=!!draft.baseUrlAuto;byId('allow-insecure-http').checked=draft.allowInsecureHttp===true;route.value=String(draft.route??'');renderQueryParams(Array.isArray(draft.params)?draft.params:[]);byId('headers').value=draft.headers||'';body.value=draft.body||'';byId('save-token-history').checked=draft.saveBearerToken!==false;applyAuthFields(draft);byId('token-client-id').value=draft.tokenClientId||'';byId('token-client-secret').value='';byId('token-helper').open=!!draft.tokenHelperOpen;
  byId('capture-response-variable').checked=!!draft.captureResponseVariable;byId('response-variable-name').value=draft.responseVariableName||'token';byId('response-value-source').value=draft.responseValueSource==='text'?'text':'json';byId('response-json-path').value=draft.responseJsonPath||'access_token';byId('response-success-only').checked=draft.responseSuccessOnly!==false;byId('response-variable-result').hidden=true;restoreResponseTestDraft(draft.responseTests);
  activeSaved=draft.activeSaved||null;selectedContainer={collectionId:draft.collectionId||'',folderId:draft.folderId||''};byId('request-title').textContent=draft.title||'Nova requisição';clearWriteConfirmation();updateGuard();updateTokenButton();updateCopyButtons();updateResponseCaptureUi();renderBodyHighlight();updateJsonTools();renderCollectionTree();setEditorTab(draft.editorSection||'params');
}
function applyWorkspaceTab(tab){
  workspaceTabsLoading=true;
  try{
    if(tab.rawDraft)applyWorkspaceDraft(tab.rawDraft);
    else{
      loadCollectionRequest(tab.request,tab.collectionId,tab.folderId,false);byId('save-token-history').checked=tab.saveBearerToken!==false;
      const collection=findCollection(tab.collectionId),container=findFolder(collection,tab.folderId),exists=!!tab.activeSaved&&!!container?.requests?.some(request=>request.id===tab.activeSaved.id);
      activeSaved=exists?tab.activeSaved:null;selectedContainer=collection&&container?{collectionId:tab.collectionId,folderId:tab.folderId}:{collectionId:collections[0]?.id||'',folderId:''};byId('request-title').textContent=tab.title||'Nova requisição';setEditorTab(tab.editorSection||'params');
    }
  }finally{workspaceTabsLoading=false;}
  tab.rawDraft=captureWorkspaceDraft();tab.saveBearerToken=byId('save-token-history').checked;try{tab.request=getSnapshot();}catch{}
}function activateWorkspaceTab(id){
  const target=workspaceTabs.find(tab=>tab.id===id);if(!target||id===activeWorkspaceTabId)return;const keepFocus=byId('workspace-tabs').contains(document.activeElement);syncActiveWorkspaceTab();activeWorkspaceTabId=id;applyWorkspaceTab(target);clearWorkspaceResponse();renderWorkspaceTabs();scheduleWorkspaceTabsPersist();
  if(keepFocus){const selected=[...byId('workspace-tabs').querySelectorAll('[role="tab"]')].find(tab=>tab.dataset.workspaceTabId===id);selected?.focus();}
}function createWorkspaceTabFromCurrent(title){
  byId('request-title').textContent=title||'Nova requisição';const draft=captureWorkspaceDraft();let request;
  try{request=getSnapshot();}catch(error){showToast('Revise a requisição',error.message||'Corrija os campos antes de abrir a aba.','error');return null;}
  const tab={id:newId(),title:draft.title,request,activeSaved:draft.activeSaved,collectionId:draft.collectionId,folderId:draft.folderId,editorSection:draft.editorSection,saveBearerToken:draft.saveBearerToken,dirty:false,rawDraft:draft};workspaceTabs.push(tab);activeWorkspaceTabId=tab.id;clearWorkspaceResponse();renderWorkspaceTabs();scheduleWorkspaceTabsPersist();return tab;
}
function nextWorkspaceDraftTitle(){let index=1,title='Nova requisição';while(workspaceTabs.some(tab=>tab.title===title)){index++;title=`Nova requisição ${index}`;}return title;}
function resetEditorForNewWorkspaceTab(title){
  method.value='GET';byId('base-url').value=Object.hasOwn(getEnvironment().variables||{},'baseUrl')?'{{baseUrl}}':'';baseUrlAuto=true;route.value='';byId('allow-insecure-http').checked=false;byId('headers').value='Accept: application/json';body.value='';byId('save-token-history').checked=true;applyAuthFields({authType:'none'});
  byId('token-client-id').value='';byId('token-client-secret').value='';byId('token-helper').open=false;byId('capture-response-variable').checked=false;byId('response-variable-name').value='token';byId('response-value-source').value='json';byId('response-json-path').value='access_token';byId('response-success-only').checked=true;setResponseTests([]);updateResponseCaptureUi();
  activeSaved=null;selectedContainer={collectionId:collections[0]?.id||'',folderId:''};byId('request-title').textContent=title;renderQueryParams([]);clearWriteConfirmation();updateGuard();renderBodyHighlight();updateJsonTools();setEditorTab('params');
}
function createNewWorkspaceTab(notify=true){
  if(workspaceTabs.length>=MAX_WORKSPACE_TABS){showToast('Limite de abas','Feche uma aba antes de abrir outra.','warning');return false;}
  syncActiveWorkspaceTab();const title=nextWorkspaceDraftTitle();activeWorkspaceTabId='';resetEditorForNewWorkspaceTab(title);const tab=createWorkspaceTabFromCurrent(title);if(tab&&notify)showToast('Nova aba','Rascunho pronto; salve a requisi\u00e7\u00e3o numa cole\u00e7\u00e3o para reutilizar.','info');return !!tab;
}
function openCollectionRequestInTab(request,collectionId,folderId){
  const existing=workspaceTabs.find(tab=>tab.activeSaved?.id===request.id&&tab.collectionId===collectionId&&tab.folderId===folderId);
  if(existing){activateWorkspaceTab(existing.id);return;}
  if(workspaceTabs.length>=MAX_WORKSPACE_TABS){showToast('Limite de abas','Feche uma aba antes de abrir outra.','warning');return;}
  const saved={id:request.id,name:request.name,collectionId,folderId},tab={id:newId(),title:request.name||request.route||'Requisição salva',request:{...request},activeSaved:saved,collectionId,folderId,editorSection:'params',saveBearerToken:hasAuthCredentials(request)||byId('save-token-history').checked,dirty:false,rawDraft:null};workspaceTabs.push(tab);activateWorkspaceTab(tab.id);showToast('Requisição aberta','Request aberta em nova aba.','success',2500);
}
function closeWorkspaceTab(id){
  const index=workspaceTabs.findIndex(tab=>tab.id===id);if(index<0)return;const tab=workspaceTabs[index];void closeWorkspaceTabAfterConfirm(index,id,tab.dirty);
}
async function closeWorkspaceTabAfterConfirm(index,id,dirty){
  if(dirty&&!await confirmWithDialog({eyebrow:'ABAS',title:'Descartar alterações?',description:'A aba tem alterações não salvas. Fechar descarta este rascunho.',confirmLabel:'Descartar e fechar',danger:true}))return;
  workspaceTabs.splice(index,1);const wasActive=activeWorkspaceTabId===id;
  if(wasActive){activeWorkspaceTabId='';if(workspaceTabs.length)activateWorkspaceTab(workspaceTabs[Math.max(0,index-1)].id);else{const title=nextWorkspaceDraftTitle();resetEditorForNewWorkspaceTab(title);createWorkspaceTabFromCurrent(title);}}
  else renderWorkspaceTabs();scheduleWorkspaceTabsPersist();
}
function openHistoryRequestInTab(entry){
  if(workspaceTabs.length>=MAX_WORKSPACE_TABS){showToast('Limite de abas','Feche uma aba antes de abrir outra.','warning');return;}
  syncActiveWorkspaceTab();activeWorkspaceTabId='';applyHistoryEntry(entry,false);const title=byId('request-title').textContent,tab=createWorkspaceTabFromCurrent(title);if(tab){tab.activeSaved=null;tab.dirty=false;tab.rawDraft=captureWorkspaceDraft();scheduleWorkspaceTabsPersist();showToast('Histórico aberto',hasAuthCredentials(entry)?authTypeLabel(entry)+' restaurada do histórico.':'Request aberta; credenciais foram omitidas ou precisam ser informadas.','info');}
}
async function initializeWorkspaceTabs(){
  const saved=await dbRead('settings',WORKSPACE_TABS_KEY),state=RunnerLogic.normalizeWorkspaceTabs(saved?.value);workspaceTabs=state.tabs;activeWorkspaceTabId='';
  if(!workspaceTabs.length){createWorkspaceTabFromCurrent(byId('request-title').textContent||'Nova requisição');return;}
  activeWorkspaceTabId=state.activeId;const active=activeWorkspaceTab();if(active){applyWorkspaceTab(active);clearWorkspaceResponse();}renderWorkspaceTabs();scheduleWorkspaceTabsPersist();
}
function markActiveWorkspaceTabSaved(saved){
  const tab=activeWorkspaceTab();if(!tab)return;tab.title=saved.name;tab.request=getSnapshot();tab.saveBearerToken=byId('save-token-history').checked;tab.activeSaved={id:saved.id,name:saved.name,collectionId:activeSaved.collectionId,folderId:activeSaved.folderId};tab.collectionId=activeSaved.collectionId;tab.folderId=activeSaved.folderId;tab.editorSection=document.querySelector('[data-editor-tab][aria-selected="true"]')?.dataset.editorTab||'params';tab.dirty=false;tab.rawDraft=captureWorkspaceDraft();renderWorkspaceTabs();scheduleWorkspaceTabsPersist();
}function makeContainerRow(item,collectionId,folderId,kind,count){
  const row=document.createElement('div');row.className=kind==='collection'?'collection-row':'folder-row';
  const expand=document.createElement('button');expand.className='tree-tool tree-expand';expand.type='button';expand.textContent=collapsed.has(item.id)?'›':'⌄';expand.setAttribute('aria-label',collapsed.has(item.id)?'Expandir':'Recolher');
  expand.onclick=()=>{collapsed.has(item.id)?collapsed.delete(item.id):collapsed.add(item.id);renderCollectionTree();};
  const select=document.createElement('button');select.className='tree-select'+(selectedContainer.collectionId===collectionId&&selectedContainer.folderId===folderId?' selected':'');select.type='button';select.title=item.name;
  const icon=document.createElement('span');icon.className='tree-icon';icon.textContent=kind==='collection'?'▤':'▰';
  const name=document.createElement('span');name.className='tree-name';name.textContent=item.name;select.append(icon,name);
  if(count){const badge=document.createElement('span');badge.className='tree-count';badge.textContent=String(count);select.append(badge);}
  select.onclick=()=>selectContainer(collectionId,folderId);
  const add=document.createElement('button');add.className='tree-tool';add.type='button';add.textContent='+';add.title='Criar subpasta';add.setAttribute('aria-label','Criar subpasta em '+item.name);add.onclick=()=>addFolder(collectionId,folderId);
  const menu=document.createElement('button');menu.className='tree-tool';menu.type='button';menu.textContent='···';menu.title='Renomear ou excluir';menu.onclick=()=>manageNode(collectionId,folderId,kind);
  row.append(expand,select,add,menu);return row;
}
function appendSavedRequest(parent,request,collectionId,folderId){
  const row=document.createElement('div');row.className='saved-request-row';const select=document.createElement('button');select.className='tree-select';select.type='button';select.title=request.name;
  const m=document.createElement('span');m.className=`method-dot ${String(request.method||'GET').toLowerCase()}`;m.textContent=request.method||'GET';
  const label=document.createElement('span');label.className='tree-name';label.textContent=request.name||request.route||'Request';select.append(m,label);select.onclick=()=>openCollectionRequestInTab(request,collectionId,folderId);
  const remove=document.createElement('button');remove.className='tree-tool';remove.type='button';remove.textContent='×';remove.title='Excluir requisição salva';remove.setAttribute('aria-label','Excluir '+request.name);remove.onclick=()=>deleteCollectionRequest(collectionId,folderId,request.id);
  row.append(select,remove);parent.append(row);
}
function renderFolder(folder,collectionId){
  const node=document.createElement('div');node.className='collection-node';node.append(makeContainerRow(folder,collectionId,folder.id,'folder',(folder.requests?.length||0)+(folder.folders?.length||0)));
  if(!collapsed.has(folder.id)){const children=document.createElement('div');children.className='tree-children';for(const request of folder.requests||[])appendSavedRequest(children,request,collectionId,folder.id);for(const nested of folder.folders||[])children.append(renderFolder(nested,collectionId));node.append(children);}return node;
}
function renderQuickOpenResults() {
  const input = byId('quick-open-query'), list = byId('quick-open-results'), query = input.value.trim();
  list.replaceChildren();quickOpenEntries = query ? RunnerLogic.searchRequests(collections, query, 30) : [];quickOpenActiveIndex = 0;
  input.setAttribute('aria-expanded', String(quickOpenEntries.length > 0));input.removeAttribute('aria-activedescendant');
  if (!query || !quickOpenEntries.length) {
    const empty = document.createElement('p');empty.className = 'quick-open-empty';empty.setAttribute('role', 'status');
    empty.textContent = query ? 'Nenhuma requisição encontrada.' : 'Digite para buscar em todas as coleções.';list.append(empty);return;
  }
  quickOpenEntries.forEach((entry, index) => {
    const button = document.createElement('button');button.id = `quick-open-result-${index}`;button.className = 'quick-open-result';button.type = 'button';button.dataset.quickOpenIndex = String(index);button.setAttribute('role', 'option');button.setAttribute('aria-selected', String(index === quickOpenActiveIndex));
    const methodName = String(entry.request.method || 'GET').toUpperCase(), methodClass = methodName.toLowerCase();
    const methodBadge = document.createElement('span');methodBadge.className = 'method-dot';if (['get','post','put','patch','delete'].includes(methodClass)) methodBadge.classList.add(methodClass);methodBadge.textContent = methodName;
    const name = document.createElement('strong');name.className = 'quick-open-result-name';name.textContent = entry.request.name || entry.request.route || 'Requisição';
    const detail = document.createElement('span');detail.className = 'quick-open-result-path';detail.textContent = [entry.path, entry.request.route].filter(Boolean).join(' · ');
    button.append(methodBadge, name, detail);button.addEventListener('click', () => openQuickRequest(index));list.append(button);
  });
  input.setAttribute('aria-activedescendant', 'quick-open-result-0');
}
function openQuickRequest(index) {
  const entry = quickOpenEntries[index];if (!entry) return;
  byId('quick-open-dialog').close();openCollectionRequestInTab(entry.request, entry.collectionId, entry.folderId);
}
function openQuickOpen() {
  const dialog = byId('quick-open-dialog');
  if (dialog.open) { byId('quick-open-query').focus();return; }
  if (document.querySelector('dialog[open]')) return;
  byId('quick-open-query').value = '';renderQuickOpenResults();dialog.showModal();byId('quick-open-query').focus();
}
function handleQuickOpenShortcut(event) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'k') return;
  const dialog = byId('quick-open-dialog');
  if (dialog.open) { event.preventDefault();byId('quick-open-query').focus();return; }
  if (document.querySelector('dialog[open]')) return;
  event.preventDefault();openQuickOpen();
}
function handleQuickOpenQueryKeydown(event) {
  if (!quickOpenEntries.length) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();const direction = event.key === 'ArrowDown' ? 1 : -1;
    quickOpenActiveIndex = (quickOpenActiveIndex + direction + quickOpenEntries.length) % quickOpenEntries.length;
    const buttons = byId('quick-open-results').querySelectorAll('.quick-open-result');
    buttons.forEach((button, index) => button.setAttribute('aria-selected', String(index === quickOpenActiveIndex)));
    const active = buttons[quickOpenActiveIndex];byId('quick-open-query').setAttribute('aria-activedescendant', active.id);active.scrollIntoView({block:'nearest'});
  } else if (event.key === 'Enter' && !event.isComposing) {
    event.preventDefault();openQuickRequest(quickOpenActiveIndex);
  }
}function renderCollectionTree(){
  const tree=byId('collections-tree');tree.replaceChildren();byId('collections-empty').hidden=collections.length>0;
  for(const collection of collections){const node=document.createElement('div');node.className='collection-node';node.append(makeContainerRow(collection,collection.id,'','collection',(collection.requests?.length||0)+(collection.folders?.length||0)));
    if(!collapsed.has(collection.id)){const children=document.createElement('div');children.className='tree-children';for(const request of collection.requests||[])appendSavedRequest(children,request,collection.id,'');for(const folder of collection.folders||[])children.append(renderFolder(folder,collection.id));node.append(children);}tree.append(node);}
}
async function persistCollections(){for(const item of collections)await dbWrite('collections',item);renderCollectionTree();}
async function addCollection(){
  const name=await promptWithDialog({eyebrow:'COLEÇÕES',title:'Nova coleção',description:'Organize requisições relacionadas em uma coleção.',inputLabel:'Nome da coleção',placeholder:'Ex.: API de grupos',confirmLabel:'Criar coleção'});
  if(!name?.trim())return;
  const item={id:newId(),name:name.trim(),folders:[],requests:[]};collections.push(item);selectedContainer={collectionId:item.id,folderId:''};
  try{await dbWrite('collections',item);renderCollectionTree();showToast('Coleção criada','“'+item.name+'” está pronta para organizar requests.','success');}
  catch{collections=collections.filter(x=>x.id!==item.id);showToast('Falha ao salvar','Não foi possível criar a coleção local.','error');}
}
async function addFolder(collectionId,parentId=''){
  const name=await promptWithDialog({eyebrow:'PASTAS',title:'Nova pasta',description:'Crie uma pasta ou subpasta para organizar as requisições.',inputLabel:'Nome da pasta',placeholder:'Ex.: Consultas',confirmLabel:'Criar pasta'});
  if(!name?.trim())return;
  const collection=findCollection(collectionId),parent=findFolder(collection,parentId);if(!collection||!parent)return;
  const folder={id:newId(),name:name.trim(),folders:[],requests:[]};parent.folders||=[];parent.folders.push(folder);collapsed.delete(parent.id);selectedContainer={collectionId,folderId:folder.id};
  try{await persistCollections();showToast('Pasta criada','Pasta “'+folder.name+'” adicionada.','success');}
  catch{parent.folders=parent.folders.filter(x=>x.id!==folder.id);showToast('Falha ao salvar','Não foi possível criar a pasta.','error');}
}
async function manageNode(collectionId,folderId,kind){
  const collection=findCollection(collectionId),item=kind==='collection'?collection:findFolder(collection,folderId);if(!item)return;
  const choice=await showActionDialog({eyebrow:kind==='collection'?'COLEÇÕES':'PASTAS',title:kind==='collection'?'Gerenciar coleção':'Gerenciar pasta',description:'“'+item.name+'”',selectLabel:'Ação',selectOptions:[{value:'rename',label:'Renomear'},{value:'delete',label:'Excluir'}],selectValue:'rename',confirmLabel:'Continuar'});
  if(!choice.confirmed)return;
  if(choice.value==='rename'){
    const name=await promptWithDialog({eyebrow:'RENOMEAR',title:'Novo nome',description:'Escolha um nome para “'+item.name+'”.',inputLabel:'Nome',inputValue:item.name,confirmLabel:'Salvar nome'});
    if(!name?.trim())return;
    item.name=name.trim();
    try{await persistCollections();showToast('Nome atualizado',item.name,'success');}
    catch{showToast('Falha ao salvar','Não foi possível renomear.','error');}
    return;
  }
  if(choice.value!=='delete')return;
  if(!(await confirmWithDialog({eyebrow:'EXCLUSÃO',title:'Excluir '+(kind==='collection'?'coleção':'pasta')+'?',description:'Todo o conteúdo armazenado dentro deste item também será excluído.',detail:'“'+item.name+'”',confirmLabel:'Excluir definitivamente',danger:true})))return;
  if(kind==='collection'){
    collections=collections.filter(x=>x.id!==collectionId);
    if(!collections.length){const fallback={id:newId(),name:'Minha coleção',folders:[],requests:[]};collections.push(fallback);await dbWrite('collections',fallback);}
    if(selectedContainer.collectionId===collectionId)selectedContainer={collectionId:collections[0].id,folderId:''};
  }else{
    const parent=findParent(collection,folderId);if(parent)parent.folders=parent.folders.filter(x=>x.id!==folderId);
    if(selectedContainer.folderId===folderId)selectedContainer={collectionId,folderId:''};
  }
  try{await persistCollections();if(kind==='collection')await dbWrite('collections',collectionId,true);collapsed.delete(item.id);showToast('Item excluído','Coleção/pasta removida do banco local.','info');}
  catch{showToast('Falha ao excluir','O banco local não concluiu a exclusão.','error');}
}
async function deleteCollectionRequest(collectionId,folderId,id){
  if(!(await confirmWithDialog({eyebrow:'EXCLUSÃO',title:'Excluir requisição?',description:'A requisição salva será removida da coleção.',confirmLabel:'Excluir requisição',danger:true})))return;
  const container=findFolder(findCollection(collectionId),folderId);if(!container)return;
  container.requests=(container.requests||[]).filter(x=>x.id!==id);
  try{await persistCollections();if(activeSaved?.id===id)activeSaved=null;showToast('Requisição excluída','Item removido da coleção.','info');}
  catch{showToast('Falha ao excluir','Não foi possível atualizar a coleção.','error');}
}
function collectionHasAuthCredentials(node,depth=0){
  return depth<=20&&((node.requests||[]).some(request=>hasAuthCredentials(request))||(node.folders||[]).some(folder=>collectionHasAuthCredentials(folder,depth+1)));
}
function collectionHasResponseAutomation(node,depth=0){return depth<=20&&((node.requests||[]).some(request=>!!request.captureResponseVariable||!!request.responseTests?.length)||(node.folders||[]).some(folder=>collectionHasResponseAutomation(folder,depth+1)));}
function collectionHasResponseCaptureConfig(node,depth=0){return depth<=20&&((node.requests||[]).some(request=>!!request.captureResponseVariable||Object.hasOwn(request,'responseJsonPath')||Object.hasOwn(request,'responseValueSource')||!!request.responseTests?.length)||(node.folders||[]).some(folder=>collectionHasResponseCaptureConfig(folder,depth+1)));}
function environmentHasAuthCredentials(variables){return Object.entries(variables||{}).some(([key,value])=>isSensitiveName(key)&&value!=='');}
function exportEnvironmentVariables(variables,includeBearer){
  const result={};for(const[key,value]of Object.entries(variables||{})){if(/cookie|private[_-]?key/i.test(key))continue;if(isSensitiveName(key)&&!includeBearer)continue;Object.defineProperty(result,key,{value:String(value??''),enumerable:true,writable:true,configurable:true});}return result;
}
function exportCollectionNode(node,includeBearer,depth=0){
  if(depth>20)throw Error('A coleção tem mais de 20 níveis de pastas.');
  return{
    id:node.id,name:String(node.name||'Coleção').slice(0,100),
    requests:(node.requests||[]).map(request=>{
      const base=sanitizeBase(String(request.baseUrl||'')),route=sanitizeRoute(String(request.route||'')),headers=sanitizeHeaders(String(request.headers||'')),payload=sanitizeBody(String(request.body||'')),authType=normalizeAuthType(request.authType,request.bearerToken);
      return{id:request.id,name:String(request.name||'Request').slice(0,100),method:['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(request.method)?request.method:'GET',
        baseUrl:base.value,route:route.value,headers:headers.value,body:payload.value,authType,bearerToken:includeBearer&&authType==='bearer'?sanitizeBearer(request.bearerToken):'',
        basicUsername:includeBearer&&authType==='basic'?String(request.basicUsername||''):'',basicPassword:includeBearer&&authType==='basic'?String(request.basicPassword||''):'',
        apiKeyName:authType==='apiKey'?String(request.apiKeyName||''):'',apiKeyLocation:authType==='apiKey'&&request.apiKeyLocation==='query'?'query':'header',apiKeyValue:includeBearer&&authType==='apiKey'?String(request.apiKeyValue||''):'',
        allowInsecureHttp:request.allowInsecureHttp===true,tokenRequest:!!request.tokenRequest,tokenClientId:String(request.tokenClientId||''),tokenCredentialMode:request.tokenCredentialMode==='query'?'query':'body',
        captureResponseVariable:!!request.captureResponseVariable,responseVariableName:String(request.responseVariableName||'token'),responseValueSource:request.responseValueSource==='text'?'text':'json',responseJsonPath:String(request.responseJsonPath||'access_token'),responseSuccessOnly:request.responseSuccessOnly!==false,responseTests:RunnerLogic.normalizeResponseTests(request.responseTests)};
    }),
    folders:(node.folders||[]).map(folder=>exportCollectionNode(folder,includeBearer,depth+1))
  };
}
function responseCaptureInsomniaScript(request,postman=false){
  if(!request.captureResponseVariable)return[];const variable=String(request.responseVariableName||'token'),source=request.responseValueSource==='text'?'text':'json';let expression=postman?'pm.response.text()':'insomnia.response.text()',lines=[];
  if(source==='json'){const parts=parseJsonPath(request.responseJsonPath||'access_token');const root=postman?'body':'body';expression=root+parts.map(part=>typeof part==='number'?`[${part}]`:/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(part)?'.'+part:`[${JSON.stringify(part)}]`).join('');lines.push(`const ${root} = ${postman?'pm.response.json()':'insomnia.response.json()'};`);}
  const set=`${postman?'pm':'insomnia'}.environment.set(${JSON.stringify(variable)}, ${expression});`;
  if(request.responseSuccessOnly!==false){const code=postman?'pm.response.code':'insomnia.response.status';lines.push(`if (${code} >= 200 && ${code} < 300) {`,`  ${set}`,'}');}else lines.push(set);
  return lines;
}
function exportRequestUrl(request){const base=sanitizeBase(String(request.baseUrl||'')).value.replace(/\/+$/,''),path=sanitizeRoute(String(request.route||'/')).value;return base+(path.startsWith('/')?path:'/'+path);}
function exportHeaderList(request){return sanitizeHeaders(String(request.headers||'')).value.split('\n').filter(Boolean).map(line=>{const i=line.indexOf(':');return{key:line.slice(0,i).trim(),value:line.slice(i+1).trim(),disabled:false};});}
function appendExportQueryParameter(url,name,value){
  const separator=url.includes('?')?'&':'?';return url+separator+encodeParam(name)+'='+encodeParam(value);
}
function buildInsomniaExport(collection,environment,includeBearer){
  const resources=[{_id:'__WORKSPACE_ID__',_type:'workspace',name:collection.name,description:'',scope:'collection'},
    {_id:'__BASE_ENVIRONMENT_ID__',_type:'environment',parentId:'__WORKSPACE_ID__',name:environment.name||'Base Environment',data:exportEnvironmentVariables(environment.variables,includeBearer)}];
  let requestNumber=0,folderNumber=0;
  const addNode=(node,parentId)=>{
    for(const folder of node.folders||[]){const id='__request_group_'+(++folderNumber)+'__';resources.push({_id:id,_type:'request_group',parentId,name:folder.name,description:'',environment:{}});addNode(folder,id);}
    for(const request of node.requests||[]){
      const headers=exportHeaderList(request),authType=normalizeAuthType(request.authType,request.bearerToken),token=includeBearer&&authType==='bearer'?sanitizeBearer(request.bearerToken):'';
      let url=exportRequestUrl(request),authentication={type:'none'};
      if(authType==='bearer')authentication={type:'bearer',token};
      else if(authType==='basic')authentication={type:'basic',username:includeBearer?String(request.basicUsername||''):'',password:includeBearer?String(request.basicPassword||''):''};
      else if(authType==='apiKey'){
        const keyName=String(request.apiKeyName||'').trim(),keyValue=includeBearer?String(request.apiKeyValue||''):'';
        if(request.apiKeyLocation==='query'){
          const routeParams=RunnerLogic.splitRoute(request.route||'').params;
          if(routeParams.some(([name])=>name.toLowerCase()===keyName.toLowerCase()))throw Error('A rota já contém o parâmetro configurado como API Key: '+keyName);
          url=appendExportQueryParameter(url,keyName,keyValue);
        }else headers.push({key:keyName,value:keyValue,disabled:false});
      }
      const resource={_id:'__request_'+(++requestNumber)+'__',_type:'request',parentId,name:request.name||'Request',method:request.method||'GET',url,headers:headers.map(h=>({name:h.key,value:h.value,disabled:false})),parameters:[],body:{mimeType:'application/json',text:sanitizeBody(String(request.body||'')).value},authentication};
      const script=[responseCaptureInsomniaScript(request,false).join('\n'),RunnerLogic.buildResponseTestScript(request.responseTests,'insomnia')].filter(Boolean);if(script.length)resource.afterResponseScript=script.join('\n\n');resources.push(resource);
    }
  };
  addNode(collection,'__WORKSPACE_ID__');
  return{_type:'export',__export_format:4,__export_date:new Date().toISOString(),__export_source:'vortix-local',resources};
}
function postmanRequestItem(request,includeBearer){
  const authType=normalizeAuthType(request.authType,request.bearerToken),item={name:request.name||'Request',request:{method:request.method||'GET',header:exportHeaderList(request),url:{raw:exportRequestUrl(request)}}};
  const body=sanitizeBody(String(request.body||'')).value;if(body)item.request.body={mode:'raw',raw:body,options:{raw:{language:'json'}}};
  if(authType==='bearer')item.request.auth={type:'bearer',bearer:[{key:'token',value:includeBearer?sanitizeBearer(request.bearerToken):'',type:'string'}]};
  else if(authType==='basic')item.request.auth={type:'basic',basic:[{key:'username',value:includeBearer?String(request.basicUsername||''):'',type:'string'},{key:'password',value:includeBearer?String(request.basicPassword||''):'',type:'string'}]};
  else if(authType==='apiKey')item.request.auth={type:'apikey',apikey:[{key:'key',value:String(request.apiKeyName||''),type:'string'},{key:'value',value:includeBearer?String(request.apiKeyValue||''):'',type:'string'},{key:'in',value:request.apiKeyLocation==='query'?'query':'header',type:'string'}]};
  else item.request.auth={type:'noauth'};
  const script=[responseCaptureInsomniaScript(request,true).join('\n'),RunnerLogic.buildResponseTestScript(request.responseTests,'postman')].filter(Boolean).join('\n\n');if(script)item.event=[{listen:'test',script:{type:'text/javascript',exec:script},disabled:false}];
  return item;
}
function postmanNodeItems(node,includeBearer){return[...(node.requests||[]).map(request=>postmanRequestItem(request,includeBearer)),...(node.folders||[]).map(folder=>({name:folder.name||'Pasta',item:postmanNodeItems(folder,includeBearer)}))];}
function buildPostmanExport(collection,environment,includeBearer){
  return{info:{_postman_id:newId(),name:collection.name||'Coleção',schema:'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'},item:postmanNodeItems(collection,includeBearer),variable:Object.entries(exportEnvironmentVariables(environment.variables,includeBearer)).map(([key,value])=>({key,value,enabled:true}))};
}
function openExportDialog(){
  if(!collections.length){showToast('Sem coleções','Crie uma coleção antes de exportar.','info');return;}
  const select=byId('export-collection-select');select.replaceChildren();
  for(const collection of collections){const option=document.createElement('option');option.value=collection.id;option.textContent=collection.name;option.selected=collection.id===selectedContainer.collectionId;select.append(option);}
  byId('export-format').value='api-studio';byId('export-include-bearer').checked=false;byId('export-dialog').showModal();
}
async function exportCollection(event){
  event.preventDefault();const collection=findCollection(byId('export-collection-select').value),format=byId('export-format').value;if(!collection)return;
  const includeBearer=byId('export-include-bearer').checked;
  const environment=getEnvironment();
  if(includeBearer&&(collectionHasAuthCredentials(collection)||environmentHasAuthCredentials(environment.variables))&&!(await confirmWithDialog({eyebrow:'DADOS SENSÍVEIS',title:'Exportar credenciais?',description:'O arquivo conterá valores Bearer, Basic, API Key ou variáveis sensíveis sem criptografia.',warning:'Qualquer pessoa com acesso ao arquivo poderá reutilizá-los.',confirmLabel:'Exportar credenciais',danger:true})))return;
  if(format!=='api-studio'&&collectionHasResponseAutomation(collection)&&!(await confirmWithDialog({eyebrow:'SCRIPTS DE RESPOSTA',title:'Exportar automações?',description:format==='insomnia-v4'?'O Insomnia executará scripts After-response de captura e teste desta coleção.':'O Postman executará scripts de captura e teste desta coleção após cada resposta.',warning:'Revise os scripts antes de enviar ou importar o arquivo.',confirmLabel:'Exportar automações',danger:true})))return;
  try{
    const payload=format==='insomnia-v4'?buildInsomniaExport(collection,environment,includeBearer):format==='postman-v21'?buildPostmanExport(collection,environment,includeBearer):{format:'api-studio-collection',version:2,exportedAt:new Date().toISOString(),collection:exportCollectionNode(collection,includeBearer),environment:{name:environment.name,group:environment.group,variables:exportEnvironmentVariables(environment.variables,includeBearer)}};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
    const filename=collection.name.normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-|-$/g,'')||'collection',suffix=format==='insomnia-v4'?'.insomnia.json':format==='postman-v21'?'.postman_collection.json':'.vortix.json';
    link.href=url;link.download=filename+suffix;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    byId('export-dialog').close();showToast('Coleção exportada',format==='api-studio'?'Vortix JSON baixado.':format==='insomnia-v4'?'Insomnia JSON v4 baixado.':'Postman Collection v2.1 baixado.','success');
  }catch{showToast('Falha na exportação','Não foi possível gerar o arquivo JSON.','error');}
}
async function exportWorkspaceBackup(){
  if(!(await confirmWithDialog({eyebrow:'BACKUP LOCAL',title:'Baixar backup completo?',description:'O arquivo reúne histórico, coleções, pastas, ambientes e configurações deste workspace.',warning:'JSON sem criptografia. Pode conter tokens, headers, bodies e dados do histórico; guarde em local seguro.',confirmLabel:'Baixar backup',danger:true})))return;
  try{
    syncActiveWorkspaceTab(false);
    await dbWrite('settings',{key:WORKSPACE_TABS_KEY,value:persistableWorkspaceTabs()});
    const response=await fetch('/api/storage/workspace',{headers:{'X-Api-Studio':'1'},cache:'no-store'});
    if(!response.ok)throw Error('Não foi possível ler o workspace local.');
    const payload=RunnerLogic.createWorkspaceBackup(await response.json());
    const serialized=JSON.stringify(payload,null,2),blob=new Blob([serialized],{type:'application/json'});
    if(blob.size>RunnerLogic.maxWorkspaceBackupBytes)throw Error('Backup excede o limite de 15 MB.');
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download='vortix-workspace-'+new Date().toISOString().slice(0,10)+'.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    showToast('Backup baixado','Histórico, coleções, ambientes e configurações foram incluídos.','success');
  }catch(error){showToast('Falha ao exportar backup',error.message||'Não foi possível gerar o arquivo JSON.','error');}
}
async function requestEncryptedBackupPassphrase(){
  const password=await promptWithDialog({eyebrow:'BACKUP PROTEGIDO',title:'Defina uma senha',description:'Use pelo menos 12 caracteres. A senha não será salva e não poderá ser recuperada se você a esquecer.',warning:'Guarde a senha separada do arquivo de backup.',inputLabel:'Senha do backup',inputType:'password',placeholder:'Pelo menos 12 caracteres',maxLength:256,confirmLabel:'Continuar'});
  if(password===null)return null;
  if(Array.from(password).length<RunnerLogic.workspaceBackupPassphraseMinLength){showToast('Senha muito curta','Use pelo menos 12 caracteres.','warning');return null;}
  const confirmation=await promptWithDialog({eyebrow:'BACKUP PROTEGIDO',title:'Confirme a senha',description:'Digite novamente a mesma senha para evitar erro ao restaurar.',inputLabel:'Confirmar senha',inputType:'password',placeholder:'Repita a senha',maxLength:256,confirmLabel:'Confirmar senha'});
  if(confirmation===null)return null;
  if(password!==confirmation){showToast('As senhas não conferem','O backup protegido não foi gerado.','error');return null;}
  return password;
}
async function exportEncryptedWorkspaceBackup(){
  let passphrase=await requestEncryptedBackupPassphrase();if(passphrase===null)return;
  const button=byId('export-encrypted-workspace');button.disabled=true;button.textContent='Criptografando…';
  try{
    syncActiveWorkspaceTab(false);
    await dbWrite('settings',{key:WORKSPACE_TABS_KEY,value:persistableWorkspaceTabs()});
    const response=await fetch('/api/storage/workspace',{headers:{'X-Api-Studio':'1'},cache:'no-store'});
    if(!response.ok)throw Error('Não foi possível ler o workspace local.');
    const payload=RunnerLogic.createWorkspaceBackup(await response.json()),serialized=JSON.stringify(payload,null,2);
    if(new Blob([serialized]).size>RunnerLogic.maxWorkspaceBackupBytes)throw Error('Backup excede o limite de 15 MB.');
    const encrypted=await RunnerLogic.encryptWorkspaceBackup(serialized,passphrase),protectedJson=JSON.stringify(encrypted,null,2),blob=new Blob([protectedJson],{type:'application/vnd.api-studio.encrypted-workspace+json'});
    if(blob.size>RunnerLogic.maxEncryptedWorkspaceBackupBytes)throw Error('Backup protegido excede o limite de 22 MB.');
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download='vortix-workspace-'+new Date().toISOString().slice(0,10)+'.vortix-backup';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    showToast('Backup protegido baixado','Conteúdo criptografado. A senha não foi salva.','success');
  }catch(error){showToast('Falha ao exportar backup protegido',error.message||'Não foi possível gerar o arquivo.','error');}
  finally{passphrase='';button.disabled=false;button.textContent='Backup com senha';}
}
async function restoreWorkspaceBackup(event){
  const file=event.target.files?.[0];if(!file)return;
  try{
    if(file.size>RunnerLogic.maxEncryptedWorkspaceBackupBytes)throw Error('Arquivo excede o limite de 22 MB.');
    const serialized=await file.text();let parsed,encrypted=RunnerLogic.isEncryptedWorkspaceBackup(serialized),passphrase='';
    if(encrypted){
      passphrase=await promptWithDialog({eyebrow:'BACKUP PROTEGIDO',title:'Digite a senha do backup',description:'A senha é usada apenas nesta restauração e não será salva.',inputLabel:'Senha do backup',inputType:'password',placeholder:'Senha definida ao exportar',maxLength:256,confirmLabel:'Descriptografar'});
      if(passphrase===null)return;
      try{parsed=await RunnerLogic.decryptWorkspaceBackup(serialized,passphrase);}finally{passphrase='';}
    }else parsed=RunnerLogic.parseWorkspaceBackup(serialized);
    const counts=parsed.counts;
    const detail=counts.collections+' coleções · '+counts.environments+' ambientes · '+counts.history+' itens no histórico · '+counts.settings+' configurações';
    const warning=encrypted?'A senha foi validada. A restauração substitui todos os dados locais.':'Este JSON pode conter tokens e dados sensíveis em texto puro. A restauração substitui todos os dados locais.';
    if(!(await confirmWithDialog({eyebrow:'RESTAURAÇÃO',title:'Substituir workspace atual?',description:'O arquivo “'+file.name+'” substituirá o histórico, coleções, pastas, ambientes e configurações atuais.',detail,warning,confirmLabel:'Restaurar backup',danger:true})))return;
    const backup=RunnerLogic.createWorkspaceBackup(parsed.data,parsed.exportedAt||new Date().toISOString());
    const response=await fetch('/api/storage/workspace/restore',{method:'POST',headers:{'Content-Type':'application/json','X-Api-Studio':'1'},cache:'no-store',body:JSON.stringify(backup)});
    const result=await response.json().catch(()=>null);
    if(!response.ok)throw Error(result?.error||'Não foi possível restaurar o backup local.');
    byId('settings-dialog').close();showToast('Workspace restaurado','Dados substituídos. Recarregando…','success',0);setTimeout(()=>window.location.reload(),1200);
  }catch(error){showToast('Falha ao restaurar backup',error.message||'Revise o arquivo e tente novamente.','error');}
  finally{event.target.value='';}
}
async function protectExistingSecrets(){
  const confirmation=await promptWithDialog({eyebrow:'PROTEÇÃO DOS DADOS',title:'Proteger dados existentes?',description:'Baixe um backup completo antes. Bodies e campos reconhecidos como sensíveis serão protegidos pelo ASP.NET Core Data Protection.',warning:'O backup JSON fica em texto puro. A migração protege o SQLite, mas não apaga cópias antigas do IndexedDB. A leitura depende das chaves e da identidade desta instalação. Digite BACKUP após baixar a cópia.',inputLabel:'Confirmação',placeholder:'Digite BACKUP',maxLength:12,confirmLabel:'Proteger dados',danger:true});
  if(String(confirmation||'').trim().toUpperCase()!=='BACKUP'){if(confirmation!==null)showToast('Migração cancelada','Baixe um backup completo e digite BACKUP para continuar.','info');return;}
  const button=byId('protect-existing-secrets');button.disabled=true;button.textContent='Protegendo…';
  try{
    const response=await fetch('/api/storage/security/protect-existing',{method:'POST',headers:{'Content-Type':'application/json','X-Api-Studio':'1'},cache:'no-store',body:JSON.stringify({confirm:true})});
    const result=await response.json().catch(()=>null);
    if(!response.ok)throw Error(result?.error||'Não foi possível proteger os segredos locais.');
    const count=Number(result?.updatedRecords)||0;
    showToast(count?'Segredos protegidos':'Nada para migrar',count?count+' registros antigos agora usam proteção de dados.':'Não havia segredos antigos em texto puro.','success');
  }catch(error){showToast('Falha na proteção',error.message||'Revise o estado do banco local e tente novamente.','error');}
  finally{button.disabled=false;button.textContent='Proteger dados existentes';}
}

function splitImportedUrl(value){
  const raw=typeof value==='string'?value:String(value?.raw||'');
  let match=raw.match(/^(\{\{\s*[^{}]+\s*\}\})(\/.*)?$/);
  if(match)return{baseUrl:match[1].replace(/\/+$/,''),route:match[2]||'/'};
  match=raw.match(/^([a-z][a-z0-9+.-]*:\/\/[^/?#]+)(.*)$/i);
  if(match)return{baseUrl:match[1],route:match[2]||'/'};
  if(raw.startsWith('/'))return{baseUrl:'{{baseUrl}}',route:raw};
  return{baseUrl:'{{baseUrl}}',route:'/'+raw.replace(/^\/+/, '')};
}
function importedQueryParams(route,params){
  if(!Array.isArray(params)||!params.length||route.includes('?'))return route;
  const pairs=params.filter(item=>item&&!item.disabled).map(item=>`${encodeParam(String(item.name??item.key??''))}=${encodeParam(String(item.value??''))}`).filter(pair=>!pair.startsWith('='));
  return route+(pairs.length?'?'+pairs.join('&'):'');
}
function importedHeaders(headers){return(Array.isArray(headers)?headers:[]).filter(header=>header&&!header.disabled).map(header=>`${String(header.name??header.key??'').trim()}: ${String(header.value??'')}`).filter(line=>line[0]!==':');}
function importedBearer(auth,headers){
  if(auth?.type==='bearer'){
    const token=Array.isArray(auth.bearer)?auth.bearer.find(item=>item.key==='token')?.value:auth.token;
    if(token)return sanitizeBearer(token);
  }
  for(const line of headers){if(/^authorization\s*:/i.test(line)){const value=line.slice(line.indexOf(':')+1).trim();if(/^Bearer\s+/i.test(value))return sanitizeBearer(value);}}
  return'';
}
function importedBody(body,headers){
  if(body==null)return'';if(typeof body==='string')return body;
  if(typeof body.text==='string'){
    if(body.mimeType&&!headers.some(line=>/^content-type\s*:/i.test(line)))headers.push('Content-Type: '+body.mimeType);
    return body.text;
  }
  if(body.mode==='raw')return String(body.raw||'');
  if(body.mode==='urlencoded'||body.urlencoded||body.mimeType==='application/x-www-form-urlencoded'){const values=body.urlencoded||body.params||[];if(!headers.some(line=>/^content-type\s*:/i.test(line)))headers.push('Content-Type: application/x-www-form-urlencoded');return values.filter(item=>item&&!item.disabled).map(item=>`${encodeParam(String(item.key||item.name||''))}=${encodeParam(String(item.value||''))}`).join('&');}
  return'';
}
function parseResponseCaptureScript(script){
  const text=String(script||''),setter=text.match(/\b(?:insomnia|pm)\.environment\.set\s*\(\s*(['"])([^'"]+)\1\s*,\s*([\s\S]*?)\s*\)\s*;?/);
  if(!setter)return null;const name=setter[2].trim(),expression=setter[3].trim();if(!name)return null;
  if(/^(?:insomnia|pm)\.response\.text\(\)$/.test(expression))return{captureResponseVariable:true,responseVariableName:name,responseValueSource:'text',responseJsonPath:'',responseSuccessOnly:true};
  let path='';const direct=expression.match(/^(?:insomnia|pm)\.response\.json\(\)([\s\S]*)$/);
  if(direct)path=direct[1].replace(/^\./,'');else{const data=text.match(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:insomnia|pm)\.response\.json\(\)\s*;/),alias=data?.[1];if(!alias||!expression.startsWith(alias))return null;path=expression.slice(alias.length).replace(/^\./,'');}
  try{parseJsonPath(path||'$');}catch{return null;}
  return{captureResponseVariable:true,responseVariableName:name,responseValueSource:'json',responseJsonPath:path||'$',responseSuccessOnly:true};
}
function postmanScriptText(script){if(Array.isArray(script))return script.join('\n');if(typeof script==='string')return script;if(Array.isArray(script?.exec))return script.exec.join('\n');return typeof script?.exec==='string'?script.exec:'';}
function authArrayValue(values,key){
  if(Array.isArray(values))return values.find(item=>String(item?.key||'').toLowerCase()===key.toLowerCase())?.value;
  return values&&typeof values==='object'?values[key]:undefined;
}
function importedPostmanAuth(auth,headers){
  const type=String(auth?.type||'').toLowerCase();
  if(type==='bearer')return{authType:'bearer',bearerToken:importedBearer(auth,headers)};
  if(type==='basic')return{authType:'basic',basicUsername:String(authArrayValue(auth.basic,'username')||''),basicPassword:String(authArrayValue(auth.basic,'password')||'')};
  if(type==='apikey'||type==='api-key')return{authType:'apiKey',apiKeyName:String(authArrayValue(auth.apikey||auth.apiKey,'key')||''),apiKeyValue:String(authArrayValue(auth.apikey||auth.apiKey,'value')||''),apiKeyLocation:String(authArrayValue(auth.apikey||auth.apiKey,'in')||'header').toLowerCase()==='query'?'query':'header'};
  return{authType:'none',bearerToken:''};
}
function importPostmanItem(item,inheritedEvents,stats,depth=0){
  if(depth>12)throw Error('A coleção Postman excede 12 níveis de pastas.');
  if(Array.isArray(item?.item)){
    const folder={name:String(item.name||'Pasta'),folders:[],requests:[]},events=[...inheritedEvents,...(Array.isArray(item.event)?item.event:[])];
    for(const child of item.item){const converted=importPostmanItem(child,events,stats,depth+1);if(!converted)continue;(converted.folders?folder.folders:folder.requests).push(converted);}return folder;
  }
  const request=item?.request;if(!request||typeof request!=='object')return null;
  const headers=importedHeaders(request.header||request.headers),rawUrl=typeof request.url==='string'?request.url:request.url?.raw||'';
  let url=splitImportedUrl(rawUrl);
  if(!rawUrl&&request.url&&typeof request.url==='object'){
    const host=Array.isArray(request.url.host)?request.url.host.join('.'):String(request.url.host||'');const path=Array.isArray(request.url.path)?request.url.path.join('/'):String(request.url.path||'');
    url=splitImportedUrl((request.url.protocol||'https')+'://'+host+'/'+path);
  }
  url.route=importedQueryParams(url.route,request.url?.query);
  const allEvents=[...inheritedEvents,...(Array.isArray(item.event)?item.event:[])],event=allEvents.find(entry=>entry?.listen==='test'&&entry.script);
  const script=event?postmanScriptText(event.script):'';let capture=script?parseResponseCaptureScript(script):null;
  if(script&&!capture)stats.unsupportedScripts++;
  if(event?.disabled&&capture)capture={...capture,captureResponseVariable:false};
  const auth=importedPostmanAuth(request.auth,headers),body=importedBody(request.body,headers);
  return{name:String(item.name||'Request'),method:['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(String(request.method||'GET').toUpperCase())?String(request.method||'GET').toUpperCase():'GET',...url,...auth,headers:headers.join('\n'),body,...(capture||{})};
}
function importPostmanCollection(document){
  if(!document.info||!Array.isArray(document.item))throw Error('Coleção Postman inválida; esperado Postman v2.1.');
  const stats={unsupportedScripts:0},root={name:String(document.info.name||'Coleção Postman'),folders:[],requests:[]},events=Array.isArray(document.event)?document.event:[];
  for(const item of document.item){const converted=importPostmanItem(item,events,stats);if(!converted)continue;(converted.folders?root.folders:root.requests).push(converted);}
  const variables={};for(const variable of Array.isArray(document.variable)?document.variable:[])if(variable?.key)Object.defineProperty(variables,String(variable.key),{value:String(variable.value??''),enumerable:true,writable:true,configurable:true});
  return{collection:root,environments:Object.keys(variables).length?[{name:root.name+' - Base',group:root.name,variables}]:[],stats};
}
function importedInsomniaAuth(auth,headers,route){
  const type=String(auth?.type||'').toLowerCase();
  if(type==='bearer')return{authType:'bearer',bearerToken:importedBearer(auth,headers)};
  if(type==='basic')return{authType:'basic',basicUsername:String(auth.username||authArrayValue(auth.basic,'username')||''),basicPassword:String(auth.password||authArrayValue(auth.basic,'password')||'')};
  if(type==='apikey'||type==='api-key')return{authType:'apiKey',apiKeyName:String(auth.key||auth.name||''),apiKeyValue:String(auth.value||''),apiKeyLocation:String(auth.addTo||auth.location||'header').toLowerCase()==='query'?'query':'header'};
  const headerIndex=headers.findIndex(line=>/^(?:x[-_]?api[-_]?key|api[-_]?key)\s*:/i.test(line));
  if(headerIndex>=0){const line=headers.splice(headerIndex,1)[0],index=line.indexOf(':');return{authType:'apiKey',apiKeyName:line.slice(0,index).trim(),apiKeyValue:line.slice(index+1).trim(),apiKeyLocation:'header'};}
  const split=RunnerLogic.splitRoute(route||''),queryIndex=split.params.findIndex(([name])=>/(?:api.?key|access.?key)/i.test(name));
  if(queryIndex>=0){const[key,value]=split.params.splice(queryIndex,1)[0];return{authType:'apiKey',apiKeyName:key,apiKeyValue:value,apiKeyLocation:'query',route:split.route+(split.params.length?'?'+split.params.map(([name,val])=>encodeParam(name)+'='+encodeParam(val)).join('&'):'')};}
  const bearerToken=importedBearer(auth,headers);
  return{authType:bearerToken?'bearer':'none',bearerToken};
}
function importInsomniaCollection(document){
  if(!Array.isArray(document.resources)||document.__export_format!==4)throw Error('Arquivo Insomnia inválido; esperado JSON v4.');
  const resources=document.resources,workspace=resources.find(resource=>resource?._type==='workspace');if(!workspace)throw Error('O arquivo Insomnia não contém workspace.');
  const root={name:String(workspace.name||'Coleção Insomnia'),folders:[],requests:[]},groups=new Map(),stats={unsupportedScripts:0};
  for(const resource of resources)if(resource&&['request_group','folder'].includes(resource._type))groups.set(resource._id,{id:resource._id,parentId:resource.parentId,name:String(resource.name||'Pasta'),folders:[],requests:[]});
  for(const group of groups.values()){const parent=groups.get(group.parentId);(parent?parent.folders:root.folders).push(group);}
  for(const resource of resources){
    if(resource?._type!=='request')continue;const headers=importedHeaders(resource.headers),url=splitImportedUrl(resource.url||''),auth=resource.authentication||{},authFields=importedInsomniaAuth(auth,headers,url.route);
    if(authFields.route)url.route=authFields.route;
    url.route=importedQueryParams(url.route,resource.parameters);
    const body=importedBody(resource.body,headers),script=String(resource.afterResponseScript||'');let capture=script?parseResponseCaptureScript(script):null;if(script&&!capture)stats.unsupportedScripts++;if(capture)capture={...capture,captureResponseVariable:false};
    const request={name:String(resource.name||'Request'),method:['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(String(resource.method||'GET').toUpperCase())?String(resource.method||'GET').toUpperCase():'GET',...url,...authFields,headers:headers.join('\n'),body,...(capture||{})};
    const parent=groups.get(resource.parentId)||root;parent.requests.push(request);
  }
  const environments=[];for(const resource of resources.filter(resource=>resource?._type==='environment')){const variables={};for(const[key,value]of Object.entries(resource.data||{}))Object.defineProperty(variables,key,{value:typeof value==='string'?value:JSON.stringify(value),enumerable:true,writable:true,configurable:true});environments.push({name:String(resource.name||'Ambiente Insomnia'),group:root.name,variables});}
  return{collection:root,environments,stats};
}
function importPostmanEnvironment(document){
  if(!Array.isArray(document.values)||(!document._postman_variable_scope&&!document.name))return null;
  const variables={};for(const item of document.values)if(item?.key&&item.enabled!==false)Object.defineProperty(variables,String(item.key),{value:String(item.value??''),enumerable:true,writable:true,configurable:true});
  return{name:String(document.name||'Ambiente Postman'),group:'Importado',variables};
}
function normalizeImportedNode(source,keepAuth,depth=0,isRoot=false,enableCapture=true,allowInsecureHttp=false){
  if(depth>12)throw Error('A coleção importada ultrapassa 12 níveis de pastas.');
  if(!source||typeof source!=='object'||Array.isArray(source))throw Error('Estrutura inválida de coleção ou pasta.');
  const safe={id:newId(),name:String(source.name||(isRoot?'Coleção importada':'Pasta')).slice(0,100),folders:[],requests:[]};
  if(!Array.isArray(source.requests)||!Array.isArray(source.folders))throw Error('A coleção precisa conter listas de requests e pastas.');
  if(source.requests.length>2000||source.folders.length>500)throw Error('A coleção ultrapassa o limite de itens por nível.');
  safe.requests=source.requests.map(request=>{
    if(!request||typeof request!=='object'||Array.isArray(request))throw Error('Uma request do arquivo está inválida.');
    const base=sanitizeBase(String(request.baseUrl||'')),route=sanitizeRoute(String(request.route||'')),headers=sanitizeHeaders(String(request.headers||'')),payload=sanitizeBody(String(request.body||'')),authType=normalizeAuthType(request.authType,request.bearerToken);
    return{id:newId(),name:String(request.name||'Request').slice(0,100),method:['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(request.method)?request.method:'GET',
      baseUrl:base.value,route:route.value,headers:headers.value,body:payload.value,authType,bearerToken:keepAuth&&authType==='bearer'?sanitizeBearer(request.bearerToken):'',
      basicUsername:keepAuth&&authType==='basic'?String(request.basicUsername||''):'',basicPassword:keepAuth&&authType==='basic'?String(request.basicPassword||''):'',
      apiKeyName:authType==='apiKey'?String(request.apiKeyName||'').slice(0,128):'',apiKeyLocation:authType==='apiKey'&&request.apiKeyLocation==='query'?'query':'header',apiKeyValue:keepAuth&&authType==='apiKey'?String(request.apiKeyValue||''):'',
      allowInsecureHttp:allowInsecureHttp&&request.allowInsecureHttp===true,tokenRequest:!!request.tokenRequest,tokenClientId:String(request.tokenClientId||'').slice(0,512),tokenCredentialMode:request.tokenCredentialMode==='query'?'query':'body',
      captureResponseVariable:enableCapture&&!!request.captureResponseVariable,responseVariableName:String(request.responseVariableName||'token').slice(0,80),responseValueSource:request.responseValueSource==='text'?'text':'json',responseJsonPath:String(request.responseJsonPath||'access_token').slice(0,1000),responseSuccessOnly:request.responseSuccessOnly!==false,
      responseTests:enableCapture?RunnerLogic.normalizeResponseTests(request.responseTests).map(rule=>({...rule,id:newId()})):[]};
  });
  safe.folders=source.folders.map(folder=>normalizeImportedNode(folder,keepAuth,depth+1,false,enableCapture,allowInsecureHttp));return safe;
}
function openImportDialog(){byId('curl-import-error').hidden=true;byId('curl-import-error').textContent='';byId('curl-import-source').value='';byId('import-dialog').showModal();byId('curl-import-source').focus();}
function openCurlRequestDraft(){
  const error=byId('curl-import-error');error.hidden=true;error.textContent='';
  try{
    const imported=RunnerLogic.parseCurlCommand(byId('curl-import-source').value);
    const urlParts=splitImportedUrl(imported.url),routeParts=RunnerLogic.splitRoute(urlParts.route);
    if(routeParts.params.some(([name])=>isSensitiveName(name)))throw Error('URL cURL contem parametros sensiveis. Remova-os e use variaveis de ambiente.');
    const safeRoute=sanitizeRoute(routeParts.route),safeBase=sanitizeBase(urlParts.baseUrl);
    if(safeRoute.redacted||safeBase.redacted)throw Error('Remova credenciais e fragmentos da URL antes de importar.');
    if(!createNewWorkspaceTab(false))return;
    method.value=imported.method;byId('base-url').value=safeBase.value;baseUrlAuto=false;route.value=safeRoute.value;
    renderQueryParams(routeParts.params);byId('headers').value=imported.headers.map(([name,value])=>`${name}: ${value}`).join('\n');body.value=imported.body;
    applyAuthFields({authType:imported.bearerToken?'bearer':'none',bearerToken:imported.bearerToken});if(imported.bearerToken)byId('save-token-history').checked=false;
    byId('request-title').textContent=`cURL - ${imported.method} ${safeRoute.value||'/'}`;activeSaved=null;setEditorTab('params');
    byId('import-dialog').close();updateGuard();updateCopyButtons();renderBodyHighlight();updateJsonTools();syncActiveWorkspaceTab(true);renderWorkspaceTabs();scheduleWorkspaceTabsPersist();
    byId('curl-import-source').value='';showToast('cURL importado',imported.bearerToken?'Bearer importado apenas em memoria; salvamento opcional.':'Request aberta como rascunho.','success');
  }catch(curlError){error.textContent=curlError.message||'Nao foi possivel importar o comando cURL.';error.hidden=false;}
}
async function importCollectionFile(event){
  const file=event.target.files?.[0];event.target.value='';if(!file)return;
  try{
    if(file.size>10*1024*1024)throw Error('O arquivo ultrapassa o limite de 10 MB.');
    const document=JSON.parse(await file.text());let sourceCollection=null,environmentSources=[],enableCapture=true,allowInsecureHttp=false,unsupportedScripts=0,sourceName='Vortix',importWarnings=[];
    if(document.format==='api-studio-collection'&&[1,2].includes(document.version)&&document.collection){sourceCollection=document.collection;allowInsecureHttp=true;if(document.environment)environmentSources.push(document.environment);}
    else if(document._type==='export'&&document.__export_format===4){const imported=importInsomniaCollection(document);sourceCollection=imported.collection;environmentSources=imported.environments;unsupportedScripts=imported.stats.unsupportedScripts;enableCapture=false;sourceName='Insomnia';}
    else if(document.info?.schema?.includes('postman.com/json/collection/v2.')&&Array.isArray(document.item)){const imported=importPostmanCollection(document);sourceCollection=imported.collection;environmentSources=imported.environments;unsupportedScripts=imported.stats.unsupportedScripts;enableCapture=false;sourceName='Postman';}
    else if(typeof document.openapi==='string'){const parsed=RunnerLogic.parseOpenApiSpec(document);sourceCollection=parsed.collection;environmentSources=parsed.environment?[parsed.environment]:[];importWarnings=parsed.warnings;sourceName='OpenAPI';}
    else{const environment=importPostmanEnvironment(document);if(environment)environmentSources.push(environment);else throw Error('Formato não reconhecido. Use Vortix JSON, arquivos API Studio JSON legados, Insomnia v4, Postman v2.1 ou um ambiente Postman.');}
    const containsCredentials=(sourceCollection&&collectionHasAuthCredentials(sourceCollection))||environmentSources.some(environment=>environmentHasAuthCredentials(environment.variables));
    const keepCredentials=containsCredentials?await confirmWithDialog({eyebrow:'DADOS SENSÍVEIS',title:'Credenciais encontradas',description:'Salvar Bearer, Basic, API Keys e variáveis sensíveis no SQLite local protegido?',warning:'A escolha Importar sem credenciais descarta esses valores. A proteção depende das chaves e da identidade desta instalação.',confirmLabel:'Importar credenciais',cancelLabel:'Importar sem credenciais',danger:true}):false;
    let imported=null;
    if(sourceCollection){
      imported=normalizeImportedNode(sourceCollection,keepCredentials,0,true,enableCapture,allowInsecureHttp);
      if(collections.some(item=>item.name.toLowerCase()===imported.name.toLowerCase()))imported.name+=' (importada)';
      collections.push(imported);await dbWrite('collections',imported);selectedContainer={collectionId:imported.id,folderId:''};collapsed.delete(imported.id);renderCollectionTree();
    }
    let addedEnvironments=0;
    for(const source of environmentSources.slice(0,100)){
      let name=String(source.name||'Ambiente importado').slice(0,80);while(environments.some(environment=>environment.name.toLowerCase()===name.toLowerCase()))name+=' (importado)';
      const variables={};for(const[key,value]of Object.entries(source.variables||{})){if(/cookie|private[_-]?key/i.test(key))continue;if(isSensitiveName(key)&&!keepCredentials)continue;Object.defineProperty(variables,key,{value:typeof value==='string'?value:JSON.stringify(value),enumerable:true,writable:true,configurable:true});}
      const environment={id:newId(),name,group:String(source.group||sourceName).slice(0,60),variables};await dbWrite('environments',environment);environments.push(environment);addedEnvironments++;
    }
    if(addedEnvironments)renderEnvironmentSelect();
    const capturesDisabled=!enableCapture&&sourceCollection&&collectionHasResponseCaptureConfig(sourceCollection);
    const message=[imported?'Requests e pastas disponíveis.':'Ambiente disponível no seletor.',containsCredentials&&!keepCredentials?' Credenciais omitidas.':'',capturesDisabled?'Automações importadas desativadas até sua revisão.':'',unsupportedScripts?` ${unsupportedScripts} script(s) não convertidos; configure em Scripts.`:''].join('');
    if(importWarnings.length)message+=(message?' ':'')+importWarnings.join(' ');
    showToast(imported?'Coleção importada':'Ambiente importado',message,importWarnings.length?'warning':'success');
  }catch(error){showToast('Falha na importação',error.message||'Arquivo JSON inválido.','error');}
}function flattenContainers(){
  const result=[];const visit=(collection,node,folders=[])=>{result.push({collectionId:collection.id,folderId:folders.at(-1)?.id||'',label:collection.name+(folders.length?' / '+folders.map(x=>x.name).join(' / '):'')});for(const folder of node.folders||[])visit(collection,folder,[...folders,folder]);};
  for(const collection of collections)visit(collection,collection);return result;
}
function openSaveDialog(){
  if(!collections.length){showToast('Crie uma coleção','Adicione uma coleção antes de salvar requests.','info');return;}
  try{buildRequestRoute();}catch(error){showToast('Revise a requisição',error.message,'error');return;}
  byId('saved-request-name').value=activeSaved?.name||route.value.trim()||'Nova requisição';
  const select=byId('saved-request-folder');select.replaceChildren();
  for(const item of flattenContainers()){const option=document.createElement('option');option.value=`${item.collectionId}|${item.folderId}`;option.textContent=item.label;option.selected=item.collectionId===selectedContainer.collectionId&&item.folderId===selectedContainer.folderId;select.append(option);}
  byId('save-request-dialog').showModal();byId('saved-request-name').focus();
}
function getSnapshot(){
  validateResponseCaptureForm();const responseTests=getResponseTestsFromForm(),rawRoute=buildRequestRoute(false,true),base=sanitizeBase(byId('base-url').value.trim()),path=rawRoute?sanitizeRoute(rawRoute):{value:'',redacted:false},headers=sanitizeHeaders(byId('headers').value),payload=sanitizeBody(body.value);
  const saveAuth=byId('save-token-history').checked,auth=authFieldsFromForm(value=>value,saveAuth),authOmitted=!saveAuth&&hasAuthCredentials(authFieldsFromForm(value=>value,true));
  return{method:method.value,baseUrl:base.value,route:path.value,headers:headers.value,body:payload.value,...auth,allowInsecureHttp:byId('allow-insecure-http').checked,
    captureResponseVariable:byId('capture-response-variable').checked,responseVariableName:byId('response-variable-name').value.trim(),responseValueSource:byId('response-value-source').value,responseJsonPath:byId('response-json-path').value.trim(),responseSuccessOnly:byId('response-success-only').checked,responseTests,
    redacted:base.redacted||path.redacted||headers.redacted||payload.redacted||authOmitted};
}
async function saveCollectionRequest(event){
  event.preventDefault();const name=byId('saved-request-name').value.trim(),[collectionId,folderId='']=byId('saved-request-folder').value.split('|');
  const collection=findCollection(collectionId),container=findFolder(collection,folderId);if(!name)return;if(!collection||!container){showToast('Destino inválido','Selecione uma coleção ou pasta válida para salvar.','error');return;}
  let snapshot;try{snapshot=getSnapshot();}catch(error){showToast('Revise a requisição',error.message,'error');return;}
  const same=activeSaved?.collectionId===collectionId&&activeSaved?.folderId===folderId;
  const saved={id:same?activeSaved.id:newId(),name,...snapshot,savedAt:new Date().toISOString()};
  container.requests||=[];const index=container.requests.findIndex(x=>x.id===saved.id);if(index>=0)container.requests[index]=saved;else container.requests.push(saved);
  try{
    await dbWrite('collections',collection);activeSaved={id:saved.id,name,collectionId,folderId};selectedContainer={collectionId,folderId};
    byId('request-title').textContent=name;byId('save-request-dialog').close();renderCollectionTree();markActiveWorkspaceTabSaved(saved);
    showToast('Requisição salva',saved.redacted?'Params, headers e body salvos; campos sensíveis foram omitidos.':'Request guardada na coleção e no banco local.','success');
  }catch{showToast('Falha ao salvar','Não foi possível salvar a request na coleção.','error');}
}
function loadCollectionRequest(request,collectionId,folderId,notify=true){
  byId('base-url').value=request.baseUrl||'{{baseUrl}}';baseUrlAuto=request.baseUrl==='{{baseUrl}}';byId('allow-insecure-http').checked=request.allowInsecureHttp===true;method.value=['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(request.method)?request.method:'GET';
  const split=splitRoute(request.route||'');route.value=split.route;renderQueryParams(split.params);byId('headers').value=request.headers||'';body.value=request.body||'';applyAuthFields(request);
  byId('token-client-id').value=request.tokenRequest?request.tokenClientId||'':'';byId('token-client-secret').value='';byId('token-credential-mode').value=request.tokenCredentialMode==='query'?'query':'body';byId('token-helper').open=!!request.tokenRequest;
  if(request.tokenRequest){byId('token-route').value=split.route;byId('token-client-id-field').value=request.tokenClientIdField||'client_id';byId('token-client-secret-field').value=request.tokenClientSecretField||'client_secret';tokenRequestConfig=RunnerLogic.normalizeTokenRequestConfig({route:split.route,clientIdField:byId('token-client-id-field').value,clientSecretField:byId('token-client-secret-field').value,credentialMode:byId('token-credential-mode').value});}
  byId('capture-response-variable').checked=!!request.captureResponseVariable;byId('response-variable-name').value=request.responseVariableName||'token';byId('response-value-source').value=request.responseValueSource==='text'?'text':'json';byId('response-json-path').value=request.responseJsonPath||'access_token';byId('response-success-only').checked=request.responseSuccessOnly!==false;byId('response-variable-result').hidden=true;updateResponseCaptureUi();setResponseTests(request.responseTests||[]);
  updateTokenButton();clearWriteConfirmation();updateGuard();updateCopyButtons();renderBodyHighlight();updateJsonTools();activeSaved={id:request.id,name:request.name,collectionId,folderId};selectedContainer={collectionId,folderId};
  byId('request-title').textContent=request.name||'Requisição salva';setEditorTab('params');renderCollectionTree();
  if(notify)showToast('Requisição carregada',hasAuthCredentials(request)?authTypeLabel(request)+' recuperada do banco local; pode expirar.':'Params, headers e body recuperados da coleção.','success',3500);
}
function clearWriteConfirmation(){byId('confirm-test-data').checked=false;byId('test-data-phrase').value='';}
function writeConfirmationValid(){return byId('confirm-test-data').checked&&byId('test-data-phrase').value.trim()==='TESTE';}
function updateGuard(){
  const isWrite=writeMethods.has(method.value);method.className=`method-select method-${method.value.toLowerCase()}`;
  writeGuard.hidden=!isWrite;sendButton.disabled=!route.value.trim()||(isWrite&&!writeConfirmationValid());
}
function escHtml(value){return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');}
function highlightJson(value){
  const text=String(value??''),pattern=/"(?:\\.|[^"\\])*"|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\b(?:true|false|null)\b|[{}\[\],:]/g;let html='',offset=0;
  for(const match of text.matchAll(pattern)){const token=match[0],index=match.index;html+=escHtml(text.slice(offset,index));let cls='json-punctuation';
    if(token.startsWith('"'))cls=/^\s*:/.test(text.slice(index+token.length))?'json-key':'json-string';else if(/^-?\d/.test(token))cls='json-number';else if(/^(true|false|null)$/.test(token))cls='json-literal';
    html+=`<span class="${cls}">${escHtml(token)}</span>`;offset=index+token.length;}
  return html+escHtml(text.slice(offset))||' ';
}
function renderBodyHighlight(){const highlight=byId('body-highlight');if(!highlight)return;highlight.innerHTML=highlightJson(body.value);highlight.scrollTop=body.scrollTop;highlight.scrollLeft=body.scrollLeft;}
function updateJsonTools(){byId('format-json').disabled=!body.value.trim();byId('minify-json').disabled=!body.value.trim();}
function formatBodyJson(compact=false){
  try{body.value=JSON.stringify(JSON.parse(body.value),null,compact?0:2);body.dispatchEvent(new Event('input',{bubbles:true}));showToast(compact?'JSON compactado':'JSON indentado',compact?'Espaços removidos do body.':'Body formatado com indentação de 2 espaços.','success',3000);}
  catch{showToast('JSON inválido','Revise a sintaxe antes de formatar.','error');}
}
function handleJsonKeydown(event){
  if(event.key==='Tab'){
    event.preventDefault();const start=body.selectionStart,end=body.selectionEnd;
    if(event.shiftKey){const lineStart=body.value.lastIndexOf('\n',start-1)+1;if(body.value.slice(lineStart,start).startsWith('  ')){body.setRangeText('',lineStart,lineStart+2,'end');const cursor=Math.max(lineStart,start-2);body.setSelectionRange(cursor,cursor);}}
    else{body.setRangeText('  ',start,end,'end');}
    body.dispatchEvent(new Event('input',{bubbles:true}));return;
  }
  if(event.key==='Enter'){
    const start=body.selectionStart,end=body.selectionEnd,before=body.value.slice(0,start),after=body.value.slice(end),line=before.slice(before.lastIndexOf('\n')+1),indent=line.match(/^\s*/)?.[0]||'',opens=/[\[{]\s*$/.test(before),closes=/^[\]}]/.test(after);
    let inserted='\n'+indent+(opens?'  ':''),cursor=start+inserted.length;
    if(opens&&closes){inserted='\n'+indent+'  \n'+indent;cursor=start+1+indent.length+2;}
    event.preventDefault();body.setRangeText(inserted,start,end,'end');body.setSelectionRange(cursor,cursor);body.dispatchEvent(new Event('input',{bubbles:true}));
  }
}
function showResponse(statusText,statusClass,headersText,bodyText){
  const status=byId('response-status');status.textContent=statusText;status.className='status '+statusClass;
  const headers=byId('response-headers');headers.innerHTML=headersText?highlightJson(headersText):'A resposta aparecerá aqui.';headers.classList.toggle('empty',!headersText);
  responseBodyState=RunnerLogic.parseResponseBody(bodyText);responseTreeSource=null;
  if(!responseBodyState.isJson&&responseBodyView==='tree')responseBodyView='pretty';
  if(!responseBodyState.raw)byId('response-search').value='';
  renderResponseBody();updateCopyButtons();
}

function setResponseView(view){
  if(!['pretty','tree','raw'].includes(view))return;
  if(view==='tree'&&!responseBodyState.isJson)return;
  responseBodyView=view;renderResponseBody();
}

function renderResponseBody(){
  const output=byId('response-body'),pre=byId('response-body-pre'),tree=byId('response-tree'),search=byId('response-search');
  const raw=responseBodyState.raw,query=search.value.trim(),text=responseBodyView==='raw'?raw:responseBodyState.pretty;
  output.classList.toggle('empty',!raw);search.disabled=!raw;
  document.querySelectorAll('[data-response-view]').forEach(button=>{button.setAttribute('aria-pressed',String(button.dataset.responseView===responseBodyView));button.disabled=!raw||(button.dataset.responseView==='tree'&&!responseBodyState.isJson);});
  if(!raw){pre.textContent='A resposta aparecerá aqui.';pre.hidden=false;tree.replaceChildren();tree.hidden=true;responseTreeSource=null;byId('response-search-count').textContent='';return;}
  const matches=RunnerLogic.findTextMatches(text,query);byId('response-search-count').textContent=query?(matches.length?matches.length+' '+(matches.length===1?'ocorrência':'ocorrências'):'Nenhuma ocorrência'):'';
  if(responseBodyView==='tree'){pre.hidden=true;tree.hidden=false;if(responseTreeSource!==responseBodyState)buildResponseTree();const found=filterResponseTree(query);tree.querySelector('.response-tree-empty').hidden=!query||found;return;}
  tree.hidden=true;pre.hidden=false;pre.innerHTML=highlightJson(text);highlightResponseMatches(pre,query);
}

function responseValuePreview(value){if(Array.isArray(value))return '['+value.length+' itens]';if(value&&typeof value==='object')return '{'+Object.keys(value).length+' propriedades}';if(typeof value==='string')return JSON.stringify(value);return value===null?'null':String(value);}

function appendResponseTreeEntry(parent,label,value,pathParts,depth,state){
  if(state.count>=2000){state.truncated=true;return;}state.count++;
  const entry=document.createElement('div'),line=document.createElement('div'),container=value!==null&&typeof value==='object';entry.className='response-tree-entry';
  const preview=responseValuePreview(value);entry.dataset.searchText=(pathParts.length?String(label)+' '+(container?'':preview):'').toLocaleLowerCase();line.className='response-tree-line';
  if(container){
    const toggle=document.createElement('button'),children=document.createElement('div'),expanded=depth<1;toggle.type='button';toggle.className='response-tree-toggle';toggle.setAttribute('aria-expanded',String(expanded));toggle.setAttribute('aria-label',(expanded?'Recolher ':'Expandir ')+label);
    children.className='response-tree-children';children.hidden=!expanded;toggle.onclick=()=>{const open=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',(open?'Recolher ':'Expandir ')+label);children.hidden=!open;};
    line.append(toggle);entry.append(line,children);const items=Array.isArray(value)?value.map((child,index)=>[index,child]):Object.entries(value);
    for(const[key,child]of items){if(state.count>=2000){state.truncated=true;break;}appendResponseTreeEntry(children,Array.isArray(value)?'['+key+']':key,child,[...pathParts,key],depth+1,state);if(state.truncated)break;}
  }else{const spacer=document.createElement('span');spacer.className='response-tree-spacer';spacer.setAttribute('aria-hidden','true');line.append(spacer);entry.append(line);}
  const key=document.createElement('span'),valueElement=document.createElement('span');key.className='response-tree-key';key.textContent=String(label);
  valueElement.className='response-tree-value '+(container?'json-punctuation':typeof value==='string'?'json-string':typeof value==='number'?'json-number':'json-literal');valueElement.textContent=preview.length>120?preview.slice(0,117)+'…':preview;if(preview.length>120)valueElement.title=preview;line.append(key,valueElement);
  if(pathParts.length){const path=RunnerLogic.formatJsonPath(pathParts),copy=document.createElement('button');copy.type='button';copy.className='copy-button response-tree-copy';copy.textContent='Copiar';copy.dataset.copyJsonPath=path;copy.title='Copiar caminho JSON '+path;copy.setAttribute('aria-label','Copiar caminho JSON '+path);line.append(copy);}
  parent.append(entry);
}

function buildResponseTree(){
  const tree=byId('response-tree');tree.replaceChildren();const state={count:0,truncated:false};appendResponseTreeEntry(tree,'Resposta',responseBodyState.value,[],0,state);
  if(state.truncated){const note=document.createElement('p');note.className='response-tree-limit';note.textContent='Árvore limitada a 2.000 itens. Use Pretty ou Raw para ver o body completo.';tree.append(note);}
  const empty=document.createElement('p');empty.className='response-tree-empty hint';empty.textContent='Nenhum campo corresponde à busca.';empty.hidden=true;tree.append(empty);responseTreeSource=responseBodyState;
}

function filterResponseTree(query){
  const term=String(query||'').toLocaleLowerCase(),tree=byId('response-tree');
  function visit(entry){const children=entry.querySelector(':scope > .response-tree-children'),rows=children?[...children.querySelectorAll(':scope > .response-tree-entry')]:[];let childMatch=false;for(const child of rows)if(visit(child))childMatch=true;
    const ownMatch=!term||entry.dataset.searchText.includes(term);entry.hidden=!!term&&!ownMatch&&!childMatch;
    if(term&&childMatch&&children){children.hidden=false;const toggle=entry.querySelector(':scope > .response-tree-line > .response-tree-toggle');if(toggle){toggle.setAttribute('aria-expanded','true');toggle.setAttribute('aria-label','Recolher '+entry.querySelector(':scope > .response-tree-line .response-tree-key').textContent);}}return ownMatch||childMatch;}
  let found=false;for(const entry of [...tree.querySelectorAll(':scope > .response-tree-entry')])if(visit(entry))found=true;return found;
}

function highlightResponseMatches(element,query){
  if(!query)return;const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT),nodes=[];let node;while((node=walker.nextNode()))nodes.push(node);
  for(const textNode of nodes){const text=textNode.nodeValue,matches=RunnerLogic.findTextMatches(text,query);if(!matches.length)continue;const fragment=document.createDocumentFragment();let cursor=0;
    for(const match of matches){fragment.append(document.createTextNode(text.slice(cursor,match.start)));const mark=document.createElement('mark');mark.className='response-search-hit';mark.textContent=text.slice(match.start,match.end);fragment.append(mark);cursor=match.end;}fragment.append(document.createTextNode(text.slice(cursor)));textNode.replaceWith(fragment);}
}

async function copyOutput(id,label){
  const output=byId(id),text=id==='response-body'?(responseBodyView==='raw'?responseBodyState.raw:responseBodyState.pretty):output.textContent;if(!text.trim())return;
  try{await navigator.clipboard.writeText(text);showToast('Copiado',label+' copiado para a área de transferência.','success');}
  catch{showToast('Falha ao copiar','O navegador bloqueou a área de transferência. Tente novamente pelo botão.','error');}
}
async function copyResponsePath(path){
  try{await navigator.clipboard.writeText(path);showToast('Caminho copiado',path+' pronto para colar em Scripts ou Testes.','success');}
  catch{showToast('Falha ao copiar caminho','O navegador bloqueou a área de transferência. Tente novamente pelo botão.','error');}
}
function apiStatusToast(status,reason){
  const label=`${status} ${reason}`.trim();if(status>=200&&status<300){showToast('Sucesso',`API respondeu ${label}.`,'success');return;}if(status>=300&&status<400){showToast('Redirecionamento',`API respondeu ${label}. Confira a URL base e use HTTPS.`,'warning');return;}
  const guide=status===401?'Confira o token Bearer.':status===403?'Confira as permissões do token.':status===404?'Confira a rota e a URL base.':status===429?'Aguarde antes de tentar novamente.':status>=500?'Falha no servidor da API; tente novamente mais tarde.':'Confira os campos e o JSON da requisição.';showToast('Erro da API',`${label}. ${guide}`,'error');
}
function setEditorTab(name){
  document.querySelectorAll('[data-editor-tab]').forEach(button=>{const active=button.dataset.editorTab===name;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));});
  document.querySelectorAll('[data-editor-panel]').forEach(panel=>panel.hidden=panel.dataset.editorPanel!==name);if(name==='body')renderBodyHighlight();if(name==='scripts')updateInsomniaScriptPreview();syncActiveWorkspaceTab(false);
}
function responseTestField(labelText,control,id){
  const field=document.createElement('div');field.className='response-test-field';field.dataset.field=labelText.toLowerCase();
  const label=document.createElement('label');label.htmlFor=id;label.textContent=labelText;control.id=id;field.append(label,control);return field;
}
function updateResponseTestRow(row,reset=false){
  const target=row.querySelector('.response-test-target'),path=row.querySelector('.response-test-path'),operator=row.querySelector('.response-test-operator'),expected=row.querySelector('.response-test-expected'),jsonTarget=target.value==='json';
  const selected=operator.value||row.dataset.operator,options=jsonTarget?[['exists','existe'],['equals','é igual a'],['contains','contém']]:[['equals','é igual a']];
  operator.replaceChildren(...options.map(([value,label])=>{const option=document.createElement('option');option.value=value;option.textContent=label;return option;}));
  operator.value=reset?(jsonTarget?'exists':'equals'):options.some(([value])=>value===selected)?selected:options[0][0];row.dataset.operator='';
  row.querySelector('[data-field="campo json"]').hidden=!jsonTarget;
  const needsExpected=operator.value!=='exists';row.querySelector('[data-field="valor esperado"]').hidden=!needsExpected;expected.disabled=!needsExpected;
  path.disabled=!jsonTarget;
  if(reset){if(jsonTarget){path.value='data.id';expected.value='';}else{path.value='';expected.value='200';}}
}
function createResponseTestRow(rule={id:newId(),target:'status',operator:'equals',expected:'200'}){
  const normalized=RunnerLogic.normalizeResponseTests([rule])[0],row=document.createElement('div');row.className='response-test-row';row.dataset.testId=normalized.id||newId();
  const target=document.createElement('select');target.className='response-test-target';target.setAttribute('aria-label','Alvo do teste');
  for(const[value,label]of[['status','Status HTTP'],['json','Campo JSON']]){const option=document.createElement('option');option.value=value;option.textContent=label;target.append(option);}target.value=normalized.target;
  const path=document.createElement('input');path.type='text';path.className='response-test-path';path.value=normalized.path;path.placeholder='data.id';path.autocomplete='off';path.spellcheck=false;path.setAttribute('aria-label','Caminho JSON');
  const operator=document.createElement('select');operator.className='response-test-operator';operator.setAttribute('aria-label','Condição do teste');
  const expected=document.createElement('input');expected.type='text';expected.className='response-test-expected';expected.value=normalized.expected;expected.autocomplete='off';expected.spellcheck=false;expected.placeholder='200';expected.setAttribute('aria-label','Valor esperado');
  const remove=document.createElement('button');remove.type='button';remove.className='response-test-remove';remove.textContent='×';remove.setAttribute('aria-label','Remover teste da resposta');remove.onclick=()=>row.remove();
  row.dataset.operator=normalized.operator;row.append(responseTestField('Alvo',target,`response-test-target-${row.dataset.testId}`),responseTestField('Campo JSON',path,`response-test-path-${row.dataset.testId}`),responseTestField('Condição',operator,`response-test-operator-${row.dataset.testId}`),responseTestField('Valor esperado',expected,`response-test-expected-${row.dataset.testId}`),remove);
  target.onchange=()=>updateResponseTestRow(row,true);operator.onchange=()=>updateResponseTestRow(row);updateResponseTestRow(row);return row;
}
function setResponseTests(tests){
  const normalized=RunnerLogic.normalizeResponseTests(tests||[]),list=byId('response-tests-list');list.replaceChildren(...normalized.map(createResponseTestRow));renderResponseTestResults([]);
}
function getResponseTestsFromForm(){
  return RunnerLogic.normalizeResponseTests([...byId('response-tests-list').querySelectorAll('.response-test-row')].map(row=>({
    id:row.dataset.testId,target:row.querySelector('.response-test-target').value,path:row.querySelector('.response-test-path').value,
    operator:row.querySelector('.response-test-operator').value,expected:row.querySelector('.response-test-expected').value
  })));
}
function addResponseTest(){
  const list=byId('response-tests-list');if(list.children.length>=20){showToast('Limite de testes','Cada requisição aceita até 20 verificações.','warning');return;}
  const row=createResponseTestRow();list.append(row);row.querySelector('.response-test-target').focus();
}
function renderResponseTestResults(results){
  const section=byId('response-tests-output'),list=byId('response-tests-results'),summary=byId('response-tests-summary');list.replaceChildren();section.hidden=!results.length;if(!results.length){summary.textContent='';return;}
  const passed=results.filter(result=>result.passed).length;summary.textContent=`${passed}/${results.length} passaram`;
  for(const result of results){const row=document.createElement('li');row.className='response-test-result';row.dataset.kind=result.passed?'success':'failure';const name=document.createElement('span');name.className='response-test-result-name';name.textContent=result.label;const state=document.createElement('span');state.className='response-test-result-state';state.textContent=result.passed?'Passou':'Falhou';row.append(name,state);if(result.message){const message=document.createElement('span');message.className='response-test-result-message';message.textContent=result.message;row.append(message);}list.append(row);}
}
function applyTypography(){
  document.documentElement.style.setProperty('--app-font-family',fontFamilies.get(activeFont)||fontFamilies.get(DEFAULT_FONT));
  byId('font-select').value=activeFont;
}
async function saveFont(name){
  if(!fontFamilies.has(name))return;
  activeFont=name;applyTypography();
  try{await dbWrite('settings',{key:'fontFamily',value:activeFont});showToast('Fonte salva','Preferência aplicada neste navegador.','success',2500);}
  catch{showToast('Fonte aplicada','Não foi possível salvar a preferência local.','warning');}
}
function applyUiScale(){
  document.documentElement.style.setProperty('--ui-scale',String(activeScale));
  byId('font-scale-value').textContent=Math.round(activeScale*100)+'%';
  byId('decrease-font').disabled=activeScale<=MIN_UI_SCALE;
  byId('increase-font').disabled=activeScale>=MAX_UI_SCALE;
}
async function setUiScale(value){
  if(!Number.isFinite(value))return;
  const next=Math.max(MIN_UI_SCALE,Math.min(MAX_UI_SCALE,Math.round(value*20)/20));
  if(next===activeScale)return;
  activeScale=next;applyUiScale();if(byId('runner-dialog')?.open)fitRunnerDialog();
  try{await dbWrite('settings',{key:'uiScale',value:activeScale});}
  catch{showToast('Escala aplicada','Não foi possível salvar a preferência local.','warning');}
}
function handleScaleShortcut(event){
  if(!(event.ctrlKey||event.metaKey)||event.altKey)return;
  let next;
  if(event.key==='+'||event.key==='='||event.code==='NumpadAdd')next=activeScale+0.05;
  else if(event.key==='-'||event.code==='NumpadSubtract')next=activeScale-0.05;
  else if(event.key==='0'||event.code==='Numpad0'||event.code==='Digit0')next=DEFAULT_UI_SCALE;
  else return;
  event.preventDefault();void setUiScale(next);
}
function applyTheme(name){
  activeTheme=themes.has(name)?name:'dracula';
  document.documentElement.dataset.theme=activeTheme;
  byId('theme-select').value=activeTheme;
}
async function saveTheme(name){
  if(!themes.has(name))return;
  applyTheme(name);
  try{await dbWrite('settings',{key:'activeTheme',value:activeTheme});showToast('Tema salvo','Tema '+activeTheme+' aplicado neste navegador.','success',2500);}
  catch{showToast('Tema aplicado','Não foi possível salvar a preferência local.','warning');}
}function getEnvironment(){return environments.find(x=>x.id===activeEnvironmentId)||environments[0]||{variables:{}};}
function applyEnvironment(value){
  const vars=getEnvironment().variables||{},missing=new Set();const resolved=String(value??'').replace(/\{\{\s*([^{}]+?)\s*\}\}/g,(whole,key)=>{if(Object.hasOwn(vars,key))return String(vars[key]);missing.add(key);return whole;});
  if(missing.size)throw Error('Variável(veis) sem valor no ambiente: '+[...missing].join(', '));return resolved;
}
function renderEnvironmentSelect(){
  const select=byId('environment-select');select.replaceChildren();const groups=new Map();
  for(const env of environments){const group=String(env.group||'Geral').trim()||'Geral';if(!groups.has(group)){const optionGroup=document.createElement('optgroup');optionGroup.label=group;groups.set(group,optionGroup);select.append(optionGroup);}
    const option=document.createElement('option');option.value=env.id;option.textContent=env.name;option.selected=env.id===activeEnvironmentId;groups.get(group).append(option);}
}async function chooseEnvironment(id){if(!environments.some(x=>x.id===id))return;activeEnvironmentId=id;await dbWrite('settings',{key:'activeEnvironmentId',value:id});renderEnvironmentSelect();if(baseUrlAuto)byId('base-url').value=Object.hasOwn(getEnvironment().variables||{},'baseUrl')?'{{baseUrl}}':'';await loadTokenRequestConfig();syncActiveWorkspaceTab(false);showToast('Ambiente alterado',`Requests usarão “${getEnvironment().name}”.`,'info',3000);}
function makeVarRow(key='',value=''){
  const row=document.createElement('div');row.className='environment-var-row';const name=document.createElement('input');name.className='environment-var-name';name.value=key;name.placeholder='chave';name.autocomplete='off';name.setAttribute('aria-label','Nome da variável');
  const input=document.createElement('input');input.className='environment-var-value';input.value=value;input.type=isSensitiveName(key)?'password':'text';input.placeholder='valor';input.autocomplete='new-password';input.setAttribute('aria-label',`Valor da variável ${key||'nova'}`);
  name.oninput=()=>input.type=isSensitiveName(name.value)?'password':'text';const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.title='Remover variável';remove.setAttribute('aria-label','Remover variável');remove.onclick=()=>row.remove();row.append(name,input,remove);return row;
}
function renderEnvironmentDraft(){
  const list=byId('environment-list');list.replaceChildren();
  for(const env of environmentDraft){
    const card=document.createElement('section');card.className='environment-card';card.dataset.environmentId=env.id;
    const heading=document.createElement('div');heading.className='environment-card-heading';
    const name=document.createElement('input');name.className='environment-name';name.value=env.name;name.maxLength=80;name.placeholder='Nome do ambiente';name.setAttribute('aria-label','Nome do ambiente');
    const remove=document.createElement('button');remove.type='button';remove.dataset.removeEnvironment='';remove.textContent='Excluir';remove.setAttribute('aria-label','Excluir ambiente '+env.name);heading.append(name,remove);
    const groupRow=document.createElement('div');groupRow.className='environment-group-row';const groupLabel=document.createElement('label');groupLabel.textContent='Grupo';
    const group=document.createElement('input');group.className='environment-group';group.value=env.group||'Local';group.maxLength=60;group.placeholder='Ex.: Desenvolvimento';group.setAttribute('aria-label','Grupo do ambiente');groupRow.append(groupLabel,group);
    const varsHeading=document.createElement('div');varsHeading.className='environment-vars-heading';varsHeading.innerHTML='<span>CHAVE</span><span>VALOR</span><span></span>';
    const vars=document.createElement('div');vars.className='environment-vars';for(const[k,v]of Object.entries(env.variables||{}))vars.append(makeVarRow(k,v));
    const add=document.createElement('button');add.className='environment-add-var';add.type='button';add.dataset.addVariable='';add.innerHTML='<span aria-hidden="true">＋</span> Adicionar variável';
    card.append(heading,groupRow,varsHeading,vars,add);list.append(card);
  }
}
function openSettingsDialog(){byId('settings-dialog').showModal();}
function openEnvironmentDialog(){environmentDraft=JSON.parse(JSON.stringify(environments));renderEnvironmentDraft();byId('environment-dialog').showModal();}
function addEnvironmentDraft(){environmentDraft.push({id:newId(),name:'Novo ambiente',group:'Local',variables:{}});renderEnvironmentDraft();byId('environment-list').lastElementChild.querySelector('.environment-name').focus();}
async function saveEnvironmentDraft(event){
  event.preventDefault();const next=[];
  for(const card of byId('environment-list').children){
    const name=card.querySelector('.environment-name').value.trim(),group=card.querySelector('.environment-group').value.trim()||'Geral';
    if(!name){showToast('Nome obrigatório','Informe o nome de cada ambiente.','error');return;}
    const variables={};
    for(const row of card.querySelectorAll('.environment-var-row')){
      const key=row.querySelector('.environment-var-name').value.trim(),value=row.querySelector('.environment-var-value').value;
      if(!key&&!value)continue;if(!key){showToast('Chave obrigatória','Informe a chave de cada variável preenchida.','error');return;}
      if(Object.hasOwn(variables,key)){showToast('Chave repetida','A chave '+key+' aparece mais de uma vez.','error');return;}variables[key]=value;
    }
    next.push({id:card.dataset.environmentId,name,group,variables});
  }
  if(!next.length){showToast('Mantenha um ambiente','Crie pelo menos um ambiente.','error');return;}
  try{
    const ids=new Set(next.map(x=>x.id));for(const env of environments)if(!ids.has(env.id)){await dbWrite('environments',env.id,true);await dbWrite('settings',TOKEN_REQUEST_CONFIG_KEY+':'+env.id,true);}
    for(const env of next)await dbWrite('environments',env);environments=next;
    if(!environments.some(x=>x.id===activeEnvironmentId))activeEnvironmentId=environments[0].id;
    environmentDraft=[];await dbWrite('settings',{key:'activeEnvironmentId',value:activeEnvironmentId});renderEnvironmentSelect();await loadTokenRequestConfig();
    if(baseUrlAuto)byId('base-url').value=Object.hasOwn(getEnvironment().variables||{},'baseUrl')?'{{baseUrl}}':'';
    byId('environment-dialog').close();showToast('Ambientes salvos','Grupos e variáveis persistidos no banco local.','success');
  }catch{showToast('Falha ao salvar','Não foi possível persistir os ambientes.','error');}
}function tokenCandidate(value){if(typeof value!=='string')return'';const token=value.trim().replace(/^Bearer\s+/i,'');return token.length>=16&&!/\s/.test(token)?token:'';}
function findToken(value,depth=0){if(!value||typeof value!=='object'||depth>4)return'';for(const[key,child]of Object.entries(value))if(['access_token','accesstoken','token','bearer','jwt'].includes(key.toLowerCase())){const token=tokenCandidate(child);if(token)return token;}for(const child of Object.values(value)){const token=findToken(child,depth+1);if(token)return token;}return'';}
function extractToken(raw){try{const parsed=JSON.parse(raw);return typeof parsed==='string'?tokenCandidate(parsed):findToken(parsed);}catch{return tokenCandidate(raw);}}
function updateCopyButtons(){
  const headers=byId('response-headers');byId('copy-headers').disabled=headers.classList.contains('empty')||!headers.textContent.trim();
  byId('copy-body').disabled=!responseBodyState.raw;
}
function updateInsomniaScriptPreview(){
  const output=byId('insomnia-script-preview');if(!output)return;const variable=byId('response-variable-name').value.trim()||'token',source=byId('response-value-source').value;
  let expression='insomnia.response.text()',lines=[];
  if(source==='json'){try{const parts=parseJsonPath(byId('response-json-path').value);expression='body'+parts.map(part=>typeof part==='number'?`[${part}]`:/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(part)?'.'+part:`[${JSON.stringify(part)}]`).join('');lines.push('const body = insomnia.response.json();');}catch{lines.push('const body = insomnia.response.json(); // revise o caminho JSON');expression='body.<campo>';}}
  const assign=`insomnia.environment.set(${JSON.stringify(variable)}, ${expression});`;
  if(byId('response-success-only').checked){lines.push('if (insomnia.response.code >= 200 && insomnia.response.code < 300) {',`  ${assign}`,'}');}else lines.push(assign);
  output.textContent=lines.join('\n');
}
function updateResponseCaptureUi(){
  byId('response-json-path-wrap').hidden=byId('response-value-source').value!=='json';
  byId('response-variable-result').hidden=true;
  updateInsomniaScriptPreview();
}
function validateResponseCaptureForm(){
  if(!byId('capture-response-variable').checked)return;
  const name=byId('response-variable-name').value.trim();if(!/^[A-Za-z0-9_.-]{1,80}$/.test(name)||['__proto__','prototype','constructor'].includes(name))throw Error('Informe um nome de variável válido (até 80 caracteres).');
  if(byId('response-value-source').value==='json'){const path=byId('response-json-path').value.trim();if(!path)throw Error('Informe o caminho do campo JSON, por exemplo access_token.');parseJsonPath(path);}
}
function showResponseVariableResult(title,kind='success'){const section=byId('response-variable-result');section.hidden=false;section.dataset.kind=kind;byId('response-variable-result-title').textContent=title;}
async function saveEnvironmentVariable(name,value){
  if(!/^[A-Za-z0-9_.-]{1,80}$/.test(name)||['__proto__','prototype','constructor'].includes(name))throw Error('Nome da variável inválido.');
  const serialized=typeof value==='string'?value:JSON.stringify(value);if(serialized===undefined||serialized.length>100000)throw Error('O valor está vazio ou excede 100 KB.');
  const current=getEnvironment(),updated={...current,variables:{...(current.variables||{})}};Object.defineProperty(updated.variables,name,{value:serialized,writable:true,enumerable:true,configurable:true});
  await dbWrite('environments',updated);environments=environments.map(environment=>environment.id===updated.id?updated:environment);renderEnvironmentSelect();return updated;
}
async function captureResponseVariable(request,result,quiet=false){
  if(!request.captureResponseVariable)return{ok:true,captured:false};const status=Number(result.status)||0;
  if(request.responseSuccessOnly&&!(status>=200&&status<300)){const message=`Não salvo: resposta HTTP ${status}.`;if(!quiet)showResponseVariableResult(message,'warning');return{ok:false,captured:false,error:message};}
  try{
    const name=String(request.responseVariableName||'').trim();
    const value=request.responseValueSource==='text'?String(result.body??''):jsonPathValue(JSON.parse(String(result.body??'')),request.responseJsonPath);
    const updated=await saveEnvironmentVariable(name,value);
    if(!quiet){showResponseVariableResult(`{{${name}}} salva no ambiente “${updated.name}”.`);showToast('Variável salva',`{{${name}}} já pode ser usada nas próximas requests.`,'success');}
    return{ok:true,captured:true,name,environment:updated.name};
  }catch(error){const message=error.message||'Não foi possível ler o valor da resposta.';if(!quiet){showResponseVariableResult(message,'error');showToast('Variável não salva',message,'error');}return{ok:false,captured:true,error:message};}
}
async function executeApiRequest(request){
  const response=await fetch('/api/request',{method:'POST',headers:{'Content-Type':'application/json','X-Api-Studio':'1'},cache:'no-store',body:JSON.stringify(request)});
  let result;try{result=await response.json();}catch{throw Error('O servidor local devolveu uma resposta inválida.');}
  return{proxyStatus:response.status,result};
}
async function performApiRequest(request,button,save,historyRequest=request){
  button.disabled=true;byId('request-note').textContent='Aguardando resposta. Credenciais não serão armazenadas automaticamente.';showResponse('Enviando…','pending','','');renderResponseTestResults([]);
  const toast=showToast('Enviando requisição',request.method+' '+request.route.split('?')[0],'info',0);
  try{
    if(save)await saveHistory(historyRequest);
    const {proxyStatus,result}=await executeApiRequest(request);dismissToast(toast);
    if(result.error||proxyStatus>=400){const message=result.error||`Servidor local respondeu HTTP ${proxyStatus}.`;showResponse('Erro '+proxyStatus,'bad','',message);showToast('Requisição não enviada',message,'error');}
    else{const status=(result.status+' '+result.reason).trim();const output=result.body??'';showResponse(status,result.status>=200&&result.status<300?'ok':'bad',JSON.stringify(result.headers??{},null,2),output);apiStatusToast(result.status,result.reason);const testResults=RunnerLogic.evaluateResponseTests(request.responseTests,result);renderResponseTestResults(testResults);if(testResults.length){const failed=testResults.filter(item=>!item.passed);showToast(failed.length?'Testes da resposta falharam':'Testes da resposta passaram',`${testResults.length-failed.length}/${testResults.length} verificações passaram.`,failed.length?'error':'success');}await captureResponseVariable(request,result);}
    return result;
  }catch{dismissToast(toast);const message='Servidor local indisponível. Confira se está ativo e tente novamente.';showResponse('Falha local','bad','',message);showToast('Falha de conexão',message,'error');return null;}
  finally{button.disabled=false;updateGuard();}
}
function requestFromForm(selectedMethod,requestRoute,resolveValues=true){
  const resolve=value=>resolveValues?applyEnvironment(value):value,auth=authFieldsFromForm(resolve,true);
  return{baseUrl:resolve(byId('base-url').value.trim()),route:resolve(requestRoute),method:selectedMethod,...auth,headers:resolve(byId('headers').value),body:resolve(body.value),
    allowInsecureHttp:byId('allow-insecure-http').checked,confirmTestData:byId('confirm-test-data').checked,testDataPhrase:byId('test-data-phrase').value,confirmTokenRequest:false,
    saveBearerToken:byId('save-token-history').checked,
    captureResponseVariable:byId('capture-response-variable').checked,responseVariableName:byId('response-variable-name').value.trim(),responseValueSource:byId('response-value-source').value,responseJsonPath:byId('response-json-path').value.trim(),responseSuccessOnly:byId('response-success-only').checked,responseTests:getResponseTestsFromForm()};
}
async function sendCurrentRequest(){
  const selectedMethod=method.value;let request;
  try{
    validateResponseCaptureForm();
    const rawRoute=buildRequestRoute(),resolvedRoute=buildRequestRoute(true);
    if(writeMethods.has(selectedMethod)&&!writeConfirmationValid())throw Error('Digite TESTE e confirme que URL e dados são exclusivos de teste.');
    const historyRequest=requestFromForm(selectedMethod,rawRoute,false);
    request=requestFromForm(selectedMethod,rawRoute);
    const insecureOrigin=RunnerLogic.remoteHttpOrigin(request.baseUrl);
    if(insecureOrigin&&!request.allowInsecureHttp)throw Error('HTTP fora de localhost está bloqueado. Marque a opção de HTTP sem TLS nesta request para continuar.');
    const destination=sanitizeBase(request.baseUrl).value.replace(/\/+$/,'')+sanitizeRoute(resolvedRoute).value;
    const insecureWarning=insecureOrigin?remoteHttpWarning(insecureOrigin):'';
    const queryKeyWarning=request.authType==='apiKey'&&request.apiKeyLocation==='query'?'A API Key será enviada na query string, onde pode ficar registrada em logs e históricos da API. Prefira header.':'';
    if(writeMethods.has(selectedMethod)){
      const warning=['Confirme que o ambiente e os dados são descartáveis e exclusivos para teste.',insecureWarning,queryKeyWarning].filter(Boolean).join(' ');
      if(!(await confirmWithDialog({eyebrow:'ALTERAÇÃO DE DADOS',title:'Confirmar envio '+selectedMethod+'?',description:destination,warning,confirmLabel:'Enviar '+selectedMethod,danger:true}))){
        showToast('Envio cancelado','Nenhuma requisição foi enviada.','info');return;
      }
    }else if((insecureOrigin||queryKeyWarning)&&!(await confirmWithDialog({eyebrow:queryKeyWarning?'API KEY NA QUERY':'HTTP SEM TLS',title:queryKeyWarning?'Enviar request com API Key na query?':'Enviar request sem HTTPS?',description:destination,warning:[insecureWarning,queryKeyWarning].filter(Boolean).join(' '),confirmLabel:'Enviar request',danger:true}))){
      showToast('Envio cancelado','Nenhuma requisição foi enviada.','info');return;
    }
    request.route=resolvedRoute;let result;
    try{result=await performApiRequest(request,sendButton,true,historyRequest);}
    finally{
      if(writeMethods.has(selectedMethod))clearWriteConfirmation();byId('request-note').textContent=writeMethods.has(selectedMethod)?'Confirmação consumida. Confirme novamente para outra gravação.':'A resposta é temporária; reutilize a request pela coleção ou histórico.';updateGuard();
    }
  }catch(error){showResponse('Requisição inválida','bad','',error.message||'Revise os campos.');showToast('Revise a requisição',error.message||'Confira URL, rota, ambiente e campos.','error');}
}
async function requestTokenFromHelper(){
  const clientId=byId('token-client-id').value.trim(),secret=byId('token-client-secret').value;
  if(!clientId||!secret){showToast('Dados incompletos','Informe os valores dos dois campos de credencial.','error');return;}
  let request;
  try{
    if(!(await persistTokenRequestConfig(true)))return;
    const config=tokenRequestConfig,routeConfig=RunnerLogic.normalizeTokenRequestConfig({...config,route:applyEnvironment(config.route)});
    if(!routeConfig.route)throw Error('Configure a rota do endpoint de token.');
    const mode=config.credentialMode,baseUrl=applyEnvironment(byId('base-url').value.trim());
    request={baseUrl,route:routeConfig.route,method:'POST',...authFieldsFromForm(applyEnvironment,true),headers:'Accept: application/json',body:'',confirmTestData:false,testDataPhrase:'',confirmTokenRequest:true,tokenClientId:applyEnvironment(clientId),tokenClientSecret:applyEnvironment(secret),tokenClientIdField:config.clientIdField,tokenClientSecretField:config.clientSecretField,tokenCredentialMode:mode,allowInsecureHttp:byId('allow-insecure-http').checked,saveBearerToken:byId('save-token-history').checked};
    const target=new URL(request.baseUrl);
    if(!['http:','https:'].includes(target.protocol)||target.username||target.password||target.search||target.hash)throw Error('Informe URL base HTTP ou HTTPS sem credenciais, query ou fragmento.');
    const insecureOrigin=RunnerLogic.remoteHttpOrigin(request.baseUrl);
    if(insecureOrigin&&!request.allowInsecureHttp)throw Error('HTTP fora de localhost está bloqueado. Marque a opção de HTTP sem TLS nesta request para continuar.');
    const modeWarning=mode==='query'?'O segredo será enviado na query e pode aparecer nos logs da API.':'As credenciais serão enviadas como JSON.';
    const transportWarning=insecureOrigin?remoteHttpWarning(insecureOrigin):'';
    const destination=sanitizeBase(request.baseUrl).value.replace(/\/+$/,'')+sanitizeRoute(request.route).value;
    if(!(await confirmWithDialog({eyebrow:'CREDENCIAIS',title:'Solicitar token?',description:'POST '+request.route,detail:destination,warning:[modeWarning,transportWarning].filter(Boolean).join(' '),confirmLabel:'Solicitar token',danger:true}))){
      showToast('Envio cancelado','Nenhuma credencial foi enviada.','info');return;
    }
    let result;
    try{result=await performApiRequest(request,tokenRequestButton,false);}
    finally{
      const token=result?.status>=200&&result.status<300?extractToken(result.body??''):'';
      if(token){
        byId('bearer-token').value=token;byId('auth-type').value='bearer';updateAuthTypeUi();syncActiveWorkspaceTab(true);let savedEnvironment=null;
        if(byId('save-token-environment').checked){try{savedEnvironment=await saveEnvironmentVariable('token',token);}catch(error){showToast('Token não salvo no ambiente',error.message||'Não foi possível gravar {{token}} no SQLite local.','error');}}
        showToast('Token obtido',savedEnvironment?`Preenchido em Bearer e salvo como {{token}} no ambiente “${savedEnvironment.name}”.`:'Token preenchido em Bearer. Nada foi copiado para a área de transferência.','success');
      }
      else if(result?.status>=200&&result.status<300)showToast('Resposta recebida','Confira o corpo e preencha Token Bearer manualmente.','info');
      await saveHistory(tokenHistorySnapshot(request,token));byId('token-client-id').value='';byId('token-client-secret').value='';request.tokenClientId='';request.tokenClientSecret='';updateTokenButton();
    }
  }catch(error){showToast('Não foi possível solicitar token',error.message||'Confira ambiente e URL base.','error');byId('token-client-id').value='';byId('token-client-secret').value='';updateTokenButton();}
}
function addEventListeners(){
  const quickOpenDialog = byId('quick-open-dialog'), quickOpenQuery = byId('quick-open-query');
  byId('quick-open-button').onclick = openQuickOpen;quickOpenQuery.addEventListener('input', renderQuickOpenResults);quickOpenQuery.addEventListener('keydown', handleQuickOpenQueryKeydown);
  quickOpenDialog.addEventListener('click', event => { if (event.target === quickOpenDialog) quickOpenDialog.close(); });
  quickOpenDialog.addEventListener('close', () => { quickOpenQuery.value = '';quickOpenEntries = [];byId('quick-open-results').replaceChildren();quickOpenQuery.setAttribute('aria-expanded', 'false');quickOpenQuery.removeAttribute('aria-activedescendant'); });
  document.addEventListener('keydown', handleQuickOpenShortcut);
  const workspaceTabList = byId('workspace-tabs');
  byId('add-workspace-tab').onclick = createNewWorkspaceTab;
  workspaceTabList.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const tabs = [...workspaceTabList.querySelectorAll('[role="tab"]')], current = tabs.indexOf(event.target.closest('[role="tab"]'));
    if (current < 0 || !tabs.length) return;
    event.preventDefault();const direction = event.key === 'ArrowRight' ? 1 : -1;const next = tabs[(current + direction + tabs.length) % tabs.length];next.focus();void activateWorkspaceTab(next.dataset.workspaceTabId);
  });
  const editorColumn=document.querySelector('.editor-column'),trackDraft=event=>{if(['confirm-test-data','test-data-phrase','token-client-secret','token-route','token-client-id-field','token-client-secret-field','token-credential-mode'].includes(event.target.id))return;syncActiveWorkspaceTab(true);};
  editorColumn.addEventListener('input', trackDraft);editorColumn.addEventListener('change', trackDraft);
  document.querySelector('.editor-column').addEventListener('click', event => { if (event.target.closest('.query-param-row .button, .response-test-remove')) syncActiveWorkspaceTab(true); });  byId('clear-history').onclick=clearHistory;byId('copy-headers').onclick=()=>copyOutput('response-headers','Cabeçalhos');byId('copy-body').onclick=()=>copyOutput('response-body','Body');document.querySelectorAll('[data-response-view]').forEach(button=>button.onclick=()=>setResponseView(button.dataset.responseView));byId('response-search').addEventListener('input',renderResponseBody);byId('response-tree').addEventListener('click',event=>{const button=event.target.closest('[data-copy-json-path]');if(button)copyResponsePath(button.dataset.copyJsonPath);});
  byId('run-collection').onclick=openRunnerDialog;byId('runner-form').addEventListener('submit',startRunnerFromForm);byId('close-runner').onclick=()=>runnerBusy?requestRunnerStop():byId('runner-dialog').close();byId('cancel-runner').onclick=()=>runnerBusy?requestRunnerStop():byId('runner-dialog').close();byId('stop-runner').onclick=requestRunnerStop;byId('rerun-failed').onclick=rerunRunnerFailures;byId('runner-dialog').addEventListener('cancel',event=>{if(runnerBusy){event.preventDefault();requestRunnerStop();}});
  window.addEventListener('resize',()=>{if(byId('runner-dialog').open)fitRunnerDialog();});
  byId('run-collection').onclick=openRunnerDialog;byId('runner-form').addEventListener('submit',startRunnerFromForm);byId('close-runner').onclick=()=>runnerBusy?requestRunnerStop():byId('runner-dialog').close();byId('cancel-runner').onclick=()=>runnerBusy?requestRunnerStop():byId('runner-dialog').close();byId('stop-runner').onclick=requestRunnerStop;byId('rerun-failed').onclick=rerunRunnerFailures;byId('runner-dialog').addEventListener('cancel',event=>{if(runnerBusy){event.preventDefault();requestRunnerStop();}});
  byId('add-query-param').onclick=()=>{addQueryParamRow();syncActiveWorkspaceTab(true);};byId('add-response-test').onclick=()=>{addResponseTest();syncActiveWorkspaceTab(true);};
  byId('response-tests-list').addEventListener('input',()=>renderResponseTestResults([]));byId('response-tests-list').addEventListener('change',()=>renderResponseTestResults([]));
  byId('add-collection').onclick=addCollection;byId('add-collection-heading').onclick=addCollection;byId('import-collection').onclick=openImportDialog;byId('browse-import-file').onclick=()=>{byId('import-dialog').close();byId('import-collection-file').click();};byId('close-import-dialog').onclick=()=>byId('import-dialog').close();byId('cancel-import-dialog').onclick=()=>byId('import-dialog').close();byId('create-curl-request').onclick=openCurlRequestDraft;byId('import-collection-file').addEventListener('change',importCollectionFile);byId('export-collection').onclick=openExportDialog;byId('export-form').addEventListener('submit',exportCollection);byId('close-export-dialog').onclick=()=>byId('export-dialog').close();byId('cancel-export-dialog').onclick=()=>byId('export-dialog').close();byId('save-collection-request').onclick=openSaveDialog;byId('save-request-form').addEventListener('submit',saveCollectionRequest);byId('close-save-request').onclick=()=>byId('save-request-dialog').close();byId('cancel-save-request').onclick=()=>byId('save-request-dialog').close();
  byId('export-workspace').onclick=exportWorkspaceBackup;byId('export-encrypted-workspace').onclick=exportEncryptedWorkspaceBackup;byId('restore-workspace').onclick=()=>byId('restore-workspace-file').click();byId('restore-workspace-file').addEventListener('change',restoreWorkspaceBackup);
  byId('protect-existing-secrets').onclick=protectExistingSecrets;
  byId('environment-form').addEventListener('submit',saveEnvironmentDraft);byId('close-environment').onclick=()=>{environmentDraft=[];byId('environment-dialog').close();};byId('cancel-environment').onclick=()=>{environmentDraft=[];byId('environment-dialog').close();};byId('manage-environments').onclick=openSettingsDialog;byId('settings-environments').onclick=()=>{byId('settings-dialog').close();openEnvironmentDialog();};byId('close-settings').onclick=()=>byId('settings-dialog').close();byId('close-settings-done').onclick=()=>byId('settings-dialog').close();byId('add-environment').onclick=addEnvironmentDraft;
  byId('environment-select').onchange=event=>chooseEnvironment(event.target.value);byId('theme-select').onchange=event=>saveTheme(event.target.value);
  byId('font-select').onchange=event=>saveFont(event.target.value);byId('decrease-font').onclick=()=>setUiScale(activeScale-0.05);byId('increase-font').onclick=()=>setUiScale(activeScale+0.05);document.addEventListener('keydown',handleScaleShortcut);
  byId('environment-list').addEventListener('click',async event=>{
    const remove=event.target.closest('[data-remove-environment]');if(remove){const card=remove.closest('.environment-card');if(environmentDraft.length<=1){showToast('Mantenha um ambiente','O último ambiente não pode ser removido.','warning');return;}const environmentName=card.querySelector('.environment-name').value;if(await confirmWithDialog({eyebrow:'AMBIENTES',title:'Remover ambiente?',description:'O ambiente “'+environmentName+'” será removido do rascunho.',confirmLabel:'Remover ambiente',danger:true}))card.remove();return;}
    if(event.target.closest('[data-add-variable]')){const vars=event.target.closest('.environment-card').querySelector('.environment-vars');vars.append(makeVarRow());vars.lastElementChild.querySelector('.environment-var-name').focus();}
  });
  document.querySelectorAll('[data-editor-tab]').forEach(button=>button.onclick=()=>setEditorTab(button.dataset.editorTab));byId('format-json').onclick=()=>formatBodyJson(false);byId('minify-json').onclick=()=>formatBodyJson(true);body.addEventListener('keydown',handleJsonKeydown);
  for(const id of ['response-variable-name','response-json-path','response-value-source','response-success-only','capture-response-variable']){byId(id).addEventListener('input',updateResponseCaptureUi);byId(id).addEventListener('change',updateResponseCaptureUi);}
  byId('insert-token-script').onclick=async()=>{const isDefault=byId('response-variable-name').value.trim()==='token'&&byId('response-json-path').value.trim()==='access_token';if(!isDefault&&!(await confirmWithDialog({eyebrow:'EXEMPLO DE TOKEN',title:'Usar o exemplo de token?',description:'Os campos do extrator serão preenchidos com token e access_token.',confirmLabel:'Usar exemplo'})))return;byId('capture-response-variable').checked=true;byId('response-value-source').value='json';byId('response-variable-name').value='token';byId('response-json-path').value='access_token';byId('response-success-only').checked=true;updateResponseCaptureUi();showToast('Exemplo pronto','Confira o caminho access_token na resposta antes de enviar.','info');};
  byId('copy-insomnia-script').onclick=async()=>{try{await navigator.clipboard.writeText(byId('insomnia-script-preview').textContent);showToast('Exemplo copiado','Script pronto para Scripts → After-response no Insomnia.','success');}catch{showToast('Falha ao copiar','O navegador bloqueou a área de transferência.','error');}};
  byId('clear-token').onclick=()=>{byId('bearer-token').value='';byId('bearer-token').focus();showToast('Token removido','O campo Bearer foi limpo desta sessão.','info');};
  byId('new-request').onclick=createNewWorkspaceTab;
  for(const id of ['method','route','body','base-url','headers','allow-insecure-http','confirm-test-data','test-data-phrase']){
    const change=()=>{if(['method','route','body','base-url','headers'].includes(id))byId('confirm-test-data').checked=false;if(id==='base-url')baseUrlAuto=false;updateGuard();updateTokenButton();if(id==='body'){renderBodyHighlight();updateJsonTools();}};byId(id).addEventListener('input',change);byId(id).addEventListener('change',change);
  }
  body.addEventListener('scroll',renderBodyHighlight);byId('token-client-id').addEventListener('input',updateTokenButton);byId('token-client-secret').addEventListener('input',updateTokenButton);
  byId('auth-type').addEventListener('change',updateAuthTypeUi);byId('api-key-location').addEventListener('change',updateAuthTypeUi);
  for(const id of ['token-route','token-client-id-field','token-client-secret-field','token-credential-mode']){byId(id).addEventListener('input',updateTokenButton);byId(id).addEventListener('change',()=>void persistTokenRequestConfig());}
  sendButton.onclick=sendCurrentRequest;tokenRequestButton.onclick=requestTokenFromHelper;
}
async function startApp(){
  addEventListeners();renderQueryParams([]);updateAuthTypeUi();renderBodyHighlight();
  try{await initializeDb();await loadTokenRequestConfig();applyTheme(activeTheme);applyTypography();applyUiScale();renderCollectionTree();renderEnvironmentSelect();if(!byId('base-url').value)byId('base-url').value=Object.hasOwn(getEnvironment().variables||{},'baseUrl')?'{{baseUrl}}':'';await renderHistory();await initializeWorkspaceTabs();updateGuard();updateCopyButtons();updateTokenButton();updateJsonTools();updateResponseCaptureUi();byId('sidebar-storage-note').textContent='SQLite local · proteção de dados';}
  catch(error){showToast('Banco local indisponível',error.message||'Confira o acesso ao SQLite e tente recarregar.','error',0);updateGuard();updateCopyButtons();updateTokenButton();}
}
startApp();
