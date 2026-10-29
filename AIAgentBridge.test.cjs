const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const VortixDiagnostics = require('./wwwroot/agent-diagnostics.js');
const root = __dirname;

function element({ id = '', dataset = {}, value = '', checked = false, disabled, hidden = false, textContent = '', className = '', type = '', label = '', attributes = {}, open } = {}) {
  const elementAttributes = { ...attributes, ...(label ? { 'aria-label': label } : {}) };
  const result = {
    id, dataset, value, checked, hidden, textContent, className, type,
    children: [], options: [], descendants: [],
    getAttribute(name) { return elementAttributes[name] ?? null; },
    contains(target) { return target === this || this.descendants.includes(target); },
    classList: { contains(name) { return className.split(/\s+/).includes(name); } }
  };
  if (disabled !== undefined) result.disabled = disabled;
  if (open !== undefined) result.open = open;
  return result;
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
    ['multipart-fields-list', element({ id: 'multipart-fields-list' })],
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
  elements.get('query-params').children = ['page', 'sort'].map(name => ({
    querySelector(selector) { return selector === '[data-query-name]' ? { value: name } : null; }
  }));
  elements.get('environment-select').options = [{}, {}, {}];

  const actions = [
    element({ id: 'send-request', dataset: { vortixAction: 'request.send' }, label: 'Enviar', disabled: true }),
    element({ id: 'refresh-agent-safe-state', dataset: { vortixAction: 'agent.snapshot.refresh' }, label: 'Gerar estado seguro', disabled: false }),
    element({ id: 'ai-friendly-trigger', dataset: { vortixAction: 'agent.help.open' }, label: 'Bridge v2 ativo', disabled: false }),
    element({ id: 'copy-maestri-agent-prompt', dataset: { vortixAction: 'agent.prompt.copy' }, label: 'Copiar prompt', disabled: false })
  ];
  const fields = [
    element({ id: 'method', dataset: { vortixField: 'request.method' }, value: 'PATCH', disabled: false }),
    element({ id: 'bearer-token', dataset: { vortixField: 'request.auth.bearer' }, value: values.auth, type: 'password', disabled: false }),
    element({ id: 'ai-friendly-status', dataset: { vortixField: 'agent.capability-status' }, textContent: 'Bridge v2 ativo' })
  ];
  const requestEditor = element({ id: 'request-editor', dataset: { vortixRegion: 'request-editor' } });
  const historyRegion = element({ id: 'history-panel', dataset: { vortixRegion: 'history' }, open: true });
  const regions = [requestEditor, historyRegion];
  const tabs = [element({ id: 'workspace-tab-0', dataset: { workspaceTabId: 'tab-1' }, label: 'Users' })];
  tabs[0].getAttribute = name => name === 'aria-selected' ? 'true' : null;
  const activeEditorTab = element({
    id: 'editor-tab-params', dataset: { editorTab: 'params' },
    attributes: { 'aria-selected': 'true', 'aria-controls': 'params-panel' }
  });
  requestEditor.descendants = [actions[0], actions[1], fields[0], fields[1], activeEditorTab];

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
      if (selector === '[data-editor-tab]') return [activeEditorTab];
      if (selector === '#workspace-tabs [role="tab"]') return tabs;
      return [];
    }
  };
  return { document: doc, values, elements, actions, fields, regions, activeEditorTab };
}

function setDiagnosticRecord(elements, rawRecord) {
  elements.set('structured-card', element({
    id: 'structured-card',
    attributes: { 'data-vortix-diagnostic': rawRecord }
  }));
}

async function loadBridge(document, { diagnostics = VortixDiagnostics, now = 1000, window = {}, globals = {} } = {}) {
  const source = await fs.readFile(path.join(root, 'wwwroot', 'agent-bridge.js'), 'utf8');
  const clock = typeof now === 'function' ? now : () => now;
  vm.runInNewContext(source, {
    window,
    document,
    VortixDiagnostics: diagnostics,
    performance: { now: clock },
    ...globals
  }, { filename: 'agent-bridge.js' });
  return { api: window.vortixAgent, window };
}

function normalizeDiagnostic(value) {
  return JSON.parse(JSON.stringify(value));
}

