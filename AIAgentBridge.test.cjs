const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = __dirname;

function element({ id = '', dataset = {}, value = '', checked = false, disabled = false, hidden = false, textContent = '', className = '', type = '', label = '' } = {}) {
  const attributes = label ? { 'aria-label': label } : {};
  return {
    id, dataset, value, checked, disabled, hidden, textContent, className, type,
    children: [], options: [],
    getAttribute(name) { return attributes[name] ?? null; },
    classList: { contains(name) { return className.split(/\s+/).includes(name); } }
  };
}

function createDocument() {
  const values = {
    url: 'https://private.example.test/tenant/42',
    route: '/users/private-user-42',
    params: 'api_key=PARAM_SENTINEL',
    headers: 'Authorization: HEADER_SENTINEL',
    body: '{"token":"BODY_SENTINEL"}',
    auth: 'AUTH_SENTINEL',
    environment: 'ENVIRONMENT_SENTINEL',
    response: 'RESPONSE_SENTINEL',
    phrase: 'TESTE_SENTINEL'
  };
  const elements = new Map([
    ['method', element({ id: 'method', value: 'PATCH' })],
    ['base-url', element({ id: 'base-url', value: values.url })],
    ['route', element({ id: 'route', value: values.route })],
    ['query-params', element({ id: 'query-params' })],
    ['headers', element({ id: 'headers', value: values.headers })],
    ['body-mode', element({ id: 'body-mode', value: 'json' })],
    ['body', element({ id: 'body', value: values.body })],
    ['auth-type', element({ id: 'auth-type', value: 'bearer' })],
    ['auth-inheritance-mode', element({ id: 'auth-inheritance-mode', value: 'custom' })],
    ['bearer-token', element({ id: 'bearer-token', value: values.auth, type: 'password' })],
    ['basic-username', element({ id: 'basic-username' })],
    ['basic-password', element({ id: 'basic-password', type: 'password' })],
    ['api-key-value', element({ id: 'api-key-value', type: 'password' })],
    ['save-token-history', element({ id: 'save-token-history', checked: true })],
    ['test-data-phrase', element({ id: 'test-data-phrase', value: values.phrase })],
    ['confirm-test-data', element({ id: 'confirm-test-data', checked: true })],
    ['write-guard', element({ id: 'write-guard', hidden: false })],
    ['send-request', element({ id: 'send-request', disabled: false })],
    ['environment-select', element({ id: 'environment-select', value: values.environment })],
    ['workspace-tabs', element({ id: 'workspace-tabs' })],
    ['response-status', element({ id: 'response-status', textContent: '200 OK', className: 'status ok' })],
    ['response-headers', element({ id: 'response-headers', textContent: values.response })],
    ['response-body', element({ id: 'response-body', textContent: values.response })]
  ]);
  elements.get('query-params').children = [{}, {}];
  elements.get('environment-select').options = [{}, {}, {}];

  const actions = [
    element({ id: 'send-request', dataset: { vortixAction: 'request.send' }, label: 'Enviar' }),
    element({ id: 'refresh-agent-safe-state', dataset: { vortixAction: 'agent.snapshot.refresh' }, label: 'Gerar estado seguro' })
  ];
  const fields = [
    element({ id: 'method', dataset: { vortixField: 'request.method' }, value: 'PATCH' }),
    element({ id: 'bearer-token', dataset: { vortixField: 'request.auth.bearer' }, value: values.auth, type: 'password' })
  ];
  const regions = [element({ id: 'request-editor', dataset: { vortixRegion: 'request-editor' } })];
  const tabs = [element({ id: 'workspace-tab-0', dataset: { workspaceTabId: 'tab-1' }, label: 'Users' })];
  tabs[0].getAttribute = name => name === 'aria-selected' ? 'true' : null;
  const activeEditorTab = element({ id: 'editor-tab-params', dataset: { editorTab: 'params' } });
  activeEditorTab.getAttribute = name => name === 'aria-selected' ? 'true' : null;

  const meta = element();
  meta.content = '2';
  const doc = {
    getElementById(id) { return elements.get(id) ?? null; },
    querySelector(selector) {
      if (selector === 'meta[name="vortix-agent-contract"]') return meta;
      if (selector === '[data-editor-tab][aria-selected="true"]') return activeEditorTab;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-vortix-action]') return actions;
      if (selector === '[data-vortix-field]') return fields;
      if (selector === '[data-vortix-region]') return regions;
      if (selector === '#workspace-tabs [role="tab"]') return tabs;
      return [];
    }
  };
  return { document: doc, values };
}

