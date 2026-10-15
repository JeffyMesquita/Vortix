const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function runnerLogic() {
  const modulePath = path.join(__dirname, 'wwwroot', 'runner-logic.js');
  assert.ok(fs.existsSync(modulePath), 'runner logic module should exist');
  return require(modulePath);
}

test('imports OpenAPI 3 paths into tagged requests with parameters and JSON examples', () => {
  const { parseOpenApiSpec } = runnerLogic();
  const result = parseOpenApiSpec({
    openapi: '3.1.1',
    info: { title: 'Pet API' },
    servers: [{ url: 'https://api.example.test/v1' }],
    paths: {
      '/pets/{petId}': {
        parameters: [{ name: 'petId', in: 'path', required: true, example: 42 }],
        get: { tags: ['Pets'], summary: 'Get pet', parameters: [{ name: 'details', in: 'query', example: 'owner' }], responses: { '200': { content: { 'application/json': {} } } } },
        patch: { tags: ['Pets'], summary: 'Rename pet', requestBody: { content: { 'application/json': { example: { name: 'Ana' } } } }, responses: { '200': { content: { 'application/json': {} } } } }
      }
    }
  });
  assert.equal(result.collection.name, 'Pet API');
  assert.deepEqual(result.collection.requests, []);
  assert.equal(result.environment, null);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.collection.folders[0].requests.map(request => ({ name: request.name, method: request.method, baseUrl: request.baseUrl, route: request.route, headers: request.headers, body: request.body })), [
    { name: 'Get pet', method: 'GET', baseUrl: 'https://api.example.test/v1', route: '/pets/42?details=owner', headers: 'Accept: application/json', body: '' },
    { name: 'Rename pet', method: 'PATCH', baseUrl: 'https://api.example.test/v1', route: '/pets/42', headers: 'Accept: application/json\nContent-Type: application/json', body: '{\n  "name": "Ana"\n}' }
  ]);
});

test('imports safe server defaults and warns without copying OpenAPI security secrets', () => {
  const { parseOpenApiSpec } = runnerLogic();
  const result = parseOpenApiSpec({
    openapi: '3.0.3',
    info: { title: 'Orders' },
    servers: [{ url: 'https://{environment}.example.test/v1', variables: { environment: { default: 'dev' }, token: { default: 'private-value' } } }],
    security: [{ bearerAuth: [] }],
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
    paths: { '/orders': { get: { responses: { '200': {} } } } }
  });
  assert.equal(result.collection.requests[0].baseUrl, 'https://{{environment}}.example.test/v1');
  assert.deepEqual(result.environment, { name: 'Orders - Server', group: 'OpenAPI', variables: { environment: 'dev' } });
  assert.equal(JSON.stringify(result).includes('private-value'), false);
  assert.ok(result.warnings.some(warning => /seguranca/i.test(warning)));
});

test('rejects unsupported OpenAPI versions and documents without paths', () => {
  const { parseOpenApiSpec } = runnerLogic();
  assert.throws(() => parseOpenApiSpec({ openapi: '2.0', info: { title: 'Old API' }, paths: {} }), /3\.0.*3\.2/i);
  assert.throws(() => parseOpenApiSpec({ openapi: '3.1.0', info: { title: 'Missing paths' } }), /paths/i);
});

test('parses a quoted cURL request without executing it', () => {
  const { parseCurlCommand } = runnerLogic();
  const command = ['curl --request PATCH "https://api.example.test/v1/items/42?notify=true"', '--header "Accept: application/json"', '--header "Content-Type: application/json"', '--data-raw ' + String.fromCharCode(39) + '{"name":"Nova"}' + String.fromCharCode(39)].join(' ');
  assert.deepEqual(parseCurlCommand(command), {
    method: 'PATCH',
    url: 'https://api.example.test/v1/items/42?notify=true',
    headers: [['Accept', 'application/json'], ['Content-Type', 'application/json']],
    body: '{"name":"Nova"}',
    bearerToken: ''
  });
});

