(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ApiStudioRunner = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  'use strict';

  const methods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
  const writeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  const reservedNames = new Set(['__proto__', 'prototype', 'constructor']);
  const maxDataSets = 100;

  function flattenRequests(node, ancestors = [], depth = 0, folderId = '') {
    if (depth > 20) throw Error('A coleção ultrapassa 20 níveis de pastas.');
    const currentPath = [...ancestors, String(node?.name || '').trim()].filter(Boolean);
    const path = currentPath.join(' / ');
    const result = (node?.requests || []).map(request => ({ request, path, folderId }));
    for (const folder of node?.folders || []) {
      result.push(...flattenRequests(folder, currentPath, depth + 1, String(folder?.id || '')));
    }
    return result;
  }

  function normalizeSearchText(value) {
    return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  function searchRequests(collections, query, limit = 30) {
    const term = normalizeSearchText(query).trim();
    if (!term) return [];
    const requestedLimit = Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : 30;
    const maxResults = Math.max(1, Math.min(100, requestedLimit));
    const results = [];
    for (const collection of collections || []) {
      for (const entry of flattenRequests(collection)) {
        const { request } = entry;
        const searchable = normalizeSearchText([collection?.name, entry.path, request?.method, request?.name, request?.route].join(' '));
        if (!searchable.includes(term)) continue;
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
      const request = { ...source.request, bearerToken: saveBearerToken ? String(source.request.bearerToken || '') : '', allowInsecureHttp: source.request.allowInsecureHttp === true };
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

  function tokenizeCurlCommand(source) {
    if (typeof source !== 'string' || source.length > 1024 * 1024) throw Error('Comando cURL inválido ou maior que 1 MB.');
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
      if (character === "'" || character === '"') { quote = character; active = true; continue; }
      if (character === '\\' && index + 1 < input.length) { token += input[++index]; active = true; continue; }
      if (/\s/.test(character)) { if (active) { tokens.push(token); token = ''; active = false; } continue; }
      token += character; active = true;
    }
    if (quote) throw Error('Aspas não fechadas no comando cURL.');
    if (active) tokens.push(token);
    return tokens;
  }

  function parseCurlCommand(source) {
    const tokens = tokenizeCurlCommand(source);
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

  function splitRoute(value) {
    const source = String(value ?? '');
    if (!source.trim()) return { route: '', params: [] };
    try {
      const url = new URL(source, 'http://localhost');
      return { route: url.pathname, params: [...url.searchParams.entries()] };
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

  function remoteHttpOrigins(cases, environment = {}) {
    const origins = new Set();
    for (const item of cases || []) {
      const baseUrl = resolveTemplate(item?.request?.baseUrl || '', environment, item?.dataset || {});
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

  function prepareSavedRequest(saved, environment, dataset, allowWrites = false) {
    const method = String(saved?.method || 'GET').toUpperCase();
    if (saved?.tokenRequest) {
      throw Error('Requests de credenciais manuais precisam ser enviadas pelo fluxo de token.');
    }
    if (!methods.has(method)) throw Error('Método não suportado na coleção: ' + method);
    if (writeMethods.has(method) && !allowWrites) throw Error('Confirme as chamadas de escrita antes de executar.');
    const resolve = value => resolveTemplate(value, environment, dataset);

    return {
      baseUrl: resolve(saved?.baseUrl || ''),
      route: resolve(saved?.route || ''),
      method,
      bearerToken: resolve(saved?.bearerToken || ''),
      headers: resolve(saved?.headers || ''),
      body: resolve(saved?.body || ''),
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
      responseTests: normalizeResponseTests(saved?.responseTests),
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
    return { format: 'api-studio-workspace', version: 1, exportedAt: String(exportedAt), data: Object.fromEntries(workspaceBackupStores.map(store => [store, data[store]])) };
  }

  function parseWorkspaceBackup(text) {
    if (typeof text !== 'string' || text.length > maxWorkspaceBackupBytes) throw Error('Arquivo de backup excede 15 MB.');
    let backup;
    try { backup = JSON.parse(text); }
    catch { throw Error('Arquivo JSON inválido.'); }
    if (!backup || typeof backup !== 'object' || Array.isArray(backup) || backup.format !== 'api-studio-workspace') throw Error('Este arquivo não é um backup do Vortix.');
    if (backup.version !== 1) throw Error('Versão de backup não suportada.');
    const counts = validateWorkspaceBackupData(backup.data);
    return { data: backup.data, counts, exportedAt: String(backup.exportedAt || '') };
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

  async function encryptWorkspaceBackup(backupText, passphrase, cryptoProvider = globalThis.crypto) {
    validateWorkspaceBackupPassphrase(passphrase);
    if (!cryptoProvider?.subtle || typeof cryptoProvider.getRandomValues !== 'function') throw Error('Criptografia segura indisponível neste navegador. Abra o Vortix pelo endereço local.');
    parseWorkspaceBackup(backupText);
    const encoder = new TextEncoder();
    const plaintext = encoder.encode(backupText);
    if (plaintext.byteLength > maxWorkspaceBackupBytes) throw Error('Backup excede o limite de 15 MB.');
    const salt = cryptoProvider.getRandomValues(new Uint8Array(16));
    const iv = cryptoProvider.getRandomValues(new Uint8Array(12));
    const key = await deriveWorkspaceBackupKey(passphrase, salt, cryptoProvider);
    const additionalData = encoder.encode(encryptedWorkspaceBackupFormat + ':1');
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
  }

  async function decryptWorkspaceBackup(text, passphrase, cryptoProvider = globalThis.crypto) {
    validateWorkspaceBackupPassphrase(passphrase);
    if (typeof text !== 'string' || text.length > maxEncryptedWorkspaceBackupBytes) throw Error('Arquivo de backup protegido excede 22 MB.');
    let envelope;
    try { envelope = JSON.parse(text); }
    catch { throw Error('Arquivo de backup protegido inválido.'); }
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || envelope.format !== encryptedWorkspaceBackupFormat || envelope.version !== 1 || envelope.cipher !== 'AES-GCM-256' || envelope.kdf !== 'PBKDF2-SHA-256' || envelope.iterations !== workspaceBackupPbkdf2Iterations) throw Error('Formato de backup protegido não suportado.');
    const salt = base64ToBytes(envelope.salt, 'salt');
    const iv = base64ToBytes(envelope.iv, 'vetor de inicialização');
    const ciphertext = base64ToBytes(envelope.ciphertext, 'conteúdo');
    if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 16 || ciphertext.length > maxEncryptedWorkspaceBackupBytes) throw Error('Arquivo de backup protegido inválido.');
    const key = await deriveWorkspaceBackupKey(passphrase, salt, cryptoProvider);
    const decoder = new TextDecoder();
    let plaintext;
    try {
      const decrypted = await cryptoProvider.subtle.decrypt(
        { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(encryptedWorkspaceBackupFormat + ':1'), tagLength: 128 },
        key,
        ciphertext
      );
      plaintext = decoder.decode(decrypted);
    } catch {
      throw Error('Senha incorreta ou arquivo danificado.');
    }
    try { return parseWorkspaceBackup(plaintext); }
    catch { throw Error('O conteúdo descriptografado não é um backup válido do Vortix.'); }
  }

  return { parseCurlCommand, flattenRequests, searchRequests, normalizeWorkspaceTabs, normalizeTokenRequestConfig, maxWorkspaceTabs, parseDataSets, resolveTemplate, splitRoute, remoteHttpOrigin, remoteHttpOrigins, prepareSavedRequest, writeMethods, parseResponseBody, formatJsonPath, findTextMatches, parseJsonPath, jsonPathValue, normalizeResponseTests, responseTestLabel, evaluateResponseTests, buildResponseTestScript, createWorkspaceBackup, parseWorkspaceBackup, isEncryptedWorkspaceBackup, encryptWorkspaceBackup, decryptWorkspaceBackup, maxWorkspaceBackupBytes, maxEncryptedWorkspaceBackupBytes, workspaceBackupPassphraseMinLength };
});
