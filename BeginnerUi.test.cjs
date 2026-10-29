const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');

const root = __dirname;
const indexPath = path.join(root, 'wwwroot', 'index.html');
const appPath = path.join(root, 'wwwroot', 'app.js');

function indexOf(html, needle, label = needle) {
  const position = html.indexOf(needle);
  assert.ok(position >= 0, `missing ${label}`);
  return position;
}

function detailsBlock(html, id) {
  const openPattern = new RegExp(`<details\\b[^>]*\\bid="${id}"[^>]*>`);
  const open = openPattern.exec(html);
  assert.ok(open, `missing details #${id}`);
  let depth = 0;
  const tagPattern = /<details\b|<\/details>/g;
  tagPattern.lastIndex = open.index;
  let match;
  while ((match = tagPattern.exec(html))) {
    depth += match[0] === '</details>' ? -1 : 1;
    if (depth === 0) return html.slice(open.index, match.index + match[0].length);
  }
  assert.fail(`unbalanced details #${id}`);
}

function sectionBlock(html, className) {
  const openPattern = new RegExp(`<section\\b[^>]*class="[^"]*${className}[^"]*"[^>]*>`);
  const open = openPattern.exec(html);
  assert.ok(open, `missing section .${className}`);
  const close = html.indexOf('</section>', open.index + open[0].length);
  assert.ok(close > 0, `unclosed section .${className}`);
  return html.slice(open.index, close + '</section>'.length);
}

async function readHtml() {
  return fs.readFile(indexPath, 'utf8');
}

test('beginner flow orders base URL, editor, guarded send action and advanced tools', async () => {
  const html = await readHtml();
  assert.ok(
    indexOf(html, 'id="base-url"') < indexOf(html, 'id="method"'),
    'URL base should be filled before method and route'
  );
  assert.ok(
    indexOf(html, 'id="request-editor-tabs"') < indexOf(html, 'id="write-guard"'),
    'editor tabs should precede the guarded send action'
  );
  assert.ok(
    indexOf(html, 'id="write-guard"') < indexOf(html, 'id="request-send-status"') &&
      indexOf(html, 'id="request-send-status"') < indexOf(html, 'id="send-request"'),
    'write guard, status and send button should share one action area'
  );
  assert.ok(
    indexOf(html, 'id="send-request"') < indexOf(html, 'id="structured-card"'),
    'reviewed execution should follow the send action'
  );
  assert.match(
    html,
    /<button class="button primary send-button" id="send-request"[^>]*aria-describedby="request-send-status"/,
    'send button must keep its described status'
  );
});

test('advanced tools disclose cURL, HTTP and references without nesting reviewed execution', async () => {
  const html = await readHtml();
  const advanced = detailsBlock(html, 'advanced-tools');
  for (const selector of ['id="generate-curl"', 'id="allow-insecure-http"', 'id="request-inspector"']) {
    assert.ok(advanced.includes(selector), `advanced tools should contain ${selector}`);
  }
  assert.ok(!advanced.includes('id="structured-card"'), 'reviewed execution keeps its own details');
  assert.match(html, /<details id="structured-card"/);
  assert.match(advanced, /<summary>[\s\S]*Ferramentas avançadas[\s\S]*<\/summary>/);
  assert.match(advanced, /id="advanced-active-indicator"[^>]*hidden/);
  assert.doesNotMatch(advanced, /allow-insecure-http[^>]*disabled/, 'hidden options stay enabled');
});

test('response prioritizes body and keeps headers secondary', async () => {
  const html = await readHtml();
  assert.ok(
    indexOf(html, 'id="response-body"') < indexOf(html, 'id="response-headers"'),
    'response body should precede headers'
  );
  const headersOpen = html.indexOf('id="response-headers"');
  const detailsOpen = html.lastIndexOf('<details', headersOpen);
  assert.ok(detailsOpen > 0 && html.slice(detailsOpen, headersOpen).includes('response-headers-section'), 'headers should live in a details block');
  assert.match(html, /id="copy-headers"/);
  assert.match(html, /id="response-tests-output"[^>]*hidden/);
});