test('infers POST and form content type from cURL data', () => {
  const { parseCurlCommand } = runnerLogic();
  assert.deepEqual(parseCurlCommand('curl --data name=Ana https://api.example.test/v1/users'), {
    method: 'POST',
    url: 'https://api.example.test/v1/users',
    headers: [['Content-Type', 'application/x-www-form-urlencoded']],
    body: 'name=Ana',
    bearerToken: ''
  });
});

test('parses shell line continuations and extracts Bearer without keeping Authorization header', () => {
  const { parseCurlCommand } = runnerLogic();
  const command = [
    'curl --silent --request GET',
    '--url "https://api.example.test/v1/profile?view=full"',
    '--header "Authorization: Bearer {{token}}"',
    '--header "Accept: application/json"'
  ].join(' ' + String.fromCharCode(92) + '\n  ');
  assert.deepEqual(parseCurlCommand(command), {
    method: 'GET',
    url: 'https://api.example.test/v1/profile?view=full',
    headers: [['Accept', 'application/json']],
    body: '',
    bearerToken: '{{token}}'
  });
});

test('rejects unsupported or secret-bearing cURL options without echoing credentials', () => {
  const { parseCurlCommand } = runnerLogic();
  assert.throws(() => parseCurlCommand('curl --insecure https://api.example.test'), /opção.*não suportada/i);
  assert.throws(() => parseCurlCommand('curl --location https://api.example.test'), /--location/i);
  assert.throws(() => parseCurlCommand('curl --user admin:very-secret https://api.example.test'), error => {
    assert.match(error.message, /Basic.*não suportad/i);
    assert.doesNotMatch(error.message, /very-secret/);
    return true;
  });
});

test('concatenates repeated cURL JSON segments without form separators', () => {
  const { parseCurlCommand } = runnerLogic();
  const quote = String.fromCharCode(39);
  const command = 'curl --json ' + quote + '{"ready":' + quote + ' --json ' + quote + 'true}' + quote + ' https://api.example.test/v1/check';
  assert.deepEqual(parseCurlCommand(command), {
    method: 'POST',
    url: 'https://api.example.test/v1/check',
    headers: [['Content-Type', 'application/json'], ['Accept', 'application/json']],
    body: '{"ready":true}',
    bearerToken: ''
  });
});

test('rejects file-backed data instead of treating the filename as a body', () => {
  const { parseCurlCommand } = runnerLogic();
  assert.throws(() => parseCurlCommand('curl --json @payload.json https://api.example.test/v1/check'), /arquivo/i);
});

test('rejects cURL destinations outside HTTP and HTTPS', () => {
  const { parseCurlCommand } = runnerLogic();
  assert.throws(() => parseCurlCommand('curl file:///private/data'), /HTTP ou HTTPS/i);
  assert.throws(() => parseCurlCommand('curl https://user:password@api.example.test/data'), /credenciais.*URL/i);
});

test('flattens a collection in visual order with nested folder paths', () => {
  const { flattenRequests } = runnerLogic();
  const collection = {
    name: 'Groups',
    requests: [{ name: 'List groups' }],
    folders: [{
      name: 'Auth', requests: [{ name: 'Get token' }],
      folders: [{ name: 'Nested', requests: [{ name: 'Who am I' }], folders: [] }]
    }]
  };

  assert.deepEqual(flattenRequests(collection).map(({ request, path: itemPath }) => [request.name, itemPath]), [
    ['List groups', 'Groups'],
    ['Get token', 'Groups / Auth'],
    ['Who am I', 'Groups / Auth / Nested']
  ]);
});