function unavailableDiagnostic() {
  return {
    diagnosticVersion: 1,
    revision: null,
    state: 'unavailable',
    freshness: 'unavailable',
    blocker: 'diagnostic_unavailable',
    nextAction: null
  };
}

function diagnosticControls(overrides = {}) {
  return {
    'request.save': true,
    'environment.manage': true,
    'settings.open': true,
    'execution.prepare': true,
    'execution.review': true,
    'execution.execute': true,
    ...overrides
  };
}

function blockedDiagnosticFacts(overrides = {}) {
  return {
    state: 'blocked',
    contextMatches: true,
    validUntilMs: null,
    blockers: ['unresolved_variables'],
    controls: diagnosticControls({ 'execution.review': false, 'execution.execute': false }),
    result: null,
    ...overrides
  };
}

function completedDiagnosticFacts(overrides = {}) {
  return {
    state: 'completed',
    contextMatches: true,
    validUntilMs: null,
    blockers: [],
    controls: diagnosticControls(),
    result: {
      outcome: 'http_error',
      delivery: 'response_received',
      httpStatus: 422,
      proxyStatus: 200,
      durationMs: 12.5,
      assertions: { passed: 0, failed: 1, partial: 0 },
      validation: 'passed',
      capture: 'failed',
      persistence: 'completed',
      url: 'URL_SENTINEL',
      authorization: 'AUTH_SENTINEL',
      responseText: 'RESPONSE_SENTINEL'
    },
    ...overrides
  };
}

function createBridgeEffects() {
  const calls = { http: 0, storage: 0, prepare: 0, approve: 0, cancel: 0, capture: 0 };
  const spy = name => () => {
    calls[name] += 1;
    throw new Error(name.toUpperCase() + '_SIDE_EFFECT_SENTINEL');
  };
  const storage = {
    getItem: spy('storage'),
    setItem: spy('storage'),
    removeItem: spy('storage'),
    clear: spy('storage')
  };
  const indexedDB = { open: spy('storage'), deleteDatabase: spy('storage') };
  const controller = {
    prepare: spy('prepare'),
    approve: spy('approve'),
    cancel: spy('cancel'),
    capture: spy('capture')
  };
  function XMLHttpRequest() {
    calls.http += 1;
    throw new Error('HTTP_SIDE_EFFECT_SENTINEL');
  }
  const window = {
    fetch: spy('http'),
    XMLHttpRequest,
    localStorage: storage,
    sessionStorage: storage,
    indexedDB,
    controller,
    structuredExecution: controller
  };
  return {
    calls,
    window,
    globals: {
      fetch: spy('http'),
      XMLHttpRequest,
      localStorage: storage,
      sessionStorage: storage,
      indexedDB,
      controller,
      structuredExecution: controller,
      prepare: spy('prepare'),
      approve: spy('approve'),
      cancel: spy('cancel'),
      capture: spy('capture')
    }
  };
}

function assertNoBridgeEffects(calls) {
  assert.deepEqual(calls, { http: 0, storage: 0, prepare: 0, approve: 0, cancel: 0, capture: 0 });
}

