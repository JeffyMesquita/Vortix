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

function credentialedTestUrl(host = 'api.example.test') {
  return ['https://', 'user', ':', 'pass', '@', host].join('');
}

function validateOpenApiResponseSchema(schema, value) {
  const { validateOpenApiResponseContract } = runnerLogic();
  return validateOpenApiResponseContract({
    method: 'GET', pathTemplate: '/items', partialReasons: [],
    responses: { '200': { content: { 'application/json': { schema } } } }
  }, { status: 200, headers: [['Content-Type', 'application/json']], body: JSON.stringify(value) }, {
    method: 'GET', baseUrl: 'https://api.example.test', route: '/items'
  });
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

test('parses a quoted HTTPie GET without executing it and separates Bearer Auth', () => {
  const { parseHttpieCommand } = runnerLogic();
  const parsed = parseHttpieCommand('https GET api.example.test/v1/users search==Ana Accept:application/json Cache-Control:max-age=30 Authorization:"Bearer {{token}}"');
  assert.equal(parsed.method, 'GET');
  assert.equal(parsed.url, 'https://api.example.test/v1/users?search=Ana');
  assert.deepEqual(parsed.headers, [['Accept', 'application/json'], ['Cache-Control', 'max-age=30']]);
  assert.equal(parsed.bearerToken, '{{token}}');
  assert.equal(parsed.body, '');
});

test('parses HTTPie JSON and form fields into supported request bodies', () => {
  const { parseHttpieCommand } = runnerLogic();
  const json = parseHttpieCommand('http POST https://api.example.test/v1/users name=Ana age:=42 active:=true');
  assert.equal(json.method, 'POST');
  assert.deepEqual(JSON.parse(json.body), { name: 'Ana', age: 42, active: true });
  assert.deepEqual(json.headers, [['Content-Type', 'application/json'], ['Accept', 'application/json']]);
  const form = parseHttpieCommand('http --form POST https://api.example.test/v1/search term=hello');
  assert.equal(form.body, 'term=hello');
  assert.deepEqual(form.headers, [['Content-Type', 'application/x-www-form-urlencoded']]);
});

test('rejects HTTPie Basic Auth, sensitive fields, file references, and unsafe URLs without echoing values', () => {
  const { parseHttpieCommand } = runnerLogic();
  assert.equal(typeof parseHttpieCommand, 'function');
  for (const command of [
    'http --auth user:very-secret https://api.example.test',
    'http POST https://api.example.test token=very-secret',
    'http POST https://api.example.test file@private.json',
    'http https://user:very-secret@api.example.test/path'
  ]) assert.throws(() => parseHttpieCommand(command), error => {
    assert.doesNotMatch(error.message, /very-secret|private\.json/);
    return true;
  });
});

test('parses HTTPie --raw literal bodies in separate and inline forms without reading files', () => {
  const { parseHttpieCommand } = runnerLogic();
  const separate = parseHttpieCommand("http --raw 'Hello, world!' pie.dev/post");
  assert.deepEqual(separate, {
    method: 'POST',
    url: 'http://pie.dev/post',
    headers: [],
    body: 'Hello, world!',
    bearerToken: ''
  });

  const inline = parseHttpieCommand('http --raw="{\\"ok\\":true}" POST https://api.example.test/v1/check Content-Type:application/json');
  assert.deepEqual(inline, {
    method: 'POST',
    url: 'https://api.example.test/v1/check',
    headers: [['Content-Type', 'application/json']],
    body: '{"ok":true}',
    bearerToken: ''
  });

  const shellQuoted = parseHttpieCommand('http --raw={"ok":true} POST https://api.example.test/v1/check');
  assert.equal(shellQuoted.body, '{ok:true}');
});

test('parses HTTPie --raw @value as a literal body without reading files', () => {
  const { parseHttpieCommand } = runnerLogic();
  const separate = parseHttpieCommand("http --raw '@alice' pie.dev/post");
  assert.equal(separate.method, 'POST');
  assert.equal(separate.body, '@alice');

  const inline = parseHttpieCommand('http --raw=@alice pie.dev/post');
  assert.equal(inline.method, 'POST');
  assert.equal(inline.body, '@alice');

  assert.throws(() => parseHttpieCommand('http POST https://api.example.test @/tmp/body'), /arquivo/i);
  assert.throws(() => parseHttpieCommand('http POST https://api.example.test payload=@/tmp/body'), /arquivo/i);
});

test('rejects HTTPie --raw combined with fields or with bodyless methods', () => {
  const { parseHttpieCommand } = runnerLogic();
  assert.throws(() => parseHttpieCommand("http --raw 'x' POST https://api.example.test/v1/check name=Ana"), /--raw.*campo|campo.*--raw/i);
  assert.throws(() => parseHttpieCommand("http POST https://api.example.test/v1/check name=Ana --raw 'x'"), /--raw.*campo|campo.*--raw/i);
  assert.throws(() => parseHttpieCommand("http --raw 'x' --form POST https://api.example.test/v1/check"), /--raw.*--form|--form.*--raw/i);
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    assert.throws(() => parseHttpieCommand(`http ${method} --raw 'x' https://api.example.test/v1/check`), /body/i);
  }
});