test('parses an optional array of dataset variables and rejects unsafe shapes', () => {
  const { parseDataSets } = runnerLogic();
  assert.deepEqual(parseDataSets(''), [{}]);
  assert.deepEqual(parseDataSets('[{"id":1},{"id":2}]').map(value => ({ ...value })), [{ id: '1' }, { id: '2' }]);
  assert.throws(() => parseDataSets('{"id":1}'), /array/i);
  assert.throws(() => parseDataSets('[null]'), /objeto/i);
  assert.throws(() => parseDataSets('[{"__proto__":"x"}]'), /variável/i);
});

test('dataset variables override the active environment and missing values fail clearly', () => {
  const { resolveTemplate } = runnerLogic();
  assert.equal(resolveTemplate('{{baseUrl}}/groups/{{id}}', { baseUrl: 'https://api.test', id: 'old' }, { id: 42 }), 'https://api.test/groups/42');
  assert.throws(() => resolveTemplate('/groups/{{missing}}', {}, {}), /missing/);
});

test('splits saved routes without turning an empty request into the API root', () => {
  const { splitRoute } = runnerLogic();
  assert.deepEqual(splitRoute(''), { route: '', params: [] });
  assert.deepEqual(splitRoute('/v1/items?tenant=west&active=true'), { route: '/v1/items', params: [['tenant', 'west'], ['active', 'true']] });
});

test('write calls only receive the test guard after explicit runner approval', () => {
  const { prepareSavedRequest } = runnerLogic();
  const request = { method: 'POST', baseUrl: '{{baseUrl}}', route: '/groups', body: '{"id":{{id}}}' };
  assert.throws(() => prepareSavedRequest(request, { baseUrl: 'http://localhost' }, { id: 1 }, false), /confirm/i);
  const prepared = prepareSavedRequest(request, { baseUrl: 'http://localhost' }, { id: 1 }, true);
  assert.equal(prepared.confirmTestData, true);
  assert.equal(prepared.testDataPhrase, 'TESTE');
  assert.equal(prepared.body, '{"id":1}');
});

test('only requests explicitly marked as credential prompts stay out of the Runner', () => {
  const { prepareSavedRequest } = runnerLogic();
  assert.throws(() => prepareSavedRequest({ method: 'POST', tokenRequest: true }, {}, {}, true), /credenciais/i);
  const savedTokenCall = prepareSavedRequest({ method: 'POST', route: '/oauth/token' }, {}, {}, true);
  assert.equal(savedTokenCall.route, '/oauth/token');
  assert.equal(savedTokenCall.confirmTestData, true);
});

test('token helper configuration has no default route and accepts persisted API-specific names', () => {
  const { normalizeTokenRequestConfig } = runnerLogic();
  assert.deepEqual(normalizeTokenRequestConfig(), {
    route: '', clientIdField: 'client_id', clientSecretField: 'client_secret', credentialMode: 'body'
  });
  assert.deepEqual(normalizeTokenRequestConfig({
    route: '/identity/access-token', clientIdField: 'app_key', clientSecretField: 'app_password', credentialMode: 'query'
  }), {
    route: '/identity/access-token', clientIdField: 'app_key', clientSecretField: 'app_password', credentialMode: 'query'
  });
  assert.throws(() => normalizeTokenRequestConfig({ route: 'https://outside.example/token' }), /rota/i);
});

test('saved requests keep an explicit remote HTTP opt-in for manual and Runner calls', () => {
  const { prepareSavedRequest } = runnerLogic();
  const guarded = prepareSavedRequest({ method: 'GET', route: '/items' }, {}, {}, true);
  const optedIn = prepareSavedRequest({ method: 'GET', route: '/items', allowInsecureHttp: true }, {}, {}, true);
  assert.equal(guarded.allowInsecureHttp, false);
  assert.equal(optedIn.allowInsecureHttp, true);
});

