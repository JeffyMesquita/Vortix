(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ApiStudioRunner = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  'use strict';

  const methods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
  const writeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  const bodyModes = new Set(['json', 'text', 'xml', 'urlencoded', 'multipart', 'graphql']);
  function normalizeAuthFields(source={}){
    const rawType=String(source.authType|| (source.bearerToken?'bearer':'none')),authType=rawType==='api-key'?'apiKey':rawType;
    if(!['none','bearer','basic','apiKey'].includes(authType))throw Error('Tipo de autenticação não suportado.');
    return{authType,bearerToken:authType==='bearer'?String(source.bearerToken||''):'',basicUsername:authType==='basic'?String(source.basicUsername||''):'',basicPassword:authType==='basic'?String(source.basicPassword||''):'',apiKeyName:authType==='apiKey'?String(source.apiKeyName||''):'',apiKeyLocation:authType==='apiKey'&&source.apiKeyLocation==='query'?'query':'header',apiKeyValue:authType==='apiKey'?String(source.apiKeyValue||''):''};
  }
  function persistAuthFields(source={},includeCredentials=true){
    const authMode=['inherit','none','custom'].includes(source.authMode)?source.authMode:'custom';
    if(authMode!=='custom')return{...normalizeAuthFields({authType:'none'}),authMode,authOmitted:false};
    const fields=normalizeAuthFields(source),hasCredentials=!!(fields.bearerToken||fields.basicUsername||fields.basicPassword||fields.apiKeyValue);
    return{...fields,authMode,bearerToken:includeCredentials?fields.bearerToken:'',basicUsername:includeCredentials?fields.basicUsername:'',basicPassword:includeCredentials?fields.basicPassword:'',apiKeyValue:includeCredentials?fields.apiKeyValue:'',authOmitted:hasCredentials&&!includeCredentials};
  }
  function normalizeImportedAuthMode(auth){
    const type=String(auth?.type||'').trim().toLowerCase();
    if(!type||type==='inherit')return'inherit';
    if(type==='none'||type==='noauth')return'none';
    return'custom';
  }
  function resolveInheritedAuth(request={},scopes=[]){
    const mode=['inherit','none','custom'].includes(request.authMode)?request.authMode:'custom';
    if(mode==='none')return{...normalizeAuthFields({authType:'none'}),authMode:'none',authSource:null};
    if(mode==='custom')return{...normalizeAuthFields(request),authMode:'custom',authSource:null};
    const scope=[...(Array.isArray(scopes)?scopes:[])].reverse().find(item=>item?.auth&&typeof item.auth==='object'&&!Array.isArray(item.auth));
    return{...normalizeAuthFields(scope?.auth||{authType:'none'}),authMode:'inherit',authSource:scope?{id:String(scope.id||''),name:String(scope.name||'')}:null};
  }
  function normalizeBodyMode(value,strict=false){const mode=String(value||'json').trim().toLowerCase();if(bodyModes.has(mode))return mode;if(strict)throw Error('Modo de body não suportado: '+mode);return 'json';}
  function normalizeMultipartFields(fields){
    if(fields==null)return[];
    if(!Array.isArray(fields)||fields.length>100)throw Error('Multipart aceita até 100 campos.');
    return fields.map(source=>{
      if(!source||typeof source!=='object'||Array.isArray(source))throw Error('Campo multipart inválido.');
      const name=String(source.name??'').trim(),type=source.type==='file'?'file':source.type==null||source.type==='text'?'text':'';
      if(!name||name.length>256||/[\r\n]/.test(name))throw Error('Informe um nome válido para cada campo multipart.');
      if(!type)throw Error('Tipo de campo multipart não suportado.');
      const value=type==='text'?String(source.value??''):'';
      if(value.length>262144)throw Error('Campo multipart de texto ultrapassa 256 KB.');
      const fileName=type==='file'?String(source.fileName??'').replaceAll('\\','/').split('/').pop().trim().slice(0,255):'';
      const contentType=type==='file'?String(source.contentType??'').trim().slice(0,200):'';
      if(/[\r\n]/.test(fileName)||/[\r\n]/.test(contentType))throw Error('Metadados de arquivo multipart inválidos.');
      return{name,type,value,fileName,contentType};
    });
  }
  function buildGraphqlBody(query,variables='',operationName='',resolve=value=>value){
    const queryText=String(query??'').trim();
    if(!queryText)throw Error('Informe uma query GraphQL.');
    const rawVariables=typeof variables==='string'?variables.trim():variables;
    let parsedVariables,includeVariables=false;
    if(typeof rawVariables==='string'&&rawVariables){try{parsedVariables=JSON.parse(rawVariables);includeVariables=true;}catch{throw Error('Variables GraphQL devem ser JSON válido.');}}
    else if(rawVariables!==''&&rawVariables!=null){parsedVariables=rawVariables;includeVariables=true;}
    if(includeVariables&&(!parsedVariables||typeof parsedVariables!=='object'||Array.isArray(parsedVariables)))throw Error('Variables GraphQL devem ser um objeto JSON.');
    const resolveValues=value=>{
      if(typeof value==='string')return resolve(value);
      if(Array.isArray(value))return value.map(resolveValues);
      if(value&&typeof value==='object'){const result={};for(const[key,item]of Object.entries(value))Object.defineProperty(result,key,{value:resolveValues(item),enumerable:true,writable:true,configurable:true});return result;}
      return value;
    };
    const payload={query:resolve(queryText)};
    if(includeVariables)payload.variables=resolveValues(parsedVariables);
    const operation=resolve(String(operationName??'').trim());if(operation)payload.operationName=operation;
    return JSON.stringify(payload);
  }
  function buildPostmanGraphqlBody(fields){
    const query=String(fields?.graphqlQuery||''),variables=String(fields?.graphqlVariables||''),operationName=String(fields?.graphqlOperationName||'').trim();
    buildGraphqlBody(query,variables,operationName);
    const graphql={query,variables};if(operationName)graphql.operationName=operationName;
    return{mode:'graphql',graphql};
  }
  function buildInsomniaGraphqlBody(fields){
    const query=String(fields?.graphqlQuery||''),variables=String(fields?.graphqlVariables||''),operationName=String(fields?.graphqlOperationName||'').trim();
    return{mimeType:'application/graphql',text:buildGraphqlBody(query,variables,operationName)};
  }
  function graphqlTypeSignature(reference, depth = 0) {
    if (!reference || depth > 12) return 'Unknown';
    if (reference.kind === 'NON_NULL') return graphqlTypeSignature(reference.ofType, depth + 1) + '!';
    if (reference.kind === 'LIST') return '[' + graphqlTypeSignature(reference.ofType, depth + 1) + ']';
    return String(reference.name || 'Unknown');
  }

  function graphqlNamedType(reference) {
    let current = reference, depth = 0;
    while (current?.ofType && depth++ < 12) current = current.ofType;
    return String(current?.name || 'Unknown');
  }

  function parseGraphqlSchemaResponse(responseText, status = 200) {
    const httpStatus = Number(status);
    if (!Number.isInteger(httpStatus) || httpStatus < 200 || httpStatus >= 300) throw Error('Endpoint GraphQL respondeu HTTP ' + (Number.isFinite(httpStatus) ? httpStatus : 0) + '.');
    const source = String(responseText ?? '');
    if (source.length > 5 * 1024 * 1024) throw Error('Schema GraphQL ultrapassa o limite de 5 MB.');
    let document;
    try { document = JSON.parse(source); }
    catch { throw Error('Resposta de introspecção GraphQL não é JSON válido.'); }
    if (!document || typeof document !== 'object' || Array.isArray(document)) throw Error('Resposta de introspecção GraphQL inválida.');
    if (Array.isArray(document.errors) && document.errors.length) throw Error('A API retornou erros ao consultar introspecção GraphQL.');
    const schema = document.data?.__schema;
    if (!schema || !Array.isArray(schema.types) || schema.types.length > 2000) throw Error('Resposta não contém um schema GraphQL válido.');
    const validName = value => typeof value === 'string' && /^[_A-Za-z][_0-9A-Za-z]*$/.test(value);
    const types = schema.types.filter(type => type && validName(type.name) && !type.name.startsWith('__')).map(type => {
      const rawFields = Array.isArray(type.fields) ? type.fields : Array.isArray(type.inputFields) ? type.inputFields : [];
      const fields = rawFields.slice(0, 2000).filter(field => field && validName(field.name)).map(field => ({
        name: field.name,
        description: String(field.description || '').slice(0, 500),
        returnType: graphqlTypeSignature(field.type),
        typeName: graphqlNamedType(field.type),
        args: (Array.isArray(field.args) ? field.args : []).filter(arg => arg && validName(arg.name)).map(arg => ({ name: arg.name, type: graphqlTypeSignature(arg.type), typeName: graphqlNamedType(arg.type) }))
      }));
      const enumValues = (Array.isArray(type.enumValues) ? type.enumValues : []).filter(value => value && validName(value.name)).map(value => ({ name: value.name, description: String(value.description || '').slice(0, 500) }));
      return { name: type.name, kind: String(type.kind || ''), description: String(type.description || '').slice(0, 1000), fields, enumValues };
    });
    const queryType = String(schema.queryType?.name || '');
    if (!queryType || !types.some(type => type.name === queryType && type.fields.length)) throw Error('Schema GraphQL não contém um tipo Query com campos.');
    return { queryType, mutationType: String(schema.mutationType?.name || ''), subscriptionType: String(schema.subscriptionType?.name || ''), types };
  }

  function suggestGraphqlFields(schema, typeName, prefix, limit = 12) {
    const type = schema?.types?.find(item => item.name === typeName);
    const term = String(prefix || '').trim().toLowerCase();
    const maximum = Number.isInteger(Number(limit)) ? Math.max(1, Math.min(50, Math.floor(Number(limit)))) : 12;
    if (!type || !term) return [];
    return type.fields.filter(field => field.name.toLowerCase().startsWith(term)).slice(0, maximum);
  }

  function normalizeGraphqlImportBody(body){
    const source=body?.graphql;
    if(source&&typeof source==='object'){
      return{graphqlQuery:String(source.query||''),graphqlVariables:typeof source.variables==='string'?source.variables:source.variables==null?'':JSON.stringify(source.variables,null,2),graphqlOperationName:String(source.operationName||'')};
    }
    if(body?.mode==='graphql'||body?.mimeType==='application/graphql'){
      const raw=String(body.text||'');
      try{const parsed=JSON.parse(raw);if(typeof parsed?.query==='string')return{graphqlQuery:parsed.query,graphqlVariables:parsed.variables==null?'':JSON.stringify(parsed.variables,null,2),graphqlOperationName:String(parsed.operationName||'')};}catch{}
      return{graphqlQuery:raw,graphqlVariables:'',graphqlOperationName:''};
    }
    return{graphqlQuery:'',graphqlVariables:'',graphqlOperationName:''};
  }
  const reservedNames = new Set(['__proto__', 'prototype', 'constructor']);
  const maxDataSets = 100;

  function flattenRequests(node, ancestors = [], depth = 0, folderId = '', inheritedAuthScopes = [], folderIds = []) {
    if (depth > 20) throw Error('A coleção ultrapassa 20 níveis de pastas.');
    const currentPath = [...ancestors, String(node?.name || '').trim()].filter(Boolean);
    const path = currentPath.join(' / ');
    const currentFolderIds = depth === 0 ? folderIds : [...folderIds, String(node?.id || folderId || '')].filter(Boolean);
    const authScopes = node?.auth && typeof node.auth === 'object' && !Array.isArray(node.auth)
      ? [...inheritedAuthScopes, { id: String(node.id || ''), name: String(node.name || ''), auth: node.auth }]
      : inheritedAuthScopes;
    const result = (node?.requests || []).map(request => ({ request, path, folderId, folderIds: currentFolderIds, authScopes }));
    for (const folder of node?.folders || []) {
      result.push(...flattenRequests(folder, currentPath, depth + 1, String(folder?.id || ''), authScopes, currentFolderIds));
    }
    return result;
  }

  function normalizeSearchText(value) {
    return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  function searchRequests(collections, query, limit = 30, filters = {}) {
    const term = normalizeSearchText(query).trim();
    const methodFilter = String(filters?.method || '').trim().toUpperCase();
    const statusFilter = filters?.status == null || String(filters.status).trim() === '' ? null : Number(filters.status);
    const collectionFilter = String(filters?.collectionId || '');
    const folderFilter = String(filters?.folderId || '');
    const hasFilters = !!(methodFilter || statusFilter !== null || collectionFilter || folderFilter);
    if (!term && !hasFilters) return [];
    const requestedLimit = Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : 30;
    const maxResults = Math.max(1, Math.min(100, requestedLimit));
    const results = [];
    for (const collection of collections || []) {
      if (collectionFilter && String(collection?.id || '') !== collectionFilter) continue;
      for (const entry of flattenRequests(collection)) {
        const { request } = entry;
        if (methodFilter && String(request?.method || 'GET').toUpperCase() !== methodFilter) continue;
        if (statusFilter !== null && (!Number.isInteger(statusFilter) || !(request?.responseExamples || []).some(example => Number(example?.status) === statusFilter))) continue;
        if (folderFilter && !(entry.folderIds || [entry.folderId]).includes(folderFilter)) continue;
        const searchable = normalizeSearchText([collection?.name, entry.path, request?.method, request?.name, request?.route].join(' '));
        if (term && !searchable.includes(term)) continue;
        results.push({ ...entry, collectionId: String(collection?.id || ''), collectionName: String(collection?.name || '') });
        if (results.length >= maxResults) return results;
      }
    }
    return results;
  }

  const maxWorkspaceTabs = 12;

  function normalizeTokenRequestConfig(source = {}) {
    const route = String(source?.route || '').trim().slice(0, 2048);
    const clientIdField = String(source?.clientIdField || 'client_id').trim();
    const clientSecretField = String(source?.clientSecretField || 'client_secret').trim();
    const credentialMode = source?.credentialMode === 'query' ? 'query' : 'body';
    const validField = value => /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(value) && !reservedNames.has(value.toLowerCase());
    if (route) {
      let decodedRoute;
      try { decodedRoute = decodeURIComponent(route); }
      catch { throw Error('Rota do token inválida.'); }
      if (!route.startsWith('/') || route.startsWith('//') || route.includes('\\') || route.includes('?') || route.includes('#') || route.includes('://') || decodedRoute.split('/').some(segment => segment === '.' || segment === '..')) throw Error('Rota do token deve ser um caminho local iniciado por /.');
    }
    if (!validField(clientIdField) || !validField(clientSecretField) || clientIdField.toLowerCase() === clientSecretField.toLowerCase()) throw Error('Informe nomes válidos e diferentes para os campos de credencial.');
    return { route, clientIdField, clientSecretField, credentialMode };
  }

  function oauthUrlHasCredential(value) {
    const source = String(value || '');
    if (source.includes('#') || /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*@/i.test(source)) return true;
    const queryIndex = source.indexOf('?');
    if (queryIndex < 0) return false;
    const query = source.slice(queryIndex + 1);
    return [...new URLSearchParams(query).keys()].some(name => /authorization|auth|bearer|token|secret|password|credential|api[-_]?key|client_id/i.test(name));
  }
  function normalizeOAuthClientCredentialsConfig(source = {}) {
    const tokenUrl = String(source?.tokenUrl || '').trim().slice(0, 2048);
    const clientId = String(source?.clientId || '').slice(0, 512);
    const scope = String(source?.scope || '').trim().split(/\s+/).filter(Boolean).join(' ').slice(0, 4096);
    const clientAuthMethod = source?.clientAuthMethod === 'client_secret_post' ? 'client_secret_post' : 'client_secret_basic';
    if (source?.clientAuthMethod && !['client_secret_basic', 'client_secret_post'].includes(source.clientAuthMethod))
      throw Error('Método de autenticação OAuth inválido.');
    if (tokenUrl && oauthUrlHasCredential(tokenUrl))
      throw Error('Segredos e credenciais OAuth não podem ficar na URL.');
    return { tokenUrl, clientId, scope, clientAuthMethod };
  }

  function normalizeOAuthPkceConfig(source = {}) {
    const authorizationUrl = String(source?.authorizationUrl || '').trim();
    const tokenUrl = String(source?.tokenUrl || '').trim();
    const clientId = String(source?.clientId || '').trim();
    const scope = String(source?.scope || '').trim().split(/\s+/).filter(Boolean).join(' ');
    if (authorizationUrl.length > 2048 || tokenUrl.length > 2048 || clientId.length > 512 || scope.length > 4096)
      throw Error('A configuração OAuth excede os limites permitidos.');
    if ((authorizationUrl && oauthUrlHasCredential(authorizationUrl)) || (tokenUrl && oauthUrlHasCredential(tokenUrl)))
      throw Error('Segredos e credenciais OAuth não podem ficar nas URLs.');
    return { authorizationUrl, tokenUrl, clientId, scope };
  }

  function buildOAuthClientCredentialsRequest(source = {}) {
    const tokenUrl = String(source?.tokenUrl || '').trim();
    if (!tokenUrl || tokenUrl.length > 2048 || oauthUrlHasCredential(tokenUrl))
      throw Error('Informe uma URL absoluta válida para o endpoint OAuth.');
    let endpoint;
    try { endpoint = new URL(tokenUrl); }
    catch { throw Error('Informe uma URL absoluta HTTP ou HTTPS para o endpoint OAuth.'); }
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.hash)
      throw Error('O endpoint OAuth deve usar HTTP ou HTTPS, sem credenciais ou fragmento.');
    const allowInsecureHttp = source.allowInsecureHttp === true;
    const insecureOrigin = remoteHttpOrigin(endpoint.origin);
    if (insecureOrigin && !allowInsecureHttp)
      throw Error('HTTP fora de localhost exige autorização explícita; HTTPS é recomendado.');
    const clientId = String(source?.clientId || '');
    const clientSecret = String(source?.clientSecret || '');
    if (!clientId.trim() || clientId.length > 512) throw Error('Informe um client_id válido.');
    if (!clientSecret || clientSecret.length > 8192) throw Error('Informe o client_secret (segredo do cliente).');
    const clientAuthMethod = source?.clientAuthMethod || 'client_secret_basic';
    if (!['client_secret_basic', 'client_secret_post'].includes(clientAuthMethod))
      throw Error('Método de autenticação OAuth inválido.');
    const scope = String(source?.scope || '').trim().split(/\s+/).filter(Boolean).join(' ');
    if (scope.length > 4096 || /[\r\n]/.test(scope)) throw Error('O scope OAuth é inválido ou excede o limite.');
    const body = new URLSearchParams();
    body.set('grant_type', 'client_credentials');
    if (scope) body.set('scope', scope);
    const formEncode = value => new URLSearchParams([['value', value]]).toString().slice('value='.length);
    let authType = 'none', basicUsername = '', basicPassword = '';
    if (clientAuthMethod === 'client_secret_basic') {
      basicUsername = formEncode(clientId);
      basicPassword = formEncode(clientSecret);
      if (basicUsername.length > 1024) throw Error('client_id excede o limite para autenticação Basic.');
      authType = 'basic';
    } else {
      body.set('client_id', clientId);
      body.set('client_secret', clientSecret);
    }
    return {
      baseUrl: endpoint.origin, route: endpoint.pathname + endpoint.search, method: 'POST',
      bodyMode: 'urlencoded', body: body.toString(), headers: 'Accept: application/json',
      authType, basicUsername, basicPassword, confirmTestData: false, testDataPhrase: '',
      confirmTokenRequest: true, tokenFlow: 'oauth2-client-credentials', tokenRequest: true,
      tokenClientId: '', tokenClientSecret: '', tokenCredentialMode: 'body',
      tokenClientIdField: 'client_id', tokenClientSecretField: 'client_secret',
      allowInsecureHttp, saveBearerToken: false
    };
  }

  function parseOAuthTokenResponse(raw, status, now = Date.now()) {
    const responseStatus = Number(status);
    if (!Number.isInteger(responseStatus) || responseStatus < 200 || responseStatus >= 300)
      throw Error('O endpoint OAuth respondeu HTTP ' + (Number.isFinite(responseStatus) ? responseStatus : 0) + '.');
    let value;
    try { value = JSON.parse(String(raw ?? '')); }
    catch { throw Error('A resposta do endpoint OAuth não contém JSON válido.'); }
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw Error('A resposta OAuth precisa ser um objeto JSON.');
    const accessToken = typeof value.access_token === 'string' ? value.access_token.trim() : '';
    if (!accessToken || accessToken.length > 8192 || /[\r\n]/.test(accessToken))
      throw Error('A resposta OAuth não contém um access_token válido.');
    const tokenType = typeof value.token_type === 'string' ? value.token_type.trim() : '';
    if (tokenType.toLowerCase() !== 'bearer')
      throw Error('O Vortix aceita tokens OAuth do tipo Bearer nesta etapa.');
    let expiresIn = null, expiresAt = null;
    if (Object.hasOwn(value, 'expires_in')) {
      const seconds = Number(value.expires_in);
      if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds > 3153600000)
        throw Error('O campo expires_in da resposta OAuth é inválido.');
      expiresIn = seconds;
      expiresAt = Number(now) + seconds * 1000;
      if (!Number.isSafeInteger(expiresAt)) throw Error('O vencimento do token OAuth excede o limite.');
    }
    return { accessToken, tokenType: 'Bearer', expiresIn, expiresAt };
  }

  function normalizeWorkspaceTabs(saved) {
    const tabs = [], ids = new Set();
    for (const source of Array.isArray(saved?.tabs) ? saved.tabs : []) {
      if (!source || typeof source !== 'object' || Array.isArray(source) || !source.request || typeof source.request !== 'object' || Array.isArray(source.request)) continue;
      const id = String(source.id || '').trim();
      if (!id || ids.has(id)) continue;
      ids.add(id);
      const activeSaved = source.activeSaved && typeof source.activeSaved === 'object' && !Array.isArray(source.activeSaved)
        ? { id: String(source.activeSaved.id || ''), name: String(source.activeSaved.name || ''), collectionId: String(source.activeSaved.collectionId || ''), folderId: String(source.activeSaved.folderId || '') }
        : null;
      const editorSection = ['params', 'headers', 'body', 'auth', 'scripts', 'tests'].includes(source.editorSection) ? source.editorSection : 'params';
      const saveBearerToken = source.saveBearerToken !== false;
      const savedAuth = persistAuthFields(source.request, saveBearerToken);
      const { responseContract: untrustedResponseContract, ...sourceRequest } = source.request;
      const responseContract = sanitizeOpenApiResponseContract(untrustedResponseContract);
      const request = {
        ...sourceRequest,
        bodyMode: normalizeBodyMode(source.request.bodyMode),
        multipartFields: normalizeMultipartFields(source.request.multipartFields),
        ...savedAuth,
        graphqlQuery: String(source.request.graphqlQuery || ''),
        graphqlVariables: String(source.request.graphqlVariables || ''),
        graphqlOperationName: String(source.request.graphqlOperationName || ''),
        preRequestActions: normalizePreRequestActions(source.request.preRequestActions),
        preRequestActionsEnabled: source.request.preRequestActionsEnabled !== false,
        preRequestActionsLiteralConsent: source.request.preRequestActionsLiteralConsent === true,
        responseCaptureTarget: source.request.responseCaptureTarget === 'vault' ? 'vault' : 'environment',
        ...(responseContract ? { responseContract } : {}),
        allowInsecureHttp: source.request.allowInsecureHttp === true
      };
      tabs.push({
        id,
        title: String(source.title || 'Nova requisição').trim().slice(0, 120) || 'Nova requisição',
        request,
        saveBearerToken,
        activeSaved,
        collectionId: String(source.collectionId || ''),
        folderId: String(source.folderId || ''),
        editorSection,
        dirty: !!source.dirty
      });
    }
    const kept = tabs.slice(-maxWorkspaceTabs);
    const requestedActiveId = String(saved?.activeId || '');
    const activeId = kept.some(tab => tab.id === requestedActiveId) ? requestedActiveId : kept.at(-1)?.id || '';
    return { activeId, tabs: kept };
  }

  function normalizeEnvironmentPickerEntries(environments) {
    const items = Array.isArray(environments)
      ? environments.filter(environment => environment && typeof environment === 'object' && !Array.isArray(environment))
      : [];
    if (!items.length) return [{ id: '', name: 'Nenhum ambiente criado', group: '', disabled: true }];
    return items.map(environment => ({
      id: String(environment.id ?? ''),
      name: String(environment.name ?? '').trim() || 'Ambiente sem nome',
      group: String(environment.group ?? '').trim() || 'Geral',
      disabled: false
    }));
  }

  function isSensitiveVariableName(name) {
    const normalized = String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
    return ['authorization', 'auth', 'bearer', 'token', 'secret', 'password', 'passwd', 'senha', 'credential', 'cookie', 'apikey', 'privatekey'].some(part => normalized.includes(part));
  }

  function exportEnvironmentVariables(variables, includeSensitive = false) {
    const result = {};
    if (!variables || typeof variables !== 'object' || Array.isArray(variables)) return result;
    for (const [key, value] of Object.entries(variables)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (normalizedKey.includes('cookie') || normalizedKey.includes('privatekey') || isSensitiveVariableName(key) && includeSensitive !== true) continue;
      Object.defineProperty(result, key, { value: String(value ?? ''), enumerable: true, writable: true, configurable: true });
    }
    return result;
  }

  function buildPostmanEnvironmentExport(environment, options = {}) {
    if (!environment || typeof environment !== 'object' || Array.isArray(environment)) throw Error('Ambiente inválido para exportação.');
    const id = String(options.id || '').trim(), name = String(environment.name || '').trim(), exportedAt = String(options.exportedAt || '').trim();
    if (!id) throw Error('ID do ambiente Postman obrigatório.');
    if (!name || name.length > 80) throw Error('Nome do ambiente inválido.');
    if (!exportedAt) throw Error('Data de exportação obrigatória.');
    const variables = exportEnvironmentVariables(environment.variables, options.includeSensitive === true);
    return {
      id,
      name,
      values: Object.entries(variables).map(([key, value]) => ({ key, value, type: isSensitiveVariableName(key) ? 'secret' : 'default', enabled: true })),
      _postman_variable_scope: 'environment',
      _postman_exported_at: exportedAt,
      _postman_exported_using: 'Vortix'
    };
  }

  function importPostmanEnvironment(document) {
    if (!document || typeof document !== 'object' || Array.isArray(document) || !Array.isArray(document.values) || (!document._postman_variable_scope && !document.name)) return null;
    const variables = {};
    for (const item of document.values) {
      if (!item?.key || item.enabled === false) continue;
      Object.defineProperty(variables, String(item.key), { value: String(item.value ?? ''), enumerable: true, writable: true, configurable: true });
    }
    return { name: String(document.name || 'Ambiente Postman'), group: 'Importado', variables };
  }

  function datasetValue(value) {
    if (typeof value === 'string') return value;
    if (value === null || typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value);
  }

  function parseDataSets(source) {
    const text = String(source || '').trim();
    if (!text) return [{}];
    if (text.length > 100_000) throw Error('Os dados de execução ultrapassam 100 KB.');

    let values;
    try { values = JSON.parse(text); }
    catch { throw Error('Informe um array JSON válido, por exemplo [{"id":1},{"id":2}].'); }
    if (!Array.isArray(values) || values.length < 1 || values.length > maxDataSets) {
      throw Error(`Informe um array com 1 a ${maxDataSets} conjuntos de dados.`);
    }

    return values.map((value, index) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw Error(`O conjunto ${index + 1} precisa ser um objeto JSON.`);
      }
      const variables = Object.create(null);
      for (const [key, item] of Object.entries(value)) {
        if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/.test(key) || reservedNames.has(key)) {
          throw Error(`Nome de variável inválido no conjunto ${index + 1}: ${key}`);
        }
        variables[key] = datasetValue(item);
      }
      return variables;
    });
  }

  function normalizePreRequestActions(actions) {
    if (actions == null) return [];
    if (!Array.isArray(actions) || actions.length > 10) throw Error('Informe até 10 ações pré-request.');
    return actions.map((source, index) => {
      if (!source || typeof source !== 'object' || Array.isArray(source)) throw Error(`A ação ${index + 1} está inválida.`);
      const type = String(source.type || ''), name = String(source.name || '').trim();
      if (!['uuid', 'timestamp', 'template'].includes(type)) throw Error(`O tipo da ação ${index + 1} não é suportado.`);
      if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/.test(name) || reservedNames.has(name)) throw Error(`Informe um nome de variável válido para a ação ${index + 1}.`);
      if (type !== 'template') return { type, name };
      const value = String(source.value ?? '');
      if (value.length > 1000) throw Error(`O template da ação ${index + 1} ultrapassa 1000 caracteres.`);
      return { type, name, value };
    });
  }

  function preRequestActionHasLiteralText(action) {
    if (action?.type !== 'template') return false;
    const value = String(action.value ?? ''), hasReferences = /\{\{\s*[^{}]+\s*\}\}/.test(value);
    const literal = value.replace(/\{\{\s*[^{}]+\s*\}\}/g, '');
    return !hasReferences && !!literal.trim() || /[^\s\-_.:/?&=+,;@]/u.test(literal);
  }

  function persistablePreRequestActions(actions, allowLiteralText = false) {
    const normalized = normalizePreRequestActions(actions);
    const safe = allowLiteralText ? normalized : normalized.filter(action => !preRequestActionHasLiteralText(action));
    return { actions: safe, redacted: safe.length !== normalized.length };
  }

  function preRequestActionsAffectBaseUrl(request = {}) {
    if (request?.preRequestActionsEnabled === false) return false;
    const references = new Set([...String(request?.baseUrl || '').matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map(match => match[1].trim()));
    return normalizePreRequestActions(request?.preRequestActions).some(action => references.has(action.name));
  }

  function runPreRequestActions(actions, environment = {}, dataset = {}, vaultSecrets = {}, options = {}) {
    const normalized = normalizePreRequestActions(actions), variables = Object.create(null), provenance = Object.create(null), vaultValues = Object.create(null);
    const uuidFactory = typeof options.uuidFactory === 'function' ? options.uuidFactory : () => {
      const value = globalThis.crypto?.randomUUID?.();
      if (!value) throw Error('Este navegador não oferece um gerador UUID seguro.');
      return value;
    };
    for (const action of normalized) {
      let value, source = 'pre-request';
      if (action.type === 'uuid') value = uuidFactory();
      else if (action.type === 'timestamp') {
        const date = options.now === undefined ? new Date() : new Date(options.now);
        if (!Number.isFinite(date.getTime())) throw Error('A data da ação timestamp é inválida.');
        value = date.toISOString();
      } else {
        const resolved = resolveTemplateWithProvenance(action.value, environment, dataset, vaultSecrets, variables);
        value = resolved.text;
        for (const [name, dependencySource] of Object.entries(resolved.provenance)) {
          if (dependencySource === 'vault') {
            source = 'vault';
            const used = secretValuesUsedByProvenance({ [name]: dependencySource }, vaultSecrets);
            Object.assign(vaultValues, used);
          } else if (dependencySource === 'pre-request' && provenance[name] === 'vault') {
            source = 'vault';
          }
        }
      }
      Object.defineProperty(variables, action.name, { value: String(value ?? ''), enumerable: true, writable: true, configurable: true });
      provenance[action.name] = source;
    }
    return { variables, provenance, vaultSecrets: vaultValues };
  }

  function preRequestTemplateExpression(value, runtime) {
    const api = runtime === 'insomnia' ? 'insomnia' : 'pm', parts = [];
    let offset = 0;
    for (const match of String(value).matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
      if (match.index > offset) parts.push(JSON.stringify(String(value).slice(offset, match.index)));
      const name = match[1].trim();
      parts.push(`String(${api}.variables.get(${JSON.stringify(name)}) ?? ${JSON.stringify(match[0])})`);
      offset = match.index + match[0].length;
    }
    if (offset < String(value).length) parts.push(JSON.stringify(String(value).slice(offset)));
    return parts.length ? parts.join(' + ') : "''";
  }

  function buildPreRequestScript(actions, runtime = 'insomnia') {
    const normalized = normalizePreRequestActions(actions);
    if (!['insomnia', 'postman'].includes(runtime)) throw Error('Cliente de exportação de script não suportado.');
    if (!normalized.length) return '';
    const api = runtime === 'insomnia' ? 'insomnia' : 'pm';
    const lines = [`// VORTIX_PRE_REQUEST_ACTIONS_V1 ${JSON.stringify(normalized)}`];
    if (runtime === 'insomnia' && normalized.some(action => action.type === 'uuid')) lines.push('const uuid = require("uuid");');
    for (const action of normalized) {
      const value = action.type === 'uuid' ? (runtime === 'insomnia' ? 'uuid.v4()' : 'pm.variables.replaceIn("{{$guid}}")')
        : action.type === 'timestamp' ? 'new Date().toISOString()'
          : preRequestTemplateExpression(action.value, runtime);
      const target = runtime === 'insomnia' ? 'insomnia.variables.localVars' : 'pm.variables';
      lines.push(`${target}.set(${JSON.stringify(action.name)}, ${value});`);
    }
    return lines.join('\n');
  }

  function parsePreRequestScript(script, runtime = 'insomnia') {
    if (typeof script !== 'string' || script.length > 32768) return null;
    try {
      const normalizedScript = script.replace(/\r\n/g, '\n').trimEnd();
      const firstLine = normalizedScript.split('\n', 1)[0];
      const prefix = '// VORTIX_PRE_REQUEST_ACTIONS_V1 ';
      if (!firstLine.startsWith(prefix)) return null;
      const actions = normalizePreRequestActions(JSON.parse(firstLine.slice(prefix.length)));
      return buildPreRequestScript(actions, runtime) === normalizedScript ? actions : null;
    } catch {
      return null;
    }
  }

  function resolveTemplate(value, environment = {}, overrides = {}) {
    const variables = Object.assign(Object.create(null), environment || {}, overrides || {});
    const missing = new Set();
    const resolved = String(value ?? '').replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (whole, key) => {
      if (Object.hasOwn(variables, key)) return String(variables[key]);
      missing.add(key);
      return whole;
    });
    if (missing.size) throw Error('Variável(veis) sem valor no ambiente: ' + [...missing].join(', '));
    return resolved;
  }

  function normalizeVaultSecrets(vaultSecrets) {
    if (!vaultSecrets || typeof vaultSecrets !== 'object' || Array.isArray(vaultSecrets)) {
      return { unavailable: false, locked: false, values: Object.create(null), names: new Set() };
    }
    const names = new Set((Array.isArray(vaultSecrets.names) ? vaultSecrets.names : []).map(String));
    if (vaultSecrets.unavailable === true) {
      return { unavailable: true, locked: false, values: Object.create(null), names };
    }
    if (vaultSecrets.locked === true) {
      return { unavailable: false, locked: true, values: Object.create(null), names };
    }
    return { unavailable: false, locked: false, values: vaultSecrets, names };
  }

  function redactSecretValues(value, secrets) {
    const list = Array.isArray(secrets) ? secrets : secrets && typeof secrets === 'object' ? Object.values(secrets) : [];
    const text = String(value ?? '');
    if (!list.some(Boolean)) return text;
    const redactPlainText = source => {
      let text = String(source ?? '');
      for (const secret of list) {
        if (!secret) continue;
        const secretText = String(secret);
        text = text.split(secretText).join('{{segredo}}');
        const encoded = encodeURIComponent(secretText);
        if (encoded && encoded !== secretText) text = text.split(encoded).join('{{segredo}}');
      }
      return text;
    };
    const jsonPrimitive = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)$/;
    const hasJsonSyntaxSecret = list.some(secret => secret && (/["\\{}\[\],:\s]/.test(String(secret)) || jsonPrimitive.test(String(secret))));
    let isJsonDocument = false;
    if (hasJsonSyntaxSecret) {
      try { JSON.parse(text); isJsonDocument = true; } catch { }
    }
    const redactOutsideJsonStrings = isJsonDocument
      ? source => String(source ?? '').replace(/(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/g, token => list.some(secret => secret && String(secret) === token) ? '"{{segredo}}"' : token)
      : redactPlainText;
    const jsonStringToken = /"(?:\\.|[^"\\])*"/g;
    let output = '', offset = 0;
    for (const match of text.matchAll(jsonStringToken)) {
      output += redactOutsideJsonStrings(text.slice(offset, match.index));
      let decoded;
      try { decoded = JSON.parse(match[0]); } catch { output += redactPlainText(match[0]); offset = match.index + match[0].length; continue; }
      const redacted = redactPlainText(decoded);
      output += redacted === decoded ? match[0] : JSON.stringify(redacted);
      offset = match.index + match[0].length;
    }
    return output + redactOutsideJsonStrings(text.slice(offset));
  }

  function secretValuesUsedByProvenance(provenance, secrets) {
    const used = Object.create(null);
    if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance) || !secrets || typeof secrets !== 'object' || Array.isArray(secrets)) return used;
    for (const [name, source] of Object.entries(provenance)) {
      if (source === 'vault' && Object.hasOwn(secrets, name)) {
        Object.defineProperty(used, name, { value: secrets[name], enumerable: true, writable: true, configurable: true });
      }
    }
    return used;
  }

  function vaultCaptureEnvironmentError(state = {}) {
    if (state.loading === true) return 'Cofre de segredos carregando; aguarde antes de capturar. Nenhum valor será copiado para o ambiente.';
    if (state.unavailable) return 'Cofre de segredos indisponível; a captura foi bloqueada e não cai para o ambiente.';
    const active = String(state.activeEnvironmentId || 'default');
    const vaultEnvironment = String(state.vaultEnvironmentId || '');
    const requestEnvironment = state.requestEnvironmentId == null ? '' : String(state.requestEnvironmentId || 'default');
    if (state.unlocked !== true || !vaultEnvironment || vaultEnvironment !== active)
      return 'Cofre de segredos bloqueado ou de outro ambiente. Desbloqueie o cofre do ambiente ativo antes de capturar; nenhum valor foi salvo no ambiente.';
    if (!requestEnvironment || requestEnvironment !== active)
      return 'O ambiente ativo mudou durante a request; a captura no cofre foi bloqueada e nenhum valor foi salvo.';
    return '';
  }

  function templateReferenceSource(key, environment, dataset, vault, preRequest) {
    if (Object.hasOwn(dataset, key)) return 'dataset';
    if (Object.hasOwn(preRequest, key)) return 'pre-request';
    if (vault.unavailable) return 'unavailable';
    if (vault.locked && vault.names.has(key)) return 'locked';
    if (!vault.locked && Object.hasOwn(vault.values, key)) return 'vault';
    if (Object.hasOwn(environment, key)) return 'environment';
    return 'missing';
  }

  function resolveTemplateWithProvenance(value, environment = {}, overrides = {}, vaultSecrets = {}, preRequestOverrides = {}) {
    const env = environment && typeof environment === 'object' ? environment : {};
    const dataset = overrides && typeof overrides === 'object' ? overrides : {};
    const preRequest = preRequestOverrides && typeof preRequestOverrides === 'object' && !Array.isArray(preRequestOverrides) ? preRequestOverrides : {};
    const vault = normalizeVaultSecrets(vaultSecrets);
    const provenance = {};
    const missing = new Set();
    const text = String(value ?? '').replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (whole, key) => {
      if (Object.hasOwn(dataset, key)) {
        provenance[key] = 'dataset';
        return String(dataset[key]);
      }
      if (Object.hasOwn(preRequest, key)) {
        provenance[key] = 'pre-request';
        return String(preRequest[key]);
      }
      if (vault.unavailable) {
        throw Error('O cofre de segredos está indisponível; não é possível resolver "{{' + key + '}}" com segurança.');
      }
      if (vault.locked && vault.names.has(key)) {
        throw Error('O cofre de segredos está bloqueado; desbloqueie-o para resolver "{{' + key + '}}".');
      }
      if (!vault.locked && Object.hasOwn(vault.values, key)) {
        provenance[key] = 'vault';
        return String(vault.values[key]);
      }
      if (Object.hasOwn(env, key)) {
        provenance[key] = 'environment';
        return String(env[key]);
      }
      missing.add(key);
      return whole;
    });
    if (missing.size) throw Error('Variável(veis) sem valor no ambiente: ' + [...missing].join(', '));
    return { text, provenance };
  }

  function inspectTemplateReferences(fields, environment = {}, overrides = {}, vaultSecrets = {}, preRequestOverrides = {}) {
    const env = environment && typeof environment === 'object' && !Array.isArray(environment) ? environment : {};
    const dataset = overrides && typeof overrides === 'object' && !Array.isArray(overrides) ? overrides : {};
    const preRequest = preRequestOverrides && typeof preRequestOverrides === 'object' && !Array.isArray(preRequestOverrides) ? preRequestOverrides : {};
    const vault = normalizeVaultSecrets(vaultSecrets);
    const sourceFields = fields && typeof fields === 'object' && !Array.isArray(fields) ? fields : {};
    const references = [];
    for (const [field, raw] of Object.entries(sourceFields)) {
      String(raw ?? '').replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (whole, name) => {
        references.push({ field, name, source: templateReferenceSource(name, env, dataset, vault, preRequest) });
        return whole;
      });
    }
    return references;
  }

  function tokenizeShellCommand(source, format) {
    if (typeof source !== 'string' || source.length > 1024 * 1024) throw Error(`Comando ${format} inválido ou maior que 1 MB.`);
    const input = source.trim().replace(/\\\r?\n[ \t]*/g, ' ').replace(/`\r?\n[ \t]*/g, ' ').replace(/\^\r?\n[ \t]*/g, ' ');
    const tokens = [];
    let token = '', quote = '', active = false;
    for (let index = 0; index < input.length; index++) {
      const character = input[index];
      if (quote) {
        if (character === quote) { quote = ''; active = true; continue; }
        if (character === '\\' && quote === '"' && index + 1 < input.length) { token += input[++index]; active = true; continue; }
        token += character; active = true; continue;
      }
      if (character === "'" || character === '"') {
        quote = character; active = true; continue;
      }
      if (character === '\\' && index + 1 < input.length) { token += input[++index]; active = true; continue; }
      if (/\s/.test(character)) { if (active) { tokens.push(token); token = ''; active = false; } continue; }
      token += character; active = true;
    }
    if (quote) throw Error(`Aspas não fechadas no comando ${format}.`);
    if (active) tokens.push(token);
    return tokens;
  }

  function parseCurlCommand(source) {
    const tokens = tokenizeShellCommand(source, 'cURL');
    if (!tokens.length || !/^curl(?:\.exe)?$/i.test(tokens[0])) throw Error('Cole um comando iniciado por curl.');
    const headers = [], data = [];
    let url = '', method = '', bearerToken = '', dataType = '', headOnly = false, jsonMode = false;
    const ignoredFlags = new Set(['--include', '-i', '--silent', '-s', '-sS', '-Ss', '--show-error', '-S', '--fail', '--fail-with-body']);
    const readValue = (option, inline, index) => {
      if (inline !== null) return { value: inline, index };
      if (index + 1 >= tokens.length) throw Error('Falta valor para uma opção do comando cURL.');
      return { value: tokens[index + 1], index: index + 1 };
    };
    const addHeader = (raw) => {
      const colon = raw.indexOf(':');
      if (colon < 1) throw Error('Header cURL inválido.');
      const name = raw.slice(0, colon).trim(), value = raw.slice(colon + 1).trim();
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\r\n]/.test(value)) throw Error('Header cURL inválido.');
      if (/^authorization$/i.test(name) && /^Bearer\s+\S[\s\S]*$/i.test(value)) {
        if (bearerToken) throw Error('O comando cURL contém mais de um token Bearer.');
        bearerToken = value.replace(/^Bearer\s+/i, '');
        return;
      }
      if (/authorization|cookie|token|secret|password|credential|api[-_]?key/i.test(name)) throw Error('Header sensível não suportado pela importação cURL.');
      headers.push([name, value]);
    };
    for (let index = 1; index < tokens.length; index++) {
      const argument = tokens[index];
      let option = argument, inline = null;
      if (argument.startsWith('--')) {
        const equals = argument.indexOf('=');
        if (equals > 2) { option = argument.slice(0, equals); inline = argument.slice(equals + 1); }
      } else if (/^-X.+/.test(argument)) { option = '-X'; inline = argument.slice(2); }
      else if (/^-H.+/.test(argument)) { option = '-H'; inline = argument.slice(2); }
      else if (/^-d.+/.test(argument)) { option = '-d'; inline = argument.slice(2); }
      if (option === '--user' || option === '-u' || argument.startsWith('-u')) throw Error('Autentica\u00e7\u00e3o Basic n\u00e3o suportada; remova a credencial do comando.');
      if (option === '--url' || option === '--request' || option === '-X' || option === '--header' || option === '-H' || option === '--data' || option === '--data-raw' || option === '--data-binary' || option === '-d' || option === '--json') {
        const result = readValue(option, inline, index);
        const value = result.value;
        index = result.index;
        if (option === '--url') { if (url) throw Error('O comando cURL contém mais de uma URL.'); url = value; continue; }
        if (option === '--request' || option === '-X') { method = value.toUpperCase(); continue; }
        if (option === '--header' || option === '-H') { addHeader(value); continue; }
        const kind = option === '--json' ? 'json' : option === '--data-binary' ? 'binary' : 'form';
        if ((option === '--data' || option === '--data-binary' || option === '-d' || option === '--json') && value.startsWith('@')) throw Error('Importação de body por arquivo não suportada; anexe o arquivo manualmente.');
        if (dataType && dataType !== kind) throw Error('O comando cURL mistura formatos de body não suportados.');
        if (kind === 'binary' && data.length) throw Error('Múltiplas partes de body binário não são suportadas.');
        dataType = kind; data.push(value); if (kind === 'json') jsonMode = true; continue;
      }
      if (option === '--head' || option === '-I') { headOnly = true; continue; }
      if (ignoredFlags.has(argument)) continue;
      if (argument.startsWith('-')) throw Error('Opção cURL não suportada: ' + option + '.');
      if (url) throw Error('O comando cURL contém mais de uma URL.');
      url = argument;
    }
    if (!url) throw Error('URL não encontrada no comando cURL.');
    let parsedUrl;
    try { parsedUrl = new URL(url); } catch { throw Error('Informe uma URL absoluta HTTP ou HTTPS no comando cURL.'); }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw Error('A URL precisa usar HTTP ou HTTPS.');
    if (parsedUrl.username || parsedUrl.password) throw Error('Remova as credenciais embutidas na URL antes de importar.');
    if (parsedUrl.hash) throw Error('Remova o fragmento da URL antes de importar.');
    const body = data.join(jsonMode ? '' : '&');
    const effectiveMethod = method || (headOnly ? 'HEAD' : data.length ? 'POST' : 'GET');
    if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(effectiveMethod)) throw Error('Método HTTP não suportado pelo Vortix.');
    if (data.length && ['GET', 'HEAD', 'OPTIONS'].includes(effectiveMethod)) throw Error('O comando cURL envia body com método que não aceita body no Vortix.');
    const hasHeader = name => headers.some(([headerName]) => headerName.toLowerCase() === name);
    if (data.length && !hasHeader('content-type')) headers.push(['Content-Type', jsonMode ? 'application/json' : 'application/x-www-form-urlencoded']);
    if (jsonMode && !hasHeader('accept')) headers.push(['Accept', 'application/json']);
    return { method: effectiveMethod, url: parsedUrl.href, headers, body, bearerToken };
  }

  function parseHttpieCommand(source) {
    const tokens = tokenizeShellCommand(source, 'HTTPie');
    if (!tokens.length || !/^https?(?:\.exe)?$/i.test(tokens[0])) throw Error('Cole um comando iniciado por http ou https.');
    const defaultScheme = tokens[0].toLowerCase().startsWith('https') ? 'https' : 'http';
    const headers = [], query = [], bodyFields = Object.create(null);
    let url = '', method = '', formMode = false, bearerToken = '', rawBody = null, rawProvided = false;
    const sensitiveName = name => /auth|bearer|token|secret|password|passwd|senha|credential|cookie|api[-_.]?key|private[-_.]?key/i.test(String(name || ''));
    const addHeader = raw => {
      const colon = raw.indexOf(':'), emptyValue = colon < 0 && raw.endsWith(';');
      if (!emptyValue && colon < 1) throw Error('Header HTTPie inválido.');
      const name = (emptyValue ? raw.slice(0, -1) : raw.slice(0, colon)).trim();
      const value = emptyValue ? '' : raw.slice(colon + 1).trim();
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\r\n]/.test(value)) throw Error('Header HTTPie inválido.');
      if (/^authorization$/i.test(name) && /^Bearer\s+\S[\s\S]*$/i.test(value)) {
        if (bearerToken) throw Error('O comando HTTPie contém mais de um token Bearer.');
        bearerToken = value.replace(/^Bearer\s+/i, '');
        return;
      }
      if (sensitiveName(name)) throw Error('Header sensível não suportado pela importação HTTPie; configure Auth manualmente.');
      headers.push([name, value]);
    };
    const addBodyField = (name, value) => {
      if (rawProvided) throw Error('O comando HTTPie não pode misturar --raw com campos de body.');
      if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(name) || ['__proto__','prototype','constructor'].includes(name.toLowerCase())) throw Error('Nome de campo HTTPie inválido.');
      if (sensitiveName(name)) throw Error('Campo sensível não suportado pela importação HTTPie; configure Auth manualmente.');
      if (Object.hasOwn(bodyFields, name)) throw Error('Campo repetido não suportado pela importação HTTPie.');
      Object.defineProperty(bodyFields, name, { value, enumerable: true, writable: true, configurable: true });
    };
    for (let index = 1; index < tokens.length; index++) {
      const argument = tokens[index];
      if (argument === '--form' || argument === '-f') {
        if (rawProvided) throw Error('O comando HTTPie não pode misturar --raw com --form.');
        formMode = true;
        continue;
      }
      if (argument === '--json' || argument === '-j') { formMode = false; continue; }
      if (argument === '--raw' || argument.startsWith('--raw=')) {
        if (rawProvided) throw Error('O comando HTTPie contém mais de um --raw.');
        if (formMode) throw Error('O comando HTTPie não pode misturar --raw com --form.');
        if (Object.keys(bodyFields).length) throw Error('O comando HTTPie não pode misturar --raw com campos de body.');
        let value;
        if (argument === '--raw') {
          if (index + 1 >= tokens.length) throw Error('Falta valor para --raw no comando HTTPie.');
          value = tokens[++index];
        } else value = argument.slice('--raw='.length);
        rawProvided = true;
        rawBody = value;
        continue;
      }
      if (argument === '--auth' || argument === '-a' || argument.startsWith('--auth=') || argument.startsWith('-a=')) throw Error('Auth Basic do comando HTTPie não é importada; configure Auth manualmente.');
      if (argument === '--auth-type' || argument.startsWith('--auth-type=') || argument === '--session' || argument.startsWith('--session=')) throw Error('Opções de Auth/sessão HTTPie não são importadas; configure Auth manualmente.');
      if (argument.startsWith('-')) throw Error('Opção HTTPie não suportada: ' + argument.split('=', 1)[0] + '.');
      if (!url) {
        if (!method && /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/i.test(argument)) { method = argument.toUpperCase(); continue; }
        url = argument;
        continue;
      }
      const jsonSeparator = argument.indexOf(':=');
      if (jsonSeparator > 0) {
        if (formMode) throw Error('Campos JSON não podem ser misturados com --form.');
        const name = argument.slice(0, jsonSeparator), rawValue = argument.slice(jsonSeparator + 2);
        if (rawValue.startsWith('@')) throw Error('Body por arquivo não suportado; anexe o arquivo manualmente.');
        let value;
        try { value = JSON.parse(rawValue); }
        catch { throw Error('Valor JSON inválido no comando HTTPie.'); }
        addBodyField(name, value);
        continue;
      }
      const equals = argument.indexOf('='), colon = argument.indexOf(':');
      if (colon > 0 && (equals < 0 || colon < equals)) { addHeader(argument); continue; }
      const querySeparator = argument.indexOf('==');
      if (querySeparator > 0 && querySeparator === equals) {
        const name = argument.slice(0, querySeparator), value = argument.slice(querySeparator + 2);
        if (sensitiveName(name)) throw Error('Parâmetro sensível não suportado pela importação HTTPie; use variável de ambiente.');
        query.push([name, value]);
        continue;
      }
      if (equals > 0) {
        const name = argument.slice(0, equals), value = argument.slice(equals + 1);
        if (value.startsWith('@') || name.includes('@')) throw Error('Body por arquivo não suportado; anexe o arquivo manualmente.');
        addBodyField(name, value);
        continue;
      }
      if (/^[^:@=]+@/.test(argument) || argument.startsWith('@')) throw Error('Body por arquivo não suportado; anexe o arquivo manualmente.');
      if (argument.includes(':')) { addHeader(argument); continue; }
      if (argument.endsWith(';')) { addHeader(argument); continue; }
      throw Error('Item de request HTTPie não suportado.');
    }
    if (!url) throw Error('URL não encontrada no comando HTTPie.');
    const urlText = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `${defaultScheme}://${url}`;
    let parsedUrl;
    try { parsedUrl = new URL(urlText); } catch { throw Error('Informe uma URL HTTP ou HTTPS válida no comando HTTPie.'); }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw Error('A URL precisa usar HTTP ou HTTPS.');
    if (parsedUrl.username || parsedUrl.password) throw Error('Remova credenciais embutidas na URL antes de importar.');
    if (parsedUrl.hash) throw Error('Remova o fragmento da URL antes de importar.');
    for (const [name] of parsedUrl.searchParams) if (sensitiveName(name)) throw Error('Parâmetro sensível não suportado pela importação HTTPie; use variável de ambiente.');
    for (const [name, value] of query) parsedUrl.searchParams.append(name, value);
    const fieldNames = Object.keys(bodyFields);
    const effectiveMethod = method || ((fieldNames.length || rawProvided) ? 'POST' : 'GET');
    if (!['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(effectiveMethod)) throw Error('Método HTTP não suportado pelo Vortix.');
    if ((fieldNames.length || rawProvided) && ['GET','HEAD','OPTIONS'].includes(effectiveMethod)) throw Error('O comando HTTPie envia body com método que não aceita body no Vortix.');
    const hasHeader = name => headers.some(([headerName]) => headerName.toLowerCase() === name);
    let body = '';
    if (rawProvided) body = rawBody;
    else if (fieldNames.length) {
      if (formMode) {
        const params = new URLSearchParams();
        for (const name of fieldNames) {
          const value = bodyFields[name];
          if (value !== null && typeof value === 'object') throw Error('--form aceita somente valores de texto simples.');
          params.append(name, String(value ?? ''));
        }
        body = params.toString();
        if (!hasHeader('content-type')) headers.push(['Content-Type', 'application/x-www-form-urlencoded']);
      } else {
        body = JSON.stringify(bodyFields, null, 2);
        if (!hasHeader('content-type')) headers.push(['Content-Type', 'application/json']);
      }
    }
    if (fieldNames.length && !formMode && !hasHeader('accept')) headers.push(['Accept', 'application/json']);
    return { method: effectiveMethod, url: parsedUrl.href, headers, body, bearerToken };
  }

  function quoteBashArgument(value) {
    return "'" + String(value ?? '').replaceAll("'", "'\\''") + "'";
  }

  function quotePowerShellArgument(value) {
    return "'" + String(value ?? '').replaceAll("'", "''") + "'";
  }

  function parseCurlRequestHeaders(source) {
    const pairs = [];
    const add = (rawName, rawValue) => {
      const name = String(rawName ?? '').trim(), value = String(rawValue ?? '').trim();
      if (!name || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\r\n]/.test(value))
        throw Error('Header inválido na request; revise nomes e valores.');
      pairs.push([name, value]);
    };
    const addLine = line => {
      const text = String(line ?? '').trim();
      if (!text) return;
      const colon = text.indexOf(':');
      if (colon < 1) throw Error('Header inválido na request; use o formato Nome: valor.');
      add(text.slice(0, colon), text.slice(colon + 1));
    };
    if (source == null || source === '') return pairs;
    if (typeof source === 'string') {
      for (const line of source.split(/\r?\n/)) addLine(line);
      return pairs;
    }
    if (Array.isArray(source)) {
      for (const item of source) {
        if (Array.isArray(item)) add(item[0], item[1]);
        else if (typeof item === 'string') addLine(item);
        else if (item && typeof item === 'object') add(item.name ?? item.key, item.value);
        else throw Error('Headers da request inválidos.');
      }
      return pairs;
    }
    if (typeof source === 'object') {
      for (const [name, rawValues] of Object.entries(source)) {
        for (const value of Array.isArray(rawValues) ? rawValues : [rawValues]) add(name, value);
      }
      return pairs;
    }
    throw Error('Headers da request inválidos.');
  }

  const curlTemplatePattern = /\{\{[^{}]+\}\}/;
  const curlTemplateNamePattern = /^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/;

  function validateCurlUrl(value, commandLabel = 'cURL') {
    const label = String(commandLabel || 'cURL');
    const source = String(value ?? '').trim();
    if (!source) throw Error('Informe uma URL absoluta HTTP ou HTTPS para o comando ' + label + '.');
    let cursor = 0;
    for (const match of source.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
      if (!curlTemplateNamePattern.test(match[1].trim()))
        throw Error('Template de URL inválido; use nomes simples como {{baseUrl}} ou {{id}}.');
      if (/[{}]/.test(source.slice(cursor, match.index)))
        throw Error('Template de URL malformado; remova chaves extras.');
      cursor = match.index + match[0].length;
    }
    if (/[{}]/.test(source.slice(cursor)))
      throw Error('Template de URL malformado; remova chaves extras.');
    const leading = /^\{\{\s*([^{}]+?)\s*\}\}/.exec(source);
    if (leading) {
      const suffix = source.slice(leading[0].length);
      if (/^#/.test(suffix)) throw Error('Remova o fragmento da URL antes de gerar o comando.');
      if (/^@/.test(suffix)) throw Error('Remova as credenciais embutidas na URL antes de gerar o comando.');
      if (/^:\/\//.test(suffix))
        throw Error('Templates não podem definir o esquema da URL; use uma URL HTTP(S) completa.');
      if (suffix && !/^[/?]/.test(suffix) && !/^:(?:\d+|\{\{)/.test(suffix))
        throw Error('Template de URL em posição insegura; use {{baseUrl}} ou inclua o esquema HTTP(S) literalmente.');
    }
    if (/\{\{[^{}]+\}\}:\/\//.test(source))
      throw Error('Templates não podem definir o esquema da URL; use uma URL HTTP(S) completa.');
    if (source.includes('#'))
      throw Error('Remova o fragmento da URL antes de gerar o comando.');
    const literalScheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(source);
    if (!literalScheme && !leading)
      throw Error('Informe uma URL absoluta HTTP ou HTTPS para o comando ' + label + '.');
    if (literalScheme && !['http', 'https'].includes(literalScheme[1].toLowerCase()))
      throw Error('A URL do comando ' + label + ' precisa usar HTTP ou HTTPS.');
    let masked = '';
    cursor = 0;
    for (const match of source.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
      masked += source.slice(cursor, match.index);
      if (match.index === 0) masked += 'https://vortix.invalid';
      else {
        const previous = source[match.index - 1], next = source[match.index + match[0].length] || '';
        masked += previous === ':' && (next === '/' || next === '?' || next === '') ? '1' : 'vortix';
      }
      cursor = match.index + match[0].length;
    }
    masked += source.slice(cursor);
    let parsed;
    try { parsed = new URL(masked); }
    catch { throw Error('Informe uma URL absoluta HTTP ou HTTPS para o comando ' + label + '.'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw Error('A URL do comando ' + label + ' precisa usar HTTP ou HTTPS.');
    if (parsed.username || parsed.password) throw Error('Remova as credenciais embutidas na URL antes de gerar o comando.');
    if (parsed.hash) throw Error('Remova o fragmento da URL antes de gerar o comando.');
    if (!parsed.hostname) throw Error('Informe uma URL absoluta HTTP ou HTTPS para o comando ' + label + '.');
    return source;
  }

  function encodeCurlQueryComponent(value) {
    return String(value ?? '').split(/(\{\{[^{}]+\}\})/g).map((part, index) => index % 2 ? part : encodeURIComponent(part)).join('');
  }

  function appendCurlQueryParameter(url, name, value) {
    const pair = encodeCurlQueryComponent(name) + '=' + encodeCurlQueryComponent(value);
    if (url.endsWith('?') || url.endsWith('&')) return url + pair;
    return url + (url.includes('?') ? '&' : '?') + pair;
  }

  function curlUrlHasQueryParameter(url, name) {
    const queryIndex = url.indexOf('?');
    if (queryIndex < 0) return false;
    for (const part of url.slice(queryIndex + 1).split('&')) {
      const rawName = part.split('=', 1)[0];
      let decoded;
      try { decoded = decodeURIComponent(rawName.replace(/\+/g, ' ')); }
      catch { decoded = rawName; }
      if (decoded.toLowerCase() === String(name ?? '').toLowerCase()) return true;
    }
    return false;
  }

  function buildCurlCommand(request, options = {}) {
    if (!request || typeof request !== 'object' || Array.isArray(request))
      throw Error('Request inválida para gerar o comando cURL.');
    const shell = options?.shell === 'powershell' ? 'powershell' : 'bash';
    const includeSensitive = options?.includeSensitive === true;
    const method = String(request.method || 'GET').trim().toUpperCase();
    if (!methods.has(method)) throw Error('Método HTTP não suportado: ' + method);
    const body = String(request.body ?? '');
    if (body.trim() && ['GET', 'HEAD', 'OPTIONS'].includes(method))
      throw Error('GET, HEAD e OPTIONS não enviam body.');
    const rawAuthType = String(request.authType ?? '').trim();
    const normalizedAuthType = rawAuthType
      ? (['api-key', 'apikey'].includes(rawAuthType.toLowerCase()) ? 'apiKey' : rawAuthType.toLowerCase())
      : undefined;
    const auth = normalizeAuthFields({ ...request, authType: normalizedAuthType });
    const warnings = [], warningSet = new Set();
    const warn = message => {
      const text = String(message ?? '');
      if (text && !warningSet.has(text)) { warningSet.add(text); warnings.push(text); }
    };

    const headerPairs = parseCurlRequestHeaders(request.headers);
    if (includeSensitive && headerPairs.some(([name]) => /^authorization$/i.test(name)))
      throw Error('O proxy rejeita Authorization manual em Headers; configure a credencial em Auth e remova esse header.');
    const hasTemplates = [request.url, body, auth.bearerToken, auth.basicUsername, auth.basicPassword, auth.apiKeyName, auth.apiKeyValue]
      .some(value => curlTemplatePattern.test(String(value ?? '')))
      || headerPairs.some(([name, value]) => curlTemplatePattern.test(name) || curlTemplatePattern.test(value));

    let targetUrl = validateCurlUrl(request.url, 'cURL');
    if (!includeSensitive) {
      const queryIndex = targetUrl.indexOf('?');
      if (queryIndex >= 0) {
        const apiKeyQueryName = auth.authType === 'apiKey' && auth.apiKeyLocation === 'query' ? auth.apiKeyName.toLowerCase() : '';
        const prefix = targetUrl.slice(0, queryIndex), query = targetUrl.slice(queryIndex + 1);
        const kept = [], omitted = new Set();
        for (const part of query.split('&')) {
          if (!part) { kept.push(part); continue; }
          const rawName = part.split('=', 1)[0];
          let name;
          try { name = decodeURIComponent(rawName.replace(/\+/g, ' ')); }
          catch { name = rawName; }
          if (isSensitiveVariableName(name) || (apiKeyQueryName && name.toLowerCase() === apiKeyQueryName)) { omitted.add(name); continue; }
          kept.push(part);
        }
        if (omitted.size) warn('Parâmetros de query sensíveis foram omitidos por padrão: ' + [...omitted].join(', ') + '.');
        targetUrl = kept.join('') ? prefix + '?' + kept.join('&') : prefix;
      }
    }

    const apiKeyHeaderName = auth.authType === 'apiKey' && auth.apiKeyLocation === 'header' ? auth.apiKeyName.toLowerCase() : '';
    const omittedHeaders = new Set(), sentHeaders = [];
    for (const [name, value] of headerPairs) {
      if (!includeSensitive && (isSensitiveVariableName(name) || (apiKeyHeaderName && name.toLowerCase() === apiKeyHeaderName))) { omittedHeaders.add(name); continue; }
      sentHeaders.push([name, value]);
    }
    if (omittedHeaders.size) warn('Headers sensíveis foram omitidos por padrão: ' + [...omittedHeaders].join(', ') + '.');

    const authHeaders = [];
    let basicCredentials = '';
    if (auth.authType !== 'none' && !includeSensitive) {
      warn('Autenticação omitida por padrão. Marque a opção acima para incluir as credenciais.');
      if (auth.authType === 'apiKey' && auth.apiKeyLocation === 'query')
        warn('A API Key na query foi omitida por padrão. Marque a opção acima para incluí-la.');
    } else if (auth.authType === 'bearer' && includeSensitive) {
      let token = auth.bearerToken.trim();
      if (/^Bearer\s+/i.test(token)) token = token.replace(/^Bearer\s+/i, '').trim();
      if (/[\r\n]/.test(token)) throw Error('Token Bearer inválido para o comando cURL.');
      if (token) authHeaders.push(['Authorization', 'Bearer ' + token]);
    } else if (auth.authType === 'basic' && includeSensitive) {
      const username = auth.basicUsername, password = auth.basicPassword;
      if (!username.trim() || username.includes(':') || /[\r\n]/.test(username) || !password || /[\r\n]/.test(password))
        throw Error('Basic Auth requer usuário e senha válidos, sem dois-pontos no usuário.');
      basicCredentials = username + ':' + password;
    } else if (auth.authType === 'apiKey' && includeSensitive) {
      const name = auth.apiKeyName.trim(), value = auth.apiKeyValue;
      if (!name || !value || /[\r\n]/.test(name) || /[\r\n]/.test(value))
        throw Error('API Key requer nome e valor válidos.');
      if (auth.apiKeyLocation === 'query') {
        if (curlUrlHasQueryParameter(targetUrl, name))
          throw Error('A API Key já aparece nos parâmetros da URL; o proxy rejeita a duplicidade. Remova o parâmetro manual ou use apenas o campo Auth.');
        targetUrl = appendCurlQueryParameter(targetUrl, name, value);
      } else {
        if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)
          || ['authorization', 'proxy-authorization', 'host', 'content-length', 'transfer-encoding', 'content-type', 'cookie'].includes(name.toLowerCase()))
          throw Error('Nome de header da API Key inválido ou reservado.');
        if (headerPairs.some(([headerName]) => headerName.toLowerCase() === name.toLowerCase()))
          throw Error('O header da API Key já aparece em Headers; o proxy rejeita a duplicidade. Remova o header manual ou use apenas o campo Auth.');
        authHeaders.push([name, value]);
      }
    }

    if (body && !includeSensitive)
      warn('O body foi omitido por padrão. Marque a opção acima para incluí-lo no comando.');

    const quote = shell === 'powershell' ? quotePowerShellArgument : quoteBashArgument;
    const argumentsList = [shell === 'powershell' ? 'curl.exe' : 'curl', '--request', method, '--url', quote(targetUrl)];
    if (basicCredentials) argumentsList.push('--user', quote(basicCredentials));
    for (const [name, value] of [...sentHeaders, ...authHeaders])
      argumentsList.push('--header', quote(name + ': ' + value));
    if (includeSensitive && body) argumentsList.push('--data-raw', quote(body));
    const command = argumentsList.join(' ');
    if (hasTemplates)
      warn('Templates {{...}} não são resolvidos fora do Vortix; substitua-os manualmente antes de executar o comando cURL, que só funciona depois de substituir esses valores.');
    return { command, warnings };
  }

  function buildHttpieCommand(request, options = {}) {
    if (!request || typeof request !== 'object' || Array.isArray(request))
      throw Error('Request inválida para gerar o comando HTTPie.');
    const shell = options?.shell === 'powershell' ? 'powershell' : 'bash';
    const includeSensitive = options?.includeSensitive === true;
    const method = String(request.method || 'GET').trim().toUpperCase();
    if (!methods.has(method)) throw Error('Método HTTP não suportado: ' + method);
    const body = String(request.body ?? '');
    if (body.trim() && ['GET', 'HEAD', 'OPTIONS'].includes(method))
      throw Error('GET, HEAD e OPTIONS não enviam body.');
    const rawAuthType = String(request.authType ?? '').trim();
    const normalizedAuthType = rawAuthType
      ? (['api-key', 'apikey'].includes(rawAuthType.toLowerCase()) ? 'apiKey' : rawAuthType.toLowerCase())
      : undefined;
    const auth = normalizeAuthFields({ ...request, authType: normalizedAuthType });
    const warnings = [], warningSet = new Set();
    const warn = message => {
      const text = String(message ?? '');
      if (text && !warningSet.has(text)) { warningSet.add(text); warnings.push(text); }
    };

    const headerPairs = parseCurlRequestHeaders(request.headers);
    if (includeSensitive && headerPairs.some(([name]) => /^authorization$/i.test(name)))
      throw Error('O proxy rejeita Authorization manual em Headers; configure a credencial em Auth e remova esse header.');
    const hasTemplates = [request.url, body, auth.bearerToken, auth.basicUsername, auth.basicPassword, auth.apiKeyName, auth.apiKeyValue]
      .some(value => curlTemplatePattern.test(String(value ?? '')))
      || headerPairs.some(([name, value]) => curlTemplatePattern.test(name) || curlTemplatePattern.test(value));

    let targetUrl = validateCurlUrl(request.url, 'HTTPie');
    if (!includeSensitive) {
      const queryIndex = targetUrl.indexOf('?');
      if (queryIndex >= 0) {
        const apiKeyQueryName = auth.authType === 'apiKey' && auth.apiKeyLocation === 'query' ? auth.apiKeyName.toLowerCase() : '';
        const prefix = targetUrl.slice(0, queryIndex), query = targetUrl.slice(queryIndex + 1);
        const kept = [], omitted = new Set();
        for (const part of query.split('&')) {
          if (!part) { kept.push(part); continue; }
          const rawName = part.split('=', 1)[0];
          let name;
          try { name = decodeURIComponent(rawName.replace(/\+/g, ' ')); }
          catch { name = rawName; }
          if (isSensitiveVariableName(name) || (apiKeyQueryName && name.toLowerCase() === apiKeyQueryName)) { omitted.add(name); continue; }
          kept.push(part);
        }
        if (omitted.size) warn('Parâmetros de query sensíveis foram omitidos por padrão: ' + [...omitted].join(', ') + '.');
        targetUrl = kept.join('') ? prefix + '?' + kept.join('&') : prefix;
      }
    }

    const apiKeyHeaderName = auth.authType === 'apiKey' && auth.apiKeyLocation === 'header' ? auth.apiKeyName.toLowerCase() : '';
    const omittedHeaders = new Set(), sentHeaders = [];
    for (const [name, value] of headerPairs) {
      if (!includeSensitive && (isSensitiveVariableName(name) || (apiKeyHeaderName && name.toLowerCase() === apiKeyHeaderName))) { omittedHeaders.add(name); continue; }
      sentHeaders.push([name, value]);
    }
    if (omittedHeaders.size) warn('Headers sensíveis foram omitidos por padrão: ' + [...omittedHeaders].join(', ') + '.');

    const authHeaders = [];
    let basicCredentials = '';
    if (auth.authType !== 'none' && !includeSensitive) {
      warn('Autenticação omitida por padrão. Marque a opção acima para incluir as credenciais.');
      if (auth.authType === 'apiKey' && auth.apiKeyLocation === 'query')
        warn('A API Key na query foi omitida por padrão. Marque a opção acima para incluí-la.');
    } else if (auth.authType === 'bearer' && includeSensitive) {
      let token = auth.bearerToken.trim();
      if (/^Bearer\s+/i.test(token)) token = token.replace(/^Bearer\s+/i, '').trim();
      if (/[\r\n]/.test(token)) throw Error('Token Bearer inválido para o comando HTTPie.');
      if (token) authHeaders.push(['Authorization', 'Bearer ' + token]);
    } else if (auth.authType === 'basic' && includeSensitive) {
      const username = auth.basicUsername, password = auth.basicPassword;
      if (!username.trim() || username.includes(':') || /[\r\n]/.test(username) || !password || /[\r\n]/.test(password))
        throw Error('Basic Auth requer usuário e senha válidos, sem dois-pontos no usuário.');
      basicCredentials = username + ':' + password;
    } else if (auth.authType === 'apiKey' && includeSensitive) {
      const name = auth.apiKeyName.trim(), value = auth.apiKeyValue;
      if (!name || !value || /[\r\n]/.test(name) || /[\r\n]/.test(value))
        throw Error('API Key requer nome e valor válidos.');
      if (auth.apiKeyLocation === 'query') {
        if (curlUrlHasQueryParameter(targetUrl, name))
          throw Error('A API Key já aparece nos parâmetros da URL; o proxy rejeita a duplicidade. Remova o parâmetro manual ou use apenas o campo Auth.');
        targetUrl = appendCurlQueryParameter(targetUrl, name, value);
      } else {
        if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)
          || ['authorization', 'proxy-authorization', 'host', 'content-length', 'transfer-encoding', 'content-type', 'cookie'].includes(name.toLowerCase()))
          throw Error('Nome de header da API Key inválido ou reservado.');
        if (headerPairs.some(([headerName]) => headerName.toLowerCase() === name.toLowerCase()))
          throw Error('O header da API Key já aparece em Headers; o proxy rejeita a duplicidade. Remova o header manual ou use apenas o campo Auth.');
        authHeaders.push([name, value]);
      }
    }

    if (body && !includeSensitive)
      warn('O body foi omitido por padrão. Marque a opção acima para incluí-lo no comando.');

    const quote = shell === 'powershell' ? quotePowerShellArgument : quoteBashArgument;
    const argumentsList = [shell === 'powershell' ? 'http.exe' : 'http'];
    if (basicCredentials) argumentsList.push('--auth', quote(basicCredentials));
    if (includeSensitive && body) argumentsList.push('--raw', quote(body));
    argumentsList.push(method, quote(targetUrl));
    for (const [name, value] of [...sentHeaders, ...authHeaders])
      argumentsList.push(quote(value === '' ? name + ';' : name + ': ' + value));
    const command = argumentsList.join(' ');
    if (hasTemplates)
      warn('Templates {{...}} não são resolvidos fora do Vortix; substitua-os manualmente antes de executar o comando HTTPie, que só funciona depois de substituir esses valores.');
    return { command, warnings };
  }

  const openApiServerPlaceholder = 'https://api.example.test';
  const openApiAuthWarning = 'Auth não é representada integralmente: o OpenAPI contém apenas metadados de esquema; detalhes e valores de credenciais não são representados.';
  const openApiResponseWarning = 'Exemplos e respostas salvas não são representados no OpenAPI; cada operação recebe uma resposta genérica.';
  const openApiBodyValuesWarning = 'Valores literais de bodies não são exportados; somente o esquema é inferido dos campos para evitar compartilhar dados de exemplo.';
  const openApiRouteExposureWarning = 'Nome da coleção, URLs de servidor, paths e nomes de parâmetros/campos são incluídos; revise identificadores e contexto interno antes de compartilhar.';
  const openApiScriptWarning = 'Scripts e automações (pré-request, testes e captura) não são exportados para OpenAPI.';
  const openApiCookieWarning = 'Cookies e Cookie jar não são exportados para OpenAPI.';
  const openApiNestedFolderWarning = 'Pastas aninhadas não são preservadas como hierarquia no OpenAPI; os nomes viram tags achatadas.';
  const openApiMultipartWarning = 'Multipart/form-data não é representado integralmente: arquivos e valores de campos não são incluídos.';
  const openApiGraphqlWarning = 'GraphQL não é representado integralmente: query, variables e operationName não são incluídos no OpenAPI.';

  function openApiHasEntries(value) {
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') return Object.keys(value).length > 0;
    return value === true || (typeof value === 'string' && value.length > 0);
  }

  function openApiHasAuthValues(source) {
    return !!source && typeof source === 'object' && ['bearerToken', 'basicUsername', 'basicPassword', 'apiKeyValue'].some(field => String(source[field] || '').trim());
  }

  function openApiAuthTypeOf(source) {
    const raw = String(source?.authType || (source?.bearerToken ? 'bearer' : source?.basicUsername || source?.basicPassword ? 'basic' : source?.apiKeyValue ? 'apiKey' : 'none'));
    return raw === 'api-key' ? 'apiKey' : raw;
  }

  function openApiAuthFromNode(source, fallback, warn) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return fallback;
    if (source.authMode === 'none') return null;
    if (source.authMode === 'inherit') return fallback;
    if (!source.authType && !openApiHasAuthValues(source)) return fallback;
    const type = openApiAuthTypeOf(source);
    if (!['bearer', 'basic', 'apiKey'].includes(type)) return null;
    if (openApiHasAuthValues(source)) warn(openApiAuthWarning);
    warn(openApiAuthWarning);
    return {
      type,
      name: type === 'apiKey' ? String(source.apiKeyName || '').trim() : '',
      location: type === 'apiKey' && source.apiKeyLocation === 'query' ? 'query' : 'header'
    };
  }

  function createOpenApiSecuritySchemes(warn) {
    const securitySchemes = {}, securitySchemeKeys = new Map();
    const ensureSecurityScheme = auth => {
      if (!auth) return null;
      const metadata = auth.type === 'apiKey'
        ? { type: 'apiKey', in: auth.location, name: auth.name }
        : { type: 'http', scheme: auth.type };
      if (auth.type === 'apiKey' && !metadata.name) {
        warn('Auth API Key sem nome de header/query não pôde ser representada como esquema de segurança.');
        return null;
      }
      const key = JSON.stringify(metadata);
      if (securitySchemeKeys.has(key)) return securitySchemeKeys.get(key);
      const baseName = auth.type === 'apiKey' ? 'apiKeyAuth' : auth.type === 'basic' ? 'basicAuth' : 'bearerAuth';
      let name = baseName, index = 2;
      while (Object.hasOwn(securitySchemes, name)) name = baseName + index++;
      securitySchemes[name] = metadata;
      securitySchemeKeys.set(key, name);
      return name;
    };
    return { securitySchemes, ensureSecurityScheme };
  }

  function warnOpenApiNodeSideData(node, warn) {
    if (openApiHasEntries(node?.responseExamples) || openApiHasEntries(node?.responses) || openApiHasEntries(node?.examples)) warn(openApiResponseWarning);
    if (openApiHasEntries(node?.preRequestActions) || openApiHasEntries(node?.responseTests) || openApiHasEntries(node?.scripts) || openApiHasEntries(node?.actions) || node?.captureResponseVariable === true) warn(openApiScriptWarning);
    if (openApiHasEntries(node?.cookies) || openApiHasEntries(node?.cookieJar)) warn(openApiCookieWarning);
  }

  function openApiIsSafeHttpUrl(value) {
    try {
      const parsed = new URL(value);
      return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password && !parsed.search && !parsed.hash;
    } catch { return false; }
  }

  function openApiTemplate(value) {
    return String(value).replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (whole, name) => '{' + name + '}');
  }

  function openApiServerDefaults(templateNames, environment, warn) {
    const defaults = {};
    let safe = true;
    for (const name of templateNames) {
      if (reservedNames.has(name) || isSensitiveVariableName(name)) {
        warn('Variável de servidor sensível não foi usada; foi aplicado o placeholder ' + openApiServerPlaceholder + '.');
        safe = false;
        continue;
      }
      if (!Object.hasOwn(environment, name)) {
        warn('Variável de servidor ativa ausente (' + name + '); foi aplicado o placeholder ' + openApiServerPlaceholder + '.');
        safe = false;
        continue;
      }
      const value = String(environment[name] ?? '');
      if (!value || /[\r\n]/.test(value) || /\{\{|\}\}/.test(value)) {
        warn('Variável de servidor sem valor seguro (' + name + '); foi aplicado o placeholder ' + openApiServerPlaceholder + '.');
        safe = false;
        continue;
      }
      defaults[name] = value;
    }
    return { defaults, safe };
  }

  function resolveOpenApiServer(raw, environment, warn) {
    const templateNames = [...new Set([...raw.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map(match => match[1]))];
    if (!raw) {
      warn('Servidor real ausente; foi aplicado o placeholder ' + openApiServerPlaceholder + '. Configure servers manualmente.');
      return { url: openApiServerPlaceholder };
    }
    if (!templateNames.length) {
      if (openApiIsSafeHttpUrl(raw)) return { url: raw.replace(/\/+$/, '') || raw };
      warn('Servidor real inválido ou inseguro; foi aplicado o placeholder ' + openApiServerPlaceholder + '. Configure servers manualmente.');
      return { url: openApiServerPlaceholder };
    }
    const { defaults, safe } = openApiServerDefaults(templateNames, environment, warn);
    const substituted = raw.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (whole, name) => Object.hasOwn(defaults, name) ? defaults[name] : whole);
    if (safe && openApiIsSafeHttpUrl(substituted)) {
      const variables = {};
      for (const [name, value] of Object.entries(defaults)) variables[name] = { default: value };
      return { url: openApiTemplate(raw).replace(/\/+$/, '') || openApiServerPlaceholder, variables };
    }
    warn('Servidor real não pôde ser usado com segurança; foi aplicado o placeholder ' + openApiServerPlaceholder + '. Configure servers manualmente.');
    return { url: openApiServerPlaceholder };
  }

  function createOpenApiServerResolver(environment, warn) {
    const serverCache = new Map();
    return source => {
      const raw = String(source || '').trim();
      if (serverCache.has(raw)) return serverCache.get(raw);
      const server = resolveOpenApiServer(raw, environment, warn);
      serverCache.set(raw, server);
      return server;
    };
  }

  function inferOpenApiSchema(value, warn) {
    if (Array.isArray(value)) return { type: 'array', items: value.length ? inferOpenApiSchema(value[0], warn) : {} };
    if (value === null) return { type: 'null' };
    if (typeof value === 'object') {
      const properties = {};
      for (const [name, child] of Object.entries(value)) {
        if (reservedNames.has(name) || isSensitiveVariableName(name)) {
          warn('Campo sensível do body foi omitido do esquema OpenAPI.');
          continue;
        }
        properties[name] = inferOpenApiSchema(child, warn);
      }
      return { type: 'object', ...(Object.keys(properties).length ? { properties } : {}) };
    }
    if (typeof value === 'number') return { type: 'number' };
    if (typeof value === 'boolean') return { type: 'boolean' };
    return { type: 'string' };
  }

  function openApiDefaultContentType(mode) {
    return ({
      json: 'application/json', text: 'text/plain', xml: 'application/xml',
      urlencoded: 'application/x-www-form-urlencoded', multipart: 'multipart/form-data', graphql: 'application/json'
    })[mode] || 'application/json';
  }

  function parseOpenApiHeaderEntries(value) {
    if (typeof value === 'string') {
      return value.split('\n').map(line => {
        const index = line.indexOf(':');
        if (index <= 0) return null;
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      }).filter(Boolean);
    }
    if (Array.isArray(value)) return value.filter(entry => Array.isArray(entry) && entry.length >= 2).map(entry => [String(entry[0]).trim(), String(entry[1] ?? '').trim()]);
    if (value && typeof value === 'object') return Object.entries(value).map(([name, item]) => [String(name).trim(), String(item ?? '').trim()]);
    return [];
  }

  function openApiMediaType(value) {
    return String(value || '').split(';')[0].trim();
  }

  function parseOpenApiMediaTypes(value) {
    return String(value || '').split(',').map(part => openApiMediaType(part)).filter(Boolean);
  }

  function openApiIsValidMediaType(value, allowWildcard) {
    const match = /^([!#$%&'*+\-.^_`|~0-9A-Za-z]+)\/([!#$%&'*+\-.^_`|~0-9A-Za-z]+)$/.exec(String(value || ''));
    if (!match) return false;
    const [, type, subtype] = match;
    if (type === '*' || subtype === '*') return allowWildcard === true && subtype === '*' && (type === '*' || !type.includes('*'));
    return !type.includes('*') && !subtype.includes('*');
  }

  function openApiPathParameters(pathNames) {
    return pathNames.map(name => ({ name, in: 'path', required: true, schema: { type: 'string' } }));
  }

  function appendOpenApiQueryParameters(parameters, rawQuery, warn) {
    const routeParams = [];
    try { for (const entry of new URLSearchParams(rawQuery)) routeParams.push(entry); } catch { /* keep an empty query */ }
    const seenQueries = new Set(parameters.filter(parameter => parameter.in === 'query').map(parameter => parameter.name));
    for (const [name, value] of routeParams) {
      if (!name) continue;
      if (seenQueries.has(name)) continue;
      seenQueries.add(name);
      if (isSensitiveVariableName(name)) { warn('Parâmetro de query sensível foi omitido do OpenAPI.'); continue; }
      const referencedNames = [...String(value).matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map(match => match[1]);
      if (referencedNames.some(isSensitiveVariableName)) { warn('Parâmetro de query com template sensível foi omitido do OpenAPI.'); continue; }
      parameters.push({ name, in: 'query', required: false, schema: { type: 'string' } });
    }
  }

  function appendOpenApiAcceptTypes(acceptTypes, value, warn) {
    for (const type of parseOpenApiMediaTypes(value)) {
      if (openApiIsValidMediaType(type, true)) acceptTypes.push(type);
      else warn('Tipo de mídia inválido foi omitido do OpenAPI.');
    }
  }

  function appendOpenApiHeaderParameter(parameters, seenHeaders, name, warn) {
    const lower = name.toLowerCase();
    if (['authorization', 'proxy-authorization', 'cookie', 'set-cookie'].includes(lower) || isSensitiveVariableName(name)) {
      warn('Header sensível foi omitido do OpenAPI.');
      return;
    }
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) { warn('Header com nome inválido foi omitido do OpenAPI.'); return; }
    if (seenHeaders.has(lower)) return;
    seenHeaders.add(lower);
    parameters.push({ name, in: 'header', required: false, schema: { type: 'string' } });
  }

  function readOpenApiHeaderParameters(parameters, headerEntries, warn) {
    const seenHeaders = new Set();
    const acceptTypes = [];
    let contentType = '';
    for (const [name, value] of headerEntries) {
      const lower = name.toLowerCase();
      if (lower === 'accept') {
        appendOpenApiAcceptTypes(acceptTypes, value, warn);
        continue;
      }
      if (lower === 'content-type') {
        const type = openApiMediaType(value);
        if (openApiIsValidMediaType(type, false)) contentType = type;
        else { warn('Tipo de mídia inválido foi omitido do OpenAPI.'); contentType = ''; }
        continue;
      }
      appendOpenApiHeaderParameter(parameters, seenHeaders, name, warn);
    }
    return { acceptTypes, contentType };
  }

  function buildOpenApiResponses(acceptTypes) {
    const responseContent = {};
    for (const type of [...new Set(acceptTypes)]) responseContent[type] = { schema: {} };
    const responses = { default: { description: 'Resposta genérica; consulte a API para status, headers e body reais.' } };
    if (Object.keys(responseContent).length) responses.default.content = responseContent;
    return responses;
  }

  function openApiJsonSchema(body, warn) {
    let parsed;
    try { parsed = JSON.parse(body); }
    catch { warn('Body JSON inválido foi representado apenas como texto no OpenAPI.'); }
    if (parsed !== undefined) return inferOpenApiSchema(parsed, warn);
    warn('Body JSON inválido foi representado apenas como texto no OpenAPI.');
    return { type: 'string' };
  }

  function openApiUrlEncodedSchema(body, warn) {
    const properties = {};
    for (const [key] of new URLSearchParams(body)) {
      if (reservedNames.has(key) || isSensitiveVariableName(key)) { warn('Campo sensível ou reservado de formulário foi omitido do esquema OpenAPI.'); continue; }
      properties[key] = { type: 'string' };
    }
    return { type: 'object', properties };
  }

  function buildOpenApiRequestBody(request, contentType, warn) {
    const bodyMode = normalizeBodyMode(request.bodyMode);
    if (bodyMode === 'multipart') {
      warn(openApiMultipartWarning);
      return { content: { 'multipart/form-data': { schema: { type: 'object' } } } };
    }
    if (bodyMode === 'graphql') {
      warn(openApiGraphqlWarning);
      return { content: { [contentType || 'application/json']: { schema: { type: 'object' } } } };
    }
    const body = String(request.body ?? '');
    if (!body.trim()) return null;
    const targetContentType = contentType || openApiDefaultContentType(bodyMode), content = { schema: {} };
    if (bodyMode === 'json') content.schema = openApiJsonSchema(body, warn);
    else if (bodyMode === 'urlencoded') content.schema = openApiUrlEncodedSchema(body, warn);
    else {
      content.schema = { type: 'string' };
      if (bodyMode === 'text' || bodyMode === 'xml') warn('Conteúdo textual/XML não mapeável foi representado somente como esquema genérico; os valores foram omitidos.');
    }
    warn(openApiBodyValuesWarning);
    return { content: { [targetContentType]: content } };
  }

  function canonicalizeOpenApiPath(path, registry) {
    const originalNames = [];
    const shape = path.replace(/\{([^{}]+)\}/g, (whole, name) => {
      originalNames.push(name);
      return '{p' + (originalNames.length - 1) + '}';
    });
    if (!registry.has(shape)) {
      const used = new Set();
      registry.set(shape, originalNames.map(name => {
        const candidate = String(name || '').trim() || 'param';
        let canonical = candidate, suffix = 2;
        while (used.has(canonical)) canonical = candidate + suffix++;
        used.add(canonical);
        return canonical;
      }));
    }
    const names = registry.get(shape);
    let index = 0;
    return {
      path: path.replace(/\{([^{}]+)\}/g, () => '{' + names[index++] + '}'),
      pathNames: names
    };
  }

  function openApiRouteInfo(request, pathRegistry = new Map()) {
    const rawRoute = String(request.route || '/');
    const withoutFragment = rawRoute.split('#')[0];
    const queryIndex = withoutFragment.indexOf('?');
    const rawPath = queryIndex >= 0 ? withoutFragment.slice(0, queryIndex) : withoutFragment;
    const rawQuery = queryIndex >= 0 ? withoutFragment.slice(queryIndex + 1) : '';
    let path = rawPath.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (whole, name) => '{' + name + '}').replace(/%7B/gi, '{').replace(/%7D/gi, '}');
    if (!path.startsWith('/')) path = '/' + path;
    if (!path) path = '/';
    return { ...canonicalizeOpenApiPath(path, pathRegistry), rawQuery };
  }

  function createOpenApiOperationIdFactory() {
    let operationNumber = 0;
    return (method, path) => {
      const base = (method.toLowerCase() + '_' + path).replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'operation';
      return base + '_' + (++operationNumber);
    };
  }

  function createOpenApiOperation({ operationId, request, method, path, responses, parameters, requestBody, tags, tagNames }) {
    const operation = {
      operationId,
      summary: String(request.name || '').trim().slice(0, 120) || method + ' ' + path,
      responses,
      parameters
    };
    if (tags.length) {
      const tag = tags[tags.length - 1];
      operation.tags = [tag];
      tagNames.add(tag);
    }
    if (requestBody) operation.requestBody = requestBody;
    return operation;
  }

  function applyOpenApiOperationSecurity(operation, requestScheme, collectionScheme) {
    if (!collectionScheme && !requestScheme) return;
    if (requestScheme && requestScheme === collectionScheme) return;
    operation.security = requestScheme ? [{ [requestScheme]: [] }] : [];
  }

  function walkOpenApiNode(node, depth, tags, inheritedAuth, flattened, warn) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    if (depth > 20) { warn('A coleção tem mais de 20 níveis de pastas; os níveis excedentes foram ignorados.'); return; }
    warnOpenApiNodeSideData(node, warn);
    const nodeAuth = openApiAuthFromNode(node.auth, inheritedAuth, warn);
    for (const request of Array.isArray(node.requests) ? node.requests : []) {
      if (!request || typeof request !== 'object' || Array.isArray(request)) continue;
      warnOpenApiNodeSideData(request, warn);
      flattened.push({ request, tags, inheritedAuth: nodeAuth });
    }
    for (const folder of Array.isArray(node.folders) ? node.folders : []) {
      if (!folder || typeof folder !== 'object' || Array.isArray(folder)) continue;
      const name = String(folder.name || 'Pasta').trim().slice(0, 100) || 'Pasta';
      if (depth + 1 >= 2) warn(openApiNestedFolderWarning);
      walkOpenApiNode(folder, depth + 1, [...tags, name], openApiAuthFromNode(folder.auth, nodeAuth, warn), flattened, warn);
    }
  }

  function collectOpenApiRequests(collection, warn) {
    const flattened = [];
    walkOpenApiNode(collection, 0, [], null, flattened, warn);
    return flattened;
  }

  function buildOpenApiPaths(document, flattened, { warn, ensureSecurityScheme, collectionScheme, globalServer }) {
    const tagNames = new Set();
    const nextOperationId = createOpenApiOperationIdFactory();
    const pathRegistry = new Map();
    for (const item of flattened) {
      const request = item.request;
      const method = String(request.method || 'GET').trim().toUpperCase();
      if (!methods.has(method)) { warn('Método ' + method + ' não suportado e foi ignorado no OpenAPI.'); continue; }
      const route = openApiRouteInfo(request, pathRegistry);
      const parameters = openApiPathParameters(route.pathNames);
      appendOpenApiQueryParameters(parameters, route.rawQuery, warn);
      const { acceptTypes, contentType } = readOpenApiHeaderParameters(parameters, parseOpenApiHeaderEntries(request.headers), warn);
      const responses = buildOpenApiResponses(acceptTypes);
      const requestBody = buildOpenApiRequestBody(request, contentType, warn);
      const pathItem = document.paths[route.path] || (document.paths[route.path] = {});
      const methodKey = method.toLowerCase();
      if (pathItem[methodKey]) throw new Error('A coleção tem operações duplicadas com o mesmo método e path, que o OpenAPI não consegue representar. Combine-as ou renomeie requests antes de exportar.');
      warn(openApiRouteExposureWarning);
      const operation = createOpenApiOperation({
        operationId: nextOperationId(method, route.path),
        request,
        method,
        path: route.path,
        responses,
        parameters,
        requestBody,
        tags: item.tags,
        tagNames
      });
      const effectiveAuth = openApiAuthFromNode(request, item.inheritedAuth, warn);
      const requestScheme = ensureSecurityScheme(effectiveAuth);
      applyOpenApiOperationSecurity(operation, requestScheme, collectionScheme);
      if (JSON.stringify(item.server) !== JSON.stringify(globalServer)) operation.servers = [item.server];
      pathItem[methodKey] = operation;
    }
    return tagNames;
  }

  function buildOpenApi31Export(collection, environmentVariables = {}) {
    if (!collection || typeof collection !== 'object' || Array.isArray(collection)) throw Error('Coleção inválida para exportação OpenAPI.');
    const environment = environmentVariables && typeof environmentVariables === 'object' && !Array.isArray(environmentVariables) ? environmentVariables : {};
    const warnings = new Set();
    const warn = message => { const text = String(message || '').trim(); if (text) warnings.add(text); };
    const { securitySchemes, ensureSecurityScheme } = createOpenApiSecuritySchemes(warn);
    const flattened = collectOpenApiRequests(collection, warn);
    const collectionAuth = openApiAuthFromNode(collection.auth, null, warn);
    const collectionScheme = ensureSecurityScheme(collectionAuth);
    const document = {
      openapi: '3.1.0',
      info: {
        title: String(collection.name || 'Coleção').trim().slice(0, 100) || 'Coleção',
        version: '1.0.0',
        description: 'Documento OpenAPI 3.1 gerado pelo Vortix. Limitações: credenciais de Auth, valores de variáveis sensíveis, exemplos/respostas salvas, scripts/automações, cookies, arquivos multipart e hierarquia de pastas não são representados. Revise os avisos exibidos antes do download.'
      },
      servers: [],
      paths: {}
    };
    if (collectionScheme) document.security = [{ [collectionScheme]: [] }];
    const getServer = createOpenApiServerResolver(environment, warn);
    let globalServer = null;
    for (const item of flattened) {
      item.server = getServer(item.request.baseUrl);
      if (!globalServer) globalServer = item.server;
    }
    if (!globalServer) {
      globalServer = { url: openApiServerPlaceholder };
      warn('A coleção não contém requests; o documento OpenAPI foi gerado sem operações e com o placeholder ' + openApiServerPlaceholder + '.');
    }
    document.servers.push(globalServer);
    const tagNames = buildOpenApiPaths(document, flattened, { warn, ensureSecurityScheme, collectionScheme, globalServer });
    if (tagNames.size) document.tags = [...tagNames].map(name => ({ name }));
    if (Object.keys(securitySchemes).length) document.components = { securitySchemes };
    return { document, warnings: [...warnings] };
  }

  const maxOpenApiResponseContractBytes = 64 * 1024;
  const openApiSchemaDepthLimit = 8;
  const openApiSchemaNodeLimit = 1200;
  const openApiSchemaPropertyLimit = 100;
  const openApiResponseLimit = 100;
  const openApiMediaTypeLimit = 20;
  const openApiJsonTypes = new Set(['null', 'boolean', 'object', 'array', 'number', 'integer', 'string']);
  const openApiSupportedSchemaKeywords = new Set(['type', 'nullable', 'required', 'properties', 'items', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties', 'uniqueItems', 'additionalProperties']);
  const openApiSchemaMetadataKeywords = new Set(['title', 'description', 'example', 'examples', 'default', '$comment', 'deprecated', 'xml', 'externalDocs']);
  const openApiIgnoredSchemaKeywords = new Set(['enum', 'const', 'pattern', 'format', 'allOf', 'oneOf', 'anyOf', 'not', 'if', 'then', 'else', 'discriminator', 'dependentSchemas', 'propertyNames', 'unevaluatedProperties', 'unevaluatedItems', 'contains', 'prefixItems', 'readOnly', 'writeOnly']);
  const openApiResponseMapPartialMessage = 'O mapa de respostas OpenAPI está incompleto ou inválido.';
  const openApiRequestBodyPartialMessage = 'O contrato do body da request contém regras que não podem ser validadas.';
  const openApiRequestBodyMapPartialMessage = 'O mapa de conteúdo do body da request está incompleto ou inválido.';
  const openApiRequestBodyReducedMessage = 'O schema do body excedeu 64 KB e foi reduzido.';
  const openApiSafePartialMessages = new Set([
    'O schema excede o limite de profundidade de 8 níveis.',
    'Referência externa de schema não foi resolvida.',
    'Referência circular de schema foi reduzida.',
    'Referência local de schema não encontrada.',
    'O schema usa um recurso não suportado pelo contrato de resposta.',
    'O schema usa uma lista de itens não suportada pelo contrato de resposta.',
    'O schema usa um tipo não suportado pelo contrato de resposta.',
    'O schema excede o limite de itens do contrato de resposta.',
    'A resposta excede o limite de profundidade de 8 níveis.',
    'Referência externa de resposta não foi resolvida.',
    'Referência circular de resposta foi reduzida.',
    'Referência local de resposta não encontrada.',
    'A resposta excede o limite de itens do contrato de resposta.',
    'O contrato normalizado excedeu 64 KB e foi reduzido.',
    'A estrutura de respostas contém regras que não podem ser validadas.',
    openApiResponseMapPartialMessage,
    openApiRequestBodyPartialMessage,
    openApiRequestBodyMapPartialMessage,
    openApiRequestBodyReducedMessage,
    'Referência externa do body da request não foi resolvida.',
    'Referência circular do body da request foi reduzida.',
    'Referência local do body da request não foi encontrada.',
    'O body da request excede o limite de profundidade de 8 níveis.',
    'O body da request excede o limite de itens do contrato.',
    'A validação estrutural de conteúdo não JSON não é suportada.',
    'O contrato importado contém avisos não confiáveis e precisa de revisão manual.'
  ]);

  function openApiUtf8ByteLength(text) {
    const value = String(text ?? '');
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(value).length;
    return encodeURIComponent(value).replace(/%[0-9A-F]{2}/gi, 'x').length;
  }

  function sanitizeOpenApiContractSchema(schema, state, document = null, depth = 0) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
      state.partial('O schema usa um recurso não suportado pelo contrato de resposta.');
      return {};
    }
    if (depth > openApiSchemaDepthLimit) {
      state.partial('O schema excede o limite de profundidade de 8 níveis.');
      return {};
    }
    if (state.nodesRemaining-- <= 0) {
      state.partial('O schema excede o limite de itens do contrato de resposta.');
      return {};
    }
    if (Object.hasOwn(schema, '$ref')) {
      for (const key in schema) {
        if (!Object.hasOwn(schema, key) || key === '$ref' || openApiSchemaMetadataKeywords.has(key) || /^x-[a-z0-9_.-]+$/i.test(key)) continue;
        state.partial('O schema usa um recurso não suportado pelo contrato de resposta.');
      }
      const ref = String(schema.$ref || '');
      if (!document || !openApiPointerParts(ref)) {
        state.partial('Referência externa de schema não foi resolvida.');
        return {};
      }
      if (state.stack.has(ref)) {
        state.partial('Referência circular de schema foi reduzida.');
        return {};
      }
      if (state.stack.size >= openApiSchemaDepthLimit) {
        state.partial('O schema excede o limite de profundidade de 8 níveis.');
        return {};
      }
      const resolved = resolveOpenApiLocalPointer(document, ref);
      if (!resolved.found) {
        state.partial('Referência local de schema não encontrada.');
        return {};
      }
      state.stack.add(ref);
      const normalized = sanitizeOpenApiContractSchema(resolved.value, state, document, depth + 1);
      state.stack.delete(ref);
      return normalized;
    }

    const result = {};
    let keywordCount = 0;
    for (const key in schema) {
      if (!Object.hasOwn(schema, key)) continue;
      if (keywordCount++ >= 50) { state.partial('O schema excede o limite de itens do contrato de resposta.'); break; }
      if (openApiSupportedSchemaKeywords.has(key) || openApiSchemaMetadataKeywords.has(key) || key === '$ref' || /^x-[a-z0-9_.-]+$/i.test(key)) continue;
      if (openApiIgnoredSchemaKeywords.has(key) || !key.startsWith('x-')) state.partial('O schema usa um recurso não suportado pelo contrato de resposta.');
    }
    for (const key of openApiIgnoredSchemaKeywords) if (Object.hasOwn(schema, key)) state.partial('O schema usa um recurso não suportado pelo contrato de resposta.');

    const version = state.openApiVersion;
    if (Object.hasOwn(schema, 'type')) {
      if (typeof schema.type === 'string') {
        if (openApiJsonTypes.has(schema.type) && !(version === '3.0' && schema.type === 'null')) result.type = schema.type;
        else state.partial('O schema usa um tipo não suportado pelo contrato de resposta.');
      } else if (Array.isArray(schema.type)) {
        const types = [...new Set(schema.type)];
        if (version !== '3.0' && types.length > 0 && types.length === schema.type.length && types.every(type => typeof type === 'string' && openApiJsonTypes.has(type))) result.type = types;
        else state.partial('O schema usa um tipo não suportado pelo contrato de resposta.');
      } else {
        state.partial('O schema usa um tipo não suportado pelo contrato de resposta.');
      }
    }
    if (Object.hasOwn(schema, 'nullable')) {
      if (version === '3.0' && typeof schema.nullable === 'boolean') {
        if (schema.nullable) result.nullable = true;
      } else if (schema.nullable !== false || version !== '3.0') {
        state.partial('O schema usa um recurso não suportado pelo contrato de resposta.');
        if (schema.nullable === true || typeof schema.nullable !== 'boolean') delete result.type;
      }
    }

    if (Object.hasOwn(schema, 'required') && !Array.isArray(schema.required))
      state.partial('O schema usa um recurso não suportado pelo contrato de resposta.');
    if (Array.isArray(schema.required)) {
      const required = [];
      let inspected = 0;
      for (const name of schema.required) {
        if (inspected++ >= openApiSchemaPropertyLimit) { state.partial('O schema excede o limite de itens do contrato de resposta.'); break; }
        if (typeof name === 'string' && name && name.length <= 128 && !reservedNames.has(name) && !required.includes(name)) required.push(name);
        else state.partial('O schema usa um recurso não suportado pelo contrato de resposta.');
      }
      if (required.length) result.required = required;
    }
    if (Object.hasOwn(schema, 'properties') && (!schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)))
      state.partial('O schema usa um recurso não suportado pelo contrato de resposta.');
    if (schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)) {
      const properties = {};
      let count = 0;
      for (const name in schema.properties) {
        if (!Object.hasOwn(schema.properties, name)) continue;
        if (count >= openApiSchemaPropertyLimit) { state.partial('O schema excede o limite de itens do contrato de resposta.'); break; }
        count++;
        if (!name || name.length > 128 || reservedNames.has(name)) { state.partial('O schema usa um recurso não suportado pelo contrato de resposta.'); continue; }
        Object.defineProperty(properties, name, { value: sanitizeOpenApiContractSchema(schema.properties[name], state, document, depth + 1), enumerable: true, writable: true, configurable: true });
      }
      if (Object.keys(properties).length) result.properties = properties;
    }
    if (Object.hasOwn(schema, 'items')) {
      if (Array.isArray(schema.items)) state.partial('O schema usa uma lista de itens não suportada pelo contrato de resposta.');
      else if (!schema.items || typeof schema.items !== 'object') state.partial('O schema usa um recurso não suportado pelo contrato de resposta.');
      else result.items = sanitizeOpenApiContractSchema(schema.items, state, document, depth + 1);
    }
    for (const key of ['minimum', 'maximum', 'multipleOf']) {
      if (!Object.hasOwn(schema, key)) continue;
      if (typeof schema[key] === 'number' && Number.isFinite(schema[key]) && (key !== 'multipleOf' || schema[key] > 0)) result[key] = schema[key];
      else state.partial('O schema usa um recurso não suportado pelo contrato de resposta.');
    }
    for (const [exclusiveKey, boundKey] of [['exclusiveMinimum', 'minimum'], ['exclusiveMaximum', 'maximum']]) {
      if (!Object.hasOwn(schema, exclusiveKey)) continue;
      const exclusive = schema[exclusiveKey];
      if (version === '3.0' && typeof exclusive === 'boolean') {
        if (exclusive) {
          if (typeof schema[boundKey] === 'number' && Number.isFinite(schema[boundKey])) {
            result[exclusiveKey] = schema[boundKey];
            delete result[boundKey];
          } else state.partial('O schema usa um recurso não suportado pelo contrato de resposta.');
        }
      } else if (version !== '3.0' && typeof exclusive === 'number' && Number.isFinite(exclusive)) result[exclusiveKey] = exclusive;
      else {
        state.partial('O schema usa um recurso não suportado pelo contrato de resposta.');
        delete result[boundKey];
        if (exclusive === true && version !== '3.0') continue;
        if (exclusive === false && version === '3.0') continue;
        if (exclusive === true && version === '3.0') {
          if (typeof schema[boundKey] === 'number' && Number.isFinite(schema[boundKey])) {
            result[exclusiveKey] = schema[boundKey];
            delete result[boundKey];
          }
        }
      }
    }
    for (const key of ['minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties']) {
      if (!Object.hasOwn(schema, key)) continue;
      if (Number.isInteger(schema[key]) && schema[key] >= 0) result[key] = schema[key];
      else state.partial('O schema usa um recurso não suportado pelo contrato de resposta.');
    }
    if (Object.hasOwn(schema, 'uniqueItems')) {
      if (typeof schema.uniqueItems !== 'boolean') state.partial('O schema usa um recurso não suportado pelo contrato de resposta.');
      else if (schema.uniqueItems) result.uniqueItems = true;
    }
    if (Object.hasOwn(schema, 'additionalProperties')) {
      if (typeof schema.additionalProperties === 'boolean') result.additionalProperties = schema.additionalProperties;
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object' && !Array.isArray(schema.additionalProperties))
        result.additionalProperties = sanitizeOpenApiContractSchema(schema.additionalProperties, state, document, depth + 1);
      else state.partial('O schema usa um recurso não suportado pelo contrato de resposta.');
    }
    return result;
  }

  function openApiPointerParts(ref) {
    const text = String(ref || '');
    if (text === '#') return [];
    if (!text.startsWith('#/')) return null;
    return text.slice(2).split('/').map(part => {
      const decoded = part.replace(/~1/g, '/').replace(/~0/g, '~');
      try { return decodeURIComponent(decoded); }
      catch { return decoded; }
    });
  }

  function resolveOpenApiLocalPointer(document, ref) {
    const parts = openApiPointerParts(ref);
    if (!parts) return { found: false, external: true };
    let current = document;
    for (const part of parts) {
      if (!current || typeof current !== 'object' || Array.isArray(current) || reservedNames.has(part) || !Object.hasOwn(current, part))
        return { found: false, external: false };
      current = current[part];
    }
    return { found: true, value: current };
  }

  function normalizeOpenApiSchema(schema, document, state, depth = 0) {
    return sanitizeOpenApiContractSchema(schema, state, document, depth);
  }

  function normalizeOpenApiResponseObject(source, document, state, depth = 0) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      state.partial('A estrutura de respostas contém regras que não podem ser validadas.');
      return { content: {} };
    }
    if (depth > openApiSchemaDepthLimit) {
      state.partial('A resposta excede o limite de profundidade de 8 níveis.');
      return { content: {} };
    }
    if (state.nodesRemaining-- <= 0) {
      state.partial('A resposta excede o limite de itens do contrato de resposta.');
      return { content: {} };
    }
    if (Object.hasOwn(source, '$ref')) {
      const ref = String(source.$ref || '');
      const parts = openApiPointerParts(ref);
      if (!parts) {
        state.partial('Referência externa de resposta não foi resolvida.');
        return { content: {} };
      }
      if (state.stack.has(ref)) {
        state.partial('Referência circular de resposta foi reduzida.');
        return { content: {} };
      }
      if (state.stack.size >= openApiSchemaDepthLimit) {
        state.partial('A resposta excede o limite de profundidade de 8 níveis.');
        return { content: {} };
      }
      const resolved = resolveOpenApiLocalPointer(document, ref);
      if (!resolved.found) {
        state.partial('Referência local de resposta não encontrada.');
        return { content: {} };
      }
      state.stack.add(ref);
      const normalized = normalizeOpenApiResponseObject(resolved.value, document, state, depth + 1);
      state.stack.delete(ref);
      return normalized;
    }
    const response = { content: {} };
    if (Object.hasOwn(source, 'content') && (!source.content || typeof source.content !== 'object' || Array.isArray(source.content)))
      state.partial('A estrutura de respostas contém regras que não podem ser validadas.');
    if (source.content && typeof source.content === 'object' && !Array.isArray(source.content)) {
      let count = 0;
      for (const rawMediaType in source.content) {
        if (!Object.hasOwn(source.content, rawMediaType)) continue;
        if (count++ >= openApiMediaTypeLimit) { state.partial('A resposta excede o limite de itens do contrato de resposta.'); break; }
        const media = source.content[rawMediaType];
        const mediaType = String(rawMediaType || '').trim().slice(0, 200);
        if (!mediaType) continue;
        if (!/^(?:\*|[a-z0-9!#$&^_.+-]+)\/(?:\*|[a-z0-9!#$&^_.+-]+)$/i.test(mediaType)) {
          state.partial('A estrutura de respostas contém regras que não podem ser validadas.');
          continue;
        }
        const entry = {};
        if (!media || typeof media !== 'object' || Array.isArray(media))
          state.partial('A estrutura de respostas contém regras que não podem ser validadas.');
        else if (Object.hasOwn(media, 'schema')) entry.schema = normalizeOpenApiSchema(media.schema, document, state, depth + 1);
        Object.defineProperty(response.content, mediaType, { value: entry, enumerable: true, writable: true, configurable: true });
      }
    }
    return response;
  }

  function normalizeOpenApiRequestBodyObject(source, document = null, openApiVersion = null) {
    const partialReasons = new Set();
    const state = {
      openApiVersion,
      stack: new Set(),
      nodesRemaining: openApiSchemaNodeLimit,
      partial: reason => partialReasons.add(openApiSafePartialMessages.has(String(reason)) ? String(reason) : openApiRequestBodyPartialMessage)
    };
    for (const reason of Array.isArray(source?.partialReasons) ? source.partialReasons.slice(0, 50) : [])
      state.partial(typeof reason === 'string' ? reason : '');

    function normalize(sourceBody, depth = 0) {
      if (!sourceBody || typeof sourceBody !== 'object' || Array.isArray(sourceBody)) {
        state.partial(openApiRequestBodyPartialMessage);
        state.partial(openApiRequestBodyMapPartialMessage);
        return { required: false, content: {} };
      }
      if (depth > openApiSchemaDepthLimit) {
        state.partial('O body da request excede o limite de profundidade de 8 níveis.');
        return { required: false, content: {} };
      }
      if (state.nodesRemaining-- <= 0) {
        state.partial('O body da request excede o limite de itens do contrato.');
        return { required: false, content: {} };
      }
      if (Object.hasOwn(sourceBody, '$ref')) {
        for (const key in sourceBody) {
          if (!Object.hasOwn(sourceBody, key) || key === '$ref' || key === 'description' || key === 'summary') continue;
          state.partial(openApiRequestBodyPartialMessage);
        }
        const ref = String(sourceBody.$ref || '');
        if (!document || !openApiPointerParts(ref)) {
          state.partial('Referência externa do body da request não foi resolvida.');
          state.partial(openApiRequestBodyMapPartialMessage);
          return { required: false, content: {} };
        }
        if (state.stack.has(ref)) {
          state.partial('Referência circular do body da request foi reduzida.');
          state.partial(openApiRequestBodyMapPartialMessage);
          return { required: false, content: {} };
        }
        if (state.stack.size >= openApiSchemaDepthLimit) {
          state.partial('O body da request excede o limite de profundidade de 8 níveis.');
          state.partial(openApiRequestBodyMapPartialMessage);
          return { required: false, content: {} };
        }
        const resolved = resolveOpenApiLocalPointer(document, ref);
        if (!resolved.found) {
          state.partial('Referência local do body da request não foi encontrada.');
          state.partial(openApiRequestBodyMapPartialMessage);
          return { required: false, content: {} };
        }
        state.stack.add(ref);
        const normalized = normalize(resolved.value, depth + 1);
        state.stack.delete(ref);
        return normalized;
      }

      const required = Object.hasOwn(sourceBody, 'required') && typeof sourceBody.required === 'boolean' ? sourceBody.required : false;
      if (Object.hasOwn(sourceBody, 'required') && typeof sourceBody.required !== 'boolean') state.partial(openApiRequestBodyPartialMessage);
      const content = {};
      if (Object.hasOwn(sourceBody, 'content') && (!sourceBody.content || typeof sourceBody.content !== 'object' || Array.isArray(sourceBody.content))) {
        state.partial(openApiRequestBodyPartialMessage);
        state.partial(openApiRequestBodyMapPartialMessage);
      } else if (sourceBody.content && typeof sourceBody.content === 'object') {
        let count = 0;
        for (const rawMediaType in sourceBody.content) {
          if (!Object.hasOwn(sourceBody.content, rawMediaType)) continue;
          if (count++ >= openApiMediaTypeLimit) { state.partial('O body da request excede o limite de itens do contrato.'); state.partial(openApiRequestBodyMapPartialMessage); break; }
          const mediaType = String(rawMediaType || '').trim().slice(0, 200);
          if (!/^(?:\*|[a-z0-9!#$&^_.+-]+)\/(?:\*|[a-z0-9!#$&^_.+-]+)$/i.test(mediaType)) {
            state.partial(openApiRequestBodyPartialMessage);
            state.partial(openApiRequestBodyMapPartialMessage);
            continue;
          }
          const rawMedia = sourceBody.content[rawMediaType], media = {};
          if (!rawMedia || typeof rawMedia !== 'object' || Array.isArray(rawMedia)) state.partial(openApiRequestBodyPartialMessage);
          else {
            if (Object.hasOwn(rawMedia, 'schema')) media.schema = sanitizeOpenApiContractSchema(rawMedia.schema, state, document, depth + 1);
            if (Object.hasOwn(rawMedia, 'encoding')) state.partial(openApiRequestBodyPartialMessage);
          }
          Object.defineProperty(content, mediaType, { value: media, enumerable: true, writable: true, configurable: true });
        }
      }
      if (!Object.keys(content).length) {
        state.partial(openApiRequestBodyPartialMessage);
        state.partial(openApiRequestBodyMapPartialMessage);
      }
      return { required, content };
    }

    const normalized = normalize(source);
    normalized.partialReasons = [...partialReasons].slice(0, 50);
    return normalized;
  }

  function capOpenApiResponseContract(contract) {
    const fits = () => openApiUtf8ByteLength(JSON.stringify(contract)) <= maxOpenApiResponseContractBytes;
    if (fits()) return contract;
    contract.partialReasons.push('O contrato normalizado excedeu 64 KB e foi reduzido.');
    const requestBody = contract.requestBody && typeof contract.requestBody === 'object' ? contract.requestBody : null;
    let requestBodySchemaReduced = false;
    for (const media of Object.values(requestBody?.content || {})) {
      if (!media || typeof media !== 'object' || !Object.hasOwn(media, 'schema')) continue;
      media.schema = {};
      requestBodySchemaReduced = true;
    }
    if (requestBodySchemaReduced) {
      if (!requestBody.partialReasons.includes(openApiRequestBodyReducedMessage)) requestBody.partialReasons.push(openApiRequestBodyReducedMessage);
      if (fits()) return contract;
    }
    const responses = contract.responses && typeof contract.responses === 'object' && !Array.isArray(contract.responses) ? contract.responses : (contract.responses = {});
    for (const response of Object.values(responses)) {
      for (const media of Object.values(response?.content || {})) if (media && typeof media === 'object') media.schema = {};
    }
    if (fits()) return contract;
    if (requestBody && Object.keys(requestBody.content || {}).length) {
      requestBody.content = {};
      if (!requestBody.partialReasons.includes(openApiRequestBodyReducedMessage)) requestBody.partialReasons.push(openApiRequestBodyReducedMessage);
      if (!requestBody.partialReasons.includes(openApiRequestBodyMapPartialMessage)) requestBody.partialReasons.push(openApiRequestBodyMapPartialMessage);
      if (fits()) return contract;
    }
    for (const response of Object.values(responses)) response.content = {};
    if (fits()) return contract;
    for (const key of Object.keys(responses)) {
      responses[key] = { content: {} };
      if (fits()) return contract;
    }
    for (const key of Object.keys(responses)) {
      delete responses[key];
      if (fits()) return contract;
    }
    contract.responses = {};
    return contract;
  }

  function sanitizeOpenApiResponseContract(source) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
    const partialReasons = new Set();
    const openApiVersion = /^3\.(?:0|1|2)$/.test(String(source.openApiVersion || '')) ? String(source.openApiVersion) : null;
    const state = {
      openApiVersion,
      stack: new Set(),
      nodesRemaining: openApiSchemaNodeLimit,
      partial: reason => partialReasons.add(openApiSafePartialMessages.has(String(reason)) ? String(reason) : 'O contrato importado contém avisos não confiáveis e precisa de revisão manual.')
    };
    if (Object.hasOwn(source, 'openApiVersion') && !openApiVersion)
      state.partial('O contrato importado contém avisos não confiáveis e precisa de revisão manual.');
    if (Array.isArray(source.partialReasons)) {
      for (const reason of source.partialReasons.slice(0, 50)) {
        const text = typeof reason === 'string' ? reason : '';
        state.partial(openApiSafePartialMessages.has(text) ? text : 'O contrato importado contém avisos não confiáveis e precisa de revisão manual.');
      }
    }
    const method = String(source.method || '').toUpperCase();
    const methods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
    if (!methods.has(method)) return null;
    const pathTemplate = String(source.pathTemplate || '').trim();
    if (!pathTemplate.startsWith('/') || pathTemplate.length > 4096 || /[?#\\\r\n]/.test(pathTemplate)) return null;
    const responses = {};
    if (!source.responses || typeof source.responses !== 'object' || Array.isArray(source.responses)) {
      state.partial(openApiResponseMapPartialMessage);
    } else {
      let responseCount = 0;
      for (const rawStatus in source.responses) {
        if (!Object.hasOwn(source.responses, rawStatus)) continue;
        if (responseCount++ >= openApiResponseLimit) { state.partial('A resposta excede o limite de itens do contrato de resposta.'); state.partial(openApiResponseMapPartialMessage); break; }
        const status = String(rawStatus).trim();
        if (!/^(?:[1-5]\d{2}|[1-5]XX|default)$/i.test(status)) { state.partial(openApiResponseMapPartialMessage); continue; }
        const normalizedStatus = status.toLowerCase() === 'default' ? 'default' : status.toUpperCase();
        const rawResponse = source.responses[rawStatus];
        const content = {};
        if (!rawResponse || typeof rawResponse !== 'object' || Array.isArray(rawResponse)) {
          state.partial('A estrutura de respostas contém regras que não podem ser validadas.');
        } else if (rawResponse.content && typeof rawResponse.content === 'object' && !Array.isArray(rawResponse.content)) {
          let mediaCount = 0;
          for (const rawMediaType in rawResponse.content) {
            if (!Object.hasOwn(rawResponse.content, rawMediaType)) continue;
            if (mediaCount++ >= openApiMediaTypeLimit) { state.partial('A resposta excede o limite de itens do contrato de resposta.'); break; }
            const mediaType = String(rawMediaType).trim().slice(0, 200);
            if (!/^(?:\*|[a-z0-9!#$&^_.+-]+)\/(?:\*|[a-z0-9!#$&^_.+-]+)$/i.test(mediaType)) { state.partial('A estrutura de respostas contém regras que não podem ser validadas.'); continue; }
            const rawMedia = rawResponse.content[rawMediaType], media = {};
            if (!rawMedia || typeof rawMedia !== 'object' || Array.isArray(rawMedia)) {
              state.partial('A estrutura de respostas contém regras que não podem ser validadas.');
            } else if (Object.hasOwn(rawMedia, 'schema')) {
              media.schema = sanitizeOpenApiContractSchema(rawMedia.schema, state);
            }
            Object.defineProperty(content, mediaType, { value: media, enumerable: true, writable: true, configurable: true });
          }
        } else if (Object.hasOwn(rawResponse, 'content')) state.partial('A estrutura de respostas contém regras que não podem ser validadas.');
        Object.defineProperty(responses, normalizedStatus, { value: { content }, enumerable: true, writable: true, configurable: true });
      }
      if (!responseCount) state.partial(openApiResponseMapPartialMessage);
    }
    const normalized = { method, pathTemplate, partialReasons: [...partialReasons].slice(0, 50), responses };
    if (openApiVersion) normalized.openApiVersion = openApiVersion;
    if (Object.hasOwn(source, 'requestBody')) normalized.requestBody = normalizeOpenApiRequestBodyObject(source.requestBody, null, openApiVersion);
    return capOpenApiResponseContract(normalized);
  }

  function openApiContractPathTemplate(serverInfo, path, environmentVariables = {}) {
    let prefix = String(serverInfo?.prefix || '').trim();
    if (!prefix) {
      const base = String(serverInfo?.baseUrl || '').replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (whole, name) =>
        Object.hasOwn(environmentVariables, name) ? String(environmentVariables[name]) : 'vortix');
      try {
        const pathname = new URL(base).pathname.replace(/\/+$/, '');
        if (pathname && pathname !== '/') prefix = pathname;
      } catch { /* templated or relative base URL */ }
    }
    const route = String(path || '/').split('?')[0];
    const full = (prefix + '/' + route.replace(/^\/+/, '')).replace(/\/{2,}/g, '/');
    return full.startsWith('/') ? full : '/' + full;
  }

  function normalizeOpenApiResponseContract(document, operation, method, pathTemplate) {
    const partialReasons = new Set();
    const state = {
      openApiVersion: '3.' + String(document?.openapi || '').split('.')[1],
      stack: new Set(),
      nodesRemaining: openApiSchemaNodeLimit,
      partial: reason => partialReasons.add(String(reason || ''))
    };
    const responses = {};
    const sourceResponseMap = operation?.responses;
    const hasValidResponseMap = !!sourceResponseMap && typeof sourceResponseMap === 'object' && !Array.isArray(sourceResponseMap);
    const sourceResponses = hasValidResponseMap ? sourceResponseMap : {};
    if (!hasValidResponseMap || !Object.keys(sourceResponses).length) state.partial(openApiResponseMapPartialMessage);
    let responseCount = 0;
    for (const rawStatus in sourceResponses) {
      if (!Object.hasOwn(sourceResponses, rawStatus)) continue;
      if (responseCount++ >= openApiResponseLimit) { state.partial('A resposta excede o limite de itens do contrato de resposta.'); state.partial(openApiResponseMapPartialMessage); break; }
      const source = sourceResponses[rawStatus];
      const status = String(rawStatus || '').trim();
      if (!/^(?:[1-5]\d{2}|[1-5]XX|default)$/i.test(status)) { state.partial(openApiResponseMapPartialMessage); continue; }
      const key = status.toLowerCase() === 'default' ? 'default' : status.toUpperCase();
      Object.defineProperty(responses, key, { value: normalizeOpenApiResponseObject(source, document, state), enumerable: true, writable: true, configurable: true });
    }
    const requestBody = operation && Object.hasOwn(operation, 'requestBody')
      ? normalizeOpenApiRequestBodyObject(operation.requestBody, document, state.openApiVersion)
      : null;
    const contract = {
      method: String(method || 'GET').toUpperCase().slice(0, 16),
      pathTemplate: String(pathTemplate || '/').slice(0, 4096),
      partialReasons: [...partialReasons].slice(0, 50),
      responses
    };
    if (requestBody) contract.requestBody = requestBody;
    contract.openApiVersion = state.openApiVersion;
    return sanitizeOpenApiResponseContract(contract);
  }

  function openApiResponseHeader(headers, name) {
    const target = String(name || '').toLowerCase();
    if (Array.isArray(headers)) {
      for (const entry of headers) {
        if (Array.isArray(entry) && String(entry[0] || '').toLowerCase() === target) return String(entry[1] ?? '');
      }
      return '';
    }
    if (headers && typeof headers === 'object') {
      for (const [key, value] of Object.entries(headers)) {
        if (String(key).toLowerCase() !== target) continue;
        return Array.isArray(value) ? value.join(', ') : String(value ?? '');
      }
    }
    return '';
  }

  function openApiRequestHeader(headers, name) {
    const target = String(name || '').toLowerCase();
    if (typeof headers === 'string') {
      for (const line of headers.split(/\r?\n/)) {
        const separator = line.indexOf(':');
        if (separator < 0 || line.slice(0, separator).trim().toLowerCase() !== target) continue;
        return line.slice(separator + 1).trim();
      }
      return '';
    }
    return openApiResponseHeader(headers, target);
  }

  function openApiMediaMatches(declared, actual) {
    const left = String(declared || '').split(';')[0].trim().toLowerCase();
    const right = String(actual || '').split(';')[0].trim().toLowerCase();
    if (!left || !right) return false;
    if (left === right) return true;
    const [leftType, leftSubtype] = left.split('/');
    const [rightType, rightSubtype] = right.split('/');
    if (!leftType || !leftSubtype || !rightType || !rightSubtype) return false;
    if (leftType === '*') return true;
    if (leftType !== rightType) return false;
    return leftSubtype === '*' || leftSubtype === rightSubtype;
  }

  function openApiJsonMediaType(value) {
    const type = String(value || '').split(';')[0].trim().toLowerCase();
    return type === 'application/json' || /^application\/[^/]+\+json$/.test(type) || type === 'text/json';
  }

  function openApiStatusResponse(responses, status) {
    if (!responses || typeof responses !== 'object' || Array.isArray(responses)) return null;
    if (Object.hasOwn(responses, String(status))) return responses[String(status)];
    const range = Math.floor(Number(status) / 100);
    if (Number.isInteger(range) && range >= 1 && range <= 5) {
      const key = Object.keys(responses).find(item => item.toUpperCase() === range + 'XX');
      if (key) return responses[key];
    }
    return Object.hasOwn(responses, 'default') ? responses.default : null;
  }

  function openApiRouteMatchesTemplate(route, template, baseUrl = '') {
    const pathOf = value => {
      try { return new URL(String(value || ''), 'http://localhost').pathname; }
      catch { return String(value || '').split('?')[0]; }
    };
    const routePath = pathOf(route);
    let basePath = '', basePathKnown = false;
    const rawBase = String(baseUrl || '').trim();
    try {
      if (!/^\{\{\s*[^{}]+\s*\}\}\/?$/.test(rawBase)) {
        basePath = new URL(rawBase.replace(/\{\{[^{}]+\}\}/g, 'vortix'), 'http://localhost').pathname.replace(/\/+$/, '');
        basePathKnown = true;
      }
    }
    catch { /* base URL is a whole-variable template */ }
    const effectivePath = basePathKnown
      ? (basePath + '/' + routePath.replace(/^\/+/, '')).replace(/\/{2,}/g, '/')
      : routePath;
    const fullTemplate = String(template || '').split('?')[0];
    const normalized = effectivePath.startsWith('/') ? effectivePath : '/' + effectivePath;
    const templateSource = fullTemplate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{[^{}]+\\\}/g, '[^/]+');
    try { return new RegExp('^' + templateSource + '/?$').test(normalized); }
    catch { return false; }
  }

  function openApiValueMatchesType(value, type) {
    if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
    if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
    if (type === 'string') return typeof value === 'string';
    if (type === 'boolean') return typeof value === 'boolean';
    if (type === 'array') return Array.isArray(value);
    if (type === 'object') return !!value && typeof value === 'object' && !Array.isArray(value);
    if (type === 'null') return value === null;
    return false;
  }

  function validateOpenApiSchemaValue(schema, value, location, issues, warnings, depth = 0) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return;
    if (depth > openApiSchemaDepthLimit) { warnings.push('A resposta excede o limite de profundidade de validação.'); return; }
    if (issues.length >= 50) return;
    if (schema.nullable === true && value === null) return;
    const types = Array.isArray(schema.type) ? schema.type.filter(type => typeof type === 'string') : typeof schema.type === 'string' ? [schema.type] : [];
    if (types.length && !types.some(type => openApiValueMatchesType(value, type))) {
      issues.push('Campo ' + location + ' deve ser do tipo ' + types.join(' ou ') + '.');
      return;
    }
    const isObject = !!value && typeof value === 'object' && !Array.isArray(value);
    if (Array.isArray(schema.required) && isObject) {
      for (const name of schema.required) {
        if (!Object.hasOwn(value, name)) issues.push('Campo ' + location + '.' + name + ' é obrigatório.');
        if (issues.length >= 50) return;
      }
    }
    if (isObject) {
      const properties = schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties) ? schema.properties : {};
      for (const [name, child] of Object.entries(properties)) {
        if (Object.hasOwn(value, name)) validateOpenApiSchemaValue(child, value[name], location + '.' + name, issues, warnings, depth + 1);
        if (issues.length >= 50) return;
      }
      if (schema.additionalProperties === false) {
        let inspected = 0, hasExtra = false;
        for (const name in value) {
          if (!Object.hasOwn(value, name)) continue;
          if (++inspected > 1000) { warnings.push('A resposta excede o limite de propriedades validadas.'); break; }
          if (!Object.hasOwn(properties, name)) { hasExtra = true; break; }
        }
        if (hasExtra) issues.push('A resposta contém propriedades não declaradas no contrato.');
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        let inspected = 0;
        for (const name in value) {
          if (!Object.hasOwn(value, name) || Object.hasOwn(properties, name)) continue;
          if (inspected++ >= 1000) { warnings.push('A resposta excede o limite de propriedades validadas.'); break; }
          validateOpenApiSchemaValue(schema.additionalProperties, value[name], location + '.*', issues, warnings, depth + 1);
          if (issues.length >= 50) return;
        }
      }
    }
    if (schema.items && Array.isArray(value)) {
      const limit = Math.min(value.length, 1000);
      if (value.length > limit) warnings.push('A resposta excede o limite de itens validados.');
      for (let index = 0; index < limit; index++) validateOpenApiSchemaValue(schema.items, value[index], location + '[' + index + ']', issues, warnings, depth + 1);
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (typeof schema.minimum === 'number' && value < schema.minimum) issues.push('Campo ' + location + ' deve ser maior ou igual a ' + schema.minimum + '.');
      if (typeof schema.maximum === 'number' && value > schema.maximum) issues.push('Campo ' + location + ' deve ser menor ou igual a ' + schema.maximum + '.');
      if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) issues.push('Campo ' + location + ' deve ser maior que ' + schema.exclusiveMinimum + '.');
      if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) issues.push('Campo ' + location + ' deve ser menor que ' + schema.exclusiveMaximum + '.');
      if (typeof schema.multipleOf === 'number' && schema.multipleOf > 0 && Math.abs(value / schema.multipleOf - Math.round(value / schema.multipleOf)) > 1e-9)
        issues.push('Campo ' + location + ' deve ser múltiplo de ' + schema.multipleOf + '.');
    }
    if (typeof value === 'string') {
      const length = Array.from(value).length;
      if (Number.isInteger(schema.minLength) && length < schema.minLength) issues.push('Campo ' + location + ' deve ter pelo menos ' + schema.minLength + ' caracteres.');
      if (Number.isInteger(schema.maxLength) && length > schema.maxLength) issues.push('Campo ' + location + ' deve ter no máximo ' + schema.maxLength + ' caracteres.');
    }
    if (Array.isArray(value)) {
      if (Number.isInteger(schema.minItems) && value.length < schema.minItems) issues.push('Campo ' + location + ' deve ter pelo menos ' + schema.minItems + ' itens.');
      if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) issues.push('Campo ' + location + ' deve ter no máximo ' + schema.maxItems + ' itens.');
      if (schema.uniqueItems === true) {
        const seen = new Set();
        for (const item of value.slice(0, 1000)) {
          const key = JSON.stringify(item);
          if (seen.has(key)) { issues.push('Campo ' + location + ' deve conter itens únicos.'); break; }
          seen.add(key);
        }
        if (value.length > 1000) warnings.push('A resposta excede o limite de itens validados.');
      }
    }
    if (isObject) {
      let count = 0;
      for (const name in value) if (Object.hasOwn(value, name) && ++count > 1000) break;
      if (count > 1000) warnings.push('A resposta excede o limite de propriedades validadas.');
      if (Number.isInteger(schema.minProperties) && count < schema.minProperties) issues.push('Campo ' + location + ' deve ter pelo menos ' + schema.minProperties + ' propriedades.');
      if (Number.isInteger(schema.maxProperties) && count > schema.maxProperties) issues.push('Campo ' + location + ' deve ter no máximo ' + schema.maxProperties + ' propriedades.');
    }
  }

  function validateOpenApiResponseContract(contract, response = {}, request = {}) {
    const issues = [], warnings = [];
    const safeContract = sanitizeOpenApiResponseContract(contract);
    if (!safeContract)
      return { status: 'partial', issues, warnings: ['Contrato de resposta indisponível.'] };
    warnings.push(...safeContract.partialReasons);
    const contractMethod = safeContract.method;
    const requestMethod = String(request?.method || '').toUpperCase();
    if (requestMethod && contractMethod && requestMethod !== contractMethod)
      return { status: 'partial', issues, warnings: ['Método da request atual não corresponde ao contrato importado.'] };
    if (request?.route && safeContract.pathTemplate && !openApiRouteMatchesTemplate(request.route, safeContract.pathTemplate, request.baseUrl))
      return { status: 'partial', issues, warnings: ['Rota da request atual não corresponde ao contrato importado.'] };
    const status = Number(response?.status);
    const responses = safeContract.responses;
    const selected = openApiStatusResponse(responses, status);
    if (!selected && !safeContract.partialReasons.includes(openApiResponseMapPartialMessage)) {
      issues.push('Status HTTP ' + (Number.isFinite(status) ? status : 0) + ' não declarado no contrato.');
    }
    const inspection = selected || Object.values(responses).find(item => item && typeof item === 'object' && item.content);
    const declaredTypes = inspection?.content && typeof inspection.content === 'object' && !Array.isArray(inspection.content) ? Object.keys(inspection.content) : [];
    if (declaredTypes.length) {
      const actualType = openApiResponseHeader(response?.headers, 'content-type');
      const mediaType = inspection.content && typeof inspection.content === 'object'
        ? declaredTypes.find(type => openApiMediaMatches(type, actualType)) || ''
        : '';
      if (!actualType || !mediaType) {
        issues.push('Tipo de mídia (Content-Type) da resposta não é compatível com o contrato.');
      } else {
        const media = inspection.content[mediaType];
        if (media && Object.hasOwn(media, 'schema')) {
          const jsonExpected = openApiJsonMediaType(mediaType) || openApiJsonMediaType(actualType);
          if (jsonExpected) {
            let body;
            try { body = JSON.parse(String(response?.body ?? '')); }
            catch {
              issues.push('A resposta não contém JSON válido para o contrato.');
              body = undefined;
            }
            if (body !== undefined) validateOpenApiSchemaValue(media.schema, body, 'body', issues, warnings);
          } else {
            warnings.push('A validação estrutural de conteúdo não JSON não é suportada.');
          }
        }
      }
    }
    if (issues.length) return { status: 'failed', issues, warnings };
    if (warnings.length) return { status: 'partial', issues, warnings };
    return { status: 'passed', issues, warnings };
  }

  function validateOpenApiRequestBodyContract(contract, request = {}) {
    const issues = [], warnings = [];
    const safeContract = sanitizeOpenApiResponseContract(contract);
    if (!safeContract)
      return { status: 'partial', issues, warnings: ['Contrato OpenAPI da request indisponível.'] };
    const requestBody = safeContract.requestBody;
    if (!requestBody) return { status: 'skipped', issues, warnings };
    warnings.push(...requestBody.partialReasons);
    const requestMethod = String(request?.method || '').toUpperCase();
    if (requestMethod && safeContract.method && requestMethod !== safeContract.method)
      return { status: 'partial', issues, warnings: [...warnings, 'Método da request atual não corresponde ao contrato importado.'] };
    if (request?.route && safeContract.pathTemplate && !openApiRouteMatchesTemplate(request.route, safeContract.pathTemplate, request.baseUrl))
      return { status: 'partial', issues, warnings: [...warnings, 'Rota da request atual não corresponde ao contrato importado.'] };

    const body = String(request?.body ?? '');
    if (!body.trim()) {
      if (requestBody.required) issues.push('O body da request é obrigatório.');
      if (issues.length) return { status: 'failed', issues, warnings };
      return { status: warnings.length ? 'partial' : 'passed', issues, warnings };
    }
    if (/\{\{\s*[^{}]+?\s*\}\}/.test(body))
      return { status: 'partial', issues, warnings: [...warnings, 'Variáveis não resolvidas no body impedem validar o schema com segurança.'] };

    const content = requestBody.content && typeof requestBody.content === 'object' && !Array.isArray(requestBody.content) ? requestBody.content : {};
    const declaredTypes = Object.keys(content);
    if (!declaredTypes.length && requestBody.partialReasons.includes(openApiRequestBodyMapPartialMessage))
      return { status: 'partial', issues, warnings };
    const actualType = openApiRequestHeader(request.headers, 'content-type');
    const mediaType = declaredTypes.find(type => openApiMediaMatches(type, actualType)) || '';
    if (!actualType || !mediaType) {
      if (requestBody.partialReasons.includes(openApiRequestBodyMapPartialMessage))
        return { status: 'partial', issues, warnings };
      issues.push('Content-Type da request não corresponde ao contrato importado.');
    } else if (!openApiJsonMediaType(mediaType) || !openApiJsonMediaType(actualType) || request.bodyMode === 'multipart' || request.bodyMode === 'urlencoded' || request.bodyMode === 'xml' || request.bodyMode === 'text') {
      warnings.push('A validação estrutural de body não JSON não é suportada.');
    } else {
      let value;
      try { value = JSON.parse(body); }
      catch {
        issues.push('O body da request não contém JSON válido para o contrato.');
        value = undefined;
      }
      if (value !== undefined && Object.hasOwn(content[mediaType] || {}, 'schema'))
        validateOpenApiSchemaValue(content[mediaType].schema, value, 'body', issues, warnings);
    }
    if (issues.length) return { status: 'failed', issues, warnings };
    if (warnings.length) return { status: 'partial', issues, warnings };
    return { status: 'passed', issues, warnings };
  }

  function parseOpenApiSpec(document) {
    if (!document || typeof document !== 'object' || Array.isArray(document)) throw Error('Documento OpenAPI invalido.');
    const version = String(document.openapi || '');
    if (!/^3\.(?:0|1|2)\.\d+$/.test(version)) throw Error('Versoes OpenAPI suportadas: 3.0, 3.1 e 3.2 em JSON.');
    if (!document.paths || typeof document.paths !== 'object' || Array.isArray(document.paths)) throw Error('O documento OpenAPI precisa conter um objeto paths.');
    const title = String(document.info?.title || 'OpenAPI').trim().slice(0, 100);
    const warnings = new Set(), environmentVariables = Object.create(null);
    const warn = message => warnings.add(message);
    const isSensitive = name => /authorization|bearer|token|secret|password|passwd|senha|credential|cookie|apikey|privatekey/i.test(String(name || '').toLowerCase().replace(/[_ -]/g, ''));
    const has = (object, key) => !!object && Object.hasOwn(object, key);
    const scalar = value => typeof value === 'string' ? value : value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    const sample = source => {
      if (!source || typeof source !== 'object') return { found: false };
      if (has(source, 'example')) return { found: true, value: source.example };
      if (source.examples && typeof source.examples === 'object') {
        for (const example of Object.values(source.examples)) if (example && has(example, 'value')) return { found: true, value: example.value };
      }
      const schema = source.schema;
      if (schema && typeof schema === 'object') {
        if (has(schema, 'example')) return { found: true, value: schema.example };
        if (has(schema, 'default')) return { found: true, value: schema.default };
        if (Array.isArray(schema.enum) && schema.enum.length) return { found: true, value: schema.enum[0] };
        if (schema.type === 'object') return { found: true, value: {} };
        if (schema.type === 'array') return { found: true, value: [] };
      }
      return { found: false };
    };
    const makeServer = server => {
      if (!server || typeof server.url !== 'string' || !server.url.trim()) return { baseUrl: '{{baseUrl}}', prefix: '' };
      const source = server.url.trim();
      const resolved = source.replace(/\{([^{}]+)\}/g, (whole, name) => {
        const variable = server.variables?.[name];
        if (isSensitive(name)) { warn('Server variables sensiveis nao foram importadas; configure-as manualmente.'); return '{{' + name + '}}'; }
        if (variable && has(variable, 'default')) {
          if (!['__proto__', 'prototype', 'constructor'].includes(name)) {
            if (has(environmentVariables, name) && environmentVariables[name] !== String(variable.default)) warn('Valores diferentes para a mesma variavel de servidor; foi mantido o primeiro.');
            else Object.defineProperty(environmentVariables, name, { value: String(variable.default), enumerable: true, writable: true, configurable: true });
          }
        } else warn('Variavel de servidor sem valor padrao foi mantida como template.');
        return '{{' + name + '}}';
      });
      if (/[?#]/.test(source)) throw Error('URL de servidor OpenAPI com query ou fragmento nao suportada.');
      if (/^\{\{[^{}]+\}\}\/?$/.test(resolved)) return { baseUrl: resolved.replace(/\/+$/, ''), prefix: '' };
      const validationUrl = resolved.replace(/\{\{\s*([^{}]+)\s*\}\}/g, 'vortix');
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(validationUrl)) {
        let parsed;
        try { parsed = new URL(validationUrl); } catch { throw Error('URL de servidor OpenAPI invalida.'); }
        if (!['http:', 'https:'].includes(parsed.protocol)) throw Error('Servidor OpenAPI deve usar HTTP ou HTTPS.');
        if (parsed.username || parsed.password) throw Error('Remova credenciais embutidas no servidor OpenAPI.');
        return { baseUrl: resolved.replace(/\/+$/, ''), prefix: '' };
      }
      return { baseUrl: '{{baseUrl}}', prefix: (resolved.startsWith('/') ? resolved : '/' + resolved).replace(/\/+$/, '') };
    };
    const globalServers = Array.isArray(document.servers) ? document.servers : [];
    if (globalServers.length > 1) warn('Mais de um servidor OpenAPI foi encontrado; foi selecionado o primeiro.');
    const defaultServer = globalServers[0] || null;
    const collection = { name: title, requests: [], folders: [] };
    const folders = new Map();
    const methods = ['get', 'head', 'post', 'put', 'patch', 'delete', 'options'];
    let operationCount = 0;
    if (Array.isArray(document.security) && document.security.length) warn('Requisitos de seguranca OpenAPI nao foram importados; configure Auth manualmente.');
    for (const [path, pathItem] of Object.entries(document.paths)) {
      if (!pathItem || typeof pathItem !== 'object' || Array.isArray(pathItem)) continue;
      if (pathItem.$ref) { warn('Path Items com $ref foram ignorados; referencias nao sao carregadas da rede.'); continue; }
      if (pathItem.trace) warn('Operacoes TRACE nao sao suportadas e foram ignoradas.');
      for (const method of methods) {
        const operation = pathItem[method];
        if (!operation || typeof operation !== 'object' || Array.isArray(operation)) continue;
        operationCount++;
        if (Array.isArray(operation.security) && operation.security.length) warn('Requisitos de seguranca OpenAPI nao foram importados; configure Auth manualmente.');
        const server = Array.isArray(operation.servers) && operation.servers.length ? operation.servers[0] : Array.isArray(pathItem.servers) && pathItem.servers.length ? pathItem.servers[0] : defaultServer;
        const serverInfo = makeServer(server);
        const parameters = new Map();
        for (const parameter of [...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []), ...(Array.isArray(operation.parameters) ? operation.parameters : [])]) {
          if (!parameter || typeof parameter !== 'object') continue;
          if (parameter.$ref) { warn('Parametros referenciados foram ignorados; use definicoes inline na especificacao.'); continue; }
          if (parameter.name && ['path', 'query', 'header', 'cookie'].includes(parameter.in)) parameters.set(parameter.in + ':' + parameter.name, parameter);
        }
        const pathParameters = new Map([...parameters].filter(([key]) => key.startsWith('path:')).map(([key, value]) => [key.slice(5), value]));
        let route = serverInfo.prefix + path;
        if (!route.startsWith('/')) route = '/' + route;
        route = route.replace(/\{([^{}]+)\}/g, (whole, name) => {
          const parameter = pathParameters.get(name);
          if (isSensitive(name)) { warn('Parametros de caminho sensiveis foram deixados como template.'); return '{{' + name + '}}'; }
          const value = parameter ? sample(parameter) : { found: false };
          if (!parameter) warn('Parametro de caminho sem definicao inline foi deixado como template.');
          return value.found ? encodeURIComponent(scalar(value.value)) : '{{' + name + '}}';
        });
        const query = [], headerMap = new Map();
        const addHeader = (name, value) => headerMap.set(String(name).toLowerCase(), [String(name), scalar(value)]);
        for (const parameter of parameters.values()) {
          if (parameter.in === 'path') continue;
          if (parameter.in === 'cookie') { warn('Parametros de cookie OpenAPI nao foram importados; use o gerenciador de cookies quando disponivel.'); continue; }
          if (isSensitive(parameter.name)) { warn('Parametros sensiveis OpenAPI foram ignorados; configure Auth manualmente.'); continue; }
          const value = sample(parameter);
          if (parameter.in === 'query') query.push(encodeURIComponent(parameter.name) + '=' + encodeURIComponent(value.found ? scalar(value.value) : ''));
          else if (parameter.in === 'header') addHeader(parameter.name, value.found ? value.value : '');
        }
        if (query.length) route += (route.includes('?') ? '&' : '?') + query.join('&');
        const accept = [];
        for (const response of Object.values(operation.responses || {})) {
          const types = response && response.content && typeof response.content === 'object' ? Object.keys(response.content) : [];
          if (types.length) { accept.push(...types); break; }
        }
        if (accept.length && !headerMap.has('accept')) addHeader('Accept', [...new Set(accept)].join(', '));
        let body = '';
        let requestBody = operation.requestBody;
        if (requestBody?.$ref) {
          const seen = new Set();
          for (let depth = 0; requestBody?.$ref && depth < openApiSchemaDepthLimit; depth++) {
            const ref = String(requestBody.$ref);
            if (!openApiPointerParts(ref) || seen.has(ref)) { requestBody = null; break; }
            seen.add(ref);
            const resolved = resolveOpenApiLocalPointer(document, ref);
            if (!resolved.found) { requestBody = null; break; }
            requestBody = resolved.value;
          }
          if (requestBody?.$ref) requestBody = null;
          if (!requestBody) warn('Request Body referenciado não pôde ser resolvido localmente; body inicial vazio.');
        }
        if (requestBody?.content && typeof requestBody.content === 'object') {
          const content = requestBody.content, mediaTypes = Object.keys(content);
          const mediaType = mediaTypes.find(type => /^application\/(?:json|[^;]+\+json)$/i.test(type));
          if (!mediaType && mediaTypes.length) warn('Body nao JSON da OpenAPI nao foi importado.');
          if (mediaType) {
            const media = content[mediaType], value = sample(media);
            if (value.found) body = JSON.stringify(value.value, null, 2);
            else if (media.schema?.type === 'object') body = '{}';
            else if (media.schema?.type === 'array') body = '[]';
            else if (media.schema?.$ref) {
              const resolvedSchema = resolveOpenApiLocalPointer(document, String(media.schema.$ref));
              if (resolvedSchema.found && resolvedSchema.value?.type === 'object') body = '{}';
              else if (resolvedSchema.found && resolvedSchema.value?.type === 'array') body = '[]';
              else warn('Schema JSON referenciado não pôde gerar um body inicial; confira o contrato importado.');
            }
            addHeader('Content-Type', mediaType);
          }
        }
        const headers = [...headerMap.values()].map(([name, value]) => name + ': ' + value).join('\n');
        const folderName = Array.isArray(operation.tags) ? operation.tags.find(tag => typeof tag === 'string' && tag.trim()) : '';
        let target = collection;
        if (folderName) {
          const tagName = folderName.trim().slice(0, 100);
          if (!folders.has(tagName)) { const folder = { name: tagName, requests: [], folders: [] }; folders.set(tagName, folder); collection.folders.push(folder); }
          target = folders.get(tagName);
        }
        target.requests.push({
          name: String(operation.summary || operation.operationId || method.toUpperCase() + ' ' + path).slice(0, 100),
          method: method.toUpperCase(), baseUrl: serverInfo.baseUrl, route, headers, body,
          responseContract: normalizeOpenApiResponseContract(document, operation, method.toUpperCase(), openApiContractPathTemplate(serverInfo, path, environmentVariables))
        });
      }
    }
    if (!operationCount) throw Error('A especificacao OpenAPI nao contem operacoes HTTP suportadas em paths.');
    const environment = Object.keys(environmentVariables).length ? { name: title + ' - Server', group: 'OpenAPI', variables: Object.fromEntries(Object.entries(environmentVariables)) } : null;
    return { collection, environment, warnings: [...warnings] };
  }

  function splitRoute(value) {
    const source = String(value ?? '');
    if (!source.trim()) return { route: '', params: [] };
    try {
      const url = new URL(source, 'http://localhost');
      const route = url.pathname.replace(/%7B%7B([^/?#]*?)%7D%7D/gi, (_, name) => {
        try { return '{{' + decodeURIComponent(name) + '}}'; }
        catch { return '{{' + name + '}}'; }
      });
      return { route, params: [...url.searchParams.entries()] };
    } catch { return { route: source, params: [] }; }
  }

  function remoteHttpOrigin(value) {
    try {
      const target = new URL(String(value ?? ''));
      const host = target.hostname.toLowerCase();
      const loopback = host === 'localhost' || host === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(host);
      return target.protocol === 'http:' && !loopback ? target.origin : '';
    } catch { return ''; }
  }

  function remoteHttpOrigins(cases, environment = {}, vaultSecrets = {}) {
    const origins = new Set();
    for (const item of cases || []) {
      const baseUrl = resolveTemplateWithProvenance(item?.request?.baseUrl || '', environment, item?.dataset || {}, vaultSecrets).text;
      const origin = remoteHttpOrigin(baseUrl);
      if (!origin) continue;
      if (item.request.allowInsecureHttp !== true) throw Error('HTTP remoto exige habilitação explícita na request.');
      origins.add(origin);
    }
    return [...origins];
  }

  function parseResponseBody(raw) {
    const text = String(raw ?? '');
    try {
      const value = JSON.parse(text);
      return { isJson: true, raw: text, pretty: JSON.stringify(value, null, 2), value };
    } catch {
      return { isJson: false, raw: text, pretty: text, value: null };
    }
  }

  function formatJsonPath(parts) {
    let path = '';
    for (const part of parts || []) {
      if (typeof part === 'number' && Number.isInteger(part) && part >= 0) {
        path += '[' + part + ']';
        continue;
      }
      const key = String(part);
      if (/^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(key)) path += (path ? '.' : '') + key;
      else path += '[' + JSON.stringify(key) + ']';
    }
    return path;
  }

  function findTextMatches(text, query) {
    const source = String(text ?? ''), term = String(query ?? '');
    if (!term) return [];
    const haystack = source.toLocaleLowerCase(), needle = term.toLocaleLowerCase();
    const matches = [];
    let from = 0, index;
    while ((index = haystack.indexOf(needle, from)) !== -1) {
      matches.push({ start: index, end: index + term.length });
      from = index + Math.max(needle.length, 1);
    }
    return matches;
  }

  function parseJsonPath(path) {
    let source = String(path || '').trim();
    if (source.startsWith('$')) source = source.slice(1);
    if (!source) return [];
    const parts = [];
    while (source) {
      if (source[0] === '.') {
        source = source.slice(1);
        const match = source.match(/^[A-Za-z_$][A-Za-z0-9_$-]*/);
        if (!match) throw Error('Caminho JSON inválido. Use, por exemplo, data.id ou items[0].id.');
        parts.push(match[0]);
        source = source.slice(match[0].length);
        continue;
      }
      if (source[0] === '[') {
        const match = source.match(/^\[(\d+|"(?:\\.|[^"])*"|'(?:\\.|[^'])*')\]/);
        if (!match) throw Error('Índice JSON inválido. Use, por exemplo, items[0].id.');
        const raw = match[1];
        parts.push(/^\d+$/.test(raw) ? Number(raw) : raw[0] === '"' ? JSON.parse(raw) : raw.slice(1, -1).replace(/\\'/g, "'"));
        source = source.slice(match[0].length);
        continue;
      }
      const match = source.match(/^[A-Za-z_$][A-Za-z0-9_$-]*/);
      if (!match) throw Error('Caminho JSON inválido. Use, por exemplo, data.id ou items[0].id.');
      parts.push(match[0]);
      source = source.slice(match[0].length);
    }
    return parts;
  }

  function jsonPathValue(value, path) {
    for (const part of parseJsonPath(path)) {
      if (value === null || value === undefined || !Object.hasOwn(Object(value), part)) throw Error('Campo JSON não encontrado: ' + path);
      value = value[part];
    }
    return value;
  }

  const defaultHistoryLimit = 500;
  const maxHistoryResponseBody = 850000;

  function normalizeHistorySettings(source = {}) {
    const requestedLimit = Number(source?.limit);
    const limit = Number.isInteger(requestedLimit) && requestedLimit >= 1 && requestedLimit <= 5000 ? requestedLimit : defaultHistoryLimit;
    return { limit, saveResponseBody: source?.saveResponseBody === true };
  }

  function normalizeHistoryResponseHeaders(source) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
    const headers = {};
    for (const [name, rawValues] of Object.entries(source)) {
      const key = String(name || '').trim();
      if (!key || /auth|cookie|token|secret|password|passwd|credential|api[-_.]?key|private[-_.]?key/i.test(key)) continue;
      const values = (Array.isArray(rawValues) ? rawValues : [rawValues]).map(value => String(value ?? ''));
      if (values.length) Object.defineProperty(headers, key, { value: values, enumerable: true, writable: true, configurable: true });
    }
    return headers;
  }

  function createResponseHistorySnapshot(result, durationMs, settings = {}, vaultSecrets = {}) {
    const preferences = normalizeHistorySettings(settings);
    const status = Number(result?.status);
    const rawBody = redactSecretValues(String(result?.body ?? ''), vaultSecrets);
    const bodyRequested = preferences.saveResponseBody && settings?.tokenRequest !== true;
    const bodySaved = bodyRequested && rawBody.length <= maxHistoryResponseBody;
    const duration = Number(durationMs);
    const headers = normalizeHistoryResponseHeaders(result?.headers);
    for (const [name, values] of Object.entries(headers)) {
      Object.defineProperty(headers, name, { value: values.map(value => redactSecretValues(value, vaultSecrets)), enumerable: true, writable: true, configurable: true });
    }
    return {
      status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
      reason: redactSecretValues(String(result?.reason || ''), vaultSecrets).slice(0, 256),
      durationMs: Number.isFinite(duration) ? Math.max(0, Math.round(duration)) : 0,
      headers,
      bodySaved,
      ...(bodyRequested && !bodySaved ? { bodyOmitted: 'size-limit' } : {}),
      ...(bodySaved ? { body: rawBody } : {})
    };
  }

  function compareHistoryResponses(leftEntry, rightEntry) {
    const normalize = entry => {
      const response = entry?.response;
      if (!response || typeof response !== 'object') throw Error('Cada registro precisa conter uma resposta salva.');
      const tokenRequest = entry.tokenRequest === true;
      const bodySaved = !tokenRequest && response.bodySaved === true && typeof response.body === 'string';
      const status = Number(response.status);
      return {
        id: String(entry.id || ''),
        method: String(entry.method || 'GET').toUpperCase(),
        route: String(entry.route || ''),
        savedAt: String(entry.savedAt || ''),
        tokenRequest,
        status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
        reason: String(response.reason || ''),
        durationMs: Number.isFinite(Number(response.durationMs)) ? Math.max(0, Math.round(Number(response.durationMs))) : 0,
        headers: normalizeHistoryResponseHeaders(response.headers),
        bodySaved,
        body: bodySaved ? String(response.body) : ''
      };
    };
    const left = normalize(leftEntry), right = normalize(rightEntry);
    const leftNames = new Map(Object.keys(left.headers).map(name => [name.toLowerCase(), name]));
    const rightNames = new Map(Object.keys(right.headers).map(name => [name.toLowerCase(), name]));
    const headerNames = [...new Set([...leftNames.keys(), ...rightNames.keys()])].sort();
    const values = (headers, names, key) => headers[names.get(key)] || [];
    const sameValues = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
    const headerChanges = headerNames.flatMap(key => {
      const a = values(left.headers, leftNames, key), b = values(right.headers, rightNames, key);
      return sameValues(a, b) ? [] : [{ name: leftNames.get(key) || rightNames.get(key), left: [...a], right: [...b] }];
    });
    const bodyComparable = left.bodySaved && right.bodySaved;
    return {
      left,
      right,
      statusChanged: left.status !== right.status,
      durationDeltaMs: right.durationMs - left.durationMs,
      headerChanges,
      bodyComparable,
      bodyChanged: bodyComparable ? left.body !== right.body : null
    };
  }

  function retainNewestHistoryEntries(entries, limit) {
    const maximum = normalizeHistorySettings({ limit }).limit;
    return (Array.isArray(entries) ? entries : [])
      .map((entry, index) => ({ entry, index, timestamp: Date.parse(entry?.savedAt || '') }))
      .sort((left, right) => (Number.isFinite(right.timestamp) ? right.timestamp : -Infinity) - (Number.isFinite(left.timestamp) ? left.timestamp : -Infinity) || left.index - right.index)
      .slice(0, maximum)
      .map(item => item.entry);
  }

  const runnerHistoryLimit = 30;
  const runnerHistoryStorageLimitBytes = 750_000;
  const runnerHistoryMaxRequests = 500;
  const runnerHistoryMaxTestsPerRequest = 20;
  const runnerHistoryMaxDurationMs = 86_400_000;
  const runnerHistoryOutcomes = new Set(['passed', 'failed', 'partial', 'skipped']);

  function runnerHistoryCount(value, maximum = runnerHistoryMaxRequests) {
    if (typeof value === 'boolean') return 0;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.min(maximum, Math.floor(number)) : 0;
  }

  function runnerHistoryDuration(value) {
    if (typeof value === 'boolean') return 0;
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(runnerHistoryMaxDurationMs, Math.max(0, Math.round(number))) : 0;
  }

  function runnerHistoryId(value) {
    const id = String(value ?? '').trim();
    if (/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id) || /^run-[a-z0-9]{4,16}-[a-z0-9]{8,16}$/i.test(id)) return id.toLowerCase();
    return globalThis.crypto?.randomUUID?.() || `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function runnerHistoryDate(value) {
    const timestamp = Date.parse(String(value ?? ''));
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
  }

  function runnerHistoryStatus(value) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 100 && number <= 599 ? number : null;
  }

  function createRunnerHistorySnapshot(run) {
    if (!run || typeof run !== 'object' || Array.isArray(run))
      throw Error('Execução do Runner inválida para o histórico.');
    const id = runnerHistoryId(run.id);
    const startedAt = runnerHistoryDate(run.startedAt);
    const sourceSteps = Array.isArray(run.steps) ? run.steps.slice(0, runnerHistoryMaxRequests) : [];
    const steps = sourceSteps.map((source, index) => {
      const step = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
      const outcome = runnerHistoryOutcomes.has(step.outcome) ? step.outcome : 'skipped';
      const tests = step.tests && typeof step.tests === 'object' && !Array.isArray(step.tests) ? step.tests : {};
      const testsPartial = runnerHistoryCount(tests.partial ?? step.testsPartial, runnerHistoryMaxTestsPerRequest);
      return {
        ordinal: index + 1,
        outcome,
        status: runnerHistoryStatus(step.status),
        durationMs: runnerHistoryDuration(step.durationMs),
        testsPassed: runnerHistoryCount(tests.passed ?? step.testsPassed, runnerHistoryMaxTestsPerRequest),
        testsFailed: runnerHistoryCount(tests.failed ?? step.testsFailed, runnerHistoryMaxTestsPerRequest),
        ...(testsPartial ? { testsPartial } : {})
      };
    });
    const partial = runnerHistoryCount(run.partial);
    return {
      id,
      startedAt,
      durationMs: runnerHistoryDuration(run.durationMs),
      total: runnerHistoryCount(run.total),
      passed: runnerHistoryCount(run.passed),
      failed: runnerHistoryCount(run.failed),
      ...(partial ? { partial } : {}),
      skipped: runnerHistoryCount(run.skipped),
      stopped: run.stopped === true,
      steps
    };
  }

  function retainNewestRunnerHistoryEntries(entries, limit) {
    const requested = Number(limit);
    const maximum = Number.isFinite(requested) && requested >= 0 ? Math.min(runnerHistoryLimit, Math.floor(requested)) : runnerHistoryLimit;
    if (!maximum) return [];
    const ordered = (Array.isArray(entries) ? entries : [])
      .map((entry, index) => ({ entry, index, timestamp: Date.parse(entry?.startedAt || '') }))
      .sort((left, right) => {
        const leftValid = Number.isFinite(left.timestamp), rightValid = Number.isFinite(right.timestamp);
        if (leftValid && rightValid && left.timestamp !== right.timestamp) return right.timestamp - left.timestamp;
        if (leftValid !== rightValid) return leftValid ? -1 : 1;
        return left.index - right.index;
      });
    const retained = [];
    let serializedBytes = 2;
    for (const item of ordered) {
      let serialized;
      try { serialized = JSON.stringify(item.entry); }
      catch { continue; }
      if (typeof serialized !== 'string') continue;
      const nextBytes = serializedBytes + (retained.length ? 1 : 0) + serialized.length;
      if (nextBytes > runnerHistoryStorageLimitBytes) break;
      retained.push(item.entry);
      serializedBytes = nextBytes;
      if (retained.length >= maximum) break;
    }
    return retained;
  }

  function runnerHistoryAnnouncement(count, warning = '') {
    const message = typeof warning === 'string' ? warning.trim() : '';
    if (message) return message;
    const safeCount = Number.isSafeInteger(count) ? Math.min(runnerHistoryLimit, Math.max(0, count)) : 0;
    if (safeCount === 0) return 'Nenhuma execução salva.';
    return safeCount === 1 ? '1 execução salva.' : `${safeCount} execuções salvas.`;
  }

  function runnerHistoryCompatibilityWarning(supportsWebLocks) {
    return supportsWebLocks ? '' : 'Este navegador não suporta bloqueio entre abas; edite o histórico em uma aba por vez.';
  }

  function sanitizeRunnerHistoryValue(value) {
    if (!Array.isArray(value)) return [];
    const result = [];
    for (const entry of value) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      try { result.push(createRunnerHistorySnapshot(entry)); }
      catch { }
    }
    return retainNewestRunnerHistoryEntries(result, runnerHistoryLimit);
  }

  function sanitizeWorkspaceBackupSettings(settings) {
    const records = Array.isArray(settings) ? settings : [];
    return records.map(record => {
      if (!record || typeof record !== 'object' || Array.isArray(record) || record.key !== 'runnerHistory') return record;
      return { key: 'runnerHistory', value: sanitizeRunnerHistoryValue(record.value) };
    });
  }

  function sanitizePreRequestActionRecord(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return record;
    let safe = record;
    if (Object.hasOwn(record, 'responseContract')) {
      const responseContract = sanitizeOpenApiResponseContract(record.responseContract);
      safe = { ...record };
      if (responseContract) safe.responseContract = responseContract;
      else delete safe.responseContract;
    }
    if (!Object.hasOwn(record, 'preRequestActions')) return safe;
    let persisted;
    try { persisted = persistablePreRequestActions(record.preRequestActions, record.preRequestActionsLiteralConsent === true); }
    catch { persisted = { actions: [], redacted: true }; }
    return {
      ...safe,
      preRequestActions: persisted.actions,
      preRequestActionsEnabled: record.preRequestActionsEnabled !== false && persisted.actions.length > 0,
      preRequestActionsLiteralConsent: record.preRequestActionsLiteralConsent === true,
      ...(persisted.redacted ? { redacted: true } : {})
    };
  }

  function sanitizePreRequestCollection(collection, depth = 0) {
    if (depth > 20) throw Error('A coleção ultrapassa 20 níveis de pastas.');
    if (!collection || typeof collection !== 'object' || Array.isArray(collection)) return collection;
    return {
      ...collection,
      ...(Array.isArray(collection.requests) ? { requests: collection.requests.map(sanitizePreRequestActionRecord) } : {}),
      ...(Array.isArray(collection.folders) ? { folders: collection.folders.map(folder => sanitizePreRequestCollection(folder, depth + 1)) } : {})
    };
  }

  function sanitizeWorkspaceBackupPreRequestActions(data) {
    const settings = sanitizeWorkspaceBackupSettings(data.settings).map(record => {
      if (!record || record.key !== 'workspaceTabs' || !record.value || typeof record.value !== 'object' || Array.isArray(record.value)) return record;
      return {
        ...record,
        value: {
          ...record.value,
          ...(Array.isArray(record.value.tabs) ? { tabs: record.value.tabs.map(tab => tab && typeof tab === 'object' && !Array.isArray(tab) ? { ...tab, request: sanitizePreRequestActionRecord(tab.request) } : tab) } : {})
        }
      };
    });
    return {
      ...data,
      collections: data.collections.map(sanitizePreRequestCollection),
      history: data.history.map(sanitizePreRequestActionRecord),
      settings
    };
  }

  function normalizeResponseExamples(responseExamples) {
    if (responseExamples == null) return [];
    if (!Array.isArray(responseExamples) || responseExamples.length > 20)
      throw Error('Cada request aceita até 20 exemplos de resposta.');
    const ids = new Set();
    return responseExamples.map((source, index) => {
      const label = 'O exemplo ' + (index + 1);
      if (!source || typeof source !== 'object' || Array.isArray(source))
        throw Error(label + ' está inválido.');
      const id = String(source.id || '').trim();
      const name = String(source.name || '').trim();
      const status = Number(source.status);
      const body = String(source.body ?? '');
      const savedAt = String(source.savedAt || '').trim().slice(0, 64);
      if (!id || id.length > 128 || ids.has(id)) throw Error('O ID de ' + label.toLowerCase() + ' é inválido ou repetido.');
      if (!name || name.length > 100) throw Error('O nome de ' + label.toLowerCase() + ' precisa ter de 1 a 100 caracteres.');
      if (!Number.isInteger(status) || status < 100 || status > 599)
        throw Error(label + ' precisa ter um status HTTP entre 100 e 599.');
      if (body.length > 1_000_000) throw Error('O body de ' + label.toLowerCase() + ' ultrapassa 1.000.000 caracteres.');
      const sourceHeaders = source.headers == null ? {} : source.headers;
      if (!sourceHeaders || typeof sourceHeaders !== 'object' || Array.isArray(sourceHeaders))
        throw Error('Os headers de ' + label.toLowerCase() + ' estão inválidos.');
      const entries = Object.entries(sourceHeaders);
      if (entries.length > 100) throw Error(label + ' ultrapassa 100 headers.');
      const headers = {};
      let totalHeaderLength = 0;
      for (const [rawName, rawValues] of entries) {
        const headerName = String(rawName).trim();
        if (!/^[!#$%&'*+.^_|~0-9A-Za-z-]{1,256}$/.test(headerName))
          throw Error('O nome de header de ' + label.toLowerCase() + ' está inválido.');
        if (/authorization|cookie|token|secret|password|api[-_]?key/i.test(headerName)) continue;
        const values = Array.isArray(rawValues) ? rawValues : [rawValues];
        if (values.length > 100) throw Error('O header ' + headerName + ' de ' + label.toLowerCase() + ' tem valores demais.');
        const normalizedValues = values.map(value => {
          const text = String(value ?? '');
          if (text.length > 4096 || /[\r\n]/.test(text)) throw Error('O header ' + headerName + ' de ' + label.toLowerCase() + ' está inválido.');
          totalHeaderLength += headerName.length + text.length;
          if (totalHeaderLength > 32_000) throw Error('Os headers de ' + label.toLowerCase() + ' ultrapassam 32.000 caracteres.');
          return text;
        });
        Object.defineProperty(headers, headerName, { value: normalizedValues, enumerable: true, writable: true, configurable: true });
      }
      ids.add(id);
      return { id, name, status, headers, body, savedAt };
    });
  }

  function addResponseExample(responseExamples, example) {
    const current = normalizeResponseExamples(responseExamples);
    if (current.length >= 20) throw Error('Cada request aceita até 20 exemplos de resposta.');
    const added = normalizeResponseExamples([example])[0];
    if (current.some(item => item.id === added.id)) throw Error('Este exemplo já existe.');
    return [...current, added];
  }
  function appendResponseExampleToRequest(request, example) {
    if (!request || typeof request !== 'object' || Array.isArray(request))
      throw Error('A request salva está inválida.');
    return { ...request, responseExamples: addResponseExample(request.responseExamples, example) };
  }
  function responseHeadersFromImport(source, format) {
    const raw = format === 'postman' ? source.header : source.headers;
    const headers = {};
    const append = (name, value) => {
      const key = String(name || '').trim();
      if (!key) return;
      const values = headers[key] || [];
      Object.defineProperty(headers, key, { value: [...values, String(value ?? '')], enumerable: true, writable: true, configurable: true });
    };
    if (Array.isArray(raw)) {
      for (const header of raw) {
        if (typeof header === 'string') {
          const separator = header.indexOf(':');
          if (separator > 0) append(header.slice(0, separator), header.slice(separator + 1).trim());
        } else if (header && typeof header === 'object') {
          const name = header.key ?? header.name;
          const values = Array.isArray(header.value) ? header.value : [header.value];
          for (const value of values) append(name, value);
        }
      }
    } else if (typeof raw === 'string') {
      for (const line of raw.split(/\r?\n/)) {
        const separator = line.indexOf(':');
        if (separator > 0) append(line.slice(0, separator), line.slice(separator + 1).trim());
      }
    } else if (raw && typeof raw === 'object') {
      for (const [name, rawValues] of Object.entries(raw)) {
        for (const value of Array.isArray(rawValues) ? rawValues : [rawValues]) append(name, value);
      }
    }
    return headers;
  }

  function importResponseExamples(sources, format, createId, savedAt) {
    if (sources == null) return [];
    if (!Array.isArray(sources) || sources.length > 20) throw Error('Cada request aceita até 20 exemplos de resposta.');
    if (!['postman', 'insomnia'].includes(format)) throw Error('Formato de exemplos de resposta inválido.');
    if (typeof createId !== 'function') throw Error('É necessário criar um ID para cada exemplo importado.');
    return normalizeResponseExamples(sources.map((source, index) => {
      if (!source || typeof source !== 'object' || Array.isArray(source)) throw Error('O exemplo importado ' + (index + 1) + ' está inválido.');
      const candidate = format === 'postman' ? source.code ?? source.status : source.statusCode ?? source.code ?? source.status;
      let status = Number(candidate);
      if (!Number.isInteger(status)) {
        const match = String(source.status ?? source.statusMessage ?? '').match(/(?:^|\D)([1-5]\d\d)(?:\D|$)/);
        status = match ? Number(match[1]) : status;
      }
      const rawBody = source.body;
      const body = typeof rawBody === 'string' ? rawBody : rawBody == null ? '' : JSON.stringify(rawBody);
      return {
        id: String(createId()),
        name: String(source.name || 'HTTP ' + status).trim(),
        status,
        headers: responseHeadersFromImport(source, format),
        body: body ?? '',
        savedAt: String(savedAt || '')
      };
    }));
  }

  function buildPostmanResponseExamples(responseExamples) {
    return normalizeResponseExamples(responseExamples).map(example => ({
      name: example.name,
      status: String(example.status),
      code: example.status,
      header: Object.entries(example.headers).flatMap(([key, values]) => values.map(value => ({ key, value, type: 'text' }))),
      body: example.body
    }));
  }

  function responseExampleToInsomniaResource(source, resourceId, requestId, url, timestamp = Date.now()) {
    const example = normalizeResponseExamples([source])[0];
    const headers = Object.entries(example.headers).flatMap(([name, values]) => values.map(value => ({ name, value })));
    const contentType = Object.entries(example.headers).find(([name]) => name.toLowerCase() === 'content-type')?.[1]?.[0] || 'text/plain';
    const created = Number.isFinite(Number(timestamp)) ? Number(timestamp) : Date.now();
    return {
      _id: String(resourceId),
      _type: 'response',
      parentId: String(requestId),
      name: example.name,
      statusCode: example.status,
      url: String(url || ''),
      headers,
      body: example.body,
      mimeType: contentType,
      created,
      modified: created
    };
  }
  function responseExampleRequestMatches(current, saved) {
    if (!current || !saved || typeof current !== 'object' || typeof saved !== 'object') return false;
    if (String(current.method || '').toUpperCase() !== String(saved.method || '').toUpperCase()) return false;
    const currentRoute = splitRoute(current.route);
    const savedRoute = splitRoute(saved.route);
    if (currentRoute.route !== savedRoute.route) return false;
    const sortPairs = pairs => pairs.map(([name, value]) => [String(name), String(value)]).sort((left, right) => {
      if (left[0] !== right[0]) return left[0] < right[0] ? -1 : 1;
      if (left[1] !== right[1]) return left[1] < right[1] ? -1 : 1;
      return 0;
    });
    return JSON.stringify(sortPairs(currentRoute.params)) === JSON.stringify(sortPairs(savedRoute.params));
  }

  function buildResponseExampleMock(current, saved, exampleId) {
    if (!responseExampleRequestMatches(current, saved))
      throw Error('A resposta mock exige o mesmo método, path e query da request salva.');
    const example = normalizeResponseExamples(saved.responseExamples).find(item => item.id === String(exampleId));
    if (!example) throw Error('O exemplo de resposta não existe nesta request salva.');
    return { status: example.status, reason: 'Local mock', headers: example.headers, body: example.body };
  }
  function normalizeResponseTests(responseTests) {
    if (responseTests == null) return [];
    if (!Array.isArray(responseTests) || responseTests.length > 20) throw Error('Informe até 20 testes de resposta.');
    return responseTests.map((source, index) => {
      if (!source || typeof source !== 'object' || Array.isArray(source)) throw Error(`O teste ${index + 1} está inválido.`);
      const target = source.target === 'status' ? 'status' : source.target === 'json' ? 'json' : '';
      const operator = String(source.operator || '');
      const expected = String(source.expected ?? '');
      if (expected.length > 1000) throw Error(`O valor do teste ${index + 1} ultrapassa 1000 caracteres.`);
      if (target === 'status') {
        const status = Number(expected);
        if (operator !== 'equals' || !Number.isInteger(status) || status < 100 || status > 599) throw Error(`O teste ${index + 1} precisa comparar um status HTTP entre 100 e 599.`);
        return { id: String(source.id || ''), target, path: '', operator, expected: String(status) };
      }
      if (target !== 'json') throw Error(`O alvo do teste ${index + 1} é inválido.`);
      const path = String(source.path || '').trim();
      if (!path) throw Error(`Informe o caminho JSON do teste ${index + 1}.`);
      if (path.length > 1000) throw Error(`O caminho JSON do teste ${index + 1} ultrapassa 1000 caracteres.`);
      parseJsonPath(path);
      if (!['exists', 'equals', 'contains'].includes(operator)) throw Error(`O operador do teste ${index + 1} é inválido.`);
      if (operator === 'contains' && !expected.trim()) throw Error(`Informe o valor do teste ${index + 1}.`);
      return { id: String(source.id || ''), target, path, operator, expected: operator === 'exists' ? '' : expected };
    });
  }

  function responseTestLabel(rule) {
    if (rule.target === 'status') return `Status HTTP é ${rule.expected}`;
    if (rule.operator === 'exists') return `Campo ${rule.path} existe`;
    return `Campo ${rule.path} ${rule.operator === 'contains' ? 'contém o valor informado' : 'é igual ao valor informado'}`;
  }

  function comparableValue(value) {
    if (typeof value === 'string') return value;
    if (value === null) return 'null';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }

  function evaluateResponseTests(responseTests, response = {}) {
    const tests = normalizeResponseTests(responseTests);
    const needsJson = tests.some(rule => rule.target === 'json');
    let jsonBody, jsonError = '';
    if (needsJson) {
      try { jsonBody = JSON.parse(String(response.body ?? '')); }
      catch { jsonError = 'A resposta não contém JSON válido.'; }
    }
    const status = Number(response.status) || 0;
    return tests.map(rule => {
      const label = responseTestLabel(rule);
      if (rule.target === 'status') {
        const passed = status === Number(rule.expected);
        return { id: rule.id, label, passed, message: passed ? '' : `Esperado status HTTP ${rule.expected}; recebido ${status}.` };
      }
      if (jsonError) return { id: rule.id, label, passed: false, message: jsonError };
      let actual;
      try { actual = jsonPathValue(jsonBody, rule.path); }
      catch (error) { return { id: rule.id, label, passed: false, message: error.message }; }
      if (rule.operator === 'exists') return { id: rule.id, label, passed: true, message: '' };
      const passed = rule.operator === 'equals'
        ? comparableValue(actual) === rule.expected
        : typeof actual === 'string' ? actual.includes(rule.expected) : Array.isArray(actual) && actual.some(value => comparableValue(value) === rule.expected);
      return { id: rule.id, label, passed, message: passed ? '' : `O campo ${rule.path} não corresponde ao teste.` };
    });
  }

  function jsonPathExpression(path, root) {
    return parseJsonPath(path).reduce((expression, part) => `${expression}[${JSON.stringify(part)}]`, root);
  }

  function buildResponseTestScript(responseTests, runtime = 'insomnia') {
    const target = runtime === 'postman' ? 'postman' : 'insomnia';
    const tests = normalizeResponseTests(responseTests);
    if (!tests.length) return '';
    const testCall = target === 'postman' ? 'pm.test' : 'insomnia.test';
    const expectCall = target === 'postman' ? 'pm.expect' : 'insomnia.expect';
    const statusExpression = target === 'postman' ? 'pm.response.code' : 'insomnia.response.status';
    const bodyExpression = target === 'postman' ? 'pm.response.json()' : 'insomnia.response.json()';
    const lines = [];
    if (tests.some(rule => rule.target === 'json')) {
      lines.push(`let responseBody; let responseJsonError = false; try { responseBody = ${bodyExpression}; } catch { responseJsonError = true; }`);
      if (tests.some(rule => rule.target === 'json' && rule.operator !== 'exists')) {
        lines.push("const responseComparable = value => value === null ? 'null' : typeof value === 'object' ? JSON.stringify(value) : String(value);");
      }
    }
    for (const rule of tests) {
      lines.push(`${testCall}(${JSON.stringify(responseTestLabel(rule))}, function () {`);
      if (rule.target === 'status') {
        lines.push(`  ${expectCall}(${statusExpression}).to.eql(${Number(rule.expected)});`);
      } else {
        lines.push("  if (responseJsonError) throw new Error('A resposta não contém JSON válido.');");
        const expression = jsonPathExpression(rule.path, 'responseBody');
        if (rule.operator === 'exists') {
          lines.push(`  ${expectCall}(${expression} !== undefined).to.eql(true);`);
        } else if (rule.operator === 'equals') {
          lines.push(`  ${expectCall}(responseComparable(${expression})).to.eql(${JSON.stringify(rule.expected)});`);
        } else {
          lines.push(`  const actual = ${expression};`);
          lines.push(`  ${expectCall}(typeof actual === 'string' ? actual.includes(${JSON.stringify(rule.expected)}) : Array.isArray(actual) && actual.some(value => responseComparable(value) === ${JSON.stringify(rule.expected)})).to.eql(true);`);
        }
      }
      lines.push('});');
    }
    return lines.join('\n');
  }

  function prepareSavedRequest(saved, environment, dataset, allowWrites = false, authScopes = [], vaultSecrets = {}, preRequestOverrides = {}) {
    const method = String(saved?.method || 'GET').toUpperCase();
    const responseContract = sanitizeOpenApiResponseContract(saved?.responseContract);
    if (saved?.tokenRequest) {
      throw Error('Requests de credenciais manuais precisam ser enviadas pelo fluxo de token.');
    }
    if (!methods.has(method)) throw Error('Método não suportado na coleção: ' + method);
    if (writeMethods.has(method) && !allowWrites) throw Error('Confirme as chamadas de escrita antes de executar.');
    const provenance = {};
    const resolve = value => {
      const result = resolveTemplateWithProvenance(value, environment, dataset, vaultSecrets, preRequestOverrides);
      Object.assign(provenance, result.provenance);
      return result.text;
    };
    const bodyMode = normalizeBodyMode(saved?.bodyMode,true);
    const multipartFields = bodyMode === 'multipart' ? normalizeMultipartFields(saved?.multipartFields).map(field => ({ ...field, name: resolve(field.name), value: field.type === 'text' ? resolve(field.value) : '' })) : [];
    if (multipartFields.some(field => field.type === 'file')) throw Error('O Runner não carrega arquivos salvos. Abra a request e selecione os arquivos novamente.');
    if (bodyMode === 'graphql' && method !== 'POST') throw Error('GraphQL usa POST no Vortix.');
    const graphqlQuery = bodyMode === 'graphql' ? String(saved?.graphqlQuery || '') : '';
    const graphqlVariables = bodyMode === 'graphql' ? String(saved?.graphqlVariables || '') : '';
    const graphqlOperationName = bodyMode === 'graphql' ? String(saved?.graphqlOperationName || '') : '';
    const body = bodyMode === 'graphql' ? buildGraphqlBody(graphqlQuery, graphqlVariables, graphqlOperationName, resolve) : resolve(saved?.body || '');
    const effectiveAuth = resolveInheritedAuth(saved, authScopes), authType = effectiveAuth.authType;
    const basicUsername = authType === 'basic' ? resolve(effectiveAuth.basicUsername || '') : '';
    const basicPassword = authType === 'basic' ? resolve(effectiveAuth.basicPassword || '') : '';
    const apiKeyName = authType === 'apiKey' ? resolve(effectiveAuth.apiKeyName || '') : '';
    const apiKeyLocation = authType === 'apiKey' ? effectiveAuth.apiKeyLocation : 'header';
    const apiKeyValue = authType === 'apiKey' ? resolve(effectiveAuth.apiKeyValue || '') : '';
    if (authType === 'basic' && (!basicUsername || !basicPassword)) throw Error('Basic Auth requer usuario e senha.');
    if (authType === 'apiKey' && (!apiKeyName || !apiKeyValue)) throw Error('API Key requer nome e valor.');


    return {
      baseUrl: resolve(saved?.baseUrl || ''),
      route: resolve(saved?.route || ''),
      method,
      bodyMode,
      multipartFields,
      graphqlQuery,
      graphqlVariables,
      graphqlOperationName,
      authMode: effectiveAuth.authMode,
      authSource: effectiveAuth.authSource,
      authType,
      bearerToken: authType === 'bearer' ? resolve(effectiveAuth.bearerToken || '') : '',
      basicUsername,
      basicPassword,
      apiKeyName,
      apiKeyLocation,
      apiKeyValue,
      headers: resolve(saved?.headers || ''),
      body,
      allowInsecureHttp: saved?.allowInsecureHttp === true,
      confirmTestData: writeMethods.has(method) && allowWrites,
      testDataPhrase: writeMethods.has(method) && allowWrites ? 'TESTE' : '',
      confirmTokenRequest: false,
      tokenClientId: '',
      tokenClientSecret: '',
      captureResponseVariable: !!saved?.captureResponseVariable,
      responseVariableName: String(saved?.responseVariableName || 'token'),
      responseValueSource: saved?.responseValueSource === 'text' ? 'text' : 'json',
      responseJsonPath: String(saved?.responseJsonPath || 'access_token'),
      responseSuccessOnly: saved?.responseSuccessOnly !== false,
      responseCaptureTarget: saved?.responseCaptureTarget === 'vault' ? 'vault' : 'environment',
      responseTests: normalizeResponseTests(saved?.responseTests),
      ...(responseContract ? { responseContract } : {}),
      resolutionProvenance: provenance,
      saveBearerToken: false
    };
  }

  const workspaceBackupStores = ['history', 'collections', 'environments', 'settings'];
  const workspaceBackupLimits = { history: 25000, collections: 1000, environments: 1000, settings: 1000 };
  const maxWorkspaceBackupBytes = 15 * 1024 * 1024;
  const maxEncryptedWorkspaceBackupBytes = 22 * 1024 * 1024;
  const workspaceBackupPassphraseMinLength = 12;
  const workspaceBackupPbkdf2Iterations = 600000;
  const encryptedWorkspaceBackupFormat = 'api-studio-encrypted-workspace';

  function validateWorkspaceBackupData(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('Dados do backup inválidos.');
    const counts = {};
    for (const store of workspaceBackupStores) {
      const records = data[store];
      if (!Array.isArray(records)) throw Error('A lista ' + store + ' está ausente ou inválida.');
      if (records.length > workspaceBackupLimits[store]) throw Error('O backup excede o limite de registros em ' + store + '.');
      if ((store === 'collections' || store === 'environments') && records.length === 0) throw Error('O backup precisa conter ao menos uma coleção e um ambiente.');
      const keys = new Set();
      for (const record of records) {
        const key = record && typeof record === 'object' && !Array.isArray(record) ? record[store === 'settings' ? 'key' : 'id'] : null;
        if (typeof key !== 'string' || !key.trim() || key.length > 512) throw Error('Registro inválido em ' + store + '.');
        if (keys.has(key)) throw Error('Chave duplicada em ' + store + '.');
        keys.add(key);
      }
      counts[store] = records.length;
    }
    return counts;
  }

  function createWorkspaceBackup(data, exportedAt = new Date().toISOString()) {
    validateWorkspaceBackupData(data);
    const safeData = sanitizeWorkspaceBackupPreRequestActions(data);
    return {
      format: 'api-studio-workspace',
      version: 1,
      exportedAt: String(exportedAt),
      data: Object.fromEntries(workspaceBackupStores.map(store => [store, safeData[store]]))
    };
  }

  function parseWorkspaceBackup(text) {
    if (typeof text !== 'string' || text.length > maxWorkspaceBackupBytes) throw Error('Arquivo de backup excede 15 MB.');
    let backup;
    try { backup = JSON.parse(text); }
    catch { throw Error('Arquivo JSON inválido.'); }
    if (!backup || typeof backup !== 'object' || Array.isArray(backup) || backup.format !== 'api-studio-workspace') throw Error('Este arquivo não é um backup do Vortix.');
    if (backup.version !== 1) throw Error('Versão de backup não suportada.');
    const counts = validateWorkspaceBackupData(backup.data);
    const data = sanitizeWorkspaceBackupPreRequestActions(backup.data);
    return { data, counts, exportedAt: String(backup.exportedAt || '') };
  }

  async function readHostedCookieJars(fetcher = globalThis.fetch) {
    const response = await fetcher('/api/cookie-jar', { headers: { 'X-Api-Studio': '1' }, cache: 'no-store' });
    const payload = response.ok ? await response.json() : await response.json().catch(() => null);
    if (!response.ok) throw Error(payload?.error || 'Não foi possível ler os cookies deste navegador.');
    if (!Array.isArray(payload?.jars)) throw Error('Resposta inválida dos cookies deste navegador.');
    return payload.jars.filter(jar => jar && typeof jar.environmentId === 'string' && jar.value && Array.isArray(jar.value.cookies));
  }

  async function replaceHostedCookieJars(records, fetcher = globalThis.fetch) {
    const jars = (Array.isArray(records) ? records : [])
      .filter(record => typeof record?.key === 'string' && record.key.startsWith('cookiejar:'))
      .map(record => ({ environmentId: record.key.slice('cookiejar:'.length), value: record.value }));
    const response = await fetcher('/api/cookie-jar', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Api-Studio': '1' },
      cache: 'no-store',
      body: JSON.stringify({ jars })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw Error(payload?.error || 'Não foi possível restaurar os cookies deste navegador.');
    }
    return jars;
  }

  function isEncryptedWorkspaceBackup(text) {
    if (typeof text !== 'string' || text.length > maxEncryptedWorkspaceBackupBytes) return false;
    try { return JSON.parse(text)?.format === encryptedWorkspaceBackupFormat; }
    catch { return false; }
  }

  function bytesToBase64(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  }

  function base64ToBytes(value, label) {
    if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw Error('Arquivo de backup protegido inválido: ' + label + '.');
    let binary;
    try { binary = atob(value); }
    catch { throw Error('Arquivo de backup protegido inválido: ' + label + '.'); }
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  }

  function validateWorkspaceBackupPassphrase(passphrase) {
    if (typeof passphrase !== 'string' || Array.from(passphrase).length < workspaceBackupPassphraseMinLength) throw Error('A senha precisa ter pelo menos 12 caracteres.');
    if (passphrase.length > 256) throw Error('A senha pode ter no máximo 256 caracteres.');
  }

  async function deriveWorkspaceBackupKey(passphrase, salt, cryptoProvider) {
    const subtle = cryptoProvider?.subtle;
    if (!subtle || typeof cryptoProvider.getRandomValues !== 'function') throw Error('Criptografia segura indisponível neste navegador. Abra o Vortix pelo endereço local.');
    const encoder = new TextEncoder();
    const passwordKey = await subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: workspaceBackupPbkdf2Iterations },
      passwordKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function createWorkspaceBackupVault(passphrase, saltBase64, cryptoProvider = globalThis.crypto) {
    validateWorkspaceBackupPassphrase(passphrase);
    if (!cryptoProvider?.subtle || typeof cryptoProvider.getRandomValues !== 'function') throw Error('Criptografia segura indisponível neste navegador. Abra o Vortix pelo endereço local.');
    const salt = saltBase64 === undefined ? cryptoProvider.getRandomValues(new Uint8Array(16)) : base64ToBytes(saltBase64, 'salt');
    if (salt.length !== 16) throw Error('Arquivo de backup protegido inválido: salt.');
    const key = await deriveWorkspaceBackupKey(passphrase, salt, cryptoProvider);
    const encoder = new TextEncoder();
    const additionalData = encoder.encode(encryptedWorkspaceBackupFormat + ':1');

    return {
      salt: bytesToBase64(salt),
      async encrypt(backupText) {
        parseWorkspaceBackup(backupText);
        const plaintext = encoder.encode(backupText);
        if (plaintext.byteLength > maxWorkspaceBackupBytes) throw Error('Backup excede o limite de 15 MB.');
        const iv = cryptoProvider.getRandomValues(new Uint8Array(12));
        const ciphertext = await cryptoProvider.subtle.encrypt({ name: 'AES-GCM', iv, additionalData, tagLength: 128 }, key, plaintext);
        return {
          format: encryptedWorkspaceBackupFormat,
          version: 1,
          cipher: 'AES-GCM-256',
          kdf: 'PBKDF2-SHA-256',
          iterations: workspaceBackupPbkdf2Iterations,
          salt: bytesToBase64(salt),
          iv: bytesToBase64(iv),
          ciphertext: bytesToBase64(new Uint8Array(ciphertext))
        };
      },
      async decrypt(text) {
        if (typeof text !== 'string' || text.length > maxEncryptedWorkspaceBackupBytes) throw Error('Arquivo de backup protegido excede 22 MB.');
        let envelope;
        try { envelope = JSON.parse(text); }
        catch { throw Error('Arquivo de backup protegido inválido.'); }
        if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || envelope.format !== encryptedWorkspaceBackupFormat || envelope.version !== 1 || envelope.cipher !== 'AES-GCM-256' || envelope.kdf !== 'PBKDF2-SHA-256' || envelope.iterations !== workspaceBackupPbkdf2Iterations || envelope.salt !== bytesToBase64(salt)) throw Error('Formato de backup protegido não suportado.');
        const iv = base64ToBytes(envelope.iv, 'vetor de inicialização');
        const ciphertext = base64ToBytes(envelope.ciphertext, 'conteúdo');
        if (iv.length !== 12 || ciphertext.length < 16 || ciphertext.length > maxEncryptedWorkspaceBackupBytes) throw Error('Arquivo de backup protegido inválido.');
        let plaintext;
        try {
          const decrypted = await cryptoProvider.subtle.decrypt(
            { name: 'AES-GCM', iv, additionalData, tagLength: 128 },
            key,
            ciphertext
          );
          plaintext = new TextDecoder().decode(decrypted);
        } catch {
          throw Error('Senha incorreta ou arquivo danificado.');
        }
        try { return parseWorkspaceBackup(plaintext); }
        catch { throw Error('O conteúdo descriptografado não é um backup válido do Vortix.'); }
      }
    };
  }

  async function encryptWorkspaceBackup(backupText, passphrase, cryptoProvider = globalThis.crypto) {
    const vault = await createWorkspaceBackupVault(passphrase, undefined, cryptoProvider);
    return vault.encrypt(backupText);
  }

  async function decryptWorkspaceBackup(text, passphrase, cryptoProvider = globalThis.crypto) {
    validateWorkspaceBackupPassphrase(passphrase);
    if (typeof text !== 'string' || text.length > maxEncryptedWorkspaceBackupBytes) throw Error('Arquivo de backup protegido excede 22 MB.');
    let envelope;
    try { envelope = JSON.parse(text); }
    catch { throw Error('Arquivo de backup protegido inválido.'); }
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || envelope.format !== encryptedWorkspaceBackupFormat || envelope.version !== 1 || envelope.cipher !== 'AES-GCM-256' || envelope.kdf !== 'PBKDF2-SHA-256' || envelope.iterations !== workspaceBackupPbkdf2Iterations) throw Error('Formato de backup protegido não suportado.');
    const vault = await createWorkspaceBackupVault(passphrase, envelope.salt, cryptoProvider);
    return vault.decrypt(text);
  }

  const localSecretVaultFormat = 'api-studio-local-secret-vault';
  const localSecretVaultVersion = 1;
  const localSecretVaultMaxBytes = 1024 * 1024;
  const localSecretVaultMaxEnvelopeBytes = 2 * 1024 * 1024;
  const localSecretVaultNamePattern = /^[A-Za-z0-9_.-]{1,80}$/;

  function validateLocalSecretName(name) {
    const value = String(name ?? '').trim();
    if (!localSecretVaultNamePattern.test(value) || reservedNames.has(value)) throw Error('Informe um nome de segredo válido (até 80 caracteres).');
    return value;
  }

  function localSecretVaultAdditionalData() {
    return new TextEncoder().encode(localSecretVaultFormat + ':' + localSecretVaultVersion);
  }

  function normalizeLocalSecretVaultSalt(value, cryptoProvider) {
    if (value === undefined) return cryptoProvider.getRandomValues(new Uint8Array(16));
    let salt;
    if (typeof value === 'string') salt = base64ToBytes(value, 'salt');
    else if (value instanceof Uint8Array) salt = new Uint8Array(value);
    else if (value && typeof value === 'object' && typeof value.length === 'number') salt = Uint8Array.from(value);
    else throw Error('Envelope do cofre inválido: salt.');
    if (salt.length !== 16) throw Error('Envelope do cofre inválido: salt.');
    return salt;
  }

  function validateLocalSecretVaultEnvelope(envelope) {
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)
      || envelope.format !== localSecretVaultFormat || envelope.version !== localSecretVaultVersion
      || envelope.cipher !== 'AES-GCM-256' || envelope.kdf !== 'PBKDF2-SHA-256'
      || envelope.iterations !== workspaceBackupPbkdf2Iterations)
      throw Error('Envelope do cofre inválido.');
  }

  function makeLocalSecretVault({ salt, key, cryptoProvider, secrets, envelope }) {
    const state = { salt, key, secrets, envelope };
    const encoder = new TextEncoder();
    const additionalData = localSecretVaultAdditionalData();
    const requireUnlocked = () => {
      if (!state.key || !state.secrets) throw Error('O cofre de segredos está bloqueado.');
    };
    const serializeSecrets = () => {
      const values = Object.create(null);
      for (const [name, value] of state.secrets) Object.defineProperty(values, name, { value, enumerable: true, writable: true, configurable: true });
      return JSON.stringify(values);
    };
    const snapshot = async () => {
      requireUnlocked();
      const plaintext = encoder.encode(serializeSecrets());
      if (plaintext.byteLength > localSecretVaultMaxBytes) throw Error('O cofre de segredos excede o limite de 1 MB.');
      const iv = cryptoProvider.getRandomValues(new Uint8Array(12));
      const ciphertext = await cryptoProvider.subtle.encrypt({ name: 'AES-GCM', iv, additionalData, tagLength: 128 }, state.key, plaintext);
      state.envelope = {
        format: localSecretVaultFormat,
        version: localSecretVaultVersion,
        cipher: 'AES-GCM-256',
        kdf: 'PBKDF2-SHA-256',
        iterations: workspaceBackupPbkdf2Iterations,
        salt: bytesToBase64(state.salt),
        iv: bytesToBase64(iv),
        ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
        names: [...state.secrets.keys()]
      };
      return state.envelope;
    };
    const vault = {
      get locked() { return !state.secrets; },
      async set(name, value) {
        requireUnlocked();
        const keyName = validateLocalSecretName(name);
        const text = String(value ?? '');
        if (text.length > 100000) throw Error('O segredo excede 100 KB.');
        state.secrets.set(keyName, text);
        await snapshot();
      },
      async get(name) {
        requireUnlocked();
        const keyName = validateLocalSecretName(name);
        if (!state.secrets.has(keyName)) throw Error('Segredo não encontrado no cofre: ' + keyName);
        return state.secrets.get(keyName);
      },
      async remove(name) {
        requireUnlocked();
        const keyName = validateLocalSecretName(name);
        state.secrets.delete(keyName);
        await snapshot();
        return true;
      },
      async names() {
        requireUnlocked();
        return [...state.secrets.keys()];
      },
      async lock() {
        state.key = null;
        state.secrets = null;
      },
      async unlock(passphrase) {
        validateWorkspaceBackupPassphrase(passphrase);
        if (!state.envelope) throw Error('O cofre de segredos não possui um snapshot cifrado.');
        const saltBytes = base64ToBytes(state.envelope.salt, 'salt');
        const nextKey = await deriveWorkspaceBackupKey(passphrase, saltBytes, cryptoProvider);
        let plaintext;
        try {
          const decrypted = await cryptoProvider.subtle.decrypt(
            { name: 'AES-GCM', iv: base64ToBytes(state.envelope.iv, 'vetor de inicialização'), additionalData, tagLength: 128 },
            nextKey,
            base64ToBytes(state.envelope.ciphertext, 'conteúdo')
          );
          plaintext = new TextDecoder().decode(decrypted);
        } catch {
          throw Error('Senha do cofre incorreta ou envelope danificado.');
        }
        let parsed;
        try { parsed = JSON.parse(plaintext); }
        catch { throw Error('Conteúdo do cofre inválido.'); }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('Conteúdo do cofre inválido.');
        state.salt = saltBytes;
        state.key = nextKey;
        state.secrets = new Map(Object.entries(parsed).map(([name, value]) => [validateLocalSecretName(name), String(value)]));
      },
      async toEnvelope() {
        if (state.secrets && state.key) return { ...(await snapshot()) };
        if (state.envelope) return { ...state.envelope, names: Array.isArray(state.envelope.names) ? [...state.envelope.names] : [] };
        throw Error('O cofre de segredos não possui um snapshot cifrado.');
      }
    };
    return vault;
  }

  async function createLocalSecretVault(passphrase, salt, cryptoProvider = globalThis.crypto) {
    validateWorkspaceBackupPassphrase(passphrase);
    if (!cryptoProvider?.subtle || typeof cryptoProvider.getRandomValues !== 'function') throw Error('Criptografia segura indisponível neste navegador. Abra o Vortix pelo endereço local.');
    const saltBytes = normalizeLocalSecretVaultSalt(salt, cryptoProvider);
    const key = await deriveWorkspaceBackupKey(passphrase, saltBytes, cryptoProvider);
    const vault = makeLocalSecretVault({ salt: saltBytes, key, cryptoProvider, secrets: new Map(), envelope: null });
    await vault.toEnvelope();
    return vault;
  }

  async function openLocalSecretVault(envelopeText, passphrase, cryptoProvider = globalThis.crypto) {
    validateWorkspaceBackupPassphrase(passphrase);
    if (!cryptoProvider?.subtle || typeof cryptoProvider.getRandomValues !== 'function') throw Error('Criptografia segura indisponível neste navegador. Abra o Vortix pelo endereço local.');
    if (typeof envelopeText !== 'string' || envelopeText.length > localSecretVaultMaxEnvelopeBytes) throw Error('Envelope do cofre inválido.');
    let envelope;
    try { envelope = JSON.parse(envelopeText); }
    catch { throw Error('Envelope do cofre inválido.'); }
    validateLocalSecretVaultEnvelope(envelope);
    const saltBytes = normalizeLocalSecretVaultSalt(envelope.salt, cryptoProvider);
    const key = await deriveWorkspaceBackupKey(passphrase, saltBytes, cryptoProvider);
    const additionalData = localSecretVaultAdditionalData();
    let plaintext;
    try {
      const decrypted = await cryptoProvider.subtle.decrypt(
        { name: 'AES-GCM', iv: base64ToBytes(envelope.iv, 'vetor de inicialização'), additionalData, tagLength: 128 },
        key,
        base64ToBytes(envelope.ciphertext, 'conteúdo')
      );
      plaintext = new TextDecoder().decode(decrypted);
    } catch {
      throw Error('Senha do cofre incorreta ou envelope danificado.');
    }
    let parsed;
    try { parsed = JSON.parse(plaintext); }
    catch { throw Error('Conteúdo do cofre inválido.'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('Conteúdo do cofre inválido.');
    const secrets = new Map();
    for (const [name, value] of Object.entries(parsed)) secrets.set(validateLocalSecretName(name), String(value));
    return makeLocalSecretVault({ salt: saltBytes, key, cryptoProvider, secrets, envelope: { ...envelope, names: [...secrets.keys()] } });
  }

  return { buildOpenApi31Export, parseOpenApiSpec, sanitizeOpenApiResponseContract, validateOpenApiResponseContract, validateOpenApiRequestBodyContract, parseCurlCommand, parseHttpieCommand, flattenRequests, searchRequests, normalizeWorkspaceTabs, normalizeEnvironmentPickerEntries, isSensitiveVariableName, exportEnvironmentVariables, buildPostmanEnvironmentExport, importPostmanEnvironment, normalizeMultipartFields, persistAuthFields, normalizeImportedAuthMode, resolveInheritedAuth, buildGraphqlBody, buildPostmanGraphqlBody, buildInsomniaGraphqlBody, parseGraphqlSchemaResponse, suggestGraphqlFields, normalizeGraphqlImportBody, normalizeTokenRequestConfig, normalizeOAuthClientCredentialsConfig, normalizeOAuthPkceConfig, buildOAuthClientCredentialsRequest, parseOAuthTokenResponse, maxWorkspaceTabs, parseDataSets, normalizePreRequestActions, preRequestActionHasLiteralText, persistablePreRequestActions, preRequestActionsAffectBaseUrl, runPreRequestActions, buildPreRequestScript, parsePreRequestScript, resolveTemplate, resolveTemplateWithProvenance, inspectTemplateReferences, redactSecretValues, secretValuesUsedByProvenance, vaultCaptureEnvironmentError, splitRoute, remoteHttpOrigin, remoteHttpOrigins, prepareSavedRequest, writeMethods, parseResponseBody, formatJsonPath, findTextMatches, parseJsonPath, jsonPathValue, normalizeHistorySettings, normalizeHistoryResponseHeaders, createResponseHistorySnapshot, retainNewestHistoryEntries, createRunnerHistorySnapshot, retainNewestRunnerHistoryEntries, sanitizeRunnerHistoryValue, runnerHistoryAnnouncement, runnerHistoryCompatibilityWarning, runnerHistoryLimit, runnerHistoryStorageLimitBytes, compareHistoryResponses, normalizeResponseExamples, addResponseExample, appendResponseExampleToRequest, importResponseExamples, buildPostmanResponseExamples, responseExampleToInsomniaResource, responseExampleRequestMatches, buildResponseExampleMock, normalizeResponseTests, responseTestLabel, evaluateResponseTests, buildResponseTestScript, buildCurlCommand, buildHttpieCommand, createWorkspaceBackup, parseWorkspaceBackup, readHostedCookieJars, replaceHostedCookieJars, isEncryptedWorkspaceBackup, createWorkspaceBackupVault, encryptWorkspaceBackup, decryptWorkspaceBackup, createLocalSecretVault, openLocalSecretVault, localSecretVaultFormat, maxWorkspaceBackupBytes, maxEncryptedWorkspaceBackupBytes, workspaceBackupPassphraseMinLength };
});
