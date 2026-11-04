const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');

const root = __dirname;

function functionSource(app, name) {
  const startMatch = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(app);
  assert.ok(startMatch, `missing function ${name}`);
  const start = startMatch.index;
  const rest = app.slice(start + startMatch[0].length);
  const next = /\n(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/.exec(rest);
  return app.slice(start, next ? start + startMatch[0].length + next.index : app.length);
}

function helperSource(app) {
  const start = app.indexOf('function clearRequestCorrection(');
  const end = app.indexOf('function updateGuard(', start);
  assert.ok(start >= 0 && end > start, 'correction helpers should precede updateGuard');
  return app.slice(start, end);
}

function element(id, options = {}) {
  const classes = new Set(options.classes || []);
  const node = {
    id,
    tagName: options.tagName || 'INPUT',
    value: options.value || '',
    checked: options.checked || false,
    disabled: options.disabled || false,
    hidden: options.hidden || false,
    textContent: options.textContent || '',
    dataset: options.dataset || {},
    attributes: {},
    children: [],
    parentElement: null,
    isConnected: options.isConnected !== false,
    tabIndex: 0,
    open: options.open || false,
    className: '',
    classList: {
      toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); },
      contains(name) { return classes.has(name); }
    },
    append(child) { child.parentElement = this; this.children.push(child); },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    contains(other) {
      for (let current = other; current; current = current.parentElement) if (current === this) return true;
      return false;
    },
    matches(selector) {
      if (selector === '.editor-column') return classes.has('editor-column');
      if (selector === '.query-param-row') return classes.has('query-param-row');
      if (selector === '.write-guard') return classes.has('write-guard');
      if (selector === '.response-variable-fields') return classes.has('response-variable-fields');
      if (selector === '[data-editor-panel]') return Boolean(this.dataset.editorPanel);
      if (selector === 'details') return this.tagName === 'DETAILS';
      if (selector === '[hidden]') return this.hidden;
      if (selector === 'dialog[open]') return this.tagName === 'DIALOG' && this.open;
      if (selector === '#structured-card') return this.id === 'structured-card';
      return false;
    },
    closest(selector) {
      for (let current = this; current; current = current.parentElement) if (current.matches(selector)) return current;
      return null;
    },
    focus() { options.onFocus?.(this); }
  };
  return node;
}