test('remote HTTP detection exempts loopback and Runner requires request opt-in', () => {
  const { remoteHttpOrigin, remoteHttpOrigins } = runnerLogic();
  assert.equal(remoteHttpOrigin('http://localhost:51873'), '');
  assert.equal(remoteHttpOrigin('http://127.0.0.2:8080'), '');
  assert.equal(remoteHttpOrigin('http://[::1]:8080'), '');
  assert.equal(remoteHttpOrigin('https://api.example.test'), '');
  assert.equal(remoteHttpOrigin('http://api.example.test/v1'), 'http://api.example.test');
  assert.throws(() => remoteHttpOrigins([{ request: { baseUrl: 'http://api.example.test' }, dataset: {} }], {}), /habilitação/i);
  assert.deepEqual(remoteHttpOrigins([
    { request: { baseUrl: '{{baseUrl}}', allowInsecureHttp: true }, dataset: {} },
    { request: { baseUrl: 'http://api.example.test/v2', allowInsecureHttp: true }, dataset: {} }
  ], { baseUrl: 'http://api.example.test/v1' }), ['http://api.example.test']);
});

test('workspace exposes the Runner and its dataset/write safety controls', () => {
  const html = fs.readFileSync(path.join(__dirname, 'wwwroot', 'index.html'), 'utf8');
  assert.match(html, /id="run-collection"/);
  assert.match(html, /id="runner-dialog"/);
  assert.match(html, /id="runner-datasets"/);
  assert.match(html, /id="runner-write-phrase"/);
  assert.match(html, /id="runner-stop-on-error"/);
});

test('evaluates response status and nested JSON assertions without exposing response values', () => {
  const { evaluateResponseTests } = runnerLogic();
  const results = evaluateResponseTests([
    { id: 'status', target: 'status', operator: 'equals', expected: '201' },
    { id: 'exists', target: 'json', path: 'data.id', operator: 'exists' },
    { id: 'equals', target: 'json', path: 'data.id', operator: 'equals', expected: '42' },
    { id: 'contains', target: 'json', path: 'tags', operator: 'contains', expected: 'beta' },
    { id: 'missing', target: 'json', path: 'data.missing', operator: 'exists' }
  ], { status: 201, body: '{"data":{"id":42},"tags":["alpha","beta"]}' });

  assert.deepEqual(results.map(result => [result.id, result.passed]), [
    ['status', true], ['exists', true], ['equals', true], ['contains', true], ['missing', false]
  ]);
  assert.doesNotMatch(JSON.stringify(results), /alpha|beta|42/);
});

test('parses response JSON and formats safe reusable JSON paths', () => {
  const { parseResponseBody, formatJsonPath, jsonPathValue } = runnerLogic();
  const raw = '{"data":{"display name":[{"quote\\"key":7}]},"ok":true}';
  const response = parseResponseBody(raw);
  assert.equal(response.isJson, true);
  assert.equal(response.raw, raw);
  assert.equal(response.pretty, '{\n  "data": {\n    "display name": [\n      {\n        "quote\\\"key": 7\n      }\n    ]\n  },\n  "ok": true\n}');
  const path = formatJsonPath(['data', 'display name', 0, 'quote"key']);
  assert.equal(path, 'data["display name"][0]["quote\\\"key"]');
  assert.equal(jsonPathValue(response.value, path), 7);
});

test('keeps non-JSON response bodies intact and counts body search matches', () => {
  const { parseResponseBody, findTextMatches } = runnerLogic();
  const raw = 'Token token\nplain response';
  const response = parseResponseBody(raw);
  assert.deepEqual({ isJson: response.isJson, raw: response.raw, pretty: response.pretty }, { isJson: false, raw, pretty: raw });
  assert.deepEqual(findTextMatches(raw, 'token'), [{ start: 0, end: 5 }, { start: 6, end: 11 }]);
  assert.deepEqual(findTextMatches(raw, ''), []);
});
test('validates response test paths, operators, and HTTP status values', () => {
  const { normalizeResponseTests } = runnerLogic();
  assert.throws(() => normalizeResponseTests([{ target: 'json', path: 'data..id', operator: 'exists' }]), /Caminho JSON inválido/);
  assert.throws(() => normalizeResponseTests([{ target: 'status', operator: 'equals', expected: '999' }]), /status HTTP/i);
  assert.throws(() => normalizeResponseTests([{ target: 'json', path: 'data.id', operator: 'script' }]), /operador/i);
  assert.throws(() => normalizeResponseTests([{ target: 'json', path: 'x'.repeat(1001), operator: 'exists' }]), /1000/);
  assert.throws(() => normalizeResponseTests([{ target: 'json', path: 'data.id', operator: 'equals', expected: 'x'.repeat(1001) }]), /1000/);
});

