const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createServer } = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const cliPath = path.join(__dirname, 'tools', 'vortix-runner.cjs');

test('request editor exposes safe cURL and HTTPie generation and copy controls', async () => {
  const html = await fs.readFile(path.join(__dirname, 'wwwroot', 'index.html'), 'utf8');
  const app = await fs.readFile(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  const requestStart = app.indexOf('function curlRequestFromForm('), requestEnd = app.indexOf('\nfunction updateCurlExportPreview', requestStart);
  assert.ok(requestStart >= 0 && requestEnd > requestStart);
  assert.match(app.slice(requestStart, requestEnd), /bodyModeHeaders\(/);
  assert.match(html, /id="generate-curl"[^>]*>[^<]*cURL/i);
  assert.match(html, /<dialog[^>]*id="curl-export-dialog"[^>]*aria-labelledby="curl-export-title"/);
  assert.match(html, /id="curl-shell"[\s\S]*?<option value="powershell">[\s\S]*?<option value="bash">/);
  assert.match(html, /id="curl-format"[\s\S]*?<option value="curl">cURL<\/option>[\s\S]*?<option value="httpie">HTTPie<\/option>/);
  assert.match(html, /id="curl-include-sensitive"[^>]*type="checkbox"/);
  assert.match(html, /id="curl-command-preview"/);
  assert.match(app, /function openCurlExportDialog\(/);
  assert.match(app, /function updateCurlExportPreview\(/);
  assert.match(app, /RunnerLogic\.buildHttpieCommand/);
  assert.match(app, /hasCookieJar/);
  assert.match(app, /Cookie jar do ambiente ativo não é exportado/);
  assert.match(app, /curl-format/);
  assert.match(app, /title:'Mostrar dados no '\+formatName\+'/);
  assert.match(app, /Não foi possível gerar o comando '\+formatName/);
  assert.match(html, /id="close-curl-export"[^>]*aria-label="Fechar prévia de comando"/);
  assert.match(app, /generate-curl'\)\.onclick=openCurlExportDialog/);
  assert.match(app, /confirmWithDialog\(\{[\s\S]*?includeSensitive/);
  const copyStart = app.indexOf('async function copyCurlCommand('), copyEnd = app.indexOf('\nfunction openImportDialog', copyStart);
  assert.ok(copyStart >= 0 && copyEnd > copyStart);
  assert.match(app.slice(copyStart, copyEnd), /await copyToClipboard\(command\)/);
  assert.doesNotMatch(app.slice(copyStart, copyEnd), /navigator\.clipboard\.writeText/);
  const helperStart = app.indexOf('async function copyToClipboard('), helperEnd = app.indexOf('\nasync function copyOutput(', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const helper = app.slice(helperStart, helperEnd);
  assert.match(helper, /await navigator\.clipboard\.writeText\(text\)/);
  assert.match(helper, /showToast\('Copiado','Copiado para a área de transferência\.','info'\)/);
});

test('README documents cURL export safety and shell formats', async () => {
  const readme = await fs.readFile(path.join(__dirname, 'README.md'), 'utf8');
  assert.match(readme, /## Gerar comando cURL/);
  assert.match(readme, /PowerShell \(Windows\)[\s\S]*Bash \/ zsh/);
  assert.match(readme, /Body.*Auth.*sensíveis.*omitidos por padrão/i);
  assert.match(readme, /templates.*não são resolvidos/i);
  assert.match(readme, /não envia a request nem salva/i);
});

test('README documents safe HTTPie export and its raw-body format', async () => {
  const readme = await fs.readFile(path.join(__dirname, 'README.md'), 'utf8');
  assert.match(readme, /### Gerar comando HTTPie/);
  assert.match(readme, /--raw/);
  assert.match(readme, /sensíveis.*omitidos por padrão/i);
  assert.match(readme, /httpie\.io\/docs\/cli\/request-data-via---raw/);
  assert.match(readme, /headers com valor vazio usam a forma `Nome;`/i);
  assert.match(readme, /API Keys em query são codificadas diretamente na URL/i);
});

test('export dialog offers OpenAPI 3.1 with a safe credential notice and limitation confirmation', async () => {
  const html = await fs.readFile(path.join(__dirname, 'wwwroot', 'index.html'), 'utf8');
  const app = await fs.readFile(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  assert.match(html, /<option value="openapi-31">OpenAPI 3\.1<\/option>/);
  assert.match(html, /id="export-format-hint"[^>]*role="status"/);
  assert.match(app, /label\.textContent='Credenciais não são incluídas no OpenAPI 3\.1'/);
  assert.match(app, /function updateExportFormatUi\(/);
  assert.match(app, /export-format'\)\.addEventListener\('change',updateExportFormatUi\)/);
  assert.match(app, /RunnerLogic\.buildOpenApi31Export\(exportCollectionNode\(collection,false\),exportEnvironmentVariables\(environment\.variables,false\)\)/);
  assert.match(app, /\.openapi\.json/);
  assert.match(app, /confirmWithDialog\(\{[\s\S]*?OpenAPI 3\.1[\s\S]*?warnings/);
  assert.match(app, /URLs de servidor, paths e nomes de parâmetros\/campos são incluídos/i);
  assert.match(app, /Valores de Auth, bodies e respostas salvas não são exportados/i);
  assert.match(app, /catch\(error\)\{showToast\('Falha na exportação',error\.message/);
  assert.match(html, /id="export-format-description"/);
  assert.ok(app.includes("description.textContent='OpenAPI 3.1 exporta métodos, paths, nomes de parâmetros e schemas de body sem valores literais."));
  assert.ok(app.includes("description.textContent='O arquivo pode incluir requests, pastas, ações e o ambiente ativo, conforme o formato."));
});

test('README and ROADMAP document OpenAPI 3.1 export scope and limitations', async () => {
  const readme = await fs.readFile(path.join(__dirname, 'README.md'), 'utf8');
  const roadmap = await fs.readFile(path.join(__dirname, 'ROADMAP.md'), 'utf8');
  assert.match(readme, /### Exportar OpenAPI 3\.1/);
  assert.match(readme, /\.openapi\.json/);
  assert.match(readme, /não inclui valores de Auth, body ou resposta/i);
  assert.match(readme, /sem valores literais/i);
  assert.match(readme, /requests repetidas[\s\S]*interrompem a exportação/i);
  assert.match(readme, /multipart[\s\S]*GraphQL[\s\S]*Auth/i);
  assert.match(readme, /https:\/\/api\.example\.test/);
  assert.match(roadmap, /OpenAPI 3\.1/);
  assert.match(roadmap, /credenciais/i);
});

test('OpenAPI response contracts persist with Vortix requests and stay out of API proxy payloads', async () => {
  const app = await fs.readFile(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  const functionBody = name => {
    const start = app.indexOf(`function ${name}(`);
    const nextSync = app.indexOf('\nfunction ', start + 1), nextAsync = app.indexOf('\nasync function ', start + 1);
    const end = [nextSync, nextAsync].filter(index => index >= 0).reduce((first, index) => Math.min(first, index), app.length);
    assert.ok(start >= 0 && end > start, `${name} should be present`);
    return app.slice(start, end);
  };

  assert.match(functionBody('normalizeImportedNode'), /responseContract/);
  assert.match(functionBody('normalizeImportedNode'), /sanitizeOpenApiResponseContract\(request\.responseContract\)/);
  assert.match(functionBody('saveHistory'), /sanitizeOpenApiResponseContract/);
  assert.match(functionBody('captureWorkspaceDraft'), /responseContract/);
  assert.match(functionBody('getSnapshot'), /responseContract/);
  assert.match(functionBody('loadCollectionRequest'), /responseContract/);
  assert.match(functionBody('exportCollectionNode'), /responseContract/);
  assert.match(functionBody('executeApiRequest'), /delete proxyRequest\.responseContract/);
});

test('manual sends and collection Runner evaluate OpenAPI contracts and show partial status distinctly', async () => {
  const app = await fs.readFile(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  const html = await fs.readFile(path.join(__dirname, 'wwwroot', 'index.html'), 'utf8');
  const functionBody = name => {
    const start = app.indexOf(`function ${name}(`);
    const nextSync = app.indexOf('\nfunction ', start + 1), nextAsync = app.indexOf('\nasync function ', start + 1);
    const end = [nextSync, nextAsync].filter(index => index >= 0).reduce((first, index) => Math.min(first, index), app.length);
    assert.ok(start >= 0 && end > start, `${name} should be present`);
    return app.slice(start, end);
  };

  assert.match(functionBody('performApiRequest'), /responseResultsForRequest/);
  assert.match(functionBody('runRunnerCases'), /responseResultsForRequest/);
  assert.match(functionBody('responseContractTestResult'), /validateOpenApiResponseContract/);
  assert.match(functionBody('renderResponseTestResults'), /partial/);
  assert.match(functionBody('runRunnerCases'), /partialTests[\s\S]*?setRunnerCase\([^)]*warning/);
  assert.match(functionBody('runRunnerCases'), /partialTests[\s\S]*?showToast\([^;]*warning/);
  assert.match(html, /data-editor-panel="tests"[\s\S]*?(?:Contrato OpenAPI|contrato da resposta)/i);
});

test('manual and Runner flows validate imported request bodies without passing contracts to the proxy', async () => {
  const app = await fs.readFile(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  const html = await fs.readFile(path.join(__dirname, 'wwwroot', 'index.html'), 'utf8');
  const functionBody = name => {
    const start = app.indexOf(`function ${name}(`);
    const nextSync = app.indexOf('\nfunction ', start + 1), nextAsync = app.indexOf('\nasync function ', start + 1);
    const end = [nextSync, nextAsync].filter(index => index >= 0).reduce((first, index) => Math.min(first, index), app.length);
    assert.ok(start >= 0 && end > start, `${name} should be present`);
    return app.slice(start, end);
  };

  assert.match(functionBody('requestBodyContractTestResult'), /validateOpenApiRequestBodyContract/);
  const manualSend = functionBody('performApiRequest');
  assert.ok(manualSend.indexOf('requestBodyContractTestResult') < manualSend.indexOf('executeApiRequest'));
  assert.match(functionBody('validateRequestBodyContractFromForm'), /runPreRequestActions/);
  const runnerFlow = functionBody('runRunnerCases');
  assert.match(runnerFlow, /requestBodyContractTestResult/);
  assert.match(runnerFlow, /failedTests=responseTests\.filter/);
  assert.match(runnerFlow, /requestBodyValidation[\s\S]*?caseWarning=.*advisoryBodyFailure/);
  assert.match(runnerFlow, /caseFailed=caseFailed\|\|httpFailed\|\|failedTests\.length>0/);
  assert.match(functionBody('executeApiRequest'), /delete proxyRequest\.responseContract/);
  assert.match(html, /id="validate-request-body"/);
  assert.match(html, /id="request-body-contract-note"/);
  assert.match(app, /validate-request-body'\)\.onclick=validateRequestBodyContractFromForm/);
});

test('local response examples validate imported contracts against the active resolved base URL', async () => {
  const app = await fs.readFile(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  const start = app.indexOf('async function simulateSavedResponseExample('), next = app.indexOf('\nfunction updateCopyButtons(', start);
  assert.ok(start >= 0 && next > start);
  const mockFlow = app.slice(start, next);
  assert.match(mockFlow, /resolvedBaseUrl=applyEnvironment\(rawBaseUrl\)/);
  assert.match(mockFlow, /responseResultsForRequest\(\{[^}]*baseUrl:current\.baseUrl/);
});

test('README explains response contract results, supported schema, and safe reference limits', async () => {
  const readme = await fs.readFile(path.join(__dirname, 'README.md'), 'utf8');
  const image = await fs.readFile(path.join(__dirname, 'docs', 'images', 'openapi-response-contract.svg'), 'utf8');
  assert.match(readme, /### Validar respostas com contrato OpenAPI/);
  assert.match(readme, /#### Validar body da request/);
  assert.match(readme, /não bloqueia o envio/i);
  assert.match(readme, /requestBody:[\s\S]*required: true/);
  assert.match(readme, /Passou[\s\S]*Falhou[\s\S]*Parcial/);
  assert.match(readme, /additionalProperties/);
  assert.match(readme, /referências externas nunca são carregadas/i);
  assert.match(readme, /valores do body da resposta/i);
  assert.match(readme, /docs\/images\/openapi-response-contract\.svg/);
  assert.match(image, /<title[^>]*>Validar requests e respostas com contrato OpenAPI/);
});

test('Runner history labels partial contract outcomes without classifying them as completed', async () => {
  const app = await fs.readFile(path.join(__dirname, 'wwwroot', 'app.js'), 'utf8');
  const start = app.indexOf('function runnerHistoryOutcomeLabel('), end = app.indexOf('\nfunction runnerHistoryNotice(', start);
  assert.ok(start >= 0 && end > start);
  const labeler = app.slice(start, end);
  assert.match(labeler, /partial/);
  assert.match(labeler, /parcial/i);
});

function runCli(args, extraEnv = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [cliPath, ...args], { cwd: __dirname, env: { ...process.env, ...extraEnv } });
    let stdout = '', stderr = '', settled = false;
    const finish = result => { if (!settled) { settled = true; resolve(result); } };
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.on('error', error => finish({ code: null, error: error.code, stdout, stderr }));
    child.on('close', code => finish({ code, error: '', stdout, stderr }));
  });
}

function spawnSignaledCli(args) {
  const bootstrap = `const { main } = require(${JSON.stringify(cliPath)}); process.on('message', signal => { if (signal === 'SIGINT' || signal === 'SIGTERM') { process.emit(signal); process.send({ handled: signal }); } }); main(${JSON.stringify(args)}).then(code => { process.exitCode = code; if (process.connected) process.disconnect(); });`;
  return spawn(process.execPath, ['-e', bootstrap], { cwd: __dirname, env: process.env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
}

function sendSignal(child, signal) {
  return new Promise(resolve => {
    const onMessage = message => {
      if (message?.handled !== signal) return;
      child.off('message', onMessage);
      resolve();
    };
    child.on('message', onMessage);
    child.send(signal);
  });
}

async function createTempDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vortix-runner-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function startProxy(t, onRequest = () => ({ status: 200, reason: 'OK', headers: {}, body: '{"ok":true}' })) {
  const calls = [], cleanups = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === 'GET' && url.pathname === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"status":"ok","product":"VortixApiClient","hostingMode":"local"}');
      return;
    }
    if (request.method === 'DELETE' && url.pathname === '/api/storage/settings') {
      cleanups.push(url.searchParams.get('key'));
      response.writeHead(204).end();
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/request') {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const call = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      calls.push(call);
      const result = await onRequest(call, calls.length);
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { origin: `http://127.0.0.1:${server.address().port}`, calls, cleanups };
}

async function writeCollection(directory, collection, variables = {}) {
  const filePath = path.join(directory, 'collection.vortix.json');
  await fs.writeFile(filePath, JSON.stringify({
    format: 'api-studio-collection',
    version: 2,
    collection: { id: 'collection-1', name: 'CI', requests: [], folders: [], ...collection },
    environment: { name: 'CI', group: 'CI', variables }
  }));
  return filePath;
}

async function writeJson(directory, name, value) {
  const filePath = path.join(directory, name);
  await fs.writeFile(filePath, JSON.stringify(value));
  return filePath;
}

function cliArgs(proxy, collection, report, extra = []) {
  return ['--collection', collection, '--proxy', proxy, '--junit', report, ...extra];
}

test('Runner CLI help documents collection, local proxy, and safe write opt-in', async () => {
  const result = await runCli(['--help']);
  assert.equal(result.code, 0, `CLI must start and print help; spawn error: ${result.error || 'none'}; ${result.stderr}`);
  assert.match(result.stdout, /--collection/);
  assert.match(result.stdout, /--proxy/);
  assert.match(result.stdout, /--allow-writes/);
});

test('Runner CLI executes requests and datasets through a loopback proxy and keeps captured secrets out of JUnit and logs', async t => {
  const directory = await createTempDirectory(t);
  const token = 'VERY_SECRET_CI_CANARY';
  const proxy = await startProxy(t, call => call.route === '/token'
    ? { status: 200, reason: 'OK', headers: {}, body: JSON.stringify({ access_token: token, privateBody: 'BODY_CANARY' }) }
    : { status: 200, reason: 'OK', headers: {}, body: '{"ok":true,"privateBody":"BODY_CANARY"}' });
  const collection = await writeCollection(directory, {
    requests: [
      { id: 'auth', name: 'Fetch token', method: 'GET', baseUrl: '{{baseUrl}}', route: '/token', responseTests: [{ id: 'auth-status', target: 'status', operator: 'equals', expected: '200' }], captureResponseVariable: true, responseVariableName: 'token', responseValueSource: 'json', responseJsonPath: 'access_token', responseSuccessOnly: true },
      { id: 'user', name: 'Load user', method: 'GET', baseUrl: '{{baseUrl}}', route: '/users/{{userId}}', authType: 'bearer', bearerToken: '{{token}}', responseTests: [{ id: 'user-status', target: 'status', operator: 'equals', expected: '200' }, { id: 'user-ok', target: 'json', path: 'ok', operator: 'equals', expected: 'true' }] },
      { id: 'ci', name: 'Use CI secret', method: 'GET', baseUrl: '{{baseUrl}}', route: '/ci', authType: 'apiKey', apiKeyName: 'X-API-Key', apiKeyLocation: 'header', apiKeyValue: '{{ciKey}}' }
    ]
  }, { baseUrl: 'https://api.example.test', token: '' });
  const datasets = await writeJson(directory, 'datasets.json', [{ userId: 11 }, { userId: 12 }]);
  const report = path.join(directory, 'results.xml');

  const result = await runCli(cliArgs(proxy.origin, collection, report, ['--data', datasets, '--map-var', 'ciKey=VORTIX_CI_TOKEN']), { VORTIX_CI_TOKEN: 'CI_SECRET_CANARY' });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(proxy.calls.map(call => call.route), ['/token', '/users/11', '/ci', '/token', '/users/12', '/ci']);
  assert.deepEqual(proxy.calls.filter(call => call.route.startsWith('/users/')).map(call => call.bearerToken), [token, token]);
  assert.deepEqual(proxy.calls.filter(call => call.route === '/ci').map(call => call.apiKeyValue), ['CI_SECRET_CANARY', 'CI_SECRET_CANARY']);
  assert.equal(proxy.cleanups.length, 1);
  assert.match(proxy.cleanups[0], /^cookiejar:vortix-runner-/);
  const junit = await fs.readFile(report, 'utf8');
  assert.match(junit, /tests="6"/);
  assert.match(junit, /failures="0"/);
  assert.doesNotMatch(junit + result.stdout + result.stderr, /VERY_SECRET_CI_CANARY|CI_SECRET_CANARY|BODY_CANARY|api\.example\.test|\/users\/11/);
});

test('Runner CLI runs ordered pre-request actions with dataset precedence and omits action metadata from the proxy', async t => {
  const directory = await createTempDirectory(t);
  const proxy = await startProxy(t);
  const collection = await writeCollection(directory, {
    requests: [{
      id: 'dynamic', name: 'Dynamic request', method: 'GET', baseUrl: '{{baseUrl}}', route: '/items/{{request_id}}',
      headers: 'X-Label: {{label}}',
      preRequestActions: [
        { type: 'uuid', name: 'request_id' },
        { type: 'template', name: 'label', value: '{{tenant}}-{{request_id}}' }
      ]
    }]
  }, { baseUrl: proxy.origin });
  const datasets = await writeJson(directory, 'dynamic-data.json', [{ tenant: 'tenant-dataset' }]);
  const report = path.join(directory, 'dynamic.xml');

  const result = await runCli(cliArgs(proxy.origin, collection, report, ['--data', datasets]));
  assert.equal(result.code, 0, result.stderr);
  assert.equal(proxy.calls.length, 1);
  assert.match(proxy.calls[0].route, /^\/items\/[0-9a-f-]{36}$/i);
  const label = `tenant-dataset-${proxy.calls[0].route.split('/').at(-1)}`;
  assert.equal(proxy.calls[0].headers, `X-Label: ${label}`);
  for (const key of ['preRequestActions', 'preRequestActionsEnabled', 'preRequestSecretValues', 'preRequestProvenance']) assert.equal(Object.hasOwn(proxy.calls[0], key), false);
});

test('Runner CLI keeps dataset variables above CI mappings and CI mappings above captured values', async t => {
  const directory = await createTempDirectory(t);
  const proxy = await startProxy(t, call => call.route === '/auth'
    ? { status: 200, reason: 'OK', headers: {}, body: '{"access_token":"CAPTURED_TOKEN_CANARY"}' }
    : { status: 200, reason: 'OK', headers: {}, body: '{"ok":true}' });
  const collection = await writeCollection(directory, {
    requests: [
      { id: 'auth', method: 'GET', baseUrl: '{{baseUrl}}', route: '/auth', captureResponseVariable: true, responseVariableName: 'token', responseValueSource: 'json', responseJsonPath: 'access_token' },
      { id: 'check', method: 'GET', baseUrl: '{{baseUrl}}', route: '/check', authType: 'bearer', bearerToken: '{{token}}', responseTests: [{ id: 'ok', target: 'json', path: 'ok', operator: 'equals', expected: 'true' }] }
    ]
  }, { baseUrl: 'https://api.example.test', token: 'EXPORTED_TOKEN_CANARY' });
  const datasets = await writeJson(directory, 'precedence.json', [{}, { token: 'DATASET_TOKEN_CANARY' }]);
  const report = path.join(directory, 'precedence.xml');
  const result = await runCli(cliArgs(proxy.origin, collection, report, ['--data', datasets, '--map-var', 'token=VORTIX_CI_TOKEN']), { VORTIX_CI_TOKEN: 'CI_TOKEN_CANARY' });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(proxy.calls.filter(call => call.route === '/check').map(call => call.bearerToken), ['CI_TOKEN_CANARY', 'DATASET_TOKEN_CANARY']);
  const junit = await fs.readFile(report, 'utf8');
  assert.doesNotMatch(junit + result.stdout + result.stderr, /CAPTURED_TOKEN_CANARY|EXPORTED_TOKEN_CANARY|CI_TOKEN_CANARY|DATASET_TOKEN_CANARY/);
});

test('Runner CLI blocks writes before proxy calls unless both explicit test-write flags are supplied', async t => {
  const directory = await createTempDirectory(t);
  const proxy = await startProxy(t);
  const collection = await writeCollection(directory, {
    requests: [{ id: 'write', name: 'Create item', method: 'POST', baseUrl: 'https://api.example.test', route: '/items', body: '{"name":"smoke"}' }]
  });
  const report = path.join(directory, 'writes.xml');

  const blocked = await runCli(cliArgs(proxy.origin, collection, report));
  assert.equal(blocked.code, 2);
  assert.equal(proxy.calls.length, 0);
  assert.match(blocked.stderr, /gravações|escrita/i);

  const allowed = await runCli(cliArgs(proxy.origin, collection, report, ['--allow-writes', '--confirm-test-data', 'TESTE']));
  assert.equal(allowed.code, 0, allowed.stderr);
  assert.equal(proxy.calls.length, 1);
  assert.equal(proxy.calls[0].confirmTestData, true);
  assert.equal(proxy.calls[0].testDataPhrase, 'TESTE');
});

test('Runner CLI rejects non-loopback proxies before making network requests', async t => {
  const directory = await createTempDirectory(t);
  const collection = await writeCollection(directory, { requests: [] });
  const report = path.join(directory, 'remote.xml');
  const result = await runCli(cliArgs('https://example.com', collection, report));
  assert.equal(result.code, 2);
  assert.doesNotMatch(result.stderr + result.stdout, /example\.com/);
});

test('Runner CLI refuses to overwrite its collection with the JUnit report', async t => {
  const directory = await createTempDirectory(t);
  const proxy = await startProxy(t);
  const collection = await writeCollection(directory, { requests: [{ id: 'read', method: 'GET', baseUrl: 'https://api.example.test', route: '/' }] });
  const result = await runCli(cliArgs(proxy.origin, collection, collection));
  assert.equal(result.code, 2);
  assert.equal(proxy.calls.length, 0);
  assert.match(result.stderr, /relatório|arquivo de entrada/i);
});

test('Runner CLI requires an XML extension for JUnit reports', async t => {
  const directory = await createTempDirectory(t);
  const proxy = await startProxy(t);
  const collection = await writeCollection(directory, { requests: [{ id: 'read', method: 'GET', baseUrl: 'https://api.example.test', route: '/' }] });
  const result = await runCli(cliArgs(proxy.origin, collection, path.join(directory, 'results.json')));
  assert.equal(result.code, 2);
  assert.equal(proxy.calls.length, 0);
  assert.match(result.stderr, /\.xml/i);
});

test('Runner CLI rejects a JUnit symlink to protected source or input files', async t => {
  const directory = await createTempDirectory(t);
  const proxy = await startProxy(t);
  const collection = await writeCollection(directory, { requests: [{ id: 'read', method: 'GET', baseUrl: 'https://api.example.test', route: '/' }] });
  const alias = path.join(directory, 'protected.xml');
  try { await fs.symlink(cliPath, alias, 'file'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip(`Symlinks unavailable: ${error.code}`);
    throw error;
  }
  const before = await fs.readFile(cliPath, 'utf8');
  const result = await runCli(cliArgs(proxy.origin, collection, alias));
  assert.equal(result.code, 2);
  assert.equal(proxy.calls.length, 0);
  assert.match(result.stderr, /relatório|arquivo|protegido/i);
  assert.equal(await fs.readFile(cliPath, 'utf8'), before);
});

test('Runner CLI rejects a hard link to its source as a JUnit destination', async t => {
  const directory = await createTempDirectory(t);
  const proxy = await startProxy(t);
  const collection = await writeCollection(directory, { requests: [{ id: 'read', method: 'GET', baseUrl: 'https://api.example.test', route: '/' }] });
  const alias = path.join(path.dirname(cliPath), `.vortix-runner-test-${crypto.randomUUID()}.xml`);
  try { await fs.link(cliPath, alias); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP', 'EXDEV'].includes(error.code)) return t.skip(`Hard links unavailable: ${error.code}`);
    throw error;
  }
  t.after(() => fs.rm(alias, { force: true }));
  const before = await fs.readFile(cliPath, 'utf8');
  const result = await runCli(cliArgs(proxy.origin, collection, alias));
  assert.equal(result.code, 2);
  assert.equal(proxy.calls.length, 0);
  assert.match(result.stderr, /relatório|arquivo|Runner/i);
  assert.equal(await fs.readFile(cliPath, 'utf8'), before);
});

test('Runner CLI checks dataset size before parsing and contacting the proxy', async t => {
  const directory = await createTempDirectory(t);
  const proxy = await startProxy(t);
  const collection = await writeCollection(directory, { requests: [{ id: 'read', method: 'GET', baseUrl: 'https://api.example.test', route: '/' }] });
  const datasets = path.join(directory, 'large.json');
  await fs.writeFile(datasets, ' '.repeat(100_001));
  const result = await runCli(cliArgs(proxy.origin, collection, path.join(directory, 'large.xml'), ['--data', datasets]));
  assert.equal(result.code, 2);
  assert.equal(proxy.calls.length, 0);
  assert.match(result.stderr, /100 KB|tamanho/i);
});

test('Runner CLI rejects a missing mapped CI variable before proxy requests', async t => {
  const directory = await createTempDirectory(t);
  const proxy = await startProxy(t);
  const environmentName = `VORTIX_MISSING_${crypto.randomUUID().replaceAll('-', '').toUpperCase()}`;
  const collection = await writeCollection(directory, {
    requests: [{ id: 'auth', method: 'GET', baseUrl: '{{baseUrl}}', route: '/private', authType: 'bearer', bearerToken: '{{token}}' }]
  }, { baseUrl: 'https://api.example.test' });
  const report = path.join(directory, 'missing-variable.xml');
  const result = await runCli(cliArgs(proxy.origin, collection, report, ['--map-var', `token=${environmentName}`]));
  assert.equal(result.code, 2);
  assert.equal(proxy.calls.length, 0);
  assert.match(result.stderr, new RegExp(environmentName));
});

test('Runner CLI stops after failure and marks later cases skipped in JUnit', async t => {
  const directory = await createTempDirectory(t);
  const proxy = await startProxy(t, call => call.route === '/fail'
    ? { status: 503, reason: 'Unavailable', headers: {}, body: '', error: 'upstream detail' }
    : { status: 200, reason: 'OK', headers: {}, body: '{"ok":true}' });
  const collection = await writeCollection(directory, {
    requests: [
      { id: 'fail', method: 'GET', baseUrl: 'https://api.example.test', route: '/fail' },
      { id: 'skip', method: 'GET', baseUrl: 'https://api.example.test', route: '/later' }
    ]
  });
  const report = path.join(directory, 'stop.xml');
  const result = await runCli(cliArgs(proxy.origin, collection, report, ['--stop-on-error']));
  assert.equal(result.code, 1);
  assert.equal(proxy.calls.length, 1);
  const junit = await fs.readFile(report, 'utf8');
  assert.match(junit, /failures="1"/);
  assert.match(junit, /skipped="1"/);
  assert.doesNotMatch(junit + result.stdout + result.stderr, /upstream detail|api\.example\.test|\/fail/);
});

test('Runner CLI requires saved and command-line opt-ins for remote HTTP', async t => {
  const directory = await createTempDirectory(t);
  const proxy = await startProxy(t);
  const collection = await writeCollection(directory, {
    requests: [{ id: 'http', method: 'GET', baseUrl: 'http://api.example.test', route: '/', allowInsecureHttp: true }]
  });
  const report = path.join(directory, 'http.xml');
  const blocked = await runCli(cliArgs(proxy.origin, collection, report));
  assert.equal(blocked.code, 2);
  assert.equal(proxy.calls.length, 0);
  assert.match(blocked.stderr, /HTTP remoto/i);

  const allowed = await runCli(cliArgs(proxy.origin, collection, report, ['--allow-insecure-http']));
  assert.equal(allowed.code, 0, allowed.stderr);
  assert.equal(proxy.calls.length, 1);
  assert.equal(proxy.calls[0].allowInsecureHttp, true);
});

test('Runner CLI returns failure and writes redacted JUnit when response status fails', async t => {
  const directory = await createTempDirectory(t);
  const proxy = await startProxy(t, () => ({ status: 500, reason: 'Server Error', headers: {}, body: '{"secret":"RESPONSE_CANARY"}', error: 'RESPONSE_CANARY' }));
  const collection = await writeCollection(directory, {
    requests: [{ id: 'broken', name: 'Private route', method: 'GET', baseUrl: 'https://api.example.test', route: '/private' }]
  });
  const report = path.join(directory, 'failure.xml');
  const result = await runCli(cliArgs(proxy.origin, collection, report));
  assert.equal(result.code, 1);
  const junit = await fs.readFile(report, 'utf8');
  assert.match(junit, /failures="1"/);
  assert.match(junit, /HTTP 500/);
  assert.doesNotMatch(junit + result.stdout + result.stderr, /RESPONSE_CANARY|api\.example\.test|\/private/);
});

test('Runner CLI fails response assertions even when HTTP status is 2xx', async t => {
  const directory = await createTempDirectory(t);
  const proxy = await startProxy(t, () => ({ status: 200, reason: 'OK', headers: {}, body: '{"ok":false}' }));
  const collection = await writeCollection(directory, {
    requests: [{ id: 'assertion', method: 'GET', baseUrl: 'https://api.example.test', route: '/private', responseTests: [{ id: 'ok', target: 'json', path: 'ok', operator: 'equals', expected: 'true' }] }]
  });
  const report = path.join(directory, 'assertion.xml');
  const result = await runCli(cliArgs(proxy.origin, collection, report));
  assert.equal(result.code, 1);
  const junit = await fs.readFile(report, 'utf8');
  assert.match(junit, /failures="1"/);
  assert.doesNotMatch(junit + result.stdout + result.stderr, /api\.example\.test|\/private/);
});

test('Runner CLI does not follow redirects from its local proxy', async t => {
  const directory = await createTempDirectory(t);
  let stolenRequests = 0;
  const collector = createServer((request, response) => { stolenRequests++; response.writeHead(200).end(); });
  await new Promise((resolve, reject) => { collector.once('error', reject); collector.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => collector.close(resolve)));
  const collectorUrl = `http://127.0.0.1:${collector.address().port}/stolen`;
  const proxy = createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === '/health') return response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"status":"ok","product":"VortixApiClient","hostingMode":"local"}');
    if (url.pathname === '/api/request') return response.writeHead(307, { Location: collectorUrl }).end();
    if (url.pathname === '/api/storage/settings') return response.writeHead(204).end();
    return response.writeHead(404).end();
  });
  await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => proxy.close(resolve)));
  const collection = await writeCollection(directory, { requests: [{ id: 'read', method: 'GET', baseUrl: 'https://api.example.test', route: '/private' }] });
  const result = await runCli(cliArgs(`http://127.0.0.1:${proxy.address().port}`, collection, path.join(directory, 'redirect.xml')));
  assert.equal(result.code, 1);
  assert.equal(stolenRequests, 0, 'a redirected proxy request must never reach the Location host');
});

test('Runner CLI handles SIGINT, writes skipped JUnit steps, and cleans its temporary cookie jar', async t => {
  const directory = await createTempDirectory(t);
  const collection = await writeCollection(directory, {
    requests: [
      { id: 'waiting', method: 'GET', baseUrl: 'https://api.example.test', route: '/wait' },
      { id: 'later', method: 'GET', baseUrl: 'https://api.example.test', route: '/later' }
    ]
  });
  const report = path.join(directory, 'cancelled.xml');
  let resolveRequestSeen;
  const requestSeen = new Promise(resolve => { resolveRequestSeen = resolve; });
  const cleanups = [];
  const proxy = createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === 'GET' && url.pathname === '/health') return response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"status":"ok","product":"VortixApiClient","hostingMode":"local"}');
    if (request.method === 'DELETE' && url.pathname === '/api/storage/settings') {
      cleanups.push(url.searchParams.get('key'));
      return response.writeHead(204).end();
    }
    if (request.method === 'POST' && url.pathname === '/api/request') {
      resolveRequestSeen();
      request.on('close', () => {});
      return;
    }
    return response.writeHead(404).end();
  });
  await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => proxy.close(resolve)));
  const child = spawnSignaledCli(cliArgs(`http://127.0.0.1:${proxy.address().port}`, collection, report));
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let startTimer;
  try {
    await Promise.race([
      requestSeen,
      new Promise((_, reject) => { startTimer = setTimeout(() => reject(new Error('Runner did not start the request before the timeout.')), 5_000); })
    ]);
  } finally { clearTimeout(startTimer); }
  await sendSignal(child, 'SIGINT');
  const exit = await new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  assert.equal(exit.code, 130, `${stderr}\n${stdout}`);
  assert.equal(cleanups.length, 1);
  assert.match(cleanups[0], /^cookiejar:vortix-runner-/);
  const junit = await fs.readFile(report, 'utf8');
  assert.match(junit, /tests="2"/);
  assert.match(junit, /skipped="2"/);
});

test('Runner CLI returns 130 when interrupted during the local health check', async t => {
  const directory = await createTempDirectory(t);
  const collection = await writeCollection(directory, { requests: [{ id: 'read', method: 'GET', baseUrl: 'https://api.example.test', route: '/' }] });
  let resolveHealthSeen;
  const healthSeen = new Promise(resolve => { resolveHealthSeen = resolve; });
  const proxy = createServer((request, response) => {
    if (request.url === '/health') { resolveHealthSeen(); return; }
    response.writeHead(404).end();
  });
  await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => proxy.close(resolve)));
  const child = spawnSignaledCli(cliArgs(`http://127.0.0.1:${proxy.address().port}`, collection, path.join(directory, 'health.xml')));
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let timer;
  try {
    await Promise.race([healthSeen, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Runner did not call /health before the timeout.')), 5_000); })]);
  } finally { clearTimeout(timer); }
  await sendSignal(child, 'SIGINT');
  const exit = await new Promise(resolve => child.once('close', code => resolve(code)));
  assert.equal(exit, 130, stderr);
  assert.match(stderr, /interrompido/i);
});

test('Runner CLI preserves exit code 130 when interrupted during Cookie jar cleanup', async t => {
  const directory = await createTempDirectory(t);
  const collection = await writeCollection(directory, { requests: [{ id: 'read', method: 'GET', baseUrl: 'https://api.example.test', route: '/' }] });
  let resolveCleanupSeen, releaseCleanup;
  const cleanupSeen = new Promise(resolve => { resolveCleanupSeen = resolve; });
  const cleanupGate = new Promise(resolve => { releaseCleanup = resolve; });
  let cleanupKey = '';
  const proxy = createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === 'GET' && url.pathname === '/health') return response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"status":"ok","product":"VortixApiClient","hostingMode":"local"}');
    if (request.method === 'POST' && url.pathname === '/api/request') return response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"status":200,"reason":"OK","headers":{},"body":"{}"}');
    if (request.method === 'DELETE' && url.pathname === '/api/storage/settings') {
      cleanupKey = url.searchParams.get('key');
      resolveCleanupSeen();
      await cleanupGate;
      return response.writeHead(204).end();
    }
    return response.writeHead(404).end();
  });
  await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => proxy.close(resolve)));
  const report = path.join(directory, 'cleanup.xml');
  const child = spawnSignaledCli(cliArgs(`http://127.0.0.1:${proxy.address().port}`, collection, report));
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let timer;
  try {
    await Promise.race([cleanupSeen, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Runner did not start Cookie jar cleanup before the timeout.')), 5_000); })]);
  } finally { clearTimeout(timer); }
  await sendSignal(child, 'SIGTERM');
  releaseCleanup();
  const exit = await new Promise(resolve => child.once('close', code => resolve(code)));
  assert.equal(exit, 130, stderr);
  assert.match(cleanupKey, /^cookiejar:vortix-runner-/);
  const junit = await fs.readFile(report, 'utf8');
  assert.match(junit, /tests="1"/);
  assert.match(junit, /failures="0"/);
});