test('diagnose delegates each view with only the record and fractional monotonic time', async () => {
  const { document, elements } = createDocument();
  const rawRecord = 'RAW_RECORD_SENTINEL';
  setDiagnosticRecord(elements, rawRecord);
  const card = elements.get('structured-card');
  const originalGetAttribute = card.getAttribute.bind(card);
  const attributeReads = [];
  card.getAttribute = name => {
    attributeReads.push(name);
    return originalGetAttribute(name);
  };

  const domReads = { ids: [], selectors: [], lists: [] };
  const observedDocument = {
    getElementById(id) {
      domReads.ids.push(id);
      return document.getElementById(id);
    },
    querySelector(selector) {
      domReads.selectors.push(selector);
      return document.querySelector(selector);
    },
    querySelectorAll(selector) {
      domReads.lists.push(selector);
      return document.querySelectorAll(selector);
    }
  };

  const common = {
    diagnosticVersion: 1,
    revision: 7,
    state: 'blocked',
    freshness: 'fresh',
    blocker: 'unresolved_variables',
    nextAction: 'environment.manage'
  };
  const views = {
    summary: { ...common },
    blockers: {
      ...common,
      blockers: [{ code: 'unresolved_variables', target: { kind: 'action', name: 'environment.manage' } }]
    },
    result: { ...common, result: null }
  };
  const readerCalls = [];
  const reader = {
    readDiagnostic(record, options, now) {
      readerCalls.push([record, options, now]);
      if (record === null) return unavailableDiagnostic();
      return views[options?.view ?? 'summary'];
    }
  };
  const effects = createBridgeEffects();
  let clockReads = 0;
  const { api } = await loadBridge(observedDocument, {
    diagnostics: reader,
    now: () => {
      clockReads += 1;
      return 1234.5;
    },
    window: effects.window,
    globals: effects.globals
  });
  domReads.selectors.length = 0;

  const calls = [
    [undefined, views.summary],
    [{ view: 'summary' }, views.summary],
    [{ view: 'blockers' }, views.blockers],
    [{ view: 'result' }, views.result]
  ];
  const outputs = [];
  for (const [options, expected] of calls) {
    const output = options === undefined ? api.diagnose() : api.diagnose(options);
    outputs.push(output);
    assert.deepEqual(output, expected);
    assertNoBridgeEffects(effects.calls);
  }

  elements.delete('structured-card');
  assert.deepEqual(api.diagnose(), unavailableDiagnostic());
  assertNoBridgeEffects(effects.calls);

  assert.deepEqual(readerCalls, [
    [rawRecord, undefined, 1234.5],
    [rawRecord, { view: 'summary' }, 1234.5],
    [rawRecord, { view: 'blockers' }, 1234.5],
    [rawRecord, { view: 'result' }, 1234.5],
    [null, undefined, 1234.5]
  ]);
  assert.deepEqual(attributeReads, Array(4).fill('data-vortix-diagnostic'));
  assert.deepEqual(domReads.ids, Array(5).fill('structured-card'));
  assert.deepEqual(domReads.selectors, []);
  assert.deepEqual(domReads.lists, []);
  assert.equal(clockReads, 5);
  assert.equal(JSON.stringify(outputs).includes(rawRecord), false);
});

test('diagnose fails closed when its reader is missing or throws', async () => {
  const { document, elements } = createDocument();
  const rawRecord = 'READER_INPUT_SENTINEL';
  setDiagnosticRecord(elements, rawRecord);
  let attributeReads = 0;
  const card = elements.get('structured-card');
  const getAttribute = card.getAttribute.bind(card);
  card.getAttribute = name => {
    attributeReads += 1;
    return getAttribute(name);
  };

  const missingEffects = createBridgeEffects();
  const missingReader = await loadBridge(document, {
    diagnostics: null,
    window: missingEffects.window,
    globals: missingEffects.globals
  });
  assert.deepEqual(normalizeDiagnostic(missingReader.api.diagnose()), unavailableDiagnostic());
  assert.equal(attributeReads, 0);
  assertNoBridgeEffects(missingEffects.calls);

  const readerCalls = [];
  const throwingEffects = createBridgeEffects();
  const throwingReader = await loadBridge(document, {
    diagnostics: {
      readDiagnostic(...args) {
        readerCalls.push(args);
        throw new Error('READER_EXCEPTION_SENTINEL');
      }
    },
    now: 1234.5,
    window: throwingEffects.window,
    globals: throwingEffects.globals
  });
  const output = throwingReader.api.diagnose();
  assert.deepEqual(normalizeDiagnostic(output), unavailableDiagnostic());
  assert.deepEqual(readerCalls, [[rawRecord, undefined, 1234.5]]);
  assert.equal(JSON.stringify(output).includes('SENTINEL'), false);
  assertNoBridgeEffects(throwingEffects.calls);
});