test('exports response checks as executable Insomnia and Postman after-response tests', () => {
  const { buildResponseTestScript } = runnerLogic();
  const rules = [
    { target: 'status', operator: 'equals', expected: '201' },
    { target: 'json', path: 'data.id', operator: 'exists' },
    { target: 'json', path: 'data.enabled', operator: 'equals', expected: 'true' },
    { target: 'json', path: 'tags', operator: 'contains', expected: 'beta' }
  ];
  const response = { status: 201, body: '{"data":{"id":42,"enabled":true},"tags":["alpha","beta"]}' };
  const expected = [
    ['Status HTTP é 201', true],
    ['Campo data.id existe', true],
    ['Campo data.enabled é igual ao valor informado', true],
    ['Campo tags contém o valor informado', true]
  ];

  for (const runtime of ['insomnia', 'postman']) {
    const results = [];
    const expect = actual => ({ to: { eql(value) { assert.deepEqual(actual, value); } } });
    const runTest = (name, callback) => {
      try { callback(); results.push([name, true]); }
      catch { results.push([name, false]); }
    };
    const body = JSON.parse(response.body);
    const sandbox = runtime === 'insomnia'
      ? { insomnia: { response: { status: response.status, json: () => body }, test: runTest, expect }, Object, String, Array, JSON }
      : { pm: { response: { code: response.status, json: () => body }, test: runTest, expect }, Object, String, Array, JSON };

    vm.runInNewContext(buildResponseTestScript(rules, runtime), sandbox);
    assert.deepEqual(results, expected);
  }
});

test('keeps status checks runnable when external response body is invalid JSON', () => {
  const { buildResponseTestScript } = runnerLogic();
  const rules = [
    { target: 'status', operator: 'equals', expected: '201' },
    { target: 'json', path: 'data.id', operator: 'exists' }
  ];
  for (const runtime of ['insomnia', 'postman']) {
    const results = [];
    const expect = actual => ({ to: { eql(value) { assert.deepEqual(actual, value); } } });
    const runTest = (name, callback) => {
      try { callback(); results.push([name, true]); }
      catch { results.push([name, false]); }
    };
    const sandbox = runtime === 'insomnia'
      ? { insomnia: { response: { status: 201, json() { throw Error('invalid JSON'); } }, test: runTest, expect }, Object, String, Array, JSON }
      : { pm: { response: { code: 201, json() { throw Error('invalid JSON'); } }, test: runTest, expect }, Object, String, Array, JSON };

    vm.runInNewContext(buildResponseTestScript(rules, runtime), sandbox);
    assert.deepEqual(results, [['Status HTTP é 201', true], ['Campo data.id existe', false]]);
  }
});

test('workspace exposes response-test controls and a visible result area', () => {
  const html = fs.readFileSync(path.join(__dirname, 'wwwroot', 'index.html'), 'utf8');
  assert.match(html, /id="add-response-test"/);
  assert.match(html, /id="response-tests-list"/);
  assert.match(html, /id="response-tests-output"/);
  assert.match(html, /data-editor-tab="tests"/);
  assert.match(html, /data-editor-panel="tests"/);
});