test('Vortix loads contract v2 bridge and safe snapshot leaks no user values', async () => {
  const html = await fs.readFile(path.join(root, 'wwwroot', 'index.html'), 'utf8');
  assert.ok(html.includes('<meta name="vortix-agent-contract" content="2">'), 'contract version should be 2');
  assert.ok(html.includes('<script src="/agent-bridge.js" defer></script>'), 'page should load the agent bridge');
  assert.ok(html.includes('data-vortix-region="agent-safe-state"'), 'safe state panel should be in the DOM');

  const source = await fs.readFile(path.join(root, 'wwwroot', 'agent-bridge.js'), 'utf8');
  const { document, values } = createDocument();
  const window = {};
  const context = {
    window,
    document,
    fetch() { throw new Error('bridge must not fetch'); },
    localStorage: { getItem() { throw new Error('bridge must not read storage'); } },
    indexedDB: { open() { throw new Error('bridge must not read storage'); } }
  };
  vm.runInNewContext(source, context, { filename: 'agent-bridge.js' });

  const api = window.vortixAgent;
  assert.deepEqual(Object.keys(api).sort(), ['contractVersion', 'describe', 'snapshot']);
  assert.equal(api.contractVersion, 2);
  const description = api.describe();
  assert.equal(description.contractVersion, 2);
  assert.ok(description.actions.some(action => action.name === 'request.send'));
  assert.ok(description.fields.some(field => field.name === 'request.method'));
  assert.ok(description.regions.some(region => region.name === 'request-editor'));

  const snapshot = api.snapshot();
  assert.equal(snapshot.request.method, 'PATCH');
  assert.equal(snapshot.request.baseUrlPresent, true);
  assert.equal(snapshot.request.routePresent, true);
  assert.equal(snapshot.request.paramsCount, 2);
  assert.equal(snapshot.request.bodyMode, 'json');
  assert.equal(snapshot.request.authType, 'bearer');
  assert.equal(snapshot.request.authConfigured, true);
  assert.equal(snapshot.request.authPersistenceEnabled, true);
  assert.equal(snapshot.request.requiresWriteConfirmation, true);
  assert.equal(Object.hasOwn(snapshot.request, 'sendEnabled'), false);
  assert.equal(Object.hasOwn(snapshot.request, 'writeConfirmed'), false);
  assert.equal(snapshot.response.statusCode, 200);
  assert.equal(snapshot.response.state, 'ok');

  const serialized = JSON.stringify({ description, snapshot });
  for (const secret of Object.values(values)) assert.equal(serialized.includes(secret), false, `bridge leaked ${secret}`);
});

test('safe snapshot tolerates a page whose request controls are not ready', async () => {
  const html = await fs.readFile(path.join(root, 'wwwroot', 'index.html'), 'utf8');
  assert.ok(html.includes('<script src="/agent-bridge.js" defer></script>'), 'page should load the agent bridge');
  const source = await fs.readFile(path.join(root, 'wwwroot', 'agent-bridge.js'), 'utf8');
  const window = {};
  const document = { getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; } };
  vm.runInNewContext(source, { window, document }, { filename: 'agent-bridge.js' });
  assert.equal(window.vortixAgent.snapshot().request.method, null);
  assert.equal(window.vortixAgent.snapshot().response.statusCode, null);
});

test('safe-state button renders JSON and reports a missing bridge without side effects', async () => {
  const app = await fs.readFile(path.join(root, 'wwwroot', 'app.js'), 'utf8');
  const start = app.indexOf('function refreshAgentSafeState(');
  const end = app.indexOf('\nfunction vaultCaptureError(', start);
  assert.ok(start >= 0 && end > start, 'safe-state button handler should exist');
  const output = { textContent: '', hidden: true };
  const messages = [];
  const snapshot = { contractVersion: 2, request: { method: 'GET', routePresent: true } };
  const handler = vm.runInNewContext(`${app.slice(start, end)}; refreshAgentSafeState`, {
    byId: id => id === 'agent-safe-state-output' ? output : null,
    window: { vortixAgent: { snapshot: () => snapshot } },
    showToast: (...args) => messages.push(args)
  });

  handler();
  assert.equal(output.textContent, JSON.stringify(snapshot, null, 2));
  assert.equal(output.hidden, false);
  assert.deepEqual(messages, []);
});