test('diagnose exposes real safe summary, blockers and result views', async () => {
  const { document, elements } = createDocument();
  const sourceSentinel = 'DIAGNOSTIC_SOURCE_SENTINEL';
  const blockedRecord = VortixDiagnostics.buildRecord(blockedDiagnosticFacts({
    requestUrl: sourceSentinel,
    body: sourceSentinel,
    variables: sourceSentinel,
    errorMessage: sourceSentinel
  }), null, 1000);
  setDiagnosticRecord(elements, JSON.stringify(blockedRecord));

  const effects = createBridgeEffects();
  const { api } = await loadBridge(document, {
    now: 1001,
    window: effects.window,
    globals: effects.globals
  });

  const summary = api.diagnose();
  assert.deepEqual(summary, {
    diagnosticVersion: 1,
    revision: 1,
    state: 'blocked',
    freshness: 'fresh',
    blocker: 'unresolved_variables',
    nextAction: 'environment.manage'
  });
  assert.ok(Buffer.byteLength(JSON.stringify(summary), 'utf8') <= 512);
  assertNoBridgeEffects(effects.calls);

  const blockers = api.diagnose({ view: 'blockers' });
  assert.deepEqual(blockers, {
    diagnosticVersion: 1,
    revision: 1,
    state: 'blocked',
    freshness: 'fresh',
    blocker: 'unresolved_variables',
    nextAction: 'environment.manage',
    blockers: [{ code: 'unresolved_variables', target: { kind: 'action', name: 'environment.manage' } }]
  });
  assert.ok(Buffer.byteLength(JSON.stringify(blockers), 'utf8') <= 4096);
  blockers.blockers[0].target.name = 'mutated';
  assert.equal(api.diagnose({ view: 'blockers' }).blockers[0].target.name, 'environment.manage');
  assertNoBridgeEffects(effects.calls);

  const completedRecord = VortixDiagnostics.buildRecord(completedDiagnosticFacts(), null, 1000);
  setDiagnosticRecord(elements, JSON.stringify(completedRecord));
  const result = api.diagnose({ view: 'result' });
  assert.deepEqual(result, {
    diagnosticVersion: 1,
    revision: 1,
    state: 'completed',
    freshness: 'fresh',
    blocker: null,
    nextAction: null,
    result: {
      outcome: 'http_error',
      delivery: 'response_received',
      httpStatus: 422,
      proxyStatus: 200,
      durationMs: 12.5,
      assertions: { passed: 0, failed: 1, partial: 0 },
      validation: 'failed',
      capture: 'failed',
      persistence: 'completed'
    }
  });
  assert.ok(Buffer.byteLength(JSON.stringify(result), 'utf8') <= 2048);
  assert.equal(JSON.stringify({ summary, blockers, result }).includes('SENTINEL'), false);
  assertNoBridgeEffects(effects.calls);
});

test('an approved diagnostic remains an inert hint to the existing controller', async () => {
  const { document, elements } = createDocument();
  const record = VortixDiagnostics.buildRecord(blockedDiagnosticFacts({
    state: 'approved',
    blockers: [],
    validUntilMs: 5000.5,
    controls: diagnosticControls({ 'execution.execute': true })
  }), null, 1000.5);
  setDiagnosticRecord(elements, JSON.stringify(record));

  const effects = createBridgeEffects();
  const { api } = await loadBridge(document, {
    now: 1001.25,
    window: effects.window,
    globals: effects.globals
  });
  assert.deepEqual(api.diagnose(), {
    diagnosticVersion: 1,
    revision: 1,
    state: 'approved',
    freshness: 'fresh',
    blocker: null,
    nextAction: 'execution.execute'
  });
  assertNoBridgeEffects(effects.calls);
});

test('diagnose preserves context mismatch and omits the previous result', async () => {
  const { document, elements } = createDocument();
  const record = VortixDiagnostics.buildRecord(completedDiagnosticFacts({
    contextMatches: false
  }), null, 1000.5);
  setDiagnosticRecord(elements, JSON.stringify(record));

  const effects = createBridgeEffects();
  const { api } = await loadBridge(document, {
    now: 1001.25,
    window: effects.window,
    globals: effects.globals
  });
  assert.deepEqual(api.diagnose(), {
    diagnosticVersion: 1,
    revision: 1,
    state: 'unknown',
    freshness: 'unavailable',
    blocker: 'context_changed',
    nextAction: null
  });
  assert.deepEqual(api.diagnose({ view: 'blockers' }).blockers.map(entry => entry.code), ['context_changed']);
  assert.equal(api.diagnose({ view: 'result' }).result, null);
  assertNoBridgeEffects(effects.calls);
});