function harness(app, options = {}) {
  const calls = { focus: [], tab: [], send: 0, request: 0, preRequest: 0, history: 0, vault: 0, response: [], toasts: [] };
  const workspaceTabState = { editorSection: 'body' };
  const nodes = new Map();
  const make = (id, settings) => { const node = element(id, settings); nodes.set(id, node); return node; };
  const editor = make('editor-column', { tagName: 'SECTION', classes: ['editor-column'] });
  const method = make('method', { value: options.method || 'GET' });
  const route = make('route', { value: options.route ?? '/orders', onFocus: node => calls.focus.push(node.id) });
  const send = make('send-request', { tagName: 'BUTTON' });
  const writeGuard = make('write-guard', { tagName: 'FIELDSET', classes: ['write-guard'] });
  const phrase = make('test-data-phrase', { value: options.phrase || '' });
  const confirm = make('confirm-test-data', { tagName: 'INPUT', checked: options.confirm || false });
  const status = make('request-send-status', { tagName: 'OUTPUT' });
  const correctionGo = make('request-correction-go', { tagName: 'BUTTON', hidden: true });
  make('pre-request-actions-enabled', { tagName: 'INPUT', checked: false });
  const paramsPanel = make('editor-panel-params', { tagName: 'SECTION', dataset: { editorPanel: 'params' }, hidden: true });
  const paramsTab = make('params-tab', { tagName: 'BUTTON', dataset: { editorTab: 'params' } });
  editor.append(route);
  editor.append(writeGuard); writeGuard.append(phrase); writeGuard.append(confirm);
  editor.append(paramsPanel);
  const activeTab = make('active-tab', { tagName: 'BUTTON', dataset: { editorTab: 'body' } });
  const bodyPanel = make('editor-panel-body', { tagName: 'SECTION', dataset: { editorPanel: 'body' } });
  editor.append(bodyPanel);

  const advanced = make('advanced-tools', { tagName: 'DETAILS' });
  const captureDetails = make('response-capture-details', { tagName: 'DETAILS' });
  editor.append(advanced); advanced.append(captureDetails);
  const captureEnabled = make('capture-response-variable', { tagName: 'INPUT', checked: options.capture || false });
  const captureName = make('response-variable-name', { value: options.captureName ?? 'token' });
  const valueSource = make('response-value-source', { value: options.valueSource || 'json' });
  const jsonPath = make('response-json-path', { value: options.jsonPath ?? 'access_token', onFocus: node => calls.focus.push(node.id) });
  const captureTarget = make('response-capture-target', { value: 'environment' });
  advanced.append(captureDetails); captureDetails.append(captureEnabled); captureDetails.append(captureName); captureDetails.append(valueSource); captureDetails.append(jsonPath); captureDetails.append(captureTarget);

  const queryParams = make('query-params', { tagName: 'DIV' });
  paramsPanel.append(queryParams);
  const dialogs = [];
  const document = {
    activeElement: null,
    querySelector(selector) {
      if (selector === '.editor-column') return editor;
      if (selector === 'dialog[open]') return dialogs.find(dialog => dialog.open) || null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-editor-tab]') return [paramsTab, activeTab];
      if (selector === '[data-editor-panel]') return [paramsPanel, bodyPanel];
      return [];
    }
  };
  const modal = make('confirmation-dialog', { tagName: 'DIALOG', open: false }); dialogs.push(modal);
  for (const node of [route, captureName, jsonPath, phrase, confirm]) {
    node.focus = () => { calls.focus.push(node.id); document.activeElement = node; };
  }

  const rowFor = (name, value) => {
    const row = element('query-param-row', { tagName: 'DIV', classes: ['query-param-row'] });
    const key = element('query-name', { value: name, onFocus: node => calls.focus.push(node.id) });
    const queryValue = element('query-value', { value });
    row.append(key); row.append(queryValue);
    row.querySelector = selector => selector === '[data-query-name]' ? key : selector === '[data-query-value]' ? queryValue : null;
    return { row, key, queryValue };
  };
  const source = [
    helperSource(app),
    functionSource(app, 'buildRequestRoute'),
    functionSource(app, 'encodeParam'),
    functionSource(app, 'validateResponseCaptureForm'),
    functionSource(app, 'setEditorTab'),
    functionSource(app, 'updateGuard'),
    functionSource(app, 'sendCurrentRequest'),
    `;({ clearRequestCorrection, clearRequestCorrectionForEdit, focusRequestCorrection, setRequestCorrection, withRequestCorrectionTarget, buildRequestRoute, validateResponseCaptureForm, updateGuard, sendCurrentRequest, setEditorTab, requestCorrectionTargets, getCorrection: () => requestCorrection })`
  ].join('\n');
  const context = {
    document,
    byId: id => nodes.get(id) ?? null,
    method, route, sendButton: send, writeGuard, queryParams,
    activeWorkspaceTabId: 'tab-1', activeEnvironmentId: 'env-1',
    refreshRequestInspector() {}, updateAdvancedToolsIndicator() {}, syncActiveWorkspaceTab() { calls.tab.push('sync'); },
    activeWorkspaceTab: () => workspaceTabState,
    renderBodyHighlight() {}, updateInsomniaScriptPreview() {},
    writeConfirmationValid: () => confirm.checked && phrase.value.trim() === 'TESTE',
    RunnerLogic: {
      isValidCaptureVariableName: name => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name),
      parseJsonPath(path) { if (!path || path.includes('..')) throw Error('Caminho JSON inválido.'); return path.split('.'); },
      runPreRequestActions() { calls.preRequest++; return { variables: {}, provenance: {}, vaultSecrets: {} }; }
    },
    parseJsonPath: path => { if (!path || path.includes('..')) throw Error('Caminho JSON inválido.'); return path.split('.'); },
    assertVaultCaptureAvailable() { calls.vault++; },
    showResponse: (...args) => calls.response.push(args),
    showToast: (...args) => calls.toasts.push(args),
    clearCurrentResponseExample() {},
    getPreRequestActionsFromForm: () => [],
    getEnvironment: () => ({ variables: {} }),
    vaultResolutionInput() { calls.vault++; return {}; },
    applyEnvironment: value => value,
    requestFromForm() { calls.request++; return { bodyMode: 'raw', baseUrl: 'https://example.test' }; },
    multipartFieldsForSend: async () => [],
    remoteHttpOrigin: () => '',
    redactVaultValues: value => value,
    sanitizeBase: value => ({ value }), sanitizeRoute: value => ({ value }),
    performApiRequest() { calls.send++; return Promise.resolve({ status: 200, body: '{}' }); },
    confirmWithDialog: async () => false,
    updateResponseExamplesUi() {},
    clearWriteConfirmation() {},
    writeMethods: new Set(['POST', 'PUT', 'PATCH', 'DELETE']),
    requestSendInProgress: false,
    requestCorrection: null,
    requestCorrectionTargets: new WeakMap(),
    lastResolutionProvenance: {}
  };
  const api = vm.runInNewContext(source, context, { filename: 'guided-request-correction.js' });
  function addParam(keyValue, queryValue) {
    const result = rowFor(keyValue, queryValue);
    queryParams.append(result.row);
    return result;
  }
  return { api, calls, nodes, method, route, send, writeGuard, phrase, confirm, status, correctionGo, paramsPanel, paramsTab, bodyPanel, advanced, captureDetails, captureEnabled, captureName, valueSource, jsonPath, queryParams, modal, addParam, context, editor, workspaceTabState };
}