test('collection tools use a textual disclosure while search stays visible', async () => {
  const html = await readHtml();
  const collections = sectionBlock(html, 'collections-section');
  const disclosure = /<details\b[^>]*class="[^"]*collection-tools-more[^"]*"[^>]*>[\s\S]*?<summary>([\s\S]*?)<\/summary>/.exec(collections);
  assert.ok(disclosure, 'collection tools disclosure should exist');
  assert.match(disclosure[1], /Ferramentas/);
  const disclosureStart = disclosure.index;
  for (const id of ['import-collection', 'export-collection', 'run-collection', 'add-collection-heading']) {
    assert.ok(collections.indexOf(`id="${id}"`) > disclosureStart, `#${id} should live inside the tools disclosure`);
  }
  assert.ok(collections.indexOf('id="quick-open-button"') < disclosureStart, 'search stays visible outside the disclosure');
  assert.match(collections, /id="collections-empty-create"/);
});

test('settings group every subject in native details and keep storage internals out of main copy', async () => {
  const html = await readHtml();
  const groups = [...html.matchAll(/<details\b[^>]*class="[^"]*settings-group[^"]*"[^>]*>/g)];
  assert.ok(groups.length >= 5, 'appearance, environments, history, vault and backup groups');
  const settings = /<dialog[^>]*id="settings-dialog"[^>]*>([\s\S]*?)<\/dialog>/.exec(html);
  assert.ok(settings);
  const required = ['theme-select', 'settings-environments', 'history-retention-limit', 'history-save-response-body', 'secret-vault-passphrase', 'export-workspace', 'export-encrypted-workspace', 'restore-workspace', 'protect-existing-secrets'];
  for (const id of required) assert.ok(settings[1].includes(`id="${id}"`), `#${id} should remain in settings`);
  assert.doesNotMatch(settings[1], /dbRead|dbWrite|WebCrypto PBKDF2-SHA-256/, 'consumer copy should not expose storage function names');
});