test('diagnose degrades an approved record at the fractional freshness boundary', async () => {
  const { document, elements } = createDocument();
  const record = VortixDiagnostics.buildRecord(blockedDiagnosticFacts({
    state: 'approved',
    blockers: [],
    validUntilMs: 5000.5,
    controls: diagnosticControls({ 'execution.execute': true })
  }), null, 1000.25);
  setDiagnosticRecord(elements, JSON.stringify(record));

  const freshEffects = createBridgeEffects();
  const { api: freshApi } = await loadBridge(document, {
    now: 3000.249,
    window: freshEffects.window,
    globals: freshEffects.globals
  });
  assert.deepEqual(freshApi.diagnose(), {
    diagnosticVersion: 1,
    revision: 1,
    state: 'approved',
    freshness: 'fresh',
    blocker: null,
    nextAction: 'execution.execute'
  });
  assertNoBridgeEffects(freshEffects.calls);

  const staleEffects = createBridgeEffects();
  const { api: staleApi } = await loadBridge(document, {
    now: 3000.25,
    window: staleEffects.window,
    globals: staleEffects.globals
  });
  assert.deepEqual(staleApi.diagnose(), {
    diagnosticVersion: 1,
    revision: 1,
    state: 'unknown',
    freshness: 'stale',
    blocker: 'diagnostic_stale',
    nextAction: null
  });
  assert.equal(staleApi.diagnose({ view: 'result' }).result, null);
  assertNoBridgeEffects(staleEffects.calls);
});

test('diagnose rejects invalid options without invoking getters or echoing proxy failures', async () => {
  const { document, elements } = createDocument();
  const record = VortixDiagnostics.buildRecord(blockedDiagnosticFacts(), null, 1000);
  setDiagnosticRecord(elements, JSON.stringify(record));

  const effects = createBridgeEffects();
  const { api } = await loadBridge(document, {
    now: 1001,
    window: effects.window,
    globals: effects.globals
  });
  const invalidOptions = [
    null,
    [],
    { view: 'raw' },
    { view: 'summary', id: 'OPTION_SENTINEL' }
  ];
  const symbolOptions = { view: 'summary' };
  symbolOptions[Symbol('OPTION_SENTINEL')] = 'OPTION_SENTINEL';
  invalidOptions.push(symbolOptions);

  const expectedError = { diagnosticVersion: 1, error: 'invalid_diagnostic_options' };
  for (const options of invalidOptions) {
    assert.deepEqual(api.diagnose(options), expectedError);
    assertNoBridgeEffects(effects.calls);
  }

  let getterCalls = 0;
  const accessorOptions = {};
  Object.defineProperty(accessorOptions, 'view', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'summary';
    }
  });
  assert.deepEqual(api.diagnose(accessorOptions), expectedError);
  assert.equal(getterCalls, 0);
  assertNoBridgeEffects(effects.calls);

  const proxyOptions = new Proxy({}, {
    getPrototypeOf() {
      throw new Error('OPTIONS_PROXY_SENTINEL');
    }
  });
  const proxyOutput = api.diagnose(proxyOptions);
  assert.deepEqual(normalizeDiagnostic(proxyOutput), expectedError);
  assert.equal(JSON.stringify(proxyOutput).includes('OPTIONS_PROXY_SENTINEL'), false);
  assertNoBridgeEffects(effects.calls);
});

