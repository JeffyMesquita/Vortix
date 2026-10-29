(() => {
const byId = id => document.getElementById(id);
const method = byId('method'), route = byId('route'), body = byId('body');
const sendButton = byId('send-request'), writeGuard = byId('write-guard'), queryParams = byId('query-params');
const tokenRequestButton = byId('request-token'), oauth2TokenButton = byId('oauth2-request-token'), oauthPkceStartButton = byId('oauth-pkce-start'), toastRegion = byId('toast-region');
const DB_NAME = 'ApiPublicacaoTester', DB_VERSION = 2, LEGACY_HISTORY_KEY = 'apiTester.savedRequests.v1';
const STORAGE_MIGRATION_KEY = 'apiStudio.sqliteMigration.v1';
const TOKEN_REQUEST_CONFIG_KEY = 'tokenRequestConfig';
const OAUTH2_TOKEN_CONFIG_KEY = 'oauth2ClientCredentials', OAUTH2_TOKEN_META_KEY = 'oauth2TokenMetadata', OAUTH_PKCE_CONFIG_KEY = 'oauthAuthorizationCodePkce';
const LOCAL_SECRET_VAULT_PREFIX = 'localSecretVault:';
const DB_STORES = ['history','collections','environments','settings'];
const writeMethods = new Set(['POST','PUT','PATCH','DELETE']), toastTimers = new Map();
const RunnerLogic = window.ApiStudioRunner;
const parseJsonPath = RunnerLogic.parseJsonPath, jsonPathValue = RunnerLogic.jsonPathValue;
const themes = new Set(['dracula','monokai','one-dark','nord','solarized-dark','github-dark','paper','graphite','tide','aurora','areia']);
const fontFamilies = new Map([
  ['fira-code','"Fira Code", "Cascadia Code", "IBM Plex Mono", monospace'],
  ['jetbrains-mono','"JetBrains Mono", "Cascadia Code", "IBM Plex Mono", monospace'],
  ['cascadia-code','"Cascadia Code", "Cascadia Mono", "IBM Plex Mono", monospace'],
  ['cascadia-mono','"Cascadia Mono", "IBM Plex Mono", monospace'],
  ['ibm-plex-mono','"IBM Plex Mono", "Fira Code", monospace']
]);
const DEFAULT_FONT = 'fira-code', DEFAULT_UI_SCALE = 1.2, MIN_UI_SCALE = 0.8, MAX_UI_SCALE = 1.5;
let legacyDbPromise, toastId = 0, queryId = 0, collections = [], environments = [], environmentDraft = [], activeEnvironmentId = '', activeTheme = 'dracula', activeFont = DEFAULT_FONT, activeScale = DEFAULT_UI_SCALE, actionDialogQueue = Promise.resolve(), tokenModeRecoveryWarned = false;
let activeSaved = null, selectedContainer = { collectionId:'', folderId:'' }, collapsed = new Set(), baseUrlAuto = true;
let runnerEntries = [], runnerFailedCases = [], runnerBusy = false, runnerStopRequested = false;
let runnerHistoryLoadTask = Promise.resolve(), runnerHistoryMutating = false;
let quickOpenEntries = [], quickOpenActiveIndex = 0;
let historySettings = RunnerLogic.normalizeHistorySettings(), historyComparisonIds = [];
const WORKSPACE_TABS_KEY = 'workspaceTabs', MAX_WORKSPACE_TABS = RunnerLogic.maxWorkspaceTabs;
const RUNNER_HISTORY_LIMIT = RunnerLogic.runnerHistoryLimit || 30;
let workspaceTabs = [], activeWorkspaceTabId = '', workspaceTabsSaveTimer = 0, workspaceTabsStorageWarning = false, workspaceTabsLoading = false;
let responseBodyState = RunnerLogic.parseResponseBody(''), responseBodyView = 'pretty', responseTreeSource = null;
let currentResponseExample = null, activeResponseContract = null;
let graphqlSchema = null, graphqlSchemaEndpointKey = '', graphqlSchemaLoading = false, graphqlAutocompleteSuggestions = [], graphqlAutocompleteIndex = 0;
let tokenRequestConfig = RunnerLogic.normalizeTokenRequestConfig(), oauth2TokenConfig = RunnerLogic.normalizeOAuthClientCredentialsConfig();
let oauthPkceConfig = RunnerLogic.normalizeOAuthPkceConfig(), oauthPkceBusy = false, oauthPkceCancelRequested = false, oauthPkcePopup = null, oauthPkcePreviewTimer = 0;
let hostedMode = false;
let requestSendInProgress = false;
let structuredExecutionHandle = null, structuredDiagnosticContextRevision = 0, structuredDiagnosticContextInvalidated = false;
let secretVault = null, secretVaultValues = null, secretVaultEnvelope = null, secretVaultNames = [], secretVaultBusy = false, secretVaultEnvironmentId = '', secretVaultUnavailable = null, secretVaultLoading = false;
let lastResolutionProvenance = {};

function invalidateStructuredDiagnosticContext(semanticChange=true){
  if(semanticChange&&!structuredDiagnosticContextInvalidated){structuredDiagnosticContextRevision=Math.min(Number.MAX_SAFE_INTEGER,structuredDiagnosticContextRevision+1);structuredDiagnosticContextInvalidated=true;}
  structuredExecutionHandle?.invalidateDiagnosticContext();
}
function invalidateStructuredDiagnosticForDraft(event){
  const target=event.target;
  if(target?.closest?.('#request-workspace-panel')&&!target.closest('#structured-card'))invalidateStructuredDiagnosticContext();
}

function openLegacyDb() {
  if (legacyDbPromise) return legacyDbPromise;
  legacyDbPromise = new Promise((resolve,reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of ['history','collections','environments','settings'])
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name,{keyPath:name === 'settings' ? 'key' : 'id'});
      if (!db.objectStoreNames.contains('hostedSnapshots')) db.createObjectStore('hostedSnapshots',{keyPath:'id'});
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
  if(hostedMode)return;
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
async function browserDbWrite(store,value,remove=false) {
  const db=await openLegacyDb();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction(store,'readwrite'),objectStore=transaction.objectStore(store);
    let removed=0;
    if(remove==='clear')objectStore.clear();
    else if(remove)objectStore.delete(value);
    else{
      objectStore.put(value);
      if(store==='history'){
        const request=objectStore.getAll();
        request.onsuccess=()=>{
          const entries=request.result.sort((a,b)=>(Date.parse(b.savedAt||'')||0)-(Date.parse(a.savedAt||'')||0));
          for(const entry of entries.slice(historySettings.limit)){objectStore.delete(entry.id);removed++;}
        };
      }
    }
    transaction.oncomplete=()=>resolve(store==='history'&&!remove?{removed}:null);
    transaction.onerror=()=>reject(transaction.error||Error('Falha ao gravar no banco local.'));
    transaction.onabort=()=>reject(transaction.error||Error('A gravação no banco local foi cancelada.'));
  });
}
async function dbRead(store,key) {
  if(hostedMode&&store==='settings'&&typeof key==='string'&&key.startsWith('cookiejar:')){
    const environmentId=key.slice('cookiejar:'.length),response=await fetch(`/api/cookie-jar/${encodeURIComponent(environmentId)}`,{headers:{'X-Api-Studio':'1'},cache:'no-store'});
    if(!response.ok)throw Error('Falha ao ler os cookies deste navegador.');
    return response.json();
  }
  if(hostedMode){
    const db=await openLegacyDb();
    return new Promise((resolve,reject)=>{
      const request=key===undefined?db.transaction(store,'readonly').objectStore(store).getAll():db.transaction(store,'readonly').objectStore(store).get(key);
      request.onsuccess=()=>resolve(key===undefined?(request.result||[]):(request.result||null));
      request.onerror=()=>reject(request.error||Error('Falha ao ler o banco deste navegador.'));
    });
  }
  const url=`/api/storage/${encodeURIComponent(store)}${key===undefined?'':'?key='+encodeURIComponent(key)}`;
  const response=await fetch(url,{headers:{'X-Api-Studio':'1'},cache:'no-store'});
  if(!response.ok)throw Error('Falha ao ler o banco local.');
  if(response.headers.get('X-Api-Studio-Data-Recovery')==='tokenCredentialMode'&&!tokenModeRecoveryWarned){tokenModeRecoveryWarned=true;showToast('Preferência de credenciais recuperada','A preferência antiga de envio de credenciais não pôde ser descriptografada. Foi usado o modo seguro body; salve a request para gravar esse ajuste novamente.','warning',10000);}
  return response.json();
}
async function dbWrite(store,value,remove=false) {
  if(hostedMode&&store==='settings'){
    const key=typeof value==='string'?value:value?.key;
    if(typeof key==='string'&&key.startsWith('cookiejar:')){
      const environmentId=key.slice('cookiejar:'.length),response=await fetch(`/api/cookie-jar/${encodeURIComponent(environmentId)}`,{method:remove?'DELETE':'PUT',headers:{'Content-Type':'application/json','X-Api-Studio':'1'},cache:'no-store',body:remove?undefined:JSON.stringify(value.value)});
      if(!response.ok)throw Error('Falha ao atualizar os cookies deste navegador.');
      return null;
    }
  }
  if(hostedMode)return browserDbWrite(store,value,remove);
  const url=remove==='clear'?`/api/storage/${encodeURIComponent(store)}`:remove?`/api/storage/${encodeURIComponent(store)}?key=${encodeURIComponent(value)}`:`/api/storage/${encodeURIComponent(store)}${store==='history'?`?retentionLimit=${historySettings.limit}`:''}`;
  const response=await fetch(url,{method:remove?'DELETE':'POST',headers:{'Content-Type':'application/json','X-Api-Studio':'1'},cache:'no-store',body:remove?undefined:JSON.stringify(value)});
  if(!response.ok){const error=await response.json().catch(()=>null);throw Error(error?.error||'Falha ao gravar no banco local.');}
  const result=response.status===204?null:await response.json().catch(()=>null);
  return result;
}
async function readWorkspace(){
  if(!hostedMode){
    const response=await fetch('/api/storage/workspace',{headers:{'X-Api-Studio':'1'},cache:'no-store'});
    if(!response.ok)throw Error('Não foi possível ler o workspace local.');
    return response.json();
  }
  const workspace=Object.fromEntries(await Promise.all(DB_STORES.map(async store=>[store,await dbRead(store)])));
  const jars=await ApiStudioRunner.readHostedCookieJars(fetch);
  workspace.settings.push(...jars.filter(jar=>jar.value.cookies.length).map(jar=>({key:'cookiejar:'+jar.environmentId,value:jar.value})));
  return workspace;
}
async function replaceWorkspace(backup){
  if(!hostedMode){
    const response=await fetch('/api/storage/workspace/restore',{method:'POST',headers:{'Content-Type':'application/json','X-Api-Studio':'1'},cache:'no-store',body:JSON.stringify(backup)});
    const result=await response.json().catch(()=>null);
    if(!response.ok)throw Error(result?.error||'Não foi possível restaurar o backup local.');
    return result;
  }
  const db=await openLegacyDb();
  const cookieRecords=(backup.settings||[]).filter(record=>String(record?.key||'').startsWith('cookiejar:'));
  const previousJars=await ApiStudioRunner.readHostedCookieJars(fetch);
  await ApiStudioRunner.replaceHostedCookieJars(cookieRecords,fetch);
  try{
    await new Promise((resolve,reject)=>{
      const transaction=db.transaction(DB_STORES,'readwrite');
      for(const store of DB_STORES){const objectStore=transaction.objectStore(store);objectStore.clear();for(const record of backup[store]||[])if(store!=='settings'||!String(record?.key||'').startsWith('cookiejar:'))objectStore.put(record);}
      transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error||Error('Falha ao restaurar o banco deste navegador.'));transaction.onabort=()=>reject(transaction.error||Error('A restauração do banco deste navegador foi cancelada.'));
    });
  }catch(error){
    try{await ApiStudioRunner.replaceHostedCookieJars(previousJars.map(jar=>({key:'cookiejar:'+jar.environmentId,value:jar.value})),fetch);}
    catch{throw Error('A restauração do workspace falhou e os cookies não puderam ser revertidos. Tente restaurar novamente.');}
    throw error;
  }
  return {restored:true};
}
async function initializeHostingMode() {
  const runtimeResponse=await fetch('/api/runtime',{cache:'no-store'});
  if(!runtimeResponse.ok)throw Error('Não foi possível identificar o modo de hospedagem.');
  const runtime=await runtimeResponse.json();hostedMode=runtime.hostingMode==='render';
  if(!hostedMode)return;
  const response=await fetch('/api/session',{headers:{'X-Api-Studio':'1'},cache:'no-store'});
  if(!response.ok)throw Error('Não foi possível iniciar uma sessão isolada neste navegador.');
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
  const savedHistoryPreferences = await dbRead('settings','historyPreferences');
  historySettings = RunnerLogic.normalizeHistorySettings(savedHistoryPreferences?.value);
  syncHistorySettingsControls();
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
  return RunnerLogic.isSensitiveVariableName(name);
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
function authModeFromForm(){const value=byId('auth-inheritance-mode')?.value;return['inherit','none','custom'].includes(value)?value:'custom';}
function resolveFormAuth(){
  const authMode=authModeFromForm();
  return authMode==='custom'?{...authFieldsFromForm(value=>value,true),authMode,authSource:null}:RunnerLogic.resolveInheritedAuth({authMode},authMode==='inherit'?authScopesForContainer(selectedContainer.collectionId,selectedContainer.folderId):[]);
}
function applyAuthFields(request={}){
  const authMode=['inherit','none','custom'].includes(request.authMode)?request.authMode:'custom';byId('auth-inheritance-mode').value=authMode;
  const effective=authMode==='custom'?request:RunnerLogic.resolveInheritedAuth({authMode},authMode==='inherit'?authScopesForContainer(selectedContainer.collectionId,selectedContainer.folderId):[]);
  const type=normalizeAuthType(effective.authType,effective.bearerToken);byId('auth-type').value=type;
  byId('bearer-token').value=type==='bearer'?sanitizeBearer(effective.bearerToken):'';
  byId('basic-username').value=type==='basic'?String(effective.basicUsername||''):'';
  byId('basic-password').value=type==='basic'?String(effective.basicPassword||''):'';
  byId('api-key-name').value=type==='apiKey'?String(effective.apiKeyName||''):'';
  byId('api-key-location').value=type==='apiKey'&&effective.apiKeyLocation==='query'?'query':'header';
  byId('api-key-value').value=type==='apiKey'?String(effective.apiKeyValue||''):'';
  updateAuthTypeUi();
}
function updateAuthTypeUi(){
  const mode=authModeFromForm(),effective=resolveFormAuth(),type=normalizeAuthType(effective.authType,effective.bearerToken),editable=mode==='custom';byId('auth-type').value=type;
  byId('auth-bearer-fields').hidden=type!=='bearer';byId('auth-basic-fields').hidden=type!=='basic';byId('auth-api-key-fields').hidden=type!=='apiKey';
  for(const id of ['auth-type','bearer-token','clear-token','basic-username','basic-password','api-key-name','api-key-value','api-key-location'])byId(id).disabled=!editable;
  byId('api-key-query-warning').hidden=type!=='apiKey'||byId('api-key-location').value!=='query';
  byId('auth-type-badge').textContent=type==='apiKey'?'API Key':type==='basic'?'Basic':type==='none'?'Sem auth':'Bearer';
  const source=byId('auth-inheritance-source');source.dataset.mode=mode;
  source.textContent=mode==='inherit'?(effective.authSource?'Herdada de '+effective.authSource.name+'.':'Nenhum padrão de Auth configurado na coleção ou pasta.')
    :mode==='none'?'Autenticação desativada nesta request; a herança será ignorada.':'Auth configurada somente nesta request.';
  const collection=findCollection(selectedContainer.collectionId),target=selectedContainer.folderId?findFolder(collection,selectedContainer.folderId):collection,button=byId('save-auth-default');
  button.disabled=!target;button.title=target?'Salvar Auth em '+target.name:'Selecione uma coleção ou pasta para salvar o padrão.';
}
function hasAuthCredentials(request){return!!(request?.bearerToken||request?.basicUsername||request?.basicPassword||request?.apiKeyValue);}
function authTypeLabel(request){const type=normalizeAuthType(request?.authType,request?.bearerToken);return type==='apiKey'?'API Key':type==='basic'?'Basic Auth':type==='bearer'?'Bearer':'sem autenticação';}
function normalizeBodyMode(value){const mode=String(value||'json').trim().toLowerCase();return['json','text','xml','urlencoded','multipart','graphql'].includes(mode)?mode:'json';}
function bodyModeContentType(value){return({json:'application/json',text:'text/plain',xml:'application/xml',urlencoded:'application/x-www-form-urlencoded',multipart:'multipart/form-data',graphql:'application/json'})[normalizeBodyMode(value)];}
function bodyModeFromContentType(value){const type=String(value||'').split(';')[0].trim().toLowerCase();if(type==='application/x-www-form-urlencoded')return'urlencoded';if(type==='multipart/form-data')return'multipart';if(type==='application/graphql')return'graphql';if(type.includes('xml'))return'xml';if(type.startsWith('text/'))return'text';return'json';}
function bodyModeFromHeaderEntries(headers){const entries=Array.isArray(headers)?headers:[];const header=entries.find(([name])=>String(name).toLowerCase()==='content-type');return bodyModeFromContentType(header?.[1]);}
function inferImportedBodyMode(requestBody,headers){
  if(requestBody?.mode==='graphql'||requestBody?.graphql||requestBody?.mimeType==='application/graphql')return'graphql';
  if(requestBody?.mode==='formdata'||requestBody?.mimeType==='multipart/form-data'||Array.isArray(requestBody?.params))return'multipart';
  if(requestBody?.mode==='urlencoded'||requestBody?.urlencoded||requestBody?.mimeType==='application/x-www-form-urlencoded')return'urlencoded';
  const language=String(requestBody?.options?.raw?.language||'').toLowerCase();if(language==='xml')return'xml';if(language==='text')return'text';if(language==='json')return'json';
  const contentType=requestBody?.mimeType||String(headers.find(line=>/^content-type\s*:/i.test(line))||'').split(':').slice(1).join(':').trim();
  return bodyModeFromContentType(contentType);
}
function applyBodyMode(value){byId('body-mode').value=normalizeBodyMode(value);updateBodyModeUi();}
function updateBodyModeUi(){
  const mode=normalizeBodyMode(byId('body-mode').value),json=mode==='json',multipart=mode==='multipart',graphql=mode==='graphql';byId('body-mode').value=mode;
  byId('body-mode-badge').textContent=({json:'JSON',text:'TEXT',xml:'XML',urlencoded:'FORM URL-ENCODED',multipart:'MULTIPART',graphql:'GRAPHQL'})[mode];
  byId('body-mode-hint').textContent=graphql?'Query e variables serão enviados como JSON via POST.':multipart?'Content-Type e boundary são automáticos; remova qualquer Content-Type manual.':'Content-Type padrão: '+bodyModeContentType(mode)+'; pode ser sobrescrito em Headers.';
  byId('body-highlight').hidden=!json;body.classList.toggle('plain-body-input',!json);
  byId('raw-body-editor').hidden=multipart||graphql;byId('multipart-editor').hidden=!multipart;byId('graphql-editor').hidden=!graphql;
  body.placeholder=({json:'{\n  "exemplo": true\n}',text:'Texto da requisição',xml:'<request>conteúdo</request>',urlencoded:'chave=valor&outra=valor'})[mode];
  updateJsonTools();renderBodyHighlight();
}
function normalizePersistableMultipartFields(fields,redactSensitive=true){
  let redacted=false;
  const safe=RunnerLogic.normalizeMultipartFields(fields).map(field=>{
    if(field.type!=='text')return field;
    const template=/^\{\{\s*[^{}]+\s*\}\}$/.test(field.value.trim());
    if(redactSensitive&&isSensitiveName(field.name)&&!template){redacted=true;return{...field,value:''};}
    const value=scrubCredentialText(field.value);redacted||=value!==field.value;return{...field,value};
  });
  return{fields:safe,redacted};
}
function readMultipartFieldEntries(resolveValue=value=>value){
  return[...byId('multipart-fields-list').children].map(row=>{
    const name=row.querySelector('[data-multipart-name]').value.trim(),type=row.querySelector('[data-multipart-type]').value,fileInput=row.querySelector('[data-multipart-file]'),file=fileInput.files?.[0]||null,savedFileName=row.dataset.savedFileName||'';
    const rawValue=row.querySelector('[data-multipart-value]').value;
    if(!name&&!rawValue&&!file&&!savedFileName)return null;
    if(!name)throw Error('Informe o nome de cada campo multipart.');
    return{row,file,field:{name,type,value:type==='text'?resolveValue(rawValue):'',fileName:type==='file'?(file?.name||savedFileName):'',contentType:type==='file'?(file?.type||row.dataset.savedContentType||''):''}};
  }).filter(Boolean);
}
function getPersistableMultipartFields(redactSensitive=true){return normalizePersistableMultipartFields(readMultipartFieldEntries().map(entry=>entry.field),redactSensitive);}
function createMultipartFieldRow(source={}){
  const row=document.createElement('div');row.className='multipart-field-row';row.dataset.savedFileName=String(source.fileName||'');row.dataset.savedContentType=String(source.contentType||'');
  const name=document.createElement('input');name.type='text';name.autocomplete='off';name.value=String(source.name||'');name.dataset.multipartName='';name.setAttribute('aria-label','Nome do campo multipart');
  const type=document.createElement('select');type.dataset.multipartType='';type.setAttribute('aria-label','Tipo do campo multipart');type.add(new Option('Texto','text'));type.add(new Option('Arquivo','file'));type.value=source.type==='file'?'file':'text';
  const valueBox=document.createElement('div');valueBox.className='multipart-field-value';
  const value=document.createElement('input');value.type=isSensitiveName(name.value)?'password':'text';value.autocomplete='off';value.value=String(source.value||'');value.dataset.multipartValue='';value.setAttribute('aria-label','Valor do campo multipart');
  const file=document.createElement('input');file.type='file';file.hidden=true;file.dataset.multipartFile='';file.setAttribute('aria-label','Arquivo multipart');
  const fileName=document.createElement('span');fileName.className='multipart-field-file-name';fileName.hidden=true;
  valueBox.append(value,file,fileName);
  const remove=document.createElement('button');remove.type='button';remove.className='button secondary';remove.textContent='×';remove.setAttribute('aria-label','Remover campo multipart');
  const update=()=>{const isFile=type.value==='file';value.hidden=isFile;file.hidden=!isFile;fileName.hidden=!isFile;const selected=file.files?.[0];fileName.textContent=selected?selected.name:(row.dataset.savedFileName?row.dataset.savedFileName+' · selecione novamente':'Escolha um arquivo');const secret=isSensitiveName(name.value.trim());value.type=secret?'password':'text';value.autocomplete=secret?'new-password':'off';};
  type.onchange=()=>{row.dataset.savedFileName='';update();byId('confirm-test-data').checked=false;updateGuard();};
  name.oninput=()=>{update();byId('confirm-test-data').checked=false;updateGuard();};
  value.oninput=()=>{byId('confirm-test-data').checked=false;updateGuard();};
  file.onchange=()=>{row.dataset.savedFileName=file.files?.[0]?.name||'';row.dataset.savedContentType=file.files?.[0]?.type||'';update();byId('confirm-test-data').checked=false;updateGuard();};
  remove.onclick=()=>{row.remove();byId('confirm-test-data').checked=false;updateGuard();};
  row.append(name,type,valueBox,remove);update();return row;
}
function renderMultipartFields(fields){
  const list=byId('multipart-fields-list');list.replaceChildren();
  for(const field of RunnerLogic.normalizeMultipartFields(fields))list.append(createMultipartFieldRow(field));
}
function addMultipartField(type='text'){
  const row=createMultipartFieldRow({type});byId('multipart-fields-list').append(row);row.querySelector('[data-multipart-name]').focus();syncActiveWorkspaceTab(true);
}
function encodeArrayBufferBase64(buffer){
  const bytes=new Uint8Array(buffer);let binary='';
  for(let index=0;index<bytes.length;index+=32768)binary+=String.fromCharCode(...bytes.subarray(index,index+32768));
  return btoa(binary);
}
async function multipartFieldsForSend(resolveValue=value=>value){
  const entries=readMultipartFieldEntries(resolveValue),fields=RunnerLogic.normalizeMultipartFields(entries.map(entry=>entry.field));let totalBytes=0;
  for(let index=0;index<fields.length;index++){
    const field=fields[index];if(field.type!=='file')continue;const file=entries[index].file;
    if(!file)throw Error('Selecione novamente o arquivo "'+(field.fileName||field.name)+'" antes de enviar.');
    totalBytes+=file.size;if(file.size>10*1024*1024||totalBytes>10*1024*1024)throw Error('Arquivos multipart ultrapassam o limite total de 10 MB.');
    field.fileName=file.name;field.contentType=file.type||'application/octet-stream';field.fileBase64=encodeArrayBufferBase64(await file.arrayBuffer());
  }
  return fields;
}

function getGraphqlFieldsFromForm(){
  return{graphqlQuery:byId('graphql-query').value,graphqlVariables:byId('graphql-variables').value,graphqlOperationName:byId('graphql-operation-name').value.trim()};
}
function normalizePersistableGraphqlFields(fields){
  const query=scrubCredentialText(String(fields?.graphqlQuery||'')),variables=sanitizeBody(String(fields?.graphqlVariables||'')),operationName=scrubCredentialText(String(fields?.graphqlOperationName||''));
  return{graphqlQuery:query,graphqlVariables:variables.value,graphqlOperationName:operationName,redacted:variables.redacted||query!==String(fields?.graphqlQuery||'')||operationName!==String(fields?.graphqlOperationName||'')};
}
function clearGraphqlSchema(message='Confirme antes de carregar; schema fica apenas nesta sessão.'){
  graphqlSchema=null;graphqlSchemaEndpointKey='';graphqlAutocompleteSuggestions=[];graphqlAutocompleteIndex=0;
  const type=byId('graphql-schema-type'),browser=byId('graphql-schema-browser'),fields=byId('graphql-schema-fields'),autocomplete=byId('graphql-autocomplete'),status=byId('graphql-schema-status');
  if(type){type.replaceChildren();const option=document.createElement('option');option.value='';option.textContent='Schema não carregado';type.append(option);type.disabled=true;}
  if(browser)browser.hidden=true;if(fields)fields.replaceChildren();if(autocomplete){autocomplete.replaceChildren();autocomplete.hidden=true;}
  if(status){status.textContent=message;status.dataset.state='idle';}
  updateGraphqlSchemaControls();
}
function updateGraphqlSchemaControls(){
  const button=byId('graphql-load-schema'),type=byId('graphql-schema-type');
  if(button){button.disabled=graphqlSchemaLoading;button.textContent=graphqlSchemaLoading?'Consultando schema…':graphqlSchema?'Atualizar schema':'Carregar schema';}
  if(type)type.disabled=!graphqlSchema||graphqlSchemaLoading;
}
function renderGraphqlSchemaFields(){
  const typeSelect=byId('graphql-schema-type'),details=byId('graphql-schema-browser'),list=byId('graphql-schema-fields');
  list.replaceChildren();
  if(!graphqlSchema||graphqlSchemaEndpointKey!==graphqlSchemaEndpointKeyFromForm()){clearGraphqlSchema('Endpoint, ambiente ou Auth mudou; carregue o schema novamente.');return;}
  const type=graphqlSchema.types.find(item=>item.name===typeSelect.value);
  if(!type){details.hidden=true;return;}
  details.hidden=false;byId('graphql-schema-fields-type').textContent=type.name;
  for(const field of type.fields){
    const button=document.createElement('button');button.type='button';button.className='graphql-schema-field';button.dataset.graphqlField=field.name;button.title=field.description||('Inserir '+field.name);
    const name=document.createElement('span');name.className='graphql-schema-field-name';name.textContent=field.name;
    const returnType=document.createElement('span');returnType.className='graphql-schema-field-type';returnType.textContent=field.returnType;
    button.append(name,returnType);button.addEventListener('click',()=>insertGraphqlField(field.name));list.append(button);
  }
  renderGraphqlAutocomplete();
}
function renderGraphqlSchema(schema,endpointKey){
  graphqlSchema=schema;graphqlSchemaEndpointKey=endpointKey;
  const select=byId('graphql-schema-type'),types=schema.types.filter(type=>['OBJECT','INTERFACE','INPUT_OBJECT'].includes(type.kind)&&type.fields.length);
  types.sort((left,right)=>left.name===schema.queryType?-1:right.name===schema.queryType?1:left.name.localeCompare(right.name));
  select.replaceChildren();for(const type of types){const option=document.createElement('option');option.value=type.name;option.textContent=`${type.name} · ${type.kind}`;select.append(option);}
  select.value=schema.queryType;select.disabled=false;byId('graphql-schema-browser').hidden=false;
  const status=byId('graphql-schema-status');status.dataset.state='success';status.textContent=`Schema carregado em memória: ${types.length} tipos. Escolha o tipo para sugestões.`;
  renderGraphqlSchemaFields();updateGraphqlSchemaControls();
}
function renderGraphqlAutocomplete(){
  const list=byId('graphql-autocomplete'),query=byId('graphql-query');list.replaceChildren();graphqlAutocompleteSuggestions=[];graphqlAutocompleteIndex=0;
  if(!graphqlSchema)return;
  if(graphqlSchemaEndpointKey!==graphqlSchemaEndpointKeyFromForm()){clearGraphqlSchema('Endpoint, ambiente ou Auth mudou; carregue o schema novamente.');return;}
  const cursor=query.selectionStart??query.value.length,prefixMatch=query.value.slice(0,cursor).match(/[_A-Za-z][_0-9A-Za-z]*$/);
  if(!prefixMatch){list.hidden=true;query.setAttribute('aria-expanded','false');query.removeAttribute('aria-activedescendant');return;}
  const prefix=prefixMatch[0],typeName=byId('graphql-schema-type').value;
  graphqlAutocompleteSuggestions=RunnerLogic.suggestGraphqlFields(graphqlSchema,typeName,prefix,12).filter(field=>field.name.toLowerCase()!==prefix.toLowerCase());
  if(!graphqlAutocompleteSuggestions.length){list.hidden=true;query.setAttribute('aria-expanded','false');query.removeAttribute('aria-activedescendant');return;}
  graphqlAutocompleteSuggestions.forEach((field,index)=>{
    const button=document.createElement('button');button.id=`graphql-autocomplete-${index}`;button.type='button';button.className='graphql-autocomplete-option';button.dataset.graphqlSuggestion=field.name;button.setAttribute('role','option');button.setAttribute('aria-selected',String(index===graphqlAutocompleteIndex));
    const name=document.createElement('span');name.textContent=field.name;const type=document.createElement('span');type.className='graphql-schema-field-type';type.textContent=field.returnType;button.append(name,type);button.addEventListener('click',()=>insertGraphqlField(field.name));list.append(button);
  });
  list.hidden=false;query.setAttribute('aria-expanded','true');query.setAttribute('aria-activedescendant','graphql-autocomplete-0');
}
function insertGraphqlField(name){
  const query=byId('graphql-query'),value=query.value,start=query.selectionStart??value.length,end=query.selectionEnd??start,prefix=value.slice(0,start).match(/[_A-Za-z][_0-9A-Za-z]*$/),replaceStart=prefix?start-prefix[0].length:start;
  query.value=value.slice(0,replaceStart)+name+value.slice(end);const cursor=replaceStart+name.length;query.focus();query.setSelectionRange(cursor,cursor);syncActiveWorkspaceTab(true);renderBodyHighlight();renderGraphqlAutocomplete();
}
function handleGraphqlAutocompleteKeydown(event){
  if(byId('graphql-autocomplete').hidden||!graphqlAutocompleteSuggestions.length)return;
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){
    event.preventDefault();const step=event.key==='ArrowDown'?1:-1;graphqlAutocompleteIndex=(graphqlAutocompleteIndex+step+graphqlAutocompleteSuggestions.length)%graphqlAutocompleteSuggestions.length;
    const buttons=byId('graphql-autocomplete').querySelectorAll('[role="option"]');buttons.forEach((button,index)=>button.setAttribute('aria-selected',String(index===graphqlAutocompleteIndex)));
    const active=buttons[graphqlAutocompleteIndex];byId('graphql-query').setAttribute('aria-activedescendant',active.id);active.scrollIntoView({block:'nearest'});return;
  }
  if(event.key==='Enter'&&!event.isComposing){event.preventDefault();insertGraphqlField(graphqlAutocompleteSuggestions[graphqlAutocompleteIndex].name);}
  else if(event.key==='Escape'){byId('graphql-autocomplete').hidden=true;byId('graphql-query').setAttribute('aria-expanded','false');byId('graphql-query').removeAttribute('aria-activedescendant');}
}
function renderGraphqlFields(source={}){
  clearGraphqlSchema();
  byId('graphql-query').value=String(source.graphqlQuery||'');byId('graphql-variables').value=String(source.graphqlVariables||'');byId('graphql-operation-name').value=String(source.graphqlOperationName||'');
}
function graphqlIntrospectionRequestFromForm(){
  const auth=authFieldsFromForm(applyEnvironment,true);
  return{baseUrl:applyEnvironment(byId('base-url').value.trim()),route:applyEnvironment(buildRequestRoute()),headers:applyEnvironment(byId('headers').value),...auth,environmentId:activeEnvironmentId||'default',allowInsecureHttp:byId('allow-insecure-http').checked};
}
function graphqlSchemaEndpointKeyForRequest(request){return JSON.stringify([request.environmentId||'default',request.baseUrl,request.route,authModeFromForm(),request.authType,request.apiKeyName,request.apiKeyLocation]);}
function graphqlSchemaEndpointKeyFromForm(){try{return graphqlSchemaEndpointKeyForRequest(graphqlIntrospectionRequestFromForm());}catch{return '';}}
function loadGraphqlSchema(){
  if(graphqlSchemaLoading)return;
  void runGraphqlSchemaLoad();
}
async function runGraphqlSchemaLoad(){
  let request;
  try{
    if(byId('body-mode').value!=='graphql')throw Error('Selecione o formato GraphQL antes de consultar o schema.');
    request=graphqlIntrospectionRequestFromForm();
    if(!request.baseUrl||!request.route)throw Error('Informe URL base e rota do endpoint GraphQL.');
    const safeBase=sanitizeBase(request.baseUrl),safeRoute=sanitizeRoute(request.route);
    if(safeBase.redacted||safeRoute.redacted)throw Error('Remova credenciais e parâmetros sensíveis da URL; configure Auth pela aba correspondente.');
    const insecureOrigin=RunnerLogic.remoteHttpOrigin(request.baseUrl);
    if(insecureOrigin&&!request.allowInsecureHttp)throw Error('HTTP fora de localhost está bloqueado. Autorize-o nesta request antes de consultar o schema.');
    const detail=redactVaultValues(safeBase.value.replace(/\/+$/,'')+safeRoute.value);
    const warning=['Vortix envia somente uma query GraphQL __schema de leitura, sem mutations nem variables.','Headers, Auth e Cookie jar do ambiente ativo serão utilizados; schema não vai para histórico nem SQLite.',insecureOrigin?remoteHttpWarning(insecureOrigin):''].filter(Boolean).join(' ');
    graphqlSchemaLoading=true;updateGraphqlSchemaControls();
    const status=byId('graphql-schema-status');status.dataset.state='loading';status.textContent='Aguardando confirmação para consultar schema…';
    if(!(await confirmWithDialog({eyebrow:'SCHEMA GRAPHQL',title:'Consultar schema da API?',description:'POST '+redactVaultValues(safeRoute.value),detail,warning,confirmLabel:'Consultar schema',danger:!!insecureOrigin}))){status.dataset.state='idle';status.textContent='Consulta cancelada. O endpoint não foi chamado.';return;}
    clearGraphqlSchema('Consultando schema GraphQL…');status.dataset.state='loading';status.textContent='Consultando schema GraphQL…';
    const response=await fetch('/api/graphql/introspection',{method:'POST',headers:{'Content-Type':'application/json','X-Api-Studio':'1'},cache:'no-store',body:JSON.stringify(request)});
    const result=await response.json().catch(()=>null);
    if(!response.ok||!result)throw Error(result?.error||'O servidor local não retornou schema GraphQL válido.');
    if(result.error)throw Error(result.error);
    const schema=RunnerLogic.parseGraphqlSchemaResponse(result.body,result.status);
    renderGraphqlSchema(schema,graphqlSchemaEndpointKeyForRequest(request));
    if(result.cookieJarWarning)showToast('Cookie não salvo',result.cookieJarWarning,'warning');
    showToast('Schema GraphQL carregado',`${schema.types.length} tipos disponíveis para autocomplete. O schema fica só nesta sessão.`,'success');
  }catch(error){const status=byId('graphql-schema-status');status.dataset.state='error';status.textContent=error.message||'Não foi possível consultar o schema GraphQL.';showToast('Falha ao carregar schema',status.textContent,'error');}
  finally{graphqlSchemaLoading=false;updateGraphqlSchemaControls();}
}
function formatGraphqlVariables(){
  const field=byId('graphql-variables'),source=field.value.trim();if(!source)return;
  try{const value=JSON.parse(source);if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Variables precisam ser um objeto JSON.');field.value=JSON.stringify(value,null,2);syncActiveWorkspaceTab(true);showToast('Variables formatadas','JSON identado com dois espaços.','success');}
  catch(error){showToast('JSON inválido',error.message||'Revise as variables antes de formatar.','error');}
}
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
  const nl=document.createElement('label');nl.htmlFor=`query-param-${n}-name`;nl.textContent='Parâmetro';
  const ni=document.createElement('input');ni.id=nl.htmlFor;ni.type='text';ni.autocomplete='off';ni.spellcheck=false;ni.value=name;ni.dataset.queryName='';ni.placeholder='Ex.: page';ni.setAttribute('aria-label','Parâmetro');
  const nf=document.createElement('div');nf.append(nl,ni);
  const vl=document.createElement('label');vl.htmlFor=`query-param-${n}-value`;vl.textContent='Valor';
  const vi=document.createElement('input');vi.id=vl.htmlFor;vi.type=isSensitiveName(name)?'password':'text';vi.autocomplete=isSensitiveName(name)?'new-password':'off';vi.spellcheck=false;vi.value=value;vi.dataset.queryValue='';vi.placeholder='Ex.: 1';vi.setAttribute('aria-label','Valor');
  const vf=document.createElement('div');vf.append(vl,vi);
  const remove=document.createElement('button');remove.className='button secondary';remove.type='button';remove.textContent='×';remove.setAttribute('aria-label',`Remover parâmetro ${n}`);
  remove.onclick=()=>{row.remove();byId('confirm-test-data').checked=false;updateGuard();updateParamsCount();};
  ni.oninput=()=>{const secret=isSensitiveName(ni.value.trim());vi.type=secret?'password':'text';vi.autocomplete=secret?'new-password':'off';byId('confirm-test-data').checked=false;updateGuard();updateParamsCount();};
  vi.oninput=()=>{byId('confirm-test-data').checked=false;updateGuard();updateParamsCount();};row.append(nf,vf,remove);return row;
}
function renderQueryParams(entries){queryParams.replaceChildren();for(const [k,v]of entries)queryParams.append(createQueryParamRow(k,v));updateParamsCount();}
function ensureQueryParamRow(){if(!queryParams.children.length){queryParams.append(createQueryParamRow());updateParamsCount();}}
function addQueryParamRow(k='',v=''){const row=createQueryParamRow(k,v);queryParams.append(row);row.querySelector('[data-query-name]').focus();updateParamsCount();}
function updateParamsCount(){byId('params-count').textContent=String([...queryParams.children].filter(r=>r.querySelector('[data-query-name]').value.trim()).length);}
function buildRequestRoute(resolveValues=false,allowEmpty=false,preRequestOverrides={}){
  let path=route.value.trim();if(!path&&allowEmpty)return'';if(!path.startsWith('/')||path.startsWith('//')||path.includes('?')||path.includes('#')||path.includes('\\')||path.includes('://'))throw Error('Informe um caminho iniciado por /. Use Params para a query.');
  if(resolveValues)path=applyEnvironment(path,preRequestOverrides);
  const pairs=[];for(const row of queryParams.children){let k=row.querySelector('[data-query-name]').value.trim(),v=row.querySelector('[data-query-value]').value;if(!k&&!v)continue;if(!k)throw Error('Informe a chave de cada parâmetro preenchido.');if(resolveValues){k=applyEnvironment(k,preRequestOverrides);v=applyEnvironment(v,preRequestOverrides);}pairs.push(`${encodeParam(k)}=${encodeParam(v)}`);}
  return path+(pairs.length?'?'+pairs.join('&'):'');
}
function encodeParam(value){const templates=[];const text=String(value).replace(/\{\{\s*([^{}]+?)\s*\}\}/g,match=>{const marker=`APITESTTEMPLATE${templates.length}X`;templates.push(match);return marker;});return encodeURIComponent(text).replace(/APITESTTEMPLATE(\d+)X/g,(_,index)=>templates[Number(index)]||'');}
function oauth2TokenConfigFromForm(){return RunnerLogic.normalizeOAuthClientCredentialsConfig({tokenUrl:byId('oauth2-token-url').value,clientId:byId('oauth2-client-id').value,scope:byId('oauth2-scope').value,clientAuthMethod:byId('oauth2-client-auth-method').value});}
function oauth2TokenConfigStorageKey(environmentId=activeEnvironmentId||'default'){return OAUTH2_TOKEN_CONFIG_KEY+':'+environmentId;}
function oauth2TokenMetadataStorageKey(environmentId=activeEnvironmentId||'default'){return OAUTH2_TOKEN_META_KEY+':'+environmentId;}
async function persistOAuth2TokenConfig(showError=false){
  try{oauth2TokenConfig=oauth2TokenConfigFromForm();await dbWrite('settings',{key:oauth2TokenConfigStorageKey(),value:oauth2TokenConfig});updateOAuth2TokenButton();return true;}
  catch(error){if(showError)showToast('Configuração OAuth inválida',error.message||'Revise endpoint, client ID e scopes.','error');return false;}
}
function updateOAuth2TokenButton(){
  if(!oauth2TokenButton)return;
  try{const config=oauth2TokenConfigFromForm();oauth2TokenButton.disabled=!config.tokenUrl||!config.clientId.trim()||!byId('oauth2-client-secret').value;}
  catch{oauth2TokenButton.disabled=true;}
}
async function renderOAuth2TokenStatus(){
  const status=byId('oauth2-token-status');if(!status)return;
  const key=oauth2TokenMetadataStorageKey();
  try{
    const record=await dbRead('settings',key);if(key!==oauth2TokenMetadataStorageKey())return;
    const variables=getEnvironment().variables||{},hasToken=Object.hasOwn(variables,'token')&&String(variables.token||'').length>0;
    if(!hasToken){status.dataset.state='info';status.textContent='Nenhum token {{token}} salvo neste ambiente.';return;}
    const expiresAt=Number(record?.value?.expiresAt)||0;
    if(!expiresAt){status.dataset.state='info';status.textContent='Token salvo. O servidor não informou expires_in.';return;}
    const expiresText=new Date(expiresAt).toLocaleString();
    if(Date.now()>=expiresAt){status.dataset.state='expired';status.textContent='Token expirado em '+expiresText+'. Solicite outro para renovar.';return;}
    status.dataset.state='valid';status.textContent='Token válido até '+expiresText+'. A renovação é manual.';
  }catch{status.dataset.state='warning';status.textContent='Não foi possível ler o estado do token neste ambiente.';}
}
async function loadOAuth2TokenConfig(){
  const saved=await dbRead('settings',oauth2TokenConfigStorageKey());oauth2TokenConfig=RunnerLogic.normalizeOAuthClientCredentialsConfig(saved?.value);
  byId('oauth2-token-url').value=oauth2TokenConfig.tokenUrl;byId('oauth2-client-id').value=oauth2TokenConfig.clientId;byId('oauth2-scope').value=oauth2TokenConfig.scope;byId('oauth2-client-auth-method').value=oauth2TokenConfig.clientAuthMethod;
  byId('oauth2-client-secret').value='';byId('oauth2-allow-insecure-http').checked=false;updateOAuth2TokenButton();await renderOAuth2TokenStatus();
}
function oauthPkceConfigFromForm(){return RunnerLogic.normalizeOAuthPkceConfig({authorizationUrl:byId('oauth-pkce-authorization-url').value,tokenUrl:byId('oauth-pkce-token-url').value,clientId:byId('oauth-pkce-client-id').value,scope:byId('oauth-pkce-scope').value});}
function oauthPkceConfigStorageKey(environmentId=activeEnvironmentId||'default'){return OAUTH_PKCE_CONFIG_KEY+':'+environmentId;}
async function persistOAuthPkceConfig(showError=false){
  try{oauthPkceConfig=oauthPkceConfigFromForm();await dbWrite('settings',{key:oauthPkceConfigStorageKey(),value:oauthPkceConfig});updateOAuthPkceStartButton();return true;}
  catch(error){if(showError)showToast('Configuração OAuth PKCE inválida',error.message||'Revise endpoints, Client ID e scopes.','error');return false;}
}
function oauthPkceUsesLoopbackOrigin(){return window.location.protocol==='http:'&&window.location.hostname==='127.0.0.1';}
async function oauthPkceLocalRequest(url,requestMethod='GET',value){
  const headers={'X-Api-Studio':'1'},options={method:requestMethod,headers,cache:'no-store'};
  if(value!==undefined){headers['Content-Type']='application/json';options.body=JSON.stringify(value);}
  const response=await fetch(url,options);
  if(response.status===204)return null;
  let payload={};try{payload=await response.json();}catch{}
  if(!response.ok)throw Error(payload.error||'Falha na comunicação OAuth local.');
  return payload;
}
function updateOAuthPkceStartButton(){
  const button=oauthPkceStartButton,copyButton=byId('oauth-pkce-redirect-copy');if(!button)return;
  try{
    const config=oauthPkceConfigFromForm();
    button.disabled=oauthPkceBusy||!oauthPkceUsesLoopbackOrigin()||!config.authorizationUrl||!config.tokenUrl||!config.clientId||!byId('oauth-pkce-redirect-uri').value;
  }catch{button.disabled=true;}
  if(copyButton)copyButton.disabled=!byId('oauth-pkce-redirect-uri').value;
}
async function refreshOAuthPkceRedirectPreview(){
  const redirect=byId('oauth-pkce-redirect-uri'),status=byId('oauth-pkce-flow-status');
  if(!oauthPkceUsesLoopbackOrigin()){
    redirect.value='';status.dataset.state='warning';status.textContent='Abra o Vortix em http://127.0.0.1:'+window.location.port+' para receber o callback apenas neste computador.';
    updateOAuthPkceStartButton();return;
  }
  let config;
  try{config=oauthPkceConfigFromForm();}
  catch(error){redirect.value='';status.dataset.state='error';status.textContent=error.message||'Revise as URLs OAuth.';updateOAuthPkceStartButton();return;}
  if(!config.authorizationUrl){
    redirect.value='';status.dataset.state='info';status.textContent='Informe a URL de autorização para calcular a redirect URI exata.';updateOAuthPkceStartButton();return;
  }
  const resolvedAuthorizationUrl=applyEnvironment(config.authorizationUrl);
  try{
    const preview=await oauthPkceLocalRequest('/api/oauth/pkce/redirect-uri','POST',{authorizationUrl:resolvedAuthorizationUrl});
    if(applyEnvironment(oauthPkceConfigFromForm().authorizationUrl)!==resolvedAuthorizationUrl)return;
    redirect.value=preview.redirectUri||'';
    status.dataset.state='info';status.textContent='Cadastre esta redirect URI exata no provedor antes de autorizar.';
  }catch(error){
    redirect.value='';status.dataset.state='error';status.textContent=error.message||'Não foi possível calcular a redirect URI.';
  }
  updateOAuthPkceStartButton();
}
function scheduleOAuthPkceRedirectPreview(){
  clearTimeout(oauthPkcePreviewTimer);oauthPkcePreviewTimer=setTimeout(()=>void refreshOAuthPkceRedirectPreview(),300);
}
async function loadOAuthPkceConfig(){
  const saved=await dbRead('settings',oauthPkceConfigStorageKey());
  oauthPkceConfig=RunnerLogic.normalizeOAuthPkceConfig(saved?.value);
  byId('oauth-pkce-authorization-url').value=oauthPkceConfig.authorizationUrl;
  byId('oauth-pkce-token-url').value=oauthPkceConfig.tokenUrl;
  byId('oauth-pkce-client-id').value=oauthPkceConfig.clientId;
  byId('oauth-pkce-scope').value=oauthPkceConfig.scope;
  byId('oauth-pkce-redirect-uri').value='';
  updateOAuthPkceStartButton();await refreshOAuthPkceRedirectPreview();
}
async function copyOAuthPkceRedirectUri(){
  const uri=byId('oauth-pkce-redirect-uri').value;if(!uri)return;
  try{await copyToClipboard(uri);}
  catch{showToast('Falha ao copiar','O navegador bloqueou a área de transferência. Selecione e copie a URI.','error');}
}
async function requestOAuthAuthorizationCodeToken(){
  if(oauthPkceBusy)return;
  if(!oauthPkceUsesLoopbackOrigin()){
    showToast('Abra o Vortix localmente','Use http://127.0.0.1:'+window.location.port+' para receber o callback com segurança.','warning');return;
  }
  const popup=window.open('about:blank','_blank');
  if(!popup){showToast('Pop-up bloqueado','Permita pop-ups para abrir o provedor de identidade.','warning');return;}
  oauthPkcePopup=popup;oauthPkceBusy=true;oauthPkceCancelRequested=false;byId('oauth-pkce-cancel').hidden=false;byId('oauth-pkce-cancel').disabled=false;
  const status=byId('oauth-pkce-flow-status');status.dataset.state='loading';status.textContent='Preparando autorização segura…';updateOAuthPkceStartButton();
  let state='';
  try{
    if(!(await persistOAuthPkceConfig(true)))return;
    const config=oauthPkceConfigFromForm();
    const start=await oauthPkceLocalRequest('/api/oauth/pkce/start','POST',{
      authorizationUrl:applyEnvironment(config.authorizationUrl),tokenUrl:applyEnvironment(config.tokenUrl),
      clientId:applyEnvironment(config.clientId),scope:applyEnvironment(config.scope)
    });
    state=String(start.state||'');
    if(!state||!start.authorizationUrl||!start.redirectUri)throw Error('O servidor não criou o fluxo PKCE.');
    if(oauthPkceCancelRequested){
      await oauthPkceLocalRequest('/api/oauth/pkce/status/'+encodeURIComponent(state),'DELETE').catch(()=>{});
      status.dataset.state='info';status.textContent='Fluxo cancelado. Feche a aba em branco do provedor.';
      showToast('Autorização cancelada','Nenhum token foi salvo. Feche a aba do provedor se ela continuar aberta.','info');return;
    }
    byId('oauth-pkce-redirect-uri').value=start.redirectUri;
    popup.opener=null;popup.location.replace(start.authorizationUrl);
    const deadline=Date.parse(start.expiresAt)||Date.now()+300000;
    let result=null;
    while(Date.now()<deadline){
      await new Promise(resolve=>setTimeout(resolve,700));
      if(oauthPkceCancelRequested){
        await oauthPkceLocalRequest('/api/oauth/pkce/status/'+encodeURIComponent(state),'DELETE').catch(()=>{});
        result={status:'cancelled'};break;
      }
      result=await oauthPkceLocalRequest('/api/oauth/pkce/status/'+encodeURIComponent(state),'GET');
      if(['complete','cancelled','error','expired'].includes(result.status))break;
      status.textContent=result.status==='exchanging'?'Trocando código por token…':'Aguardando autorização no provedor…';
      if(popup.closed){
        await oauthPkceLocalRequest('/api/oauth/pkce/status/'+encodeURIComponent(state),'DELETE').catch(()=>{});
        result={status:'cancelled'};break;
      }
    }
    if(!result||result.status==='pending'||result.status==='exchanging')result={status:'expired'};
    if(result.status==='cancelled'){
      status.dataset.state='info';status.textContent='Autorização cancelada. Feche a aba do provedor se ela continuar aberta. Nenhum token foi salvo.';
      showToast('Autorização cancelada','Nenhum token foi salvo no ambiente.','info');return;
    }
    if(result.status!=='complete'){
      const message=result.error||'O fluxo PKCE expirou. Inicie uma nova autorização.';
      status.dataset.state=result.status==='expired'?'warning':'error';status.textContent=message;
      showToast('Falha no OAuth',message,'error');return;
    }
    const tokenBody={access_token:result.accessToken,token_type:'Bearer'};
    if(result.expiresIn!==null&&result.expiresIn!==undefined)tokenBody.expires_in=result.expiresIn;
    const tokenInfo=RunnerLogic.parseOAuthTokenResponse(JSON.stringify(tokenBody),200,Date.parse(result.obtainedAt)||Date.now());
    const refreshToken=String(result.refreshToken||'');
    let savedAccess=null,savedRefresh=null;
    if(byId('oauth-pkce-save-access-token').checked){
      savedAccess=await saveEnvironmentVariable('token',tokenInfo.accessToken);await saveOAuth2TokenMetadata(tokenInfo);
    }
    if(byId('oauth-pkce-save-refresh-token').checked&&refreshToken)
      savedRefresh=await saveEnvironmentVariable('refresh_token',refreshToken);
    const requestAuthMode=authModeFromForm();
    if(requestAuthMode==='custom'){
      byId('bearer-token').value=savedAccess?'{{token}}':tokenInfo.accessToken;
      byId('auth-type').value='bearer';
      if(!savedAccess)byId('save-token-history').checked=false;
      updateAuthTypeUi();syncActiveWorkspaceTab(true);
    }
    const notes=[];
    if(savedAccess)notes.push('{{token}} salvo no ambiente "'+savedAccess.name+'".');
    else if(requestAuthMode==='custom')notes.push('Access token preenchido em Bearer só nesta sessão; não foi salvo no ambiente.');
    else notes.push('Token obtido, mas não salvo. Marque Salvar access token para reutilizá-lo.');
    if(savedRefresh)notes.push('{{refresh_token}} salvo no ambiente "'+savedRefresh.name+'".');
    else if(byId('oauth-pkce-save-refresh-token').checked&&!refreshToken)notes.push('O provedor não retornou refresh_token.');
    if(tokenInfo.expiresAt)notes.push('Expira em '+new Date(tokenInfo.expiresAt).toLocaleString()+'.');
    const message=notes.join(' ');
    status.dataset.state=savedAccess?'success':'info';status.textContent=message;
    showToast('OAuth token obtido',message,'success',7000);
  }catch(error){
    const message=error.message||'Confira o provedor OAuth e tente novamente.';
    status.dataset.state='error';status.textContent=message;showToast('Falha no OAuth',message,'error');
  }finally{
    if(state)await oauthPkceLocalRequest('/api/oauth/pkce/status/'+encodeURIComponent(state),'DELETE').catch(()=>{});
    oauthPkcePopup=null;oauthPkceBusy=false;oauthPkceCancelRequested=false;byId('oauth-pkce-cancel').hidden=true;byId('oauth-pkce-cancel').disabled=false;updateOAuthPkceStartButton();
  }
}
function cancelOAuthPkceAuthorization(){if(!oauthPkceBusy)return;oauthPkceCancelRequested=true;byId('oauth-pkce-cancel').disabled=true;const status=byId('oauth-pkce-flow-status');status.dataset.state='info';status.textContent='Cancelando fluxo. Feche a aba do provedor se ela continuar aberta.';}
async function saveOAuth2TokenMetadata(tokenInfo){
  const key=oauth2TokenMetadataStorageKey();
  if(tokenInfo.expiresAt)await dbWrite('settings',{key,value:{expiresAt:tokenInfo.expiresAt,obtainedAt:Date.now()}});
  else await dbWrite('settings',key,true);
  await renderOAuth2TokenStatus();
}
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
function remoteHttpWarning(origin){return `HTTP em ${redactVaultValues(origin)} não cifra tráfego; credenciais, headers e body podem ser observados na rede.`;}
function updateHistoryComparisonControls(){
  const button=byId('compare-history-responses');if(!button)return;
  button.hidden=historyComparisonIds.length===0;button.disabled=historyComparisonIds.length!==2;
  button.textContent=historyComparisonIds.length===1?'Selecione outra resposta':'Comparar respostas';
}
function setHistoryComparisonSelection(id,checked,checkbox){
  const key=String(id||'');
  if(checked){
    if(historyComparisonIds.length>=2&&!historyComparisonIds.includes(key)){checkbox.checked=false;showToast('Compare duas respostas','Desmarque uma seleção antes de escolher outra.','info');return;}
    if(!historyComparisonIds.includes(key))historyComparisonIds.push(key);
  }else historyComparisonIds=historyComparisonIds.filter(item=>item!==key);
  updateHistoryComparisonControls();
}
function historyComparisonBodyText(response){
  if(response.tokenRequest)return 'Body de resposta de token removido por segurança.';
  if(!response.bodySaved)return response.bodyOmitted==='size-limit'?'Body não salvo: excedeu o limite de tamanho.':'Body não foi salvo para esta response.';
  return response.body||'(body vazio)';
}
function renderHistoryComparison(comparison){
  const statusText=value=>Number.isInteger(value.status)?`HTTP ${value.status} ${value.reason}`.trim():'Sem status';
  const delta=comparison.durationDeltaMs,deltaText=`${delta>0?'+':''}${delta} ms`;
  const statusSummary=comparison.statusChanged?`Status: ${comparison.left.status??'—'} → ${comparison.right.status??'—'}`:`Status HTTP sem alteração (${comparison.left.status??'—'})`;
  const headerSummary=comparison.headerChanges.length?`Headers diferentes: ${comparison.headerChanges.map(item=>item.name).join(', ')}`:'Headers iguais';
  const bodySummary=!comparison.bodyComparable?'Bodies não comparáveis: body não foi guardado em uma ou nas duas responses.':comparison.bodyChanged?'Bodies diferentes':'Bodies iguais';
  byId('history-compare-summary').textContent=[statusSummary,`Duração: ${comparison.left.durationMs} → ${comparison.right.durationMs} ms (${deltaText})`,headerSummary,bodySummary].join(' · ');
  for(const [side,key] of [[comparison.left,'left'],[comparison.right,'right']]){
    byId(`history-compare-${key}-title`).textContent=`${side.method} ${side.route||'/'}`;
    byId(`history-compare-${key}-meta`).textContent=`${statusText(side)} · ${side.durationMs} ms · ${side.savedAt?new Date(side.savedAt).toLocaleString():''}`;
    byId(`history-compare-${key}-headers`).textContent=JSON.stringify(side.headers,null,2);
    byId(`history-compare-${key}-body`).textContent=historyComparisonBodyText(side);
  }
}
async function openHistoryComparison(){
  if(historyComparisonIds.length!==2)return;
  try{
    const entries=await dbRead('history'),selected=historyComparisonIds.map(id=>entries.find(entry=>String(entry.id)===id));
    if(selected.some(entry=>!entry?.response))throw Error('As duas respostas precisam continuar no histórico.');
    renderHistoryComparison(RunnerLogic.compareHistoryResponses(selected[0],selected[1]));byId('history-compare-dialog').showModal();
  }catch(error){showToast('Não foi possível comparar',error.message||'Selecione duas respostas salvas.','error');}
}
function syncHistorySettingsControls(){
  const limit=byId('history-retention-limit'),saveBody=byId('history-save-response-body');
  if(limit)limit.value=String(historySettings.limit);
  if(saveBody)saveBody.checked=historySettings.saveResponseBody;
}
async function trimHistory(limit=historySettings.limit){
  if(hostedMode){
    const entries=(await dbRead('history')).sort((a,b)=>(Date.parse(b.savedAt||'')||0)-(Date.parse(a.savedAt||'')||0)),removed=entries.slice(limit);
    for(const entry of removed)await dbWrite('history',entry.id,true);
    return {removed:removed.length};
  }
  const response=await fetch('/api/storage/history/trim',{method:'POST',headers:{'Content-Type':'application/json','X-Api-Studio':'1'},cache:'no-store',body:JSON.stringify({limit})});
  if(!response.ok)throw Error('O servidor local não aplicou o limite do histórico.');
  return response.json();
}
async function saveHistorySettings(){
  const current=historySettings,next=RunnerLogic.normalizeHistorySettings({limit:Number(byId('history-retention-limit').value),saveResponseBody:byId('history-save-response-body').checked});
  if(next.limit===current.limit&&next.saveResponseBody===current.saveResponseBody)return;
  let removedCount=0;
  if(next.limit<current.limit){
    let entries;try{entries=await dbRead('history');}catch{syncHistorySettingsControls();showToast('Histórico indisponível','Não foi possível conferir os registros que serão removidos.','error');return;}
    removedCount=Math.max(0,entries.length-next.limit);
    if(removedCount&&!(await confirmWithDialog({eyebrow:'HISTÓRICO',title:'Aplicar limite do histórico?',description:`Serão removidas ${removedCount} requests mais antigas, incluindo responses e bodies salvos.`,warning:'A remoção não pode ser desfeita.',confirmLabel:'Aplicar limite',danger:true}))){syncHistorySettingsControls();return;}
  }
  try{await dbWrite('settings',{key:'historyPreferences',value:next});}
  catch(error){syncHistorySettingsControls();showToast('Preferência não salva',error.message||'Não foi possível salvar as opções do histórico.','error');return;}
  historySettings=next;syncHistorySettingsControls();
  if(removedCount){
    try{const result=await trimHistory(next.limit);showToast('Limite aplicado',`${result.removed} registros antigos removidos.`,'success');}
    catch{showToast('Limite salvo; limpeza pendente','O servidor não removeu os registros antigos. Tente novamente após atualizar o Vortix.','warning');}
  }else showToast('Histórico atualizado',next.saveResponseBody?(hostedMode?'Bodies serão guardados neste navegador, exceto respostas de token.':'Bodies serão guardados com proteção local, exceto respostas de token.'):'Bodies novos não serão guardados.','success',3500);
  await renderHistory();
}
function showHistoryResponse(entry){
  const response=entry?.response;if(!response)return;
  clearCurrentResponseExample();
  const status=Number(response.status),statusText=Number.isInteger(status)?`${status} ${response.reason||''}`.trim():'Resposta sem status';
  const bodyText=entry.tokenRequest?'Body de resposta de token removido por segurança.':response.bodySaved?String(response.body??''):response.bodyOmitted==='size-limit'?'Body não salvo: excedeu o limite de tamanho.':'Body não foi armazenado por configuração de privacidade.';
  showResponse(status>=200&&status<300?statusText:statusText,status>=200&&status<300?'ok':'bad',JSON.stringify(RunnerLogic.normalizeHistoryResponseHeaders(response.headers),null,2),bodyText);
  byId('request-note').textContent='Resposta restaurada do histórico. Envie a request para consultar a API novamente.';
  byId('response-persistence-note').textContent='Resposta recuperada do histórico';
  byId('response-status').title=`${statusText} · Resposta do histórico · ${Number(response.durationMs)||0} ms`;
}
async function renderHistory(){
  const list=byId('request-history');list.replaceChildren();
  try{
    const entries=(await dbRead('history')).sort((a,b)=>Date.parse(b.savedAt||'')-Date.parse(a.savedAt||''));
    historyComparisonIds=historyComparisonIds.filter(id=>entries.some(entry=>String(entry.id)===id&&entry.response));
    byId('history-count').textContent=String(entries.length);byId('clear-history').disabled=!entries.length;updateHistoryComparisonControls();
    if(!entries.length){const empty=document.createElement('p');empty.className='history-empty';empty.textContent='Nenhuma requisição no histórico.';list.append(empty);return;}
    for(const entry of entries){
      const item=document.createElement('article');item.className='history-item';const info=document.createElement('div');info.className='history-info';
      const title=document.createElement('p');title.className='history-title';const m=document.createElement('span');m.className=`history-method ${String(entry.method||'GET').toLowerCase()}`;m.textContent=entry.method||'GET';
      const path=document.createElement('span');path.className='history-route';path.textContent=entry.route||'/api/';title.append(m,path);info.append(title);
      const actions=document.createElement('div');actions.className='history-actions';
      const load=document.createElement('button');load.className='button secondary';load.type='button';load.textContent='↩';load.title='Carregar';load.setAttribute('aria-label','Carregar '+(entry.route||'request'));load.onclick=()=>loadHistoryEntry(entry);
      const remove=document.createElement('button');remove.className='button secondary';remove.type='button';remove.textContent='×';remove.title='Excluir';remove.setAttribute('aria-label','Excluir '+(entry.route||'request'));remove.onclick=()=>removeHistory(entry.id);
      if(entry.response){
        const selection=document.createElement('label');selection.className='history-compare-select';
        const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=historyComparisonIds.includes(String(entry.id));checkbox.setAttribute('aria-label','Selecionar resposta para comparar: '+(entry.route||'request'));checkbox.onchange=()=>setHistoryComparisonSelection(entry.id,checkbox.checked,checkbox);selection.append(checkbox);item.append(selection);
        const responseStatus=Number(entry.response.status),view=document.createElement('button');view.className='button secondary history-response-status';view.type='button';view.textContent=Number.isInteger(responseStatus)?String(responseStatus):'ERR';view.dataset.kind=responseStatus>=200&&responseStatus<300?'success':'failure';view.title=`Ver resposta salva · ${Number(entry.response.durationMs)||0} ms`;view.setAttribute('aria-label',`Ver resposta ${Number.isInteger(responseStatus)?'HTTP '+responseStatus:'sem status'} de ${entry.route||'request'}`);view.onclick=()=>showHistoryResponse(entry);actions.append(load,view,remove);
      }else actions.append(load,remove);
      item.append(info,actions);list.append(item);
    }
  }catch{byId('history-count').textContent='–';byId('clear-history').disabled=true;updateHistoryComparisonControls();const e=document.createElement('p');e.className='history-empty';e.textContent='Banco local indisponível.';list.append(e);}
}
async function saveHistoryResponse(entry,result,durationMs,responseVaultSecrets,options={}){
  if(!entry||!result)return;
  try{entry.response=RunnerLogic.createResponseHistorySnapshot(result,durationMs,{...(options.historySettings||historySettings),tokenRequest:entry.tokenRequest===true},responseVaultSecrets);await dbWrite('history',entry);await renderHistory();if(!options.quiet)byId('response-persistence-note').textContent='Resposta salva no histórico';return true;}
  catch(error){if(!options.quiet)showToast('Resposta não salva no histórico',error.message||'A request foi mantida, mas os metadados da resposta não puderam ser gravados.','warning');return false;}
}
async function saveHistory(request,options={}){
  const base=sanitizeBase(request.baseUrl),path=sanitizeRoute(request.route),headers=sanitizeHeaders(request.headers),payload=sanitizeBody(request.body),multipart=normalizePersistableMultipartFields(request.multipartFields,true),graphql=normalizePersistableGraphqlFields(request);
  const saveAuth=request.saveBearerToken===true,storedAuth=RunnerLogic.persistAuthFields({...request,authMode:request.authMode},saveAuth),authType=storedAuth.authType,preRequest=exportPreRequestActions(request,request.preRequestActionsLiteralConsent===true);
  const {authOmitted:storedAuthOmitted,...authFields}=storedAuth,bearerToken=authFields.bearerToken,basicUsername=authFields.basicUsername,basicPassword=authFields.basicPassword,apiKeyName=authFields.apiKeyName,apiKeyLocation=authFields.apiKeyLocation,apiKeyValue=authFields.apiKeyValue,authMode=authFields.authMode;
  const authOmitted=!!request.authOmitted||storedAuthOmitted;
  if(!base.value||!path.value)return null;
  const tokenRequest=!!request.tokenRequest,responseContract=RunnerLogic.sanitizeOpenApiResponseContract(request.responseContract),entry={
    id:newId(),savedAt:new Date().toISOString(),method:['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(request.method)?request.method:'GET',
    baseUrl:base.value,route:path.value,headers:bodyModeHeaders(headers.value,request.bodyMode),body:payload.value,bodyMode:normalizeBodyMode(request.bodyMode),multipartFields:multipart.fields,graphqlQuery:graphql.graphqlQuery,graphqlVariables:graphql.graphqlVariables,graphqlOperationName:graphql.graphqlOperationName,authType,bearerToken,basicUsername,basicPassword,apiKeyName,apiKeyLocation,apiKeyValue,authMode,collectionId:String(request.collectionId||""),folderId:String(request.folderId||""),environmentId:String(request.environmentId||'default'),authOmitted,tokenRequest,allowInsecureHttp:request.allowInsecureHttp===true,
    tokenCredentialMode:tokenRequest?(request.tokenCredentialMode==='query'?'query':'body'):'',tokenClientId:tokenRequest?String(request.tokenClientId||'').trim():'',
    tokenClientIdField:tokenRequest?String(request.tokenClientIdField||'client_id'):'',tokenClientSecretField:tokenRequest?String(request.tokenClientSecretField||'client_secret'):'',
    tokenFlow:tokenRequest?String(request.tokenFlow||''):'',oauthTokenUrl:tokenRequest?String(request.oauthTokenUrl||''):'',oauthClientId:tokenRequest?String(request.oauthClientId||''):'',oauthScope:tokenRequest?String(request.oauthScope||''):'',oauthClientAuthMethod:tokenRequest?String(request.oauthClientAuthMethod||''):'',
     redacted:base.redacted||path.redacted||headers.redacted||payload.redacted||authOmitted||multipart.redacted||graphql.redacted||preRequest.actions.length!==RunnerLogic.normalizePreRequestActions(request.preRequestActions).length,
     preRequestActions:preRequest.actions,preRequestActionsEnabled:preRequest.enabled,preRequestActionsLiteralConsent:preRequest.literalConsent,
    captureResponseVariable:!!request.captureResponseVariable,responseVariableName:String(request.responseVariableName||''),responseValueSource:request.responseValueSource==='text'?'text':'json',responseJsonPath:String(request.responseJsonPath||''),responseSuccessOnly:request.responseSuccessOnly!==false,responseCaptureTarget:request.responseCaptureTarget==='vault'?'vault':'environment',
    responseTests:RunnerLogic.normalizeResponseTests(request.responseTests),
    ...(responseContract?{responseContract}:{})
  };
  try{
    const retention=await dbWrite('history',entry);if(!options.quiet)byId('history-panel').open=true;
    const removed=retention?.removed||0;
     await renderHistory();const message=entry.redacted?'Campos sensíveis ou textos literais pré-request foram omitidos conforme o consentimento.':saveAuth&&hasAuthCredentials(entry)?'Request e credenciais de Auth salvas no banco local.':'Request salva sem credenciais de Auth.';
    if(!options.quiet)showToast('Histórico salvo',removed?`${message} ${removed} registros antigos foram removidos pela retenção.`:message,'success',3500);return entry;
  }catch(error){if(!options.quiet)showToast('Histórico indisponível',error.message||'A chamada terminou, mas o registro não pôde ser salvo.','warning');return null;}
}
function applyHistoryEntry(entry,notify=true){
  selectedContainer={collectionId:'',folderId:''};let environmentChanged=false;
  if(entry.environmentId&&environments.some(item=>item.id===entry.environmentId)){
    if(activeEnvironmentId!==entry.environmentId){releaseSecretVaultMemory();environmentChanged=true;}
    activeEnvironmentId=entry.environmentId;
  }else if(entry.authMode==='inherit'){
    const targetEnvironmentId=environments.some(item=>item.id==='default')?'default':environments[0]?.id||'default';
    if(activeEnvironmentId!==targetEnvironmentId){releaseSecretVaultMemory();environmentChanged=true;}
    activeEnvironmentId=targetEnvironmentId;
  }
  renderEnvironmentSelect();if(environmentChanged)void loadSecretVaultForActiveEnvironment();
  byId('base-url').value=entry.baseUrl||'';baseUrlAuto=false;byId('allow-insecure-http').checked=entry.allowInsecureHttp===true;method.value=['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(entry.method)?entry.method:'GET';
  const parts=splitRoute(sanitizeRoute(String(entry.route||'')).value);route.value=parts.route;renderQueryParams(parts.params);ensureQueryParamRow();
  byId('headers').value=sanitizeHeaders(String(entry.headers||'')).value;body.value=entry.tokenRequest?'':sanitizeBody(String(entry.body||'')).value;applyBodyMode(entry.bodyMode);renderMultipartFields(entry.multipartFields||[]);renderGraphqlFields(entry);if(entry.collectionId&&findCollection(entry.collectionId)){const parent=findCollection(entry.collectionId),folder=findFolder(parent,entry.folderId);selectedContainer={collectionId:entry.collectionId,folderId:folder?.id||''};}
  applyAuthFields(entry);const isOAuth2=entry.tokenFlow==='oauth2-client-credentials';if(hasAuthCredentials(entry))byId('save-token-history').checked=true;
  byId('token-client-id').value=entry.tokenRequest?String(entry.tokenClientId||''):'';byId('token-client-secret').value='';
  byId('token-credential-mode').value=entry.tokenCredentialMode==='query'?'query':'body';if(entry.tokenRequest){byId('token-route').value=parts.route;byId('token-client-id-field').value=entry.tokenClientIdField||'client_id';byId('token-client-secret-field').value=entry.tokenClientSecretField||'client_secret';tokenRequestConfig=RunnerLogic.normalizeTokenRequestConfig({route:parts.route,clientIdField:byId('token-client-id-field').value,clientSecretField:byId('token-client-secret-field').value,credentialMode:byId('token-credential-mode').value});}byId('token-helper').open=!!entry.tokenRequest&&!isOAuth2;updateTokenButton();
byId('token-helper').open=!!entry.tokenRequest&&!isOAuth2;byId('oauth2-helper').open=isOAuth2;
if(isOAuth2){byId('oauth2-token-url').value=entry.oauthTokenUrl||((entry.baseUrl||'')+(entry.route||''));byId('oauth2-client-id').value=entry.oauthClientId||'';byId('oauth2-client-secret').value='';byId('oauth2-scope').value=entry.oauthScope||'';byId('oauth2-client-auth-method').value=entry.oauthClientAuthMethod==='client_secret_post'?'client_secret_post':'client_secret_basic';byId('oauth2-allow-insecure-http').checked=entry.allowInsecureHttp===true;}
updateOAuth2TokenButton();void renderOAuth2TokenStatus();clearWriteConfirmation();updateGuard();updateCopyButtons();renderBodyHighlight();updateJsonTools();
   renderPreRequestActions(entry.preRequestActions||[]);byId('pre-request-actions-enabled').checked=entry.preRequestActionsEnabled!==false;byId('pre-request-literal-consent').checked=entry.preRequestActionsLiteralConsent===true;updatePreRequestActionsUi();byId('capture-response-variable').checked=!!entry.captureResponseVariable;byId('response-variable-name').value=entry.responseVariableName||'token';byId('response-value-source').value=entry.responseValueSource==='text'?'text':'json';byId('response-json-path').value=entry.responseJsonPath||'access_token';byId('response-success-only').checked=entry.responseSuccessOnly!==false;byId('response-capture-target').value=entry.responseCaptureTarget==='vault'?'vault':'environment';byId('response-variable-result').hidden=true;updateResponseCaptureUi();setResponseTests(entry.responseTests||[]);setActiveResponseContract(entry.responseContract||null);
  activeSaved=null;byId('request-title').textContent='Histórico · '+(entry.route||'request');setEditorTab('params');
  if(notify)showToast('Requisição carregada',hasAuthCredentials(entry)?authTypeLabel(entry)+' recuperada; credenciais podem expirar.':'Params, headers e body recuperados. Credenciais foram omitidas ou precisam ser informadas.','info');
}
function tokenHistorySnapshot(request){
  const oauth=request.tokenFlow==='oauth2-client-credentials';
  return{baseUrl:request.baseUrl,environmentId:request.environmentId||'default',route:request.route,method:'POST',headers:request.headers,body:'',bodyMode:oauth?'urlencoded':'json',authType:oauth?'none':request.authType||'none',bearerToken:request.authType==='bearer'&&request.saveBearerToken?request.bearerToken:'',basicUsername:!oauth&&request.authType==='basic'&&request.saveBearerToken?request.basicUsername:'',basicPassword:!oauth&&request.authType==='basic'&&request.saveBearerToken?request.basicPassword:'',apiKeyName:request.authType==='apiKey'?request.apiKeyName:'',apiKeyLocation:request.apiKeyLocation==='query'?'query':'header',apiKeyValue:request.authType==='apiKey'&&request.saveBearerToken?request.apiKeyValue:'',authMode:oauth?'custom':'',authOmitted:hasAuthCredentials(request)&&!request.saveBearerToken,allowInsecureHttp:request.allowInsecureHttp===true,saveBearerToken:request.saveBearerToken===true,tokenRequest:true,tokenFlow:oauth?'oauth2-client-credentials':'',oauthTokenUrl:oauth?String(request.oauthTokenUrl||''):'',oauthClientId:oauth?String(request.oauthClientId||''):'',oauthScope:oauth?String(request.oauthScope||''):'',oauthClientAuthMethod:oauth?String(request.oauthClientAuthMethod||''):'',tokenCredentialMode:request.tokenCredentialMode==='query'?'query':'body',tokenClientId:'',tokenClientIdField:request.tokenClientIdField,tokenClientSecretField:request.tokenClientSecretField};
}function loadHistoryEntry(entry){openHistoryRequestInTab(entry);}
async function removeHistory(id){historyComparisonIds=historyComparisonIds.filter(item=>item!==String(id));try{await dbWrite('history',id,true);await renderHistory();showToast('Item removido','Requisição removida do histórico local.','info');}catch{showToast('Histórico indisponível','Não foi possível atualizar o histórico.','error');}}
async function clearHistory(){
  const count=Number(byId('history-count').textContent)||0;
  if(!count||!(await confirmWithDialog({eyebrow:'HISTÓRICO',title:'Limpar histórico?',description:'As '+count+' requisições salvas neste navegador serão removidas.',confirmLabel:'Limpar histórico',danger:true})))return;
  try{await dbWrite('history',null,'clear');historyComparisonIds=[];await renderHistory();showToast('Histórico limpo','Requisições removidas deste navegador.','success');}
  catch{showToast('Histórico indisponível','Não foi possível limpar o histórico.','error');}
}

function findCollection(id){return collections.find(x=>x.id===id);}
function findFolder(collection,id){if(!id)return collection;for(const folder of collection?.folders||[]){if(folder.id===id)return folder;const child=findFolder(folder,id);if(child)return child;}return null;}
function findSavedResponseExampleRequest(){
  if(!activeSaved)return null;
  const container=findFolder(findCollection(activeSaved.collectionId),activeSaved.folderId);
  return container?.requests?.find(request=>request.id===activeSaved.id)||null;
}
function findFolderObjects(node,id,path=[]){
  for(const folder of node?.folders||[]){const next=[...path,folder];if(folder.id===id)return next;const found=findFolderObjects(folder,id,next);if(found)return found;}
  return null;
}
function authScopeEntries(nodes){return(nodes||[]).filter(item=>item?.auth&&typeof item.auth==='object'&&!Array.isArray(item.auth)).map(item=>({id:String(item.id||''),name:String(item.name||''),auth:item.auth}));}
function authScopesForContainer(collectionId,folderId=''){
  const collection=findCollection(collectionId);if(!collection)return[];
  const folders=folderId?findFolderObjects(collection,folderId)||[]:[];
  return authScopeEntries([collection,...folders]);
}
function authScopesBeforeRunnerTarget(collection,folderId=''){
  if(!folderId)return[];
  const folders=findFolderObjects(collection,folderId)||[];
  return authScopeEntries([collection,...folders.slice(0,-1)]);
}
async function saveAuthDefault(){
  invalidateStructuredDiagnosticContext();
  const collection=findCollection(selectedContainer.collectionId),container=selectedContainer.folderId?findFolder(collection,selectedContainer.folderId):collection;
  if(!collection||!container){showToast('Selecione um destino','Escolha uma coleção ou pasta antes de salvar o padrão.','warning');return;}
  const fields=authFieldsFromForm(value=>value,true),saved=RunnerLogic.persistAuthFields({...fields,authMode:'custom'},byId('save-token-history').checked);
  if(saved.authOmitted){showToast('Credenciais não salvas','Marque “Salvar credenciais de Auth nas requests locais” para guardar este padrão.','warning');return;}
  if(saved.authType==='basic'&&(!saved.basicUsername||!saved.basicPassword)){showToast('Auth incompleta','Basic Auth precisa de usuário e senha antes de salvar.','warning');return;}
  if(saved.authType==='apiKey'&&(!saved.apiKeyName||!saved.apiKeyValue)){showToast('Auth incompleta','API Key precisa de nome e valor antes de salvar.','warning');return;}
  const previous=container.auth,auth={authType:saved.authType,bearerToken:saved.bearerToken,basicUsername:saved.basicUsername,basicPassword:saved.basicPassword,apiKeyName:saved.apiKeyName,apiKeyLocation:saved.apiKeyLocation,apiKeyValue:saved.apiKeyValue};container.auth=auth;
  try{
    await dbWrite('collections',collection);byId('auth-inheritance-mode').value='inherit';applyAuthFields({authMode:'inherit'});syncActiveWorkspaceTab(true);renderCollectionTree();
    showToast('Auth padrão salva','Esta coleção/pasta será usada pelas requests que herdarem Auth.','success');
  }catch(error){if(previous===undefined)delete container.auth;else container.auth=previous;showToast('Falha ao salvar Auth',error.message||'Não foi possível salvar o padrão nesta coleção/pasta.','error');}
}
function findParent(collection,id,parent=collection){for(const folder of parent?.folders||[]){if(folder.id===id)return parent;const found=findParent(collection,id,folder);if(found)return found;}return null;}
function selectContainer(collectionId,folderId=''){
  selectedContainer={collectionId,folderId};renderCollectionTree();
  if(authModeFromForm()==='inherit')applyAuthFields({authMode:'inherit'});else updateAuthTypeUi();
  syncActiveWorkspaceTab(true);
}
function findFolderPath(collection,id,path=[]){for(const folder of collection?.folders||[]){const next=[...path,folder.name];if(folder.id===id)return next;const found=findFolderPath(folder,id,next);if(found)return found;}return null;}
function runnerWriteCases(cases){return cases.filter(item=>!item.request.tokenRequest&&writeMethods.has(String(item.request.method||'GET').toUpperCase()));}
function preRequestActionsAffectRequestUrl(request){if(request?.preRequestActionsEnabled===false)return false;const references=new Set([...`${request?.baseUrl||''} ${request?.route||''}`.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map(match=>match[1].trim()));return RunnerLogic.normalizePreRequestActions(request?.preRequestActions).some(action=>references.has(action.name));}
function preRequestPreviewOverrides(request){if(request?.preRequestActionsEnabled===false)return{};const references=new Set([...`${request?.baseUrl||''} ${request?.route||''}`.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map(match=>match[1].trim()));return Object.fromEntries(RunnerLogic.normalizePreRequestActions(request?.preRequestActions).filter(action=>references.has(action.name)).map(action=>[action.name,`__VORTIX_PRE_REQUEST_${action.name}__`]));}
function previewRunnerDynamicBaseUrl(item){try{const request=item.request,preRequest=request.preRequestActionsEnabled===false?{variables:{}}:RunnerLogic.runPreRequestActions(request.preRequestActions,getEnvironment().variables||{},item.dataset||{},vaultResolutionInput()),resolved=RunnerLogic.resolveTemplateWithProvenance(request.baseUrl||'',getEnvironment().variables||{},item.dataset||{},vaultResolutionInput(),preRequest.variables);return{resolved:true,origin:RunnerLogic.remoteHttpOrigin(resolved.text)};}catch{return{resolved:false,origin:''};}}
async function confirmRunnerRemoteHttp(cases){
  const dynamicBaseUrlCases=cases.filter(item=>RunnerLogic.preRequestActionsAffectBaseUrl(item.request)),staticCases=cases.filter(item=>!dynamicBaseUrlCases.includes(item)),origins=new Set(RunnerLogic.remoteHttpOrigins(staticCases,getEnvironment().variables||{},vaultResolutionInput()).map(origin=>redactVaultValues(origin))),queryKeyCases=cases.filter(item=>item?.request?.authType==='apiKey'&&item.request.apiKeyLocation==='query');let unresolvedDynamicBaseUrls=0;
  for(const item of dynamicBaseUrlCases){const preview=previewRunnerDynamicBaseUrl(item);if(!preview.resolved){unresolvedDynamicBaseUrls++;continue;}if(preview.origin){if(item.request.allowInsecureHttp!==true)throw Error('HTTP remoto exige habilitação explícita na request.');origins.add(redactVaultValues(preview.origin));}}
  if(!origins.size&&!queryKeyCases.length&&!unresolvedDynamicBaseUrls)return true;
  const warnings=[];
  if(origins.size)warnings.push('Headers, bodies e credenciais podem ser observados na rede.');
  if(queryKeyCases.length)warnings.push('API Keys na query podem aparecer em logs e históricos do servidor.');
  if(dynamicBaseUrlCases.length)warnings.push('A URL base é resolvida pelas ações pré-request; UUIDs e timestamps são gerados novamente a cada execução, e uma resposta anterior pode alterar variáveis. A origem exibida é uma prévia e pode diferir do envio. HTTP remoto exige autorização na própria request.');
  if(unresolvedDynamicBaseUrls)warnings.push('Algumas URLs base dependem de variáveis ainda indisponíveis e serão validadas antes do envio.');
  const detail=[...origins,...(queryKeyCases.length?['API Key em query: '+queryKeyCases.length+' request(s)']:[]),...(dynamicBaseUrlCases.length?['URL base dinâmica: '+dynamicBaseUrlCases.length+' request(s)']:[])].join('\n');
  return confirmWithDialog({eyebrow:'TRANSPORTE E CREDENCIAIS',title:origins.size||dynamicBaseUrlCases.length?'Confirmar destinos do Runner?':'Executar Runner com API Key na query?',description:'Confira os destinos antes da execução.',detail,warning:warnings.join(' '),confirmLabel:'Executar Runner',danger:true});
}
function runnerPreviewDataset(){
  try{return RunnerLogic.parseDataSets(byId('runner-datasets')?.value||'')[0]||{};}catch{return{};}
}
function renderRunnerPlan(entries){
  const list=byId('runner-plan-list'),previewDataset=runnerPreviewDataset();
  list.replaceChildren();
  for(const entry of entries){
    const row=document.createElement('div');row.className='runner-plan-item';
    const badge=document.createElement('span');badge.className=`method-dot ${String(entry.request.method||'GET').toLowerCase()}`;badge.textContent=String(entry.request.method||'GET').toUpperCase();
    const copy=document.createElement('div');copy.className='runner-item-copy';
    const name=document.createElement('strong');name.textContent=entry.request.name||entry.request.route||'Request';copy.append(name);
    const path=document.createElement('small');path.textContent=entry.request.tokenRequest?'Credenciais exigem o fluxo Solicitar token.':entry.path;copy.append(path);
    const origins=inspectSavedRequestOrigins(entry.request,previewDataset,entry.authScopes);
    if(origins.length){const originNote=document.createElement('small');originNote.className='runner-origin-note';originNote.textContent='Origens sem valores: '+formatInspectorOrigins(origins);copy.append(originNote);}
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
function runnerHistoryDate(value){
  const time=Date.parse(String(value||''));
  return Number.isFinite(time)?new Date(time).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'Data indisponível';
}
function runnerHistoryOutcomeLabel(outcome){
  return outcome==='passed'?'concluída':outcome==='failed'?'falhou':outcome==='partial'?'parcial':'não executada';
}
function runnerHistoryNotice(text,warning=false){
  const item=document.createElement('li');item.className=warning?'runner-history-warning':'runner-history-empty';item.setAttribute('role','note');item.textContent=text;return item;
}
function renderRunnerHistory(entries,warning=''){
  const list=byId('runner-history-list');if(!list)return;
  const safe=RunnerLogic.sanitizeRunnerHistoryValue(Array.isArray(entries)?entries:[]);
  const visibleWarning=warning||RunnerLogic.runnerHistoryCompatibilityWarning(Boolean(navigator.locks?.request));
  list.replaceChildren();
  byId('runner-history-announcement').textContent=RunnerLogic.runnerHistoryAnnouncement(safe.length,visibleWarning);
  byId('runner-history-count').textContent=safe.length?`${safe.length} de ${RUNNER_HISTORY_LIMIT}`:'';
  byId('clear-runner-history').disabled=runnerBusy||runnerHistoryMutating||!safe.length;
  if(visibleWarning)list.append(runnerHistoryNotice(visibleWarning,true));
  if(!safe.length){if(!visibleWarning)list.append(runnerHistoryNotice('Nenhuma execução salva ainda.'));return;}
  for(const[historyIndex,entry]of safe.entries()){
    const item=document.createElement('li'),header=document.createElement('div'),meta=document.createElement('div');
    item.className='runner-history-item';header.className='runner-history-header';meta.className='runner-history-meta';
    const title=document.createElement('strong');title.textContent=runnerHistoryDate(entry.startedAt);
    const summary=document.createElement('small');summary.textContent=`${entry.passed} concluídas · ${entry.failed} falhas${entry.partial?` · ${entry.partial} parciais`:''} · ${entry.skipped} não executadas · ${entry.durationMs} ms${entry.stopped?' · rodada interrompida':''}`;
    meta.append(title,summary);
    const remove=document.createElement('button');remove.type='button';remove.className='runner-history-delete';remove.dataset.runnerHistoryDelete=entry.id;remove.textContent='Excluir';remove.disabled=runnerBusy||runnerHistoryMutating;remove.setAttribute('aria-label',`Excluir execução ${historyIndex+1}, de ${runnerHistoryDate(entry.startedAt)}, com ${entry.passed} concluídas, ${entry.failed} falhas e ${entry.partial||0} parciais`);
    header.append(meta,remove);
    const steps=document.createElement('ol');steps.className='runner-history-steps';steps.setAttribute('aria-label','Etapas da execução');
    const appendSteps=(target,stepEntries)=>{for(const step of stepEntries){
      const stepItem=document.createElement('li');stepItem.className='runner-history-step';stepItem.dataset.outcome=step.outcome;
      const tests=step.testsPassed||step.testsFailed||step.testsPartial?` · testes ${step.testsPassed}/${step.testsPassed+step.testsFailed}${step.testsPartial?` · ${step.testsPartial} parcial(is)`:''}`:'';
      const status=step.status==null?'':` · HTTP ${step.status}`;
      stepItem.textContent=`Etapa ${step.ordinal}: ${runnerHistoryOutcomeLabel(step.outcome)}${status} · ${step.durationMs} ms${tests}`;
      target.append(stepItem);
    }};
    appendSteps(steps,entry.steps.slice(0,60));
    if(entry.steps.length>60){
      const moreItem=document.createElement('li'),moreButton=document.createElement('button'),moreSteps=document.createElement('ol');
      moreButton.type='button';moreButton.className='runner-history-more';moreButton.setAttribute('aria-expanded','false');moreButton.textContent=`Mostrar ${entry.steps.length-60} etapas restantes`;
      moreSteps.className='runner-history-steps runner-history-steps--more';moreSteps.setAttribute('aria-label','Etapas adicionais da execução');moreSteps.hidden=true;appendSteps(moreSteps,entry.steps.slice(60));
      moreButton.onclick=()=>{const expanded=moreSteps.hidden;moreSteps.hidden=!expanded;moreButton.setAttribute('aria-expanded',String(expanded));moreButton.textContent=expanded?'Ocultar etapas adicionais':`Mostrar ${entry.steps.length-60} etapas restantes`;};
      moreItem.append(moreButton,moreSteps);steps.append(moreItem);
    }
    item.append(header,steps);list.append(item);
  }
}
async function loadRunnerHistory(){
  try{
    return await withRunnerHistoryMutation(async()=>{
      const record=await dbRead('settings','runnerHistory'),value=record?.value;
      if(value!=null&&!Array.isArray(value))throw Error('Formato de histórico desconhecido.');
      const normalized=RunnerLogic.sanitizeRunnerHistoryValue(Array.isArray(value)?value:[]);
      let needsNormalization=record!=null;
      try{if(record!=null)needsNormalization=JSON.stringify(record??null)!==JSON.stringify({key:'runnerHistory',value:normalized});}catch{}
      if(needsNormalization)await dbWrite('settings',{key:'runnerHistory',value:normalized});
      renderRunnerHistory(normalized);
      return true;
    });
  }catch{
    renderRunnerHistory([],'Histórico local indisponível. Verifique o armazenamento do workspace e tente reabrir o Runner.');
    showToast('Histórico do Runner indisponível','Não foi possível ler o histórico local. A execução continua disponível; verifique o armazenamento e tente novamente.','warning',10000);
    return false;
  }
}
async function withRunnerHistoryMutation(action){
  runnerHistoryMutating=true;updateRunnerOptionsDisabled(true);
  try{
    const run=()=>action();
    const lockTask=navigator.locks?.request('vortix-runner-history',{mode:'exclusive'},run);
    return await (lockTask??run());
  }finally{runnerHistoryMutating=false;updateRunnerOptionsDisabled(false);}
}
async function saveRunnerRunHistory(run){
  try{
    await runnerHistoryLoadTask;
    await withRunnerHistoryMutation(async()=>{
      const record=await dbRead('settings','runnerHistory'),existing=record?.value;
      if(existing!=null&&!Array.isArray(existing))throw Error('Formato de histórico desconhecido.');
      const snapshot=RunnerLogic.createRunnerHistorySnapshot(run),safeExisting=[];
      for(const entry of Array.isArray(existing)?existing:[]){try{safeExisting.push(RunnerLogic.createRunnerHistorySnapshot(entry));}catch{}}
      const retained=RunnerLogic.retainNewestRunnerHistoryEntries([snapshot,...safeExisting],RUNNER_HISTORY_LIMIT);
      await dbWrite('settings',{key:'runnerHistory',value:retained});
      renderRunnerHistory(retained);
    });
    return true;
  }catch{
    showToast('Histórico do Runner não salvo','A execução terminou, mas o histórico local não foi atualizado. Verifique o espaço e o armazenamento do workspace; depois tente novamente.','warning',12000);
    return false;
  }
}
async function removeRunnerHistoryEntry(id){
  if(runnerBusy||runnerHistoryMutating||!id)return;
  try{
    await withRunnerHistoryMutation(async()=>{
      const record=await dbRead('settings','runnerHistory'),existing=record?.value;
      if(existing!=null&&!Array.isArray(existing))throw Error('Formato de histórico desconhecido.');
      const next=RunnerLogic.sanitizeRunnerHistoryValue(Array.isArray(existing)?existing:[]).filter(entry=>entry.id!==String(id));
      await dbWrite('settings',{key:'runnerHistory',value:next});
      renderRunnerHistory(next);
    });
    showToast('Execução removida','O resumo foi removido do histórico local do Runner.','info');
  }catch{
    showToast('Histórico do Runner indisponível','Não foi possível remover a execução. Verifique o armazenamento do workspace e tente novamente.','warning',10000);
  }
}
async function clearRunnerHistory(){
  if(runnerBusy||runnerHistoryMutating)return;
  if(!(await confirmWithDialog({eyebrow:'HISTÓRICO DO RUNNER',title:'Limpar histórico de execuções?',description:'Todos os resumos de rodadas deste dispositivo serão removidos. Requests, coleções e variáveis capturadas não serão alteradas.',confirmLabel:'Limpar histórico',danger:true})))return;
  if(runnerBusy||runnerHistoryMutating)return;
  try{
    await withRunnerHistoryMutation(async()=>{
      await dbWrite('settings','runnerHistory',true);
      renderRunnerHistory([]);
    });
    showToast('Histórico do Runner limpo','Os resumos de execuções foram removidos deste dispositivo.','success');
  }catch{
    showToast('Histórico do Runner indisponível','Não foi possível limpar o histórico. Verifique o armazenamento do workspace e tente novamente.','warning',10000);
  }
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
  runnerEntries=RunnerLogic.flattenRequests(target,ancestors,0,selectedContainer.folderId,authScopesBeforeRunnerTarget(collection,selectedContainer.folderId));
  if(!runnerEntries.length){showToast('Sem requests','A seleção não contém requests salvas para executar.','info');return;}
  const targetPath=[collection.name,...(folderPath||[])].join(' / '),writes=runnerEntries.filter(entry=>!entry.request.tokenRequest&&writeMethods.has(String(entry.request.method||'GET').toUpperCase())).length;
  byId('runner-target-title').textContent=targetPath;byId('runner-plan-count').textContent=`${runnerEntries.length} requests · ${writes} ${writes===1?'gravação':'gravações'}`;
  byId('runner-write-guard').hidden=!writes;byId('runner-write-description').textContent=writes?`${writes===1?'1 chamada':`${writes} chamadas`} POST, PUT, PATCH ou DELETE podem alterar dados.`:'';
  byId('runner-confirm-writes').checked=false;byId('runner-write-phrase').value='';byId('runner-datasets').value='';byId('runner-delay').value='0';byId('runner-stop-on-error').checked=true;
  renderRunnerPlan(runnerEntries);byId('runner-results').replaceChildren();byId('runner-progress').hidden=true;byId('runner-progress').value=0;byId('runner-progress-label').textContent='';byId('runner-summary').hidden=true;byId('rerun-failed').hidden=true;byId('stop-runner').hidden=true;clearRunnerError();byId('start-runner').disabled=false;byId('runner-options').disabled=false;
  byId('runner-history-count').textContent='Carregando…';byId('clear-runner-history').disabled=true;byId('runner-history-list').replaceChildren();
  fitRunnerDialog();byId('runner-dialog').showModal();runnerHistoryLoadTask=loadRunnerHistory();
}
async function confirmRunnerWrites(cases){
  const writes=runnerWriteCases(cases);if(!writes.length)return true;
  if(!byId('runner-confirm-writes').checked||byId('runner-write-phrase').value.trim()!=='TESTE'){
    showRunnerError('Confirme que os dados são de teste e digite TESTE antes de executar gravações.');byId('runner-write-phrase').focus();return false;
  }
  const destinations=[];
  const generatedDestinations=writes.some(item=>preRequestActionsAffectRequestUrl(item.request));
  for(const item of writes.slice(0,12)){
    try{const request=RunnerLogic.prepareSavedRequest(item.request,getEnvironment().variables||{},item.dataset,true,item.authScopes,vaultResolutionInput(),preRequestPreviewOverrides(item.request));destinations.push(`${request.method} ${redactVaultValues(sanitizeBase(request.baseUrl).value)}${redactVaultValues(sanitizeRoute(request.route).value)}`);}
    catch{destinations.push(`${String(item.request.method).toUpperCase()} · ${item.path}`);}
  }
  if(writes.length>destinations.length)destinations.push(`… e mais ${writes.length-destinations.length} gravações`);
  return confirmWithDialog({eyebrow:'RUNNER DE TESTE',title:`Executar ${writes.length} gravações?`,description:`A sequência inclui ${writes.length} POST, PUT, PATCH ou DELETE.`,detail:destinations.join('\n'),warning:'A confirmação vale para todas as gravações desta execução. Confira ambiente, URLs e dados descartáveis.'+(generatedDestinations?' Valores de pré-request aparecem como placeholders e podem mudar na execução.':''),confirmLabel:'Executar gravações',danger:true});
}
function requestRunnerStop(){if(!runnerBusy)return;runnerStopRequested=true;byId('stop-runner').disabled=true;byId('stop-runner').textContent='Parando…';byId('runner-progress-label').textContent='A request atual terminará antes de parar.';}
function updateRunnerOptionsDisabled(disabled){const locked=disabled||runnerBusy||runnerHistoryMutating;byId('runner-options').disabled=locked;byId('start-runner').disabled=locked;byId('cancel-runner').disabled=locked;byId('close-runner').disabled=locked;byId('rerun-failed').disabled=locked;byId('runner-history-list').querySelectorAll('[data-runner-history-delete]').forEach(button=>{button.disabled=locked;});byId('clear-runner-history').disabled=locked||!byId('runner-history-list').querySelector('.runner-history-item');}
async function runRunnerCases(cases,options,allowWrites){
  const runCases=[...cases];runnerBusy=true;runnerStopRequested=false;runnerFailedCases=[];clearRunnerError();renderRunnerCases(runCases);
  const progress=byId('runner-progress');progress.hidden=false;progress.max=Math.max(1,runCases.length);progress.value=0;byId('runner-progress-label').textContent=`0 / ${runCases.length}`;byId('runner-summary').hidden=true;byId('rerun-failed').hidden=true;byId('stop-runner').hidden=false;byId('stop-runner').disabled=false;byId('stop-runner').textContent='Parar após esta request';updateRunnerOptionsDisabled(true);
  const started=performance.now(),startedAt=new Date().toISOString();let passed=0,failed=0,partial=0,skipped=0,processed=0,stoppedByFailure=false;
  const historySteps=[],skippedStep=ordinal=>({ordinal,outcome:'skipped',status:null,durationMs:0,tests:{passed:0,failed:0,partial:0}});
  for(let index=0;index<runCases.length;index++){
    const item=runCases[index];
    if(runnerStopRequested){for(let rest=index;rest<runCases.length;rest++){setRunnerCase(runCases[rest],'skipped','Parada solicitada');skipped++;historySteps.push(skippedStep(rest+1));}break;}
    byId('runner-progress-label').textContent=`${index+1} / ${runCases.length} · Conjunto ${item.datasetNumber}`;setRunnerCase(item,'running','Executando…');
    const requestStarted=performance.now();let caseFailed=false,caseWarning=false,caseStatus='Falha',caseDetail='',responseBody='',responseVaultSecrets={},stepStatus=null,stepTestsPassed=0,stepTestsFailed=0,stepTestsPartial=0;
    const origins=inspectSavedRequestOrigins(item.request,item.dataset||{},item.authScopes);
    try{
      const preRequestExecution=item.request.preRequestActionsEnabled===false?{variables:{},provenance:{},vaultSecrets:{}}:RunnerLogic.runPreRequestActions(item.request.preRequestActions,getEnvironment().variables||{},item.dataset||{},vaultResolutionInput());
      const request=RunnerLogic.prepareSavedRequest(item.request,getEnvironment().variables||{},item.dataset,allowWrites,item.authScopes,vaultResolutionInput(),preRequestExecution.variables);request.environmentId=activeEnvironmentId||'default';request.preRequestSecretValues=preRequestExecution.vaultSecrets;request.preRequestProvenance=preRequestExecution.provenance;request.resolutionProvenance={...request.resolutionProvenance,...preRequestExecution.provenance};
      responseVaultSecrets={...RunnerLogic.secretValuesUsedByProvenance(request.resolutionProvenance,secretVaultValues||{}),...preRequestExecution.vaultSecrets};
      if(RunnerLogic.remoteHttpOrigin(request.baseUrl)&&request.allowInsecureHttp!==true)throw Error('HTTP remoto exige habilitação explícita na request.');
      if(request.captureResponseVariable&&request.responseCaptureTarget==='vault')assertVaultCaptureAvailable(request);
      const requestBodyValidation=requestBodyContractTestResult(request),{proxyStatus,result}=await executeApiRequest(request),status=Number(result.status)||0,responseTests=responseResultsForRequest(request,result),tests=[...(requestBodyValidation?[requestBodyValidation]:[]),...responseTests],advisoryBodyFailure=Boolean(requestBodyValidation&&!requestBodyValidation.passed&&!requestBodyValidation.partial),failedTests=responseTests.filter(item=>!item.passed&&!item.partial),partialTests=tests.filter(item=>item.partial),hasTests=responseTests.some(item=>!item.partial);
      stepStatus=status||null;stepTestsFailed=tests.filter(item=>!item.passed&&!item.partial).length;stepTestsPassed=tests.filter(item=>item.passed).length;stepTestsPartial=partialTests.length;caseWarning=partialTests.length>0||advisoryBodyFailure;
      responseBody=runnerBodyPreview(RunnerLogic.redactSecretValues(result.body,responseVaultSecrets));caseStatus=status?RunnerLogic.redactSecretValues(`${status} ${result.reason||''}`,responseVaultSecrets).trim():`Proxy ${proxyStatus}`;
      const details=[];const httpFailed=!!result.error||proxyStatus>=400||status<200||status>=300&&!hasTests;
      if(origins.length)details.push('Origens sem valores: '+formatInspectorOrigins(origins)+'.');
      const vaultOrigins=Object.keys(request.resolutionProvenance||{}).filter(name=>request.resolutionProvenance[name]==='vault');if(vaultOrigins.length)details.push('Cofre usado para: '+vaultOrigins.join(', ')+'.');
      if(result.error||proxyStatus>=400)details.push(RunnerLogic.redactSecretValues(result.error,responseVaultSecrets)||`Servidor local respondeu HTTP ${proxyStatus}.`);
      else if(status<200||status>=300&&!hasTests)details.push('A request não retornou status 2xx.');
      if(advisoryBodyFailure)details.push(`Aviso não bloqueante: ${requestBodyValidation.label}. ${requestBodyValidation.message||''}`.trim());
      if(failedTests.length)details.push('Falharam: '+failedTests.map(item=>item.label).join('; '));
      if(partialTests.length)details.push('Validações parciais: '+partialTests.map(item=>item.message).filter(Boolean).join(' '));
      if(!failedTests.length&&!partialTests.length&&hasTests&&!advisoryBodyFailure)details.push(`${responseTests.length}/${responseTests.length} testes de resposta passaram.`);
      if(!result.error&&proxyStatus<400&&status>=200&&status<300){
        const captured=await captureResponseVariable(request,result,true);
        if(!captured.ok){caseFailed=true;details.push(RunnerLogic.redactSecretValues(captured.error,responseVaultSecrets)||'Falha ao salvar variável de resposta.');}
        else if(captured.captured)details.push(captured.target==='vault'?`{{${captured.name}}} salva no cofre do ambiente ${captured.environment}.`:`{{${captured.name}}} salva no ambiente ${captured.environment}.`);
      }
      caseFailed=caseFailed||httpFailed||failedTests.length>0;caseDetail=details.join(' ');
    }catch(error){caseFailed=true;caseStatus='Falha';caseDetail=[origins.length?'Origens sem valores: '+formatInspectorOrigins(origins)+'.':'',RunnerLogic.redactSecretValues(error.message,responseVaultSecrets)||'Não foi possível preparar ou enviar esta request.'].filter(Boolean).join(' ');}
    const caseDurationMs=Math.round(performance.now()-requestStarted);
    caseStatus+=` · ${caseDurationMs} ms`;
    processed++;progress.value=processed;
    if(caseFailed){failed++;runnerFailedCases.push(item);setRunnerCase(item,'failure',caseStatus,caseDetail,responseBody);}
    else if(caseWarning){partial++;setRunnerCase(item,'warning',caseStatus,caseDetail,responseBody);}
    else{passed++;setRunnerCase(item,'success',caseStatus,caseDetail,responseBody);}
    historySteps.push({ordinal:index+1,outcome:caseFailed?'failed':caseWarning?'partial':'passed',status:stepStatus,durationMs:caseDurationMs,tests:{passed:stepTestsPassed,failed:stepTestsFailed,partial:stepTestsPartial}});
    if(caseFailed&&options.stopOnError){stoppedByFailure=true;for(let rest=index+1;rest<runCases.length;rest++){setRunnerCase(runCases[rest],'skipped','Parada após falha');skipped++;historySteps.push(skippedStep(rest+1));}break;}
    if(options.delay>0&&index<runCases.length-1){byId('runner-progress-label').textContent=`${processed} / ${runCases.length} · aguardando ${options.delay} ms`;await new Promise(resolve=>setTimeout(resolve,options.delay));}
  }
  const durationMs=Math.round(performance.now()-started),elapsed=(durationMs/1000).toFixed(1),summary=`${passed} concluídas · ${failed} falhas · ${partial} parciais · ${skipped} não executadas · ${elapsed}s`+(stoppedByFailure?' · parada na primeira falha':'')+(runnerStopRequested?' · parada solicitada':'');
  byId('runner-progress-label').textContent=`${processed} / ${runCases.length}`;byId('runner-summary').textContent=summary;byId('runner-summary').hidden=false;byId('stop-runner').hidden=true;byId('stop-runner').disabled=false;byId('stop-runner').textContent='Parar após esta request';
  byId('rerun-failed').hidden=runnerFailedCases.length===0;
  showToast(failed?'Runner finalizado com falhas':partial?'Runner finalizado com avisos':'Runner finalizado',summary,failed||partial?'warning':'success');
  await saveRunnerRunHistory({id:newId(),startedAt,durationMs,total:runCases.length,passed,failed,partial,skipped,stopped:runnerStopRequested||stoppedByFailure,steps:historySteps});
  runnerBusy=false;updateRunnerOptionsDisabled(false);
}
async function startRunnerFromForm(event){
  event.preventDefault();if(runnerBusy||runnerHistoryMutating)return;clearRunnerError();
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
  if(runnerBusy||runnerHistoryMutating||!runnerFailedCases.length)return;const cases=[...runnerFailedCases],writes=runnerWriteCases(cases);
  try{if(writes.length&&!(await confirmRunnerWrites(cases)))return;if(!(await confirmRunnerRemoteHttp(cases)))return;await runRunnerCases(cases,{delay:Number(byId('runner-delay').value)||0,stopOnError:byId('runner-stop-on-error').checked},writes.length>0);}
  catch(error){showRunnerError(error.message||'Revise as opções do Runner.');}
}
function activeWorkspaceTab(){return workspaceTabs.find(tab=>tab.id===activeWorkspaceTabId)||null;}
function captureResponseTestDraft(){return[...byId('response-tests-list').querySelectorAll('.response-test-row')].map(row=>({id:row.dataset.testId,target:row.querySelector('.response-test-target').value,path:row.querySelector('.response-test-path').value,operator:row.querySelector('.response-test-operator').value,expected:row.querySelector('.response-test-expected').value}));}
function capturePreRequestActionsDraft(){return[...byId('pre-request-actions').querySelectorAll('.pre-request-action-row')].map(row=>({type:row.querySelector('[data-pre-request-type]').value,name:row.querySelector('[data-pre-request-name]').value,value:row.querySelector('[data-pre-request-value]').value}));}
function getPreRequestActionsFromForm(){const draft=capturePreRequestActionsDraft();if(!byId('pre-request-actions-enabled').checked){try{return RunnerLogic.normalizePreRequestActions(draft);}catch{return[];}}return RunnerLogic.normalizePreRequestActions(draft);}
function updatePreRequestActionsUi(){const list=byId('pre-request-actions'),hasActions=list.children.length>0,enabled=byId('pre-request-actions-enabled'),rows=[...list.children];byId('pre-request-actions-empty').hidden=hasActions;byId('add-pre-request-action').disabled=rows.length>=10;list.dataset.enabled=String(enabled.checked);rows.forEach((row,index)=>{row.querySelector('[data-pre-request-move="up"]').disabled=index===0;row.querySelector('[data-pre-request-move="down"]').disabled=index===rows.length-1;});updateAdvancedToolsIndicator();}
function createPreRequestActionRow(action={type:'uuid',name:'request_id'}){
  const normalized=RunnerLogic.normalizePreRequestActions([action])[0],row=document.createElement('div');row.className='pre-request-action-row';
  const type=document.createElement('select');type.dataset.preRequestType='';type.setAttribute('aria-label','Tipo de ação pré-request');for(const[value,label]of[['uuid','UUID'],['timestamp','Timestamp UTC'],['template','Template']]){const option=document.createElement('option');option.value=value;option.textContent=label;type.append(option);}type.value=normalized.type;
  const name=document.createElement('input');name.type='text';name.dataset.preRequestName='';name.value=normalized.name;name.autocomplete='off';name.spellcheck=false;name.placeholder='request_id';name.setAttribute('aria-label','Nome da variável temporária');
  const value=document.createElement('input');value.type=isSensitiveName(normalized.name)?'password':'text';value.dataset.preRequestValue='';value.value=normalized.value||'';value.autocomplete='off';value.spellcheck=false;value.placeholder='ex.: pedido-{{request_id}}';value.setAttribute('aria-label','Template da variável');
  const field=(labelText,input,cls='')=>{const wrap=document.createElement('label');wrap.className='pre-request-action-field'+(cls?' '+cls:'');const label=document.createElement('span');label.textContent=labelText;wrap.append(label,input);return wrap;};
  const order=document.createElement('div');order.className='pre-request-action-order';for(const[direction,label,text]of[['up','Mover ação para cima','↑'],['down','Mover ação para baixo','↓']]){const button=document.createElement('button');button.type='button';button.className='button secondary compact-button';button.dataset.preRequestMove=direction;button.textContent=text;button.setAttribute('aria-label',label);button.onclick=()=>{const rows=[...row.parentElement.children],index=rows.indexOf(row);if(direction==='up'&&index>0)row.parentElement.insertBefore(row,rows[index-1]);else if(direction==='down'&&index<rows.length-1)row.parentElement.insertBefore(rows[index+1],row);updatePreRequestActionsUi();syncActiveWorkspaceTab(true);};order.append(button);}
  const remove=document.createElement('button');remove.type='button';remove.className='button secondary pre-request-action-remove';remove.textContent='×';remove.setAttribute('aria-label','Remover ação pré-request');remove.onclick=()=>{row.remove();updatePreRequestActionsUi();};
  const update=()=>{fieldValue.hidden=type.value!=='template';name.type=isSensitiveName(name.value)?'password':'text';updatePreRequestActionsUi();};
  const fieldValue=field('Valor / template',value,'pre-request-action-template');type.onchange=update;name.oninput=update;row.append(field('Ação',type),field('Variável',name),fieldValue,order,remove);update();return row;
}
function renderPreRequestActions(actions){const list=byId('pre-request-actions'),normalized=RunnerLogic.normalizePreRequestActions(actions||[]);list.replaceChildren(...normalized.map(createPreRequestActionRow));updatePreRequestActionsUi();}
function addPreRequestAction(){const list=byId('pre-request-actions');if(list.children.length>=10){showToast('Limite de ações','Cada request aceita até 10 ações pré-request.','warning');return;}const row=createPreRequestActionRow();list.append(row);updatePreRequestActionsUi();row.querySelector('[data-pre-request-name]').focus();syncActiveWorkspaceTab(true);}
function captureWorkspaceDraft(){
  return{title:byId('request-title').textContent||'Nova requisição',method:method.value,baseUrl:byId('base-url').value,baseUrlAuto,allowInsecureHttp:byId('allow-insecure-http').checked,route:route.value,params:[...queryParams.children].map(row=>[row.querySelector('[data-query-name]').value,row.querySelector('[data-query-value]').value]),headers:byId('headers').value,body:byId('body-mode').value==='graphql'?'':body.value,bodyMode:byId('body-mode').value,multipartFields:getPersistableMultipartFields(true).fields,...normalizePersistableGraphqlFields(getGraphqlFieldsFromForm()),authMode:authModeFromForm(),...authFieldsFromForm(value=>value,true),saveBearerToken:byId('save-token-history').checked,tokenClientId:byId('token-client-id').value,tokenCredentialMode:byId('token-credential-mode').value,tokenHelperOpen:byId('token-helper').open,preRequestActions:capturePreRequestActionsDraft(),preRequestActionsEnabled:byId('pre-request-actions-enabled').checked,preRequestActionsLiteralConsent:byId('pre-request-literal-consent').checked,captureResponseVariable:byId('capture-response-variable').checked,responseVariableName:byId('response-variable-name').value,responseValueSource:byId('response-value-source').value,responseJsonPath:byId('response-json-path').value,responseSuccessOnly:byId('response-success-only').checked,responseCaptureTarget:byId('response-capture-target').value==='vault'?'vault':'environment',responseTests:captureResponseTestDraft(),responseContract:activeResponseContract,activeSaved:activeSaved?{...activeSaved}:null,collectionId:selectedContainer.collectionId,folderId:selectedContainer.folderId,editorSection:document.querySelector('[data-editor-tab][aria-selected="true"]')?.dataset.editorTab||'params'};
}
function restoreResponseTestDraft(tests){
  const list=byId('response-tests-list');list.replaceChildren();
  for(const source of(Array.isArray(tests)?tests:[]).slice(0,20)){
    const target=source?.target==='status'?'status':'json',fallback=target==='status'?{id:String(source.id||newId()),target,operator:'equals',expected:'200'}:{id:String(source?.id||newId()),target,path:'data.id',operator:'exists',expected:''},row=createResponseTestRow(fallback);
    const targetField=row.querySelector('.response-test-target');targetField.value=target;updateResponseTestRow(row,true);
    row.querySelector('.response-test-path').value=String(source?.path??'');row.querySelector('.response-test-expected').value=String(source?.expected??'');
    const operator=row.querySelector('.response-test-operator');operator.value=String(source?.operator||'');row.dataset.operator=operator.value;updateResponseTestRow(row,false);list.append(row);
  }
  renderResponseTestResults([]);updateAdvancedToolsIndicator();
}
function renderWorkspaceTabs(){
  const list=byId('workspace-tabs');if(!list)return;list.replaceChildren();
  for(const [index,tab] of workspaceTabs.entries()){
    const item=document.createElement('div');item.className='workspace-tab-item';item.setAttribute('role','presentation');
    const select=document.createElement('button');select.id='workspace-tab-'+index;select.className='workspace-tab';select.type='button';select.setAttribute('role','tab');select.setAttribute('aria-selected',String(tab.id===activeWorkspaceTabId));select.setAttribute('aria-controls','request-workspace-panel');select.tabIndex=tab.id===activeWorkspaceTabId?0:-1;select.dataset.workspaceTabId=tab.id;select.title=tab.title;select.onclick=()=>void activateWorkspaceTab(tab.id);
    const methodName=String(tab.request?.method||tab.rawDraft?.method||'GET').toUpperCase(),methodClass=['get','post','put','patch','delete'].includes(methodName.toLowerCase())?` ${methodName.toLowerCase()}`:'';
    const badge=document.createElement('span');badge.className='workspace-tab-method'+methodClass;badge.textContent=methodName;
    const name=document.createElement('span');name.className='workspace-tab-name';name.textContent=tab.title||'Nova requisição';select.append(badge,name);
    if(tab.dirty){const dirty=document.createElement('span');dirty.className='workspace-tab-dirty';dirty.setAttribute('aria-hidden','true');select.append(dirty);select.setAttribute('aria-label',`${tab.title||'Nova requisição'} com alterações não salvas`);}
    item.append(select);
    const close=document.createElement('button');close.className='workspace-tab-close';close.type='button';close.dataset.closeWorkspaceTab=tab.id;close.setAttribute('aria-label','Fechar '+(tab.title||'Nova requisição'));close.title='Fechar aba';close.innerHTML='<svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m4 4 8 8M12 4l-8 8"></path></svg>';close.onclick=event=>{event.stopPropagation();void closeWorkspaceTab(tab.id);};item.append(close);list.append(item);
  }
  const active=list.querySelector('[role="tab"][aria-selected="true"]'),panel=byId('request-workspace-panel');if(active)panel.setAttribute('aria-labelledby',active.id);else panel.removeAttribute('aria-labelledby');
}
function persistableWorkspaceTabs(){return RunnerLogic.normalizeWorkspaceTabs({activeId:activeWorkspaceTabId,tabs:workspaceTabs.map(({id,title,request,activeSaved,collectionId,folderId,editorSection,saveBearerToken,dirty})=>({id,title,request,activeSaved,collectionId,folderId,editorSection,saveBearerToken,dirty}))});}
async function persistWorkspaceTabsNow(){
  try{await dbWrite('settings',{key:WORKSPACE_TABS_KEY,value:persistableWorkspaceTabs()});workspaceTabsStorageWarning=false;}
  catch(error){if(!workspaceTabsStorageWarning){showToast('Abas não salvas',error.message||'O banco local não conseguiu persistir as abas abertas.','warning');workspaceTabsStorageWarning=true;}}
}
function scheduleWorkspaceTabsPersist(){clearTimeout(workspaceTabsSaveTimer);workspaceTabsSaveTimer=setTimeout(()=>void persistWorkspaceTabsNow(),250);}
function syncActiveWorkspaceTab(markDirty=false){
  if(workspaceTabsLoading)return activeWorkspaceTab();
  if(markDirty)invalidateStructuredDiagnosticContext();
  const tab=activeWorkspaceTab();if(!tab)return null;const draft=captureWorkspaceDraft();tab.rawDraft=draft;tab.title=draft.title||tab.title;tab.activeSaved=draft.activeSaved;tab.collectionId=draft.collectionId;tab.folderId=draft.folderId;tab.editorSection=draft.editorSection;tab.saveBearerToken=draft.saveBearerToken;
  if(markDirty)tab.dirty=true;
  try{tab.request=getSnapshot();}catch{}
  renderWorkspaceTabs();scheduleWorkspaceTabsPersist();return tab;
}
function clearWorkspaceResponse(){clearCurrentResponseExample();showResponse('Aguardando','idle','','');byId('response-variable-result').hidden=true;renderResponseTestResults([]);}
function applyWorkspaceDraft(draft){
  method.value=['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(draft.method)?draft.method:'GET';byId('base-url').value=draft.baseUrl||'';baseUrlAuto=!!draft.baseUrlAuto;byId('allow-insecure-http').checked=draft.allowInsecureHttp===true;route.value=String(draft.route??'');renderQueryParams(Array.isArray(draft.params)?draft.params:[]);ensureQueryParamRow();byId('headers').value=draft.headers||'';body.value=draft.body||'';applyBodyMode(draft.bodyMode);renderMultipartFields(draft.multipartFields||[]);renderGraphqlFields(draft);selectedContainer={collectionId:draft.collectionId||'',folderId:draft.folderId||''};byId('save-token-history').checked=draft.saveBearerToken!==false;applyAuthFields(draft);byId('token-client-id').value=draft.tokenClientId||'';byId('token-client-secret').value='';byId('token-helper').open=!!draft.tokenHelperOpen;
  renderPreRequestActions(draft.preRequestActions||[]);byId('pre-request-actions-enabled').checked=draft.preRequestActionsEnabled!==false;byId('pre-request-literal-consent').checked=draft.preRequestActionsLiteralConsent===true;updatePreRequestActionsUi();byId('capture-response-variable').checked=!!draft.captureResponseVariable;byId('response-variable-name').value=draft.responseVariableName||'token';byId('response-value-source').value=draft.responseValueSource==='text'?'text':'json';byId('response-json-path').value=draft.responseJsonPath||'access_token';byId('response-success-only').checked=draft.responseSuccessOnly!==false;byId('response-capture-target').value=draft.responseCaptureTarget==='vault'?'vault':'environment';byId('response-variable-result').hidden=true;restoreResponseTestDraft(draft.responseTests);
  setActiveResponseContract(draft.responseContract||null);clearCurrentResponseExample();activeSaved=draft.activeSaved||null;byId('request-title').textContent=draft.title||'Nova requisição';clearWriteConfirmation();updateGuard();updateTokenButton();updateCopyButtons();updateResponseCaptureUi();renderBodyHighlight();updateJsonTools();renderCollectionTree();setEditorTab(draft.editorSection||'params');
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
}
function activateWorkspaceTab(id){
  if(id!==activeWorkspaceTabId)invalidateStructuredDiagnosticContext(false);
  const target=workspaceTabs.find(tab=>tab.id===id);if(!target||id===activeWorkspaceTabId)return;const keepFocus=byId('workspace-tabs').contains(document.activeElement);syncActiveWorkspaceTab();activeWorkspaceTabId=id;applyWorkspaceTab(target);clearWorkspaceResponse();renderWorkspaceTabs();scheduleWorkspaceTabsPersist();
  if(keepFocus){const selected=[...byId('workspace-tabs').querySelectorAll('[role="tab"]')].find(tab=>tab.dataset.workspaceTabId===id);selected?.focus();}
}
function createWorkspaceTabFromCurrent(title){
  invalidateStructuredDiagnosticContext(false);
  byId('request-title').textContent=title||'Nova requisição';const draft=captureWorkspaceDraft();let request;
  try{request=getSnapshot();}catch(error){showToast('Revise a requisição',error.message||'Corrija os campos antes de abrir a aba.','error');return null;}
  const tab={id:newId(),title:draft.title,request,activeSaved:draft.activeSaved,collectionId:draft.collectionId,folderId:draft.folderId,editorSection:draft.editorSection,saveBearerToken:draft.saveBearerToken,dirty:false,rawDraft:draft};workspaceTabs.push(tab);activeWorkspaceTabId=tab.id;clearWorkspaceResponse();renderWorkspaceTabs();scheduleWorkspaceTabsPersist();return tab;
}
function nextWorkspaceDraftTitle(){let index=1,title='Nova requisição';while(workspaceTabs.some(tab=>tab.title===title)){index++;title=`Nova requisição ${index}`;}return title;}
function resetEditorForNewWorkspaceTab(title){
  method.value='GET';byId('base-url').value=Object.hasOwn(getEnvironment().variables||{},'baseUrl')?'{{baseUrl}}':'';baseUrlAuto=true;route.value='';byId('allow-insecure-http').checked=false;byId('headers').value='Accept: application/json';body.value='';applyBodyMode('json');byId('save-token-history').checked=true;selectedContainer={collectionId:collections[0]?.id||'',folderId:''};applyAuthFields({authMode:'inherit'});
  byId('token-client-id').value='';byId('token-client-secret').value='';byId('token-helper').open=false;renderPreRequestActions([]);byId('pre-request-actions-enabled').checked=true;byId('pre-request-literal-consent').checked=false;byId('capture-response-variable').checked=false;byId('response-variable-name').value='token';byId('response-value-source').value='json';byId('response-json-path').value='access_token';byId('response-success-only').checked=true;setResponseTests([]);setActiveResponseContract(null);updateResponseCaptureUi();
  activeSaved=null;byId('request-title').textContent=title;renderQueryParams([]);ensureQueryParamRow();clearWriteConfirmation();updateGuard();renderBodyHighlight();updateJsonTools();setEditorTab('params');
}
function createNewWorkspaceTab(notify=true){
  invalidateStructuredDiagnosticContext(false);
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
  if(id===activeWorkspaceTabId)invalidateStructuredDiagnosticContext(false);
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
}
function makeContainerRow(item,collectionId,folderId,kind,count){
  const row=document.createElement('div');row.className=kind==='collection'?'collection-row':'folder-row';
  const expand=document.createElement('button');expand.className='tree-tool tree-expand';expand.type='button';expand.textContent=collapsed.has(item.id)?'›':'⌄';expand.setAttribute('aria-label',collapsed.has(item.id)?'Expandir':'Recolher');
  expand.onclick=()=>{collapsed.has(item.id)?collapsed.delete(item.id):collapsed.add(item.id);renderCollectionTree();};
  const select=document.createElement('button');select.className='tree-select'+(selectedContainer.collectionId===collectionId&&selectedContainer.folderId===folderId?' selected':'');select.type='button';select.title=item.name;
  const icon=document.createElement('span');icon.className='tree-icon';icon.append(createSidebarIcon(kind==='collection'?'collection':'folder'));
  const name=document.createElement('span');name.className='tree-name';name.textContent=item.name;select.append(icon,name);
  if(count){const badge=document.createElement('span');badge.className='tree-count';badge.textContent=String(count);select.append(badge);}
  select.onclick=()=>selectContainer(collectionId,folderId);
  const add=document.createElement('button');add.className='tree-tool';add.type='button';add.append(createSidebarIcon('plus'));add.title='Criar subpasta';add.setAttribute('aria-label','Criar subpasta em '+item.name);add.onclick=()=>addFolder(collectionId,folderId);
  const menu=document.createElement('button');menu.className='tree-tool';menu.type='button';menu.append(createSidebarIcon('more'));menu.title='Opções de '+item.name;menu.setAttribute('aria-label','Mais opções para '+item.name);menu.onclick=()=>manageNode(collectionId,folderId,kind);
  row.append(expand,select,add,menu);return row;
}
function createSidebarIcon(name){
  const namespace='http://www.w3.org/2000/svg',svg=document.createElementNS(namespace,'svg');svg.setAttribute('aria-hidden','true');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.7');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');
  const paths={collection:['M4 5.5h16v13H4z','M8 9h8','M8 12h8','M8 15h5'],folder:['M3.5 6.5h6l2 2h9v10h-17z','M3.5 9h17'],plus:['M12 5v14','M5 12h14'],more:['M5 12h.01','M12 12h.01','M19 12h.01']};
  for(const d of paths[name]||[]){const path=document.createElementNS(namespace,'path');path.setAttribute('d',d);svg.append(path);}return svg;
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
function quickOpenFiltersFromForm() {
  const scope = byId('quick-open-scope-filter').value;
  const separator = scope.indexOf('|');
  return {
    method: byId('quick-open-method-filter').value,
    status: byId('quick-open-status-filter').value,
    collectionId: separator < 0 ? scope : scope.slice(0, separator),
    folderId: separator < 0 ? '' : scope.slice(separator + 1)
  };
}
function quickOpenFiltersActive(filters) {
  return !!(filters.method || filters.status || filters.collectionId || filters.folderId);
}
function populateQuickOpenFilters() {
  const statusSelect = byId('quick-open-status-filter'), scopeSelect = byId('quick-open-scope-filter');
  statusSelect.replaceChildren();
  const allStatuses = document.createElement('option'); allStatuses.value = ''; allStatuses.textContent = 'Todos os status'; statusSelect.append(allStatuses);
  const statuses = new Set();
  for (const collection of collections) for (const { request } of RunnerLogic.flattenRequests(collection))
    for (const example of Array.isArray(request.responseExamples) ? request.responseExamples : []) {
      const status = Number(example?.status); if (Number.isInteger(status) && status >= 100 && status <= 599) statuses.add(status);
    }
  for (const status of [...statuses].sort((a,b) => a-b)) { const option=document.createElement('option'); option.value=String(status); option.textContent=String(status); statusSelect.append(option); }
  scopeSelect.replaceChildren();
  const allScopes = document.createElement('option'); allScopes.value = ''; allScopes.textContent = 'Todas as coleções e pastas'; scopeSelect.append(allScopes);
  for (const item of flattenContainers()) { const option=document.createElement('option'); option.value=`${item.collectionId}|${item.folderId}`; option.textContent=item.label; scopeSelect.append(option); }
}
function renderQuickOpenResults() {
  const input = byId('quick-open-query'), list = byId('quick-open-results'), query = input.value.trim();
  const filters = quickOpenFiltersFromForm(), filtering = quickOpenFiltersActive(filters);
  list.replaceChildren();quickOpenEntries = RunnerLogic.searchRequests(collections, query, 30, filters);quickOpenActiveIndex = 0;
  input.setAttribute('aria-expanded', String(quickOpenEntries.length > 0));input.removeAttribute('aria-activedescendant');
  if (!quickOpenEntries.length) {
    const empty = document.createElement('p');empty.className = 'quick-open-empty';empty.setAttribute('role', 'status');
    empty.textContent = !query && !filtering ? 'Digite para buscar ou escolha um filtro.' : 'Nenhuma requisição corresponde à busca e aos filtros.';list.append(empty);return;
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
  byId('quick-open-query').value = '';byId('quick-open-method-filter').value='';populateQuickOpenFilters();renderQuickOpenResults();dialog.showModal();byId('quick-open-query').focus();
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
}
function renderCollectionTree(){
  const tree=byId('collections-tree');tree.replaceChildren();byId('collections-empty').hidden=collections.length>0;
  for(const collection of collections){const node=document.createElement('div');node.className='collection-node';node.append(makeContainerRow(collection,collection.id,'','collection',(collection.requests?.length||0)+(collection.folders?.length||0)));
    if(!collapsed.has(collection.id)){const children=document.createElement('div');children.className='tree-children';for(const request of collection.requests||[])appendSavedRequest(children,request,collection.id,'');for(const folder of collection.folders||[])children.append(renderFolder(folder,collection.id));node.append(children);}tree.append(node);}
  updateResponseExamplesUi();
}
async function persistCollections(){for(const item of collections)await dbWrite('collections',item);renderCollectionTree();}
async function addCollection(){
  const name=await promptWithDialog({eyebrow:'COLEÇÕES',title:'Nova coleção',description:'Organize requisições relacionadas em uma coleção.',inputLabel:'Nome da coleção',placeholder:'Ex.: API de grupos',confirmLabel:'Criar coleção'});
  if(!name?.trim())return;
  const item={id:newId(),name:name.trim(),folders:[],requests:[]},previousSelection={...selectedContainer};collections.push(item);
  try{await dbWrite('collections',item);selectedContainer={collectionId:item.id,folderId:''};renderCollectionTree();showToast('Coleção criada','“'+item.name+'” está pronta para organizar requests.','success');}
  catch(error){collections=collections.filter(x=>x.id!==item.id);selectedContainer=previousSelection;showToast('Falha ao salvar',error.message||'Não foi possível criar a coleção local.','error');}
}
async function addFolder(collectionId,parentId=''){
  const name=await promptWithDialog({eyebrow:'PASTAS',title:'Nova pasta',description:'Crie uma pasta ou subpasta para organizar as requisições.',inputLabel:'Nome da pasta',placeholder:'Ex.: Consultas',confirmLabel:'Criar pasta'});
  if(!name?.trim())return;
  const collection=findCollection(collectionId),parent=findFolder(collection,parentId);if(!collection||!parent)return;
  const folder={id:newId(),name:name.trim(),folders:[],requests:[]};parent.folders||=[];parent.folders.push(folder);collapsed.delete(parent.id);selectedContainer={collectionId,folderId:folder.id};
  try{await persistCollections();showToast('Pasta criada','Pasta “'+folder.name+'” adicionada.','success');}
  catch(error){parent.folders=parent.folders.filter(x=>x.id!==folder.id);showToast('Falha ao salvar',error.message||'Não foi possível criar a pasta.','error');}
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
    catch(error){showToast('Falha ao salvar',error.message||'Não foi possível renomear.','error');}
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
  invalidateStructuredDiagnosticContext();
  if(!(await confirmWithDialog({eyebrow:'EXCLUSÃO',title:'Excluir requisição?',description:'A requisição salva será removida da coleção.',confirmLabel:'Excluir requisição',danger:true})))return;
  const container=findFolder(findCollection(collectionId),folderId);if(!container)return;
  container.requests=(container.requests||[]).filter(x=>x.id!==id);
  try{await persistCollections();if(activeSaved?.id===id){activeSaved=null;clearCurrentResponseExample();updateCopyButtons();}showToast('Requisição excluída','Item removido da coleção.','info');}
  catch(error){showToast('Falha ao excluir',error.message||'Não foi possível atualizar a coleção.','error');}
}
function exportAuthConfig(source,includeCredentials=true,preserveMode=false){
  const auth=RunnerLogic.persistAuthFields({...source,authMode:preserveMode?source.authMode:'custom'},includeCredentials);delete auth.authOmitted;if(!preserveMode)delete auth.authMode;return auth;
}
function exportPreRequestActions(request,allowLiteralTemplates){const safe=RunnerLogic.persistablePreRequestActions(request?.preRequestActions,allowLiteralTemplates===true);return{actions:safe.actions,enabled:request?.preRequestActionsEnabled!==false&&safe.actions.length>0,literalConsent:allowLiteralTemplates===true,redacted:safe.redacted};}
function collectionHasAuthCredentials(node,depth=0){
  return depth<=20&&(hasAuthCredentials(node.auth)||(node.requests||[]).some(request=>hasAuthCredentials(request)||RunnerLogic.normalizePreRequestActions(request.preRequestActions).some(RunnerLogic.preRequestActionHasLiteralText))||(node.folders||[]).some(folder=>collectionHasAuthCredentials(folder,depth+1)));
}
function collectionHasResponseAutomation(node,depth=0){return depth<=20&&((node.requests||[]).some(request=>!!request.captureResponseVariable||!!request.responseTests?.length||(request.preRequestActionsEnabled!==false&&!!request.preRequestActions?.length))||(node.folders||[]).some(folder=>collectionHasResponseAutomation(folder,depth+1)));}
function collectionHasResponseExamples(node,depth=0){return depth<=20&&((node.requests||[]).some(request=>Array.isArray(request.responseExamples)&&request.responseExamples.length>0)||(node.folders||[]).some(folder=>collectionHasResponseExamples(folder,depth+1)));}
function collectionHasResponseCaptureConfig(node,depth=0){return depth<=20&&((node.requests||[]).some(request=>!!request.captureResponseVariable||Object.hasOwn(request,'responseJsonPath')||Object.hasOwn(request,'responseValueSource')||!!request.responseTests?.length||!!request.preRequestActions?.length)||(node.folders||[]).some(folder=>collectionHasResponseCaptureConfig(folder,depth+1)));}
function environmentHasAuthCredentials(variables){return Object.entries(variables||{}).some(([key,value])=>isSensitiveName(key)&&value!=='');}
function environmentHasExportableSensitiveCredentials(variables){return Object.entries(variables||{}).some(([key,value])=>{const normalized=key.toLowerCase().replace(/[^a-z0-9]/g,'');return value!==''&&isSensitiveName(key)&&!normalized.includes('cookie')&&!normalized.includes('privatekey');});}
function exportEnvironmentVariables(variables,includeBearer){
  return RunnerLogic.exportEnvironmentVariables(variables,includeBearer);
}
function exportCollectionNode(node,includeBearer,depth=0){
  if(depth>20)throw Error('A coleção tem mais de 20 níveis de pastas.');
  return{
    id:node.id,name:String(node.name||'Coleção').slice(0,100),
    ...(node.auth?{auth:exportAuthConfig(node.auth,includeBearer)}:{}),
    requests:(node.requests||[]).map(request=>{
      const base=sanitizeBase(String(request.baseUrl||'')),route=sanitizeRoute(String(request.route||'')),headers=sanitizeHeaders(String(request.headers||'')),payload=sanitizeBody(String(request.body||'')),multipart=normalizePersistableMultipartFields(request.multipartFields,true),graphql=normalizePersistableGraphqlFields(request),preRequest=exportPreRequestActions(request,includeBearer),responseContract=RunnerLogic.sanitizeOpenApiResponseContract(request.responseContract);
      return{id:request.id,name:String(request.name||'Request').slice(0,100),method:['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(request.method)?request.method:'GET',
        baseUrl:base.value,route:route.value,headers:bodyModeHeaders(headers.value,request.bodyMode),body:payload.value,bodyMode:normalizeBodyMode(request.bodyMode),multipartFields:multipart.fields,graphqlQuery:graphql.graphqlQuery,graphqlVariables:graphql.graphqlVariables,graphqlOperationName:graphql.graphqlOperationName,...exportAuthConfig(request,includeBearer,true),
        allowInsecureHttp:request.allowInsecureHttp===true,tokenRequest:!!request.tokenRequest,tokenClientId:String(request.tokenClientId||''),tokenCredentialMode:request.tokenCredentialMode==='query'?'query':'body',
         preRequestActions:preRequest.actions,preRequestActionsEnabled:preRequest.enabled,preRequestActionsLiteralConsent:preRequest.literalConsent,
         captureResponseVariable:!!request.captureResponseVariable,responseVariableName:String(request.responseVariableName||'token'),responseValueSource:request.responseValueSource==='text'?'text':'json',responseJsonPath:String(request.responseJsonPath||'access_token'),responseSuccessOnly:request.responseSuccessOnly!==false,responseCaptureTarget:request.responseCaptureTarget==='vault'?'vault':'environment',responseTests:RunnerLogic.normalizeResponseTests(request.responseTests),responseExamples:RunnerLogic.normalizeResponseExamples(request.responseExamples),
         ...(responseContract?{responseContract}:{})};
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
function bodyModeHeaders(headers,bodyMode){
  const value=String(headers||'');
  if(!['multipart','graphql'].includes(normalizeBodyMode(bodyMode)))return value;
  return value.split('\\n').filter(line=>!/^content-type\\s*:/i.test(line)).join('\\n');
}
function appendExportQueryParameter(url,name,value){
  const separator=url.includes('?')?'&':'?';return url+separator+encodeParam(name)+'='+encodeParam(value);
}
function insomniaAuthDefinition(source,includeCredentials=true){
  const auth=RunnerLogic.persistAuthFields({...source,authMode:'custom'},includeCredentials);
  if(auth.authType==='bearer')return{type:'bearer',token:auth.bearerToken};
  if(auth.authType==='basic')return{type:'basic',username:auth.basicUsername,password:auth.basicPassword};
  if(auth.authType==='apiKey')return{type:'apikey',key:auth.apiKeyName,value:auth.apiKeyValue,addTo:auth.apiKeyLocation};
  return{type:'none'};
}
function postmanAuthDefinition(source,includeCredentials=true){
  const auth=RunnerLogic.persistAuthFields({...source,authMode:'custom'},includeCredentials);
  if(auth.authType==='bearer')return{type:'bearer',bearer:[{key:'token',value:auth.bearerToken,type:'string'}]};
  if(auth.authType==='basic')return{type:'basic',basic:[{key:'username',value:auth.basicUsername,type:'string'},{key:'password',value:auth.basicPassword,type:'string'}]};
  if(auth.authType==='apiKey')return{type:'apikey',apikey:[{key:'key',value:auth.apiKeyName,type:'string'},{key:'value',value:auth.apiKeyValue,type:'string'},{key:'in',value:auth.apiKeyLocation,type:'string'}]};
  return{type:'noauth'};
}
function buildInsomniaExport(collection,environment,includeBearer){
  const workspace={_id:'__WORKSPACE_ID__',_type:'workspace',name:collection.name,description:'',scope:'collection'};
  const resources=[workspace,{_id:'__BASE_ENVIRONMENT_ID__',_type:'environment',parentId:'__WORKSPACE_ID__',name:environment.name||'Base Environment',data:exportEnvironmentVariables(environment.variables,includeBearer)}];
  let requestNumber=0,folderNumber=0,responseNumber=0,rootParent='__WORKSPACE_ID__';
  if(collection.auth){const id='__request_group_'+(++folderNumber)+'__',group={_id:id,_type:'request_group',parentId:rootParent,name:'Auth padrão',description:'Auth padrão da coleção Vortix',environment:{},authentication:insomniaAuthDefinition(collection.auth,includeBearer)};resources.push(group);rootParent=id;}
  const addNode=(node,parentId)=>{
    for(const folder of node.folders||[]){const id='__request_group_'+(++folderNumber)+'__',group={_id:id,_type:'request_group',parentId,name:folder.name,description:'',environment:{}};if(folder.auth)group.authentication=insomniaAuthDefinition(folder.auth,includeBearer);resources.push(group);addNode(folder,id);}
    for(const request of node.requests||[]){
      const bodyMode=normalizeBodyMode(request.bodyMode),headers=exportHeaderList(request).filter(header=>!['multipart','graphql'].includes(bodyMode)||header.key.toLowerCase()!=='content-type'),authMode=RunnerLogic.persistAuthFields(request,true).authMode;
      const authentication=authMode==='inherit'?{}:insomniaAuthDefinition(request,includeBearer),url=exportRequestUrl(request),multipartFields=normalizePersistableMultipartFields(request.multipartFields,true).fields,graphql=normalizePersistableGraphqlFields(request);
      const body=bodyMode==='multipart'?{mimeType:'multipart/form-data',params:multipartFields.map(field=>field.type==='file'?{name:field.name,type:'file',value:field.fileName}:{name:field.name,type:'text',value:field.value})}:bodyMode==='graphql'?RunnerLogic.buildInsomniaGraphqlBody(graphql):{mimeType:bodyModeContentType(bodyMode),text:sanitizeBody(String(request.body||'')).value};
      const requestId='__request_'+(++requestNumber)+'__',resource={_id:requestId,_type:'request',parentId,name:request.name||'Request',method:request.method||'GET',url,headers:headers.map(h=>({name:h.key,value:h.value,disabled:false})),parameters:[],body,authentication};
      const preActions=exportPreRequestActions(request,includeBearer),preRequestScript=preActions.enabled?RunnerLogic.buildPreRequestScript(preActions.actions,'insomnia'):'';if(preRequestScript)resource.preRequestScript=preRequestScript;
      const script=[responseCaptureInsomniaScript(request,false).join('\n'),RunnerLogic.buildResponseTestScript(request.responseTests,'insomnia')].filter(Boolean);if(script.length)resource.afterResponseScript=script.join('\n\n');resources.push(resource);for(const example of RunnerLogic.normalizeResponseExamples(request.responseExamples))resources.push(RunnerLogic.responseExampleToInsomniaResource(example,'__response_'+(++responseNumber)+'__',requestId,url));
    }
  };
  addNode(collection,rootParent);
  return{_type:'export',__export_format:4,__export_date:new Date().toISOString(),__export_source:'vortix-local',resources};
}
function postmanRequestItem(request,includeBearer){
  const bodyMode=normalizeBodyMode(request.bodyMode),headers=exportHeaderList(request).filter(header=>!['multipart','graphql'].includes(bodyMode)||header.key.toLowerCase()!=='content-type'),authMode=RunnerLogic.persistAuthFields(request,true).authMode;
  const item={name:request.name||'Request',request:{method:request.method||'GET',header:headers,url:{raw:exportRequestUrl(request)}}};
  const rawBody=sanitizeBody(String(request.body||'')).value,multipartFields=normalizePersistableMultipartFields(request.multipartFields,true).fields,graphql=normalizePersistableGraphqlFields(request);
  if(bodyMode==='graphql')item.request.body=RunnerLogic.buildPostmanGraphqlBody(graphql);
  else if(bodyMode==='multipart')item.request.body={mode:'formdata',formdata:multipartFields.map(field=>field.type==='file'?{key:field.name,type:'file',src:field.fileName}:{key:field.name,type:'text',value:field.value})};
  else if(rawBody&&bodyMode==='urlencoded')item.request.body={mode:'urlencoded',urlencoded:[...new URLSearchParams(rawBody)].map(([key,value])=>({key,value,type:'text'}))};
  else if(rawBody){const language=bodyMode==='json'?'json':bodyMode==='xml'?'xml':'text';item.request.body={mode:'raw',raw:rawBody,options:{raw:{language}}};}
  if(authMode!=='inherit')item.request.auth=postmanAuthDefinition(request,includeBearer);
   const events=[],preActions=exportPreRequestActions(request,includeBearer),preRequestScript=preActions.enabled?RunnerLogic.buildPreRequestScript(preActions.actions,'postman'):'';if(preRequestScript)events.push({listen:'prerequest',script:{type:'text/javascript',exec:preRequestScript.split('\n')},disabled:false});
   const script=[responseCaptureInsomniaScript(request,true).join('\n'),RunnerLogic.buildResponseTestScript(request.responseTests,'postman')].filter(Boolean).join('\n\n');if(script)events.push({listen:'test',script:{type:'text/javascript',exec:script.split('\n')},disabled:false});if(events.length)item.event=events;
  const responseExamples=RunnerLogic.buildPostmanResponseExamples(request.responseExamples);if(responseExamples.length)item.response=responseExamples;
  return item;
}
function postmanNodeItems(node,includeBearer){return[...(node.requests||[]).map(request=>postmanRequestItem(request,includeBearer)),...(node.folders||[]).map(folder=>{const item={name:folder.name||'Pasta',item:postmanNodeItems(folder,includeBearer)};if(folder.auth)item.auth=postmanAuthDefinition(folder.auth,includeBearer);return item;})];}
function buildPostmanExport(collection,environment,includeBearer){
  const result={info:{_postman_id:newId(),name:collection.name||'Coleção',schema:'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'},item:postmanNodeItems(collection,includeBearer),variable:Object.entries(exportEnvironmentVariables(environment.variables,includeBearer)).map(([key,value])=>({key,value,enabled:true}))};
  if(collection.auth)result.auth=postmanAuthDefinition(collection.auth,includeBearer);return result;
}
function updateExportFormatUi(){
  const format=byId('export-format').value,openapi=format==='openapi-31',checkbox=byId('export-include-bearer'),label=byId('export-token-option-label'),hint=byId('export-format-hint'),description=byId('export-format-description');
  if(openapi){checkbox.checked=false;checkbox.disabled=true;label.textContent='Credenciais não são incluídas no OpenAPI 3.1';hint.textContent='OpenAPI 3.1 exporta o esquema e os paths. Valores de bodies, credenciais, respostas salvas, scripts, cookies e arquivos não são incluídos. Você verá os avisos antes do download.';description.textContent='OpenAPI 3.1 exporta métodos, paths, nomes de parâmetros e schemas de body sem valores literais. Revise URLs e paths antes de compartilhar.';}
  else{checkbox.disabled=false;label.textContent='Incluir credenciais de Auth e variáveis sensíveis';hint.textContent='Credenciais são omitidas por padrão; ao incluí-las, o JSON fica sem criptografia. Scripts exportados para Insomnia/Postman podem executar ao enviar.';description.textContent='O arquivo pode incluir requests, pastas, ações e o ambiente ativo, conforme o formato. Revise o conteúdo antes de compartilhar.';}
}
function openExportDialog(){
  if(!collections.length){showToast('Sem coleções','Crie uma coleção antes de exportar.','info');return;}
  const select=byId('export-collection-select');select.replaceChildren();
  for(const collection of collections){const option=document.createElement('option');option.value=collection.id;option.textContent=collection.name;option.selected=collection.id===selectedContainer.collectionId;select.append(option);}
  byId('export-format').value='api-studio';byId('export-include-bearer').checked=false;updateExportFormatUi();byId('export-dialog').showModal();
}
async function confirmSensitiveExport(collection,environment,includeBearer){
  if(!includeBearer||!(collectionHasAuthCredentials(collection)||environmentHasAuthCredentials(environment.variables)))return true;
  return confirmWithDialog({eyebrow:'DADOS SENSÍVEIS',title:'Exportar dados literais?',description:'O arquivo poderá conter Auth, variáveis sensíveis e texto literal de templates pré-request sem criptografia.',warning:'Qualquer pessoa com acesso ao arquivo poderá reutilizar esses valores.',confirmLabel:'Exportar dados literais',danger:true});
}
async function confirmResponseExamplesExport(collection){
  if(!collectionHasResponseExamples(collection))return true;
  return confirmWithDialog({eyebrow:'EXEMPLOS DE RESPOSTA',title:'Exportar bodies salvos?',description:'O arquivo incluirá bodies das respostas salvas. Eles podem conter tokens, dados pessoais ou informações privadas.',warning:'Arquivos JSON de coleção não são criptografados; headers de autenticação e cookies são omitidos.',confirmLabel:'Exportar exemplos',danger:true});
}
async function confirmAutomationExport(collection,format){
  if(format==='api-studio'||!collectionHasResponseAutomation(collection))return true;
  return confirmWithDialog({eyebrow:'SCRIPTS DE CICLO DE VIDA',title:'Exportar automações?',description:format==='insomnia-v4'?'O Insomnia executará ações antes do envio e scripts After-response desta coleção.':'O Postman executará ações pre-request e scripts após cada resposta.',warning:'Revise os scripts antes de enviar ou importar o arquivo.',confirmLabel:'Exportar automações',danger:true});
}
async function confirmExportLimitations(collection,environment,format,includeBearer){
  if(!(await confirmSensitiveExport(collection,environment,includeBearer)))return false;
  if(!(await confirmResponseExamplesExport(collection)))return false;
  if(!(await confirmAutomationExport(collection,format)))return false;
  return true;
}
async function buildOpenApiExportResult(collection,environment){
  const result=RunnerLogic.buildOpenApi31Export(exportCollectionNode(collection,false),exportEnvironmentVariables(environment.variables,false));
  const warnings=Array.isArray(result.warnings)?result.warnings:[];
  if(!(await confirmWithDialog({eyebrow:'OPENAPI 3.1',title:'Baixar esquema OpenAPI?',description:'“'+collection.name+'” será exportado como OpenAPI 3.1 JSON. URLs de servidor, paths e nomes de parâmetros/campos são incluídos; revise identificadores e contexto interno antes de compartilhar.',detail:warnings.length?warnings.map((warning,index)=>(index+1)+'. '+warning).join('\n'):'Nenhuma limitação adicional detectada nesta coleção.',warning:'Valores de Auth, bodies e respostas salvas não são exportados. Auth aparece apenas como metadados de esquema, quando possível. Confira URLs e paths no arquivo antes de compartilhar.',confirmLabel:'Baixar OpenAPI'})))return null;
  return{payload:result.document,suffix:'.openapi.json',message:'OpenAPI 3.1 baixado.'};
}
function buildCollectionExportResult(collection,environment,format,includeBearer){
  const payload=format==='insomnia-v4'?buildInsomniaExport(collection,environment,includeBearer):format==='postman-v21'?buildPostmanExport(collection,environment,includeBearer):{format:'api-studio-collection',version:2,exportedAt:new Date().toISOString(),collection:exportCollectionNode(collection,includeBearer),environment:{name:environment.name,group:environment.group,variables:exportEnvironmentVariables(environment.variables,includeBearer)}};
  const suffix=format==='insomnia-v4'?'.insomnia.json':format==='postman-v21'?'.postman_collection.json':'.vortix.json',message=format==='api-studio'?'Vortix JSON baixado.':format==='insomnia-v4'?'Insomnia JSON v4 baixado.':'Postman Collection v2.1 baixado.';
  return{payload,suffix,message};
}
function downloadJsonExport(payload,collectionName,suffix){
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
  const filename=collectionName.normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-|-$/g,'')||'collection';
  link.href=url;link.download=filename+suffix;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function exportCollection(event){
  event.preventDefault();const collection=findCollection(byId('export-collection-select').value),format=byId('export-format').value;if(!collection)return;
  const openapi=format==='openapi-31',includeBearer=openapi?false:byId('export-include-bearer').checked;
  const environment=getEnvironment();
  if(!openapi&&!(await confirmExportLimitations(collection,environment,format,includeBearer)))return;
  try{
    const result=openapi?await buildOpenApiExportResult(collection,environment):buildCollectionExportResult(collection,environment,format,includeBearer);
    if(!result)return;
    downloadJsonExport(result.payload,collection.name,result.suffix);
    byId('export-dialog').close();showToast('Coleção exportada',result.message,'success');
  }catch(error){showToast('Falha na exportação',error.message||'Não foi possível gerar o arquivo JSON.','error');}
}
async function exportWorkspaceBackup(){
  if(!(await confirmWithDialog({eyebrow:'BACKUP LOCAL',title:'Baixar backup completo?',description:'O arquivo reúne histórico, coleções, pastas, ambientes e configurações deste workspace.',warning:'JSON sem criptografia. Pode conter tokens, headers, bodies e dados do histórico; guarde em local seguro.',confirmLabel:'Baixar backup',danger:true})))return;
  try{
    syncActiveWorkspaceTab(false);
    await dbWrite('settings',{key:WORKSPACE_TABS_KEY,value:persistableWorkspaceTabs()});
    const payload=RunnerLogic.createWorkspaceBackup(await readWorkspace());
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
    const payload=RunnerLogic.createWorkspaceBackup(await readWorkspace()),serialized=JSON.stringify(payload,null,2);
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
  invalidateStructuredDiagnosticContext();
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
    await replaceWorkspace(backup);
    byId('settings-dialog').close();showToast('Workspace restaurado','Dados substituídos. Recarregando…','success',0);setTimeout(()=>window.location.reload(),1200);
  }catch(error){showToast('Falha ao restaurar backup',error.message||'Revise o arquivo e tente novamente.','error');}
  finally{event.target.value='';}
}
async function protectExistingSecrets(){
  invalidateStructuredDiagnosticContext();
  if(hostedMode){showToast('Proteção não disponível','Dados hospedados ficam apenas no armazenamento deste navegador. Use Backup com senha para exportar uma cópia protegida.','info');return;}
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
  if(body.mode==='formdata'||body.mimeType==='multipart/form-data'||body.mode==='graphql'||body.graphql||body.mimeType==='application/graphql')return'';
  if(typeof body.text==='string'){
    if(body.mimeType&&!headers.some(line=>/^content-type\s*:/i.test(line)))headers.push('Content-Type: '+body.mimeType);
    return body.text;
  }
  if(body.mode==='raw')return String(body.raw||'');
  if(body.mode==='urlencoded'||body.urlencoded||body.mimeType==='application/x-www-form-urlencoded'){const values=body.urlencoded||body.params||[];if(!headers.some(line=>/^content-type\s*:/i.test(line)))headers.push('Content-Type: application/x-www-form-urlencoded');return values.filter(item=>item&&!item.disabled).map(item=>`${encodeParam(String(item.key||item.name||''))}=${encodeParam(String(item.value||''))}`).join('&');}
  return'';
}
function importedMultipartFields(body){
  const parts=body?.formdata||body?.params||body?.multipart||[];
  if(!Array.isArray(parts))return[];
  return RunnerLogic.normalizeMultipartFields(parts.filter(item=>item&&!item.disabled).map(item=>{
    const type=String(item.type||'').toLowerCase()==='file'?'file':'text',source=item.fileName||item.src||item.value||'';
    return{name:String(item.name??item.key??''),type,value:type==='text'?String(item.value??''):'',fileName:type==='file'?(Array.isArray(source)?source[0]||'':String(source)):'',contentType:String(item.contentType||'')};
  }));
}
function importedGraphqlFields(body){
  const safe=normalizePersistableGraphqlFields(RunnerLogic.normalizeGraphqlImportBody(body));
  return{graphqlQuery:safe.graphqlQuery,graphqlVariables:safe.graphqlVariables,graphqlOperationName:safe.graphqlOperationName};
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
  const authMode=RunnerLogic.normalizeImportedAuthMode(auth),type=String(auth?.type||'').toLowerCase();
  if(authMode!=='custom')return{authMode,authType:'none'};
  if(type==='bearer')return{authMode,authType:'bearer',bearerToken:importedBearer(auth,headers)};
  if(type==='basic')return{authMode,authType:'basic',basicUsername:String(authArrayValue(auth.basic,'username')||''),basicPassword:String(authArrayValue(auth.basic,'password')||'')};
  if(type==='apikey'||type==='api-key')return{authMode,authType:'apiKey',apiKeyName:String(authArrayValue(auth.apikey||auth.apiKey,'key')||''),apiKeyValue:String(authArrayValue(auth.apikey||auth.apiKey,'value')||''),apiKeyLocation:String(authArrayValue(auth.apikey||auth.apiKey,'in')||'header').toLowerCase()==='query'?'query':'header'};
  return{authMode,authType:'none'};
}
function inferImportedBodyMode(requestBody,headers){
  if(requestBody?.mode==='graphql'||requestBody?.graphql||requestBody?.mimeType==='application/graphql')return'graphql';
  if(requestBody?.mode==='formdata'||requestBody?.mimeType==='multipart/form-data'||Array.isArray(requestBody?.params))return'multipart';
  if(requestBody?.mode==='urlencoded'||requestBody?.urlencoded||requestBody?.mimeType==='application/x-www-form-urlencoded')return'urlencoded';
  const language=String(requestBody?.options?.raw?.language||'').toLowerCase();if(language==='xml')return'xml';if(language==='text')return'text';if(language==='json')return'json';
  const contentType=requestBody?.mimeType||String(headers.find(line=>/^content-type\s*:/i.test(line))||'').split(':').slice(1).join(':').trim();
  return bodyModeFromContentType(contentType);
}
function importPostmanItem(item,inheritedEvents,stats,depth=0){
  if(depth>12)throw Error('A coleção Postman excede 12 níveis de pastas.');
  if(Array.isArray(item?.item)){
    const folder={name:String(item.name||'Pasta'),folders:[],requests:[]},events=[...inheritedEvents,...(Array.isArray(item.event)?item.event:[])];
    if(item.auth)folder.auth=exportAuthConfig(importedPostmanAuth(item.auth,[]),true);
    for(const child of item.item){const converted=importPostmanItem(child,events,stats,depth+1);if(!converted)continue;(converted.folders?folder.folders:folder.requests).push(converted);}return folder;
  }
  const request=item?.request;if(!request||typeof request!=='object')return null;
  const headers=importedHeaders(request.header||request.headers),rawUrl=typeof request.url==='string'?request.url:request.url?.raw||'';
  let url=splitImportedUrl(rawUrl);
  if(!rawUrl&&request.url&&typeof request.url==='object'){
    const host=Array.isArray(request.url.host)?request.url.host.join('.'):String(request.url.host||''),path=Array.isArray(request.url.path)?request.url.path.join('/'):String(request.url.path||'');
    url=splitImportedUrl((request.url.protocol||'https')+'://'+host+'/'+path);
  }
  url.route=importedQueryParams(url.route,request.url?.query);
  const allEvents=[...inheritedEvents,...(Array.isArray(item.event)?item.event:[])],event=allEvents.find(entry=>entry?.listen==='test'&&entry.script),preEvent=allEvents.find(entry=>entry?.listen==='prerequest'&&entry.script);
  const script=event?postmanScriptText(event.script):'';let capture=script?parseResponseCaptureScript(script):null;
  if(script&&!capture)stats.unsupportedScripts++;
  if(event?.disabled&&capture)capture={...capture,captureResponseVariable:false};
  const preScript=preEvent?postmanScriptText(preEvent.script):'',preRequestActions=preScript?RunnerLogic.parsePreRequestScript(preScript,'postman'):null;
  if(preScript&&!preRequestActions)stats.unsupportedScripts++;
  const auth=importedPostmanAuth(request.auth,headers),body=importedBody(request.body,headers),bodyMode=inferImportedBodyMode(request.body,headers),multipartFields=bodyMode==='multipart'?importedMultipartFields(request.body):[],graphqlFields=bodyMode==='graphql'?importedGraphqlFields(request.body):{};
  if(['multipart','graphql'].includes(bodyMode))for(let i=headers.length-1;i>=0;i--)if(/^content-type\s*:/i.test(headers[i]))headers.splice(i,1);
  return{name:String(item.name||'Request'),method:['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(String(request.method||'GET').toUpperCase())?String(request.method||'GET').toUpperCase():'GET',...url,...auth,headers:headers.join('\n'),body,bodyMode,multipartFields,...graphqlFields,preRequestActions:preRequestActions||[],preRequestActionsEnabled:!!preRequestActions&&!preEvent?.disabled,...(capture||{}),responseExamples:RunnerLogic.importResponseExamples(item.response,'postman',newId,new Date().toISOString())};
}
function importPostmanCollection(document){
  if(!document.info||!Array.isArray(document.item))throw Error('Coleção Postman inválida; esperado Postman v2.1.');
  const stats={unsupportedScripts:0},root={name:String(document.info.name||'Coleção Postman'),folders:[],requests:[]},events=Array.isArray(document.event)?document.event:[];
  if(document.auth)root.auth=exportAuthConfig(importedPostmanAuth(document.auth,[]),true);
  for(const item of document.item){const converted=importPostmanItem(item,events,stats);if(!converted)continue;(converted.folders?root.folders:root.requests).push(converted);}
  const variables={};for(const variable of Array.isArray(document.variable)?document.variable:[])if(variable?.key)Object.defineProperty(variables,String(variable.key),{value:String(variable.value??''),enumerable:true,writable:true,configurable:true});
  return{collection:root,environments:Object.keys(variables).length?[{name:root.name+' - Base',group:root.name,variables}]:[],stats};
}
function importedInsomniaAuth(auth,headers,route){
  const type=String(auth?.type||'').toLowerCase(),authMode=RunnerLogic.normalizeImportedAuthMode(auth);
  if(type==='bearer')return{authMode:'custom',authType:'bearer',bearerToken:importedBearer(auth,headers)};
  if(type==='basic')return{authMode:'custom',authType:'basic',basicUsername:String(auth.username||authArrayValue(auth.basic,'username')||''),basicPassword:String(auth.password||authArrayValue(auth.basic,'password')||'')};
  if(type==='apikey'||type==='api-key')return{authMode:'custom',authType:'apiKey',apiKeyName:String(auth.key||auth.name||''),apiKeyValue:String(auth.value||''),apiKeyLocation:String(auth.addTo||auth.location||'header').toLowerCase()==='query'?'query':'header'};
  if(authMode==='none'||type==='inherit')return{authMode,authType:'none'};
  const headerIndex=headers.findIndex(line=>/^(?:x[-_]?api[-_]?key|api[-_]?key)\s*:/i.test(line));
  if(headerIndex>=0){const line=headers.splice(headerIndex,1)[0],index=line.indexOf(':');return{authMode:'custom',authType:'apiKey',apiKeyName:line.slice(0,index).trim(),apiKeyValue:line.slice(index+1).trim(),apiKeyLocation:'header'};}
  const split=RunnerLogic.splitRoute(route||''),queryIndex=split.params.findIndex(([name])=>/(?:api.?key|access.?key)/i.test(name));
  if(queryIndex>=0){const[key,value]=split.params.splice(queryIndex,1)[0];return{authMode:'custom',authType:'apiKey',apiKeyName:key,apiKeyValue:value,apiKeyLocation:'query',route:split.route+(split.params.length?'?'+split.params.map(([name,val])=>encodeParam(name)+'='+encodeParam(val)).join('&'):'')};}
  const bearerToken=importedBearer(auth,headers);return bearerToken?{authMode:'custom',authType:'bearer',bearerToken}:{authMode,authType:'none'};
}
function importInsomniaCollection(document){
  if(!Array.isArray(document.resources)||document.__export_format!==4)throw Error('Arquivo Insomnia inválido; esperado JSON v4.');
  const resources=document.resources,workspace=resources.find(resource=>resource?._type==='workspace');if(!workspace)throw Error('O arquivo Insomnia não contém workspace.');
  const root={name:String(workspace.name||'Coleção Insomnia'),folders:[],requests:[]},groups=new Map(),stats={unsupportedScripts:0},rootAuth=workspace.authentication||workspace.auth;
  if(rootAuth&&rootAuth.type)root.auth=exportAuthConfig(importedInsomniaAuth(rootAuth,[],'/'),true);
  for(const resource of resources)if(resource&&['request_group','folder'].includes(resource._type)){
    const auth=resource.authentication||resource.auth,group={id:resource._id,parentId:resource.parentId,name:String(resource.name||'Pasta'),folders:[],requests:[]};
    if(auth&&auth.type)group.auth=exportAuthConfig(importedInsomniaAuth(auth,[],'/'),true);groups.set(resource._id,group);
  }
  for(const group of groups.values()){const parent=groups.get(group.parentId);(parent?parent.folders:root.folders).push(group);}
  const responseResources=new Map();for(const resource of resources)if(resource?._type==='response'&&resource.parentId){const related=responseResources.get(resource.parentId)||[];related.push(resource);responseResources.set(resource.parentId,related);}
  for(const resource of resources){
    if(resource?._type!=='request')continue;const headers=importedHeaders(resource.headers),url=splitImportedUrl(resource.url||''),auth=resource.authentication||{},authFields=importedInsomniaAuth(auth,headers,url.route);
    if(authFields.route)url.route=authFields.route;url.route=importedQueryParams(url.route,resource.parameters);
    const body=importedBody(resource.body,headers),bodyMode=inferImportedBodyMode(resource.body,headers),multipartFields=bodyMode==='multipart'?importedMultipartFields(resource.body):[],graphqlFields=bodyMode==='graphql'?importedGraphqlFields(resource.body):{},script=String(resource.afterResponseScript||''),preScript=String(resource.preRequestScript||'');let capture=script?parseResponseCaptureScript(script):null,preRequestActions=preScript?RunnerLogic.parsePreRequestScript(preScript,'insomnia'):null;if(script&&!capture)stats.unsupportedScripts++;if(preScript&&!preRequestActions)stats.unsupportedScripts++;if(capture)capture={...capture,captureResponseVariable:false};
    if(['multipart','graphql'].includes(bodyMode))for(let i=headers.length-1;i>=0;i--)if(/^content-type\s*:/i.test(headers[i]))headers.splice(i,1);
    const request={name:String(resource.name||'Request'),method:['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(String(resource.method||'GET').toUpperCase())?String(resource.method||'GET').toUpperCase():'GET',...url,...authFields,headers:headers.join('\n'),body,bodyMode,multipartFields,...graphqlFields,preRequestActions:preRequestActions||[],preRequestActionsEnabled:!!preRequestActions,...(capture||{}),responseExamples:RunnerLogic.importResponseExamples(responseResources.get(resource._id)||[],'insomnia',newId,new Date().toISOString())};
    const parent=groups.get(resource.parentId)||root;parent.requests.push(request);
  }
  const environments=[];for(const resource of resources.filter(resource=>resource?._type==='environment')){const variables={};for(const[key,value]of Object.entries(resource.data||{}))Object.defineProperty(variables,key,{value:typeof value==='string'?value:JSON.stringify(value),enumerable:true,writable:true,configurable:true});environments.push({name:String(resource.name||'Ambiente Insomnia'),group:root.name,variables});}
  return{collection:root,environments,stats};
}
function importPostmanEnvironment(document){
  return RunnerLogic.importPostmanEnvironment(document);
}
function normalizeImportedNode(source,keepAuth,depth=0,isRoot=false,enableCapture=true,allowInsecureHttp=false){
  if(depth>12)throw Error('A coleção importada ultrapassa 12 níveis de pastas.');
  if(!source||typeof source!=='object'||Array.isArray(source))throw Error('Estrutura inválida de coleção ou pasta.');
  const safe={id:newId(),name:String(source.name||(isRoot?'Coleção importada':'Pasta')).slice(0,100),folders:[],requests:[]};
  if(source.auth&&typeof source.auth==='object'&&!Array.isArray(source.auth))safe.auth=exportAuthConfig(source.auth,keepAuth);
  if(!Array.isArray(source.requests)||!Array.isArray(source.folders))throw Error('A coleção precisa conter listas de requests e pastas.');
  if(source.requests.length>2000||source.folders.length>500)throw Error('A coleção ultrapassa o limite de itens por nível.');
  safe.requests=source.requests.map(request=>{
    if(!request||typeof request!=='object'||Array.isArray(request))throw Error('Uma request do arquivo está inválida.');
    const base=sanitizeBase(String(request.baseUrl||'')),route=sanitizeRoute(String(request.route||'')),headers=sanitizeHeaders(String(request.headers||'')),payload=sanitizeBody(String(request.body||'')),multipart=normalizePersistableMultipartFields(request.multipartFields,true),graphql=normalizePersistableGraphqlFields(request),savedAuth=RunnerLogic.persistAuthFields(request,keepAuth),literalConsent=keepAuth&&(request.preRequestActionsLiteralConsent===true||RunnerLogic.normalizePreRequestActions(request.preRequestActions).some(RunnerLogic.preRequestActionHasLiteralText)),preRequest=exportPreRequestActions(request,literalConsent),responseContract=RunnerLogic.sanitizeOpenApiResponseContract(request.responseContract);
    delete savedAuth.authOmitted;if(savedAuth.authType==='bearer')savedAuth.bearerToken=sanitizeBearer(savedAuth.bearerToken);
    return{id:newId(),name:String(request.name||'Request').slice(0,100),method:['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(request.method)?request.method:'GET',
      baseUrl:base.value,route:route.value,headers:bodyModeHeaders(headers.value,request.bodyMode),body:payload.value,bodyMode:normalizeBodyMode(request.bodyMode),multipartFields:multipart.fields,graphqlQuery:graphql.graphqlQuery,graphqlVariables:graphql.graphqlVariables,graphqlOperationName:graphql.graphqlOperationName,...savedAuth,
      allowInsecureHttp:allowInsecureHttp&&request.allowInsecureHttp===true,tokenRequest:!!request.tokenRequest,tokenClientId:String(request.tokenClientId||'').slice(0,512),tokenCredentialMode:request.tokenCredentialMode==='query'?'query':'body',
       preRequestActions:preRequest.actions,preRequestActionsEnabled:enableCapture&&preRequest.enabled,preRequestActionsLiteralConsent:preRequest.literalConsent,
       captureResponseVariable:enableCapture&&!!request.captureResponseVariable,responseVariableName:String(request.responseVariableName||'token').slice(0,80),responseValueSource:request.responseValueSource==='text'?'text':'json',responseJsonPath:String(request.responseJsonPath||'access_token').slice(0,1000),responseSuccessOnly:request.responseSuccessOnly!==false,responseCaptureTarget:request.responseCaptureTarget==='vault'?'vault':'environment',
      responseTests:enableCapture?RunnerLogic.normalizeResponseTests(request.responseTests).map(rule=>({...rule,id:newId()})):[],responseExamples:RunnerLogic.normalizeResponseExamples(request.responseExamples).map(example=>({...example,id:newId()})),
      ...(responseContract?{responseContract}:{})};
  });
  safe.folders=source.folders.map(folder=>normalizeImportedNode(folder,keepAuth,depth+1,false,enableCapture,allowInsecureHttp));return safe;
}
function updateCommandImportUi(){
  const httpie=byId('command-import-format').value==='httpie';
  byId('command-import-label').textContent=httpie?'Comando HTTPie':'Comando cURL';
  byId('command-import-source').placeholder=httpie?'http GET https://api.example.com/v1/users Accept:application/json page==1':'curl --request GET "https://api.example.com/v1/users" --header "Accept: application/json"';
}
function curlRequestFromForm(){
  const baseUrl=byId('base-url').value.trim(),requestRoute=buildRequestRoute(false,true),bodyMode=normalizeBodyMode(byId('body-mode').value);
  const url=baseUrl.replace(/\/+$/,'')+(requestRoute?'/'+requestRoute.replace(/^\/+/, ''):'');
  const graphql=getGraphqlFieldsFromForm(),requestBody=bodyMode==='graphql'?RunnerLogic.buildGraphqlBody(graphql.graphqlQuery,graphql.graphqlVariables,graphql.graphqlOperationName):bodyMode==='multipart'?'':body.value;
  let headers=bodyModeHeaders(byId('headers').value,bodyMode);
  if(bodyMode!=='multipart'&&!/^content-type\s*:/im.test(headers))headers=[headers.trim(),(requestBody||bodyMode==='graphql')?'Content-Type: '+bodyModeContentType(bodyMode):''].filter(Boolean).join('\n');
  return{method:method.value,url,headers,body:requestBody,...resolveFormAuth(),bodyMode,hasCookieJar:Number(byId('cookie-jar-count').textContent)>0,hasPreRequestActions:byId('pre-request-actions-enabled').checked&&getPreRequestActionsFromForm().length>0};
}
function updateCurlExportPreview(){
  const formatName=byId('curl-format').value==='httpie'?'HTTPie':'cURL',preview=byId('curl-command-preview'),error=byId('curl-export-error'),copy=byId('copy-curl-command'),hint=byId('curl-export-hint');error.hidden=true;error.textContent='';preview.textContent='';preview.setAttribute('aria-label','Prévia do comando '+formatName);copy.disabled=true;hint.textContent='';
  try{
    const request=curlRequestFromForm(),isHttpie=byId('curl-format').value==='httpie',options={includeSensitive:byId('curl-include-sensitive').checked,shell:byId('curl-shell').value},generated=isHttpie?RunnerLogic.buildHttpieCommand(request,options):RunnerLogic.buildCurlCommand(request,options),warnings=[...generated.warnings];
    if(request.bodyMode==='multipart')warnings.push('Body multipart não foi incluído; selecione arquivos e monte o formulário no terminal.');
    if(request.hasCookieJar)warnings.push('O Cookie jar do ambiente ativo não é exportado; configure os cookies manualmente no terminal.');
    if(request.hasPreRequestActions)warnings.push('Ações pré-request não são executadas no terminal; substitua os templates manualmente.');
    byId('curl-export-title').textContent='Gerar comando '+formatName;const copyLabel=byId('copy-curl-label');if(copyLabel){copyLabel.textContent='Copiar '+formatName;}copy.title='Copiar comando '+formatName;copy.setAttribute('aria-label','Copiar comando '+formatName);
    preview.textContent=generated.command;hint.textContent=warnings.join(' ');copy.disabled=!generated.command;
  }catch(exception){error.textContent=exception.message||'Não foi possível gerar o comando '+formatName+'.';error.hidden=false;}
}
async function openCurlExportDialog(){
  byId('curl-include-sensitive').checked=false;await renderCookieJar();updateCurlExportPreview();byId('curl-export-dialog').showModal();byId('curl-shell').focus();
}
async function confirmCurlSensitiveMode(){
  const checkbox=byId('curl-include-sensitive'),formatName=byId('curl-format').value==='httpie'?'HTTPie':'cURL';
  if(checkbox.checked){
    const confirmed=await confirmWithDialog({eyebrow:'DADOS SENSÍVEIS',title:'Mostrar dados no '+formatName+'?',description:'A prévia incluirá Body, Auth, headers e parâmetros sensíveis desta request.',warning:'Credenciais aparecerão na tela e poderão ser copiadas para o clipboard. Confira quem tem acesso ao computador e ao terminal.',confirmLabel:'Mostrar dados',danger:true});
    checkbox.checked=confirmed;
  }
  updateCurlExportPreview();
}
async function copyCurlCommand(){
  const command=byId('curl-command-preview').textContent.trim(),format=byId('curl-format').value==='httpie'?'HTTPie':'cURL';if(!command)return;
  try{await copyToClipboard(command);}
  catch{showToast('Falha ao copiar '+format,'O navegador bloqueou a área de transferência. Selecione o comando na prévia e copie manualmente.','error');}
}
function openImportDialog(){byId('command-import-error').hidden=true;byId('command-import-error').textContent='';byId('command-import-source').value='';byId('command-import-format').value='curl';updateCommandImportUi();byId('import-dialog').showModal();byId('command-import-source').focus();}
function openImportedCommandDraft(){
  const error=byId('command-import-error'),httpie=byId('command-import-format').value==='httpie';error.hidden=true;error.textContent='';
  try{
    const imported=httpie?RunnerLogic.parseHttpieCommand(byId('command-import-source').value):RunnerLogic.parseCurlCommand(byId('command-import-source').value);
    const urlParts=splitImportedUrl(imported.url),routeParts=RunnerLogic.splitRoute(urlParts.route);
    if(routeParts.params.some(([name])=>isSensitiveName(name)))throw Error('URL contém parâmetros sensíveis. Remova-os e use variáveis de ambiente.');
    const safeRoute=sanitizeRoute(routeParts.route),safeBase=sanitizeBase(urlParts.baseUrl);
    if(safeRoute.redacted||safeBase.redacted)throw Error('Remova credenciais e fragmentos da URL antes de importar.');
    if(!createNewWorkspaceTab(false))return;
    method.value=imported.method;byId('base-url').value=safeBase.value;baseUrlAuto=false;route.value=safeRoute.value;
    renderQueryParams(routeParts.params);ensureQueryParamRow();byId('headers').value=imported.headers.map(([name,value])=>`${name}: ${value}`).join('\n');body.value=imported.body;applyBodyMode(bodyModeFromHeaderEntries(imported.headers));
    applyAuthFields({authType:imported.bearerToken?'bearer':'none',bearerToken:imported.bearerToken});if(imported.bearerToken)byId('save-token-history').checked=false;
    byId('request-title').textContent=`${httpie?'HTTPie':'cURL'} - ${imported.method} ${safeRoute.value||'/'}`;activeSaved=null;setEditorTab('params');
    byId('import-dialog').close();updateGuard();updateCopyButtons();renderBodyHighlight();updateJsonTools();syncActiveWorkspaceTab(true);renderWorkspaceTabs();scheduleWorkspaceTabsPersist();
    byId('command-import-source').value='';showToast(httpie?'HTTPie importado':'cURL importado',imported.bearerToken?'Bearer importado apenas em memória; salvamento opcional.':'Request aberta como rascunho.','success');
  }catch(importError){error.textContent=importError.message||'Não foi possível importar o comando.';error.hidden=false;}
}
async function importCollectionFile(event){
  invalidateStructuredDiagnosticContext();
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
    const keepCredentials=containsCredentials?await confirmWithDialog({eyebrow:'DADOS SENSÍVEIS',title:'Dados literais encontrados',description:hostedMode?'Salvar credenciais e textos literais de templates pré-request neste navegador? O IndexedDB não é criptografado automaticamente.':'Salvar credenciais e textos literais de templates pré-request no SQLite local protegido?',warning:hostedMode?'Esses valores ficam neste perfil de navegador. Use Backup com senha para criar uma cópia protegida. A escolha Importar sem credenciais descarta os literais.':'A escolha Importar sem credenciais descarta os literais. A proteção depende das chaves e da identidade desta instalação.',confirmLabel:'Importar dados literais',cancelLabel:'Importar sem literais',danger:true}):false;
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
    const message=[imported?'Requests e pastas disponíveis.':'Ambiente disponível no seletor.',containsCredentials&&!keepCredentials?'Credenciais e textos literais omitidos.':'',capturesDisabled?'Automações importadas desativadas até sua revisão.':'',unsupportedScripts?` ${unsupportedScripts} script(s) não convertidos; configure em Scripts.`:''].filter(Boolean).join(' ');
    if(importWarnings.length)message+=(message?' ':'')+importWarnings.join(' ');
    showToast(imported?'Coleção importada':'Ambiente importado',message,importWarnings.length?'warning':'success');
  }catch(error){showToast('Falha na importação',error.message||'Arquivo JSON inválido.','error');}
}
function flattenContainers(){
  const result=[];const visit=(collection,node,folders=[])=>{result.push({collectionId:collection.id,folderId:folders.at(-1)?.id||'',label:collection.name+(folders.length?' / '+folders.map(x=>x.name).join(' / '):'')});for(const folder of node.folders||[])visit(collection,folder,[...folders,folder]);};
  for(const collection of collections)visit(collection,collection);return result;
}
async function openSaveDialog(){
  try{buildRequestRoute();}catch(error){showToast('Revise a requisição',error.message,'error');return;}
  if(!collections.length){
    const proceed=await confirmWithDialog({eyebrow:'COLEÇÕES',title:'Criar coleção para salvar?',description:'Salvar precisa de uma coleção. Crie uma agora ou cancele para manter este rascunho como está.',confirmLabel:'Criar coleção'});
    if(!proceed)return;
    /* Reuse the existing creation flow; it only changes state after a successful write. */
    const before=collections.length;await addCollection();
    if(collections.length===before)return;
  }
  byId('saved-request-name').value=activeSaved?.name||route.value.trim()||'Nova requisição';
  const select=byId('saved-request-folder');select.replaceChildren();
  for(const item of flattenContainers()){const option=document.createElement('option');option.value=`${item.collectionId}|${item.folderId}`;option.textContent=item.label;option.selected=item.collectionId===selectedContainer.collectionId&&item.folderId===selectedContainer.folderId;select.append(option);}
  byId('save-request-dialog').showModal();byId('saved-request-name').focus();
}
function getSnapshot(){
  validateResponseCaptureForm();const responseTests=getResponseTestsFromForm(),preRequestInput=getPreRequestActionsFromForm(),rawRoute=buildRequestRoute(false,true),base=sanitizeBase(byId('base-url').value.trim()),path=rawRoute?sanitizeRoute(rawRoute):{value:'',redacted:false},headers=sanitizeHeaders(byId('headers').value),payload=sanitizeBody(body.value),bodyMode=byId('body-mode').value,graphqlInput=getGraphqlFieldsFromForm();
  if(bodyMode==='graphql'){if(method.value!=='POST')throw Error('GraphQL usa POST no Vortix.');RunnerLogic.buildGraphqlBody(graphqlInput.graphqlQuery,graphqlInput.graphqlVariables,graphqlInput.graphqlOperationName);}
  const saveAuth=byId('save-token-history').checked,auth=RunnerLogic.persistAuthFields({...authFieldsFromForm(value=>value,true),authMode:authModeFromForm()},saveAuth),authOmitted=auth.authOmitted,preRequest=exportPreRequestActions({preRequestActions:preRequestInput,preRequestActionsEnabled:byId('pre-request-actions-enabled').checked},byId('pre-request-literal-consent').checked);delete auth.authOmitted;const multipart=getPersistableMultipartFields(true),graphql=normalizePersistableGraphqlFields(graphqlInput),responseContract=RunnerLogic.sanitizeOpenApiResponseContract(activeResponseContract);
  return{method:method.value,baseUrl:base.value,route:path.value,headers:headers.value,body:bodyMode==='graphql'?'':payload.value,bodyMode,multipartFields:multipart.fields,graphqlQuery:graphql.graphqlQuery,graphqlVariables:graphql.graphqlVariables,graphqlOperationName:graphql.graphqlOperationName,...auth,allowInsecureHttp:byId('allow-insecure-http').checked,
      preRequestActions:preRequest.actions,preRequestActionsEnabled:preRequest.enabled,preRequestActionsLiteralConsent:preRequest.literalConsent,
     captureResponseVariable:byId('capture-response-variable').checked,responseVariableName:byId('response-variable-name').value.trim(),responseValueSource:byId('response-value-source').value,responseJsonPath:byId('response-json-path').value.trim(),responseSuccessOnly:byId('response-success-only').checked,responseCaptureTarget:byId('response-capture-target').value==='vault'?'vault':'environment',responseTests,
     ...(responseContract?{responseContract}:{}),
     redacted:base.redacted||path.redacted||headers.redacted||payload.redacted||authOmitted||multipart.redacted||graphql.redacted||preRequest.actions.length!==preRequestInput.length};
}
async function saveCollectionRequest(event){
  invalidateStructuredDiagnosticContext();
  event.preventDefault();const name=byId('saved-request-name').value.trim(),[collectionId,folderId='']=byId('saved-request-folder').value.split('|');
  const collection=findCollection(collectionId),container=findFolder(collection,folderId);if(!name)return;if(!collection||!container){showToast('Destino inválido','Selecione uma coleção ou pasta válida para salvar.','error');return;}
  selectedContainer={collectionId,folderId};if(authModeFromForm()==='inherit')applyAuthFields({authMode:'inherit'});
  let snapshot;try{snapshot=getSnapshot();}catch(error){showToast('Revise a requisição',error.message,'error');return;}
  const same=activeSaved?.collectionId===collectionId&&activeSaved?.folderId===folderId;
  const previous=activeSaved?findFolder(findCollection(activeSaved.collectionId),activeSaved.folderId)?.requests?.find(item=>item.id===activeSaved.id):null;
  const responseExamples=RunnerLogic.normalizeResponseExamples(previous?.responseExamples);
  const saved={id:same?activeSaved.id:newId(),name,...snapshot,responseExamples,savedAt:new Date().toISOString()};
  container.requests||=[];const index=container.requests.findIndex(x=>x.id===saved.id);if(index>=0)container.requests[index]=saved;else container.requests.push(saved);
  try{
    await dbWrite('collections',collection);activeSaved={id:saved.id,name,collectionId,folderId};clearCurrentResponseExample();selectedContainer={collectionId,folderId};
    byId('request-title').textContent=name;byId('save-request-dialog').close();renderCollectionTree();markActiveWorkspaceTabSaved(saved);
     showToast('Requisição salva',saved.redacted?'Request salva; campos sensíveis ou textos literais pré-request foram omitidos.':'Request guardada na coleção e no banco local.','success');
  }catch(error){showToast('Falha ao salvar',error.message||'Não foi possível salvar a request na coleção.','error');}
}
function loadCollectionRequest(request,collectionId,folderId,notify=true){
  clearCurrentResponseExample();
  byId('base-url').value=request.baseUrl||'{{baseUrl}}';baseUrlAuto=request.baseUrl==='{{baseUrl}}';byId('allow-insecure-http').checked=request.allowInsecureHttp===true;method.value=['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(request.method)?request.method:'GET';
  const split=splitRoute(request.route||'');route.value=split.route;renderQueryParams(split.params);ensureQueryParamRow();byId('headers').value=request.headers||'';body.value=request.body||'';applyBodyMode(request.bodyMode);renderMultipartFields(request.multipartFields||[]);renderGraphqlFields(request);selectedContainer={collectionId,folderId};applyAuthFields(request);
  byId('token-client-id').value=request.tokenRequest?request.tokenClientId||'':'';byId('token-client-secret').value='';byId('token-credential-mode').value=request.tokenCredentialMode==='query'?'query':'body';byId('token-helper').open=!!request.tokenRequest;
  if(request.tokenRequest){byId('token-route').value=split.route;byId('token-client-id-field').value=request.tokenClientIdField||'client_id';byId('token-client-secret-field').value=request.tokenClientSecretField||'client_secret';tokenRequestConfig=RunnerLogic.normalizeTokenRequestConfig({route:split.route,clientIdField:byId('token-client-id-field').value,clientSecretField:byId('token-client-secret-field').value,credentialMode:byId('token-credential-mode').value});}
   renderPreRequestActions(request.preRequestActions||[]);byId('pre-request-actions-enabled').checked=request.preRequestActionsEnabled!==false;byId('pre-request-literal-consent').checked=request.preRequestActionsLiteralConsent===true;updatePreRequestActionsUi();byId('capture-response-variable').checked=!!request.captureResponseVariable;byId('response-variable-name').value=request.responseVariableName||'token';byId('response-value-source').value=request.responseValueSource==='text'?'text':'json';byId('response-json-path').value=request.responseJsonPath||'access_token';byId('response-success-only').checked=request.responseSuccessOnly!==false;byId('response-capture-target').value=request.responseCaptureTarget==='vault'?'vault':'environment';byId('response-variable-result').hidden=true;updateResponseCaptureUi();setResponseTests(request.responseTests||[]);setActiveResponseContract(request.responseContract||null);
  updateTokenButton();clearWriteConfirmation();updateGuard();updateCopyButtons();renderBodyHighlight();updateJsonTools();activeSaved={id:request.id,name:request.name,collectionId,folderId};
  byId('request-title').textContent=request.name||'Requisição salva';setEditorTab('params');renderCollectionTree();
  if(notify)showToast('Requisição carregada',hasAuthCredentials(request)?authTypeLabel(request)+' recuperada do banco local; pode expirar.':'Params, headers e body recuperados da coleção.','success',3500);
}
function clearWriteConfirmation(){byId('confirm-test-data').checked=false;byId('test-data-phrase').value='';}
function writeConfirmationValid(){return byId('confirm-test-data').checked&&byId('test-data-phrase').value.trim()==='TESTE';}
function updateGuard(){
  const isWrite=writeMethods.has(method.value);method.className=`method-select method-${method.value.toLowerCase()}`;
  writeGuard.hidden=!isWrite;
  let disabled=false,message='Revise ambiente e dados antes de enviar.';
  if(requestSendInProgress){disabled=true;message='Envio em andamento. Aguarde a resposta.';}
  else if(!route.value.trim()){disabled=true;message='Informe uma rota para enviar a requisição.';}
  else if(isWrite&&!writeConfirmationValid()){disabled=true;message='Confirme que os dados são de teste e digite TESTE.';}
  sendButton.disabled=disabled;
  const status=byId('request-send-status');
  if(status&&status.textContent!==message)status.textContent=message;
  refreshRequestInspector();updateAdvancedToolsIndicator();
}
function updateAdvancedToolsIndicator(){
  const indicator=byId('advanced-active-indicator');if(!indicator)return '';
  const active=[];
  if(byId('allow-insecure-http')?.checked)active.push('HTTP sem TLS');
  if(byId('pre-request-actions-enabled')?.checked&&byId('pre-request-actions')?.children?.length)active.push('automação antes do envio');
  if(byId('capture-response-variable')?.checked)active.push('captura após resposta');
  if(byId('response-tests-list')?.children?.length)active.push('testes de resposta');
  if(typeof activeResponseContract!=='undefined'&&activeResponseContract)active.push('contrato OpenAPI');
  if(byId('token-helper')?.open||byId('oauth2-helper')?.open||byId('oauth-pkce-helper')?.open)active.push('autenticação avançada');
  const text=active.length?`Avançado ativo: ${active.join(' · ')}`:'';
  if(indicator.textContent!==text)indicator.textContent=text;
  indicator.hidden=!active.length;
  return text;
}
function escHtml(value){return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');}
function highlightJson(value){
  const text=String(value??''),pattern=/"(?:\\.|[^"\\])*"|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\b(?:true|false|null)\b|[{}\[\],:]/g;let html='',offset=0;
  for(const match of text.matchAll(pattern)){const token=match[0],index=match.index;html+=escHtml(text.slice(offset,index));let cls='json-punctuation';
    if(token.startsWith('"'))cls=/^\s*:/.test(text.slice(index+token.length))?'json-key':'json-string';else if(/^-?\d/.test(token))cls='json-number';else if(/^(true|false|null)$/.test(token))cls='json-literal';
    html+=`<span class="${cls}">${escHtml(token)}</span>`;offset=index+token.length;}
  return html+escHtml(text.slice(offset))||' ';
}
function renderBodyHighlight(){const highlight=byId('body-highlight');if(!highlight)return;if(byId('body-mode').value!=='json'){highlight.replaceChildren();return;}highlight.hidden=false;highlight.innerHTML=highlightJson(body.value);highlight.scrollTop=body.scrollTop;highlight.scrollLeft=body.scrollLeft;}
function updateJsonTools(){const json=byId('body-mode').value==='json';byId('format-json').hidden=!json;byId('minify-json').hidden=!json;byId('format-json').disabled=!json||!body.value.trim();byId('minify-json').disabled=!json||!body.value.trim();}
function formatBodyJson(compact=false){
  if(byId('body-mode').value!=='json')return;
  try{body.value=JSON.stringify(JSON.parse(body.value),null,compact?0:2);body.dispatchEvent(new Event('input',{bubbles:true}));showToast(compact?'JSON compactado':'JSON indentado',compact?'Espaços removidos do body.':'Body formatado com indentação de 2 espaços.','success',3000);}
  catch{showToast('JSON inválido','Revise a sintaxe antes de formatar.','error');}
}
function handleJsonKeydown(event){
  if(byId('body-mode').value!=='json')return;
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
  const status=byId('response-status');status.textContent=statusText;status.title=statusText;status.className='status '+statusClass;
  const headers=byId('response-headers');headers.innerHTML=headersText?highlightJson(headersText):'Os cabeçalhos aparecerão após o envio.';headers.classList.toggle('empty',!headersText);
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
  if(!raw){pre.textContent='Envie a request para ver o status e o corpo da resposta.';pre.hidden=false;tree.replaceChildren();tree.hidden=true;responseTreeSource=null;byId('response-search-count').textContent='';return;}
  const matches=RunnerLogic.findTextMatches(text,query);byId('response-search-count').textContent=query?(matches.length?matches.length+' '+(matches.length===1?'ocorrência':'ocorrências'):'Nenhuma ocorrência'):'';
  if(responseBodyView==='tree'){pre.hidden=true;tree.hidden=false;if(responseTreeSource!==responseBodyState)buildResponseTree();const found=filterResponseTree(query);tree.querySelector('.response-tree-empty').hidden=!query||found;return;}
  tree.hidden=true;pre.hidden=false;pre.innerHTML=highlightJson(text);highlightResponseMatches(pre,query);
}

function responseValuePreview(value){if(Array.isArray(value))return '['+value.length+' itens]';if(value&&typeof value==='object')return '{'+Object.keys(value).length+' propriedades}';if(typeof value==='string')return JSON.stringify(value);return value===null?'null':String(value);}

function responseTreeValueClass(value,container){
  if(container)return 'json-punctuation';
  if(typeof value==='string')return 'json-string';
  if(typeof value==='number')return 'json-number';
  return 'json-literal';
}

function appendResponseTreeChildren(entry,line,label,value,pathParts,depth,state){
  const toggle=document.createElement('button'),children=document.createElement('div'),expanded=depth<1;toggle.type='button';toggle.className='response-tree-toggle';toggle.setAttribute('aria-expanded',String(expanded));toggle.setAttribute('aria-label',(expanded?'Recolher ':'Expandir ')+label);
  children.className='response-tree-children';children.hidden=!expanded;toggle.onclick=()=>{const open=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',(open?'Recolher ':'Expandir ')+label);children.hidden=!open;};
  line.append(toggle);entry.append(line,children);const isArray=Array.isArray(value),items=isArray?value.map((child,index)=>[index,child]):Object.entries(value);
  for(const[key,child]of items){if(state.count>=2000){state.truncated=true;break;}appendResponseTreeEntry(children,isArray?'['+key+']':key,child,[...pathParts,key],depth+1,state);if(state.truncated)break;}
}

function appendResponseTreeEntry(parent,label,value,pathParts,depth,state){
  if(state.count>=2000){state.truncated=true;return;}state.count++;
  const entry=document.createElement('div'),line=document.createElement('div'),container=value!==null&&typeof value==='object';entry.className='response-tree-entry';
  const preview=responseValuePreview(value);entry.dataset.searchText=(pathParts.length?String(label)+' '+(container?'':preview):'').toLocaleLowerCase();line.className='response-tree-line';
  if(container){
    appendResponseTreeChildren(entry,line,label,value,pathParts,depth,state);
  }else{const spacer=document.createElement('span');spacer.className='response-tree-spacer';spacer.setAttribute('aria-hidden','true');line.append(spacer);entry.append(line);}
  const key=document.createElement('span'),valueElement=document.createElement('span');key.className='response-tree-key';key.textContent=String(label);
  valueElement.className='response-tree-value '+responseTreeValueClass(value,container);valueElement.textContent=preview.length>120?preview.slice(0,117)+'…':preview;if(preview.length>120){valueElement.title=preview;}line.append(key,valueElement);
  if(pathParts.length){const path=RunnerLogic.formatJsonPath(pathParts),copy=document.createElement('button');copy.type='button';copy.className='copy-button copy-with-icon response-tree-copy';copy.id='response-path-copy-'+(++responsePathCopyId);copy.innerHTML=COPY_ICON_SVG+'<span class="visually-hidden">Copiar</span>';copy.dataset.copyJsonPath=path;copy.dataset.vortixAction='response.path.copy';copy.title='Copiar caminho JSON';copy.setAttribute('aria-label','Copiar caminho JSON');line.append(copy);}
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

const COPY_ICON_SVG = '<svg class="copy-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="11" height="11" rx="1.5"></rect><path d="M5 16V6.5A1.5 1.5 0 0 1 6.5 5H16"></path></svg>';
let responsePathCopyId = 0;
async function copyToClipboard(text){await navigator.clipboard.writeText(text);showToast('Copiado','Copiado para a área de transferência.','info');}
async function copyOutput(id,label){
  const output=byId(id),text=id==='response-body'?(responseBodyView==='raw'?responseBodyState.raw:responseBodyState.pretty):output.textContent;if(!text.trim())return;
  try{await copyToClipboard(text);}
  catch{showToast('Falha ao copiar','O navegador bloqueou a área de transferência. Tente novamente pelo botão.','error');}
}
async function copyResponsePath(path){
  try{await copyToClipboard(path);}
  catch{showToast('Falha ao copiar caminho','O navegador bloqueou a área de transferência. Tente novamente pelo botão.','error');}
}
function apiStatusToast(status,reason){
  const label=`${status} ${reason}`.trim();if(status>=200&&status<300){showToast('Sucesso',`API respondeu ${label}.`,'success');return;}if(status>=300&&status<400){showToast('Redirecionamento',`API respondeu ${label}. Confira a URL base e use HTTPS.`,'warning');return;}
  const guide=status===401?'Confira o token Bearer.':status===403?'Confira as permissões do token.':status===404?'Confira a rota e a URL base.':status===429?'Aguarde antes de tentar novamente.':status>=500?'Falha no servidor da API; tente novamente mais tarde.':'Confira os campos e o JSON da requisição.';showToast('Erro da API',`${label}. ${guide}`,'error');
}
function setEditorTab(name){
  document.querySelectorAll('[data-editor-tab]').forEach(button=>{const active=button.dataset.editorTab===name;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;});
  document.querySelectorAll('[data-editor-panel]').forEach(panel=>panel.hidden=panel.dataset.editorPanel!==name);if(name==='body')renderBodyHighlight();if(name==='scripts')updateInsomniaScriptPreview();syncActiveWorkspaceTab(false);
}
function handleEditorTabKeydown(event){
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  const tabs=[...event.currentTarget.querySelectorAll('[data-editor-tab]')],current=tabs.indexOf(event.target.closest('[data-editor-tab]'));if(current<0||!tabs.length)return;
  event.preventDefault();const nextIndex=event.key==='Home'?0:event.key==='End'?tabs.length-1:(current+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length,next=tabs[nextIndex];setEditorTab(next.dataset.editorTab);next.focus();
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
  const remove=document.createElement('button');remove.type='button';remove.className='response-test-remove';remove.textContent='×';remove.setAttribute('aria-label','Remover teste da resposta');remove.onclick=()=>{row.remove();updateAdvancedToolsIndicator();};
  row.dataset.operator=normalized.operator;row.append(responseTestField('Alvo',target,`response-test-target-${row.dataset.testId}`),responseTestField('Campo JSON',path,`response-test-path-${row.dataset.testId}`),responseTestField('Condição',operator,`response-test-operator-${row.dataset.testId}`),responseTestField('Valor esperado',expected,`response-test-expected-${row.dataset.testId}`),remove);
  target.onchange=()=>updateResponseTestRow(row,true);operator.onchange=()=>updateResponseTestRow(row);updateResponseTestRow(row);return row;
}
function setResponseTests(tests){
  const normalized=RunnerLogic.normalizeResponseTests(tests||[]),list=byId('response-tests-list');list.replaceChildren(...normalized.map(createResponseTestRow));renderResponseTestResults([]);updateAdvancedToolsIndicator();
}
function getResponseTestsFromForm(){
  return RunnerLogic.normalizeResponseTests([...byId('response-tests-list').querySelectorAll('.response-test-row')].map(row=>({
    id:row.dataset.testId,target:row.querySelector('.response-test-target').value,path:row.querySelector('.response-test-path').value,
    operator:row.querySelector('.response-test-operator').value,expected:row.querySelector('.response-test-expected').value
  })));
}
function addResponseTest(){
  const list=byId('response-tests-list');if(list.children.length>=20){showToast('Limite de testes','Cada requisição aceita até 20 verificações.','warning');return;}
  const row=createResponseTestRow();list.append(row);row.querySelector('.response-test-target').focus();updateAdvancedToolsIndicator();
}
function responseContractTestResult(request,result){
  const contract=request?.responseContract;
  if(!contract||typeof contract!=='object'||Array.isArray(contract))return null;
  let validation;
  try{validation=RunnerLogic.validateOpenApiResponseContract(contract,result,{method:request.method,route:request.route,baseUrl:request.baseUrl});}
  catch{validation={status:'partial',issues:[],warnings:['Não foi possível validar o contrato importado.']};}
  const details=[...(validation.issues||[]),...(validation.warnings||[])].filter(Boolean);
  return{id:'openapi-response-contract',label:'Contrato OpenAPI da resposta',passed:validation.status==='passed',partial:validation.status==='partial',status:validation.status,message:details.join(' ')};
}
function requestBodyContractTestResult(request){
  const contract=request?.responseContract;
  if(!contract?.requestBody)return null;
  let validation;
  try{validation=RunnerLogic.validateOpenApiRequestBodyContract(contract,request);}
  catch{validation={status:'partial',issues:[],warnings:['Não foi possível validar o body da request.']};}
  if(validation.status==='skipped')return null;
  const details=[...(validation.issues||[]),...(validation.warnings||[])].filter(Boolean);
  return{id:'openapi-request-body-contract',label:'Contrato OpenAPI do body da request',passed:validation.status==='passed',partial:validation.status==='partial',status:validation.status,message:details.join(' ')};
}
function responseTestResultRow(result){
  const row=document.createElement('li');row.className='response-test-result';row.dataset.kind=result.partial?'partial':result.passed?'success':'failure';
  const name=document.createElement('span');name.className='response-test-result-name';name.textContent=result.label;
  const state=document.createElement('span');state.className='response-test-result-state';state.textContent=result.partial?'Parcial':result.passed?'Passou':'Falhou';row.append(name,state);
  if(result.message){const message=document.createElement('span');message.className='response-test-result-message';message.textContent=result.message;row.append(message);}
  return row;
}
function renderRequestBodyContractResult(result){
  const section=byId('request-body-contract-output'),list=byId('request-body-contract-results'),summary=byId('request-body-contract-summary');
  list.replaceChildren();section.hidden=!result;if(!result){summary.textContent='';return;}
  summary.textContent=result.partial?'Parcial':result.passed?'Passou':'Falhou';list.append(responseTestResultRow(result));
}
function clearRequestBodyContractResult(){renderRequestBodyContractResult(null);}
function validateRequestBodyContractFromForm(){
  if(!activeResponseContract?.requestBody){clearRequestBodyContractResult();return null;}
  try{
    const actions=getPreRequestActionsFromForm(),preRequestExecution=byId('pre-request-actions-enabled').checked?RunnerLogic.runPreRequestActions(actions,getEnvironment().variables||{},{},vaultResolutionInput()):{variables:{},provenance:{},vaultSecrets:{}},resolve=value=>applyEnvironment(value,preRequestExecution.variables),bodyMode=byId('body-mode').value,graphql=getGraphqlFieldsFromForm();
    const requestBody=bodyMode==='graphql'?RunnerLogic.buildGraphqlBody(graphql.graphqlQuery,graphql.graphqlVariables,graphql.graphqlOperationName,resolve):resolve(body.value);
    const request={method:method.value,baseUrl:byId('base-url').value.trim(),route:buildRequestRoute(),headers:resolve(byId('headers').value),body:requestBody,bodyMode,responseContract:activeResponseContract};
    const result=requestBodyContractTestResult(request);renderRequestBodyContractResult(result);return result;
  }catch{
    const result={id:'openapi-request-body-contract',label:'Contrato OpenAPI do body da request',passed:false,partial:true,status:'partial',message:'Não foi possível resolver as referências para validar este body.'};
    renderRequestBodyContractResult(result);return result;
  }
}
function responseResultsForRequest(request,result){
  const tests=RunnerLogic.evaluateResponseTests(request?.responseTests,result),contract=responseContractTestResult(request,result);
  return contract?[...tests,contract]:tests;
}
function setActiveResponseContract(contract){
  activeResponseContract=RunnerLogic.sanitizeOpenApiResponseContract(contract);
  updateResponseContractNote();updateRequestBodyContractNote();clearRequestBodyContractResult();updateAdvancedToolsIndicator();
}
function updateRequestBodyContractNote(){
  const panel=byId('request-body-contract-panel'),note=byId('request-body-contract-note'),button=byId('validate-request-body');if(!panel||!note||!button)return;
  const requestBody=activeResponseContract?.requestBody;panel.hidden=!requestBody;button.disabled=!requestBody;
  if(!requestBody){note.textContent='';return;}
  const types=Object.keys(requestBody.content||{}),target=`${activeResponseContract.method||''} ${activeResponseContract.pathTemplate||''}`.trim();
  note.textContent=`${target}${types.length?' aceita '+types.join(', '):' sem mídia de body validável'}${requestBody.required?' e exige body.':' e permite body vazio.'}`+(requestBody.partialReasons?.length?' O schema importado tem regras parciais.':'');
}
function updateResponseContractNote(){
  const note=byId('response-contract-note');if(!note)return;
  if(!activeResponseContract){note.hidden=true;note.textContent='';return;}
  const contract=activeResponseContract,statuses=Object.keys(contract.responses||{}),media=[...new Set(Object.values(contract.responses||{}).flatMap(response=>Object.keys(response?.content||{})))];
  note.textContent=`Contrato OpenAPI importado: ${contract.method||''} ${contract.pathTemplate||''}`+(statuses.length?` · Status ${statuses.join(', ')}`:'')+(media.length?` · ${media.join(', ')}`:'')+(Array.isArray(contract.partialReasons)&&contract.partialReasons.length?' · Parcial':'');
  note.hidden=false;
}
function renderResponseTestResults(results){
  const section=byId('response-tests-output'),list=byId('response-tests-results'),summary=byId('response-tests-summary');list.replaceChildren();section.hidden=!results.length;if(!results.length){summary.textContent='';return;}
  const passed=results.filter(result=>result.passed).length,partial=results.filter(result=>result.partial).length;summary.textContent=`${passed}/${results.length} passaram`+(partial?` · ${partial} parcial(is)`:'');
  for(const result of results)list.append(responseTestResultRow(result));
}
function applyTypography(){
  document.documentElement.style.setProperty('--app-font-family',fontFamilies.get(activeFont)||fontFamilies.get(DEFAULT_FONT));
  byId('font-select').value=activeFont;
}
async function saveFont(name){
  if(!fontFamilies.has(name))return;
  activeFont=name;applyTypography();
  try{await dbWrite('settings',{key:'fontFamily',value:activeFont});showToast('Fonte salva','Preferência aplicada neste navegador.','success',2500);}
  catch(error){showToast('Fonte aplicada',error.message||'Não foi possível salvar a preferência local.','warning');}
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
  catch(error){showToast('Escala aplicada',error.message||'Não foi possível salvar a preferência local.','warning');}
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
  catch(error){showToast('Tema aplicado',error.message||'Não foi possível salvar a preferência local.','warning');}
}
function getEnvironment(){return environments.find(x=>x.id===activeEnvironmentId)||environments[0]||{variables:{}};}
function secretVaultStorageKey(environmentId=activeEnvironmentId){return LOCAL_SECRET_VAULT_PREFIX+(environmentId||'default');}
function vaultResolutionInput(){
  if(secretVaultLoading||secretVaultUnavailable)return{unavailable:true};
  return secretVaultValues?{...secretVaultValues}:{locked:true,names:[...secretVaultNames]};
}
function applyEnvironment(value,preRequestOverrides={}){
  const result=RunnerLogic.resolveTemplateWithProvenance(value,getEnvironment().variables||{},{},vaultResolutionInput(),preRequestOverrides);
  Object.assign(lastResolutionProvenance,result.provenance);
  return result.text;
}
function redactVaultValues(value){return RunnerLogic.redactSecretValues(value,secretVaultValues);}
function addTemplateField(fields,field,value){
  if(value==null)return;
  const text=String(value);
  if(text)fields[field]=text;
}
function templateFieldsFromForm(){
  const fields={};
  addTemplateField(fields,'baseUrl',byId('base-url')?.value);
  addTemplateField(fields,'route',route?.value);
  const params=[...queryParams.children].map(row=>{
    const name=row.querySelector('[data-query-name]')?.value||'',value=row.querySelector('[data-query-value]')?.value||'';
    return name||value?`${name}=${value}`:'';
  }).filter(Boolean).join('\n');
  addTemplateField(fields,'params',params);
  addTemplateField(fields,'headers',byId('headers')?.value);
  const auth=resolveFormAuth();
  if(auth.authType==='bearer')addTemplateField(fields,'auth.bearerToken',auth.bearerToken);
  if(auth.authType==='basic'){addTemplateField(fields,'auth.basicUsername',auth.basicUsername);addTemplateField(fields,'auth.basicPassword',auth.basicPassword);}
  if(auth.authType==='apiKey'){addTemplateField(fields,'auth.apiKeyName',auth.apiKeyName);addTemplateField(fields,'auth.apiKeyValue',auth.apiKeyValue);}
  const mode=normalizeBodyMode(byId('body-mode')?.value);
  if(mode==='graphql'){
    addTemplateField(fields,'graphql.query',byId('graphql-query')?.value);
    addTemplateField(fields,'graphql.variables',byId('graphql-variables')?.value);
    addTemplateField(fields,'graphql.operationName',byId('graphql-operation-name')?.value);
  }else if(mode==='multipart'){
    for(const [index,entry] of readMultipartFieldEntries().entries()){
      if(entry.field.type!=='text')continue;
      addTemplateField(fields,`multipart[${index}].name`,entry.field.name);
      addTemplateField(fields,`multipart[${index}].value`,entry.field.value);
    }
  }else addTemplateField(fields,'body',byId('body')?.value);
  return fields;
}
function templateFieldsFromSavedRequest(request={},authScopes=[]){
  const fields={};
  addTemplateField(fields,'baseUrl',request?.baseUrl);
  addTemplateField(fields,'route',request?.route);
  addTemplateField(fields,'headers',request?.headers);
  const auth=RunnerLogic.resolveInheritedAuth(request||{},authScopes);
  if(auth.authType==='bearer')addTemplateField(fields,'auth.bearerToken',auth.bearerToken);
  if(auth.authType==='basic'){addTemplateField(fields,'auth.basicUsername',auth.basicUsername);addTemplateField(fields,'auth.basicPassword',auth.basicPassword);}
  if(auth.authType==='apiKey'){addTemplateField(fields,'auth.apiKeyName',auth.apiKeyName);addTemplateField(fields,'auth.apiKeyValue',auth.apiKeyValue);}
  const mode=normalizeBodyMode(request?.bodyMode);
  if(mode==='graphql'){
    addTemplateField(fields,'graphql.query',request?.graphqlQuery);
    addTemplateField(fields,'graphql.variables',request?.graphqlVariables);
    addTemplateField(fields,'graphql.operationName',request?.graphqlOperationName);
  }else if(mode==='multipart'){
    for(const [index,field] of (request?.multipartFields||[]).entries()){
      if(field?.type!=='text')continue;
      addTemplateField(fields,`multipart[${index}].name`,field.name);
      addTemplateField(fields,`multipart[${index}].value`,field.value);
    }
  }else addTemplateField(fields,'body',request?.body);
  return fields;
}
function inspectorSourceLabel(source){return({environment:'environment',vault:'vault',dataset:'dataset','pre-request':'pré-request',missing:'missing',locked:'locked',unavailable:'unavailable'})[source]||String(source);}
function formatInspectorOrigins(references){return(references||[]).map(item=>`${item.field}:{{${item.name}}}=${inspectorSourceLabel(item.source)}`).join(', ');}
function inspectSavedRequestOrigins(request,dataset={},authScopes=[]){
  try{const preRequest=request?.preRequestActionsEnabled===false?{}:Object.fromEntries(RunnerLogic.normalizePreRequestActions(request?.preRequestActions).map(action=>[action.name,'']));return RunnerLogic.inspectTemplateReferences(templateFieldsFromSavedRequest(request,authScopes),getEnvironment().variables||{},dataset||{},vaultResolutionInput(),preRequest);}
  catch{return[];}
}
function refreshRequestInspector(){
  const output=byId('request-inspector-output');if(!output)return;
  const count=byId('request-inspector-count');let references=[];
  try{const preRequest=byId('pre-request-actions-enabled').checked?Object.fromEntries(getPreRequestActionsFromForm().map(action=>[action.name,''])):{};references=RunnerLogic.inspectTemplateReferences(templateFieldsFromForm(),getEnvironment().variables||{},{},vaultResolutionInput(),preRequest);}
  catch(error){output.replaceChildren();const item=document.createElement('li');item.className='request-inspector-empty';item.textContent='Inspeção indisponível: '+(error.message||'revise os campos.');output.append(item);if(count)count.textContent='–';return;}
  output.replaceChildren();
  if(count)count.textContent=String(references.length);
  if(!references.length){const item=document.createElement('li');item.className='request-inspector-empty';item.textContent='Nenhuma referência {{...}} nos campos desta request.';output.append(item);return;}
  for(const reference of references){
    const item=document.createElement('li');item.dataset.source=reference.source;
    item.textContent=`${reference.field} · {{${reference.name}}} · ${inspectorSourceLabel(reference.source)}`;
    output.append(item);
  }
}
function refreshAgentSafeState(){
  const output=byId('agent-safe-state-output');
  try{
    const snapshot=window.vortixAgent?.snapshot();
    if(!snapshot)throw Error('O contrato de estado seguro não está carregado.');
    output.textContent=JSON.stringify(snapshot,null,2);output.hidden=false;
  }catch(error){showToast('Estado seguro indisponível',error.message||'Atualize a página e tente novamente.','error');}
}
function resolveAiFriendlyStatus(agent){
  if(!agent||typeof agent.describe!=='function'||typeof agent.snapshot!=='function')return{state:'unavailable',label:'Bridge indisponível',message:'O bridge do Vortix não carregou nesta página. Atualize o Vortix e tente novamente.'};
  if(agent.contractVersion!==2)return{state:'outdated',label:'Bridge desatualizado',message:`Bridge encontrado, mas contrato v${String(agent.contractVersion??'?')} não corresponde ao v2 esperado. Atualize o Vortix.`};
  return{state:'ready',label:'Bridge v2 ativo',message:'Contrato v2 do Vortix ativo nesta página. Esse status não informa se um agente está conectado ao Portal do Maestri. O bridge só expõe controles e metadados seguros; não envia requests nem lê o armazenamento.'};
}
function updateAiFriendlyStatus(){
  const status=resolveAiFriendlyStatus(window.vortixAgent),trigger=byId('ai-friendly-trigger'),label=byId('ai-friendly-trigger-label'),summary=byId('ai-friendly-status'),title=byId('ai-friendly-status-title'),message=byId('ai-friendly-status-text');
  if(trigger){trigger.dataset.state=status.state;trigger.title=status.message;trigger.setAttribute('aria-label',`${status.label}. Abrir ajuda para usar IA.`);}
  if(label)label.textContent=status.label;
  if(summary)summary.dataset.state=status.state;
  if(title)title.textContent=status.label;
  if(message)message.textContent=status.message;
  return status;
}
function syncFullscreenControl(){
  const button=byId('workspace-fullscreen-toggle');if(!button)return false;
  const root=document.documentElement,available=document.fullscreenEnabled===true&&typeof root?.requestFullscreen==='function'&&typeof document.exitFullscreen==='function',active=document.fullscreenElement===root;
  button.disabled=!available;button.setAttribute('aria-pressed',String(active));button.setAttribute('aria-label',available?'Tela cheia':'Tela cheia indisponível');
  let title='Tela cheia indisponível ou bloqueada pelo navegador.';
  if(available)title='Entrar em tela cheia. Pressione Esc para sair.';
  if(available&&active)title='Sair da tela cheia. Esc também sai.';
  button.title=title;
  return available;
}
async function toggleWorkspaceFullscreen(){
  if(!syncFullscreenControl())return;
  try{
    if(document.fullscreenElement===document.documentElement)await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
    syncFullscreenControl();
  }catch{
    syncFullscreenControl();showToast('Não foi possível alterar a tela cheia','O navegador recusou a solicitação. Verifique as permissões da página e tente novamente.','error');
  }
}
function setupFullscreenControl(){
  const button=byId('workspace-fullscreen-toggle');if(button)button.onclick=toggleWorkspaceFullscreen;
  document.addEventListener('fullscreenchange',syncFullscreenControl);syncFullscreenControl();
}
function openAiFriendlyHelp(){updateAiFriendlyStatus();byId('ai-help-dialog').showModal();}
async function copyAiSafeContext(){
  const fallback=byId('ai-safe-context-fallback'),status=byId('ai-safe-context-status');
  if(fallback){fallback.value='';fallback.hidden=true;}
  if(status){status.textContent='';status.hidden=true;}
  const agent=window.vortixAgent,readiness=resolveAiFriendlyStatus(agent);
  if(readiness.state!=='ready'){
    if(status){status.textContent=readiness.message;status.hidden=false;}
    showToast('Contexto seguro indisponível',readiness.message,'error');return;
  }
  let context;
  try{
    const snapshot=agent.snapshot();
    if(snapshot?.contractVersion!==2)throw new Error('O estado seguro não corresponde ao contrato v2. Atualize o Vortix.');
    context=JSON.stringify(snapshot,null,2);
  }catch(error){
    const message=error.message||'Atualize a página e tente novamente.';
    if(status){status.textContent=message;status.hidden=false;}
    showToast('Contexto seguro indisponível',message,'error');return;
  }
  try{
    await copyToClipboard(context);
  }catch{
    const message='O navegador bloqueou a área de transferência. O JSON seguro está selecionado para cópia manual.';
    if(fallback){fallback.value=context;fallback.hidden=false;fallback.focus();fallback.select();}
    if(status){status.textContent=message;status.hidden=false;}
    showToast('Falha ao copiar contexto seguro',message,'error');
  }
}
async function copyMaestriAgentPrompt(){
  const prompt=byId('maestri-agent-prompt')?.textContent?.trim();
  if(!prompt){showToast('Prompt indisponível','Atualize a página e tente novamente.','error');return;}
  try{await copyToClipboard(prompt);}
  catch{showToast('Falha ao copiar prompt','O navegador bloqueou a área de transferência. Selecione o texto e copie manualmente.','error');}
}
function vaultCaptureError(request){
  return RunnerLogic.vaultCaptureEnvironmentError({
    loading:secretVaultLoading,
    unavailable:!!secretVaultUnavailable,
    unlocked:!!(secretVault&&secretVaultValues),
    activeEnvironmentId:activeEnvironmentId||'default',
    vaultEnvironmentId:secretVaultEnvironmentId,
    requestEnvironmentId:request?.environmentId
  });
}
function assertVaultCaptureAvailable(request){const message=vaultCaptureError(request);if(message)throw Error(message);}
function releaseSecretVaultMemory(){
  const vault=secretVault;
  if(vault){try{void vault.lock();}catch{}}
  secretVault=null;secretVaultValues=null;secretVaultEnvelope=null;secretVaultNames=[];secretVaultUnavailable=null;secretVaultLoading=true;secretVaultEnvironmentId='';
}
function renderEnvironmentSelect(){
  const select=byId('environment-select'),entries=RunnerLogic.normalizeEnvironmentPickerEntries(environments);select.replaceChildren();select.disabled=entries.every(entry=>entry.disabled);const groups=new Map();
  for(const env of entries){
    if(env.disabled){const option=document.createElement('option');option.value='';option.textContent=env.name;option.disabled=true;option.selected=true;select.append(option);continue;}
    const group=env.group||'Geral';if(!groups.has(group)){const optionGroup=document.createElement('optgroup');optionGroup.label=group;groups.set(group,optionGroup);select.append(optionGroup);}
    const option=document.createElement('option');option.value=env.id;option.textContent=env.name;option.selected=env.id===activeEnvironmentId;groups.get(group).append(option);}
  void renderCookieJar();
}async function chooseEnvironment(id){
  invalidateStructuredDiagnosticContext();
  if(!environments.some(x=>x.id===id))return;
  if(id===activeEnvironmentId)return;
  releaseSecretVaultMemory();
  activeEnvironmentId=id;clearGraphqlSchema('Ambiente alterado; carregue o schema GraphQL novamente.');clearRequestBodyContractResult();
  await dbWrite('settings',{key:'activeEnvironmentId',value:id});renderEnvironmentSelect();await loadSecretVaultForActiveEnvironment();
  if(baseUrlAuto)byId('base-url').value=Object.hasOwn(getEnvironment().variables||{},'baseUrl')?'{{baseUrl}}':'';
  await loadTokenRequestConfig();await loadOAuth2TokenConfig();await loadOAuthPkceConfig();syncActiveWorkspaceTab(false);
  showToast('Ambiente alterado',`Requests usarão “${getEnvironment().name}”.`,'info',3000);
}

function cookieJarStorageKey(){return'cookiejar:'+(activeEnvironmentId||'default');}
async function renderCookieJar(){
  const list=byId('cookie-jar-list'),count=byId('cookie-jar-count'),clear=byId('clear-cookie-jar'),key=cookieJarStorageKey();
  if(!list||!count||!clear)return;
  try{
    const record=await dbRead('settings',key);
    if(key!==cookieJarStorageKey())return;
    const cookies=Array.isArray(record?.value?.cookies)?record.value.cookies.filter(cookie=>cookie&&typeof cookie==='object'):[];
    list.replaceChildren();count.textContent=String(cookies.length);clear.disabled=!cookies.length;
    if(!cookies.length){const empty=document.createElement('li');empty.className='cookie-jar-empty';empty.textContent='Sem cookies neste ambiente.';list.append(empty);return;}
    for(const cookie of cookies){
      const item=document.createElement('li');item.className='cookie-jar-item';
      const heading=document.createElement('strong');heading.textContent=String(cookie.cookieName||'Cookie');
      const location=document.createElement('span');location.className='cookie-jar-location';location.textContent=String(cookie.cookieDomain||'')+(cookie.hostOnly?' · host':'')+' · '+String(cookie.cookiePath||'/');
      const flags=[cookie.secure?'Secure':'',cookie.httpOnly?'HttpOnly':'',cookie.sameSite?'SameSite='+cookie.sameSite:'SameSite não informado',cookie.expiresUtc?'Expira '+new Date(cookie.expiresUtc).toLocaleString():'Sem expiração'].filter(Boolean);
      const metadata=document.createElement('small');metadata.textContent=flags.join(' · ');
      item.append(heading,location,metadata);list.append(item);
    }
  }catch{
    list.replaceChildren();count.textContent='–';clear.disabled=true;
    const empty=document.createElement('li');empty.className='cookie-jar-empty';empty.textContent='Cookie jar indisponível.';list.append(empty);
  }
}
async function clearCookieJar(){
  const key=cookieJarStorageKey(),environment=getEnvironment();
  try{
    const record=await dbRead('settings',key),count=Array.isArray(record?.value?.cookies)?record.value.cookies.length:0;
    if(!count)return;
    if(!(await confirmWithDialog({eyebrow:'COOKIES',title:'Limpar cookies deste ambiente?',description:'Serão removidos '+count+' cookies de “'+environment.name+'”.',warning:'Outros ambientes não serão alterados.',confirmLabel:'Limpar cookies',danger:true})))return;
    await dbWrite('settings',key,true);await renderCookieJar();showToast('Cookie jar limpo','Cookies removidos do ambiente “'+environment.name+'”.','success');
  }catch(error){showToast('Não foi possível limpar cookies',error.message||'Confira o banco local.','error');}
}

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
    const exportButton=document.createElement('button');exportButton.type='button';exportButton.dataset.exportEnvironment='';exportButton.textContent='Exportar';exportButton.title='Baixar este ambiente como Postman Environment JSON';exportButton.setAttribute('aria-label','Exportar ambiente '+env.name);
    const remove=document.createElement('button');remove.type='button';remove.dataset.removeEnvironment='';remove.textContent='Excluir';remove.setAttribute('aria-label','Excluir ambiente '+env.name);heading.append(name,exportButton,remove);
    name.oninput=()=>exportButton.setAttribute('aria-label','Exportar ambiente '+(name.value.trim()||'sem nome'));
    const groupRow=document.createElement('div');groupRow.className='environment-group-row';const groupLabel=document.createElement('label');groupLabel.textContent='Grupo';
    const group=document.createElement('input');group.className='environment-group';group.value=env.group||'Local';group.maxLength=60;group.placeholder='Ex.: Desenvolvimento';group.setAttribute('aria-label','Grupo do ambiente');groupRow.append(groupLabel,group);
    const varsHeading=document.createElement('div');varsHeading.className='environment-vars-heading';varsHeading.innerHTML='<span>CHAVE</span><span>VALOR</span><span></span>';
    const vars=document.createElement('div');vars.className='environment-vars';for(const[k,v]of Object.entries(env.variables||{}))vars.append(makeVarRow(k,v));
    const add=document.createElement('button');add.className='environment-add-var';add.type='button';add.dataset.addVariable='';add.innerHTML='<span aria-hidden="true">＋</span> Adicionar variável';
    card.append(heading,groupRow,varsHeading,vars,add);list.append(card);
  }
}
function readEnvironmentCard(card){
  const name=card.querySelector('.environment-name').value.trim(),group=card.querySelector('.environment-group').value.trim()||'Geral';
  if(!name){showToast('Nome obrigatório','Informe o nome do ambiente.','error');return null;}
  const variables={};
  for(const row of card.querySelectorAll('.environment-var-row')){
    const key=row.querySelector('.environment-var-name').value.trim(),value=row.querySelector('.environment-var-value').value;
    if(!key&&!value)continue;
    if(!key){showToast('Chave obrigatória','Informe a chave de cada variável preenchida.','error');return null;}
    if(Object.hasOwn(variables,key)){showToast('Chave repetida','A chave '+key+' aparece mais de uma vez.','error');return null;}
    Object.defineProperty(variables,key,{value,enumerable:true,writable:true,configurable:true});
  }
  return{id:card.dataset.environmentId,name,group,variables};
}
async function exportEnvironmentFromCard(card){
  const environment=readEnvironmentCard(card);if(!environment)return;
  let includeSensitive=false;
  if(environmentHasExportableSensitiveCredentials(environment.variables)){
    const choice=await promptWithDialog({eyebrow:'EXPORTAR AMBIENTE',title:'Exportar variáveis sensíveis?',description:'Escolha quais variáveis entram no arquivo Postman Environment JSON.',warning:'O arquivo JSON não é criptografado. O cofre, cookies e chaves privadas nunca são exportados.',selectLabel:'Variáveis sensíveis',selectValue:'omit',selectOptions:[{value:'omit',label:'Omitir variáveis sensíveis (recomendado)'},{value:'include',label:'Incluir variáveis sensíveis'}],confirmLabel:'Continuar'});
    if(choice===null)return;
    if(choice==='include'){
      if(!(await confirmWithDialog({eyebrow:'DADOS SENSÍVEIS',title:'Incluir credenciais no JSON?',description:'O arquivo conterá valores reconhecidos como tokens, senhas ou chaves. Qualquer pessoa com acesso ao arquivo poderá reutilizá-los.',warning:'A exportação não é criptografada. Revise o destino antes de compartilhar.',confirmLabel:'Incluir e exportar',danger:true})))return;
      includeSensitive=true;
    }
  }else if(!(await confirmWithDialog({eyebrow:'EXPORTAR AMBIENTE',title:'Baixar ambiente?',description:'“'+environment.name+'” será exportado como Postman Environment JSON.',warning:'O arquivo JSON não é criptografado. Revise os valores antes de compartilhar; cofre, cookies e chaves privadas não entram no arquivo.',confirmLabel:'Exportar ambiente'})))return;
  try{
    const payload=RunnerLogic.buildPostmanEnvironmentExport(environment,{includeSensitive,id:newId(),exportedAt:new Date().toISOString()}),serialized=JSON.stringify(payload,null,2),blob=new Blob([serialized],{type:'application/json'});
    if(blob.size>10*1024*1024)throw Error('O ambiente ultrapassa o limite de 10 MB.');
    const url=URL.createObjectURL(blob),link=document.createElement('a'),filename=environment.name.normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-|-$/g,'')||'environment';
    link.href=url;link.download=filename+'.postman_environment.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    showToast('Ambiente exportado',includeSensitive?'JSON baixado com variáveis sensíveis. Guarde o arquivo em local seguro.':'JSON baixado; variáveis sensíveis omitidas. Revise antes de compartilhar.','success',6000);
  }catch(error){showToast('Falha ao exportar ambiente',error.message||'Não foi possível gerar o arquivo JSON.','error');}
}
function renderSecretVaultUi(){
  const status=byId('secret-vault-status');if(!status)return;
  const environment=getEnvironment(),unavailable=!!secretVaultUnavailable,loading=!!secretVaultLoading;
  const hasVault=unavailable||!!secretVaultEnvelope||secretVaultNames.length>0,unlocked=!!secretVaultValues&&!unavailable&&!loading;
  byId('secret-vault-locked').hidden=unlocked;byId('secret-vault-unlocked').hidden=!unlocked;
  byId('secret-vault-create').disabled=secretVaultBusy||loading||unavailable||hasVault;
  byId('secret-vault-unlock').disabled=secretVaultBusy||loading||unavailable||!hasVault;
  byId('secret-vault-passphrase').disabled=secretVaultBusy||loading||unavailable;
  byId('secret-vault-add').disabled=secretVaultBusy||loading||unavailable||!unlocked;
  byId('secret-vault-lock').disabled=secretVaultBusy||loading||unavailable||!unlocked;
  byId('secret-vault-remove').disabled=secretVaultBusy||loading;
  byId('secret-vault-name').disabled=secretVaultBusy||loading||unavailable||!unlocked;
  byId('secret-vault-value').disabled=secretVaultBusy||loading||unavailable||!unlocked;
  const state=loading?'Carregando cofre':unavailable?'Cofre indisponível':unlocked?'Cofre desbloqueado':hasVault?'Cofre bloqueado':'Cofre ainda não criado';
  const detail=loading?'Lendo o registro deste ambiente.':unavailable?secretVaultUnavailable:`${secretVaultNames.length} segredo${secretVaultNames.length===1?'':'s'}`;
  status.textContent=`${state} · Ambiente “${environment.name||'ativo'}” · ${detail}`;
  const list=byId('secret-vault-list');list.replaceChildren();
  if(loading){const empty=document.createElement('li');empty.className='secret-vault-empty';empty.textContent='Lendo o cofre deste ambiente…';list.append(empty);return;}
  if(unavailable){const empty=document.createElement('li');empty.className='secret-vault-empty';empty.textContent='Cofre indisponível. Os nomes e valores não são exibidos até a leitura ser confirmada.';list.append(empty);return;}
  if(!secretVaultNames.length){const empty=document.createElement('li');empty.className='secret-vault-empty';empty.textContent=unlocked?'Nenhum segredo neste cofre.':'O cofre não tem segredos ou ainda não foi criado.';list.append(empty);return;}
  for(const name of [...secretVaultNames].sort((left,right)=>left.localeCompare(right))){
    const item=document.createElement('li');item.className='secret-vault-item';
    const label=document.createElement('strong');label.textContent=name;label.title='Nome do segredo; o valor nunca é exibido.';
    const actions=document.createElement('span');actions.className='secret-vault-item-actions';
    if(unlocked){
      const edit=document.createElement('button');edit.type='button';edit.className='text-button';edit.textContent='Editar';edit.setAttribute('aria-label','Editar segredo '+name);edit.onclick=()=>{byId('secret-vault-name').value=name;byId('secret-vault-name').dataset.editingName=name;byId('secret-vault-value').value='';byId('secret-vault-value').focus();};
      const remove=document.createElement('button');remove.type='button';remove.className='text-button';remove.textContent='Remover';remove.setAttribute('aria-label','Remover segredo '+name);remove.onclick=()=>void removeSecretVaultEntry(name);
      actions.append(edit,remove);
    }
    item.append(label,actions);list.append(item);
  }
}
async function loadSecretVaultForActiveEnvironment(){
  const expected=activeEnvironmentId||'default';
  secretVault=null;secretVaultValues=null;secretVaultEnvelope=null;secretVaultNames=[];secretVaultUnavailable=null;secretVaultLoading=true;secretVaultEnvironmentId=expected;
  renderSecretVaultUi();
  try{
    const record=await dbRead('settings',secretVaultStorageKey(expected));
    if(expected!==secretVaultEnvironmentId)return;
    if(record==null)return;
    const envelope=record?.value?.envelope??record?.value;
    if(!envelope||typeof envelope!=='object'||Array.isArray(envelope)||envelope.format!==RunnerLogic.localSecretVaultFormat||envelope.version!==1||envelope.cipher!=='AES-GCM-256'||envelope.kdf!=='PBKDF2-SHA-256'||!Number.isInteger(envelope.iterations)||envelope.iterations<1||typeof envelope.salt!=='string'||!envelope.salt||typeof envelope.iv!=='string'||!envelope.iv||typeof envelope.ciphertext!=='string'||!envelope.ciphertext){
      secretVaultUnavailable='O registro do cofre está inválido; o envio com templates foi bloqueado até o registro ser corrigido ou removido.';
      return;
    }
    secretVaultEnvelope=envelope;secretVaultNames=Array.isArray(envelope.names)?envelope.names.map(String):[];
  }catch{
    if(expected===secretVaultEnvironmentId)secretVaultUnavailable='Não foi possível ler o cofre deste ambiente; o envio com templates foi bloqueado para evitar usar valores obsoletos do ambiente.';
  }finally{
    if(expected===secretVaultEnvironmentId){secretVaultLoading=false;renderSecretVaultUi();refreshRequestInspector();}
  }
}
async function persistSecretVaultSnapshot(){
  const vault=secretVault;if(!vault)throw Error('Desbloqueie o cofre para salvar segredos.');
  const environmentId=secretVaultEnvironmentId||activeEnvironmentId||'default',envelope=await vault.toEnvelope();
  if(secretVault!==vault||secretVaultEnvironmentId!==environmentId)throw Error('O cofre ou o ambiente ativo mudou antes de salvar.');
  await dbWrite('settings',{key:secretVaultStorageKey(environmentId),value:envelope});
  if(secretVault!==vault||secretVaultEnvironmentId!==environmentId)throw Error('O cofre foi bloqueado antes de confirmar a gravação.');
  secretVaultEnvelope=envelope;secretVaultNames=Array.isArray(envelope.names)?envelope.names.map(String):[];secretVaultUnavailable=null;
}
async function recoverSecretVaultAfterFailure(){
  releaseSecretVaultMemory();
  await loadSecretVaultForActiveEnvironment();
  if(!secretVaultEnvelope&&!secretVaultUnavailable)secretVaultUnavailable='O cofre não foi confirmado no armazenamento; os valores em memória foram descartados. Recarregue a página para tentar novamente.';
  renderSecretVaultUi();refreshRequestInspector();
}
async function createSecretVaultFromUi(){
  invalidateStructuredDiagnosticContext();
  if(secretVaultBusy)return;
  if(secretVaultLoading||secretVaultUnavailable){showToast('Cofre indisponível','Não crie um cofre enquanto o registro atual não puder ser lido. Recarregue ou remova o registro inválido.','warning');return;}
  if(secretVaultEnvelope){showToast('Cofre já existe','Desbloqueie o cofre existente ou remova-o antes de criar outro.','warning');return;}
  const input=byId('secret-vault-passphrase'),passphrase=input.value;
  if(Array.from(passphrase).length<RunnerLogic.workspaceBackupPassphraseMinLength){showToast('Senha muito curta','Use pelo menos '+RunnerLogic.workspaceBackupPassphraseMinLength+' caracteres.','warning');input.focus();return;}
  secretVaultBusy=true;renderSecretVaultUi();
  try{
    const vault=await RunnerLogic.createLocalSecretVault(passphrase);secretVault=vault;secretVaultValues=Object.create(null);secretVaultEnvironmentId=activeEnvironmentId||'default';
    await persistSecretVaultSnapshot();showToast('Cofre criado','Segredos deste ambiente serão cifrados com AES-GCM-256. A senha não é salva e não pode ser recuperada.','success',7000);
  }catch(error){await recoverSecretVaultAfterFailure();showToast('Não foi possível criar o cofre','A criação não foi confirmada no armazenamento. '+(error.message||'Revise a senha e o armazenamento.'),'error');}
  finally{secretVaultBusy=false;input.value='';renderSecretVaultUi();refreshRequestInspector();if(secretVaultValues)byId('secret-vault-value').focus();}
}
async function unlockSecretVaultFromUi(){
  invalidateStructuredDiagnosticContext();
  if(secretVaultBusy)return;
  if(secretVaultLoading||secretVaultUnavailable){showToast('Cofre indisponível','Não desbloqueie um cofre cujo registro não pôde ser lido. Recarregue ou remova o registro.','warning');return;}
  if(!secretVaultEnvelope){showToast('Crie o cofre','Defina uma senha de pelo menos 12 caracteres para criar o cofre deste ambiente.','info');return;}
  const input=byId('secret-vault-passphrase'),passphrase=input.value,expected=secretVaultEnvironmentId||activeEnvironmentId||'default';
  secretVaultBusy=true;renderSecretVaultUi();
  try{
    const vault=await RunnerLogic.openLocalSecretVault(JSON.stringify(secretVaultEnvelope),passphrase);
    const names=await vault.names(),values=Object.create(null);
    for(const name of names)Object.defineProperty(values,name,{value:await vault.get(name),enumerable:true,writable:true,configurable:true});
    if(expected!==secretVaultEnvironmentId){await vault.lock();return;}
    secretVault=vault;secretVaultValues=values;secretVaultNames=names;secretVaultEnvironmentId=expected;
    showToast('Cofre desbloqueado','Segredos disponíveis apenas na memória desta aba até bloquear ou recarregar.','success');
  }catch(error){secretVault=null;secretVaultValues=null;showToast('Não foi possível desbloquear',error.message||'Senha incorreta ou cofre danificado.','error');}
  finally{secretVaultBusy=false;input.value='';renderSecretVaultUi();refreshRequestInspector();if(secretVaultValues)byId('secret-vault-name').focus();}
}
async function lockSecretVaultFromUi(){
  invalidateStructuredDiagnosticContext();
  if(secretVault){try{await secretVault.lock();}catch{}}
  secretVault=null;secretVaultValues=null;renderSecretVaultUi();refreshRequestInspector();showToast('Cofre bloqueado','Os valores descriptografados foram removidos da memória desta aba.','info');
}
async function addSecretVaultEntry(event){
  invalidateStructuredDiagnosticContext();
  event?.preventDefault?.();
  if(secretVaultLoading||secretVaultUnavailable){showToast('Cofre indisponível','Não adicione segredos enquanto o registro não puder ser confirmado.','warning');return;}
  if(!secretVaultValues||!secretVault){showToast('Cofre bloqueado','Desbloqueie o cofre antes de adicionar segredos.','warning');return;}
  const nameInput=byId('secret-vault-name'),valueInput=byId('secret-vault-value');
  const name=nameInput.value.trim(),value=valueInput.value,editingName=nameInput.dataset.editingName||'',vault=secretVault,values=secretVaultValues;
  if(!name){nameInput.focus();showToast('Nome obrigatório','Informe o nome do segredo.','warning');return;}
  try{
    await vault.set(name,value);
    if(editingName&&editingName!==name)await vault.remove(editingName);
    await persistSecretVaultSnapshot();
    if(secretVault!==vault||secretVaultValues!==values)throw Error('O cofre foi bloqueado antes de confirmar a gravação.');
    if(editingName&&editingName!==name)delete values[editingName];
    Object.defineProperty(values,name,{value,writable:true,enumerable:true,configurable:true});
    delete nameInput.dataset.editingName;nameInput.value='';valueInput.value='';nameInput.focus();
    showToast('Segredo salvo',`{{${name}}} foi cifrado no cofre do ambiente “${getEnvironment().name}”. O valor não é exibido.`,'success');
    renderSecretVaultUi();refreshRequestInspector();
  }catch(error){await recoverSecretVaultAfterFailure();showToast('Segredo não salvo','O valor não foi confirmado no armazenamento e foi descartado. '+(error.message||'Não foi possível atualizar o cofre.'),'error');}
}
async function removeSecretVaultEntry(name){
  invalidateStructuredDiagnosticContext();
  if(secretVaultLoading||secretVaultUnavailable){showToast('Cofre indisponível','Não remova segredos enquanto o registro não puder ser confirmado.','warning');return;}
  if(!secretVaultValues||!secretVault){showToast('Cofre bloqueado','Desbloqueie o cofre antes de remover segredos.','warning');return;}
  if(!(await confirmWithDialog({eyebrow:'COFRE DE SEGREDOS',title:'Remover segredo?',description:`O nome “${name}” será removido do cofre do ambiente “${getEnvironment().name}”.`,warning:'O valor não pode ser recuperado depois desta ação.',confirmLabel:'Remover segredo',danger:true})))return;
  const vault=secretVault,values=secretVaultValues;
  try{
    await vault.remove(name);await persistSecretVaultSnapshot();
    if(secretVault!==vault||secretVaultValues!==values)throw Error('O cofre foi bloqueado antes de confirmar a gravação.');
    delete values[name];
    renderSecretVaultUi();refreshRequestInspector();showToast('Segredo removido',`O nome “${name}” saiu do cofre.`,'success');
  }catch(error){await recoverSecretVaultAfterFailure();showToast('Segredo não removido','A remoção não foi confirmada no armazenamento. '+(error.message||'Não foi possível atualizar o cofre.'),'error');}
}
async function removeSecretVault(){
  invalidateStructuredDiagnosticContext();
  if(!secretVaultEnvelope&&!secretVaultNames.length&&!secretVaultUnavailable)return;
  if(!(await confirmWithDialog({eyebrow:'COFRE DE SEGREDOS',title:'Remover o cofre deste ambiente?',description:`Todos os segredos do ambiente “${getEnvironment().name}” serão removidos do armazenamento local.`,warning:'A senha não é armazenada; sem o cofre, os valores não podem ser recuperados.',confirmLabel:'Remover cofre',danger:true})))return;
  const environmentId=secretVaultEnvironmentId||activeEnvironmentId||'default';
  releaseSecretVaultMemory();renderSecretVaultUi();
  try{
    await dbWrite('settings',secretVaultStorageKey(environmentId),true);
    await loadSecretVaultForActiveEnvironment();
    if(secretVaultEnvelope||secretVaultUnavailable)throw Error('O cofre ainda está presente após a remoção.');
    showToast('Cofre removido','O cofre deste ambiente foi removido do armazenamento local.','success');
  }catch(error){await recoverSecretVaultAfterFailure();showToast('Cofre não removido','O registro anterior foi recarregado ou bloqueado. '+(error.message||'Não foi possível atualizar o armazenamento.'),'error');}
}
function openSettingsDialog(){syncHistorySettingsControls();renderSecretVaultUi();byId('settings-dialog').showModal();}
function openEnvironmentDialog(){environmentDraft=JSON.parse(JSON.stringify(environments));renderEnvironmentDraft();byId('environment-dialog').showModal();}
function addEnvironmentDraft(){environmentDraft.push({id:newId(),name:'Novo ambiente',group:'Local',variables:{}});renderEnvironmentDraft();byId('environment-list').lastElementChild.querySelector('.environment-name').focus();}
async function saveEnvironmentDraft(event){
  invalidateStructuredDiagnosticContext();
  event.preventDefault();const next=[];
  for(const card of byId('environment-list').children){
    const environment=readEnvironmentCard(card);if(!environment)return;next.push(environment);
  }
  if(!next.length){showToast('Mantenha um ambiente','Crie pelo menos um ambiente.','error');return;}
  try{
    const ids=new Set(next.map(x=>x.id)),removedIds=new Set(environments.filter(env=>!ids.has(env.id)).map(env=>env.id));
    if(removedIds.has(secretVaultEnvironmentId)||removedIds.has(activeEnvironmentId||'default'))releaseSecretVaultMemory();
    for(const env of environments)if(!ids.has(env.id)){await dbWrite('environments',env.id,true);await dbWrite('settings',TOKEN_REQUEST_CONFIG_KEY+':'+env.id,true);await dbWrite('settings',oauth2TokenConfigStorageKey(env.id),true);await dbWrite('settings',oauth2TokenMetadataStorageKey(env.id),true);await dbWrite('settings',oauthPkceConfigStorageKey(env.id),true);await dbWrite('settings','cookiejar:'+env.id,true);await dbWrite('settings',secretVaultStorageKey(env.id),true);}
    for(const env of next)await dbWrite('environments',env);environments=next;
    if(!environments.some(x=>x.id===activeEnvironmentId))activeEnvironmentId=environments[0].id;
    if(!next.some(env=>env.id===secretVaultEnvironmentId))await loadSecretVaultForActiveEnvironment();
    environmentDraft=[];await dbWrite('settings',{key:'activeEnvironmentId',value:activeEnvironmentId});renderEnvironmentSelect();await loadTokenRequestConfig();await loadOAuth2TokenConfig();await loadOAuthPkceConfig();
    if(baseUrlAuto)byId('base-url').value=Object.hasOwn(getEnvironment().variables||{},'baseUrl')?'{{baseUrl}}':'';
    byId('environment-dialog').close();showToast('Ambientes salvos','Grupos e variáveis persistidos no banco local.','success');
  }catch(error){showToast('Falha ao salvar',error.message||'Não foi possível persistir os ambientes.','error');}
}
function tokenCandidate(value){if(typeof value!=='string')return'';const token=value.trim().replace(/^Bearer\s+/i,'');return token.length>=16&&!/\s/.test(token)?token:'';}
function findToken(value,depth=0){if(!value||typeof value!=='object'||depth>4)return'';for(const[key,child]of Object.entries(value))if(['access_token','accesstoken','token','bearer','jwt'].includes(key.toLowerCase())){const token=tokenCandidate(child);if(token)return token;}for(const child of Object.values(value)){const token=findToken(child,depth+1);if(token)return token;}return'';}
function extractToken(raw){try{const parsed=JSON.parse(raw);return typeof parsed==='string'?tokenCandidate(parsed):findToken(parsed);}catch{return tokenCandidate(raw);}}

function updateResponseExamplesUi(){
  const saveButton=byId('save-response-example'),saveHint=byId('response-example-save-hint'),panel=byId('response-examples-panel'),list=byId('response-examples-list');
  if(!saveButton||!saveHint||!panel||!list)return;
  const request=findSavedResponseExampleRequest(),examples=RunnerLogic.normalizeResponseExamples(request?.responseExamples);
  const tab=activeWorkspaceTab(),candidate=currentResponseExample;
  const canSave=!!request&&!!candidate&&candidate.requestId===request.id&&candidate.collectionId===activeSaved.collectionId&&candidate.folderId===(activeSaved.folderId||'')&&(!tab||!tab.dirty);
  const hint=!request?'Salve a request na coleção para guardar exemplos.':tab?.dirty?'Salve as alterações da request antes de guardar um exemplo.':!candidate?'Envie a request salva para guardar a resposta como exemplo.':'';
  saveButton.disabled=!canSave;
  saveButton.title=canSave?'Salvar esta resposta na request da coleção':hint;
  saveButton.setAttribute('aria-describedby','response-example-save-hint');
  saveHint.textContent=hint;saveHint.hidden=!hint;
  byId('response-examples-count').textContent=String(examples.length);
  panel.hidden=!request||examples.length===0;
  const expanded=new Set(Array.from(list.querySelectorAll('details[open]'),item=>item.dataset.exampleId));
  list.replaceChildren();
  for(const example of examples){
    const item=document.createElement('details');item.className='response-example-item';item.dataset.exampleId=example.id;item.open=expanded.has(example.id);
    const summary=document.createElement('summary'),name=document.createElement('span'),status=document.createElement('span');
    name.className='response-example-name';name.textContent=example.name;
    status.className='response-example-status';status.dataset.kind=example.status>=200&&example.status<300?'success':'failure';status.textContent='HTTP '+example.status;
    summary.append(name,status);
    const content=document.createElement('div');content.className='response-example-content';
    const headersSection=document.createElement('section'),headersTitle=document.createElement('h3'),headers=document.createElement('pre');
    headersTitle.textContent='Headers';headers.textContent=JSON.stringify(example.headers,null,2)||'{}';headersSection.append(headersTitle,headers);
    const bodySection=document.createElement('section'),bodyTitle=document.createElement('h3'),bodyOutput=document.createElement('pre');
    bodyTitle.textContent='Body';bodyOutput.textContent=example.body||'(body vazio)';bodySection.append(bodyTitle,bodyOutput);
    const actions=document.createElement('div');actions.className='response-example-actions';
    const simulate=document.createElement('button');simulate.type='button';simulate.className='text-button response-example-simulate';simulate.textContent='Simular local';simulate.setAttribute('aria-label','Simular localmente: '+example.name);simulate.title='Usa este exemplo sem chamar a API';simulate.onclick=()=>void simulateSavedResponseExample(example.id);actions.append(simulate);
    const remove=document.createElement('button');remove.type='button';remove.className='text-button response-example-delete';remove.textContent='Excluir';remove.setAttribute('aria-label','Excluir exemplo '+example.name);remove.onclick=()=>void deleteSavedResponseExample(example.id);actions.append(remove);
    content.append(headersSection,bodySection,actions);item.append(summary,content);list.append(item);
  }
}
function clearCurrentResponseExample(){
  currentResponseExample=null;
  const form=byId('response-example-save-form');
  if(form){form.hidden=true;byId('response-example-name').value='';}
}
function openResponseExampleForm(){
  const button=byId('save-response-example');if(button.disabled)return;
  const form=byId('response-example-save-form'),name=byId('response-example-name');
  name.value='HTTP '+currentResponseExample.status;form.hidden=false;name.focus();name.select();
}
function closeResponseExampleForm(){
  byId('response-example-save-form').hidden=true;byId('save-response-example').focus();
}
async function saveResponseExample(event){
  event.preventDefault();
  const candidate=currentResponseExample,name=byId('response-example-name').value.trim(),request=findSavedResponseExampleRequest(),tab=activeWorkspaceTab();
  if(!candidate||!request||candidate.requestId!==activeSaved?.id||candidate.collectionId!==activeSaved?.collectionId||candidate.folderId!==(activeSaved.folderId||'')||(tab&&tab.dirty)){
    showToast('Resposta indisponível','Envie novamente a request salva antes de guardar um exemplo.','warning');return;
  }
  if(!name){byId('response-example-name').focus();return;}
  const collection=findCollection(activeSaved.collectionId),container=findFolder(collection,activeSaved.folderId),index=container?.requests?.findIndex(item=>item.id===activeSaved.id)??-1;
  if(!collection||!container||index<0){showToast('Request não encontrada','Salve a request na coleção antes de adicionar exemplos.','error');return;}
  const saved=container.requests[index],example={id:newId(),name,status:candidate.status,headers:candidate.headers,body:candidate.body,savedAt:new Date().toISOString()};
  try{
    container.requests[index]=RunnerLogic.appendResponseExampleToRequest(saved,example);
    await dbWrite('collections',collection);
  }catch(error){
    container.requests[index]=saved;
    const message=error.message||'Não foi possível guardar o exemplo.';
    showToast(message.includes('20')?'Limite de exemplos':'Falha ao salvar exemplo',message,'error');return;
  }
  closeResponseExampleForm();renderCollectionTree();updateCopyButtons();
  showToast('Exemplo salvo','HTTP '+example.status+' guardado na request da coleção.','success',3500);
}
async function deleteSavedResponseExample(exampleId){
  const request=findSavedResponseExampleRequest();if(!request||!activeSaved)return;
  if(!(await confirmWithDialog({eyebrow:'EXEMPLOS',title:'Excluir este exemplo?',description:'O exemplo será removido da request salva.',confirmLabel:'Excluir exemplo',danger:true})))return;
  const collection=findCollection(activeSaved.collectionId),container=findFolder(collection,activeSaved.folderId),index=container?.requests?.findIndex(item=>item.id===activeSaved.id)??-1;
  if(!collection||!container||index<0)return;
  const saved=container.requests[index],examples=RunnerLogic.normalizeResponseExamples(saved.responseExamples);
  container.requests[index]={...saved,responseExamples:examples.filter(example=>example.id!==exampleId)};
  try{await dbWrite('collections',collection);}
  catch(error){container.requests[index]=saved;showToast('Falha ao excluir',error.message||'A coleção não foi atualizada no banco local.','error');return;}
  renderCollectionTree();updateCopyButtons();showToast('Exemplo excluído','O exemplo foi removido da request.','success',3000);
}
function resolveSavedResponseExampleRoute(value){
  const parts=RunnerLogic.splitRoute(value),route=applyEnvironment(parts.route);
  const pairs=parts.params.map(([name,paramValue])=>`${encodeParam(applyEnvironment(name))}=${encodeParam(applyEnvironment(paramValue))}`);
  return route+(pairs.length?'?'+pairs.join('&'):'');
}
async function simulateSavedResponseExample(exampleId){
  clearCurrentResponseExample();
  const saved=findSavedResponseExampleRequest();
  if(!activeSaved||!saved){const message='Salve e abra a request da coleção antes de simular um exemplo.';showResponse('Mock indisponível','bad','',message);showToast('Mock indisponível',message,'warning');return;}
  let mock;
  try{
    const rawBaseUrl=byId('base-url').value.trim();let resolvedBaseUrl=rawBaseUrl;try{resolvedBaseUrl=applyEnvironment(rawBaseUrl);}catch{}
    const current={method:method.value,route:buildRequestRoute(true),baseUrl:resolvedBaseUrl};
    const source={...saved,route:resolveSavedResponseExampleRoute(saved.route||'')};
    mock=RunnerLogic.buildResponseExampleMock(current,source,exampleId);
  }catch(error){const message=error.message||'Confira método, rota e Params da request.';showResponse('Mock indisponível','bad','',message);showToast('Mock indisponível',message,'warning');return;}
  showResponse('HTTP '+mock.status+' · Mock local',mock.status>=200&&mock.status<300?'ok':'bad',JSON.stringify(mock.headers,null,2),mock.body);
  byId('response-persistence-note').textContent='Resposta simulada · não armazenada';
  byId('request-note').textContent='Resposta simulada com dados locais. Nenhuma requisição foi enviada.';
  const results=responseResultsForRequest({...source,method:current.method,route:current.route,baseUrl:current.baseUrl,responseTests:getResponseTestsFromForm(),responseContract:source.responseContract||activeResponseContract},mock);renderResponseTestResults(results);
  const failed=results.filter(item=>!item.passed&&!item.partial).length,partial=results.filter(item=>item.partial).length;
  const summaryText=failed?`${results.length-failed}/${results.length} verificações passaram. Nenhuma API foi chamada.`:partial?'Contrato OpenAPI parcial; nenhuma API foi chamada.':`HTTP ${mock.status}. Nenhuma API foi chamada.`;
  showToast(failed?'Mock executado; testes falharam':partial?'Mock com contrato parcial':'Resposta simulada',summaryText,failed?'warning':'info');
  await captureResponseVariable({captureResponseVariable:byId('capture-response-variable').checked,environmentId:activeEnvironmentId||'default',responseVariableName:byId('response-variable-name').value.trim(),responseValueSource:byId('response-value-source').value,responseJsonPath:byId('response-json-path').value.trim(),responseSuccessOnly:byId('response-success-only').checked,responseCaptureTarget:byId('response-capture-target').value==='vault'?'vault':'environment'},mock);
}
function updateCopyButtons(){
  const headers=byId('response-headers');byId('copy-headers').disabled=headers.classList.contains('empty')||!headers.textContent.trim();
  byId('copy-body').disabled=!responseBodyState.raw;
  updateResponseExamplesUi();
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
  updateInsomniaScriptPreview();updateAdvancedToolsIndicator();
}
function validateResponseCaptureForm(){
  if(!byId('capture-response-variable').checked)return;
  const name=byId('response-variable-name').value.trim();if(!/^[A-Za-z0-9_.-]{1,80}$/.test(name)||['__proto__','prototype','constructor'].includes(name))throw Error('Informe um nome de variável válido (até 80 caracteres).');
  if(byId('response-value-source').value==='json'){const path=byId('response-json-path').value.trim();if(!path)throw Error('Informe o caminho do campo JSON, por exemplo access_token.');parseJsonPath(path);}
  if(byId('response-capture-target').value==='vault')assertVaultCaptureAvailable({environmentId:activeEnvironmentId||'default'});
}
function showResponseVariableResult(title,kind='success'){const section=byId('response-variable-result');section.hidden=false;section.dataset.kind=kind;byId('response-variable-result-title').textContent=title;}
async function saveEnvironmentVariable(name,value,environmentId=activeEnvironmentId){
  if(!/^[A-Za-z0-9_.-]{1,80}$/.test(name)||['__proto__','prototype','constructor'].includes(name))throw Error('Nome da variável inválido.');
  const serialized=typeof value==='string'?value:JSON.stringify(value);if(serialized===undefined||serialized.length>100000)throw Error('O valor está vazio ou excede 100 KB.');
  const current=environments.find(environment=>environment.id===environmentId);if(!current)throw Error('Ambiente de captura indisponível.');const updated={...current,variables:{...(current.variables||{})}};Object.defineProperty(updated.variables,name,{value:serialized,writable:true,enumerable:true,configurable:true});
  await dbWrite('environments',updated);environments=environments.map(environment=>environment.id===updated.id?updated:environment);renderEnvironmentSelect();return updated;
}
async function captureResponseVariable(request,result,quiet=false){
  if(!request.captureResponseVariable)return{ok:true,captured:false};const status=Number(result.status)||0;
  if(request.responseSuccessOnly&&!(status>=200&&status<300)){const message=`Não salvo: resposta HTTP ${status}.`;if(!quiet)showResponseVariableResult(message,'warning');return{ok:false,captured:false,error:message};}
  try{
    const name=String(request.responseVariableName||'').trim();
    const value=request.responseValueSource==='text'?String(result.body??''):jsonPathValue(JSON.parse(String(result.body??'')),request.responseJsonPath);
    if(request.responseCaptureTarget==='vault'){
      assertVaultCaptureAvailable(request);
      const vault=secretVault,values=secretVaultValues;
      try{
        await vault.set(name,value);
        await persistSecretVaultSnapshot();
        if(secretVault!==vault||secretVaultValues!==values)throw Error('O cofre foi bloqueado antes de confirmar a captura.');
        Object.defineProperty(values,name,{value,writable:true,enumerable:true,configurable:true});
      }catch(error){
        await recoverSecretVaultAfterFailure();
        throw Error('A captura no cofre não foi confirmada no armazenamento; nenhum valor foi copiado para o ambiente. '+(error.message||''));
      }
      if(!quiet){showResponseVariableResult(`{{${name}}} salva no cofre do ambiente “${getEnvironment().name}”.`);showToast('Segredo salvo',`{{${name}}} está no cofre cifrado. O valor não é exibido.`,'success');}
      return{ok:true,captured:true,name,target:'vault',environment:getEnvironment().name};
    }
    const updated=await saveEnvironmentVariable(name,value,request.environmentId||activeEnvironmentId);
    if(!quiet){showResponseVariableResult(`{{${name}}} salva no ambiente “${updated.name}”.`);showToast('Variável salva',`{{${name}}} já pode ser usada nas próximas requests.`,'success');}
    return{ok:true,captured:true,name,target:'environment',environment:updated.name};
  }catch(error){const message=error.message||'Não foi possível ler o valor da resposta.';if(!quiet){showResponseVariableResult(message,'error');showToast('Variável não salva',message,'error');}return{ok:false,captured:true,error:message};}
}
function getStructuredSources(input){
  const collection=findCollection(input.collectionId),container=findFolder(collection,input.folderId||'');
  const saved=container?.requests?.find(item=>item.id===input.requestId);
  if(!saved)throw Object.assign(Error('request_not_found'),{code:'request_not_found'});
  const environment=environments.find(item=>item.id===input.environmentId);
  if(!environment)throw Object.assign(Error('environment_not_found'),{code:'environment_not_found'});
  const current=activeWorkspaceTab();
  return structuredClone({saved,environment,authScopes:authScopesForContainer(input.collectionId,input.folderId||''),
    vault:input.environmentId===activeEnvironmentId?vaultResolutionInput():{unavailable:true},
    vaultCaptureReady:!vaultCaptureError({environmentId:input.environmentId}),historySettings,
    origin:{tabId:current?.id||'',requestId:input.requestId,collectionId:input.collectionId,folderId:input.folderId||''},
    editorDirty:!!current?.dirty,activeEnvironmentId,activeSaved});
}
async function runStructuredRequest(prepared){
  const call={...prepared.call},started=performance.now();
  const facts={delivery:'not_sent',httpStatus:null,proxyStatus:null,durationMs:0,assertions:{passed:0,failed:0,partial:0},capture:call.captureResponseVariable?'skipped':'not_requested',persistence:'not_requested'};
  if(requestSendInProgress)return{...facts,outcome:'local_error'};
  requestSendInProgress=true;updateGuard();
  const isCurrent=()=>activeWorkspaceTab()?.id===prepared.origin.tabId&&activeSaved?.id===prepared.origin.requestId&&!activeWorkspaceTab()?.dirty;
  try{
    call.confirmTestData=writeMethods.has(call.method);call.testDataPhrase=call.confirmTestData?'TESTE':'';
    const input={collectionId:prepared.origin.collectionId,folderId:prepared.origin.folderId||null,requestId:prepared.origin.requestId,environmentId:call.environmentId};
    if(JSON.stringify(getStructuredSources(input))!==prepared.sourceStamp)return{...facts,outcome:'local_error',durationMs:performance.now()-started};
    const historyEntry=await saveHistory(prepared.historyRequest,{quiet:true});
    if(!historyEntry)return{...facts,outcome:'local_error',persistence:'failed',durationMs:performance.now()-started};
    facts.persistence='completed';
    if(JSON.stringify(getStructuredSources(input))!==prepared.sourceStamp)return{...facts,outcome:'local_error',durationMs:performance.now()-started};
    if(isCurrent()){clearCurrentResponseExample();showResponse('Enviando…','pending','','');renderResponseTestResults([]);}
    facts.delivery='unknown';
    const {proxyStatus,result}=await executeApiRequest(call);
    facts.proxyStatus=proxyStatus;
    const status=Number(result?.status);
    const received=!result?.error&&proxyStatus<400&&Number.isInteger(status)&&status>=100&&status<=599;
    if(received){facts.delivery='response_received';facts.httpStatus=status;}
    const persisted=await saveHistoryResponse(historyEntry,result,performance.now()-started,prepared.secrets,{quiet:true,historySettings:prepared.historySettings});
    facts.persistence=persisted?'completed':'failed';
    if(!received){
      if(isCurrent())showResponse('Falha de transporte','bad','','Resultado remoto desconhecido. Não repita uma escrita sem conferir a API.');
      return{...facts,outcome:'transport_error',durationMs:performance.now()-started};
    }
    const bodyValidation=requestBodyContractTestResult(call),tests=[...(bodyValidation?[bodyValidation]:[]),...responseResultsForRequest(call,result)];
    facts.assertions={passed:tests.filter(item=>item.passed&&!item.partial).length,failed:tests.filter(item=>!item.passed&&!item.partial).length,partial:tests.filter(item=>item.partial).length};
    if(isCurrent()){
      const redact=value=>RunnerLogic.redactSecretValues(String(value??''),prepared.secrets);
      showResponse(String(status),status>=200&&status<300?'ok':'bad',redact(JSON.stringify(result.headers||{},null,2)),redact(result.body));
      renderResponseTestResults(tests);renderRequestBodyContractResult(bodyValidation);
      byId('response-persistence-note').textContent=facts.persistence==='completed'?'Resposta salva no histórico':'Resposta recebida; histórico não confirmado';
    }
    if(call.captureResponseVariable){
      const capture=await captureResponseVariable(call,result,true);
      facts.capture=capture.ok?'completed':capture.captured?'failed':'skipped';
    }
    return facts;
  }catch{return{...facts,outcome:facts.delivery==='not_sent'?'local_error':facts.delivery==='response_received'?'local_error':'transport_error',durationMs:performance.now()-started};}
  finally{facts.durationMs=Math.max(0,performance.now()-started);requestSendInProgress=false;updateGuard();}
}
function getDiagnosticReadiness(origin){
  const tab=activeWorkspaceTab(),saved=activeSaved,requestSaved=!!saved,source=origin||(!saved?null:{collectionId:saved.collectionId,folderId:saved.folderId||'',requestId:saved.id,environmentId:activeEnvironmentId});
  const collection=source?findCollection(source.collectionId):null,container=source?findFolder(collection,source.folderId||''):null;
  const requestExists=!!source&&!!container?.requests?.some(item=>item.id===source.requestId),environmentId=source?.environmentId||activeEnvironmentId;
  const environmentExists=!!environmentId&&environments.some(item=>item.id===environmentId),draftDirty=!!tab?.dirty,executorBusy=!!requestSendInProgress;
  const currentOrigin={tabId:tab?.id||'',collectionId:saved?.collectionId||selectedContainer.collectionId||'',folderId:saved?.folderId||selectedContainer.folderId||'',requestId:saved?.id||'',environmentId:activeEnvironmentId||''};
  const contextMatches=!origin||((origin.tabId===undefined||origin.tabId===currentOrigin.tabId)&&origin.requestId===currentOrigin.requestId&&origin.collectionId===currentOrigin.collectionId&&(origin.folderId||'')===currentOrigin.folderId&&origin.environmentId===currentOrigin.environmentId);
  let blocker=null;
  if(executorBusy)blocker='execution_in_progress';
  else if(!saved&&!origin?.requestId)blocker='request_not_saved';
  else if(draftDirty)blocker='unsaved_changes';
  else if(!requestExists)blocker='request_not_found';
  else if(!environmentExists)blocker='environment_not_found';
  structuredDiagnosticContextInvalidated=false;
  return{blocker,contextMatches,requestSaved,draftDirty,requestExists,environmentExists,executorBusy,origin:currentOrigin,revision:structuredDiagnosticContextRevision};
}
function initializeStructuredExecution(){
  document.addEventListener('input',invalidateStructuredDiagnosticForDraft,true);
  document.addEventListener('change',invalidateStructuredDiagnosticForDraft,true);
  structuredExecutionHandle=StructuredUi.attach({
    getTarget:()=>activeSaved&&!activeWorkspaceTab()?.dirty?{collectionId:activeSaved.collectionId,folderId:activeSaved.folderId||null,requestId:activeSaved.id,environmentId:activeEnvironmentId}:null,
    isBusy:()=>requestSendInProgress,
    getDiagnosticReadiness,
    readSources:getStructuredSources,materialize:StructuredRequest.materializeSavedRequest,run:runStructuredRequest,
    confirmReview:review=>confirmWithDialog({eyebrow:'EXECUÇÃO REVISADA',title:'Aprovar preparação '+review.method+'?',description:review.destination,warning:'Confira a rota na request salva e os efeitos de histórico e captura indicados. Aprovar não envia; a autorização vale uma vez por cinco minutos.',confirmLabel:'Aprovar preparação',danger:writeMethods.has(review.method)})
  });
}
async function executeApiRequest(request){
  const {graphqlQuery,graphqlVariables,graphqlOperationName,...proxyRequest}=request;delete proxyRequest.authMode;delete proxyRequest.authSource;delete proxyRequest.collectionId;delete proxyRequest.folderId;delete proxyRequest.saveBearerToken;delete proxyRequest.resolutionProvenance;delete proxyRequest.responseCaptureTarget;delete proxyRequest.preRequestActions;delete proxyRequest.preRequestActionsEnabled;delete proxyRequest.preRequestActionsLiteralConsent;delete proxyRequest.preRequestSecretValues;delete proxyRequest.preRequestProvenance;delete proxyRequest.responseContract;
  const response=await fetch('/api/request',{method:'POST',headers:{'Content-Type':'application/json','X-Api-Studio':'1'},cache:'no-store',body:JSON.stringify(proxyRequest)});
  let result;try{result=await response.json();}catch{throw Error('O proxy Vortix devolveu uma resposta inválida.');}
  void renderCookieJar();if(result.cookieJarWarning)showToast('Cookie não salvo',result.cookieJarWarning,'warning');
  return{proxyStatus:response.status,result};
}
async function performApiRequest(request,button,save,historyRequest=request){
  clearCurrentResponseExample();
  const requestBodyValidation=requestBodyContractTestResult(request);renderRequestBodyContractResult(requestBodyValidation);
  if(button===sendButton){requestSendInProgress=true;updateGuard();}
  button.disabled=true;byId('request-note').textContent='Aguardando resposta. Credenciais não serão armazenadas automaticamente.';showResponse('Enviando…','pending','','');renderResponseTestResults([]);
  const responseVaultSecrets={...RunnerLogic.secretValuesUsedByProvenance(request.resolutionProvenance,secretVaultValues||{}),...(request.preRequestSecretValues||{})};
  const vaultOrigins=Object.keys(responseVaultSecrets);
  if(vaultOrigins.length)byId('request-note').textContent='Cofre usado para: '+vaultOrigins.join(', ')+'. Apenas nomes/origens são exibidos.';
  byId('response-persistence-note').textContent='Resposta temporária · não armazenada';
  const toast=showToast('Enviando requisição',request.method+' '+redactVaultValues(historyRequest.route.split('?')[0]),'info',0);let historyEntry=null;
  try{
    if(save)historyEntry=await saveHistory(historyRequest);
    const requestStartedAt=performance.now();const {proxyStatus,result}=await executeApiRequest(request);dismissToast(toast);
    if(historyEntry)await saveHistoryResponse(historyEntry,result,performance.now()-requestStartedAt,responseVaultSecrets);
    if(result.error||proxyStatus>=400){const message=RunnerLogic.redactSecretValues(result.error||`Servidor local respondeu HTTP ${proxyStatus}.`,responseVaultSecrets);showResponse('Erro '+proxyStatus,'bad','',message);showToast('Requisição não enviada',message,'error');}
    else{const safeReason=RunnerLogic.redactSecretValues(result.reason||'',responseVaultSecrets),status=(result.status+' '+safeReason).trim(),output=RunnerLogic.redactSecretValues(result.body??'',responseVaultSecrets),headers=RunnerLogic.redactSecretValues(JSON.stringify(result.headers??{},null,2),responseVaultSecrets);showResponse(status,result.status>=200&&result.status<300?'ok':'bad',headers,output);apiStatusToast(result.status,safeReason);const testResults=[...(requestBodyValidation?[requestBodyValidation]:[]),...responseResultsForRequest(request,result)];renderResponseTestResults(testResults);if(testResults.length){const failed=testResults.filter(item=>!item.passed&&!item.partial),partial=testResults.filter(item=>item.partial).length,passed=testResults.filter(item=>item.passed).length;showToast(failed.length?'Validações falharam':partial?'Contrato OpenAPI parcial':'Validações passaram',`${passed}/${testResults.length} verificações passaram${partial?` · ${partial} parcial(is)`:''}.`,failed.length?'error':partial?'warning':'success');}await captureResponseVariable(request,result);}
    return result;
  }catch{dismissToast(toast);const message='Servidor local indisponível. Confira se está ativo e tente novamente.';showResponse('Falha local','bad','',message);showToast('Falha de conexão',message,'error');return null;}
  finally{if(button===sendButton)requestSendInProgress=false;button.disabled=false;updateGuard();}
}
function requestFromForm(selectedMethod,requestRoute,resolveValues=true,preRequestExecution=null){
  const preRequestVariables=preRequestExecution?.variables||{},resolve=value=>resolveValues?applyEnvironment(value,preRequestVariables):value,authMode=authModeFromForm(),auth={...authFieldsFromForm(resolve,true),authMode},bodyMode=byId('body-mode').value,graphql=getGraphqlFieldsFromForm();
  const requestBody=bodyMode==='graphql'?RunnerLogic.buildGraphqlBody(graphql.graphqlQuery,graphql.graphqlVariables,graphql.graphqlOperationName,resolve):resolve(body.value);
  return{baseUrl:resolve(byId('base-url').value.trim()),route:resolve(requestRoute),method:selectedMethod,...auth,collectionId:selectedContainer.collectionId,folderId:selectedContainer.folderId,environmentId:activeEnvironmentId||'default',bodyMode,headers:resolve(byId('headers').value),body:requestBody,multipartFields:readMultipartFieldEntries(resolve).map(entry=>entry.field),graphqlQuery:graphql.graphqlQuery,graphqlVariables:graphql.graphqlVariables,graphqlOperationName:graphql.graphqlOperationName,
    allowInsecureHttp:byId('allow-insecure-http').checked,confirmTestData:byId('confirm-test-data').checked,testDataPhrase:byId('test-data-phrase').value,confirmTokenRequest:false,
    saveBearerToken:byId('save-token-history').checked,
     preRequestActions:getPreRequestActionsFromForm(),preRequestActionsEnabled:byId('pre-request-actions-enabled').checked,preRequestActionsLiteralConsent:byId('pre-request-literal-consent').checked,preRequestSecretValues:preRequestExecution?.vaultSecrets||{},preRequestProvenance:preRequestExecution?.provenance||{},captureResponseVariable:byId('capture-response-variable').checked,responseVariableName:byId('response-variable-name').value.trim(),responseValueSource:byId('response-value-source').value,responseJsonPath:byId('response-json-path').value.trim(),responseSuccessOnly:byId('response-success-only').checked,responseCaptureTarget:byId('response-capture-target').value==='vault'?'vault':'environment',responseTests:getResponseTestsFromForm(),...(activeResponseContract?{responseContract:activeResponseContract}:{}),resolutionProvenance:{...lastResolutionProvenance,...(preRequestExecution?.provenance||{})}};
}
async function sendCurrentRequest(){
  if(requestSendInProgress)return;
  clearCurrentResponseExample();
  lastResolutionProvenance={};
  const selectedMethod=method.value;let request;
  try{
    validateResponseCaptureForm();refreshRequestInspector();
    const preRequestActions=getPreRequestActionsFromForm(),preRequestExecution=byId('pre-request-actions-enabled').checked?RunnerLogic.runPreRequestActions(preRequestActions,getEnvironment().variables||{},{},vaultResolutionInput()):{variables:{},provenance:{},vaultSecrets:{}};
    const rawRoute=buildRequestRoute(),resolvedRoute=buildRequestRoute(true,false,preRequestExecution.variables);
    if(writeMethods.has(selectedMethod)&&!writeConfirmationValid())throw Error('Digite TESTE e confirme que URL e dados são exclusivos de teste.');
    const historyRequest=requestFromForm(selectedMethod,rawRoute,false);
    request=requestFromForm(selectedMethod,rawRoute,true,preRequestExecution);
    if(request.bodyMode==='graphql'&&selectedMethod!=='POST')throw Error('GraphQL usa POST no Vortix.');
    if(request.bodyMode==='multipart')request.multipartFields=await multipartFieldsForSend(value=>applyEnvironment(value,preRequestExecution.variables));
    const insecureOrigin=RunnerLogic.remoteHttpOrigin(request.baseUrl);
    if(insecureOrigin&&!request.allowInsecureHttp)throw Error('HTTP fora de localhost está bloqueado. Marque a opção de HTTP sem TLS nesta request para continuar.');
    const destination=redactVaultValues(sanitizeBase(request.baseUrl).value.replace(/\/+$/,'')+sanitizeRoute(resolvedRoute).value);
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
    const exampleTarget=activeSaved&&!activeWorkspaceTab()?.dirty?{...activeSaved}:null;
    request.route=resolvedRoute;let result;
    try{
      result=await performApiRequest(request,sendButton,true,historyRequest);
      const status=Number(result?.status);
      if(exampleTarget&&result&&!result.error&&Number.isInteger(status)&&status>=100&&status<=599&&activeSaved?.id===exampleTarget.id&&activeSaved?.collectionId===exampleTarget.collectionId&&(activeSaved?.folderId||'')===(exampleTarget.folderId||'')&&(!activeWorkspaceTab()||!activeWorkspaceTab().dirty))
        currentResponseExample={requestId:exampleTarget.id,collectionId:exampleTarget.collectionId,folderId:exampleTarget.folderId||'',status,headers:result.headers??{},body:String(result.body??'')};
      updateResponseExamplesUi();
    }
    finally{
      if(writeMethods.has(selectedMethod))clearWriteConfirmation();byId('request-note').textContent=writeMethods.has(selectedMethod)?'Confirmação consumida. Confirme novamente para outra gravação.':'A resposta é temporária; reutilize a request pela coleção ou histórico.';updateGuard();
    }
  }catch(error){showResponse('Requisição inválida','bad','',error.message||'Revise os campos.');showToast('Revise a requisição',error.message||'Confira URL, rota, ambiente e campos.','error');}
}
async function requestOAuthClientCredentialsToken(){
  const secretField=byId('oauth2-client-secret');let request=null,responseDuration=0;
  try{
    lastResolutionProvenance={};
    if(!(await persistOAuth2TokenConfig(true)))return;
    const config=oauth2TokenConfigFromForm();
    request=RunnerLogic.buildOAuthClientCredentialsRequest({
      tokenUrl:applyEnvironment(config.tokenUrl),clientId:applyEnvironment(config.clientId),
      clientSecret:applyEnvironment(secretField.value),scope:applyEnvironment(config.scope),
      clientAuthMethod:config.clientAuthMethod,allowInsecureHttp:byId('oauth2-allow-insecure-http').checked
    });
    request.environmentId=activeEnvironmentId||'default';
    request.oauthTokenUrl=applyEnvironment(config.tokenUrl);request.oauthClientId=applyEnvironment(config.clientId);
    request.oauthScope=applyEnvironment(config.scope);request.oauthClientAuthMethod=config.clientAuthMethod;
    request.resolutionProvenance={...lastResolutionProvenance};
    const responseVaultSecrets=RunnerLogic.secretValuesUsedByProvenance(request.resolutionProvenance,secretVaultValues||{});
    const insecureOrigin=RunnerLogic.remoteHttpOrigin(request.baseUrl);
    const authDescription=config.clientAuthMethod==='client_secret_basic'?'client_secret será enviado em HTTP Basic.':'client_id e client_secret serão enviados no formulário.';
    const transportWarning=insecureOrigin?remoteHttpWarning(insecureOrigin):'';
    const destination=redactVaultValues(request.baseUrl.replace(/\/+$/,'')+request.route);
    if(!(await confirmWithDialog({eyebrow:'OAUTH 2.0',title:'Solicitar access token?',description:'POST '+redactVaultValues(request.route),detail:destination,warning:[authDescription,transportWarning].filter(Boolean).join(' '),confirmLabel:'Solicitar token',danger:!!insecureOrigin}))){
      showToast('Envio cancelado','Nenhuma credencial OAuth foi enviada.','info');return;
    }
    const requestStartedAt=performance.now(),result=await performApiRequest(request,oauth2TokenButton,false);responseDuration=Math.max(0,performance.now()-requestStartedAt);if(!result)return;
    const tokenInfo=RunnerLogic.parseOAuthTokenResponse(result.body??'',result.status);
    let savedEnvironment=null;
    if(byId('oauth2-save-token-environment').checked){
      savedEnvironment=await saveEnvironmentVariable('token',tokenInfo.accessToken);
      await saveOAuth2TokenMetadata(tokenInfo);
    }
    if(authModeFromForm()==='custom'){
      byId('bearer-token').value=tokenInfo.accessToken;byId('auth-type').value='bearer';updateAuthTypeUi();syncActiveWorkspaceTab(true);
    }
    const expiration=tokenInfo.expiresAt?' Expira em '+new Date(tokenInfo.expiresAt).toLocaleString()+'.':' O servidor não informou validade.';
    const message=savedEnvironment?'{{token}} salvo no ambiente "'+savedEnvironment.name+'".'+expiration:authModeFromForm()==='custom'?'Token preenchido em Bearer nesta sessão; não foi salvo no ambiente.'+expiration:'Token obtido. Configure a Auth herdada para usar {{token}}.'+expiration;
    showToast('OAuth token obtido',message,'success',7000);
    const historyEntry=await saveHistory(tokenHistorySnapshot(request));if(historyEntry)await saveHistoryResponse(historyEntry,result,responseDuration,responseVaultSecrets);
  }catch(error){showToast('Falha no OAuth',error.message||'Confira endpoint, credenciais e ambiente.','error');}
  finally{
    secretField.value='';
    if(request){request.body='';request.basicPassword='';request.tokenClientSecret='';}
    updateOAuth2TokenButton();
  }
}
async function requestTokenFromHelper(){
  const clientId=byId('token-client-id').value.trim(),secret=byId('token-client-secret').value;
  if(!clientId||!secret){showToast('Dados incompletos','Informe os valores dos dois campos de credencial.','error');return;}
  let request,responseDuration=0;
  try{
    lastResolutionProvenance={};
    if(!(await persistTokenRequestConfig(true)))return;
    const config=tokenRequestConfig,routeConfig=RunnerLogic.normalizeTokenRequestConfig({...config,route:applyEnvironment(config.route)});
    if(!routeConfig.route)throw Error('Configure a rota do endpoint de token.');
    const mode=config.credentialMode,baseUrl=applyEnvironment(byId('base-url').value.trim());
    request={baseUrl,route:routeConfig.route,method:'POST',...authFieldsFromForm(applyEnvironment,true),environmentId:activeEnvironmentId||'default',bodyMode:'json',headers:'Accept: application/json',body:'',confirmTestData:false,testDataPhrase:'',confirmTokenRequest:true,tokenClientId:applyEnvironment(clientId),tokenClientSecret:applyEnvironment(secret),tokenClientIdField:config.clientIdField,tokenClientSecretField:config.clientSecretField,tokenCredentialMode:mode,allowInsecureHttp:byId('allow-insecure-http').checked,saveBearerToken:byId('save-token-history').checked};
    request.resolutionProvenance={...lastResolutionProvenance};
    const responseVaultSecrets=RunnerLogic.secretValuesUsedByProvenance(request.resolutionProvenance,secretVaultValues||{});
    const target=new URL(request.baseUrl);
    if(!['http:','https:'].includes(target.protocol)||target.username||target.password||target.search||target.hash)throw Error('Informe URL base HTTP ou HTTPS sem credenciais, query ou fragmento.');
    const insecureOrigin=RunnerLogic.remoteHttpOrigin(request.baseUrl);
    if(insecureOrigin&&!request.allowInsecureHttp)throw Error('HTTP fora de localhost está bloqueado. Marque a opção de HTTP sem TLS nesta request para continuar.');
    const modeWarning=mode==='query'?'O segredo será enviado na query e pode aparecer nos logs da API.':'As credenciais serão enviadas como JSON.';
    const transportWarning=insecureOrigin?remoteHttpWarning(insecureOrigin):'';
    const destination=redactVaultValues(sanitizeBase(request.baseUrl).value.replace(/\/+$/,'')+sanitizeRoute(request.route).value);
    if(!(await confirmWithDialog({eyebrow:'CREDENCIAIS',title:'Solicitar token?',description:'POST '+redactVaultValues(request.route),detail:destination,warning:[modeWarning,transportWarning].filter(Boolean).join(' '),confirmLabel:'Solicitar token',danger:true}))){
      showToast('Envio cancelado','Nenhuma credencial foi enviada.','info');return;
    }
    let result;
    try{const requestStartedAt=performance.now();result=await performApiRequest(request,tokenRequestButton,false);responseDuration=Math.max(0,performance.now()-requestStartedAt);}
    finally{
      const token=result?.status>=200&&result.status<300?extractToken(result.body??''):'';
      if(token){
        byId('bearer-token').value=token;byId('auth-type').value='bearer';updateAuthTypeUi();syncActiveWorkspaceTab(true);let savedEnvironment=null;
        if(byId('save-token-environment').checked){try{savedEnvironment=await saveEnvironmentVariable('token',token);}catch(error){showToast('Token não salvo no ambiente',error.message||(hostedMode?'Não foi possível gravar {{token}} neste navegador.':'Não foi possível gravar {{token}} no SQLite local.'),'error');}}
        showToast('Token obtido',savedEnvironment?`Preenchido em Bearer e salvo como {{token}} no ambiente “${savedEnvironment.name}”.`:'Token preenchido em Bearer. Nada foi copiado para a área de transferência.','success');
      }
      else if(result?.status>=200&&result.status<300)showToast('Resposta recebida','Confira o corpo e preencha Token Bearer manualmente.','info');
      const historyEntry=await saveHistory(tokenHistorySnapshot(request,token));if(historyEntry&&result)await saveHistoryResponse(historyEntry,result,responseDuration,responseVaultSecrets);byId('token-client-id').value='';byId('token-client-secret').value='';request.tokenClientId='';request.tokenClientSecret='';updateTokenButton();
    }
  }catch(error){showToast('Não foi possível solicitar token',error.message||'Confira ambiente e URL base.','error');byId('token-client-id').value='';byId('token-client-secret').value='';updateTokenButton();}
}
function addEventListeners(){
  const quickOpenDialog = byId('quick-open-dialog'), quickOpenQuery = byId('quick-open-query');
  byId('ai-friendly-trigger').onclick=openAiFriendlyHelp;byId('close-ai-help').onclick=()=>byId('ai-help-dialog').close();byId('close-ai-help-done').onclick=()=>byId('ai-help-dialog').close();byId('copy-ai-safe-context').onclick=()=>void copyAiSafeContext();byId('copy-maestri-agent-prompt').onclick=()=>void copyMaestriAgentPrompt();
  setupFullscreenControl();
  byId('compare-history-responses').onclick=()=>void openHistoryComparison();byId('close-history-compare').onclick=()=>byId('history-compare-dialog').close();byId('close-history-compare-done').onclick=()=>byId('history-compare-dialog').close();
  byId('quick-open-button').onclick = openQuickOpen;quickOpenQuery.addEventListener('input', renderQuickOpenResults);quickOpenQuery.addEventListener('keydown', handleQuickOpenQueryKeydown);['quick-open-method-filter','quick-open-status-filter','quick-open-scope-filter'].forEach(id=>byId(id).addEventListener('change',renderQuickOpenResults));
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
  const editorColumn=document.querySelector('.editor-column'),trackDraft=event=>{if(event.target.closest('#structured-card'))return;if(['confirm-test-data','test-data-phrase','token-client-secret','token-route','token-client-id-field','token-client-secret-field','token-credential-mode','oauth2-token-url','oauth2-client-id','oauth2-client-secret','oauth2-scope','oauth2-client-auth-method','oauth2-allow-insecure-http','oauth2-save-token-environment','oauth-pkce-authorization-url','oauth-pkce-token-url','oauth-pkce-client-id','oauth-pkce-scope','oauth-pkce-redirect-uri','oauth-pkce-save-access-token','oauth-pkce-save-refresh-token','graphql-schema-type'].includes(event.target.id))return;if(['method','base-url','route','headers','body','body-mode'].includes(event.target.id)||event.target.matches('.query-param-row input, .pre-request-action-row input, .pre-request-action-row select'))clearRequestBodyContractResult();if(['base-url','route','headers','auth-inheritance-mode','auth-type','bearer-token','basic-username','basic-password','api-key-name','api-key-value','api-key-location'].includes(event.target.id)||event.target.matches('.query-param-row input'))clearGraphqlSchema('Endpoint, Auth ou Params alterados; carregue o schema GraphQL novamente.');syncActiveWorkspaceTab(true);};
  editorColumn.addEventListener('input', trackDraft);editorColumn.addEventListener('change', trackDraft);
  document.querySelector('.editor-column').addEventListener('click', event => { if (event.target.closest('.query-param-row .button, .response-test-remove, .pre-request-action-remove')) syncActiveWorkspaceTab(true); });  byId('clear-history').onclick=clearHistory;byId('copy-headers').onclick=()=>copyOutput('response-headers','Cabeçalhos');byId('copy-body').onclick=()=>copyOutput('response-body','Body');document.querySelectorAll('[data-response-view]').forEach(button=>button.onclick=()=>setResponseView(button.dataset.responseView));byId('response-search').addEventListener('input',renderResponseBody);byId('response-tree').addEventListener('click',event=>{const button=event.target.closest('[data-copy-json-path]');if(button)copyResponsePath(button.dataset.copyJsonPath);});
  byId('save-response-example').onclick=openResponseExampleForm;
  byId('response-example-save-form').addEventListener('submit',saveResponseExample);
  byId('cancel-response-example-save').onclick=closeResponseExampleForm;
  byId('run-collection').onclick=openRunnerDialog;byId('runner-form').addEventListener('submit',startRunnerFromForm);byId('close-runner').onclick=()=>runnerBusy?requestRunnerStop():byId('runner-dialog').close();byId('cancel-runner').onclick=()=>runnerBusy?requestRunnerStop():byId('runner-dialog').close();byId('stop-runner').onclick=requestRunnerStop;byId('rerun-failed').onclick=rerunRunnerFailures;byId('runner-dialog').addEventListener('cancel',event=>{if(runnerBusy||runnerHistoryMutating){event.preventDefault();if(runnerBusy)requestRunnerStop();}});
  byId('runner-history-list').addEventListener('click',event=>{const button=event.target.closest('[data-runner-history-delete]');if(button)void removeRunnerHistoryEntry(button.dataset.runnerHistoryDelete);});
  byId('clear-runner-history').onclick=()=>void clearRunnerHistory();
  window.addEventListener('resize',()=>{if(byId('runner-dialog').open)fitRunnerDialog();});
  byId('add-query-param').onclick=()=>{addQueryParamRow();syncActiveWorkspaceTab(true);};byId('add-response-test').onclick=()=>{addResponseTest();syncActiveWorkspaceTab(true);};byId('validate-request-body').onclick=validateRequestBodyContractFromForm;
  byId('add-pre-request-action').onclick=addPreRequestAction;byId('pre-request-actions-enabled').addEventListener('change',()=>{updatePreRequestActionsUi();refreshRequestInspector();syncActiveWorkspaceTab(true);});
  byId('response-tests-list').addEventListener('input',()=>renderResponseTestResults([]));byId('response-tests-list').addEventListener('change',()=>renderResponseTestResults([]));
  byId('add-collection').onclick=addCollection;byId('add-collection-heading').onclick=addCollection;byId('collections-empty-create').onclick=addCollection;byId('import-collection').onclick=openImportDialog;byId('browse-import-file').onclick=()=>{byId('import-dialog').close();byId('import-collection-file').click();};byId('close-import-dialog').onclick=()=>byId('import-dialog').close();byId('cancel-import-dialog').onclick=()=>byId('import-dialog').close();byId('command-import-format').addEventListener('change',updateCommandImportUi);byId('create-imported-request').onclick=openImportedCommandDraft;byId('import-collection-file').addEventListener('change',importCollectionFile);byId('generate-curl').onclick=openCurlExportDialog;byId('curl-format').addEventListener('change',updateCurlExportPreview);byId('curl-shell').addEventListener('change',updateCurlExportPreview);byId('curl-include-sensitive').addEventListener('change',()=>void confirmCurlSensitiveMode());byId('copy-curl-command').onclick=copyCurlCommand;byId('close-curl-export').onclick=()=>byId('curl-export-dialog').close();byId('cancel-curl-export').onclick=()=>byId('curl-export-dialog').close();byId('curl-export-dialog').addEventListener('close',()=>{byId('curl-include-sensitive').checked=false;updateCurlExportPreview();});byId('export-collection').onclick=openExportDialog;byId('export-format').addEventListener('change',updateExportFormatUi);byId('export-form').addEventListener('submit',exportCollection);byId('close-export-dialog').onclick=()=>byId('export-dialog').close();byId('cancel-export-dialog').onclick=()=>byId('export-dialog').close();byId('save-collection-request').onclick=openSaveDialog;byId('save-request-form').addEventListener('submit',saveCollectionRequest);byId('close-save-request').onclick=()=>byId('save-request-dialog').close();byId('cancel-save-request').onclick=()=>byId('save-request-dialog').close();
  byId('export-workspace').onclick=exportWorkspaceBackup;byId('export-encrypted-workspace').onclick=exportEncryptedWorkspaceBackup;byId('restore-workspace').onclick=()=>byId('restore-workspace-file').click();byId('restore-workspace-file').addEventListener('change',restoreWorkspaceBackup);
  byId('protect-existing-secrets').onclick=protectExistingSecrets;
  byId('secret-vault-create').onclick=()=>void createSecretVaultFromUi();byId('secret-vault-unlock').onclick=()=>void unlockSecretVaultFromUi();byId('secret-vault-lock').onclick=()=>void lockSecretVaultFromUi();byId('secret-vault-remove').onclick=()=>void removeSecretVault();byId('secret-vault-add').onclick=event=>void addSecretVaultEntry(event);
  byId('environment-form').addEventListener('submit',saveEnvironmentDraft);byId('close-environment').onclick=()=>{environmentDraft=[];byId('environment-dialog').close();};byId('cancel-environment').onclick=()=>{environmentDraft=[];byId('environment-dialog').close();};byId('manage-environments-direct').onclick=openEnvironmentDialog;byId('manage-environments').onclick=openSettingsDialog;byId('settings-environments').onclick=()=>{byId('settings-dialog').close();openEnvironmentDialog();};byId('close-settings').onclick=()=>byId('settings-dialog').close();byId('close-settings-done').onclick=()=>byId('settings-dialog').close();byId('add-environment').onclick=addEnvironmentDraft;
  byId('environment-select').onchange=event=>chooseEnvironment(event.target.value);byId('theme-select').onchange=event=>saveTheme(event.target.value);
  byId('font-select').onchange=event=>saveFont(event.target.value);byId('history-retention-limit').addEventListener('change',()=>void saveHistorySettings());byId('history-save-response-body').addEventListener('change',()=>void saveHistorySettings());byId('decrease-font').onclick=()=>setUiScale(activeScale-0.05);byId('increase-font').onclick=()=>setUiScale(activeScale+0.05);document.addEventListener('keydown',handleScaleShortcut);
  byId('environment-list').addEventListener('click',async event=>{
    const exportButton=event.target.closest('[data-export-environment]');if(exportButton){await exportEnvironmentFromCard(exportButton.closest('.environment-card'));return;}
    const remove=event.target.closest('[data-remove-environment]');if(remove){const card=remove.closest('.environment-card');if(environmentDraft.length<=1){showToast('Mantenha um ambiente','O último ambiente não pode ser removido.','warning');return;}const environmentName=card.querySelector('.environment-name').value;if(await confirmWithDialog({eyebrow:'AMBIENTES',title:'Remover ambiente?',description:'O ambiente “'+environmentName+'” será removido do rascunho.',confirmLabel:'Remover ambiente',danger:true}))card.remove();return;}
    if(event.target.closest('[data-add-variable]')){const vars=event.target.closest('.environment-card').querySelector('.environment-vars');vars.append(makeVarRow());vars.lastElementChild.querySelector('.environment-var-name').focus();}
  });
  const editorTabList=byId('request-editor-tabs');editorTabList.addEventListener('click',event=>{const button=event.target.closest('[data-editor-tab]');if(button)setEditorTab(button.dataset.editorTab);});editorTabList.addEventListener('keydown',handleEditorTabKeydown);byId('format-json').onclick=()=>formatBodyJson(false);byId('minify-json').onclick=()=>formatBodyJson(true);body.addEventListener('keydown',handleJsonKeydown);
  for(const id of ['response-variable-name','response-json-path','response-value-source','response-success-only','capture-response-variable','response-capture-target']){byId(id).addEventListener('input',updateResponseCaptureUi);byId(id).addEventListener('change',updateResponseCaptureUi);}
  byId('insert-token-script').onclick=async()=>{const isDefault=byId('response-variable-name').value.trim()==='token'&&byId('response-json-path').value.trim()==='access_token';if(!isDefault&&!(await confirmWithDialog({eyebrow:'EXEMPLO DE TOKEN',title:'Usar o exemplo de token?',description:'Os campos do extrator serão preenchidos com token e access_token.',confirmLabel:'Usar exemplo'})))return;byId('capture-response-variable').checked=true;byId('response-value-source').value='json';byId('response-variable-name').value='token';byId('response-json-path').value='access_token';byId('response-success-only').checked=true;byId('response-capture-target').value='environment';updateResponseCaptureUi();showToast('Exemplo pronto','Confira o caminho access_token na resposta antes de enviar.','info');};
  byId('copy-insomnia-script').onclick=async()=>{try{await copyToClipboard(byId('insomnia-script-preview').textContent);}catch{showToast('Falha ao copiar','O navegador bloqueou a área de transferência.','error');}};
  byId('clear-token').onclick=()=>{byId('bearer-token').value='';byId('bearer-token').focus();showToast('Token removido','O campo Bearer foi limpo desta sessão.','info');};
  byId('new-request').onclick=createNewWorkspaceTab;
  for(const id of ['method','route','body','base-url','headers','allow-insecure-http','confirm-test-data','test-data-phrase']){
    const change=()=>{if(['method','route','body','base-url','headers'].includes(id)){byId('confirm-test-data').checked=false;clearRequestBodyContractResult();}if(id==='base-url')baseUrlAuto=false;updateGuard();updateTokenButton();if(id==='body'){renderBodyHighlight();updateJsonTools();}};byId(id).addEventListener('input',change);byId(id).addEventListener('change',change);
  }
  body.addEventListener('scroll',renderBodyHighlight);byId('body-mode').addEventListener('change',clearRequestBodyContractResult);byId('token-client-id').addEventListener('input',updateTokenButton);byId('token-client-secret').addEventListener('input',updateTokenButton);
  byId('auth-type').addEventListener('change',updateAuthTypeUi);byId('api-key-location').addEventListener('change',updateAuthTypeUi);byId('auth-inheritance-mode').addEventListener('change',()=>{const authMode=authModeFromForm();applyAuthFields(authMode==='custom'?{authMode,authType:'none'}:{authMode});syncActiveWorkspaceTab(true);});byId('save-auth-default').onclick=()=>void saveAuthDefault();byId('body-mode').addEventListener('change',updateBodyModeUi);byId('multipart-add-text').onclick=()=>addMultipartField('text');byId('multipart-add-file').onclick=()=>addMultipartField('file');byId('graphql-load-schema').onclick=()=>void loadGraphqlSchema();byId('graphql-schema-type').addEventListener('change',renderGraphqlSchemaFields);const graphqlQueryField=byId('graphql-query');graphqlQueryField.addEventListener('input',renderGraphqlAutocomplete);graphqlQueryField.addEventListener('keyup',renderGraphqlAutocomplete);graphqlQueryField.addEventListener('click',renderGraphqlAutocomplete);graphqlQueryField.addEventListener('keydown',handleGraphqlAutocompleteKeydown);byId('format-graphql-variables').onclick=formatGraphqlVariables;for(const id of ['graphql-query','graphql-variables','graphql-operation-name']){byId(id).addEventListener('input',()=>{byId('confirm-test-data').checked=false;updateGuard();});byId(id).addEventListener('change',()=>{byId('confirm-test-data').checked=false;updateGuard();});}byId('clear-cookie-jar').onclick=clearCookieJar;byId('inspect-references').onclick=refreshRequestInspector;byId('request-inspector').addEventListener('toggle',()=>{if(byId('request-inspector').open)refreshRequestInspector();});byId('runner-datasets').addEventListener('input',()=>{if(byId('runner-dialog').open)renderRunnerPlan(runnerEntries);});
  for(const id of ['token-route','token-client-id-field','token-client-secret-field','token-credential-mode']){byId(id).addEventListener('input',updateTokenButton);byId(id).addEventListener('change',()=>void persistTokenRequestConfig());}
    for(const id of ['oauth2-token-url','oauth2-client-id','oauth2-scope'])byId(id).addEventListener('input',updateOAuth2TokenButton);
  byId('refresh-agent-safe-state').onclick=refreshAgentSafeState;for(const id of ['token-helper','oauth2-helper','oauth-pkce-helper'])byId(id).addEventListener('toggle',updateAdvancedToolsIndicator);
  for(const id of ['oauth2-token-url','oauth2-client-id','oauth2-scope','oauth2-client-auth-method'])byId(id).addEventListener('change',()=>void persistOAuth2TokenConfig(true));
  for(const id of ['oauth-pkce-authorization-url','oauth-pkce-token-url','oauth-pkce-client-id','oauth-pkce-scope'])byId(id).addEventListener('input',()=>{if(id==='oauth-pkce-authorization-url'){byId('oauth-pkce-redirect-uri').value='';scheduleOAuthPkceRedirectPreview();}updateOAuthPkceStartButton();});
  for(const id of ['oauth-pkce-authorization-url','oauth-pkce-token-url','oauth-pkce-client-id','oauth-pkce-scope'])byId(id).addEventListener('change',()=>{void persistOAuthPkceConfig(true);if(id==='oauth-pkce-authorization-url')scheduleOAuthPkceRedirectPreview();});
  byId('oauth2-client-secret').addEventListener('input',updateOAuth2TokenButton);byId('oauth2-allow-insecure-http').addEventListener('change',updateOAuth2TokenButton);
  oauth2TokenButton.onclick=()=>void requestOAuthClientCredentialsToken();byId('oauth-pkce-start').onclick=()=>void requestOAuthAuthorizationCodeToken();byId('oauth-pkce-cancel').onclick=cancelOAuthPkceAuthorization;byId('oauth-pkce-redirect-copy').onclick=copyOAuthPkceRedirectUri;sendButton.onclick=sendCurrentRequest;tokenRequestButton.onclick=requestTokenFromHelper;
}
async function startApp(){
  addEventListeners();updateAiFriendlyStatus();renderQueryParams([]);ensureQueryParamRow();renderMultipartFields([]);renderGraphqlFields({});updateAuthTypeUi();updateBodyModeUi();renderBodyHighlight();
  try{await initializeHostingMode();await initializeDb();await loadSecretVaultForActiveEnvironment();await loadTokenRequestConfig();await loadOAuth2TokenConfig();applyTheme(activeTheme);applyTypography();applyUiScale();renderCollectionTree();renderEnvironmentSelect();await loadOAuthPkceConfig();if(!byId('base-url').value)byId('base-url').value=Object.hasOwn(getEnvironment().variables||{},'baseUrl')?'{{baseUrl}}':'';await renderHistory();await initializeWorkspaceTabs();updateGuard();updateCopyButtons();updateTokenButton();updateJsonTools();updateResponseCaptureUi();
    initializeStructuredExecution();byId('protect-existing-secrets').hidden=hostedMode;
    if(hostedMode){byId('sidebar-storage-note').textContent='Coleções e histórico neste navegador';document.querySelector('.sidebar-bottom strong').textContent='Workspace do navegador';byId('history-panel').querySelector('.history-hint').textContent='Histórico e dados ficam neste navegador; exporte backups para transferi-los.';byId('app-storage-note').textContent='Coleções, ambientes, requests e histórico ficam no IndexedDB deste navegador, sem criptografia automática. Use Backup com senha para transportar uma cópia protegida.';}
    else byId('sidebar-storage-note').textContent='SQLite local · proteção de dados';}
  catch(error){const environmentSelect=byId('environment-select');if(environmentSelect.options.length===1&&environmentSelect.options[0].textContent==='Carregando ambientes…')environmentSelect.options[0].textContent='Ambientes indisponíveis';showToast(hostedMode?'Armazenamento do navegador indisponível':'Banco local indisponível',error.message||'Confira o acesso ao armazenamento e tente recarregar.','error',0);updateGuard();updateCopyButtons();updateTokenButton();}
}
startApp();
})();