test('workspace groups global appearance controls in settings', () => {
  const html = fs.readFileSync(path.join(__dirname, 'wwwroot', 'index.html'), 'utf8');
  assert.match(html, /id="settings-dialog"/);
  assert.match(html, /id="settings-environments"/);
});

test('quick search finds nested requests by accent-insensitive text and keeps their collection path', () => {
  const { searchRequests } = runnerLogic();
  const collection = {
    id: 'collection-1', name: 'Minha Coleção',
    requests: [],
    folders: [{ id: 'folder-1', name: 'Autenticação', requests: [{ id: 'request-1', name: 'Criar usuário', method: 'POST', route: '/api/usuarios' }], folders: [] }]
  };

  assert.deepEqual(searchRequests([collection], 'criar usuario').map(({ request, path: itemPath, collectionId, folderId }) => [request.id, itemPath, collectionId, folderId]), [
    ['request-1', 'Minha Coleção / Autenticação', 'collection-1', 'folder-1']
  ]);
});

test('quick search stays empty without a query and respects the result limit', () => {
  const { searchRequests } = runnerLogic();
  const collection = { id: 'c1', name: 'Requests', requests: [{ id: 'r1', name: 'Groups', method: 'GET', route: '/api/groups' }, { id: 'r2', name: 'Groups detail', method: 'GET', route: '/api/groups/1' }], folders: [] };

  assert.deepEqual(searchRequests([collection], '  '), []);
  assert.deepEqual(searchRequests([collection], 'groups', 1).map(item => item.request.id), ['r1']);
});
test('quick search is reachable from the sidebar and exposes an accessible result list', () => {
  const html = fs.readFileSync(path.join(__dirname, 'wwwroot', 'index.html'), 'utf8');
  assert.match(html, /id="quick-open-button"/);
  assert.match(html, /id="quick-open-dialog"/);
  assert.match(html, /id="quick-open-query"/);
  assert.match(html, /id="quick-open-results"/);
});
test('workspace tabs discard invalid and duplicate records and select the newest when active tab is missing', () => {
  const { normalizeWorkspaceTabs } = runnerLogic();
  const state = normalizeWorkspaceTabs({ activeId: 'missing', tabs: [
    { id: 'one', title: 'One', request: { method: 'GET' } },
    { id: 'one', title: 'Duplicate', request: { method: 'POST' } },
    { id: '', title: 'Invalid', request: { method: 'GET' } },
    { id: 'two', title: 'Two', request: { method: 'POST' } }
  ] });

  assert.deepEqual(state.tabs.map(tab => tab.id), ['one', 'two']);
  assert.equal(state.activeId, 'two');
});