test('send strip exposes an accessible button without changing existing send contracts', async () => {
  const html = await fs.readFile(path.join(root, 'wwwroot', 'index.html'), 'utf8');
  assert.ok(/<button\b[^>]*id="request-correction-go"[^>]*type="button"[^>]*aria-describedby="request-send-status"[^>]*>\s*Ir ao campo\s*<\/button>/.test(html), 'correction button should be an associated button named Ir ao campo');
  assert.match(html, /id="send-request"[^>]*aria-describedby="request-send-status"/);
});

test('empty route keeps send disabled and focuses route without sending', async () => {
  const app = await fs.readFile(path.join(root, 'wwwroot', 'app.js'), 'utf8');
  const ui = harness(app, { route: '' });
  ui.api.updateGuard();
  assert.equal(ui.send.disabled, true);
  assert.equal(ui.status.textContent, 'Informe uma rota para enviar a requisição.');
  assert.equal(ui.correctionGo.hidden, false);
  ui.api.focusRequestCorrection();
  assert.deepEqual(ui.calls.focus, ['route']);
  assert.equal(ui.calls.send, 0);
  assert.equal(ui.paramsPanel.hidden, true);
});

test('focus reveals Params and nested disclosures before focusing the explicit target', async () => {
  const app = await fs.readFile(path.join(root, 'wwwroot', 'app.js'), 'utf8');
  const ui = harness(app);
  const { key } = ui.addParam('', 'orphan');
  const params = ui.nodes.get('editor-panel-params');
  const details = element('params-details', { tagName: 'DETAILS' });
  params.append(details); details.append(key.parentElement);
  key.focus = () => {
    assert.equal(params.hidden, false);
    assert.equal(details.open, true);
    ui.calls.focus.push('query-name');
  };
  ui.api.setRequestCorrection('Informe a chave de cada parâmetro preenchido.', key);
  ui.api.updateGuard();
  ui.api.focusRequestCorrection();
  assert.deepEqual(ui.calls.tab, []);
  assert.equal(ui.workspaceTabState.editorSection, 'params');
  assert.equal(params.hidden, false);
  assert.equal(details.open, true);
  assert.deepEqual(ui.calls.focus, ['query-name']);
  assert.equal(ui.calls.send, 0);
  assert.equal(ui.calls.preRequest, 0);
  assert.equal(ui.calls.history, 0);
  assert.equal(ui.calls.vault, 0);
});