test('command import dialog exposes the HTTPie parser option', () => {
  const html = fs.readFileSync(path.join(__dirname, 'wwwroot', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  assert.ok(html.includes('id="command-import-format"'));
  assert.ok(html.includes('<option value="httpie">HTTPie</option>'));
  assert.ok(app.includes('RunnerLogic.parseHttpieCommand'));
});

test('README documents safe HTTPie import syntax and limits', () => {
  const readme = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8');
  assert.ok(readme.includes('### Importar HTTPie'));
  assert.ok(readme.includes('page==1'));
  assert.ok(readme.includes('--form'));
  assert.ok(readme.includes('nunca executa o comando'));
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

test('splits imported routes while preserving Vortix templates in path and query values', () => {
  const { splitRoute } = runnerLogic();
  assert.deepEqual(splitRoute('/users/{{userId}}?expand={{expand}}&tag=active'), {
    route: '/users/{{userId}}',
    params: [['expand', '{{expand}}'], ['tag', 'active']]
  });
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

test('Runner detects base URLs produced by enabled pre-request actions for transport confirmation', () => {
  const { preRequestActionsAffectBaseUrl } = runnerLogic();
  assert.equal(preRequestActionsAffectBaseUrl({
    baseUrl: '{{apiOrigin}}', preRequestActions: [{ type: 'template', name: 'apiOrigin', value: 'http://api.example.test' }]
  }), true);
  assert.equal(preRequestActionsAffectBaseUrl({
    baseUrl: '{{apiOrigin}}', preRequestActionsEnabled: false, preRequestActions: [{ type: 'template', name: 'apiOrigin', value: 'http://api.example.test' }]
  }), false);
  assert.equal(preRequestActionsAffectBaseUrl({
    baseUrl: '{{baseUrl}}', preRequestActions: [{ type: 'uuid', name: 'request_id' }]
  }), false);
});

test('workspace exposes the Runner and its dataset/write safety controls', () => {
  const html = fs.readFileSync(path.join(__dirname, 'wwwroot', 'index.html'), 'utf8');
  assert.match(html, /id="run-collection"/);
  assert.match(html, /id="runner-dialog"/);
  assert.match(html, /id="runner-datasets"/);
  assert.match(html, /id="runner-write-phrase"/);
  assert.match(html, /id="runner-stop-on-error"/);
});

test('sidebar collection actions use vector icons and the tree overflow menu has a descriptive accessible name', () => {
  const html = fs.readFileSync(path.join(__dirname, 'wwwroot', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  const start = html.indexOf('<div class="collection-tools">'), end = html.indexOf('</div>', start);
  const toolbar = html.slice(start, end);
  assert.ok(start >= 0 && end > start);
  for (const id of ['import-collection', 'export-collection', 'run-collection', 'add-collection-heading']) {
    const button = toolbar.match(new RegExp(`<button[^>]*id="${id}"[^>]*>[\\s\\S]*?<\\/button>`))?.[0] || '';
    assert.match(button, /<svg[^>]*aria-hidden="true"/, `${id} should use a decorative SVG icon`);
  }
  assert.doesNotMatch(toolbar, /[⇩⇧▶＋]/);
  const rowStart = app.indexOf('function makeContainerRow('), rowEnd = app.indexOf('\nfunction appendSavedRequest', rowStart);
  assert.ok(rowStart >= 0 && rowEnd > rowStart);
  assert.match(app.slice(rowStart, rowEnd), /menu\.setAttribute\('aria-label',/);
});

test('response status announces updates and keeps the full status available', () => {
  const html = fs.readFileSync(path.join(__dirname, 'wwwroot', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  assert.match(html, /id="response-status"[^>]*role="status"[^>]*aria-live="polite">Aguardando<\/span>/);
  const start = app.indexOf('function showResponse('), end = app.indexOf('\nfunction ', start + 1);
  assert.ok(start >= 0 && end > start);
  assert.match(app.slice(start, end), /status\.title=statusText/);
});

test('sidebar hover feedback stays theme-colored without casting accent glows', () => {
  const css = fs.readFileSync(path.join(__dirname, 'wwwroot', 'style.css'), 'utf8');
  assert.doesNotMatch(css, /box-shadow:\s*0 2px 9px color-mix\(in srgb, var\(--accent\)/);
  assert.doesNotMatch(css, /box-shadow:\s*0 2px 8px color-mix\(in srgb, var\(--accent\)/);
});

test('Runner history is reachable, accessible, and wired to persistent workspace settings', () => {
  const html = fs.readFileSync(path.join(__dirname, 'wwwroot', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  const readme = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, 'wwwroot', 'style.css'), 'utf8');
  assert.match(html, /id="runner-history-heading"/);
  assert.match(html, /id="runner-history-list"[^>]*aria-label="Histórico de execuções"/);
  assert.doesNotMatch(html, /id="runner-history-list"[^>]*aria-live=/);
  assert.match(html, /id="clear-runner-history"/);
  assert.ok(app.includes("dbRead('settings','runnerHistory')"));
  assert.ok(app.includes("dbWrite('settings',{key:'runnerHistory',value:retained})"));
  assert.ok(app.includes('runnerBusy||runnerHistoryMutating||!safe.length'));
  assert.ok(app.includes('data-runner-history-delete'));
  assert.ok(css.includes('.runner-history-more'));
  assert.ok(readme.includes('### Histórico do Runner'));
});

test('Runner dialog cannot close while its history is loading or mutating', () => {
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  assert.match(app, /byId\('runner-dialog'\)\.addEventListener\('cancel',event=>\{if\(runnerBusy\|\|runnerHistoryMutating\)\{event\.preventDefault\(\);/);
});

test('Runner history announces a short summary outside its live list', () => {
  const { runnerHistoryAnnouncement, runnerHistoryCompatibilityWarning } = runnerLogic();
  const html = fs.readFileSync(path.join(__dirname, 'wwwroot', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  assert.equal(runnerHistoryAnnouncement(0), 'Nenhuma execução salva.');
  assert.equal(runnerHistoryAnnouncement(3), '3 execuções salvas.');
  assert.equal(runnerHistoryAnnouncement(0, 'Histórico local indisponível.'), 'Histórico local indisponível.');
  assert.equal(runnerHistoryCompatibilityWarning(true), '');
  assert.equal(runnerHistoryCompatibilityWarning(false), 'Este navegador não suporta bloqueio entre abas; edite o histórico em uma aba por vez.');
  assert.match(html, /id="runner-history-announcement"[^>]*class="visually-hidden"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.ok(app.includes("byId('runner-history-announcement').textContent=RunnerLogic.runnerHistoryAnnouncement(safe.length,visibleWarning)"));
  const noticeStart = app.indexOf('function runnerHistoryNotice(');
  const noticeEnd = app.indexOf('function renderRunnerHistory(', noticeStart);
  assert.ok(app.slice(noticeStart, noticeEnd).includes("setAttribute('role','note')"), 'visible notices do not duplicate the separate live announcement');
});

test('legacy Runner history IDs stay stable after normalization and are saved before display', () => {
  const { sanitizeRunnerHistoryValue } = runnerLogic();
  const legacy = [{ id: 'legacy-run-id', startedAt: '2026-10-20T12:00:00.000Z', steps: [] }];
  const migrated = sanitizeRunnerHistoryValue(legacy);
  const reloaded = sanitizeRunnerHistoryValue(migrated);
  assert.match(migrated[0].id, /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
  assert.equal(reloaded[0].id, migrated[0].id);

  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  const loadStart = app.indexOf('async function loadRunnerHistory(');
  const loadEnd = app.indexOf('async function withRunnerHistoryMutation(', loadStart);
  const load = app.slice(loadStart, loadEnd);
  assert.ok(load.includes('RunnerLogic.sanitizeRunnerHistoryValue'));
  assert.ok(load.indexOf("await dbWrite('settings',{key:'runnerHistory',value:normalized})") < load.indexOf('renderRunnerHistory(normalized)'), 'normalized IDs are persisted before they become delete-button IDs');
  assert.ok(load.includes("JSON.stringify(record??null)!==JSON.stringify({key:'runnerHistory',value:normalized})"), 'legacy sibling fields are removed from the persisted record');
});

test('Runner serializes history writes before enabling another execution', () => {
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  const start = app.indexOf('async function runRunnerCases(');
  const end = app.indexOf('async function startRunnerFromForm(', start);
  const run = app.slice(start, end);
  const saveIndex = run.indexOf('await saveRunnerRunHistory(');
  const unlockIndex = run.indexOf('runnerBusy=false', saveIndex);
  assert.ok(saveIndex >= 0 && unlockIndex > saveIndex, 'Runner controls stay locked until the persistent summary write settles');
});

test('Runner serializes delete and clear mutations against execution and each other', () => {
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  assert.match(app, /runnerHistoryMutating\s*=\s*false/);
  const removeStart = app.indexOf('async function removeRunnerHistoryEntry(');
  const clearStart = app.indexOf('async function clearRunnerHistory(', removeStart);
  const fitStart = app.indexOf('function showRunnerError(', clearStart);
  const remove = app.slice(removeStart, clearStart);
  const clear = app.slice(clearStart, fitStart);
  for (const mutation of [remove, clear]) {
    assert.ok(mutation.includes('withRunnerHistoryMutation('));
  }
  const lockStart = app.indexOf('async function withRunnerHistoryMutation(');
  const saveStart = app.indexOf('async function saveRunnerRunHistory(', lockStart);
  const lock = app.slice(lockStart, saveStart);
  assert.ok(lock.includes('runnerHistoryMutating=true'));
  assert.ok(lock.includes('finally{runnerHistoryMutating=false'));
  assert.ok(app.includes('if(runnerBusy||runnerHistoryMutating)return;'));
  assert.ok(app.includes("navigator.locks?.request('vortix-runner-history'"));
  assert.ok(app.includes('return await (lockTask??run());'));
});

test('Runner history makes every step reachable and delete buttons distinguish same-minute runs', () => {
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  assert.ok(app.includes('slice(60)'));
  assert.ok(app.includes('runner-history-more'));
  assert.ok(app.includes('historyIndex+1'));
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

test('normalizes ordered pre-request actions and rejects unsupported code', () => {
  const { normalizePreRequestActions } = runnerLogic();
  assert.deepEqual(normalizePreRequestActions([
    { type: 'uuid', name: 'request_id' },
    { type: 'timestamp', name: 'sent_at' },
    { type: 'template', name: 'derived', value: '{{request_id}}' }
  ]), [
    { type: 'uuid', name: 'request_id' },
    { type: 'timestamp', name: 'sent_at' },
    { type: 'template', name: 'derived', value: '{{request_id}}' }
  ]);
  assert.throws(() => normalizePreRequestActions([{ type: 'javascript', name: 'x', value: 'fetch("https://evil.example")' }]), /ação|tipo/i);
  assert.throws(() => normalizePreRequestActions([{ type: 'uuid', name: '__proto__' }]), /nome/i);
  assert.throws(() => normalizePreRequestActions(Array.from({ length: 11 }, (_, index) => ({ type: 'uuid', name: `id${index}` }))), /10/);
});

test('requires explicit consent for literal pre-request template text but allows variable composition', () => {
  const { preRequestActionHasLiteralText } = runnerLogic();
  assert.equal(preRequestActionHasLiteralText({ type: 'uuid', name: 'request_id' }), false);
  assert.equal(preRequestActionHasLiteralText({ type: 'template', name: 'request_label', value: '{{tenant}}-{{request_id}}' }), false);
  assert.equal(preRequestActionHasLiteralText({ type: 'template', name: 'request_label', value: 'orders-{{request_id}}' }), true);
  assert.equal(preRequestActionHasLiteralText({ type: 'template', name: 'auth_header', value: 'Bearer {{token}}' }), true);
  assert.equal(preRequestActionHasLiteralText({ type: 'template', name: 'punctuation', value: '!!!' }), true);
  assert.equal(preRequestActionHasLiteralText({ type: 'template', name: 'separator', value: '---' }), true);
});

test('persists literal pre-request template text only after explicit consent', () => {
  const { persistablePreRequestActions } = runnerLogic();
  const actions = [
    { type: 'uuid', name: 'request_id' },
    { type: 'template', name: 'request_label', value: '{{tenant}}-{{request_id}}' },
    { type: 'template', name: 'static_value', value: 'fixed-secret-123' }
  ];
  const safe = persistablePreRequestActions(actions);
  assert.deepEqual(safe.actions, actions.slice(0, 2));
  assert.equal(safe.redacted, true);
  const authorized = persistablePreRequestActions(actions, true);
  assert.deepEqual(authorized.actions, actions);
  assert.equal(authorized.redacted, false);
});

test('proxy payload excludes pre-request persistence consent and warns that generated URL previews can change', () => {
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  const start = app.indexOf('async function executeApiRequest(request){');
  const end = app.indexOf('\nasync function performApiRequest', start);
  assert.ok(start >= 0 && end > start);
  assert.match(app.slice(start, end), /delete proxyRequest\.preRequestActionsLiteralConsent/);
  assert.match(app, /UUIDs e timestamps são gerados novamente a cada execução/);
  assert.match(app, /A origem exibida é uma prévia e pode diferir do envio/);
  assert.match(app, /enabled:request\?\.preRequestActionsEnabled!==false&&safe\.actions\.length>0/);
});

test('executes pre-request actions in a temporary overlay with dataset, action, vault, and environment precedence', () => {
  const { runPreRequestActions } = runnerLogic();
  const environment = { actionName: 'environment-value', baseUrl: 'https://api.example.test' };
  const dataset = { shared: 'dataset-value', datasetOnly: 'dataset-only' };
  const vault = { vaultOnly: 'vault-value', shared: 'vault-value' };
  const result = runPreRequestActions([
    { type: 'template', name: 'actionName', value: 'action-value' },
    { type: 'template', name: 'derived', value: '{{actionName}}|{{shared}}|{{vaultOnly}}|{{baseUrl}}|{{datasetOnly}}' },
    { type: 'uuid', name: 'request_id' },
    { type: 'timestamp', name: 'sent_at' }
  ], environment, dataset, vault, { uuidFactory: () => 'uuid-fixed', now: '2026-10-20T12:00:00.000Z' });

  assert.deepEqual({ ...result.variables }, {
    actionName: 'action-value',
    derived: 'action-value|dataset-value|vault-value|https://api.example.test|dataset-only',
    request_id: 'uuid-fixed',
    sent_at: '2026-10-20T12:00:00.000Z'
  });
  assert.deepEqual({ ...result.provenance }, { actionName: 'pre-request', derived: 'vault', request_id: 'pre-request', sent_at: 'pre-request' });
  assert.deepEqual({ ...result.vaultSecrets }, { vaultOnly: 'vault-value' });
  assert.equal(environment.actionName, 'environment-value');
  assert.equal(Object.hasOwn(environment, 'request_id'), false);
  assert.equal(Object.hasOwn(dataset, 'request_id'), false);
  assert.throws(() => runPreRequestActions([
    { type: 'template', name: 'token', value: '{{secret}}' }
  ], {}, {}, { locked: true, names: ['secret'] }), /cofre.*bloqueado/i);
});

test('pre-request values resolve in saved requests without overriding datasets or persisting', () => {
  const { prepareSavedRequest, runPreRequestActions } = runnerLogic();
  const environment = { baseUrl: 'https://api.example.test', actionValue: 'old-environment-value', token: 'old-token' };
  const dataset = { tenant: 'dataset-tenant', shared: 'dataset-shared' };
  const vault = { actionValue: 'vault-value', token: 'vault-token' };
  const temporary = runPreRequestActions([
    { type: 'template', name: 'actionValue', value: 'fresh-action-value' },
    { type: 'template', name: 'tenant', value: 'action-tenant' },
    { type: 'template', name: 'requestId', value: 'id-{{tenant}}' }
  ], environment, dataset, vault);
  const request = prepareSavedRequest({
    method: 'GET', baseUrl: '{{baseUrl}}', route: '/tenants/{{tenant}}/requests/{{requestId}}',
    headers: 'X-Action: {{actionValue}}\nX-Token: {{token}}\nX-Shared: {{shared}}'
  }, environment, dataset, false, [], vault, temporary.variables);

  assert.equal(request.route, '/tenants/dataset-tenant/requests/id-dataset-tenant');
  assert.equal(request.headers, 'X-Action: fresh-action-value\nX-Token: vault-token\nX-Shared: dataset-shared');
  assert.equal(request.resolutionProvenance.actionValue, 'pre-request');
  assert.equal(request.resolutionProvenance.tenant, 'dataset');
  assert.equal(environment.actionValue, 'old-environment-value');
  assert.equal(environment.tenant, undefined);
  assert.equal(dataset.tenant, 'dataset-tenant');
});

test('pre-request actions retain vault-secret redaction across derived values', () => {
  const { runPreRequestActions } = runnerLogic();
  const result = runPreRequestActions([
    { type: 'template', name: 'derived', value: 'Bearer {{secret}}' },
    { type: 'template', name: 'nested', value: '{{derived}} / retry' }
  ], {}, {}, { secret: 'VAULT_CANARY' });
  assert.equal(result.provenance.derived, 'vault');
  assert.equal(result.provenance.nested, 'vault');
  assert.deepEqual({ ...result.vaultSecrets }, { secret: 'VAULT_CANARY' });
});

test('pre-request scripts export supported actions and only import unchanged Vortix scripts', () => {
  const { buildPreRequestScript, parsePreRequestScript } = runnerLogic();
  const actions = [
    { type: 'uuid', name: 'request_id' },
    { type: 'timestamp', name: 'requested_at' },
    { type: 'template', name: 'request_label', value: 'id={{request_id}} {{tenant}}' }
  ];
  for (const runtime of ['insomnia', 'postman']) {
    const script = buildPreRequestScript(actions, runtime);
    assert.deepEqual(parsePreRequestScript(script, runtime), actions);
    assert.equal(parsePreRequestScript(script + '\nconsole.log("edited")', runtime), null);
    assert.equal(parsePreRequestScript('console.log("untrusted")', runtime), null);
  }
});

test('request lifecycle actions are editable and persist across tabs, history, and collection exports', () => {
  const html = fs.readFileSync(path.join(__dirname, 'wwwroot', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  assert.match(html, /id="pre-request-actions"/);
  assert.match(html, /id="add-pre-request-action"/);
  assert.match(html, /id="pre-request-literal-consent"/);
  assert.match(html, /Dica: usar um ID no caminho e em um header/);
  assert.match(app, /function getPreRequestActionsFromForm\(/);
  assert.match(app, /preRequestActions:getPreRequestActionsFromForm\(\)/);
  assert.match(app, /renderPreRequestActions\(draft\.preRequestActions\|\|\[\]\)/);
  assert.match(app, /renderPreRequestActions\(request\.preRequestActions\|\|\[\]\)/);
  assert.match(app, /function exportPreRequestActions\(request,allowLiteralTemplates\)/);
  assert.match(app, /exportPreRequestActions\(request,request\.preRequestActionsLiteralConsent===true\)/);
  assert.match(app, /preRequestActionsLiteralConsent:byId\('pre-request-literal-consent'\)\.checked/);
  assert.match(app, /RunnerLogic\.preRequestActionHasLiteralText/);
  assert.match(app, /preRequestActions:preRequest\.actions/);
  assert.match(app, /preRequestActions:preRequest\.actions,preRequestActionsEnabled:preRequest\.enabled/);
  const exportStart = app.indexOf('function exportCollectionNode('), exportEnd = app.indexOf('\nfunction responseCaptureInsomniaScript(', exportStart);
  assert.match(app.slice(exportStart, exportEnd), /preRequestActions:preRequest\.actions,preRequestActionsEnabled:preRequest\.enabled/);
  const historyStart = app.indexOf('async function saveHistory('), historyEnd = app.indexOf('\nfunction applyHistoryEntry(', historyStart);
  assert.match(app.slice(historyStart, historyEnd), /preRequestActions:preRequest\.actions,preRequestActionsEnabled:preRequest\.enabled/);
  assert.match(app, /RunnerLogic\.buildPreRequestScript\(preActions\.actions,'insomnia'\)/);
  assert.match(app, /RunnerLogic\.buildPreRequestScript\(preActions\.actions,'postman'\)/);
  assert.match(app, /RunnerLogic\.parsePreRequestScript\(preScript,'insomnia'\)/);
  assert.match(app, /RunnerLogic\.parsePreRequestScript\(preScript,'postman'\)/);
  assert.match(app, /RunnerLogic\.preRequestActionsAffectBaseUrl\(item\.request\)/);
  assert.match(app, /__VORTIX_PRE_REQUEST_/);
});

test('manual and Runner requests execute pre-request actions before resolving request templates', () => {
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  const manualStart = app.indexOf('async function sendCurrentRequest(');
  const manualEnd = app.indexOf('\nasync function requestOAuthClientCredentialsToken(', manualStart);
  const manual = app.slice(manualStart, manualEnd);
  assert.ok(manual.indexOf('RunnerLogic.runPreRequestActions(') >= 0);
  assert.ok(manual.indexOf('RunnerLogic.runPreRequestActions(') < manual.indexOf('requestFromForm('));
  assert.match(app, /async function runRunnerCases\([\s\S]*?RunnerLogic\.runPreRequestActions\([\s\S]*?RunnerLogic\.prepareSavedRequest\(/);
  assert.match(app, /function applyEnvironment\(value,preRequestOverrides=\{\}\)/);
  assert.match(app, /function previewRunnerDynamicBaseUrl\(/);
  assert.match(app, /RunnerLogic\.remoteHttpOrigin\(request\.baseUrl\)&&request\.allowInsecureHttp!==true/);
  assert.match(app, /delete proxyRequest\.preRequestActions/);
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

test('quick search filters by method, saved response status, and descendant folder with an empty query', () => {
  const { searchRequests } = runnerLogic();
  const collection = {
    id: 'orders', name: 'Orders',
    requests: [{ id: 'root-200', name: 'List', method: 'GET', route: '/orders', responseExamples: [{ status: 200 }] }],
    folders: [{ id: 'read-folder', name: 'Read', requests: [
      { id: 'read-404', name: 'Missing', method: 'GET', route: '/orders/missing', responseExamples: [{ status: 404 }] },
      { id: 'create-201', name: 'Create', method: 'POST', route: '/orders', responseExamples: [{ status: 201 }] }
    ], folders: [{ id: 'nested-folder', name: 'Nested', requests: [
      { id: 'nested-404', name: 'Nested missing', method: 'GET', route: '/orders/nested/missing', responseExamples: [{ status: 404 }] }
    ], folders: [] }] }]
  };
  const filtered = searchRequests([collection], '', 30, { method: 'GET', status: '404', collectionId: 'orders', folderId: 'read-folder' });
  assert.deepEqual(filtered.map(item => item.request.id), ['read-404', 'nested-404']);
  const create = searchRequests([collection], '', 30, { method: 'POST', status: '201', collectionId: 'orders', folderId: 'read-folder' });
  assert.deepEqual(create.map(item => item.request.id), ['create-201']);
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
test('README documents quick search filters and keyboard controls', () => {
  const readme = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8');
  assert.ok(readme.includes('## Busca rápida'));
  assert.ok(readme.includes('Ctrl+K'));
  assert.ok(readme.includes('status salvo'));
  assert.ok(readme.includes('subpastas'));
});

test('response history defaults to metadata and filters sensitive headers before optional body capture', () => {
  const { normalizeHistorySettings, createResponseHistorySnapshot } = runnerLogic();
  assert.deepEqual(normalizeHistorySettings(), { limit: 500, saveResponseBody: false });
  const result = { status: 201, reason: 'Created', headers: {
    'Content-Type': ['application/json'], 'X-Trace': ['trace-1'],
    Authorization: ['Bearer hidden'], 'X-Auth': ['hidden'], 'Set-Cookie': ['session=hidden'], 'X-Api-Key': ['hidden'], 'X-Private-Key': ['hidden']
  }, body: '{"id":42}' };
  const metadata = createResponseHistorySnapshot(result, 17.6, normalizeHistorySettings());
  assert.deepEqual(metadata, { status: 201, reason: 'Created', durationMs: 18, headers: {
    'Content-Type': ['application/json'], 'X-Trace': ['trace-1']
  }, bodySaved: false });
  const optedIn = createResponseHistorySnapshot(result, 17.6, normalizeHistorySettings({ limit: 250, saveResponseBody: true }));
  assert.equal(optedIn.body, '{"id":42}');
  assert.equal(optedIn.bodySaved, true);
});

test('history never saves token response bodies even when body saving is enabled', () => {
  const { normalizeHistorySettings, createResponseHistorySnapshot } = runnerLogic();
  const result = { status: 200, reason: 'OK', headers: {}, body: '{"access_token":"secret-token"}' };
  const settings = { ...normalizeHistorySettings({ limit: 250, saveResponseBody: true }), tokenRequest: true };
  const snapshot = createResponseHistorySnapshot(result, 12, settings);
  assert.equal(snapshot.bodySaved, false);
  assert.equal(Object.hasOwn(snapshot, 'body'), false);
});

test('history retention keeps the newest entries within the configured limit', () => {
  const { retainNewestHistoryEntries } = runnerLogic();
  const entries = [
    { id: 'old', savedAt: '2026-01-01T00:00:00Z' },
    { id: 'newest', savedAt: '2026-03-01T00:00:00Z' },
    { id: 'middle', savedAt: '2026-02-01T00:00:00Z' }
  ];
  assert.deepEqual(retainNewestHistoryEntries(entries, 2).map(entry => entry.id), ['newest', 'middle']);
  assert.equal(entries.length, 3, 'retention must not mutate the source array');
});

// Runner history contract:
// createRunnerHistorySnapshot(run) returns only { id, startedAt, durationMs, total, passed, failed,
// skipped, stopped, steps }, and each step only { ordinal, outcome, status, durationMs, testsPassed,
// testsFailed }. Arbitrary run/step fields and marker secrets are never copied.
// retainNewestRunnerHistoryEntries(entries, limit) returns at most `limit` entries ordered by
// startedAt descending, stable on ties/invalid dates, without mutating the source array.
// Workspace backups sanitize the `runnerHistory` settings record with the same allowlist.
test('Runner history snapshot keeps only allowlisted run and step metadata', () => {
  const { createRunnerHistorySnapshot } = runnerLogic();
  assert.equal(typeof createRunnerHistorySnapshot, 'function', 'createRunnerHistorySnapshot should be a pure exported helper');
  const marker = 'RUNNER_HISTORY_SECRET_SENTINEL_7d3f';
  const run = {
    id: '  11111111-1111-4111-8111-111111111111  ',
    startedAt: '2026-10-20T12:00:00.000Z',
    durationMs: 123.6,
    total: 3,
    passed: 1,
    failed: 1,
    skipped: 1,
    stopped: true,
    url: 'https://api.example.test/private?token=' + marker,
    requestLabel: 'POST /private ' + marker,
    error: 'failed because ' + marker,
    body: '{"token":"' + marker + '"}',
    headers: { Authorization: 'Bearer ' + marker },
    dataset: { id: marker },
    token: marker,
    steps: [
      {
        ordinal: 1, outcome: 'passed', status: 201, durationMs: 12.4,
        tests: { passed: 2, failed: 0 },
        url: 'https://api.example.test/step/1?token=' + marker,
        requestLabel: 'step one ' + marker, error: marker, body: marker,
        headers: { 'X-Secret': marker }, dataset: { secret: marker }
      },
      {
        ordinal: '2', outcome: 'failed', status: '500', durationMs: '9.6',
        tests: { passed: '1', failed: '2' },
        error: marker
      },
      {
        ordinal: 3, outcome: 'skipped', status: 0, durationMs: -5,
        tests: { passed: 0, failed: 0 }, dataset: marker
      }
    ]
  };

  const snapshot = createRunnerHistorySnapshot(run);

  assert.deepEqual(snapshot, {
    id: '11111111-1111-4111-8111-111111111111',
    startedAt: '2026-10-20T12:00:00.000Z',
    durationMs: 124,
    total: 3,
    passed: 1,
    failed: 1,
    skipped: 1,
    stopped: true,
    steps: [
      { ordinal: 1, outcome: 'passed', status: 201, durationMs: 12, testsPassed: 2, testsFailed: 0 },
      { ordinal: 2, outcome: 'failed', status: 500, durationMs: 10, testsPassed: 1, testsFailed: 2 },
      { ordinal: 3, outcome: 'skipped', status: null, durationMs: 0, testsPassed: 0, testsFailed: 0 }
    ]
  }, 'the snapshot is a strict allowlist, not a copy of the run');
  assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(marker), 'snapshot must never retain arbitrary fields or marker secrets');
});

test('Runner history preserves partial contract outcomes without counting them as pass or failure', () => {
  const { createRunnerHistorySnapshot } = runnerLogic();
  const snapshot = createRunnerHistorySnapshot({
    id: '44444444-4444-4444-8444-444444444444',
    startedAt: '2026-10-22T12:00:00.000Z',
    total: 1, passed: 0, failed: 0, partial: 1, skipped: 0,
    steps: [{ outcome: 'partial', status: 200, durationMs: 5, tests: { passed: 0, failed: 0, partial: 1 } }]
  });

  assert.equal(snapshot.partial, 1);
  assert.equal(snapshot.passed, 0);
  assert.equal(snapshot.failed, 0);
  assert.equal(snapshot.steps[0].outcome, 'partial');
  assert.equal(snapshot.steps[0].testsPartial, 1);
});

test('Runner history replaces IDs that could carry credential text', () => {
  const { createRunnerHistorySnapshot } = runnerLogic();
  const marker = 'BearerToken1234567890AB';
  const snapshot = createRunnerHistorySnapshot({ id: marker, steps: [] });
  assert.notEqual(snapshot.id, marker);
  assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(marker));
});

test('Runner history snapshot fails closed on missing runs and sanitizes malformed steps', () => {
  const { createRunnerHistorySnapshot } = runnerLogic();
  const marker = 'MALFORMED_RUNNER_SECRET_SENTINEL_2c8a';
  assert.throws(() => createRunnerHistorySnapshot(null), error => {
    assert.match(error.message, /execu|hist[óo]rico|run/i);
    assert.doesNotMatch(error.message, new RegExp(marker));
    return true;
  });

  const snapshot = createRunnerHistorySnapshot({
    id: '22222222-2222-4222-8222-222222222222',
    durationMs: 'NaN',
    total: -4,
    passed: '2',
    failed: null,
    skipped: undefined,
    stopped: 'true',
    error: marker,
    steps: [
      null,
      { ordinal: 'bad', outcome: 'unknown', status: 'not-a-status', durationMs: -1, tests: { passed: -3, failed: '5' }, error: marker },
      { ordinal: 3, outcome: 'passed', status: 204, durationMs: 2.2, tests: null, body: marker }
    ]
  });

  assert.deepEqual(snapshot, {
    id: '22222222-2222-4222-8222-222222222222',
    startedAt: '',
    durationMs: 0,
    total: 0,
    passed: 2,
    failed: 0,
    skipped: 0,
    stopped: false,
    steps: [
      { ordinal: 1, outcome: 'skipped', status: null, durationMs: 0, testsPassed: 0, testsFailed: 0 },
      { ordinal: 2, outcome: 'skipped', status: null, durationMs: 0, testsPassed: 0, testsFailed: 5 },
      { ordinal: 3, outcome: 'passed', status: 204, durationMs: 2, testsPassed: 0, testsFailed: 0 }
    ]
  });
  assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(marker));

  assert.deepEqual(createRunnerHistorySnapshot({ id: '33333333-3333-4333-8333-333333333333', steps: 'not-an-array' }), {
    id: '33333333-3333-4333-8333-333333333333', startedAt: '', durationMs: 0, total: 0, passed: 0, failed: 0, skipped: 0, stopped: false, steps: []
  });
});

test('Runner history numeric fields stay within executable request and test limits', () => {
  const { createRunnerHistorySnapshot } = runnerLogic();
  const snapshot = createRunnerHistorySnapshot({
    id: '44444444-4444-4444-8444-444444444444',
    durationMs: Number.MAX_VALUE,
    total: 9000,
    passed: 9000,
    failed: -1,
    skipped: '9000',
    steps: [{
      ordinal: 90000,
      outcome: 'passed',
      status: 200,
      durationMs: Number.MAX_VALUE,
      tests: { passed: 9000, failed: 9000 }
    }]
  });
  assert.deepEqual([snapshot.durationMs, snapshot.total, snapshot.passed, snapshot.failed, snapshot.skipped], [86_400_000, 500, 500, 0, 500]);
  assert.deepEqual(snapshot.steps[0], { ordinal: 1, outcome: 'passed', status: 200, durationMs: 86_400_000, testsPassed: 20, testsFailed: 20 });
});

test('Runner history retention keeps the newest bounded entries without mutating the source', () => {
  const { retainNewestRunnerHistoryEntries } = runnerLogic();
  assert.equal(typeof retainNewestRunnerHistoryEntries, 'function', 'retainNewestRunnerHistoryEntries should be a pure exported helper');
  const entries = [
    { id: 'old', startedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'newest', startedAt: '2026-03-01T00:00:00.000Z' },
    { id: 'middle', startedAt: '2026-02-01T00:00:00.000Z' },
    { id: 'invalid', startedAt: 'not-a-date' },
    { id: 'missing' }
  ];
  const originalOrder = entries.map(entry => entry.id);

  const retained = retainNewestRunnerHistoryEntries(entries, 2);
  assert.deepEqual(retained.map(entry => entry.id), ['newest', 'middle']);
  assert.equal(entries.length, 5, 'retention must not mutate the source array');
  assert.deepEqual(entries.map(entry => entry.id), originalOrder, 'retention must preserve the source order');
  assert.deepEqual(retainNewestRunnerHistoryEntries(entries, 4).map(entry => entry.id), ['newest', 'middle', 'old', 'invalid'], 'invalid dates sort after valid ones and keep source order');
  assert.deepEqual(retainNewestRunnerHistoryEntries(null, 3), []);
  assert.deepEqual(retainNewestRunnerHistoryEntries([{ id: 'first', startedAt: '2026-01-01T00:00:00.000Z' }, { id: 'second', startedAt: '2026-01-01T00:00:00.000Z' }], 1).map(entry => entry.id), ['first'], 'ties keep the original order');
});

test('Runner history stays below the local SQLite request-size limit for maximum-sized runs', () => {
  const { createRunnerHistorySnapshot, retainNewestRunnerHistoryEntries, runnerHistoryStorageLimitBytes } = runnerLogic();
  const template = createRunnerHistorySnapshot({
    id: '99999999-9999-4999-8999-999999999999', startedAt: '2026-01-01T00:00:00.000Z', durationMs: 86_400_000,
    total: 500, passed: 0, failed: 0, skipped: 500, stopped: true,
    steps: Array.from({ length: 500 }, (_, index) => ({ ordinal: index + 1, outcome: 'skipped', status: 599, durationMs: 86_400_000, tests: { passed: 20, failed: 20 } }))
  });
  const entries = Array.from({ length: 30 }, (_, index) => ({
    ...template,
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    startedAt: new Date(Date.UTC(2026, 0, 30 - index)).toISOString()
  }));
  const retained = retainNewestRunnerHistoryEntries(entries, 30);
  assert.ok(retained.length < 30, 'large runs should evict older snapshots before the local request limit');
  assert.ok(Buffer.byteLength(JSON.stringify({ key: 'runnerHistory', value: retained }), 'utf8') <= runnerHistoryStorageLimitBytes);
  assert.equal(retained[0].id, entries[0].id);
});

test('workspace backup sanitizes runner history settings records to the snapshot allowlist', () => {
  const { createWorkspaceBackup, parseWorkspaceBackup } = runnerLogic();
  const marker = 'RUNNER_BACKUP_SECRET_SENTINEL_51c9';
  const run = {
    id: '55555555-5555-4555-8555-555555555555',
    startedAt: '2026-10-20T12:00:00.000Z',
    durationMs: 40,
    total: 1,
    passed: 1,
    failed: 0,
    skipped: 0,
    stopped: false,
    url: 'https://api.example.test/private?token=' + marker,
    requestLabel: 'POST ' + marker,
    error: marker,
    body: '{"token":"' + marker + '"}',
    headers: { Authorization: 'Bearer ' + marker },
    dataset: { token: marker },
    steps: [{
      ordinal: 1, outcome: 'passed', status: 200, durationMs: 40,
      tests: { passed: 1, failed: 0 },
      url: marker, requestLabel: marker, error: marker, body: marker,
      headers: { Authorization: marker }, dataset: { token: marker }
    }]
  };
  const expected = {
    id: '55555555-5555-4555-8555-555555555555',
    startedAt: '2026-10-20T12:00:00.000Z',
    durationMs: 40,
    total: 1,
    passed: 1,
    failed: 0,
    skipped: 0,
    stopped: false,
    steps: [{ ordinal: 1, outcome: 'passed', status: 200, durationMs: 40, testsPassed: 1, testsFailed: 0 }]
  };
  const source = {
    collections: [{ id: 'collection-1', name: 'API', requests: [], folders: [] }],
    environments: [{ id: 'environment-1', name: 'Local', variables: {} }],
    history: [],
    settings: [
      { key: 'activeEnvironmentId', value: 'environment-1' },
      { key: 'runnerHistory', value: [run], importedMetadata: marker }
    ]
  };

  const backup = createWorkspaceBackup(source, '2026-10-20T12:00:00.000Z');
  const runnerHistory = backup.data.settings.find(record => record.key === 'runnerHistory');
  assert.ok(runnerHistory, 'backup should keep the runner history settings record');
  assert.deepEqual(runnerHistory, { key: 'runnerHistory', value: [expected] }, 'backup must discard unknown settings-record fields');
  assert.deepEqual(runnerHistory.value, [expected], 'backup runner history must contain only sanitized snapshot fields');
  assert.doesNotMatch(JSON.stringify(backup), new RegExp(marker), 'backup must not leak runner URLs, labels, errors, bodies, headers, datasets, or secrets');
  for (const forbidden of ['url', 'requestLabel', 'error', 'body', 'headers', 'dataset']) {
    assert.equal(JSON.stringify(runnerHistory).includes('"' + forbidden + '"'), false, 'backup runner history must not retain ' + forbidden);
  }
  const restored = parseWorkspaceBackup(JSON.stringify(backup));
  assert.deepEqual(restored.data.settings.find(record => record.key === 'runnerHistory').value, [expected]);
});

test('workspace backups omit legacy literal pre-request templates without consent but preserve explicitly authorized ones', () => {
  const { createWorkspaceBackup, parseWorkspaceBackup } = runnerLogic();
  const legacyLiteral = 'LEGACY_TEMPLATE_SECRET_SENTINEL_7d3a';
  const literalAction = { type: 'template', name: 'request_label', value: legacyLiteral };
  const authorizedAction = { type: 'template', name: 'request_label', value: 'AUTHORIZED_TEMPLATE_SENTINEL_9b22' };
  const safeAction = { type: 'uuid', name: 'request_id' };
  const oldRequest = { id: 'request-old', preRequestActions: [safeAction, literalAction], preRequestActionsEnabled: true };
  const authorizedRequest = { id: 'request-authorized', preRequestActions: [authorizedAction], preRequestActionsEnabled: true, preRequestActionsLiteralConsent: true };
  const source = {
    collections: [{ id: 'collection-1', name: 'API', requests: [oldRequest, authorizedRequest], folders: [{ id: 'folder-1', name: 'Nested', requests: [oldRequest], folders: [] }] }],
    environments: [{ id: 'environment-1', name: 'Local', variables: {} }],
    history: [{ id: 'history-1', preRequestActions: [literalAction], preRequestActionsEnabled: true }],
    settings: [{ key: 'workspaceTabs', value: { activeId: 'tab-1', tabs: [{ id: 'tab-1', request: oldRequest }] } }]
  };

  const backup = createWorkspaceBackup(source);
  assert.doesNotMatch(JSON.stringify(backup), new RegExp(legacyLiteral));
  assert.deepEqual(backup.data.collections[0].requests[0].preRequestActions, [safeAction]);
  assert.equal(backup.data.collections[0].requests[0].preRequestActionsEnabled, true);
  assert.deepEqual(backup.data.collections[0].requests[1].preRequestActions, [authorizedAction]);
  assert.deepEqual(backup.data.collections[0].folders[0].requests[0].preRequestActions, [safeAction]);
  assert.deepEqual(backup.data.history[0].preRequestActions, []);
  assert.deepEqual(backup.data.settings[0].value.tabs[0].request.preRequestActions, [safeAction]);

  const importedLegacy = JSON.parse(JSON.stringify(backup));
  importedLegacy.data.history[0].preRequestActions = [literalAction];
  delete importedLegacy.data.history[0].preRequestActionsLiteralConsent;
  const restored = parseWorkspaceBackup(JSON.stringify(importedLegacy));
  assert.deepEqual(restored.data.history[0].preRequestActions, []);
  assert.doesNotMatch(JSON.stringify(restored.data), new RegExp(legacyLiteral));
});

test('workspace backup retains only the newest bounded Runner history entries', () => {
  const { createWorkspaceBackup } = runnerLogic();
  const runs = Array.from({ length: 35 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    startedAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    durationMs: index,
    total: 1,
    passed: 1,
    failed: 0,
    skipped: 0,
    stopped: false,
    steps: []
  }));
  const backup = createWorkspaceBackup({
    collections: [{ id: 'collection-1', name: 'API', requests: [], folders: [] }],
    environments: [{ id: 'environment-1', name: 'Local', variables: {} }],
    history: [],
    settings: [{ key: 'runnerHistory', value: runs }]
  });
  const retained = backup.data.settings[0].value;
  assert.equal(retained.length, 30);
  assert.equal(retained[0].id, '00000000-0000-4000-8000-000000000034');
  assert.equal(retained.at(-1).id, '00000000-0000-4000-8000-000000000005');
});

test('dialogs account for global zoom when fitting within the viewport', () => {
  const css = fs.readFileSync(path.join(__dirname, 'wwwroot', 'style.css'), 'utf8');
  assert.ok(css.includes('max-height: min(820px, calc(100dvh / var(--ui-scale, 1) - 32px));'), 'dialog height must account for global UI zoom');
});

test('history settings expose a retention limit and opt-in response bodies', () => {
  const html = fs.readFileSync(path.join(__dirname, 'wwwroot', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  assert.match(html, /id="history-retention-limit"/);
  assert.match(html, /id="history-save-response-body"/);
  assert.match(html, /Bodies de resposta ficam desativados por padrão/);
  assert.ok(app.includes("key:'historyPreferences'"));
  assert.ok(app.includes('/api/storage/history/trim'));
  assert.ok(app.includes('RunnerLogic.createResponseHistorySnapshot'));
});

test('history response entries can reopen a saved response in the response viewer', () => {
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  assert.ok(app.includes('showHistoryResponse'));
  assert.ok(app.includes('history-response-status'));
  assert.ok(app.includes('Resposta restaurada do histórico'));
  assert.ok(app.includes("entry.tokenRequest?'Body de resposta de token removido por segurança.'"));
});

test('restored history response keeps its full HTTP status in the status tooltip', () => {
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  const start = app.indexOf('function showHistoryResponse('), end = app.indexOf('\nasync function renderHistory', start);
  assert.ok(start >= 0 && end > start);
  assert.match(app.slice(start, end), /byId\('response-status'\)\.title=.*statusText/);
});

test('README documents response history retention, privacy, and token exclusions', () => {
  const readme = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8');
  assert.ok(readme.includes('## Histórico de respostas'));
  assert.ok(readme.includes('500 requests'));
  assert.match(readme, /token.*nunca.*guardados/);
  assert.ok(readme.includes('HistoryRetention.test.ps1'));
});

test('response footer distinguishes temporary, saved, and restored responses', () => {
  const html = fs.readFileSync(path.join(__dirname, 'wwwroot', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  assert.ok(html.includes('id="response-persistence-note"'));
  assert.ok(app.includes('Resposta salva no histórico'));
  assert.ok(app.includes('Resposta recuperada do histórico'));
});

test('compares response history status, duration, headers, and opt-in bodies safely', () => {
  const { compareHistoryResponses } = runnerLogic();
  const left = { id: 'left', method: 'GET', route: '/items', response: { status: 200, reason: 'OK', durationMs: 90, headers: { 'Content-Type': ['application/json'], 'X-Version': ['1'], Authorization: ['Bearer left-secret'] }, bodySaved: true, body: '{"id":1}' } };
  const right = { id: 'right', method: 'GET', route: '/items', response: { status: 201, reason: 'Created', durationMs: 40, headers: { 'content-type': ['application/json'], 'X-Version': ['2'], Authorization: ['Bearer right-secret'] }, bodySaved: true, body: '{"id":2}' } };
  const result = compareHistoryResponses(left, right);
  assert.equal(result.statusChanged, true);
  assert.equal(result.durationDeltaMs, -50);
  assert.deepEqual(result.headerChanges, [{ name: 'X-Version', left: ['1'], right: ['2'] }]);
  assert.equal(result.bodyComparable, true);
  assert.equal(result.bodyChanged, true);
  assert.doesNotMatch(JSON.stringify(result), /left-secret|right-secret/);
  const token = compareHistoryResponses({ ...left, tokenRequest: true }, right);
  assert.equal(token.bodyComparable, false);
  assert.equal(token.left.body, '');
});

test('history exposes an accessible response comparison dialog', () => {
  const html = fs.readFileSync(path.join(__dirname, 'wwwroot', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  assert.ok(html.includes('id="compare-history-responses"'));
  assert.ok(html.includes('id="history-compare-dialog"'));
  assert.ok(app.includes('RunnerLogic.compareHistoryResponses'));
  assert.ok(app.includes('openHistoryComparison'));
});

test('README explains how to compare two response history entries', () => {
  const readme = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8');
  assert.ok(readme.includes('Comparar respostas'));
  assert.ok(readme.includes('Marque duas respostas'));
  assert.ok(readme.includes('duração'));
  assert.ok(readme.includes('body não foi guardado'));
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

test('workspace tabs preserve pre-request actions and their disabled state', () => {
  const { normalizeWorkspaceTabs } = runnerLogic();
  const state = normalizeWorkspaceTabs({ activeId: 'tab', tabs: [{ id: 'tab', request: {
    method: 'GET', preRequestActions: [{ type: 'uuid', name: 'request_id' }], preRequestActionsEnabled: false, preRequestActionsLiteralConsent: true
  } }] });
  assert.deepEqual(state.tabs[0].request.preRequestActions, [{ type: 'uuid', name: 'request_id' }]);
  assert.equal(state.tabs[0].request.preRequestActionsEnabled, false);
  assert.equal(state.tabs[0].request.preRequestActionsLiteralConsent, true);
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
test('Runner resolves Basic and API Key credentials from environment variables', () => {
  const { prepareSavedRequest } = runnerLogic();
  const basic = prepareSavedRequest({ method: 'GET', route: '/profile', authType: 'basic', basicUsername: '{{username}}', basicPassword: '{{password}}' }, { username: 'alice', password: 'p@ss' }, {}, true);
  assert.deepEqual({ authType: basic.authType, basicUsername: basic.basicUsername, basicPassword: basic.basicPassword }, { authType: 'basic', basicUsername: 'alice', basicPassword: 'p@ss' });
  const apiKey = prepareSavedRequest({ method: 'GET', route: '/profile', authType: 'apiKey', apiKeyName: 'X-API-Key', apiKeyLocation: 'header', apiKeyValue: '{{key}}' }, { key: 'key-canary' }, {}, true);
  assert.deepEqual({ authType: apiKey.authType, apiKeyName: apiKey.apiKeyName, apiKeyLocation: apiKey.apiKeyLocation, apiKeyValue: apiKey.apiKeyValue }, { authType: 'apiKey', apiKeyName: 'X-API-Key', apiKeyLocation: 'header', apiKeyValue: 'key-canary' });
});

test('workspace tabs omit all auth credentials when local credential saving is disabled', () => {
  const { normalizeWorkspaceTabs } = runnerLogic();
  const state = normalizeWorkspaceTabs({ tabs: [
    { id: 'private', title: 'Private', saveBearerToken: false, request: { method: 'GET', authType: 'basic', basicUsername: 'alice', basicPassword: 'pass-canary', apiKeyName: 'X-API-Key', apiKeyValue: 'key-canary' } },
    { id: 'saved', title: 'Saved', saveBearerToken: true, request: { method: 'GET', authType: 'apiKey', basicUsername: '', basicPassword: '', apiKeyName: 'X-API-Key', apiKeyValue: 'saved-key' } }
  ] });
  assert.deepEqual([state.tabs[0].request.basicUsername, state.tabs[0].request.basicPassword, state.tabs[0].request.apiKeyValue], ['', '', '']);
  assert.equal(state.tabs[1].request.apiKeyValue, 'saved-key');
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
  const responseExampleSentinel = 'BACKUP_RESPONSE_EXAMPLE_MUST_BE_STRIPPED';
  const responseContract = {
    method: 'POST', pathTemplate: '/token', partialReasons: [responseExampleSentinel],
    responses: {
      '200': {
        content: {
          'application/json': {
            schema: {
              type: 'object', properties: {
                access_token: { type: 'string', example: responseExampleSentinel, default: responseExampleSentinel, description: responseExampleSentinel }
              }
            }
          }
        }
      }
    }
  };
  const source = {
    collections: [{ id: 'collection-1', name: 'Minha coleção', requests: [], folders: [{ id: 'folder-1', name: 'Auth', folders: [], requests: [{ id: 'request-1', method: 'POST', route: '/token', params: [['tenant', '{{tenant}}']], body: '{"client":"{{client}}"}', bearerToken: 'local-token', responseContract }] }] }],
    environments: [{ id: 'environment-1', name: 'Homologação', group: 'API', variables: { baseUrl: 'https://api.example.test', token: 'secret-token' } }],
    history: [{ id: 'history-1', method: 'POST', route: '/token', body: '{"client":"test"}', responseContract }],
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
  const restoredRequest = restored.data.collections[0].folders[0].requests[0];
  assert.equal(restoredRequest.responseContract.responses['200'].content['application/json'].schema.properties.access_token.type, 'string');
  assert.equal(JSON.stringify(backup).includes(responseExampleSentinel), false);
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

test('hosted cookie-jar restore uses one bulk API call for all environment jars', async () => {
  const { replaceHostedCookieJars } = runnerLogic();
  const records = Array.from({ length: 40 }, (_, index) => ({
    key: `cookiejar:environment-${index}`,
    value: { cookies: [{ cookieName: 'session', cookieHeader: `session=${index}`, cookieOrigin: 'https://api.example.test' }] }
  }));
  const calls = [];
  await replaceHostedCookieJars(records, async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 204 };
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/cookie-jar');
  assert.equal(calls[0].options.method, 'PUT');
  assert.equal(JSON.parse(calls[0].options.body).jars.length, 40);
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

test('hosted workspace vault encrypts repeated snapshots and reopens with the same browser password', async () => {
  const { webcrypto } = require('node:crypto');
  const { createWorkspaceBackup, createWorkspaceBackupVault } = runnerLogic();
  const passphrase = 'correct horse battery staple';
  const firstBackup = createWorkspaceBackup({
    collections: [{ id: 'c1', name: 'Collection', requests: [], folders: [] }],
    environments: [{ id: 'e1', name: 'Local', variables: { token: 'first-token' } }],
    history: [], settings: []
  });
  const vault = await createWorkspaceBackupVault(passphrase, undefined, webcrypto);
  const first = await vault.encrypt(JSON.stringify(firstBackup));
  const second = await vault.encrypt(JSON.stringify({ ...firstBackup, data: { ...firstBackup.data, environments: [{ id: 'e1', name: 'Local', variables: { token: 'second-token' } }] } }));

  assert.equal(first.salt, vault.salt);
  assert.equal(second.salt, first.salt);
  assert.notEqual(second.iv, first.iv);
  assert.doesNotMatch(JSON.stringify(first), /first-token/);

  const reopened = await createWorkspaceBackupVault(passphrase, first.salt, webcrypto);
  const restored = await reopened.decrypt(JSON.stringify(first));
  assert.equal(restored.data.environments[0].variables.token, 'first-token');
  await assert.rejects(createWorkspaceBackupVault('incorrect horse battery staple', first.salt, webcrypto).then(instance => instance.decrypt(JSON.stringify(first))), /incorreta|danificado/i);
});

test('public hosted mode keeps workspace data in the browser without a shared password', () => {
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, 'wwwroot', 'index.html'), 'utf8');
  const render = fs.readFileSync(path.join(__dirname, 'render.yaml'), 'utf8');

  assert.match(app, /if\(hostedMode\)return browserDbWrite\(store,value,remove\)/);
  assert.match(app, /runtime\.hostingMode==='render'/);
  assert.match(app, /fetch\('\/api\/session'/);
  assert.doesNotMatch(app, /hosted-login-dialog|ApiStudio__AccessPassword/);
  assert.doesNotMatch(page, /hosted-login-dialog|hosted-access-password/);
  assert.doesNotMatch(render, /ApiStudio__AccessPassword/);
  assert.doesNotMatch(app, /localStorage\.setItem\([^,]*(?:password|passphrase)/i);
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
test('request Auth view exposes its environment-scoped cookie jar', () => {
  const html = fs.readFileSync(path.join(__dirname, 'wwwroot', 'index.html'), 'utf8');
  assert.match(html, /id="cookie-jar-panel"/);
  assert.match(html, /id="cookie-jar-list"/);
  assert.match(html, /id="clear-cookie-jar"/);
});
test('removing an environment also removes its Cookie jar', () => {
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  assert.ok(app.includes("await dbWrite('settings','cookiejar:'+env.id,true);"), 'deleted environment cookies should be cleared');
});
test('Runner preserves the selected request body mode and rejects unsupported modes', () => {
  const { prepareSavedRequest } = runnerLogic();
  const form = prepareSavedRequest({ method: 'POST', route: '/submit', bodyMode: 'urlencoded', body: 'a=1&b=2' }, {}, {}, true);
  assert.equal(form.bodyMode, 'urlencoded');
  assert.throws(() => prepareSavedRequest({ method: 'POST', route: '/submit', bodyMode: 'binary' }, {}, {}, true), /body/i);
});

test('Body editor exposes JSON, text, XML, and URL-encoded formats', () => {
  const html = fs.readFileSync(path.join(__dirname, 'wwwroot', 'index.html'), 'utf8');
  assert.ok(html.includes('id="body-mode"'), 'Body mode selector should exist');
  for (const mode of ['json', 'text', 'xml', 'urlencoded']) assert.ok(html.includes('value="' + mode + '"'), 'missing mode: ' + mode);
});

test('Runner normalizes multipart fields, resolves text templates, and drops ephemeral file bytes', () => {
  const { normalizeMultipartFields, normalizeWorkspaceTabs, prepareSavedRequest } = runnerLogic();
  const fields = normalizeMultipartFields([
    { name: 'tag', type: 'text', value: 'one' },
    { name: 'tag', type: 'text', value: '' },
    { name: 'upload', type: 'file', fileName: 'sample.bin', contentType: 'application/octet-stream', fileBase64: 'c2VjcmV0' }
  ]);
  assert.deepEqual(fields, [
    { name: 'tag', type: 'text', value: 'one', fileName: '', contentType: '' },
    { name: 'tag', type: 'text', value: '', fileName: '', contentType: '' },
    { name: 'upload', type: 'file', value: '', fileName: 'sample.bin', contentType: 'application/octet-stream' }
  ]);
  assert.throws(() => normalizeMultipartFields([{ name: '', type: 'text', value: 'x' }]), /nome/i);
  const request = prepareSavedRequest({ method: 'POST', route: '/upload', bodyMode: 'multipart', multipartFields: [{ name: 'tag', type: 'text', value: '{{tag}}' }] }, {}, { tag: 'blue' }, true);
  assert.equal(request.bodyMode, 'multipart');
  assert.equal(request.multipartFields[0].value, 'blue');
  assert.throws(() => prepareSavedRequest({ method: 'POST', route: '/upload', bodyMode: 'multipart', multipartFields: [{ name: 'attachment', type: 'file', fileName: 'sample.bin' }] }, {}, {}, true), /Runner/);
  const state = normalizeWorkspaceTabs({ tabs: [{ id: 'tab', request: { bodyMode: 'multipart', multipartFields: [{ name: 'attachment', type: 'file', fileName: 'sample.bin', fileBase64: 'ZXBoZW1lcmFs' }] } }] });
  assert.equal(state.tabs[0].request.multipartFields[0].fileBase64, undefined);
});

test('Multipart editor exposes repeated text fields and ephemeral file selection', () => {
  const html = fs.readFileSync(path.join(__dirname, 'wwwroot', 'index.html'), 'utf8');
  assert.ok(html.includes('value="multipart"'), 'Multipart body mode should exist');
  assert.ok(html.includes('id="multipart-fields-list"'), 'Multipart field editor should exist');
  assert.ok(html.includes('id="multipart-add-file"'), 'File selection should be available');
  assert.ok(html.includes('Arquivos não são persistidos'), 'The UI should explain that file bytes are temporary');
});


test('Vortix, Insomnia, and Postman adapters keep multipart metadata without file bytes', () => {
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  assert.ok(app.includes("mode:'formdata'"), 'Postman multipart export should use formdata');
  assert.ok(app.includes("mimeType:'multipart/form-data'"), 'Insomnia multipart export should use its MIME type');
  assert.ok(app.includes('importedMultipartFields'), 'multipart imports should restore text and file metadata');
  assert.ok(app.includes('normalizePersistableMultipartFields'), 'persisted and exported multipart fields should strip file bytes');
});


test('GraphQL body builder validates variables and omits empty optional properties', () => {
  const { buildGraphqlBody, normalizeWorkspaceTabs, prepareSavedRequest } = runnerLogic();
  const body = JSON.parse(buildGraphqlBody('query User($id: ID!) { user(id: $id) { id } }', '{"id":"{{userId}}"}', 'User'));
  assert.deepEqual(body, { query: 'query User($id: ID!) { user(id: $id) { id } }', variables: { id: '{{userId}}' }, operationName: 'User' });
  assert.deepEqual(JSON.parse(buildGraphqlBody('{ ping }', '', '')), { query: '{ ping }' });
  assert.throws(() => buildGraphqlBody('', '', ''), /query/i);
  assert.throws(() => buildGraphqlBody('{ ping }', '{bad', ''), /JSON/i);
  assert.throws(() => buildGraphqlBody('{ ping }', '[]', ''), /objeto/i);
  const request = prepareSavedRequest({ method: 'POST', route: '/graphql', bodyMode: 'graphql', graphqlQuery: 'query User($id: ID!) { user(id: $id) { id } }', graphqlVariables: '{"id":"{{userId}}"}', graphqlOperationName: 'User' }, { userId: '42' }, {}, true);
  assert.equal(request.bodyMode, 'graphql');
  assert.deepEqual(JSON.parse(request.body), { query: 'query User($id: ID!) { user(id: $id) { id } }', variables: { id: '42' }, operationName: 'User' });
  const tabs = normalizeWorkspaceTabs({ tabs: [{ id: 'g', request: { bodyMode: 'graphql', graphqlQuery: '{ ping }', graphqlVariables: '{}', graphqlOperationName: 'Ping' } }] });
  assert.equal(tabs.tabs[0].request.graphqlQuery, '{ ping }');
  assert.equal(tabs.tabs[0].request.graphqlVariables, '{}');
  assert.equal(tabs.tabs[0].request.graphqlOperationName, 'Ping');
  assert.throws(() => prepareSavedRequest({ method: 'GET', route: '/graphql', bodyMode: 'graphql', graphqlQuery: '{ ping }' }, {}, {}, true), /POST/i);
});

test('parses an introspected GraphQL schema and suggests fields by selected type', () => {
  const { parseGraphqlSchemaResponse, suggestGraphqlFields } = runnerLogic();
  const payload = { data: { __schema: {
    queryType: { name: 'Query' }, mutationType: { name: 'Mutation' }, subscriptionType: null,
    types: [
      { kind: 'OBJECT', name: 'Query', description: 'Root query', fields: [
        { name: 'user', description: 'Find user', args: [{ name: 'id', type: { kind: 'NON_NULL', name: null, ofType: { kind: 'SCALAR', name: 'ID', ofType: null } } }], type: { kind: 'NON_NULL', name: null, ofType: { kind: 'OBJECT', name: 'User', ofType: null } } },
        { name: 'health', description: null, args: [], type: { kind: 'SCALAR', name: 'String', ofType: null } }
      ] },
      { kind: 'OBJECT', name: 'User', fields: [{ name: 'name', args: [], type: { kind: 'SCALAR', name: 'String', ofType: null } }] },
      { kind: 'OBJECT', name: '__Schema', fields: [] }
    ]
  } } };
  const schema = parseGraphqlSchemaResponse(JSON.stringify(payload), 200);
  assert.equal(schema.queryType, 'Query');
  assert.equal(schema.types.some(type => type.name === '__Schema'), false);
  assert.equal(schema.types.find(type => type.name === 'Query').fields[0].returnType, 'User!');
  assert.equal(schema.types.find(type => type.name === 'Query').fields[0].args[0].type, 'ID!');
  assert.deepEqual(suggestGraphqlFields(schema, 'Query', 'us').map(field => field.name), ['user']);
});

test('rejects failed or malformed GraphQL introspection responses without echoing server payloads', () => {
  const { parseGraphqlSchemaResponse } = runnerLogic();
  assert.throws(() => parseGraphqlSchemaResponse('{"errors":[{"message":"private-response-detail"}]}', 200), error => {
    assert.match(error.message, /introspecção/i);
    assert.doesNotMatch(error.message, /private-response-detail/);
    return true;
  });
  assert.throws(() => parseGraphqlSchemaResponse('{}', 200), /schema/i);
  assert.throws(() => parseGraphqlSchemaResponse('{}', 401), /HTTP 401/i);
});

test('GraphQL editor exposes a schema loader, type selector, and autocomplete region', () => {
  const html = fs.readFileSync(path.join(__dirname, 'wwwroot', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  for (const id of ['graphql-load-schema', 'graphql-schema-type', 'graphql-autocomplete']) assert.ok(html.includes('id="' + id + '"'));
  assert.ok(app.includes("'/api/graphql/introspection'"));
  assert.ok(app.includes('RunnerLogic.parseGraphqlSchemaResponse'));
  assert.ok(app.includes('confirmWithDialog'));
});

test('README documents schema introspection confirmation, memory-only cache, and endpoint test', () => {
  const readme = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8');
  assert.ok(readme.includes('### Schema, confirmação e autocomplete'));
  assert.ok(readme.includes('O schema fica somente em memória'));
  assert.ok(readme.includes('GraphqlIntrospection.test.ps1'));
});

test('GraphQL editor exposes query, JSON variables, and operation name controls', () => {
  const html = fs.readFileSync(path.join(__dirname, 'wwwroot', 'index.html'), 'utf8');
  for (const id of ['graphql-query', 'graphql-variables', 'graphql-operation-name']) assert.ok(html.includes('id="' + id + '"'), 'missing GraphQL field: ' + id);
  assert.ok(html.includes('value="graphql"'), 'GraphQL body mode should exist');
});


test('GraphQL adapters map Postman and Insomnia query/variables formats', () => {
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  assert.ok(app.includes('buildPostmanGraphqlBody'), 'Postman export should use the GraphQL adapter');
  assert.ok(app.includes('buildInsomniaGraphqlBody'), 'Insomnia export should use the GraphQL adapter');
  assert.ok(app.includes('importedGraphqlFields'), 'Postman and Insomnia imports should restore GraphQL fields');
  assert.ok(app.includes('graphqlOperationName:graphql.graphqlOperationName'), 'Vortix JSON should preserve operationName');
  assert.ok(app.includes('graphqlQuery,graphqlVariables,graphqlOperationName,...proxyRequest'), 'Client-only GraphQL editor fields should not be sent to the proxy separately');
});


test('GraphQL adapters round-trip query, variables, and operationName', () => {
  const { buildGraphqlBody, buildInsomniaGraphqlBody, buildPostmanGraphqlBody, normalizeGraphqlImportBody } = runnerLogic();
  const fields = { graphqlQuery: 'query User($id: ID!) { user(id: $id) { id } }', graphqlVariables: '{"id":"42"}', graphqlOperationName: 'User' };
  const postman = buildPostmanGraphqlBody(fields);
  assert.equal(postman.mode, 'graphql');
  assert.equal(postman.graphql.query, fields.graphqlQuery);
  assert.equal(postman.graphql.variables, fields.graphqlVariables);
  assert.equal(postman.graphql.operationName, 'User');
  const insomnia = buildInsomniaGraphqlBody(fields);
  assert.equal(insomnia.mimeType, 'application/graphql');
  assert.deepEqual(JSON.parse(insomnia.text), { query: fields.graphqlQuery, variables: { id: '42' }, operationName: 'User' });
  assert.deepEqual(normalizeGraphqlImportBody(postman), fields);
  assert.deepEqual(normalizeGraphqlImportBody(insomnia), { ...fields, graphqlVariables: '{\n  "id": "42"\n}' });
  assert.deepEqual(JSON.parse(buildGraphqlBody(fields.graphqlQuery, fields.graphqlVariables, fields.graphqlOperationName)), JSON.parse(insomnia.text));
});


test('Auth inheritance follows request, nearest folder, then collection precedence', () => {
  const { resolveInheritedAuth, prepareSavedRequest, flattenRequests } = runnerLogic();
  const scopes = [
    { auth: { authType: 'bearer', bearerToken: 'collection-token' } },
    { auth: { authType: 'basic', basicUsername: 'folder-user', basicPassword: 'folder-pass' } },
    { auth: { authType: 'apiKey', apiKeyName: 'X-Nested-Key', apiKeyValue: 'nested-key', apiKeyLocation: 'header' } }
  ];
  const inherited = resolveInheritedAuth({ authMode: 'inherit' }, scopes);
  assert.equal(inherited.authType, 'apiKey');
  assert.equal(inherited.apiKeyValue, 'nested-key');
  assert.equal(resolveInheritedAuth({ authMode: 'inherit' }, scopes.slice(0, 2)).basicPassword, 'folder-pass');
  assert.equal(resolveInheritedAuth({ authMode: 'inherit' }, scopes.slice(0, 1)).bearerToken, 'collection-token');
  assert.equal(resolveInheritedAuth({ authMode: 'custom', authType: 'bearer', bearerToken: 'request-token' }, scopes).bearerToken, 'request-token');
  assert.equal(resolveInheritedAuth({ authMode: 'none', authType: 'bearer', bearerToken: 'ignored' }, scopes).authType, 'none');
  assert.equal(resolveInheritedAuth({ authType: 'none' }, scopes).authType, 'none', 'legacy requests keep explicit auth');
  const request = prepareSavedRequest({ method: 'GET', route: '/me', authMode: 'inherit' }, {}, {}, false, scopes);
  assert.equal(request.authType, 'apiKey');
  assert.equal(request.apiKeyName, 'X-Nested-Key');
  assert.equal(request.apiKeyValue, 'nested-key');

  const collection = { name: 'API', auth: scopes[0].auth, requests: [], folders: [{ id: 'folder', name: 'Folder', auth: scopes[1].auth, requests: [{ method: 'GET', route: '/me' }], folders: [] }] };
  const flattened = flattenRequests(collection);
  assert.equal(flattened[0].authScopes.length, 2);
  assert.equal(flattened[0].authScopes[1].auth.authType, 'basic');
});

test('Auth tab exposes inheritance source, override, disable, and default controls', () => {
  const html = fs.readFileSync(path.join(__dirname, 'wwwroot', 'index.html'), 'utf8');
  for (const id of ['auth-inheritance-mode', 'auth-inheritance-source', 'save-auth-default']) assert.ok(html.includes('id="' + id + '"'), 'missing Auth inheritance control: ' + id);
});

test('Auth persistence keeps inherited secrets on their parent and honors credential opt-in', () => {
  const { persistAuthFields } = runnerLogic();
  const inherited = persistAuthFields({ authMode: 'inherit', authType: 'bearer', bearerToken: 'parent-token' }, true);
  assert.equal(inherited.authMode, 'inherit');
  assert.equal(inherited.authType, 'none');
  assert.equal(inherited.bearerToken, '');

  const omitted = persistAuthFields({ authMode: 'custom', authType: 'basic', basicUsername: 'user', basicPassword: 'secret' }, false);
  assert.equal(omitted.authType, 'basic');
  assert.equal(omitted.basicUsername, '');
  assert.equal(omitted.basicPassword, '');
  assert.equal(omitted.authOmitted, true);

  const saved = persistAuthFields({ authMode: 'custom', authType: 'apiKey', apiKeyName: 'X-API-Key', apiKeyLocation: 'header', apiKeyValue: 'secret' }, true);
  assert.equal(saved.apiKeyValue, 'secret');
  assert.equal(saved.authOmitted, false);
});

test('Auth import distinguishes inheritance from explicit no-auth and overrides', () => {
  const { normalizeImportedAuthMode } = runnerLogic();
  assert.equal(normalizeImportedAuthMode(undefined), 'inherit');
  assert.equal(normalizeImportedAuthMode({}), 'inherit');
  assert.equal(normalizeImportedAuthMode({ type: 'inherit' }), 'inherit');
  assert.equal(normalizeImportedAuthMode({ type: 'noauth' }), 'none');
  assert.equal(normalizeImportedAuthMode({ type: 'none' }), 'none');
  assert.equal(normalizeImportedAuthMode({ type: 'bearer' }), 'custom');
});

test('inherited Auth stays isolated by collection and resolves per active environment', () => {
  const { prepareSavedRequest } = runnerLogic();
  const request = { method: 'GET', route: '/me', authMode: 'inherit' };
  const first = prepareSavedRequest(request, { token: 'first-env-token' }, {}, false, [{ id: 'c1', name: 'First', auth: { authType: 'bearer', bearerToken: '{{token}}' } }]);
  const second = prepareSavedRequest(request, { token: 'second-env-token' }, {}, false, [{ id: 'c2', name: 'Second', auth: { authType: 'bearer', bearerToken: '{{token}}' } }]);
  assert.equal(first.bearerToken, 'first-env-token');
  assert.equal(second.bearerToken, 'second-env-token');
  assert.notEqual(first.bearerToken, second.bearerToken);
});

test('Persisted workspace tabs keep inherited auth at its collection or folder scope', () => {
  const { normalizeWorkspaceTabs } = runnerLogic();
  const state = normalizeWorkspaceTabs({ activeId: 'tab-1', tabs: [{ id: 'tab-1', saveBearerToken: true, request: { method: 'GET', authMode: 'inherit', authType: 'bearer', bearerToken: 'parent-token' } }] });
  assert.equal(state.tabs[0].request.authMode, 'inherit');
  assert.equal(state.tabs[0].request.authType, 'none');
  assert.equal(state.tabs[0].request.bearerToken, '');
});

test('collection and folder Auth defaults round-trip through Vortix, Insomnia, and Postman adapters', () => {
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  const contracts = [
    '...(node.auth?{auth:exportAuthConfig(node.auth,includeBearer)}:{})',
    '...exportAuthConfig(request,includeBearer,true)',
    'if(document.auth)root.auth=exportAuthConfig(importedPostmanAuth(document.auth,[]),true)',
    'if(item.auth)folder.auth=exportAuthConfig(importedPostmanAuth(item.auth,[]),true)',
    'if(collection.auth)result.auth=postmanAuthDefinition(collection.auth,includeBearer)',
    'if(folder.auth)item.auth=postmanAuthDefinition(folder.auth,includeBearer)',
    "if(authMode!=='inherit')item.request.auth=postmanAuthDefinition(request,includeBearer)",
    "if(collection.auth){const id='__request_group_'+(++folderNumber)+'__',group={_id:id,_type:'request_group',parentId:rootParent,name:'Auth padrão'",
    'addNode(collection,rootParent)',
    'if(folder.auth)group.authentication=insomniaAuthDefinition(folder.auth,includeBearer)',
    "const authentication=authMode==='inherit'?{}:insomniaAuthDefinition(request,includeBearer)",
    'if(rootAuth&&rootAuth.type)root.auth=exportAuthConfig(importedInsomniaAuth(rootAuth,[],\'/\'),true)',
    'if(auth&&auth.type)group.auth=exportAuthConfig(importedInsomniaAuth(auth,[],\'/\'),true)',
    'safe.auth=exportAuthConfig(source.auth,keepAuth)'
  ];
  for (const contract of contracts) assert.ok(app.includes(contract), 'missing Auth interop contract: ' + contract);
});

test('README explains inherited Auth with an example and local visual', () => {
  const readme = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8');
  const diagramPath = path.join(__dirname, 'docs', 'images', 'vortix-auth-inheritance.svg');
  assert.ok(readme.includes('vortix-auth-inheritance.svg'));
  assert.ok(readme.includes('"authMode": "inherit"'));
  assert.ok(readme.includes('pasta mais próxima'));
  assert.ok(fs.existsSync(diagramPath));
  assert.match(fs.readFileSync(diagramPath, 'utf8'), /<svg[\s\S]*aria-labelledby=/);
});

test('Insomnia empty request Auth retains explicit API-key headers before inheriting', () => {
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  assert.ok(app.includes("if(authMode==='none'||type==='inherit')return{authMode,authType:'none'}"));
  assert.ok(app.includes('const headerIndex=headers.findIndex(line=>/^(?:x[-_]?api[-_]?key|api[-_]?key)'));
});

test('Insomnia export maps collection Auth to a top-level inherited-auth folder', () => {
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  assert.ok(app.includes("name:'Auth padrão'"), 'Insomnia collection Auth should be represented by a folder');
  assert.ok(app.includes('authentication:insomniaAuthDefinition(collection.auth,includeBearer)'), 'the wrapper folder should carry the collection Auth');
});

test('history restores environment and clears stale collection scope before resolving inherited Auth', () => {
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  const saveStart = app.indexOf('async function saveHistory(request,options={}){'), saveEnd = app.indexOf('function applyHistoryEntry', saveStart);
  const applyStart = app.indexOf('function applyHistoryEntry(entry,notify=true){'), applyEnd = app.indexOf('function tokenHistorySnapshot', applyStart);
  const save = app.slice(saveStart, saveEnd), apply = app.slice(applyStart, applyEnd);
  assert.ok(save.includes('environmentId:String(request.environmentId||\'default\')'));
  const resetScope = apply.indexOf("selectedContainer={collectionId:'',folderId:''}");
  const restoreEnvironment = apply.indexOf('activeEnvironmentId=entry.environmentId');
  const renderEnvironment = apply.indexOf('renderEnvironmentSelect()');
  const resolveAuth = apply.indexOf('applyAuthFields(entry)');
  assert.ok(resetScope >= 0 && restoreEnvironment > resetScope && renderEnvironment > restoreEnvironment && resolveAuth > renderEnvironment);
});

test('OAuth Client Credentials builds a form request with RFC-encoded Basic credentials', () => {
  const { buildOAuthClientCredentialsRequest } = runnerLogic();
  const request = buildOAuthClientCredentialsRequest({
    tokenUrl: 'https://identity.example.test/oauth/token?tenant=blue',
    clientId: 'client:app one', clientSecret: 's:cret value&', scope: 'read:items   write:items',
    clientAuthMethod: 'client_secret_basic'
  });
  const encodeCredential = value => new URLSearchParams([['value', value]]).toString().slice('value='.length);
  assert.equal(request.baseUrl, 'https://identity.example.test');
  assert.equal(request.route, '/oauth/token?tenant=blue');
  assert.equal(request.method, 'POST');
  assert.equal(request.bodyMode, 'urlencoded');
  assert.equal(request.body, 'grant_type=client_credentials&scope=read%3Aitems+write%3Aitems');
  assert.equal(request.authType, 'basic');
  assert.equal(request.basicUsername, encodeCredential('client:app one'));
  assert.equal(request.basicPassword, encodeCredential('s:cret value&'));
  assert.equal(request.confirmTokenRequest, true);
  assert.equal(request.tokenFlow, 'oauth2-client-credentials');
  assert.equal(request.tokenClientSecret, '');
  assert.equal(request.allowInsecureHttp, false);
});

test('OAuth Client Credentials supports client_secret_post without putting credentials in URL', () => {
  const { buildOAuthClientCredentialsRequest } = runnerLogic();
  const request = buildOAuthClientCredentialsRequest({
    tokenUrl: 'https://identity.example.test/connect/token',
    clientId: 'client id', clientSecret: 'secret&value', scope: '', clientAuthMethod: 'client_secret_post'
  });
  const fields = Object.fromEntries(new URLSearchParams(request.body));
  assert.deepEqual(fields, { grant_type: 'client_credentials', client_id: 'client id', client_secret: 'secret&value' });
  assert.equal(request.authType, 'none');
  assert.equal(request.basicPassword, '');
  assert.equal(request.route, '/connect/token');
});

test('OAuth Client Credentials validates endpoint security and client settings', () => {
  const { buildOAuthClientCredentialsRequest } = runnerLogic();
  const valid = { tokenUrl: 'https://identity.example.test/token', clientId: 'id', clientSecret: 'secret' };
  assert.throws(() => buildOAuthClientCredentialsRequest({ ...valid, tokenUrl: 'ftp://identity.example.test/token' }), /HTTP|HTTPS/i);
  assert.throws(() => buildOAuthClientCredentialsRequest({ ...valid, tokenUrl: credentialedTestUrl() }), /credenciais|URL/i);
  assert.throws(() => buildOAuthClientCredentialsRequest({ ...valid, tokenUrl: 'https://identity.example.test/token#fragment' }), /fragmento|URL/i);
  assert.throws(() => buildOAuthClientCredentialsRequest({ ...valid, tokenUrl: 'http://identity.example.test/token' }), /HTTP|TLS/i);
  assert.doesNotThrow(() => buildOAuthClientCredentialsRequest({ ...valid, tokenUrl: 'http://identity.example.test/token', allowInsecureHttp: true }));
  assert.doesNotThrow(() => buildOAuthClientCredentialsRequest({ ...valid, tokenUrl: 'http://localhost:4321/token' }));
  assert.throws(() => buildOAuthClientCredentialsRequest({ ...valid, clientAuthMethod: 'query' }), /autentica/i);
  assert.throws(() => buildOAuthClientCredentialsRequest({ ...valid, clientSecret: '' }), /segredo/i);
});

test('OAuth token response stores only a valid Bearer token and expiration metadata', () => {
  const { parseOAuthTokenResponse } = runnerLogic();
  const result = parseOAuthTokenResponse(JSON.stringify({ access_token: 'access-secret-value', token_type: 'bEaReR', expires_in: 3600, refresh_token: 'must-not-be-kept' }), 200, 1000);
  assert.deepEqual(result, { accessToken: 'access-secret-value', tokenType: 'Bearer', expiresIn: 3600, expiresAt: 3601000 });
  assert.throws(() => parseOAuthTokenResponse('{"error":"invalid_client"}', 401), /HTTP 401/i);
  assert.throws(() => parseOAuthTokenResponse('not json', 200), /JSON/i);
  assert.throws(() => parseOAuthTokenResponse('{"token_type":"Bearer"}', 200), /access_token/i);
  assert.throws(() => parseOAuthTokenResponse('{"access_token":"secret","token_type":"Basic"}', 200), /Bearer/i);
  assert.throws(() => parseOAuthTokenResponse('{"access_token":"secret","token_type":"Bearer","expires_in":-1}', 200), /expires_in/i);
});

test('OAuth Client Credentials UI, storage isolation, and backend token-flow contract exist', () => {
  const html = fs.readFileSync(path.join(__dirname, 'wwwroot', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  const program = fs.readFileSync(path.join(__dirname, 'Program.cs'), 'utf8');
  for (const id of ['oauth2-token-url', 'oauth2-client-id', 'oauth2-client-secret', 'oauth2-scope', 'oauth2-client-auth-method', 'oauth2-request-token', 'oauth2-token-status']) assert.ok(html.includes('id="' + id + '"'), 'missing OAuth field: ' + id);
  assert.ok(app.includes('buildOAuthClientCredentialsRequest'));
  assert.ok(app.includes('parseOAuthTokenResponse'));
  assert.ok(app.includes("oauth2TokenConfigStorageKey()"), 'OAuth settings must be environment-scoped');
  assert.ok(program.includes('oauth2-client-credentials'), 'the local proxy must recognize the guarded OAuth flow');
});
test('OAuth profile persistence is environment-ready and never includes the client secret', () => {
  const { normalizeOAuthClientCredentialsConfig } = runnerLogic();
  const config = normalizeOAuthClientCredentialsConfig({
    tokenUrl: '{{identityUrl}}/oauth/token', clientId: '{{clientId}}', scope: 'read   write',
    clientAuthMethod: 'client_secret_post', clientSecret: 'must-not-persist'
  });
  assert.deepEqual(config, {
    tokenUrl: '{{identityUrl}}/oauth/token', clientId: '{{clientId}}', scope: 'read write',
    clientAuthMethod: 'client_secret_post'
  });
  assert.equal(Object.hasOwn(config, 'clientSecret'), false);
  assert.throws(() => normalizeOAuthClientCredentialsConfig({ clientAuthMethod: 'query' }), /autentica/i);
});
test('OAuth settings reject client credentials embedded in the token URL before persistence', () => {
  const { normalizeOAuthClientCredentialsConfig, buildOAuthClientCredentialsRequest } = runnerLogic();
  const tokenUrl = 'https://identity.example.test/oauth/token?client_secret=cleartext';
  assert.throws(() => normalizeOAuthClientCredentialsConfig({ tokenUrl }), /URL|credenciais/i);
  assert.throws(() => buildOAuthClientCredentialsRequest({ tokenUrl, clientId: 'id', clientSecret: 'secret' }), /URL|credenciais/i);
});
test('OAuth client_secret is excluded from workspace draft tracking and token history', () => {
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  const snapshotStart = app.indexOf('function tokenHistorySnapshot(request){');
  const snapshotEnd = app.indexOf('function loadHistoryEntry', snapshotStart);
  const snapshot = app.slice(snapshotStart, snapshotEnd);
  const trackingStart = app.indexOf('trackDraft=event=>');
  const trackingEnd = app.indexOf(';editorColumn.addEventListener', trackingStart);
  const tracking = app.slice(trackingStart, trackingEnd);
  assert.ok(snapshot.includes("body:''"));
  assert.ok(snapshot.includes("basicPassword:!oauth&&request.authType==='basic'"));
  assert.ok(tracking.includes("'oauth2-client-secret'"), 'secret input must not persist in workspace drafts');
});
test('README documents OAuth Client Credentials with a local diagram and limits', () => {
  const readme = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8');
  const diagram = path.join(__dirname, 'docs', 'images', 'vortix-oauth-client-credentials.svg');
  assert.ok(readme.includes('vortix-oauth-client-credentials.svg'));
  assert.ok(readme.includes('grant_type=client_credentials'));
  assert.ok(readme.includes('expires_in'));
  assert.ok(readme.includes('Authorization Code') && readme.includes('PKCE'));
  assert.ok(readme.includes('rfc6749'));
  assert.ok(fs.existsSync(diagram));
  assert.match(fs.readFileSync(diagram, 'utf8'), /<svg[\s\S]*aria-labelledby=/);
});
test('OAuth Authorization Code PKCE UI requires explicit consent to save tokens', () => {
  const html = fs.readFileSync(path.join(__dirname, 'wwwroot', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  const program = fs.readFileSync(path.join(__dirname, 'Program.cs'), 'utf8');
  for (const id of ['oauth-pkce-authorization-url', 'oauth-pkce-token-url', 'oauth-pkce-client-id', 'oauth-pkce-scope', 'oauth-pkce-redirect-uri', 'oauth-pkce-save-access-token', 'oauth-pkce-save-refresh-token', 'oauth-pkce-flow-status', 'oauth-pkce-start']) {
    assert.ok(html.includes('id="' + id + '"'), 'missing PKCE UI field: ' + id);
  }
  for (const id of ['oauth-pkce-save-access-token', 'oauth-pkce-save-refresh-token']) {
    const input = html.match(new RegExp('<input[^>]*id="' + id + '"[^>]*>'));
    assert.ok(input, 'missing token persistence consent control: ' + id);
    assert.equal(/\bchecked\b/.test(input[0]), false, id + ' must require an explicit opt-in.');
  }
  assert.equal(html.includes('id="oauth-pkce-client-secret"'), false, 'public PKCE flow must not ask for a client secret.');
  assert.ok(app.includes('/api/oauth/pkce/start'));
  assert.ok(app.includes('/api/oauth/pkce/status/'));
  const pkceStart = app.indexOf('async function requestOAuthAuthorizationCodeToken(){');
  const pkceEnd = app.indexOf('function cancelOAuthPkceAuthorization', pkceStart);
  assert.ok(pkceStart >= 0 && pkceEnd > pkceStart);
  assert.ok(app.slice(pkceStart, pkceEnd).includes("byId('save-token-history').checked=false"), 'PKCE tokens must not leak into request drafts without explicit save consent.');
  assert.ok(app.includes('oauthPkceConfigStorageKey'));
  const cancelStart = app.indexOf('function cancelOAuthPkceAuthorization(){');
  const cancelEnd = app.indexOf('}', cancelStart);
  assert.ok(cancelStart >= 0 && cancelEnd > cancelStart);
  assert.ok(app.slice(cancelStart, cancelEnd).includes('oauthPkceCancelRequested'), 'Cancel must stop polling.');
  assert.ok(app.includes("'/api/oauth/pkce/status/'+encodeURIComponent(state),'DELETE'"), 'Cancel must clear the server-side flow.');
  assert.ok(program.includes('/oauth/callback/{providerKey}'));
});
test('OAuth PKCE profile is environment-ready and excludes secrets', () => {
  const { normalizeOAuthPkceConfig } = runnerLogic();
  const config = normalizeOAuthPkceConfig({
    authorizationUrl: '{{identityUrl}}/authorize', tokenUrl: '{{identityUrl}}/token',
    clientId: '{{clientId}}', scope: 'read   write', clientSecret: 'must-not-persist'
  });
  assert.deepEqual(config, {
    authorizationUrl: '{{identityUrl}}/authorize', tokenUrl: '{{identityUrl}}/token',
    clientId: '{{clientId}}', scope: 'read write'
  });
  assert.equal(Object.hasOwn(config, 'clientSecret'), false);
  assert.throws(() => normalizeOAuthPkceConfig({ authorizationUrl: 'https://id.example.test/auth?client_secret=cleartext' }), /URL|credenciais/i);
  assert.throws(() => normalizeOAuthPkceConfig({ tokenUrl: 'https://id.example.test/token?refresh_token=cleartext' }), /URL|credenciais/i);
});
test('README documents PKCE redirect setup, consent, constraints, and flow diagram', () => {
  const readme = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8');
  const diagramPath = path.join(__dirname, 'docs', 'images', 'vortix-oauth-authorization-code-pkce.svg');
  assert.ok(readme.includes('vortix-oauth-authorization-code-pkce.svg'));
  assert.match(readme, /Authorization Code.*PKCE/i);
  assert.ok(readme.includes('127.0.0.1'));
  assert.ok(readme.includes('code_challenge_method=S256'));
  assert.ok(readme.includes('{{refresh_token}}'));
  assert.ok(readme.includes('rfc7636') && readme.includes('rfc8252') && readme.includes('rfc9700'));
  assert.ok(fs.existsSync(diagramPath));
  assert.match(fs.readFileSync(diagramPath, 'utf8'), /<svg[\s\S]*aria-labelledby=/);
});

test('normalizes saved response examples and removes credential-bearing response headers', () => {
  const { normalizeResponseExamples } = runnerLogic();
  const examples = normalizeResponseExamples([{
    id: 'example-200',
    name: 'Lista vazia',
    status: 200,
    headers: {
      'Content-Type': ['application/json'],
      'X-Request-Id': ['trace-42'],
      'Set-Cookie': ['session=secret'],
      Authorization: ['Bearer secret']
    },
    body: '{"items":[]}',
    savedAt: '2026-10-15T12:00:00.000Z'
  }]);
  assert.deepEqual(examples, [{
    id: 'example-200',
    name: 'Lista vazia',
    status: 200,
    headers: {
      'Content-Type': ['application/json'],
      'X-Request-Id': ['trace-42']
    },
    body: '{"items":[]}',
    savedAt: '2026-10-15T12:00:00.000Z'
  }]);
});

test('appends response examples without mutating the request and enforces limits', () => {
  const { normalizeResponseExamples, addResponseExample } = runnerLogic();
  const existing = [{
    id: 'example-200',
    name: 'Sucesso',
    status: 200,
    headers: {},
    body: '{"id":42}',
    savedAt: '2026-10-15T12:00:00.000Z'
  }];
  const added = addResponseExample(existing, {
    id: 'example-201',
    name: 'Criado',
    status: 201,
    headers: {},
    body: '{"id":43}',
    savedAt: '2026-10-15T12:01:00.000Z'
  });
  assert.equal(existing.length, 1);
  assert.deepEqual(added.map(example => example.status), [200, 201]);
  assert.throws(() => normalizeResponseExamples([{ id: 'bad', name: 'Inválido', status: 99, headers: {}, body: '' }]), /status/i);
  assert.throws(() => normalizeResponseExamples([{ id: 'large', name: 'Body grande', status: 200, headers: {}, body: 'x'.repeat(1_000_001) }]), /body|limite/i);
  const tooMany = Array.from({ length: 21 }, (_, index) => ({
    id: 'example-' + index, name: 'Exemplo ' + index, status: 200, headers: {}, body: '', savedAt: ''
  }));
  assert.throws(() => normalizeResponseExamples(tooMany), /20/);
  const full = tooMany.slice(0, 20);
  assert.throws(() => addResponseExample(full, { id: 'last', name: 'Limite', status: 200, headers: {}, body: '', savedAt: '' }), /20/);
});

test('adds a saved response example without changing the request or previous examples', () => {
  const { appendResponseExampleToRequest } = runnerLogic();
  const request = {
    id: 'request-1',
    name: 'Buscar item',
    route: '/items/42',
    responseExamples: [{
      id: 'example-200',
      name: 'Encontrado',
      status: 200,
      headers: { 'Content-Type': ['application/json'] },
      body: '{"id":42}',
      savedAt: '2026-10-15T12:00:00.000Z'
    }]
  };
  const updated = appendResponseExampleToRequest(request, {
    id: 'example-404',
    name: 'Não encontrado',
    status: 404,
    headers: { 'Content-Type': ['application/json'] },
    body: '{"error":"not_found"}',
    savedAt: '2026-10-15T12:01:00.000Z'
  });
  assert.notEqual(updated, request);
  assert.equal(updated.route, '/items/42');
  assert.deepEqual(updated.responseExamples.map(example => example.status), [200, 404]);
  assert.deepEqual(request.responseExamples.map(example => example.status), [200]);
});

test('local response examples match method, path, and query independent of query order', () => {
  const { responseExampleRequestMatches } = runnerLogic();
  const saved = { method: 'GET', route: '/items/42?tag=blue&tag=green' };
  assert.equal(responseExampleRequestMatches({ method: 'get', route: '/items/42?tag=green&tag=blue' }, saved), true);
  assert.equal(responseExampleRequestMatches({ method: 'POST', route: '/items/42?tag=blue&tag=green' }, saved), false);
  assert.equal(responseExampleRequestMatches({ method: 'GET', route: '/items/43?tag=blue&tag=green' }, saved), false);
  assert.equal(responseExampleRequestMatches({ method: 'GET', route: '/items/42?tag=blue&tag=red' }, saved), false);
});

test('builds a local mock response only from an example on the matching saved request', () => {
  const { buildResponseExampleMock } = runnerLogic();
  const request = { method: 'GET', route: '/items/42?tag=blue', responseExamples: [{
    id: 'example-404', name: 'Not found', status: 404,
    headers: { 'Content-Type': ['application/json'] }, body: '{"error":"missing"}', savedAt: ''
  }] };
  assert.deepEqual(buildResponseExampleMock({ method: 'GET', route: '/items/42?tag=blue' }, request, 'example-404'), {
    status: 404, reason: 'Local mock', headers: { 'Content-Type': ['application/json'] }, body: '{"error":"missing"}'
  });
  assert.throws(() => buildResponseExampleMock({ method: 'GET', route: '/items/42?tag=red' }, request, 'example-404'), /método, path e query/i);
  assert.throws(() => buildResponseExampleMock({ method: 'GET', route: '/items/42?tag=blue' }, request, 'missing'), /exemplo/i);
});

test('surfaces one warning when an unreadable non-secret token mode uses the safe default', () => {
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  assert.ok(app.includes('X-Api-Studio-Data-Recovery'));
  assert.ok(app.includes('tokenModeRecoveryWarned'));
  assert.ok(app.includes('Preferência de credenciais recuperada'));
});
test('local mock replays success, validation, and server-error examples', () => {
  const { buildResponseExampleMock } = runnerLogic();
  const saved = { method: 'POST', route: '/users', responseExamples: [
    { id: 'success', name: 'Created', status: 201, headers: {}, body: '{"id":42}', savedAt: '' },
    { id: 'validation', name: 'Invalid input', status: 400, headers: {}, body: '{"error":"validation_error"}', savedAt: '' },
    { id: 'server-error', name: 'Server error', status: 500, headers: {}, body: '{"error":"internal_error"}', savedAt: '' }
  ] };
  const current = { method: 'POST', route: '/users' };
  assert.deepEqual(['success', 'validation', 'server-error'].map(id => buildResponseExampleMock(current, saved, id).status), [201, 400, 500]);
});
test('local mock UI uses saved examples and does not invoke the API path', () => {
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  const start = app.indexOf('function simulateSavedResponseExample(');
  const end = app.indexOf('function updateCopyButtons(', start);
  assert.ok(start >= 0 && end > start, 'local simulation handler should be defined beside response-example actions');
  const handler = app.slice(start, end);
  assert.ok(handler.includes('RunnerLogic.buildResponseExampleMock'));
  assert.ok(handler.includes('...saved'), 'the matching saved request must carry its responseExamples into the mock selector');
  assert.doesNotMatch(handler, /fetch\s*\(|executeApiRequest|performApiRequest/);
  assert.ok(app.includes('simulateSavedResponseExample(example.id)'));
  const readme = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8');
  assert.ok(readme.includes('Simular local'));
  assert.match(readme, /n[aã]o cria servidor de mock/i);
});
test('toast close button remains clickable without blocking the workspace', () => {
  const css = fs.readFileSync(path.join(__dirname, 'wwwroot', 'style.css'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  assert.ok(/\.toast-region\s*\{[^}]*pointer-events:\s*none/.test(css), 'empty toast area should remain click-through');
  assert.ok(/\.toast\s*\{[^}]*pointer-events:\s*auto/.test(css), 'toast card must accept clicks for its close button');
  assert.ok(app.includes('close.onclick=()=>dismissToast(id)'));
});
test('imports Postman response examples and filters sensitive headers', () => {
  const { importResponseExamples } = runnerLogic();
  const examples = importResponseExamples([{
    name: 'Criado',
    code: 201,
    status: '201 Created',
    header: [
      { key: 'Content-Type', value: 'application/json' },
      { key: 'Set-Cookie', value: 'sid=secret' },
      { key: 'X-Trace', value: 'trace-1' }
    ],
    body: '{"id":42}'
  }], 'postman', () => 'postman-example', '2026-10-15T12:00:00.000Z');
  assert.deepEqual(examples, [{
    id: 'postman-example', name: 'Criado', status: 201,
    headers: { 'Content-Type': ['application/json'], 'X-Trace': ['trace-1'] },
    body: '{"id":42}', savedAt: '2026-10-15T12:00:00.000Z'
  }]);
});

test('imports Insomnia v4 response resources as saved examples', () => {
  const { importResponseExamples } = runnerLogic();
  const examples = importResponseExamples([{
    _type: 'response', name: 'Não encontrado', statusCode: 404,
    headers: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Authorization', value: 'Bearer secret' }],
    body: '{"error":"missing"}'
  }], 'insomnia', () => 'insomnia-example', '2026-10-15T12:01:00.000Z');
  assert.deepEqual(examples, [{
    id: 'insomnia-example', name: 'Não encontrado', status: 404,
    headers: { 'Content-Type': ['application/json'] },
    body: '{"error":"missing"}', savedAt: '2026-10-15T12:01:00.000Z'
  }]);
});

test('exports saved response examples in Postman v2.1 response shape', () => {
  const { buildPostmanResponseExamples } = runnerLogic();
  assert.deepEqual(buildPostmanResponseExamples([{
    id: 'example-201', name: 'Criado', status: 201,
    headers: { 'Content-Type': ['application/json'], 'X-Trace': ['trace-1', 'trace-2'] },
    body: '{"id":42}', savedAt: '2026-10-15T12:00:00.000Z'
  }]), [{
    name: 'Criado', status: '201', code: 201,
    header: [
      { key: 'Content-Type', value: 'application/json', type: 'text' },
      { key: 'X-Trace', value: 'trace-1', type: 'text' },
      { key: 'X-Trace', value: 'trace-2', type: 'text' }
    ],
    body: '{"id":42}'
  }]);
});

test('exports saved response examples as linked Insomnia v4 resources', () => {
  const { responseExampleToInsomniaResource } = runnerLogic();
  const resource = responseExampleToInsomniaResource({
    id: 'example-404', name: 'Não encontrado', status: 404,
    headers: { 'Content-Type': ['application/json'] },
    body: '{"error":"missing"}', savedAt: '2026-10-15T12:00:00.000Z'
  }, '__response_1__', '__request_1__', 'https://api.example.test/items/42', 123);
  assert.equal(resource._type, 'response');
  assert.equal(resource._id, '__response_1__');
  assert.equal(resource.parentId, '__request_1__');
  assert.equal(resource.statusCode, 404);
  assert.equal(resource.name, 'Não encontrado');
  assert.equal(resource.body, '{"error":"missing"}');
  assert.deepEqual(resource.headers, [{ name: 'Content-Type', value: 'application/json' }]);
});

test('collection adapters wire saved response examples through Postman and Insomnia', () => {
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  assert.ok(app.includes('RunnerLogic.buildPostmanResponseExamples'));
  assert.ok(app.includes('RunnerLogic.responseExampleToInsomniaResource'));
  assert.ok(app.includes('RunnerLogic.importResponseExamples'));
  assert.ok(app.includes('collectionHasResponseExamples'));
});
test('project artifacts use VortixApiClient names while preserving existing storage keys', () => {
  for (const file of ['VortixApiClient.csproj', 'VortixApiClient.ps1', 'VortixApiClient.cmd', 'Test-VortixApiClient.ps1']) {
    assert.ok(fs.existsSync(path.join(__dirname, file)), 'missing renamed project artifact: ' + file);
  }
  assert.equal(fs.existsSync(path.join(__dirname, 'ApiPublicacaoTester.csproj')), false, 'old project file should be retired');
  const compatibilityFiles = ['Abrir-Testador-API.cmd', 'Abrir-Testador-API.ps1', 'Validar-Testador.ps1'];
  for (const file of compatibilityFiles) {
    assert.ok(fs.existsSync(path.join(__dirname, file)), 'missing legacy compatibility wrapper: ' + file);
  }
  assert.match(fs.readFileSync(path.join(__dirname, 'Abrir-Testador-API.cmd'), 'utf8'), /VortixApiClient\.cmd/);
  assert.match(fs.readFileSync(path.join(__dirname, 'Abrir-Testador-API.ps1'), 'utf8'), /VortixApiClient\.ps1/);
  assert.match(fs.readFileSync(path.join(__dirname, 'Validar-Testador.ps1'), 'utf8'), /Test-VortixApiClient\.ps1/);
  const program = fs.readFileSync(path.join(__dirname, 'Program.cs'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  assert.match(program, /app = "ApiPublicacaoTester"/, 'existing health app field must remain compatible');
  assert.match(program, /product = "VortixApiClient"/, 'new Vortix product identifier must be exposed');
  const launcher = fs.readFileSync(path.join(__dirname, 'VortixApiClient.ps1'), 'utf8');
  const smoke = fs.readFileSync(path.join(__dirname, 'Test-VortixApiClient.ps1'), 'utf8');
  assert.match(launcher, /product -eq 'VortixApiClient'/);
  assert.match(launcher, /app -eq 'ApiPublicacaoTester'/);
  assert.match(smoke, /product -ne 'VortixApiClient'/);
  assert.match(program, /internal sealed record OAuthPkceRedirectPreviewRequest/);
  assert.match(program, /internal sealed record OAuthPkceStartRequest/);
  assert.match(program, /"ApiPublicacaoTester", "api-studio\.sqlite"/, 'existing SQLite path must stay compatible');
  assert.match(program, /SetApplicationName\("ApiPublicacaoTester"\)/, 'existing protected data must remain decryptable');
  assert.match(app, /DB_NAME = 'ApiPublicacaoTester'/, 'legacy IndexedDB migration source must remain discoverable');
  const readme = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8');
  assert.ok(readme.includes('VortixApiClient.csproj'));
  assert.match(readme, /wrappers de compatibilidade/i);
  assert.match(readme, /ApiPublicacaoTester\/api-studio\.sqlite/);
  assert.match(readme, /Data Protection.*ApiPublicacaoTester/);
});
test('OAuth authorization mock declares its form parser once', () => {
  const mock = fs.readFileSync(path.join(__dirname, 'OAuthAuthorizationServer.test.ps1'), 'utf8');
  assert.equal((mock.match(/function Get-FormMap/g) || []).length, 1);
});
test('hosted workspace limit guidance reaches the primary save toasts', () => {
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  const saveFlows = [
    ['async function addCollection(){', '\nasync function addFolder('],
    ['async function saveCollectionRequest(event){', '\nfunction loadCollectionRequest('],
    ['async function saveEnvironmentDraft(event){', '\nfunction tokenCandidate('],
    ['async function saveHistory(request,options={}){', '\nfunction applyHistoryEntry(']
  ];

  for (const [startMarker, endMarker] of saveFlows) {
    const start = app.indexOf(startMarker);
    const end = app.indexOf(endMarker, start + startMarker.length);
    assert.ok(start >= 0 && end > start, `save flow is present: ${startMarker}`);
    assert.match(app.slice(start, end), /catch\(error\)\{[^}]*error\.message/, `save flow must show the server error: ${startMarker}`);
  }
});

async function localVaultFixture(api, marker) {
  const { webcrypto } = require('node:crypto');
  const passphrase = 'correct horse battery staple';
  const vault = await api.createLocalSecretVault(passphrase, undefined, webcrypto);
  await vault.set('apiToken', marker);
  const envelope = await vault.toEnvelope();
  return { webcrypto, passphrase, vault, envelope };
}

test('Resolver com provenance usa dataset acima do cofre acima do ambiente e não expõe valores na origem', () => {
  const api = runnerLogic();
  const environmentMarker = 'ENV_SENTINEL_7c1a';
  const datasetMarker = 'DATASET_SENTINEL_84b2';
  const vaultMarker = 'VAULT_SENTINEL_1f9e';

  const result = api.resolveTemplateWithProvenance(
    '{{baseUrl}}/items/{{id}}?token={{token}}&region={{region}}',
    { baseUrl: 'https://api.example.test', id: environmentMarker, token: environmentMarker, region: 'west' },
    { id: datasetMarker },
    { id: 'vault-id-must-lose-to-runner', token: vaultMarker }
  );

  assert.equal(result.text, `https://api.example.test/items/${datasetMarker}?token=${vaultMarker}&region=west`);
  assert.deepEqual(result.provenance, {
    baseUrl: 'environment',
    id: 'dataset',
    token: 'vault',
    region: 'environment'
  });
  const provenance = JSON.stringify(result.provenance);
  for (const marker of [environmentMarker, datasetMarker, vaultMarker]) {
    assert.doesNotMatch(provenance, new RegExp(marker), 'a origem não pode carregar o valor substituído');
  }
});

test('Resolver com provenance bloqueia nome conhecido do cofre mesmo com valor obsoleto no ambiente', () => {
  const api = runnerLogic();
  const staleToken = 'STALE_ENV_TOKEN_SENTINEL';
  let resolved;

  assert.throws(() => {
    resolved = api.resolveTemplateWithProvenance('{{apiToken}}', { apiToken: staleToken }, {}, { locked: true, names: ['apiToken'] });
  }, error => {
    assert.match(error.message, /cofre/i);
    assert.match(error.message, /bloquead/i);
    assert.doesNotMatch(error.message, new RegExp(staleToken));
    return true;
  });
  assert.equal(resolved, undefined, 'o template não pode retornar o token obsoleto do ambiente');
});

test('Resolver com provenance mantém erro claro para ausentes e preserva resolveTemplate existente', () => {
  const api = runnerLogic();
  assert.throws(() => api.resolveTemplateWithProvenance('/items/{{missingSecret}}', { present: 'value' }, {}, { other: 'value' }), /missingSecret/);
  assert.equal(api.resolveTemplate('{{id}}/{{token}}', { id: 'environment-id', token: 'environment-token' }, { id: 'runner-id' }), 'runner-id/environment-token');
});

test('Cofre local persiste apenas envelope cifrado, desbloqueia com a senha certa e bloqueia os valores', async () => {
  const { webcrypto } = require('node:crypto');
  const api = runnerLogic();
  const passphrase = 'correct horse battery staple';
  const marker = 'LOCAL_VAULT_SECRET_SENTINEL_5d42';

  const vault = await api.createLocalSecretVault(passphrase, undefined, webcrypto);
  assert.ok(vault && typeof vault === 'object', 'createLocalSecretVault deve retornar um cofre.');
  await vault.set('apiToken', marker);
  assert.equal(await vault.get('apiToken'), marker);

  const envelope = await vault.toEnvelope();
  const serialized = JSON.stringify(envelope);
  assert.equal(typeof envelope.ciphertext, 'string', 'O envelope deve conter ciphertext.');
  assert.ok(envelope.ciphertext.length > 0, 'O envelope cifrado não pode ficar vazio.');
  assert.doesNotMatch(serialized, new RegExp(marker), 'O envelope não pode conter o segredo em plaintext.');
  assert.equal(Object.hasOwn(envelope, 'key'), false, 'A chave criptográfica não pode ser serializada no envelope.');
  assert.doesNotMatch(serialized, /"key"\s*:/i, 'A chave criptográfica não pode ser persistida.');

  await vault.lock();
  await assert.rejects(vault.get('apiToken'), /bloquead|locked|inacess|cofre/i, 'valores bloqueados devem falhar com mensagem clara.');
  assert.doesNotMatch(JSON.stringify(vault), new RegExp(marker), 'Após lock, a serialização do cofre não pode conter o segredo.');
  assert.doesNotMatch(JSON.stringify(vault), /"key"\s*:/i, 'Após lock, a chave criptográfica não pode ser serializada.');

  await vault.unlock(passphrase);
  assert.equal(await vault.get('apiToken'), marker);

  const reopened = await api.openLocalSecretVault(serialized, passphrase, webcrypto);
  assert.equal(await reopened.get('apiToken'), marker);

  await assert.rejects(
    api.openLocalSecretVault(serialized, 'incorrect horse battery staple', webcrypto),
    /incorreta|danific|senha|inválid/i,
    'Senha incorreta deve falhar sem revelar o segredo.'
  );

  const tampered = { ...envelope, ciphertext: envelope.ciphertext.slice(0, -4) + 'AAAA' };
  await assert.rejects(
    api.openLocalSecretVault(JSON.stringify(tampered), passphrase, webcrypto),
    /incorreta|danific|inválid/i,
    'Envelope adulterado deve falhar.'
  );
});

test('Cofre local gera um IV novo em cada snapshot mesmo ao regravar o mesmo nome e valor', async () => {
  const { webcrypto } = require('node:crypto');
  const api = runnerLogic();
  const vault = await api.createLocalSecretVault('correct horse battery staple', undefined, webcrypto);
  const marker = 'LOCAL_VAULT_SAME_VALUE_SENTINEL_6a1d';

  await vault.set('apiToken', marker);
  const first = await vault.toEnvelope();
  await vault.set('apiToken', marker);
  const second = await vault.toEnvelope();

  assert.equal(typeof first.iv, 'string', 'O envelope deve expor o IV usado na cifragem.');
  assert.ok(first.iv.length > 0, 'O IV do primeiro snapshot não pode ficar vazio.');
  assert.equal(typeof second.iv, 'string', 'O segundo snapshot também deve expor o IV.');
  assert.ok(second.iv.length > 0, 'O IV do segundo snapshot não pode ficar vazio.');
  assert.notEqual(second.iv, first.iv, 'Cada gravação deve gerar um novo IV no snapshot, mesmo com o mesmo nome e valor.');
  assert.doesNotMatch(JSON.stringify([first, second]), new RegExp(marker), 'Os snapshots não podem conter o segredo em plaintext.');
});

test('Cofre local rejeita senha abaixo de 12 caracteres com erro claro', async () => {
  const { webcrypto } = require('node:crypto');
  const api = runnerLogic();
  const minLength = api.workspaceBackupPassphraseMinLength;
  assert.equal(minLength, 12, 'O cofre local deve usar o mínimo já definido para backups.');
  const shortPassphrase = 'x'.repeat(minLength - 1);

  await assert.rejects(
    api.createLocalSecretVault(shortPassphrase, undefined, webcrypto),
    error => {
      assert.match(error.message, /pelo menos 12 caracteres/i, 'O erro deve explicar o mínimo de 12 caracteres.');
      return true;
    },
    'Senha curta deve ser rejeitada.'
  );
});

test('Backup simples guarda só o envelope opaco do cofre e o backup protegido continua o round-trip', async () => {
  const { webcrypto } = require('node:crypto');
  const api = runnerLogic();
  const marker = 'WORKSPACE_VAULT_SECRET_SENTINEL_9b31';
  const fixture = await localVaultFixture(api, marker);
  const source = {
    collections: [{
      id: 'collection-1', name: 'Coleção', folders: [],
      requests: [{ id: 'request-1', name: 'Token', method: 'POST', route: '/token', body: '{"token":"{{apiToken}}"}' }]
    }],
    environments: [{ id: 'environment-1', name: 'Local', variables: { baseUrl: 'https://api.example.test' } }],
    history: [],
    settings: [{ key: 'localSecretVault', value: fixture.envelope }]
  };

  const backup = api.createWorkspaceBackup(source, '2026-10-19T12:00:00.000Z');
  const serialized = JSON.stringify(backup);
  assert.doesNotMatch(serialized, new RegExp(marker), 'Backup JSON simples não pode conter o segredo em plaintext.');
  assert.ok(serialized.includes(fixture.envelope.ciphertext), 'O backup deve manter o envelope cifrado opaco do cofre.');
  assert.doesNotMatch(JSON.stringify(backup.data.collections), new RegExp(marker), 'Coleções exportadas não podem carregar valores do cofre.');
  assert.doesNotMatch(JSON.stringify(backup.data.collections), /ciphertext/i, 'Coleções exportadas não podem embutir o envelope do cofre.');
  assert.doesNotMatch(JSON.stringify(backup.data.environments), new RegExp(marker), 'Ambientes exportados não podem carregar valores do cofre.');

  const restored = api.parseWorkspaceBackup(serialized);
  const restoredText = JSON.stringify(restored);
  assert.ok(restoredText.includes(fixture.envelope.ciphertext), 'O envelope deve voltar no restore do backup simples.');
  assert.doesNotMatch(restoredText, new RegExp(marker));

  const protectedBackup = await api.encryptWorkspaceBackup(serialized, fixture.passphrase, webcrypto);
  const protectedText = JSON.stringify(protectedBackup);
  assert.doesNotMatch(protectedText, new RegExp(marker), 'Backup protegido não pode expor o segredo do cofre.');
  const decrypted = await api.decryptWorkspaceBackup(protectedText, fixture.passphrase, webcrypto);
  assert.ok(JSON.stringify(decrypted).includes(fixture.envelope.ciphertext), 'Backup protegido deve preservar o envelope do cofre.');
  assert.doesNotMatch(JSON.stringify(decrypted), new RegExp(marker));
});

test('Contrato existente de captura de variável de resposta permanece compatível', () => {
  const { prepareSavedRequest } = runnerLogic();
  const prepared = prepareSavedRequest({
    method: 'POST', route: '/token', body: '{}',
    captureResponseVariable: true, responseVariableName: 'apiToken',
    responseValueSource: 'json', responseJsonPath: 'data.token', responseSuccessOnly: true
  }, {}, {}, true);
  assert.equal(prepared.captureResponseVariable, true);
  assert.equal(prepared.responseVariableName, 'apiToken');
  assert.equal(prepared.responseValueSource, 'json');
  assert.equal(prepared.responseJsonPath, 'data.token');
  assert.equal(prepared.responseSuccessOnly, true);
});

test('Resolver falha fechado com cofre indisponível e não expõe token obsoleto do ambiente', () => {
  const { resolveTemplateWithProvenance } = runnerLogic();
  const staleToken = 'STALE_ENV_TOKEN_SENTINEL';

  assert.throws(
    () => resolveTemplateWithProvenance('{{apiToken}}', { apiToken: staleToken }, {}, { unavailable: true }),
    error => {
      assert.match(error.message, /cofre/i);
      assert.match(error.message, /indispon/i);
      assert.doesNotMatch(error.message, new RegExp(staleToken));
      return true;
    }
  );
});

test('Captura no cofre falha fechado quando a request ou o cofre não pertencem ao ambiente ativo', () => {
  const { vaultCaptureEnvironmentError } = runnerLogic();
  const current = { unlocked: true, activeEnvironmentId: 'env-a', vaultEnvironmentId: 'env-a', requestEnvironmentId: 'env-a' };
  assert.equal(vaultCaptureEnvironmentError(current), '');
  assert.match(vaultCaptureEnvironmentError({ ...current, loading: true }), /carregando/i);
  assert.match(vaultCaptureEnvironmentError({ ...current, unavailable: true }), /indispon/i);
  assert.match(vaultCaptureEnvironmentError({ ...current, vaultEnvironmentId: 'env-b' }), /outro ambiente/i);
  assert.match(vaultCaptureEnvironmentError({ ...current, requestEnvironmentId: 'env-b' }), /ambiente ativo mudou/i);
  assert.match(vaultCaptureEnvironmentError({ ...current, requestEnvironmentId: null }), /ambiente ativo mudou/i);
  assert.match(vaultCaptureEnvironmentError({ ...current, unlocked: false }), /bloqueado/i);
});

test('Redige valores do cofre em origens e URLs antes de exibir destinos', () => {
  const { redactSecretValues } = runnerLogic();
  const secret = 'tenant secret/A';
  assert.equal(redactSecretValues(`http://${secret}.example.test:8080`, { tenant: secret }), 'http://{{segredo}}.example.test:8080');
  assert.equal(redactSecretValues(`http://api.example.test/${encodeURIComponent(secret)}`, { tenant: secret }), 'http://api.example.test/{{segredo}}');
  assert.equal(redactSecretValues('http://api.example.test', null), 'http://api.example.test');
});

test('Redige segredo do cofre escapado em string JSON', () => {
  const { redactSecretValues } = runnerLogic();
  const secret = 'pa"ss\\word\n';
  const echoedBody = JSON.stringify({ value: secret });

  assert.equal(redactSecretValues(echoedBody, { token: secret }), '{"value":"{{segredo}}"}');
  assert.equal(redactSecretValues('{"value":"pa\\u0022ss"}', { token: 'pa"ss' }), '{"value":"{{segredo}}"}');
  assert.equal(redactSecretValues('{"value":"line\\u000Afeed"}', { token: 'line\nfeed' }), '{"value":"{{segredo}}"}');
  assert.equal(redactSecretValues('{"value":"a\\/b"}', { token: 'a/b' }), '{"value":"{{segredo}}"}');
  assert.equal(redactSecretValues('{"value":"{"}', { token: '{' }), '{"value":"{{segredo}}"}');
  assert.equal(redactSecretValues('{"delimiter":"{","flag":true,"id":123}', { delimiter: '{', flag: 'true', id: '123' }), '{"delimiter":"{{segredo}}","flag":"{{segredo}}","id":"{{segredo}}"}');
  assert.equal(redactSecretValues('Error near { token', { token: '{' }), 'Error near {{segredo}} token');
  const untouchedJson = '{\n  "value": "ordinary"\n}';
  assert.equal(redactSecretValues(untouchedJson, { token: secret }), untouchedJson);
});

test('Inspetor puro lista referências de ambiente, dataset, cofre e ausentes sem expor valores', () => {
  const { inspectTemplateReferences } = runnerLogic();
  const environmentMarker = 'ENV_TOKEN_SENTINEL';
  const datasetMarker = 'DATASET_ID_SENTINEL';
  const vaultMarker = 'VAULT_TOKEN_SENTINEL';
  const references = inspectTemplateReferences({
    baseUrl: '{{baseUrl}}',
    route: '/items/{{id}}/{{apiToken}}/{{missing}}'
  }, { baseUrl: 'https://api.example.test', id: 'ENV_ID_SENTINEL', apiToken: environmentMarker }, { id: datasetMarker }, { apiToken: vaultMarker });

  assert.deepEqual(references, [
    { field: 'baseUrl', name: 'baseUrl', source: 'environment' },
    { field: 'route', name: 'id', source: 'dataset' },
    { field: 'route', name: 'apiToken', source: 'vault' },
    { field: 'route', name: 'missing', source: 'missing' }
  ]);
  const serialized = JSON.stringify(references);
  for (const marker of ['ENV_ID_SENTINEL', environmentMarker, datasetMarker, vaultMarker]) {
    assert.doesNotMatch(serialized, new RegExp(marker));
  }
});

test('Inspetor puro marca como locked nome conhecido do cofre mesmo com valor obsoleto no ambiente', () => {
  const { inspectTemplateReferences } = runnerLogic();
  const staleToken = 'STALE_ENV_TOKEN_SENTINEL';
  const references = inspectTemplateReferences(
    { route: '/items/{{apiToken}}' },
    { apiToken: staleToken },
    {},
    { locked: true, names: ['apiToken'] }
  );

  assert.deepEqual(references, [{ field: 'route', name: 'apiToken', source: 'locked' }]);
  assert.doesNotMatch(JSON.stringify(references), new RegExp(staleToken));
});

test('Ambientes sem nome ou ainda não criados têm rótulos visíveis no seletor', () => {
  const { normalizeEnvironmentPickerEntries } = runnerLogic();
  assert.deepEqual(normalizeEnvironmentPickerEntries([]), [
    { id: '', name: 'Nenhum ambiente criado', group: '', disabled: true }
  ]);
  assert.deepEqual(normalizeEnvironmentPickerEntries([
    { id: 'local', name: '', group: 'Local' },
    { id: 'test', name: 'Teste', group: 'API' }
  ]), [
    { id: 'local', name: 'Ambiente sem nome', group: 'Local', disabled: false },
    { id: 'test', name: 'Teste', group: 'API', disabled: false }
  ]);
});

test('Seletor de ambiente começa bloqueado e segue bloqueado quando ambiente não carregou', () => {
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, 'wwwroot', 'index.html'), 'utf8');
  const start = app.indexOf('function renderEnvironmentSelect(){');
  const end = app.indexOf('async function chooseEnvironment', start);
  const render = app.slice(start, end);

  assert.ok(/<select id="environment-select"[^>]*disabled[^>]*>[\s\S]*?Carregando ambientes/.test(html), 'picker should stay disabled before storage loads');
  assert.ok(/select\.disabled=entries\.every\(entry=>entry\.disabled\)/.test(render), 'picker should disable when all normalized entries are placeholders');
});

test('Cabeçalho dá acesso direto à criação e gestão de ambientes', () => {
  const html = fs.readFileSync(path.join(__dirname, 'wwwroot', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  assert.match(html, /id="manage-environments-direct"[^>]*>Gerenciar ambientes<\/button>/);
  assert.match(app, /manage-environments-direct'\)\.onclick=openEnvironmentDialog/);
});

test('Resposta salva no histórico redige segredos do cofre em body, reason e headers', () => {
  const { createResponseHistorySnapshot, normalizeHistorySettings } = runnerLogic();
  const secret = 'VAULT_ECHO_SENTINEL_71a9';
  const snapshot = createResponseHistorySnapshot({
    status: 200,
    reason: 'Echo ' + secret,
    headers: { 'X-Echo': [secret], 'Content-Type': ['application/json'] },
    body: JSON.stringify({ value: secret })
  }, 12, normalizeHistorySettings({ saveResponseBody: true }), { token: secret });

  assert.equal(snapshot.reason, 'Echo {{segredo}}');
  assert.deepEqual(snapshot.headers, { 'X-Echo': ['{{segredo}}'], 'Content-Type': ['application/json'] });
  assert.equal(snapshot.body, '{"value":"{{segredo}}"}');
  assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(secret));
});

test('Redação de preview usa apenas segredos que vieram do cofre', () => {
  const { secretValuesUsedByProvenance, redactSecretValues } = runnerLogic();
  const secret = 'RUNNER_ECHO_SENTINEL_248e';
  const values = secretValuesUsedByProvenance({ token: 'vault', tenant: 'environment', rowId: 'dataset' }, {
    token: secret, tenant: 'ordinary-env-value', rowId: 'dataset-value'
  });

  assert.deepEqual({ ...values }, { token: secret });
  assert.equal(redactSecretValues(JSON.stringify({ value: secret }), values), '{"value":"{{segredo}}"}');
});

test('Runner aplica redação por request antes de renderizar body de resposta', () => {
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  assert.ok(app.includes('runnerBodyPreview(RunnerLogic.redactSecretValues(result.body,responseVaultSecrets))'));
  assert.match(app, /caseStatus=status\?RunnerLogic\.redactSecretValues\(`\$\{status\} \$\{result\.reason\|\|''\}`,responseVaultSecrets\)\.trim\(\):/);
  assert.ok(app.includes('RunnerLogic.redactSecretValues(result.error,responseVaultSecrets)'));
  assert.ok(app.includes('RunnerLogic.redactSecretValues(error.message,responseVaultSecrets)'));
});

test('Fluxos OAuth e token helper redigem segredos do cofre antes de salvar respostas no histórico', () => {
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  for (const functionName of ['requestOAuthClientCredentialsToken', 'requestTokenFromHelper']) {
    const start = app.indexOf(`async function ${functionName}(){`);
    assert.ok(start >= 0, `${functionName} deve existir`);
    const nextFunction = app.slice(start + 1).search(/\n(?:async )?function /);
    const source = app.slice(start, nextFunction < 0 ? app.length : start + 1 + nextFunction);
    assert.match(source, /lastResolutionProvenance=\{\};/);
    assert.match(source, /request\.resolutionProvenance=\{\.\.\.lastResolutionProvenance\}/);
    assert.match(source, /responseVaultSecrets=RunnerLogic\.secretValuesUsedByProvenance\(request\.resolutionProvenance,secretVaultValues\|\|\{\}\)/);
    assert.match(source, /saveHistoryResponse\(historyEntry,result,responseDuration,responseVaultSecrets\)/);
  }
});

test('Abas restauram destino de captura salvo em cada rascunho', () => {
  const app = fs.readFileSync(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  const start = app.indexOf('function applyWorkspaceDraft(draft){');
  const end = app.indexOf('\nfunction applyWorkspaceTab(tab){', start);
  assert.ok(start >= 0 && end > start, 'applyWorkspaceDraft deve existir');
  assert.match(app.slice(start, end), /response-capture-target'\)\.value=draft\.responseCaptureTarget==='vault'\?'vault':'environment'/);
});

test('Exporta ambiente isolado como Postman JSON com credenciais omitidas por padrão', () => {
  const { buildPostmanEnvironmentExport, importPostmanEnvironment } = runnerLogic();
  const environment = {
    id: 'environment-local',
    name: 'Desenvolvimento',
    group: 'Local',
    variables: {
      baseUrl: 'https://api.example.test',
      clientSecret: 'SECRET_SENTINEL',
      cookie: 'COOKIE_SENTINEL',
      private_key: 'PRIVATE_KEY_SENTINEL',
      'private.key': 'PRIVATE_DOT_KEY_SENTINEL',
      'private.key.pem': 'PRIVATE_DOT_PEM_SENTINEL',
      optional: ''
    }
  };
  const exported = buildPostmanEnvironmentExport(environment, {
    id: 'postman-environment-id',
    exportedAt: '2026-10-20T12:00:00.000Z'
  });

  assert.deepEqual(exported, {
    id: 'postman-environment-id',
    name: 'Desenvolvimento',
    values: [
      { key: 'baseUrl', value: 'https://api.example.test', type: 'default', enabled: true },
      { key: 'optional', value: '', type: 'default', enabled: true }
    ],
    _postman_variable_scope: 'environment',
    _postman_exported_at: '2026-10-20T12:00:00.000Z',
    _postman_exported_using: 'Vortix'
  });
  assert.doesNotMatch(JSON.stringify(exported), /SECRET_SENTINEL|COOKIE_SENTINEL|PRIVATE_KEY_SENTINEL|PRIVATE_DOT_KEY_SENTINEL|PRIVATE_DOT_PEM_SENTINEL/);
  assert.deepEqual(importPostmanEnvironment(exported), {
    name: 'Desenvolvimento',
    group: 'Importado',
    variables: { baseUrl: 'https://api.example.test', optional: '' }
  });
});

test('Exporta variáveis sensíveis como Postman secret somente quando usuário permite', () => {
  const { buildPostmanEnvironmentExport, importPostmanEnvironment } = runnerLogic();
  const exported = buildPostmanEnvironmentExport({
    name: 'Homologação',
    variables: { token: 'TOKEN_SENTINEL', region: 'south', cookie: 'COOKIE_SENTINEL', private_key: 'PRIVATE_KEY_SENTINEL', 'private key': 'PRIVATE_KEY_SPACE_SENTINEL', 'private.key.pem': 'PRIVATE_DOT_PEM_SENTINEL' }
  }, { includeSensitive: true, id: 'environment-id', exportedAt: '2026-10-20T12:00:00.000Z' });

  assert.deepEqual(exported.values, [
    { key: 'token', value: 'TOKEN_SENTINEL', type: 'secret', enabled: true },
    { key: 'region', value: 'south', type: 'default', enabled: true }
  ]);
  assert.doesNotMatch(JSON.stringify(exported), /COOKIE_SENTINEL|PRIVATE_KEY_SENTINEL|PRIVATE_KEY_SPACE_SENTINEL|PRIVATE_DOT_PEM_SENTINEL/);
  assert.equal(importPostmanEnvironment(exported).variables.token, 'TOKEN_SENTINEL');
});

test('buildCurlCommand redacts auth, sensitive headers and query params, and the whole body by default', () => {
  const { buildCurlCommand } = runnerLogic();
  const marker = 'CURL_SECRET_SENTINEL_4f8c';
  const result = buildCurlCommand({
    method: 'post',
    url: `https://api.example.test/v1/items?page=2&token=${marker}&region=south`,
    headers: `Content-Type: application/json\nAuthorization: Bearer ${marker}\nX-Api-Key: ${marker}\nX-Trace: trace-1`,
    body: `{"token":"${marker}"}`,
    authType: 'bearer',
    bearerToken: marker
  }, { shell: 'bash' });

  assert.equal(result.command, "curl --request POST --url 'https://api.example.test/v1/items?page=2&region=south' --header 'Content-Type: application/json' --header 'X-Trace: trace-1'");
  assert.doesNotMatch(JSON.stringify(result), new RegExp(marker));
  assert.ok(result.warnings.some(warning => /autentica/i.test(warning)), 'auth omission should be announced');
  assert.ok(result.warnings.some(warning => /header/i.test(warning)), 'sensitive header omission should be announced');
  assert.ok(result.warnings.some(warning => /query/i.test(warning)), 'sensitive query omission should be announced');
  assert.ok(result.warnings.some(warning => /body/i.test(warning)), 'body omission should be announced');
  assert.doesNotMatch(result.warnings.join(' '), /includeSensitive|true/);
});

test('buildCurlCommand also omits the configured API Key query name when it is generic', () => {
  const { buildCurlCommand } = runnerLogic();
  const key = 'GENERIC_QUERY_KEY_CANARY';
  const result = buildCurlCommand({
    method: 'GET', url: `https://api.example.test/users?page=2&key=${key}`,
    authType: 'apiKey', apiKeyName: 'key', apiKeyLocation: 'query', apiKeyValue: key
  }, { shell: 'bash' });
  assert.equal(result.command, "curl --request GET --url 'https://api.example.test/users?page=2'");
  assert.doesNotMatch(result.command, new RegExp(key));
  assert.ok(result.warnings.some(warning => /query/i.test(warning)));
});

test('buildCurlCommand omits a configured API Key header even when its name looks ordinary', () => {
  const { buildCurlCommand } = runnerLogic();
  const key = 'CUSTOM_HEADER_KEY_CANARY';
  const result = buildCurlCommand({
    method: 'GET', url: 'https://api.example.test/users',
    headers: `X-Subscription: ${key}\nAccept: application/json`,
    authType: 'apiKey', apiKeyName: 'X-Subscription', apiKeyLocation: 'header', apiKeyValue: key
  }, { shell: 'bash' });
  assert.equal(result.command, "curl --request GET --url 'https://api.example.test/users' --header 'Accept: application/json'");
  assert.doesNotMatch(result.command, new RegExp(key));
  assert.ok(result.warnings.some(warning => /header/i.test(warning)));
});

test('buildCurlCommand includes opted-in auth, headers, API key, and body with shell-specific quoting', () => {
  const { buildCurlCommand } = runnerLogic();
  const quoteBash = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
  const quotePowerShell = value => "'" + String(value).replaceAll("'", "''") + "'";
  const body = '{"name":"Ana\'s"}';
  const request = {
    method: 'PATCH',
    url: 'https://api.example.test/v1/items?region=south',
    headers: { 'Content-Type': 'application/json' },
    body,
    authType: 'basic',
    basicUsername: 'alice',
    basicPassword: 'p@ss'
  };

  const bash = buildCurlCommand(request, { includeSensitive: true, shell: 'bash' });
  assert.ok(bash.command.startsWith("curl --request PATCH --url 'https://api.example.test/v1/items?region=south'"));
  assert.ok(bash.command.includes("--user 'alice:p@ss'"));
  assert.ok(bash.command.includes("--header 'Content-Type: application/json'"));
  assert.doesNotMatch(bash.command, /Authorization: Basic/);
  assert.ok(bash.command.includes('--data-raw ' + quoteBash(body)));
  assert.deepEqual(bash.warnings, []);

  const powershell = buildCurlCommand(request, { includeSensitive: true, shell: 'powershell' });
  assert.ok(powershell.command.startsWith('curl.exe '));
  assert.ok(powershell.command.includes('--data-raw ' + quotePowerShell(body)));

  const apiKeyHeader = buildCurlCommand({
    method: 'GET', url: 'https://api.example.test/v1/items', headers: 'Accept: application/json',
    authType: 'apiKey', apiKeyName: 'X-API-Key', apiKeyLocation: 'header', apiKeyValue: 'key with space'
  }, { includeSensitive: true, shell: 'bash' });
  assert.ok(apiKeyHeader.command.includes("--header 'X-API-Key: key with space'"));

  const apiKeyQuery = buildCurlCommand({
    method: 'GET', url: 'https://api.example.test/v1/items', headers: 'Accept: application/json',
    authType: 'apiKey', apiKeyName: 'api key', apiKeyLocation: 'query', apiKeyValue: 'a&b c'
  }, { includeSensitive: true, shell: 'bash' });
  assert.equal(apiKeyQuery.command, "curl --request GET --url 'https://api.example.test/v1/items?api%20key=a%26b%20c' --header 'Accept: application/json'");

  const redactedQuery = buildCurlCommand({
    method: 'GET', url: 'https://api.example.test/v1/items', headers: 'Accept: application/json',
    authType: 'apiKey', apiKeyName: 'api key', apiKeyLocation: 'query', apiKeyValue: 'a&b c'
  }, { shell: 'bash' });
  assert.equal(redactedQuery.command, "curl --request GET --url 'https://api.example.test/v1/items' --header 'Accept: application/json'");
  assert.ok(redactedQuery.warnings.some(warning => /autentica/i.test(warning)));
});

test('buildCurlCommand quotes command substitutions and quotes safely for Bash and PowerShell', () => {
  const { buildCurlCommand } = runnerLogic();
  const quoteBash = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
  const quotePowerShell = value => "'" + String(value).replaceAll("'", "''") + "'";
  const headerValue = 'a\'b $(touch nope) `id` "c"';
  const body = 'O\'Brien $(touch nope) `whoami` "quoted"';
  const request = { method: 'POST', url: 'https://api.example.test/v1/items', headers: `X-Test: ${headerValue}`, body };

  const bash = buildCurlCommand(request, { includeSensitive: true, shell: 'bash' });
  assert.ok(bash.command.startsWith('curl --request POST --url '));
  assert.ok(bash.command.includes('--header ' + quoteBash('X-Test: ' + headerValue)));
  assert.ok(bash.command.includes('--data-raw ' + quoteBash(body)));

  const powershell = buildCurlCommand(request, { includeSensitive: true, shell: 'powershell' });
  assert.ok(powershell.command.startsWith('curl.exe --request POST --url '));
  assert.ok(powershell.command.includes('--header ' + quotePowerShell('X-Test: ' + headerValue)));
  assert.ok(powershell.command.includes('--data-raw ' + quotePowerShell(body)));
});

test('buildCurlCommand validates the HTTP method allowlist and absolute HTTP(S) URLs', () => {
  const { buildCurlCommand } = runnerLogic();
  const valid = { method: 'GET', url: 'https://api.example.test/v1/items' };

  assert.throws(() => buildCurlCommand({ ...valid, method: 'TRACE' }), /método/i);
  assert.throws(() => buildCurlCommand({ ...valid, url: '/v1/items' }), /absoluta|HTTP/i);
  assert.throws(() => buildCurlCommand({ ...valid, url: 'ftp://api.example.test/v1/items' }), /HTTP/i);
  assert.throws(() => buildCurlCommand({ ...valid, url: credentialedTestUrl() }), /credenciais/i);
  assert.throws(() => buildCurlCommand({ ...valid, url: 'https://api.example.test/v1/items#fragment' }), /fragmento/i);
  assert.throws(() => buildCurlCommand({ ...valid, body: '{}' }), /body/i);
});

test('buildCurlCommand preserves Vortix templates and warns that they are not resolved outside the app', () => {
  const { buildCurlCommand } = runnerLogic();
  const result = buildCurlCommand({
    method: 'POST',
    url: 'https://api.example.test/v1/{{path}}?id={{id}}',
    headers: 'X-Tenant: {{tenant}}',
    body: '{"id":"{{id}}"}',
    authType: 'apiKey', apiKeyName: 'X-API-Key', apiKeyLocation: 'header', apiKeyValue: '{{apiKey}}'
  }, { includeSensitive: true, shell: 'bash' });

  assert.ok(result.command.includes("--url 'https://api.example.test/v1/{{path}}?id={{id}}'"));
  assert.ok(result.command.includes("--header 'X-Tenant: {{tenant}}'"));
  assert.ok(result.command.includes("--header 'X-API-Key: {{apiKey}}'"));
  assert.ok(result.command.includes('--data-raw \'{"id":"{{id}}"}\''));
  assert.ok(result.warnings.some(warning => /template.*vortix|vortix.*template/i.test(warning)));
});

test('buildCurlCommand preserves pure and partial base URL templates with string warnings', () => {
  const { buildCurlCommand } = runnerLogic();
  for (const url of ['{{baseUrl}}', '{{baseUrl}}/v1/items', '{{baseUrl}}/v1/items?page={{page}}']) {
    const result = buildCurlCommand({ method: 'GET', url }, { shell: 'bash' });
    assert.equal(result.command, "curl --request GET --url '" + url + "'");
    assert.ok(Array.isArray(result.warnings));
    assert.ok(result.warnings.every(warning => typeof warning === 'string'));
    assert.ok(result.warnings.some(warning => /template/i.test(warning) && /substitu/i.test(warning) && /vortix/i.test(warning)));
    assert.doesNotMatch(result.command, /Authorization|Basic/);
  }
});

test('buildCurlCommand validates literal HTTP(S) structure after safely masking URL templates', () => {
  const { buildCurlCommand } = runnerLogic();
  const url = 'https://{{tenant}}.api.example.test/v1/{{path}}?id={{id}}&token={{token}}';
  const result = buildCurlCommand({ method: 'GET', url }, { includeSensitive: true, shell: 'bash' });
  assert.equal(result.command, "curl --request GET --url '" + url + "'");
  assert.ok(result.warnings.some(warning => /template/i.test(warning)));

  const port = buildCurlCommand({ method: 'GET', url: 'https://api.example.test:{{port}}/v1' }, { shell: 'bash' });
  assert.equal(port.command, "curl --request GET --url 'https://api.example.test:{{port}}/v1'");
});

test('buildCurlCommand rejects malformed or unsafe URL templates without masking credentials or fragments', () => {
  const { buildCurlCommand } = runnerLogic();
  const request = url => ({ method: 'GET', url });

  assert.throws(() => buildCurlCommand(request('https://{{user}}:{{pass}}@api.example.test/x'), { includeSensitive: true }), /credenciais/i);
  assert.throws(() => buildCurlCommand(request('https://{{userinfo}}@api.example.test/x'), { includeSensitive: true }), /credenciais/i);
  assert.throws(() => buildCurlCommand(request('https://api.example.test/{{path}}#fragment')), /fragmento/i);
  assert.throws(() => buildCurlCommand(request('{{baseUrl}}#fragment')), /fragmento/i);
  assert.throws(() => buildCurlCommand(request('{{baseUrl}}@api.example.test')), /credenciais/i);
  assert.throws(() => buildCurlCommand(request('{{scheme}}://api.example.test/x')), /esquema/i);
  assert.throws(() => buildCurlCommand(request('{{baseUrl}}evil.example.test')), /posição insegura/i);
  assert.throws(() => buildCurlCommand(request('https://api.example.test/{{oops')), /malformado/i);
  assert.throws(() => buildCurlCommand(request('https://api.example.test/{{a b}}')), /template/i);
});

test('buildCurlCommand keeps Basic credential templates verbatim in --user and never base64-encodes placeholders', () => {
  const { buildCurlCommand } = runnerLogic();
  const request = {
    method: 'POST', url: 'https://api.example.test/oauth/token', body: 'grant_type=client_credentials',
    authType: 'basic', basicUsername: '{{clientId}}', basicPassword: '{{secret}}'
  };
  const bash = buildCurlCommand(request, { includeSensitive: true, shell: 'bash' });
  assert.ok(bash.command.includes("--user '{{clientId}}:{{secret}}'"));
  assert.doesNotMatch(bash.command, /Authorization: Basic/);
  assert.equal(bash.command.includes(Buffer.from('{{clientId}}:{{secret}}', 'utf8').toString('base64')), false);
  assert.ok(bash.warnings.some(warning => /template/i.test(warning) && /vortix/i.test(warning)));

  const powershell = buildCurlCommand(request, { includeSensitive: true, shell: 'powershell' });
  assert.ok(powershell.command.includes("--user '{{clientId}}:{{secret}}'"));

  const literal = buildCurlCommand({
    method: 'GET', url: 'https://api.example.test/me',
    authType: 'basic', basicUsername: "o'neil", basicPassword: 'p@ss $(touch nope)'
  }, { includeSensitive: true, shell: 'bash' });
  assert.ok(literal.command.includes("--user 'o'\\''neil:p@ss $(touch nope)'"));
});

test('buildCurlCommand fails instead of emitting manual Authorization that the proxy rejects', () => {
  const { buildCurlCommand } = runnerLogic();
  const request = {
    method: 'GET', url: 'https://api.example.test/me',
    headers: 'Authorization: Bearer header-secret\nAccept: application/json',
    authType: 'bearer', bearerToken: 'configured-secret'
  };
  assert.throws(() => buildCurlCommand(request, { includeSensitive: true, shell: 'bash' }), error => {
    assert.match(error.message, /Authorization/i);
    assert.match(error.message, /proxy|Auth|Headers/i);
    assert.doesNotMatch(error.message, /header-secret|configured-secret/);
    return true;
  });
  assert.throws(() => buildCurlCommand({
    method: 'GET', url: 'https://api.example.test/me', headers: 'authorization: Bearer manual-secret'
  }, { includeSensitive: true }), /Authorization/i);

  const safe = buildCurlCommand(request, { shell: 'bash' });
  assert.doesNotMatch(safe.command, /header-secret|configured-secret|Authorization/i);
  assert.ok(safe.warnings.some(warning => /header/i.test(warning)));
});

test('buildCurlCommand rejects case-insensitive API key header duplication that the proxy blocks', () => {
  const { buildCurlCommand } = runnerLogic();
  const request = {
    method: 'GET', url: 'https://api.example.test/items',
    headers: 'x-api-key: manual-key\nAccept: application/json',
    authType: 'apiKey', apiKeyName: 'X-API-Key', apiKeyLocation: 'header', apiKeyValue: 'configured-key'
  };
  assert.throws(() => buildCurlCommand(request, { includeSensitive: true, shell: 'bash' }), error => {
    assert.match(error.message, /API Key/i);
    assert.match(error.message, /header|Headers/i);
    assert.doesNotMatch(error.message, /manual-key|configured-key/);
    return true;
  });

  const safe = buildCurlCommand(request, { shell: 'bash' });
  assert.doesNotMatch(safe.command, /manual-key|configured-key|API-Key/i);
  assert.ok(safe.warnings.some(warning => /header/i.test(warning)));
});

test('buildCurlCommand serializes non-multipart bodies literally and warns about remaining templates', () => {
  const { buildCurlCommand } = runnerLogic();
  const quoteBash = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
  const body = '{"text":"O\'Brien {{name}}","nested":{"value":"x&y"}}';
  const result = buildCurlCommand({
    method: 'POST', url: 'https://api.example.test/items', body, bodyMode: 'json'
  }, { includeSensitive: true, shell: 'bash' });
  assert.ok(result.command.includes('--data-raw ' + quoteBash(body)));
  assert.ok(result.warnings.some(warning => /template/i.test(warning)));
});

test('buildHttpieCommand redacts auth, sensitive headers and query params, and the whole body by default', () => {
  const { buildHttpieCommand } = runnerLogic();
  const marker = 'HTTPIE_SECRET_SENTINEL_2d91';
  const result = buildHttpieCommand({
    method: 'post',
    url: `https://api.example.test/v1/items?page=2&token=${marker}&region=south`,
    headers: `Content-Type: application/json\nAuthorization: Bearer ${marker}\nX-Api-Key: ${marker}\nX-Trace: trace-1`,
    body: `{"token":"${marker}"}`,
    authType: 'bearer',
    bearerToken: marker
  }, { shell: 'bash' });

  assert.equal(result.command, "http POST 'https://api.example.test/v1/items?page=2&region=south' 'Content-Type: application/json' 'X-Trace: trace-1'");
  assert.doesNotMatch(JSON.stringify(result), new RegExp(marker));
  assert.ok(result.warnings.some(warning => /autentica/i.test(warning)), 'auth omission should be announced');
  assert.ok(result.warnings.some(warning => /header/i.test(warning)), 'sensitive header omission should be announced');
  assert.ok(result.warnings.some(warning => /query/i.test(warning)), 'sensitive query omission should be announced');
  assert.ok(result.warnings.some(warning => /body/i.test(warning)), 'body omission should be announced');
});

test('buildHttpieCommand also omits the configured API Key name from query and headers by default', () => {
  const { buildHttpieCommand } = runnerLogic();
  const queryKey = 'HTTPIE_GENERIC_QUERY_KEY';
  const query = buildHttpieCommand({
    method: 'GET', url: `https://api.example.test/users?page=2&key=${queryKey}`,
    authType: 'apiKey', apiKeyName: 'key', apiKeyLocation: 'query', apiKeyValue: queryKey
  }, { shell: 'bash' });
  assert.equal(query.command, "http GET 'https://api.example.test/users?page=2'");
  assert.doesNotMatch(query.command, new RegExp(queryKey));
  assert.ok(query.warnings.some(warning => /query/i.test(warning)));

  const headerKey = 'HTTPIE_CUSTOM_HEADER_KEY';
  const header = buildHttpieCommand({
    method: 'GET', url: 'https://api.example.test/users',
    headers: `X-Subscription: ${headerKey}\nAccept: application/json`,
    authType: 'apiKey', apiKeyName: 'X-Subscription', apiKeyLocation: 'header', apiKeyValue: headerKey
  }, { shell: 'bash' });
  assert.equal(header.command, "http GET 'https://api.example.test/users' 'Accept: application/json'");
  assert.doesNotMatch(header.command, new RegExp(headerKey));
  assert.ok(header.warnings.some(warning => /header/i.test(warning)));
});

test('buildHttpieCommand includes opted-in auth, headers, API key, and body with shell-specific quoting', () => {
  const { buildHttpieCommand } = runnerLogic();
  const body = '{"name":"Ana\'s"}';
  const request = {
    method: 'PATCH',
    url: 'https://api.example.test/v1/items?region=south',
    headers: { 'Content-Type': 'application/json' },
    body,
    authType: 'basic',
    basicUsername: 'alice',
    basicPassword: 'p@ss'
  };

  const bash = buildHttpieCommand(request, { includeSensitive: true, shell: 'bash' });
  assert.equal(bash.command, "http --auth 'alice:p@ss' --raw '{\"name\":\"Ana'\\''s\"}' PATCH 'https://api.example.test/v1/items?region=south' 'Content-Type: application/json'");
  assert.deepEqual(bash.warnings, []);

  const powershell = buildHttpieCommand(request, { includeSensitive: true, shell: 'powershell' });
  assert.equal(powershell.command, "http.exe --auth 'alice:p@ss' --raw '{\"name\":\"Ana''s\"}' PATCH 'https://api.example.test/v1/items?region=south' 'Content-Type: application/json'");

  const apiKeyHeader = buildHttpieCommand({
    method: 'GET', url: 'https://api.example.test/v1/items', headers: 'Accept: application/json',
    authType: 'apiKey', apiKeyName: 'X-API-Key', apiKeyLocation: 'header', apiKeyValue: 'key with space'
  }, { includeSensitive: true, shell: 'bash' });
  assert.equal(apiKeyHeader.command, "http GET 'https://api.example.test/v1/items' 'Accept: application/json' 'X-API-Key: key with space'");

  const apiKeyQuery = buildHttpieCommand({
    method: 'GET', url: 'https://api.example.test/v1/items', headers: 'Accept: application/json',
    authType: 'apiKey', apiKeyName: 'api key', apiKeyLocation: 'query', apiKeyValue: 'a&b c'
  }, { includeSensitive: true, shell: 'bash' });
  assert.equal(apiKeyQuery.command, "http GET 'https://api.example.test/v1/items?api%20key=a%26b%20c' 'Accept: application/json'");

  const redactedQuery = buildHttpieCommand({
    method: 'GET', url: 'https://api.example.test/v1/items', headers: 'Accept: application/json',
    authType: 'apiKey', apiKeyName: 'api key', apiKeyLocation: 'query', apiKeyValue: 'a&b c'
  }, { shell: 'bash' });
  assert.equal(redactedQuery.command, "http GET 'https://api.example.test/v1/items' 'Accept: application/json'");
  assert.ok(redactedQuery.warnings.some(warning => /autentica/i.test(warning)));
});

test('buildHttpieCommand encodes API Key query names and values in the URL instead of request items', () => {
  const { buildHttpieCommand, parseHttpieCommand } = runnerLogic();
  const colonName = buildHttpieCommand({
    method: 'GET', url: 'https://api.example.test/v1/items?page=2',
    authType: 'apiKey', apiKeyName: 'x:key', apiKeyLocation: 'query', apiKeyValue: 'a&b c'
  }, { includeSensitive: true, shell: 'bash' });
  assert.equal(colonName.command, "http GET 'https://api.example.test/v1/items?page=2&x%3Akey=a%26b%20c'");
  assert.equal(colonName.command.includes('=='), false);
  assert.equal(parseHttpieCommand(colonName.command).url, 'https://api.example.test/v1/items?page=2&x%3Akey=a%26b%20c');

  const dashName = buildHttpieCommand({
    method: 'GET', url: 'https://api.example.test/v1/items',
    authType: 'apiKey', apiKeyName: '-key', apiKeyLocation: 'query', apiKeyValue: 'value'
  }, { includeSensitive: true, shell: 'bash' });
  assert.equal(dashName.command, "http GET 'https://api.example.test/v1/items?-key=value'");
  assert.equal(dashName.command.includes("'-key=="), false);

  assert.throws(() => buildHttpieCommand({
    method: 'GET', url: 'https://api.example.test/v1/items?x%3Akey=manual',
    authType: 'apiKey', apiKeyName: 'x:key', apiKeyLocation: 'query', apiKeyValue: 'configured'
  }, { includeSensitive: true, shell: 'bash' }), /API Key/i);
});

test('buildHttpieCommand quotes command substitutions and quotes safely for Bash and PowerShell', () => {
  const { buildHttpieCommand } = runnerLogic();
  const headerValue = 'a\'b $(touch nope) `id` "c"';
  const body = 'O\'Brien $(touch nope) `whoami` "quoted"';
  const request = { method: 'POST', url: 'https://api.example.test/v1/items', headers: `X-Test: ${headerValue}`, body };

  const bash = buildHttpieCommand(request, { includeSensitive: true, shell: 'bash' });
  assert.equal(bash.command, "http --raw 'O'\\''Brien $(touch nope) `whoami` \"quoted\"' POST 'https://api.example.test/v1/items' 'X-Test: a'\\''b $(touch nope) `id` \"c\"'");

  const powershell = buildHttpieCommand(request, { includeSensitive: true, shell: 'powershell' });
  assert.equal(powershell.command, "http.exe --raw 'O''Brien $(touch nope) `whoami` \"quoted\"' POST 'https://api.example.test/v1/items' 'X-Test: a''b $(touch nope) `id` \"c\"'");
});

test('buildHttpieCommand round-trips safe requests without secrets through the HTTPie importer', () => {
  const { buildHttpieCommand, parseHttpieCommand } = runnerLogic();
  const request = {
    method: 'PATCH',
    url: 'https://api.example.test/v1/items/42?notify=true',
    headers: 'Accept: application/json\nContent-Type: application/json',
    body: ''
  };
  const generated = buildHttpieCommand(request, { shell: 'bash' });
  assert.equal(generated.command, "http PATCH 'https://api.example.test/v1/items/42?notify=true' 'Accept: application/json' 'Content-Type: application/json'");
  assert.deepEqual(generated.warnings, []);
  assert.deepEqual(parseHttpieCommand(generated.command), {
    method: 'PATCH',
    url: 'https://api.example.test/v1/items/42?notify=true',
    headers: [['Accept', 'application/json'], ['Content-Type', 'application/json']],
    body: '',
    bearerToken: ''
  });

  const withBody = buildHttpieCommand({
    method: 'POST',
    url: 'https://api.example.test/v1/items',
    headers: 'Content-Type: application/json',
    body: '{"name":"Nova"}'
  }, { includeSensitive: true, shell: 'bash' });
  assert.equal(withBody.command, "http --raw '{\"name\":\"Nova\"}' POST 'https://api.example.test/v1/items' 'Content-Type: application/json'");
  assert.deepEqual(parseHttpieCommand(withBody.command), {
    method: 'POST',
    url: 'https://api.example.test/v1/items',
    headers: [['Content-Type', 'application/json']],
    body: '{"name":"Nova"}',
    bearerToken: ''
  });
});

test('buildHttpieCommand exports empty header values as Header; and the importer round-trips them', () => {
  const { buildHttpieCommand, parseHttpieCommand } = runnerLogic();
  const generated = buildHttpieCommand({
    method: 'GET',
    url: 'https://api.example.test/v1/items',
    headers: 'X-Empty:\nX-Trace: trace-1'
  }, { shell: 'bash' });

  assert.equal(generated.command, "http GET 'https://api.example.test/v1/items' 'X-Empty;' 'X-Trace: trace-1'");
  assert.deepEqual(parseHttpieCommand(generated.command), {
    method: 'GET',
    url: 'https://api.example.test/v1/items',
    headers: [['X-Empty', ''], ['X-Trace', 'trace-1']],
    body: '',
    bearerToken: ''
  });
  assert.deepEqual(parseHttpieCommand("http GET https://api.example.test/v1/items 'X-Empty;'").headers, [['X-Empty', '']]);
});

test('buildHttpieCommand preserves Vortix templates literally and warns about them', () => {
  const { buildHttpieCommand } = runnerLogic();
  const result = buildHttpieCommand({
    method: 'POST',
    url: 'https://api.example.test/v1/{{path}}?id={{id}}',
    headers: 'X-Tenant: {{tenant}}',
    body: '{"id":"{{id}}"}',
    authType: 'apiKey', apiKeyName: 'X-API-Key', apiKeyLocation: 'header', apiKeyValue: '{{apiKey}}'
  }, { includeSensitive: true, shell: 'bash' });

  assert.equal(result.command, "http --raw '{\"id\":\"{{id}}\"}' POST 'https://api.example.test/v1/{{path}}?id={{id}}' 'X-Tenant: {{tenant}}' 'X-API-Key: {{apiKey}}'");
  assert.ok(result.warnings.some(warning => /template/i.test(warning) && /vortix/i.test(warning)));

  for (const url of ['{{baseUrl}}', '{{baseUrl}}/v1/items', '{{baseUrl}}/v1/items?page={{page}}']) {
    const generated = buildHttpieCommand({ method: 'GET', url }, { shell: 'bash' });
    assert.equal(generated.command, "http GET '" + url + "'");
    assert.ok(generated.warnings.some(warning => /template/i.test(warning) && /substitu/i.test(warning) && /vortix/i.test(warning)));
  }

  const basic = buildHttpieCommand({
    method: 'POST', url: 'https://api.example.test/oauth/token', body: 'grant_type=client_credentials',
    authType: 'basic', basicUsername: '{{clientId}}', basicPassword: '{{secret}}'
  }, { includeSensitive: true, shell: 'bash' });
  assert.ok(basic.command.includes("--auth '{{clientId}}:{{secret}}'"));
  assert.ok(basic.warnings.some(warning => /template/i.test(warning) && /vortix/i.test(warning)));
});

test('buildHttpieCommand validates methods, URLs, and proxy conflicts without leaking secrets', () => {
  const { buildHttpieCommand } = runnerLogic();
  const valid = { method: 'GET', url: 'https://api.example.test/v1/items' };

  assert.throws(() => buildHttpieCommand(null), /HTTPie|request/i);
  assert.throws(() => buildHttpieCommand({ ...valid, method: 'TRACE' }), /método/i);
  assert.throws(() => buildHttpieCommand({ ...valid, url: '/v1/items' }), /absoluta|HTTP/i);
  assert.throws(() => buildHttpieCommand({ ...valid, url: 'ftp://api.example.test/v1/items' }), /HTTP/i);
  assert.throws(() => buildHttpieCommand({ ...valid, url: credentialedTestUrl() }), /credenciais/i);
  assert.throws(() => buildHttpieCommand({ ...valid, url: 'https://api.example.test/v1/items#fragment' }), /fragmento/i);
  assert.throws(() => buildHttpieCommand({ ...valid, body: '{}' }), /body/i);

  const manualAuthorization = {
    method: 'GET', url: 'https://api.example.test/me',
    headers: 'Authorization: Bearer header-secret\nAccept: application/json',
    authType: 'bearer', bearerToken: 'configured-secret'
  };
  assert.throws(() => buildHttpieCommand(manualAuthorization, { includeSensitive: true, shell: 'bash' }), error => {
    assert.match(error.message, /Authorization/i);
    assert.match(error.message, /proxy|Auth|Headers/i);
    assert.doesNotMatch(error.message, /header-secret|configured-secret/);
    return true;
  });
  const safe = buildHttpieCommand(manualAuthorization, { shell: 'bash' });
  assert.equal(safe.command, "http GET 'https://api.example.test/me' 'Accept: application/json'");
  assert.doesNotMatch(safe.command, /header-secret|configured-secret|Authorization/i);

  const duplicateHeader = {
    method: 'GET', url: 'https://api.example.test/items',
    headers: 'x-api-key: manual-key\nAccept: application/json',
    authType: 'apiKey', apiKeyName: 'X-API-Key', apiKeyLocation: 'header', apiKeyValue: 'configured-key'
  };
  assert.throws(() => buildHttpieCommand(duplicateHeader, { includeSensitive: true, shell: 'bash' }), error => {
    assert.match(error.message, /API Key/i);
    assert.match(error.message, /header|Headers/i);
    assert.doesNotMatch(error.message, /manual-key|configured-key/);
    return true;
  });
  const safeHeader = buildHttpieCommand(duplicateHeader, { shell: 'bash' });
  assert.equal(safeHeader.command, "http GET 'https://api.example.test/items' 'Accept: application/json'");
  assert.doesNotMatch(safeHeader.command, /manual-key|configured-key|API-Key/i);

  const duplicateQuery = {
    method: 'GET', url: 'https://api.example.test/items?key=manual-key',
    authType: 'apiKey', apiKeyName: 'key', apiKeyLocation: 'query', apiKeyValue: 'configured-key'
  };
  assert.throws(() => buildHttpieCommand(duplicateQuery, { includeSensitive: true, shell: 'bash' }), error => {
    assert.match(error.message, /API Key/i);
    assert.match(error.message, /URL|duplicidade/i);
    assert.doesNotMatch(error.message, /manual-key|configured-key/);
    return true;
  });
});

test('buildOpenApi31Export maps method, path, required path params, query, headers, Accept, Content-Type, and JSON body', () => {
  const { buildOpenApi31Export } = runnerLogic();
  const { document, warnings } = buildOpenApi31Export({
    name: 'Loja de exemplo',
    requests: [{
      name: 'Criar item',
      method: 'POST',
      baseUrl: 'https://api.example.test/v1',
      route: '/items/{itemId}?expand=owner&limit=10',
      headers: 'Accept: application/json, text/plain\nContent-Type: application/json\nX-Trace: trace-1',
      body: '{"name":"Ana","token":"BODY_SENTINEL_7d1"}',
      bodyMode: 'json'
    }],
    folders: []
  }, {});

  assert.equal(document.openapi, '3.1.0');
  assert.equal(document.info.title, 'Loja de exemplo');
  assert.equal(document.info.version, '1.0.0');
  assert.deepEqual(document.servers, [{ url: 'https://api.example.test/v1' }]);
  const operation = document.paths['/items/{itemId}'].post;
  assert.ok(operation, 'POST operation should be emitted');
  assert.equal(operation.summary, 'Criar item');

  const pathParameter = operation.parameters.find(parameter => parameter.in === 'path' && parameter.name === 'itemId');
  assert.deepEqual(pathParameter, { name: 'itemId', in: 'path', required: true, schema: { type: 'string' } });
  assert.equal(operation.parameters.some(parameter => parameter.in === 'query' && parameter.name === 'expand'), true);
  assert.equal(operation.parameters.some(parameter => parameter.in === 'query' && parameter.name === 'limit'), true);
  assert.equal(operation.parameters.some(parameter => parameter.in === 'header' && parameter.name === 'X-Trace'), true);
  assert.equal(operation.parameters.some(parameter => parameter.name === 'Accept'), false);
  assert.equal(operation.parameters.some(parameter => parameter.name === 'Content-Type'), false);
  assert.equal(operation.parameters.some(parameter => parameter.in === 'header' && parameter.name === 'Content-Type'), false);

  assert.deepEqual(Object.keys(operation.responses['default'].content), ['application/json', 'text/plain']);
  assert.deepEqual(operation.requestBody.content['application/json'].schema, { type: 'object', properties: { name: { type: 'string' } } });
  assert.equal(Object.hasOwn(operation.requestBody.content['application/json'], 'example'), false);
  assert.equal(JSON.stringify(document).includes('BODY_SENTINEL_7d1'), false, 'sensitive JSON body fields must be removed');
  assert.ok(Array.isArray(warnings));
  assert.ok(warnings.some(warning => /valores literais de bodies/i.test(warning)));
  assert.equal(warnings.some(warning => /Content-Type.*header/i.test(warning)), false);
});

test('buildOpenApi31Export always emits a non-empty response and keeps custom headers without inventing parameters', () => {
  const { buildOpenApi31Export } = runnerLogic();
  const { document } = buildOpenApi31Export({
    name: 'Ping',
    requests: [{ name: 'Ping', method: 'GET', baseUrl: 'https://api.example.test', route: '/ping', headers: '', body: '' }],
    folders: []
  }, {});
  const operation = document.paths['/ping'].get;
  assert.ok(operation.responses && Object.keys(operation.responses).length > 0);
  assert.equal(typeof operation.responses['default'].description, 'string');
  assert.equal(Object.hasOwn(operation.responses['default'], 'content'), false);
});

test('buildOpenApi31Export converts safe active server variables and falls back to a safe placeholder for sensitive or invalid defaults', () => {
  const { buildOpenApi31Export } = runnerLogic();
  const safe = buildOpenApi31Export({
    name: 'Servidores',
    requests: [{ method: 'GET', baseUrl: 'https://{{host}}/v1', route: '/status' }],
    folders: []
  }, { host: 'api.example.test' });
  assert.deepEqual(safe.document.servers[0], {
    url: 'https://{host}/v1',
    variables: { host: { default: 'api.example.test' } }
  });
  assert.doesNotMatch(JSON.stringify(safe.document), /\{\{host\}\}/);

  const pureTemplate = buildOpenApi31Export({
    name: 'Servidor base',
    requests: [{ method: 'GET', baseUrl: '{{baseUrl}}', route: '/status' }],
    folders: []
  }, { baseUrl: 'https://api.example.test' });
  assert.deepEqual(pureTemplate.document.servers[0], {
    url: '{baseUrl}',
    variables: { baseUrl: { default: 'https://api.example.test' } }
  });
  assert.doesNotMatch(JSON.stringify(pureTemplate.document), /\{\{baseUrl\}\}/);

  const credentialedServer = credentialedTestUrl('private.example.test') + '/?secret=SERVER_SENTINEL';
  const placeholder = buildOpenApi31Export({
    name: 'Servidores inseguros',
    requests: [{ method: 'GET', baseUrl: 'https://{{token}}/v1', route: '/status' }],
    folders: []
  }, { token: credentialedServer });
  assert.equal(placeholder.document.servers[0].url, 'https://api.example.test');
  assert.equal(JSON.stringify(placeholder.document).includes('SERVER_SENTINEL'), false);
  assert.equal(JSON.stringify(placeholder.document).includes('private.example.test'), false);
  assert.ok(placeholder.warnings.some(warning => /placeholder|servidor/i.test(warning)));

  const missing = buildOpenApi31Export({
    name: 'Servidor ausente',
    requests: [{ method: 'GET', baseUrl: '{{baseUrl}}/v1', route: '/status' }],
    folders: []
  }, {});
  assert.equal(missing.document.servers[0].url, 'https://api.example.test');
  assert.doesNotMatch(JSON.stringify(missing.document), /\{\{baseUrl\}\}/);
  assert.ok(missing.warnings.some(warning => /placeholder|servidor/i.test(warning)));
});

test('buildOpenApi31Export omits Auth values, response examples, scripts, cookies, and nested folder hierarchy with warnings', () => {
  const { buildOpenApi31Export } = runnerLogic();
  const marker = 'OPENAPI_SECRET_SENTINEL_91c4';
  const { document, warnings } = buildOpenApi31Export({
    name: 'Coleção segura',
    auth: { authMode: 'custom', authType: 'bearer', bearerToken: marker },
    cookieJar: [{ name: 'session', value: marker }],
    requests: [{
      name: 'Perfil',
      method: 'GET',
      baseUrl: 'https://api.example.test',
      route: '/me',
      headers: `Authorization: Bearer ${marker}\nCookie: session=${marker}\nX-Trace: ok`,
      authMode: 'custom',
      authType: 'apiKey',
      apiKeyName: 'X-API-Key',
      apiKeyLocation: 'header',
      apiKeyValue: marker,
      responseExamples: [{ status: 200, body: marker }],
      responses: { '200': { body: marker } },
      preRequestActions: [{ type: 'template', value: marker }],
      responseTests: [{ source: marker }],
      captureResponseVariable: true
    }],
    folders: [{
      name: 'Admin',
      folders: [{
        name: 'Interno',
        auth: { authMode: 'custom', authType: 'basic', basicUsername: marker, basicPassword: marker },
        requests: [{ name: 'Interno', method: 'GET', baseUrl: 'https://api.example.test', route: '/admin/internal' }],
        folders: []
      }],
      requests: [],
      auth: { authMode: 'custom', authType: 'bearer', bearerToken: marker }
    }]
  }, { token: marker });

  const serialized = JSON.stringify(document);
  assert.equal(serialized.includes(marker), false, 'no credential, response example, script, or cookie value may be serialized');
  assert.doesNotMatch(serialized, /"(?:responseExamples|preRequestActions|responseTests|cookieJar|Authorization|Cookie)"\s*:/i);
  assert.ok(warnings.some(warning => /Auth/i.test(warning)), 'Auth limitation must be announced');
  assert.ok(warnings.some(warning => /exemplos|respostas/i.test(warning)), 'response examples limitation must be announced');
  assert.ok(warnings.some(warning => /scripts|automa/i.test(warning)), 'scripts limitation must be announced');
  assert.ok(warnings.some(warning => /cookies/i.test(warning)), 'cookie limitation must be announced');
  assert.ok(warnings.some(warning => /pastas aninhadas/i.test(warning)), 'nested folders limitation must be announced');
});

test('buildOpenApi31Export exports only Auth scheme metadata and a security requirement without credentials', () => {
  const { buildOpenApi31Export } = runnerLogic();
  const marker = 'AUTH_METADATA_SENTINEL_42f0';
  const { document, warnings } = buildOpenApi31Export({
    name: 'Auth metadata',
    auth: { authMode: 'custom', authType: 'basic', basicUsername: marker, basicPassword: marker },
    requests: [{ name: 'Seguro', method: 'GET', baseUrl: 'https://api.example.test', route: '/secure', authMode: 'inherit' }],
    folders: []
  }, {});

  assert.deepEqual(document.security, [{ basicAuth: [] }]);
  assert.deepEqual(document.components.securitySchemes.basicAuth, { type: 'http', scheme: 'basic' });
  assert.equal(JSON.stringify(document).includes(marker), false);
  assert.ok(warnings.some(warning => /credenciais|valores/i.test(warning)));
});

test('buildOpenApi31Export warns about multipart and GraphQL without serializing file contents or GraphQL values', () => {
  const { buildOpenApi31Export } = runnerLogic();
  const marker = 'MULTIPART_SENTINEL_5a2d';
  const multipart = buildOpenApi31Export({
    name: 'Upload',
    requests: [{
      name: 'Upload', method: 'POST', baseUrl: 'https://api.example.test', route: '/upload',
      headers: 'Content-Type: multipart/form-data', bodyMode: 'multipart',
      multipartFields: [{ name: 'token', type: 'text', value: marker }, { name: 'file', type: 'file', fileName: 'secret.txt' }]
    }],
    folders: []
  }, {});
  assert.ok(multipart.document.paths['/upload'].post.requestBody.content['multipart/form-data']);
  assert.equal(JSON.stringify(multipart.document).includes(marker), false);
  assert.equal(JSON.stringify(multipart.document).includes('secret.txt'), false);
  assert.ok(multipart.warnings.some(warning => /multipart/i.test(warning)));

  const graphql = buildOpenApi31Export({
    name: 'GraphQL',
    requests: [{
      name: 'Consulta', method: 'POST', baseUrl: 'https://api.example.test', route: '/graphql',
      bodyMode: 'graphql', graphqlQuery: `query { token }`, graphqlVariables: `{"token":"${marker}"}`
    }],
    folders: []
  }, {});
  assert.ok(graphql.document.paths['/graphql'].post.requestBody.content['application/json']);
  assert.equal(JSON.stringify(graphql.document).includes(marker), false);
  assert.ok(graphql.warnings.some(warning => /GraphQL/i.test(warning)));
});

test('buildOpenApi31Export turns Vortix path templates into required OpenAPI parameters', () => {
  const { buildOpenApi31Export } = runnerLogic();
  const { document } = buildOpenApi31Export({
    name: 'Path templates',
    requests: [{ method: 'GET', baseUrl: 'https://api.example.test', route: '/users/{{userId}}/orders/{{orderId}}' }],
    folders: []
  }, {});

  const operation = document.paths['/users/{userId}/orders/{orderId}'].get;
  assert.deepEqual(operation.parameters.filter(parameter => parameter.in === 'path'), [
    { name: 'userId', in: 'path', required: true, schema: { type: 'string' } },
    { name: 'orderId', in: 'path', required: true, schema: { type: 'string' } }
  ]);
});

test('buildOpenApi31Export rejects duplicate method and path instead of silently dropping an operation', () => {
  const { buildOpenApi31Export } = runnerLogic();
  assert.throws(() => buildOpenApi31Export({
    name: 'Ambiguous operations',
    requests: [
      { name: 'List compact', method: 'GET', baseUrl: 'https://api.example.test', route: '/users' },
      { name: 'List detailed', method: 'GET', baseUrl: 'https://api.example.test', route: '/users?expand=roles' }
    ],
    folders: []
  }, {}), /operações duplicadas com o mesmo método e path/i);
});

test('buildOpenApi31Export infers body schemas without exporting literal request values', () => {
  const { buildOpenApi31Export } = runnerLogic();
  const marker = 'OPENAPI_BODY_VALUE_SENTINEL_c8a1';
  const { document, warnings } = buildOpenApi31Export({
    name: 'Body schema',
    requests: [
      {
        name: 'JSON', method: 'POST', baseUrl: 'https://api.example.test', route: '/users', bodyMode: 'json',
        body: JSON.stringify({ name: 'Alice', access_token: marker, profile: { age: 33, enabled: true } })
      },
      {
        name: 'Form', method: 'POST', baseUrl: 'https://api.example.test', route: '/form', bodyMode: 'urlencoded',
        body: `name=Alice&${encodeURIComponent('client_secret')}=${encodeURIComponent(marker)}&city=Recife`
      },
      { name: 'Text', method: 'POST', baseUrl: 'https://api.example.test', route: '/text', bodyMode: 'text', body: marker }
    ],
    folders: []
  }, {});

  const jsonContent = document.paths['/users'].post.requestBody.content['application/json'];
  assert.deepEqual(jsonContent.schema, {
    type: 'object',
    properties: {
      name: { type: 'string' },
      profile: { type: 'object', properties: { age: { type: 'number' }, enabled: { type: 'boolean' } } }
    }
  });
  assert.equal(Object.hasOwn(jsonContent, 'example'), false);
  const formProperties = document.paths['/form'].post.requestBody.content['application/x-www-form-urlencoded'].schema.properties;
  assert.deepEqual(formProperties, { name: { type: 'string' }, city: { type: 'string' } });
  assert.equal(Object.hasOwn(document.paths['/form'].post.requestBody.content['application/x-www-form-urlencoded'], 'example'), false);
  assert.equal(Object.hasOwn(document.paths['/text'].post.requestBody.content['text/plain'], 'example'), false);
  assert.equal(JSON.stringify(document).includes(marker), false);
  assert.ok(warnings.some(warning => /valores literais de bodies/i.test(warning)));
});

test('buildOpenApi31Export round-trips a whole server variable as baseUrl without a route prefix', () => {
  const { buildOpenApi31Export, parseOpenApiSpec } = runnerLogic();
  const exported = buildOpenApi31Export({
    name: 'Base URL variable',
    requests: [{ name: 'Status', method: 'GET', baseUrl: '{{baseUrl}}', route: '/status' }],
    folders: []
  }, { baseUrl: 'https://api.example.test/v1' });

  const imported = parseOpenApiSpec(exported.document);
  assert.equal(imported.collection.requests[0].baseUrl, '{{baseUrl}}');
  assert.equal(imported.collection.requests[0].route, '/status');
  assert.equal(imported.collection.requests[0].responseContract.pathTemplate, '/status');
  assert.equal(imported.collection.requests[0].responseContract.serverBasePathDynamic, true);
  assert.equal(imported.environment.variables.baseUrl, 'https://api.example.test/v1');
});

test('buildOpenApi31Export emits one query parameter for repeated names', () => {
  const { buildOpenApi31Export } = runnerLogic();
  const { document } = buildOpenApi31Export({
    name: 'Repeated query names',
    requests: [{ method: 'GET', baseUrl: 'https://api.example.test', route: '/search?tag=first&tag=second' }],
    folders: []
  }, {});

  const queryParameters = document.paths['/search'].get.parameters.filter(parameter => parameter.in === 'query');
  assert.deepEqual(queryParameters, [{ name: 'tag', in: 'query', required: false, schema: { type: 'string' } }]);
});

test('buildOpenApi31Export omits invalid media types and falls back to body mode with a generic warning', () => {
  const { buildOpenApi31Export } = runnerLogic();
  const { document, warnings } = buildOpenApi31Export({
    name: 'Invalid media types',
    requests: [{
      method: 'POST', baseUrl: 'https://api.example.test', route: '/items', bodyMode: 'json', body: '{"name":"item"}',
      headers: 'Accept: application/json; q=0.8, */*, application/*, {{acceptType}}, invalid media type\nContent-Type: application/{{bodyType}}; charset=utf-8'
    }],
    folders: []
  }, {});

  const operation = document.paths['/items'].post;
  assert.deepEqual(Object.keys(operation.responses.default.content), ['application/json', '*/*', 'application/*']);
  assert.deepEqual(Object.keys(operation.requestBody.content), ['application/json']);
  assert.ok(warnings.some(warning => /tipo.*m[ií]dia/i.test(warning)));
  assert.doesNotMatch(JSON.stringify({ document, warnings }), /acceptType|bodyType|invalid media type/);
});

test('buildOpenApi31Export canonicalizes templated path names across methods and rejects normalized collisions', () => {
  const { buildOpenApi31Export } = runnerLogic();
  const { document } = buildOpenApi31Export({
    name: 'Templated path hierarchy',
    requests: [
      { method: 'GET', baseUrl: 'https://api.example.test', route: '/users/{{id}}' },
      { method: 'POST', baseUrl: 'https://api.example.test', route: '/users/{{userId}}' }
    ],
    folders: []
  }, {});

  const paths = Object.keys(document.paths);
  assert.equal(paths.length, 1);
  assert.match(paths[0], /^\/users\/\{[^{}]+\}$/);
  const parameterName = paths[0].match(/\{([^{}]+)\}/)[1];
  for (const method of ['get', 'post']) {
    assert.deepEqual(document.paths[paths[0]][method].parameters.filter(parameter => parameter.in === 'path'), [
      { name: parameterName, in: 'path', required: true, schema: { type: 'string' } }
    ]);
  }

  assert.throws(() => buildOpenApi31Export({
    name: 'Normalized collision',
    requests: [
      { method: 'GET', baseUrl: 'https://api.example.test', route: '/users/{{id}}' },
      { method: 'GET', baseUrl: 'https://api.example.test', route: '/users/{{userId}}' }
    ],
    folders: []
  }, {}), error => {
    assert.match(error.message, /operações duplicadas com o mesmo método e path/i);
    assert.doesNotMatch(error.message, /GET|\/users|userId|\{\{id\}\}/);
    return true;
  });
});

test('imports OpenAPI response contracts through local refs without persisting example values', () => {
  const { parseOpenApiSpec } = runnerLogic();
  const secretExample = 'CONTRACT_EXAMPLE_MUST_NOT_PERSIST';
  const imported = parseOpenApiSpec({
    openapi: '3.1.0',
    info: { title: 'Generic API' },
    servers: [{ url: 'https://api.example.test/v1' }],
    paths: {
      '/items/{itemId}': {
        get: {
          operationId: 'getItem',
          responses: {
            '200': { $ref: '#/components/responses/ItemResponse' },
            '404': { description: 'Not found' }
          }
        }
      }
    },
    components: {
      responses: {
        ItemResponse: {
          description: 'Item response',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } }
        }
      },
      schemas: {
        Item: {
          type: 'object',
          required: ['id', 'name'],
          properties: {
            id: { type: 'integer', example: 42 },
            name: { type: 'string', default: secretExample, description: 'Private example label' },
            tags: { type: 'array', items: { type: 'string' } }
          }
        }
      }
    }
  });

  const contract = imported.collection.requests[0].responseContract;
  assert.equal(contract.method, 'GET');
  assert.equal(contract.pathTemplate, '/v1/items/{itemId}');
  assert.deepEqual(contract.responses['200'].content['application/json'].schema, {
    type: 'object',
    required: ['id', 'name'],
    properties: {
      id: { type: 'integer' },
      name: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } }
    }
  });
  assert.equal(JSON.stringify(contract).includes(secretExample), false);
  assert.equal(JSON.stringify(contract).includes('Private example label'), false);
});

test('validates response status, JSON media type, and structural schema', () => {
  const { validateOpenApiResponseContract } = runnerLogic();
  const result = validateOpenApiResponseContract({
    method: 'GET', pathTemplate: '/items/{itemId}', partialReasons: [],
    responses: { '200': { content: { 'application/json': { schema: {
      type: 'object', required: ['id', 'name'], properties: { id: { type: 'integer' }, name: { type: 'string' } }
    } } } } }
  }, { status: 200, headers: [['Content-Type', 'application/json; charset=utf-8']], body: '{"id":7,"name":"Maple"}' }, { method: 'GET', route: '/items/7' });

  assert.equal(result.status, 'passed');
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.warnings, []);
});

test('reports schema failures using paths without echoing response values', () => {
  const { validateOpenApiResponseContract } = runnerLogic();
  const privateValue = 'RESPONSE_VALUE_MUST_NOT_LEAK';
  const result = validateOpenApiResponseContract({
    method: 'GET', pathTemplate: '/items/{itemId}', partialReasons: [],
    responses: { '200': { content: { 'application/json': { schema: {
      type: 'object', required: ['id', 'name'], properties: { id: { type: 'integer' }, name: { type: 'string' } }
    } } } } }
  }, { status: 200, headers: [['Content-Type', 'application/json']], body: JSON.stringify({ id: 'wrong-type', extra: privateValue }) }, { method: 'GET', route: '/items/7' });

  assert.equal(result.status, 'failed');
  assert.ok(result.issues.some(issue => /name/i.test(issue)));
  assert.ok(result.issues.some(issue => /id/i.test(issue)));
  assert.equal(JSON.stringify(result).includes(privateValue), false);
});

test('does not echo dynamic response property names when additionalProperties are forbidden', () => {
  const { validateOpenApiResponseContract } = runnerLogic();
  const privateName = 'DYNAMIC_RESPONSE_KEY_SENTINEL';
  const result = validateOpenApiResponseContract({
    method: 'GET', pathTemplate: '/items', partialReasons: [],
    responses: {
      '200': {
        content: {
          'application/json': {
            schema: { type: 'object', properties: { id: { type: 'integer' } }, additionalProperties: false }
          }
        }
      }
    }
  }, { status: 200, headers: [['Content-Type', 'application/json']], body: JSON.stringify({ id: 1, [privateName]: 'value' }) }, { method: 'GET', route: '/items' });

  assert.equal(result.status, 'failed');
  assert.equal(JSON.stringify(result).includes(privateName), false);
});

test('rejects undeclared status and incompatible response media type', () => {
  const { validateOpenApiResponseContract } = runnerLogic();
  const result = validateOpenApiResponseContract({
    method: 'GET', pathTemplate: '/items', partialReasons: [],
    responses: { '200': { content: { 'application/json': { schema: { type: 'object' } } } } }
  }, { status: 201, headers: [['Content-Type', 'text/plain']], body: 'created' }, { method: 'GET', route: '/items' });

  assert.equal(result.status, 'failed');
  assert.ok(result.issues.some(issue => /status/i.test(issue)));
  assert.ok(result.issues.some(issue => /media|content.type/i.test(issue)));
});

test('marks unsupported response schema types and non-JSON structures partial instead of failing silently', () => {
  const { validateOpenApiResponseContract } = runnerLogic();
  const unknownType = validateOpenApiResponseContract({
    method: 'GET', pathTemplate: '/items', partialReasons: [],
    responses: { '200': { content: { 'application/json': { schema: { type: 'record' } } } } }
  }, { status: 200, headers: [['Content-Type', 'application/json']], body: '{}' }, { method: 'GET', route: '/items' });
  const mixedType = validateOpenApiResponseContract({
    method: 'GET', pathTemplate: '/items', partialReasons: [],
    responses: {
      '200': { content: { 'application/json': { schema: { type: ['record', 'object'] } } } }
    }
  }, { status: 200, headers: [['Content-Type', 'application/json']], body: '"text"' }, { method: 'GET', route: '/items' });
  const xmlStructure = validateOpenApiResponseContract({
    method: 'GET', pathTemplate: '/items', partialReasons: [],
    responses: {
      '200': { content: { 'application/xml': { schema: {
        type: 'object', properties: { id: { type: 'integer' } }
      } } } }
    }
  }, { status: 200, headers: [['Content-Type', 'application/xml']], body: '<item><id>7</id></item>' }, { method: 'GET', route: '/items' });

  assert.equal(unknownType.status, 'partial');
  assert.equal(mixedType.status, 'partial');
  assert.equal(xmlStructure.status, 'partial');
  assert.deepEqual(unknownType.issues, []);
  assert.deepEqual(mixedType.issues, []);
  assert.deepEqual(xmlStructure.issues, []);
});

test('implements OpenAPI nullable and exclusive bounds without accepting invalid values', () => {
  const { validateOpenApiResponseContract } = runnerLogic();
  const nullable = validateOpenApiResponseContract({
    method: 'GET', pathTemplate: '/items', openApiVersion: '3.0', partialReasons: [],
    responses: {
      '200': {
        content: {
          'application/json': {
            schema: {
              type: 'object', properties: { name: { type: 'string', nullable: true } }
            }
          }
        }
      }
    }
  }, { status: 200, headers: [['Content-Type', 'application/json']], body: '{"name":null}' }, { method: 'GET', route: '/items' });
  const exclusive = validateOpenApiResponseContract({
    method: 'GET', pathTemplate: '/items', openApiVersion: '3.0', partialReasons: [],
    responses: {
      '200': {
        content: {
          'application/json': {
            schema: {
              type: 'object', properties: { count: { type: 'integer', minimum: 5, exclusiveMinimum: true } }
            }
          }
        }
      }
    }
  }, { status: 200, headers: [['Content-Type', 'application/json']], body: '{"count":5}' }, { method: 'GET', route: '/items' });

  assert.equal(nullable.status, 'passed');
  assert.equal(exclusive.status, 'failed');
  assert.ok(exclusive.issues.some(issue => /count/i.test(issue)));
});

test('normalizes nullable, type arrays, and exclusive bounds by OpenAPI version', () => {
  const { parseOpenApiSpec, validateOpenApiResponseContract } = runnerLogic();
  const validate = (version, schema, body) => {
    const imported = parseOpenApiSpec({
      openapi: `${version}.0`, info: { title: 'Versioned schema' },
      paths: { '/items': { get: { responses: { '200': { content: { 'application/json': { schema } } } } } } }
    });
    return validateOpenApiResponseContract(imported.collection.requests[0].responseContract, {
      status: 200, headers: [['Content-Type', 'application/json']], body
    }, { method: 'GET', baseUrl: 'https://api.example.test', route: '/items' });
  };

  const nullable30 = validate('3.0', { type: 'string', nullable: true }, 'null');
  const nullable31 = validate('3.1', { type: 'string', nullable: true }, 'null');
  const union31 = validate('3.1', { type: ['string', 'null'] }, 'null');
  const union30 = validate('3.0', { type: ['string', 'null'] }, 'null');
  const exclusive30 = validate('3.0', { type: 'number', minimum: 5, exclusiveMinimum: true }, '{"count":5}');
  const exclusive31Boolean = validate('3.1', { type: 'number', minimum: 5, exclusiveMinimum: true }, '5');
  const exclusive31Numeric = validate('3.1', { type: 'number', exclusiveMinimum: 5 }, '5');

  assert.equal(nullable30.status, 'passed');
  assert.equal(nullable31.status, 'partial');
  assert.deepEqual(nullable31.issues, []);
  assert.equal(union31.status, 'passed');
  assert.equal(union30.status, 'partial');
  assert.deepEqual(union30.issues, []);
  assert.equal(exclusive30.status, 'failed');
  assert.equal(exclusive31Boolean.status, 'partial');
  assert.deepEqual(exclusive31Boolean.issues, []);
  assert.equal(exclusive31Numeric.status, 'failed');
});

test('compares unique OpenAPI array items by JSON structure rather than object key order', () => {
  const reorderedObjects = validateOpenApiResponseSchema({ type: 'array', uniqueItems: true }, [
    { a: 1, b: 2 }, { b: 2, a: 1 }
  ]);
  const reorderedNestedObjects = validateOpenApiResponseSchema({ type: 'array', uniqueItems: true }, [
    { nested: { a: 1, b: 2 } }, { nested: { b: 2, a: 1 } }
  ]);
  const distinctObjects = validateOpenApiResponseSchema({ type: 'array', uniqueItems: true }, [
    { a: 1, b: 2 }, { a: 1, b: 3 }
  ]);
  const orderedArrays = validateOpenApiResponseSchema({ type: 'array', uniqueItems: true }, [
    { values: [1, 2] }, { values: [2, 1] }
  ]);

  assert.equal(reorderedObjects.status, 'failed');
  assert.ok(reorderedObjects.issues.some(issue => /itens únicos/i.test(issue)));
  assert.equal(reorderedNestedObjects.status, 'failed');
  assert.equal(distinctObjects.status, 'passed');
  assert.equal(orderedArrays.status, 'passed');
});

test('uses decimal precision for OpenAPI multipleOf without epsilon false passes', () => {
  const tinyNonMultiple = validateOpenApiResponseSchema({ type: 'number', multipleOf: 1 }, 5e-10);
  const decimalMultiple = validateOpenApiResponseSchema({ type: 'number', multipleOf: 0.1 }, 0.3);
  const nearbyNonMultiple = validateOpenApiResponseSchema({ type: 'number', multipleOf: 0.1 }, 0.30000000000000004);

  assert.equal(tinyNonMultiple.status, 'failed');
  assert.equal(decimalMultiple.status, 'passed');
  assert.equal(nearbyNonMultiple.status, 'failed');
});

test('marks truncated OpenAPI property bounds partial unless the lower bound proves a violation', () => {
  const object = Object.fromEntries(Array.from({ length: 2000 }, (_, index) => ['property' + index, index]));
  const uncertainMinimum = validateOpenApiResponseSchema({ type: 'object', minProperties: 1500 }, object);
  const uncertainMaximum = validateOpenApiResponseSchema({ type: 'object', maxProperties: 1500 }, object);
  const provenMaximumViolation = validateOpenApiResponseSchema({ type: 'object', maxProperties: 1000 }, object);

  assert.equal(uncertainMinimum.status, 'partial');
  assert.deepEqual(uncertainMinimum.issues, []);
  assert.equal(uncertainMaximum.status, 'partial');
  assert.deepEqual(uncertainMaximum.issues, []);
  assert.equal(provenMaximumViolation.status, 'failed');
  assert.ok(provenMaximumViolation.issues.some(issue => /no máximo 1000/i.test(issue)));
});

test('marks malformed schema keyword shapes partial instead of treating them as empty schemas', () => {
  const { parseOpenApiSpec, validateOpenApiResponseContract } = runnerLogic();
  const malformedSchemas = [
    { type: [] },
    { type: null },
    { type: 'object', required: 'id' },
    { type: 'object', properties: [] },
    { type: 'array', items: 'string' }
  ];
  for (const schema of malformedSchemas) {
    const imported = parseOpenApiSpec({
      openapi: '3.1.0', info: { title: 'Malformed schema' },
      paths: { '/items': { get: { responses: { '200': { content: { 'application/json': { schema } } } } } } }
    });
    const result = validateOpenApiResponseContract(imported.collection.requests[0].responseContract, {
      status: 200, headers: [['Content-Type', 'application/json']], body: schema.type === 'array' ? '[]' : '{}'
    }, { method: 'GET', baseUrl: 'https://api.example.test', route: '/items' });
    assert.equal(result.status, 'partial');
    assert.deepEqual(result.issues, []);
  }
});

test('marks malformed OpenAPI response content as partial instead of checking status alone', () => {
  const { parseOpenApiSpec, validateOpenApiResponseContract } = runnerLogic();
  const malformedResponses = [
    null,
    { content: 'application/json' },
    { content: { 'application/json': null } }
  ];
  for (const response of malformedResponses) {
    const imported = parseOpenApiSpec({
      openapi: '3.1.0', info: { title: 'Malformed response' },
      paths: { '/items': { get: { responses: { '200': response } } } }
    });
    const result = validateOpenApiResponseContract(imported.collection.requests[0].responseContract, {
      status: 200, headers: [['Content-Type', 'application/json']], body: '{}'
    }, { method: 'GET', baseUrl: 'https://api.example.test', route: '/items' });
    assert.equal(result.status, 'partial');
    assert.deepEqual(result.issues, []);
  }
});

test('marks invalid OpenAPI response maps partial instead of rejecting an undeclared status', () => {
  const { parseOpenApiSpec, validateOpenApiResponseContract } = runnerLogic();
  const malformedMaps = [null, { bad: { description: 'Invalid status key' } }];
  for (const responses of malformedMaps) {
    const imported = parseOpenApiSpec({
      openapi: '3.1.0', info: { title: 'Malformed response map' },
      paths: { '/items': { get: { responses } } }
    });
    const result = validateOpenApiResponseContract(imported.collection.requests[0].responseContract, {
      status: 200, headers: [['Content-Type', 'application/json']], body: '{}'
    }, { method: 'GET', baseUrl: 'https://api.example.test', route: '/items' });
    assert.equal(result.status, 'partial');
    assert.deepEqual(result.issues, []);
  }
});

test('imports and validates OpenAPI JSON request bodies without echoing body values', () => {
  const { parseOpenApiSpec, validateOpenApiRequestBodyContract, prepareSavedRequest } = runnerLogic();
  const spec = parseOpenApiSpec({
    openapi: '3.1.0', info: { title: 'Request contract' },
    paths: {
      '/items': {
        post: {
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object', required: ['id'],
                  properties: { id: { type: 'integer' }, note: { type: 'string', example: 'BODY_EXAMPLE_SECRET_147' } }
                }
              }
            }
          },
          responses: { '201': { description: 'Created' } }
        }
      }
    }
  });
  const contract = spec.collection.requests[0].responseContract;
  assert.ok(contract.requestBody);
  assert.equal(JSON.stringify(contract).includes('BODY_EXAMPLE_SECRET_147'), false);

  const baseRequest = { method: 'POST', baseUrl: 'https://api.example.test', route: '/items', headers: 'Content-Type: application/json' };
  const valid = validateOpenApiRequestBodyContract(contract, { ...baseRequest, body: '{"id":7,"note":"ok"}' });
  const sensitiveValue = 'REQUEST_BODY_SECRET_VALUE_147';
  const invalid = validateOpenApiRequestBodyContract(contract, { ...baseRequest, body: `{"id":"${sensitiveValue}"}` });

  assert.equal(valid.status, 'passed');
  assert.equal(invalid.status, 'failed');
  assert.ok(invalid.issues.some(issue => /body\.id/i.test(issue)));
  assert.equal(JSON.stringify(invalid).includes(sensitiveValue), false);
  const prepared = prepareSavedRequest({ method: 'POST', baseUrl: baseRequest.baseUrl, route: baseRequest.route, headers: baseRequest.headers, body: '{"id":7}', responseContract: contract }, {}, {}, true);
  assert.equal(prepared.responseContract.requestBody.required, true);
  assert.equal(prepared.responseContract.requestBody.content['application/json'].schema.properties.id.type, 'integer');
});

test('resolves local OpenAPI requestBody references into a usable JSON starter body', () => {
  const { parseOpenApiSpec } = runnerLogic();
  const imported = parseOpenApiSpec({
    openapi: '3.1.0', info: { title: 'Referenced request body' },
    components: {
      requestBodies: {
        CreateItem: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateItem' } } }
        }
      },
      schemas: { CreateItem: { type: 'object', properties: { id: { type: 'integer' } } } }
    },
    paths: {
      '/items': {
        post: {
          requestBody: { $ref: '#/components/requestBodies/CreateItem' },
          responses: { '201': { description: 'Created' } }
        }
      }
    }
  });
  const request = imported.collection.requests[0];
  assert.equal(request.body, '{}');
  assert.equal(request.responseContract.requestBody.content['application/json'].schema.type, 'object');
});

test('keeps unresolved external requestBody references partial instead of inventing a media-type failure', () => {
  const { parseOpenApiSpec, validateOpenApiRequestBodyContract } = runnerLogic();
  const imported = parseOpenApiSpec({
    openapi: '3.1.0', info: { title: 'External request body reference' },
    paths: {
      '/items': {
        post: {
          requestBody: { $ref: 'https://schemas.example.test/request-body.json' },
          responses: { '201': { description: 'Created' } }
        }
      }
    }
  });
  const result = validateOpenApiRequestBodyContract(imported.collection.requests[0].responseContract, {
    method: 'POST', baseUrl: 'https://api.example.test', route: '/items',
    headers: 'Content-Type: application/json', body: '{"id":7}'
  });
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.issues, []);
  assert.equal(JSON.stringify(result).includes('schemas.example.test'), false);
});

test('keeps malformed request body media maps partial instead of reporting a false mismatch', () => {
  const { parseOpenApiSpec, validateOpenApiRequestBodyContract } = runnerLogic();
  const imported = parseOpenApiSpec({
    openapi: '3.1.0', info: { title: 'Malformed request media' },
    paths: {
      '/items': {
        post: {
          requestBody: { required: true, content: {
            'application/json': { schema: { type: 'object' } },
            'not a media type': { schema: { type: 'string' } }
          } },
          responses: { '201': { description: 'Created' } }
        }
      }
    }
  });
  const result = validateOpenApiRequestBodyContract(imported.collection.requests[0].responseContract, {
    method: 'POST', baseUrl: 'https://api.example.test', route: '/items',
    headers: 'Content-Type: application/xml', body: '<item/>'
  });
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.issues, []);
});

test('checks required request bodies and media types while leaving non-JSON structure partial', () => {
  const { parseOpenApiSpec, validateOpenApiRequestBodyContract } = runnerLogic();
  const importBody = requestBody => parseOpenApiSpec({
    openapi: '3.1.0', info: { title: 'Request body edges' },
    paths: { '/items': { post: { requestBody, responses: { '201': { description: 'Created' } } } } }
  }).collection.requests[0].responseContract;
  const jsonContract = importBody({
    required: true,
    content: { 'application/json': { schema: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } } }
  });
  const request = { method: 'POST', baseUrl: 'https://api.example.test', route: '/items' };
  const missingBody = validateOpenApiRequestBodyContract(jsonContract, { ...request, body: '', headers: '' });
  const wrongMedia = validateOpenApiRequestBodyContract(jsonContract, { ...request, body: '{"id":7}', headers: 'Content-Type: text/plain' });
  const unresolvedTemplate = validateOpenApiRequestBodyContract(jsonContract, { ...request, body: '{"id":"{{id}}"}', headers: 'Content-Type: application/json', resolutionProvenance: { id: 'missing' } });
  const unresolvedBaseUrl = validateOpenApiRequestBodyContract(jsonContract, { ...request, body: '{"id":7}', headers: 'Content-Type: application/json', resolutionProvenance: { baseUrl: 'missing' } });
  const optionalContract = importBody({ required: false, content: { 'application/json': { schema: { type: 'object' } } } });
  const optionalEmpty = validateOpenApiRequestBodyContract(optionalContract, { ...request, body: '', headers: '' });
  const xmlContract = importBody({ required: true, content: { 'application/xml': { schema: { type: 'object' } } } });
  const xmlBody = validateOpenApiRequestBodyContract(xmlContract, { ...request, bodyMode: 'xml', body: '<item/>', headers: 'Content-Type: application/xml' });

  assert.equal(missingBody.status, 'failed');
  assert.ok(missingBody.issues.some(issue => /obrigat.rio/i.test(issue)));
  assert.equal(wrongMedia.status, 'failed');
  assert.equal(unresolvedTemplate.status, 'partial');
  assert.deepEqual(unresolvedTemplate.issues, []);
  assert.equal(unresolvedBaseUrl.status, 'passed');
  assert.equal(optionalEmpty.status, 'passed');
  assert.equal(xmlBody.status, 'partial');
  assert.deepEqual(xmlBody.issues, []);
});

test('infers the proxy default Content-Type when the request editor has no explicit header', () => {
  const { parseOpenApiSpec, validateOpenApiRequestBodyContract } = runnerLogic();
  const contract = parseOpenApiSpec({
    openapi: '3.1.0', info: { title: 'Default request media' },
    paths: { '/items': { post: {
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
      responses: { '201': { description: 'Created' } }
    } } }
  }).collection.requests[0].responseContract;
  const request = { method: 'POST', route: '/items', bodyMode: 'json', body: '{"name":"Ava"}', headers: '' };
  const inferred = validateOpenApiRequestBodyContract(contract, request);
  const blankHeader = validateOpenApiRequestBodyContract(contract, { ...request, headers: 'Content-Type: ' });
  const explicitMismatch = validateOpenApiRequestBodyContract(contract, { ...request, headers: 'Content-Type: text/plain' });

  assert.equal(inferred.status, 'passed');
  assert.equal(blankHeader.status, 'failed');
  assert.ok(blankHeader.issues.some(issue => /Content-Type/i.test(issue)));
  assert.equal(explicitMismatch.status, 'failed');
});

test('treats populated multipart fields as a present non-JSON request body', () => {
  const { parseOpenApiSpec, validateOpenApiRequestBodyContract } = runnerLogic();
  const contract = parseOpenApiSpec({
    openapi: '3.1.0', info: { title: 'Multipart request body' },
    paths: { '/upload': { post: {
      requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object' } } } },
      responses: { '201': { description: 'Created' } }
    } } }
  }).collection.requests[0].responseContract;
  const request = { method: 'POST', route: '/upload', bodyMode: 'multipart', body: '', headers: '', multipartFields: [{ name: 'caption', type: 'text', value: 'sample' }] };
  const populated = validateOpenApiRequestBodyContract(contract, request);
  const empty = validateOpenApiRequestBodyContract(contract, { ...request, multipartFields: [] });
  const staleTextWithoutFields = validateOpenApiRequestBodyContract(contract, { ...request, body: '{"caption":"stale"}', multipartFields: [] });
  const manualContentType = validateOpenApiRequestBodyContract(contract, { ...request, headers: 'Content-Type: multipart/form-data' });
  const fieldsIgnoredByProxy = validateOpenApiRequestBodyContract(contract, { ...request, bodyMode: 'json' });

  assert.equal(populated.status, 'partial');
  assert.deepEqual(populated.issues, []);
  assert.ok(populated.warnings.some(warning => /não JSON/i.test(warning)));
  assert.equal(empty.status, 'failed');
  assert.ok(empty.issues.some(issue => /obrigat.rio/i.test(issue)));
  assert.equal(staleTextWithoutFields.status, 'failed');
  assert.ok(staleTextWithoutFields.issues.some(issue => /obrigat.rio/i.test(issue)));
  assert.equal(manualContentType.status, 'failed');
  assert.ok(manualContentType.issues.some(issue => /Content-Type/i.test(issue)));
  assert.equal(fieldsIgnoredByProxy.status, 'failed');
});

test('caps oversized request body schemas and reports partial instead of failing media type', () => {
  const { parseOpenApiSpec, validateOpenApiRequestBodyContract } = runnerLogic();
  let schema = { type: 'string' };
  for (let depth = 0; depth < 7; depth++) {
    schema = {
      type: 'object',
      properties: Object.fromEntries(Array.from({ length: 100 }, (_, index) => ['field_' + 'x'.repeat(110) + index, schema]))
    };
  }
  const imported = parseOpenApiSpec({
    openapi: '3.1.0', info: { title: 'Oversized request schema' },
    paths: { '/items': { post: { requestBody: { required: true, content: { 'application/json': { schema } } }, responses: { '201': { description: 'Created' } } } } }
  });
  const contract = imported.collection.requests[0].responseContract;
  const result = validateOpenApiRequestBodyContract(contract, {
    method: 'POST', baseUrl: 'https://api.example.test', route: '/items',
    headers: 'Content-Type: application/json', body: '{}'
  });
  assert.ok(Buffer.byteLength(JSON.stringify(contract), 'utf8') <= 64 * 1024);
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.issues, []);
});

test('limits OpenAPI response contract size by UTF-8 bytes', () => {
  const { parseOpenApiSpec } = runnerLogic();
  const properties = Object.fromEntries(Array.from({ length: 400 }, (_, index) => ['ü'.repeat(100) + index, { type: 'string' }]));
  const imported = parseOpenApiSpec({
    openapi: '3.1.0', info: { title: 'Large contract' },
    paths: {
      '/items': {
        get: {
          responses: {
            '200': {
              content: {
                'application/json': { schema: { type: 'object', properties } }
              }
            }
          }
        }
      }
    }
  });
  const contract = imported.collection.requests[0].responseContract;

  assert.ok(Buffer.byteLength(JSON.stringify(contract), 'utf8') <= 64 * 1024);
  assert.ok(contract.partialReasons.length > 0);
});

test('marks a response contract partial when the current request does not match its method or route', () => {
  const { validateOpenApiResponseContract } = runnerLogic();
  const result = validateOpenApiResponseContract({
    method: 'GET', pathTemplate: '/items/{itemId}', partialReasons: [], responses: { '200': { content: {} } }
  }, { status: 200, headers: [], body: '' }, { method: 'DELETE', route: '/other' });

  assert.equal(result.status, 'partial');
  assert.ok(result.warnings.length > 0);
  assert.deepEqual(result.issues, []);
});

test('marks a response contract partial when its OpenAPI server path differs from the active base URL', () => {
  const { validateOpenApiResponseContract } = runnerLogic();
  const result = validateOpenApiResponseContract({
    method: 'GET', pathTemplate: '/v1/items/{itemId}', partialReasons: [],
    responses: { '200': { content: {} } }
  }, { status: 200, headers: [], body: '' }, {
    method: 'GET', baseUrl: 'https://api.example.test/v2', route: '/items/7'
  });

  assert.equal(result.status, 'partial');
  assert.ok(result.warnings.some(warning => /rota/i.test(warning)));
});

test('keeps OpenAPI server path variables dynamic in response contract matching', () => {
  const { parseOpenApiSpec, validateOpenApiResponseContract } = runnerLogic();
  const request = parseOpenApiSpec({
    openapi: '3.1.0', info: { title: 'Dynamic server path' },
    servers: [{ url: 'https://api.example.test/{version}', variables: { version: { default: 'v1', enum: ['v1', 'v2'] } } }],
    paths: {
      '/items': {
        get: {
          responses: {
            '200': { content: { 'application/json': { schema: { type: 'object' } } } }
          }
        }
      }
    }
  }).collection.requests[0];
  const result = validateOpenApiResponseContract(request.responseContract, {
    status: 200, headers: [['Content-Type', 'application/json']], body: '{}'
  }, { method: 'GET', baseUrl: 'https://api.example.test/v2', route: '/items' });

  assert.equal(request.responseContract.pathTemplate, '/{{server:version}}/items');
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.issues, []);

  const multiSegmentServer = parseOpenApiSpec({
    openapi: '3.1.0', info: { title: 'Multi-segment server path' },
    servers: [{ url: 'https://api.example.test/{id}', variables: { id: { default: 'api/v1' } } }],
    paths: {
      '/items/{id}': {
        get: {
          responses: {
            '200': { content: { 'application/json': { schema: { type: 'object' } } } }
          }
        }
      }
    }
  }).collection.requests[0];
  const multiSegmentResult = validateOpenApiResponseContract(multiSegmentServer.responseContract, {
    status: 200, headers: [['Content-Type', 'application/json']], body: '{}'
  }, { method: 'GET', baseUrl: 'https://api.example.test/api/v1', route: '/items/7' });
  const multiSegmentPathParameter = validateOpenApiResponseContract(multiSegmentServer.responseContract, {
    status: 200, headers: [['Content-Type', 'application/json']], body: '{}'
  }, { method: 'GET', baseUrl: 'https://api.example.test/api/v1', route: '/items/7/extra' });

  assert.equal(multiSegmentServer.responseContract.pathTemplate, '/{{server:id}}/items/{id}');
  assert.equal(multiSegmentResult.status, 'passed');
  assert.equal(multiSegmentPathParameter.status, 'partial');

  const fullUrlVariable = parseOpenApiSpec({
    openapi: '3.1.0', info: { title: 'Dynamic full server URL' },
    servers: [{ url: '{apiUrl}', variables: { apiUrl: { default: 'https://api.example.test/v1' } } }],
    paths: {
      '/items': {
        get: {
          responses: {
            '200': { content: { 'application/json': { schema: { type: 'object' } } } }
          }
        }
      }
    }
  }).collection.requests[0];
  const fullUrlResult = validateOpenApiResponseContract(fullUrlVariable.responseContract, {
    status: 200, headers: [['Content-Type', 'application/json']], body: '{}'
  }, { method: 'GET', baseUrl: 'https://api.example.test/v2', route: '/items' });

  assert.equal(fullUrlVariable.responseContract.pathTemplate, '/items');
  assert.equal(fullUrlVariable.responseContract.serverBasePathDynamic, true);
  assert.equal(fullUrlResult.status, 'passed');

  const relativeServer = parseOpenApiSpec({
    openapi: '3.1.0', info: { title: 'Relative server path' },
    servers: [{ url: '/v1' }],
    paths: {
      '/items': {
        get: {
          responses: {
            '200': { content: { 'application/json': { schema: { type: 'object' } } } }
          }
        }
      }
    }
  }).collection.requests[0];
  const relativeResult = validateOpenApiResponseContract(relativeServer.responseContract, {
    status: 200, headers: [['Content-Type', 'application/json']], body: '{}'
  }, { method: 'GET', baseUrl: 'https://api.example.test/v2', route: '/v1/items' });

  assert.equal(relativeServer.responseContract.serverBasePathDynamic, true);
  assert.equal(relativeResult.status, 'passed');
});

test('matches response contracts against the full effective path, not the route alone', () => {
  const { validateOpenApiResponseContract } = runnerLogic();
  const result = validateOpenApiResponseContract({
    method: 'GET', pathTemplate: '/v1/items/{itemId}', partialReasons: [],
    responses: { '200': { content: { 'application/json': { schema: { type: 'object' } } } } }
  }, { status: 200, headers: [['Content-Type', 'application/json']], body: '{}' }, {
    method: 'GET', baseUrl: 'https://api.example.test/v2', route: '/v1/items/7'
  });

  assert.equal(result.status, 'partial');
  assert.ok(result.warnings.some(warning => /rota/i.test(warning)));
});

test('marks external and cyclic OpenAPI schema refs partial without loading remote references', () => {
  const { parseOpenApiSpec } = runnerLogic();
  const imported = parseOpenApiSpec({
    openapi: '3.1.0', info: { title: 'Reference cases' },
    paths: {
      '/external': {
        get: { responses: { '200': { content: { 'application/json': {
          schema: { $ref: 'https://schemas.example.test/item.json' }
        } } } } }
      },
      '/cyclic': {
        get: { responses: { '200': { content: { 'application/json': {
          schema: { $ref: '#/components/schemas/A' }
        } } } } }
      }
    },
    components: { schemas: { A: { type: 'object', properties: { next: { $ref: '#/components/schemas/A' } } } } }
  });

  const [external, cyclic] = imported.collection.requests.map(request => request.responseContract);
  assert.ok(external.partialReasons.length > 0);
  assert.ok(cyclic.partialReasons.length > 0);
  assert.doesNotMatch(JSON.stringify(imported), /schemas\.example\.test/);
});

test('prepared and workspace requests preserve normalized response contracts', () => {
  const { normalizeWorkspaceTabs, prepareSavedRequest } = runnerLogic();
  const responseContract = {
    method: 'GET', pathTemplate: '/items/{itemId}', serverBasePathDynamic: true, partialReasons: [],
    requestBody: {
      required: true, partialReasons: [],
      content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' } } } } }
    },
    responses: {
      '200': { content: { 'application/json': { schema: {
        type: 'object', properties: { id: { type: 'integer' } }
      } } } }
    }
  };
  const prepared = prepareSavedRequest({ method: 'GET', route: '/items/7', responseContract }, {}, {}, false);
  const state = normalizeWorkspaceTabs({ activeId: 'tab', tabs: [{ id: 'tab', request: prepared }] });

  assert.deepEqual(prepared.responseContract, responseContract);
  assert.deepEqual(state.tabs[0].request.responseContract, responseContract);
});

test('untrusted persisted response contracts drop literal values and arbitrary warning text', () => {
  const { normalizeWorkspaceTabs, prepareSavedRequest } = runnerLogic();
  const sentinel = 'UNTRUSTED_CONTRACT_LITERAL_SENTINEL';
  const request = {
    method: 'GET', route: '/items', responseContract: {
      method: 'GET', pathTemplate: '/items', partialReasons: [sentinel],
      requestBody: {
        required: true, partialReasons: [sentinel],
        content: { 'application/json': { example: sentinel, schema: { type: 'object', properties: { secret: { type: 'string', default: sentinel, example: sentinel, description: sentinel } } } } }
      },
      responses: { '200': { description: sentinel, content: { 'application/json': {
        example: sentinel,
        schema: { type: 'object', properties: { name: { type: 'string', default: sentinel, example: sentinel, description: sentinel } } }
      } } } }
    }
  };

  const prepared = prepareSavedRequest(request, {}, {}, false);
  const state = normalizeWorkspaceTabs({ tabs: [{ id: 'tab', request }] });
  assert.equal(JSON.stringify(prepared.responseContract).includes(sentinel), false);
  assert.equal(JSON.stringify(state.tabs[0].request.responseContract).includes(sentinel), false);
  assert.deepEqual(prepared.responseContract.requestBody.content['application/json'].schema, {
    type: 'object', properties: { secret: { type: 'string' } }
  });
  assert.deepEqual(prepared.responseContract.responses['200'].content['application/json'].schema, {
    type: 'object', properties: { name: { type: 'string' } }
  });
});

test('workspace tabs discard invalid untrusted response contracts before spreading request fields', () => {
  const { normalizeWorkspaceTabs } = runnerLogic();
  const sentinel = 'INVALID_CONTRACT_WORKSPACE_SENTINEL';
  const request = {
    method: 'GET', route: '/items', responseContract: {
      method: 'GET', pathTemplate: '/items?token=' + sentinel, partialReasons: [sentinel],
      responses: { '200': { content: { 'application/json': { schema: { type: 'object', example: sentinel } } } } }
    }
  };
  const state = normalizeWorkspaceTabs({ tabs: [{ id: 'tab', request }] });

  assert.equal(Object.hasOwn(state.tabs[0].request, 'responseContract'), false);
  assert.equal(JSON.stringify(state).includes(sentinel), false);
});

test('rejects untrusted response contract paths that could carry query secrets', () => {
  const { sanitizeOpenApiResponseContract } = runnerLogic();
  assert.equal(sanitizeOpenApiResponseContract({
    method: 'GET', pathTemplate: '/items?token=PATH_SECRET_SENTINEL', partialReasons: [], responses: { '200': { content: {} } }
  }), null);
});