test('workspace tabs keep at most twelve and preserve selected tab when it survives', () => {
  const { normalizeWorkspaceTabs } = runnerLogic();
  const tabs = Array.from({ length: 14 }, (_, index) => ({ id: `tab-${index}`, title: `Tab ${index}`, request: { method: 'GET' } }));

  const state = normalizeWorkspaceTabs({ activeId: 'tab-12', tabs });
  assert.equal(state.tabs.length, 12);
  assert.equal(state.tabs[0].id, 'tab-2');
  assert.equal(state.activeId, 'tab-12');
});
test('workspace exposes an accessible open-request tablist and a new-tab action', () => {
  const html = fs.readFileSync(path.join(__dirname, 'wwwroot', 'index.html'), 'utf8');
  assert.match(html, /id="workspace-tabs"/);
  assert.match(html, /aria-label="Requests abertas"/);
  assert.match(html, /id="add-workspace-tab"/);
});
test('workspace tabs omit Bearer when that tab disables local token saving', () => {
  const { normalizeWorkspaceTabs } = runnerLogic();
  const state = normalizeWorkspaceTabs({ tabs: [
    { id: 'private', title: 'Private', saveBearerToken: false, request: { method: 'GET', bearerToken: 'not-persisted' } },
    { id: 'saved', title: 'Saved', saveBearerToken: true, request: { method: 'GET', bearerToken: 'local-token' } }
  ] });

  assert.equal(state.tabs[0].request.bearerToken, '');
  assert.equal(state.tabs[0].saveBearerToken, false);
  assert.equal(state.tabs[1].request.bearerToken, 'local-token');
});
test('workspace backup preserves nested requests, environment values, history, and settings', () => {
  const { createWorkspaceBackup, parseWorkspaceBackup } = runnerLogic();
  const source = {
    collections: [{ id: 'collection-1', name: 'Minha coleção', requests: [], folders: [{ id: 'folder-1', name: 'Auth', folders: [], requests: [{ id: 'request-1', method: 'POST', route: '/token', params: [['tenant', '{{tenant}}']], body: '{"client":"{{client}}"}', bearerToken: 'local-token' }] }] }],
    environments: [{ id: 'environment-1', name: 'Homologação', group: 'API', variables: { baseUrl: 'https://api.example.test', token: 'secret-token' } }],
    history: [{ id: 'history-1', method: 'POST', route: '/token', body: '{"client":"test"}' }],
    settings: [{ key: 'activeEnvironmentId', value: 'environment-1' }]
  };
  const backup = createWorkspaceBackup(source, '2026-10-13T12:00:00.000Z');
  const restored = parseWorkspaceBackup(JSON.stringify(backup));

  assert.equal(backup.format, 'api-studio-workspace');
  assert.equal(backup.version, 1);
  assert.equal(restored.counts.collections, 1);
  assert.equal(restored.counts.environments, 1);
  assert.equal(restored.data.collections[0].folders[0].requests[0].params[0][1], '{{tenant}}');
  assert.equal(restored.data.collections[0].folders[0].requests[0].bearerToken, 'local-token');
  assert.equal(restored.data.environments[0].variables.token, 'secret-token');
  assert.equal(restored.data.history[0].body, '{"client":"test"}');
  assert.equal(restored.data.settings[0].value, 'environment-1');
});

test('workspace backup parser rejects unsupported versions, missing stores, and duplicate record keys', () => {
  const { parseWorkspaceBackup } = runnerLogic();
  const backup = {
    format: 'api-studio-workspace', version: 1, exportedAt: '2026-10-13T12:00:00.000Z',
    data: { history: [], collections: [{ id: 'c1' }], environments: [{ id: 'e1' }], settings: [] }
  };
  assert.throws(() => parseWorkspaceBackup(JSON.stringify({ ...backup, version: 2 })), /versão/i);
  assert.throws(() => parseWorkspaceBackup(JSON.stringify({ ...backup, data: { history: [], collections: [{ id: 'c1' }], environments: [{ id: 'e1' }] } })), /settings/i);
  assert.throws(() => parseWorkspaceBackup(JSON.stringify({ ...backup, data: { ...backup.data, collections: [{ id: 'c1' }, { id: 'c1' }] } })), /duplicad/i);
});

test('encrypted workspace backup hides data and restores the validated workspace', async () => {
  const { webcrypto } = require('node:crypto');
  const { createWorkspaceBackup, encryptWorkspaceBackup, decryptWorkspaceBackup } = runnerLogic();
  const marker = 'BACKUP_SECRET_SENTINEL_9f72';
  const backup = createWorkspaceBackup({
    collections: [{ id: 'collection-1', name: marker, requests: [], folders: [] }],
    environments: [{ id: 'environment-1', name: 'Local', variables: { token: marker } }],
    history: [{ id: 'history-1', method: 'POST', route: '/token', body: marker }],
    settings: [{ key: 'activeEnvironmentId', value: 'environment-1' }]
  }, '2026-10-14T12:00:00.000Z');

  const encrypted = await encryptWorkspaceBackup(JSON.stringify(backup), 'correct horse battery staple', webcrypto);
  const serialized = JSON.stringify(encrypted);
  const restored = await decryptWorkspaceBackup(serialized, 'correct horse battery staple', webcrypto);

  assert.equal(encrypted.format, 'api-studio-encrypted-workspace');
  assert.equal(encrypted.version, 1);
  assert.doesNotMatch(serialized, new RegExp(marker));
  assert.equal(restored.counts.collections, 1);
  assert.equal(restored.data.environments[0].variables.token, marker);
  assert.equal(restored.data.history[0].body, marker);
});