test('route validation associates the original error with route and retries no preparation', async () => {
  const app = await fs.readFile(path.join(root, 'wwwroot', 'app.js'), 'utf8');
  const ui = harness(app, { route: 'orders' });
  await ui.api.sendCurrentRequest();
  assert.equal(ui.status.textContent, 'Informe um caminho iniciado por /. Use Params para a query.');
  assert.equal(ui.correctionGo.hidden, false);
  ui.api.focusRequestCorrection();
  assert.deepEqual(ui.calls.focus, ['route']);
  assert.equal(ui.calls.preRequest, 0);
  assert.equal(ui.calls.request, 0);
  assert.equal(ui.calls.send, 0);
});

test('parameter key error points to its key and keeps the entered value', async () => {
  const app = await fs.readFile(path.join(root, 'wwwroot', 'app.js'), 'utf8');
  const ui = harness(app, { route: '/orders' });
  const { key, queryValue } = ui.addParam('', 'orphan-value');
  await ui.api.sendCurrentRequest();
  assert.equal(ui.status.textContent, 'Informe a chave de cada parâmetro preenchido.');
  assert.equal(queryValue.value, 'orphan-value');
  ui.api.focusRequestCorrection();
  assert.deepEqual(ui.calls.focus, ['query-name']);
  assert.equal(ui.paramsPanel.hidden, false);
});

test('capture name and JSON path target only the invalid control', async () => {
  const app = await fs.readFile(path.join(root, 'wwwroot', 'app.js'), 'utf8');
  const nameUi = harness(app, { capture: true, captureName: 'bad name', route: '/orders' });
  await nameUi.api.sendCurrentRequest();
  assert.equal(nameUi.status.textContent, 'Informe um nome de variável válido (até 80 caracteres).');
  nameUi.api.focusRequestCorrection();
  assert.deepEqual(nameUi.calls.focus, ['response-variable-name']);
  assert.equal(nameUi.advanced.open, true);
  assert.equal(nameUi.captureDetails.open, true);

  const pathUi = harness(app, { capture: true, jsonPath: 'data..token', route: '/orders' });
  await pathUi.api.sendCurrentRequest();
  assert.equal(pathUi.status.textContent, 'Caminho JSON inválido.');
  pathUi.api.focusRequestCorrection();
  assert.deepEqual(pathUi.calls.focus, ['response-json-path']);
  assert.equal(pathUi.captureName.value, 'token');
});

test('disabled response capture does not create a correction target', async () => {
  const app = await fs.readFile(path.join(root, 'wwwroot', 'app.js'), 'utf8');
  const ui = harness(app, { capture: false, captureName: 'bad name' });
  assert.doesNotThrow(() => ui.api.validateResponseCaptureForm());
  assert.equal(ui.api.getCorrection(), null);
  assert.equal(ui.correctionGo.hidden, true);
});

test('restoring a populated draft clears the previous empty-route guidance', async () => {
  const app = await fs.readFile(path.join(root, 'wwwroot', 'app.js'), 'utf8');
  const ui = harness(app, { route: '' });
  ui.api.updateGuard();
  assert.equal(ui.send.disabled, true);
  ui.route.value = '/items';
  ui.api.updateGuard();
  assert.equal(ui.send.disabled, false);
  assert.equal(ui.correctionGo.hidden, true);
  assert.equal(ui.api.getCorrection(), null);
  assert.equal(ui.status.textContent, 'Revise ambiente e dados antes de enviar.');
});

test('manual write methods are ready without a test-data declaration', async () => {
  const app = await fs.readFile(path.join(root, 'wwwroot', 'app.js'), 'utf8');
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const ui = harness(app, { method });
    ui.api.updateGuard();
    assert.equal(ui.send.disabled, false);
    assert.equal(ui.correctionGo.hidden, true);
    assert.equal(ui.api.getCorrection(), null);
    assert.equal(ui.calls.send, 0);
  }
});

test('correction wrapper runs once, rethrows the same error and keeps metadata out of Error', async () => {
  const app = await fs.readFile(path.join(root, 'wwwroot', 'app.js'), 'utf8');
  const ui = harness(app);
  const target = ui.route;
  const original = Error('fixed validation message');
  let calls = 0;
  assert.throws(() => ui.api.withRequestCorrectionTarget(target, () => { calls++; throw original; }), error => error === original);
  assert.equal(calls, 1);
  assert.deepEqual(Object.keys(original), []);
  assert.equal(ui.api.requestCorrectionTargets.get(original), target);
});