test('request editor keeps all six tab-to-panel relationships', async () => {
  const html = await readHtml();
  const tabs = [...html.matchAll(/<button\b(?=[^>]*\bdata-editor-tab="([^"]+)")([^>]*)>/g)];
  const panels = [...html.matchAll(/<(?:div|section)\b(?=[^>]*\bdata-editor-panel="([^"]+)")([^>]*)>/g)];
  assert.deepEqual(tabs.map(([, name]) => name), ['params', 'headers', 'body', 'auth', 'scripts', 'tests']);
  assert.equal(panels.length, tabs.length);
  for (const [, name, attributes] of tabs) {
    assert.ok(attributes.includes(`aria-controls="editor-panel-${name}"`), `${name} tab keeps its panel`);
  }
});

test('all element ids remain unique after the reorganization', async () => {
  const html = await readHtml();
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(duplicates, []);
  assert.match(html, /<meta\s+name="vortix-agent-contract"\s+content="2"/);
});

function collectionFlow(app) {
  const addStart = app.indexOf('async function addCollection(){');
  const addEnd = app.indexOf('\nasync function addFolder(', addStart);
  const saveStart = app.indexOf('async function openSaveDialog(){');
  const saveEnd = app.indexOf('\nfunction getSnapshot(', saveStart);
  assert.ok(addStart >= 0 && addEnd > addStart, 'addCollection should be present');
  assert.ok(saveStart >= 0 && saveEnd > saveStart, 'openSaveDialog should be present');
  const source = `${app.slice(addStart, addEnd)}\n${app.slice(saveStart, saveEnd)};({ addCollection, openSaveDialog })`;
  return (options = {}) => {
    const calls = { confirm: 0, prompt: 0, write: 0, render: 0, toasts: [] };
    const dialog = { opened: false, showModal() { this.opened = true; } };
    let writeGate = null;
    const nodes = new Map([
      ['saved-request-name', { value: '', focus() {} }],
      ['saved-request-folder', { replaceChildren() {}, append() {} }],
      ['save-request-dialog', dialog]
    ]);
    const context = {
      collections: options.collections ? [...options.collections] : [],
      selectedContainer: options.selectedContainer || { collectionId: '', folderId: '' },
      activeSaved: null,
      route: { value: options.route || '/orders' },
      byId: id => nodes.get(id) ?? null,
      document: { createElement: () => ({}) },
      newId: () => 'novo-id',
      buildRequestRoute() { if (options.routeError) throw new Error(options.routeError); },
      flattenContainers: () => context.collections.map(item => ({ collectionId: item.id, folderId: '', label: item.name })),
      confirmWithDialog: async () => { calls.confirm += 1; return options.confirm !== false; },
      promptWithDialog: async () => { calls.prompt += 1; return options.name ?? 'Coleção nova'; },
      dbWrite: async () => {
        calls.write += 1;
        if (options.gateWrite) await new Promise((resolve, reject) => { writeGate = { resolve, reject }; });
        if (options.failWrite) throw new Error('storage offline');
      },
      renderCollectionTree: () => { calls.render += 1; if (options.failRender) throw new Error('render failed'); },
      showToast: (...args) => calls.toasts.push(args)
    };
    const api = vm.runInNewContext(source, context);
    return {
      api, context, calls, dialog,
      resolveWrite: value => writeGate?.resolve(value),
      rejectWrite: reason => writeGate?.reject(reason)
    };
  };
}

function assertSelection(actual, expected, message) {
  assert.equal(actual.collectionId, expected.collectionId, message);
  assert.equal(actual.folderId, expected.folderId, message);
}

test('collection creation publishes the selection only after the write succeeds', async () => {
  const app = await fs.readFile(appPath, 'utf8');
  const previouslySelected = { collectionId: 'antiga', folderId: 'pasta' };

  const pending = collectionFlow(app)({ selectedContainer: previouslySelected, name: 'Nova', gateWrite: true });
  const running = pending.api.addCollection();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.calls.write, 1, 'write should be in flight');
  assert.equal(pending.context.collections.length, 1, 'optimistic collection exists during the write');
  assertSelection(pending.context.selectedContainer, previouslySelected, 'selection must stay unchanged while the write is pending');
  pending.resolveWrite();
  await running;
  assertSelection(pending.context.selectedContainer, { collectionId: 'novo-id', folderId: '' }, 'selection is published after the write resolves');

  const failed = collectionFlow(app)({ selectedContainer: previouslySelected, name: 'Nova', failWrite: true });
  await failed.api.addCollection();
  assert.deepEqual([...failed.context.collections], [], 'failed write must remove the optimistic collection');
  assertSelection(failed.context.selectedContainer, previouslySelected, 'failed write must keep the previous selection');
  assert.ok(failed.calls.toasts.some(([title]) => title === 'Falha ao salvar'));

  const saved = collectionFlow(app)({ selectedContainer: previouslySelected, name: 'Nova' });
  await saved.api.addCollection();
  assert.equal(saved.context.collections.length, 1);
  assertSelection(saved.context.selectedContainer, { collectionId: 'novo-id', folderId: '' });
});

test('saving without a collection reuses the real creation flow and stays cancellable', async () => {
  const app = await fs.readFile(appPath, 'utf8');

  const invalidRoute = collectionFlow(app)({ routeError: 'Informe uma rota válida.', confirm: true });
  await invalidRoute.api.openSaveDialog();
  assert.equal(invalidRoute.calls.confirm, 0, 'invalid route must not offer collection creation');
  assert.equal(invalidRoute.calls.prompt, 0);
  assert.equal(invalidRoute.calls.write, 0, 'invalid route must not persist a collection');
  assert.equal(invalidRoute.dialog.opened, false);
  assert.equal(invalidRoute.context.collections.length, 0);
  assert.equal(invalidRoute.context.route.value, '/orders', 'draft stays untouched');
  assert.ok(invalidRoute.calls.toasts.some(([title]) => title === 'Revise a requisição'));

  const invalidExisting = collectionFlow(app)({ collections: [{ id: 'c1', name: 'Minha coleção' }], routeError: 'Informe uma rota válida.' });
  await invalidExisting.api.openSaveDialog();
  assert.equal(invalidExisting.calls.write, 0);
  assert.equal(invalidExisting.dialog.opened, false, 'invalid route never opens the save dialog');

  const declined = collectionFlow(app)({ confirm: false });
  await declined.api.openSaveDialog();
  assert.equal(declined.calls.confirm, 1, 'cancel path must ask before creating');
  assert.equal(declined.calls.prompt, 0);
  assert.equal(declined.calls.write, 0);
  assert.equal(declined.dialog.opened, false);
  assertSelection(declined.context.selectedContainer, { collectionId: '', folderId: '' });
  assert.equal(declined.context.route.value, '/orders', 'draft stays untouched');

  const cancelledName = collectionFlow(app)({ name: '' });
  await cancelledName.api.openSaveDialog();
  assert.equal(cancelledName.calls.prompt, 1);
  assert.equal(cancelledName.calls.write, 0);
  assert.equal(cancelledName.dialog.opened, false);
  assert.equal(cancelledName.context.collections.length, 0);

  const failed = collectionFlow(app)({ name: 'Nova', failWrite: true, selectedContainer: { collectionId: 'antiga', folderId: '' } });
  await failed.api.openSaveDialog();
  assert.equal(failed.calls.write, 1);
  assert.equal(failed.dialog.opened, false, 'storage failure must not open the save dialog');
  assert.equal(failed.context.collections.length, 0);
  assertSelection(failed.context.selectedContainer, { collectionId: 'antiga', folderId: '' });
  assert.equal(failed.context.route.value, '/orders');

  const created = collectionFlow(app)({ name: 'Nova' });
  await created.api.openSaveDialog();
  assert.equal(created.calls.write, 1);
  assert.equal(created.dialog.opened, true, 'save dialog opens only after collection creation');
  assertSelection(created.context.selectedContainer, { collectionId: 'novo-id', folderId: '' });

  const existing = collectionFlow(app)({ collections: [{ id: 'c1', name: 'Minha coleção' }] });
  await existing.api.openSaveDialog();
  assert.equal(existing.calls.confirm, 0, 'existing collections skip the creation prompt');
  assert.equal(existing.calls.prompt, 0);
  assert.equal(existing.dialog.opened, true);
});

test('advanced indicator announces active options and tests without reading values', async () => {
  const app = await fs.readFile(appPath, 'utf8');
  const start = app.indexOf('function updateAdvancedToolsIndicator(');
  const end = app.indexOf('\nfunction escHtml(', start);
  assert.ok(start >= 0 && end > start, 'updateAdvancedToolsIndicator should be present');
  const source = app.slice(start, end);
  assert.doesNotMatch(source, /bearer-token|api-key-value|client-secret|password|oauth2-client-id/i);
  const indicator = { textContent: '', hidden: true };
  const controls = {
    'advanced-active-indicator': indicator,
    'allow-insecure-http': { checked: true },
    'pre-request-actions-enabled': { checked: true },
    'pre-request-actions': { children: [{}, {}] },
    'capture-response-variable': { checked: false },
    'response-tests-list': { children: [{}] },
    'token-helper': { open: true },
    'oauth2-helper': { open: false },
    'oauth-pkce-helper': { open: false }
  };
  const context = { byId: id => controls[id] ?? null, activeResponseContract: { requestBody: {} } };
  const { updateAdvancedToolsIndicator } = vm.runInNewContext(`${source};({ updateAdvancedToolsIndicator })`, context);
  const text = updateAdvancedToolsIndicator();
  assert.match(text, /HTTP sem TLS/);
  assert.match(text, /automação antes do envio/);
  assert.match(text, /testes de resposta/);
  assert.match(text, /contrato OpenAPI/);
  assert.match(text, /autenticação avançada/);
  assert.equal(indicator.hidden, false);
  assert.doesNotMatch(text, /segredo|token=|senha/i);
  for (const control of Object.values(controls)) { if (control.checked !== undefined) control.checked = false; if ('open' in control) control.open = false; }
  controls['pre-request-actions'].children = [];
  controls['response-tests-list'].children = [];
  context.activeResponseContract = null;
  assert.equal(updateAdvancedToolsIndicator(), '');
  assert.equal(indicator.hidden, true);
});

function fakeParamElement(tag = 'div') {
  const element = {
    tagName: tag.toUpperCase(), children: [], dataset: {}, style: {},
    className: '', textContent: '', htmlFor: '', id: '', type: '', value: '',
    placeholder: '', autocomplete: '', spellcheck: false,
    append(...nodes) { for (const node of nodes) { node.parentElement = element; element.children.push(node); } },
    replaceChildren(...nodes) { element.children = []; element.append(...nodes); },
    remove() {
      if (!element.parentElement) return;
      const parent = element.parentElement;
      parent.children = parent.children.filter(child => child !== element);
      element.parentElement = null;
    },
    setAttribute(name, value) { element[name] = value; },
    querySelector(selector) {
      const find = node => {
        if (selector === '[data-query-name]' && Object.prototype.hasOwnProperty.call(node.dataset, 'queryName')) return node;
        if (selector === '[data-query-value]' && Object.prototype.hasOwnProperty.call(node.dataset, 'queryValue')) return node;
        for (const child of node.children || []) { const found = find(child); if (found) return found; }
        return null;
      };
      return find(element);
    },
    focus() { element.focused = true; }
  };
  return element;
}

function allDescendants(element, result = []) {
  for (const child of element.children || []) { result.push(child); allDescendants(child, result); }
  return result;
}

test('parameters keep one quiet initial row, ignore empty rows and never steal focus', async () => {
  const app = await fs.readFile(appPath, 'utf8');
  const start = app.indexOf('function createQueryParamRow(');
  const end = app.indexOf('function oauth2TokenConfigFromForm(', start);
  assert.ok(start >= 0 && end > start, 'parameter helpers should be present');
  const queryParams = fakeParamElement('div');
  const count = fakeParamElement('span');
  const confirm = { checked: true };
  const document = { createElement: tag => fakeParamElement(tag) };
  const byId = id => id === 'params-count' ? count : id === 'confirm-test-data' ? confirm : null;
  const context = {
    queryParams, document, byId, route: { value: '/v1/usuarios' }, encodeURIComponent,
    isSensitiveName: () => false, applyEnvironment: value => value, updateGuard: () => {}
  };
  const api = vm.runInNewContext(`let queryId=0;${app.slice(start, end)};({ createQueryParamRow, renderQueryParams, ensureQueryParamRow, updateParamsCount, buildRequestRoute })`, context);

  api.ensureQueryParamRow();
  assert.equal(queryParams.children.length, 1, 'initial empty row should exist once');
  const initialInputs = allDescendants(queryParams).filter(node => node.tagName === 'INPUT');
  assert.deepEqual(initialInputs.map(input => input.placeholder), ['Ex.: page', 'Ex.: 1']);
  assert.ok(initialInputs.every(input => !input.focused), 'initial row must not take focus');
  assert.equal(count.textContent, '0');

  queryParams.children[0].children[2].onclick();
  assert.equal(queryParams.children.length, 0, 'removing the last row must not recreate it');
  assert.equal(count.textContent, '0');

  const empty = api.createQueryParamRow();
  const filled = api.createQueryParamRow('page', '1');
  queryParams.append(empty, filled);
  api.updateParamsCount();
  assert.equal(count.textContent, '1', 'fully empty rows stay out of the count');
  assert.equal(api.buildRequestRoute(), '/v1/usuarios?page=1', 'fully empty rows stay out of the route');

  const keyless = api.createQueryParamRow('', 'orphan');
  queryParams.append(keyless);
  assert.throws(() => api.buildRequestRoute(), /Informe a chave de cada parâmetro preenchido/, 'a value without a name must keep failing closed');
  keyless.remove();

  queryParams.replaceChildren();
  api.renderQueryParams([]);
  api.ensureQueryParamRow();
  const restored = allDescendants(queryParams).filter(node => node.tagName === 'INPUT');
  assert.equal(queryParams.children.length, 1, 'restore keeps one empty row');
  assert.ok(restored.every(input => !input.focused), 'restore must not steal focus');
});