test('malformed and oversized diagnostic attributes fail closed without echo or fallback', async () => {
  const { document, elements } = createDocument();
  const record = VortixDiagnostics.buildRecord(blockedDiagnosticFacts(), null, 1000);
  const rawRecord = JSON.stringify(record);
  const oversizedRecord = rawRecord + ' '.repeat(4097);
  assert.ok(Buffer.byteLength(oversizedRecord, 'utf8') > 4096);
  const malformedRecords = [
    '{MALFORMED_RECORD_SENTINEL',
    JSON.stringify({ ...record, diagnosticVersion: 2, extra: 'RECORD_SENTINEL' }),
    oversizedRecord
  ];

  const effects = createBridgeEffects();
  const { api } = await loadBridge(document, {
    now: 1001,
    window: effects.window,
    globals: effects.globals
  });
  for (const malformed of malformedRecords) {
    setDiagnosticRecord(elements, malformed);
    const output = api.diagnose();
    assert.deepEqual(output, unavailableDiagnostic());
    assert.equal(JSON.stringify(output).includes('SENTINEL'), false);
    assertNoBridgeEffects(effects.calls);
  }

  const proxiedCard = new Proxy({}, {
    get(_target, property) {
      if (property === 'getAttribute') throw new Error('DOM_PROXY_SENTINEL');
      return undefined;
    }
  });
  elements.set('structured-card', proxiedCard);
  const proxyOutput = api.diagnose();
  assert.deepEqual(normalizeDiagnostic(proxyOutput), unavailableDiagnostic());
  assert.equal(JSON.stringify(proxyOutput).includes('DOM_PROXY_SENTINEL'), false);
  assertNoBridgeEffects(effects.calls);
});
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
  assert.deepEqual(Object.keys(api).sort(), ['contractVersion', 'describe', 'diagnose', 'snapshot']);
  assert.equal(Object.isFrozen(api), true);
  const diagnoseDescriptor = Object.getOwnPropertyDescriptor(api, 'diagnose');
  assert.equal(diagnoseDescriptor.writable, false);
  assert.equal(diagnoseDescriptor.configurable, false);
  assert.equal(diagnoseDescriptor.get, undefined);
  assert.equal(diagnoseDescriptor.set, undefined);
  assert.equal(api.contractVersion, 2);
  const description = JSON.parse(JSON.stringify(api.describe()));
  assert.deepEqual(description, {
    contractVersion: 2,
    readOnly: true,
    actions: [
      { name: 'request.send', id: 'send-request' },
      { name: 'agent.snapshot.refresh', id: 'refresh-agent-safe-state' },
      { name: 'agent.help.open', id: 'ai-friendly-trigger' },
      { name: 'agent.prompt.copy', id: 'copy-maestri-agent-prompt' }
    ],
    fields: [
      { name: 'request.method', id: 'method', kind: null, sensitive: false },
      { name: 'request.auth.bearer', id: 'bearer-token', kind: 'password', sensitive: true },
      { name: 'agent.capability-status', id: 'ai-friendly-status', kind: null, sensitive: false }
    ],
    regions: [
      { name: 'request-editor', id: 'request-editor' },
      { name: 'history', id: 'history-panel' }
    ],
    editorTabs: [
      { name: 'params', id: 'editor-tab-params', panelId: 'params-panel', selected: true }
    ]
  });
  assert.equal(Object.hasOwn(description.actions[0], 'state'), false);

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

test('describe scopes regions, exposes safe control state, handles unknown regions, and leaks no values', async () => {
  const source = await fs.readFile(path.join(root, 'wwwroot', 'agent-bridge.js'), 'utf8');
  const { document, values } = createDocument();
  const window = {};
  vm.runInNewContext(source, { window, document }, { filename: 'agent-bridge.js' });

  const api = window.vortixAgent;
  const full = api.describe();
  const scoped = JSON.parse(JSON.stringify(api.describe({ region: 'request-editor', includeState: true })));
  assert.deepEqual(scoped.actions.map(action => action.name), ['request.send', 'agent.snapshot.refresh']);
  assert.deepEqual(scoped.actions[0].state, { disabled: true });
  assert.equal(scoped.fields[0].state.disabled, false);
  assert.deepEqual(scoped.editorTabs[0].selected, true);
  assert.deepEqual(scoped.regions.map(region => region.name), ['request-editor']);
  assert.ok(Buffer.byteLength(JSON.stringify(scoped), 'utf8') < Buffer.byteLength(JSON.stringify(full), 'utf8'));

  const history = JSON.parse(JSON.stringify(api.describe({ region: 'history', includeState: true })));
  assert.deepEqual(history.regions[0].state, { expanded: true });

  const unknown = JSON.parse(JSON.stringify(api.describe({ region: 'not-a-region', includeState: true })));
  assert.deepEqual(unknown, {
    contractVersion: 2, readOnly: true, actions: [], fields: [], regions: [], editorTabs: []
  });

  const serialized = JSON.stringify({ scoped, history, unknown });
  for (const secret of Object.values(values)) assert.equal(serialized.includes(secret), false, `describe leaked ${secret}`);
  assert.equal(serialized.includes('"checked"'), false, 'describe must not expose confirmation state');
  assert.equal(serialized.includes('"value"'), false, 'describe must not expose control values');
});