test('removed or stale targets and open dialogs never receive focus', async () => {
  const app = await fs.readFile(path.join(root, 'wwwroot', 'app.js'), 'utf8');
  const removed = harness(app);
  removed.api.setRequestCorrection('Revise a rota.', removed.route);
  removed.route.isConnected = false;
  removed.api.focusRequestCorrection();
  assert.deepEqual(removed.calls.focus, []);
  assert.equal(removed.correctionGo.hidden, true);

  const removedRow = harness(app);
  const { key } = removedRow.addParam('', 'orphan');
  removedRow.api.setRequestCorrection('Revise Params.', key);
  key.isConnected = false;
  removedRow.api.focusRequestCorrection();
  assert.deepEqual(removedRow.calls.focus, []);
  assert.equal(removedRow.correctionGo.hidden, true);

  const stale = harness(app);
  stale.api.setRequestCorrection('Revise a rota.', stale.route);
  stale.context.activeEnvironmentId = 'env-2';
  stale.api.focusRequestCorrection();
  assert.deepEqual(stale.calls.focus, []);
  assert.equal(stale.correctionGo.hidden, true);

  const staleRequest = harness(app);
  staleRequest.api.setRequestCorrection('Revise a rota.', staleRequest.route);
  staleRequest.context.activeWorkspaceTabId = 'tab-2';
  staleRequest.api.focusRequestCorrection();
  assert.deepEqual(staleRequest.calls.focus, []);
  assert.equal(staleRequest.correctionGo.hidden, true);

  const modal = harness(app);
  modal.api.setRequestCorrection('Revise a rota.', modal.route);
  modal.modal.open = true;
  modal.api.focusRequestCorrection();
  assert.deepEqual(modal.calls.focus, []);
  assert.equal(modal.correctionGo.hidden, true);
});

test('target edit, request/environment changes and retry discard old context', async () => {
  const app = await fs.readFile(path.join(root, 'wwwroot', 'app.js'), 'utf8');
  const ui = harness(app);
  ui.api.setRequestCorrection('Revise a rota.', ui.route);
  ui.api.clearRequestCorrectionForEdit(ui.route);
  assert.equal(ui.api.getCorrection(), null);

  for (const name of ['activateWorkspaceTab', 'loadCollectionRequest', 'applyHistoryEntry', 'applyWorkspaceDraft', 'resetEditorForNewWorkspaceTab', 'chooseEnvironment']) {
    assert.match(functionSource(app, name), /clearRequestCorrection\(\)/, `${name} should invalidate request correction context`);
  }

  const retry = harness(app);
  retry.api.setRequestCorrection('old error', retry.route);
  retry.context.validateResponseCaptureForm = () => { throw Error('unknown preparation failure'); };
  await retry.api.sendCurrentRequest();
  assert.equal(retry.api.getCorrection(), null);
  assert.equal(retry.correctionGo.hidden, true);
  assert.ok(retry.calls.toasts.some(([title]) => title === 'Revise a requisição'));
});

test('manual status precedence and busy state stay intact; unknown errors get no target', async () => {
  const app = await fs.readFile(path.join(root, 'wwwroot', 'app.js'), 'utf8');
  const empty = harness(app, { route: '' });
  empty.api.updateGuard();
  assert.equal(empty.status.textContent, 'Informe uma rota para enviar a requisição.');
  empty.context.requestSendInProgress = true;
  empty.api.updateGuard();
  assert.equal(empty.status.textContent, 'Envio em andamento. Aguarde a resposta.');
  assert.equal(empty.correctionGo.hidden, true);

  const unknown = harness(app);
  unknown.context.validateResponseCaptureForm = () => { throw Error('Falha local sem destino.'); };
  await unknown.api.sendCurrentRequest();
  assert.equal(unknown.api.getCorrection(), null);
  assert.equal(unknown.correctionGo.hidden, true);
  assert.equal(unknown.status.textContent, 'Revise ambiente e dados antes de enviar.');
});