test('encrypted workspace backup rejects wrong passwords, tampering, and weak passphrases', async () => {
  const { webcrypto } = require('node:crypto');
  const { createWorkspaceBackup, encryptWorkspaceBackup, decryptWorkspaceBackup } = runnerLogic();
  const backup = createWorkspaceBackup({
    collections: [{ id: 'c1', name: 'Collection', requests: [], folders: [] }],
    environments: [{ id: 'e1', name: 'Local', variables: {} }], history: [], settings: []
  });

  await assert.rejects(encryptWorkspaceBackup(JSON.stringify(backup), 'short', webcrypto), /12 caracteres/i);
  await assert.rejects(encryptWorkspaceBackup(JSON.stringify(backup), 'correct horse battery staple', {}), /Criptografia segura indisponível/i);
  const envelope = await encryptWorkspaceBackup(JSON.stringify(backup), 'correct horse battery staple', webcrypto);
  await assert.rejects(decryptWorkspaceBackup(JSON.stringify(envelope), 'wrong password value', webcrypto), /incorreta|danificado/i);
  const tampered = { ...envelope, ciphertext: envelope.ciphertext.slice(0, -4) + 'AAAA' };
  await assert.rejects(decryptWorkspaceBackup(JSON.stringify(tampered), 'correct horse battery staple', webcrypto), /incorreta|danificado/i);
});

test('settings offer encrypted workspace backup and keep JSON restore available', () => {
  const html = fs.readFileSync(path.join(__dirname, 'wwwroot', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  assert.match(html, /id="export-encrypted-workspace"/);
  assert.match(html, /id="export-workspace"/);
  assert.match(html, /id="restore-workspace-file"[^>]*accept="\.json,\.apistudio-backup,application\/json"/);
  assert.match(app, /inputType:'password'/);
  assert.match(app, /decryptWorkspaceBackup\(serialized,passphrase\)/);
});

test('first request and token helper are system agnostic and configurable', () => {
  const html = fs.readFileSync(path.join(__dirname, 'wwwroot', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  const runner = fs.readFileSync(path.join(__dirname, 'wwwroot', 'runner-logic.js'), 'utf8');
  const program = fs.readFileSync(path.join(__dirname, 'Program.cs'), 'utf8');
  const readme = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8');
  const productSource = [html, app, runner, program, readme].join('\n');

  assert.match(html, /id="route"[^>]*>/);
  assert.match(html, /id="token-route"/);
  assert.match(html, /id="allow-insecure-http"/);
  assert.doesNotMatch(productSource, /192\.168\.15\.16|33333|\/api\/grupo|cod_emp|cod_grupo|autoriza-api/i);
  assert.doesNotMatch(html, /id="shortcut-get"/);
});

test('blank request draft stays blank when persisted instead of becoming the API root', () => {
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  assert.match(app, /rawRoute\s*\?\s*sanitizeRoute\(rawRoute\)\s*:\s*\{\s*value:\s*''\s*,\s*redacted:\s*false\s*\}/);
});

test('GitHub ignore rules exclude local databases, secrets, and .NET artifacts', () => {
  const gitignore = fs.readFileSync(path.join(__dirname, '.gitignore'), 'utf8');
  for (const rule of ['bin/', 'obj/', '*.sqlite', '*.db', '.env', 'appsettings.Local.json', 'secrets.json']) assert.ok(gitignore.includes(rule));
  assert.doesNotMatch(gitignore, /wwwroot\/fonts/);
});