test('safe snapshot detects a GraphQL body from the active editor without exposing it', async () => {
  const source = await fs.readFile(path.join(root, 'wwwroot', 'agent-bridge.js'), 'utf8');
  const { document, elements } = createDocument();
  elements.get('body-mode').value = 'graphql';
  elements.get('body').value = '';
  const querySecret = 'GRAPHQL_QUERY_SENTINEL';
  elements.set('graphql-query', element({ id: 'graphql-query', value: `query { user(name: "${querySecret}") { id } }` }));
  elements.set('graphql-variables', element({ id: 'graphql-variables', value: `{"name":"${querySecret}"}` }));
  const window = {};
  vm.runInNewContext(source, { window, document }, { filename: 'agent-bridge.js' });

  const snapshot = window.vortixAgent.snapshot();
  assert.equal(snapshot.request.bodyPresent, true);
  assert.equal(JSON.stringify(snapshot).includes(querySecret), false);
  elements.get('graphql-query').value = '';
  elements.get('graphql-variables').value = '';
  elements.get('body').value = 'STALE_RAW_BODY_SENTINEL';
  assert.equal(window.vortixAgent.snapshot().request.bodyPresent, false);
});

test('safe snapshot detects multipart fields from the active editor without exposing values', async () => {
  const source = await fs.readFile(path.join(root, 'wwwroot', 'agent-bridge.js'), 'utf8');
  const { document, elements } = createDocument();
  elements.get('body-mode').value = 'multipart';
  elements.get('body').value = '';
  const valueSecret = 'MULTIPART_VALUE_SENTINEL';
  const controls = new Map([
    ['[data-multipart-name]', element({ value: 'comment' })],
    ['[data-multipart-value]', element({ value: valueSecret })],
    ['[data-multipart-file]', { files: [] }]
  ]);
  elements.get('multipart-fields-list').children = [{ dataset: {}, querySelector: selector => controls.get(selector) ?? null }];
  const window = {};
  vm.runInNewContext(source, { window, document }, { filename: 'agent-bridge.js' });

  const snapshot = window.vortixAgent.snapshot();
  assert.equal(snapshot.request.bodyPresent, true);
  assert.equal(JSON.stringify(snapshot).includes(valueSecret), false);
  elements.get('multipart-fields-list').children = [];
  elements.get('body').value = 'STALE_RAW_BODY_SENTINEL';
  assert.equal(window.vortixAgent.snapshot().request.bodyPresent, false);
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

test('safe snapshot counts usable environment options without assuming a placeholder', async () => {
  const source = await fs.readFile(path.join(root, 'wwwroot', 'agent-bridge.js'), 'utf8');
  const { document, elements } = createDocument();
  elements.get('environment-select').options = [{ value: 'local' }, { value: 'test' }];
  const window = {};
  vm.runInNewContext(source, { window, document }, { filename: 'agent-bridge.js' });

  assert.equal(window.vortixAgent.snapshot().environment.count, 2);
  elements.get('environment-select').options = [{ value: '', disabled: true }];
  assert.equal(window.vortixAgent.snapshot().environment.count, 0);
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


test('snapshot counts configured parameter names without exposing names or values', async () => {
  const doc = createDocument();
  const row = (name, value = '') => ({
    querySelector(selector) {
      return selector === '[data-query-name]' ? { value: name }
        : selector === '[data-query-value]' ? { value } : null;
    }
  });
  const params = doc.elements.get('query-params');
  params.children = [row('  '), row('PARAM_NAME_SENTINEL', 'PARAM_VALUE_SENTINEL'), row('', 'ORPHAN_VALUE_SENTINEL')];
  const { api } = await loadBridge(doc.document);
  const snapshot = api.snapshot();
  assert.equal(snapshot.request.paramsCount, 1);
  assert.doesNotMatch(JSON.stringify(snapshot), /PARAM_NAME_SENTINEL|PARAM_VALUE_SENTINEL|ORPHAN_VALUE_SENTINEL/);
  params.children = [row('')];
  assert.equal(api.snapshot().request.paramsCount, 0, 'the quiet initial row is not a configured parameter');
  params.children = [];
  assert.equal(api.snapshot().request.paramsCount, 0);
});
