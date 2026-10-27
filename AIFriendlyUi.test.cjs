const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = __dirname;

test('theme selector, application registry and complete desktop palettes stay aligned', async () => {
  const [app, html, css] = await Promise.all(['app.js', 'index.html', 'style.css']
    .map(file => fs.readFile(path.join(root, 'wwwroot', file), 'utf8')));
  const declaration = app.match(/const themes = new Set\([^\n]+/)[0];
  const names = [...vm.runInNewContext(`${declaration}; themes`)];
  const selector = html.match(/<select id="theme-select"[^>]*>([\s\S]*?)<\/select>/)[1];
  const options = [...selector.matchAll(/<option value="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(options, names);
  for (const name of ['paper', 'graphite', 'tide']) {
    assert.ok(names.includes(name));
    const palette = css.match(new RegExp(`:root\\[data-theme="${name}"\\]\\s*\\{([^}]+)`))?.[1];
    assert.ok(palette, `${name} CSS palette should exist`);
    for (const token of ['bg', 'sidebar', 'surface', 'panel', 'raised', 'hover', 'border', 'text', 'muted', 'accent', 'accent-strong', 'input', 'code', 'json-key', 'json-string', 'json-number', 'json-literal', 'danger', 'warning', 'success', 'on-accent']) {
      assert.match(palette, new RegExp(`--${token}:\\s*#[0-9a-f]{6}\\b`), `${name}: ${token}`);
    }
    assert.match(palette, new RegExp(`color-scheme: ${name === 'paper' ? 'light' : 'dark'}`));
  }
});

test('new themes persist and restore through existing settings; unknown IDs cannot overwrite them', async () => {
  const app = await fs.readFile(path.join(root, 'wwwroot', 'app.js'), 'utf8');
  const declaration = app.match(/const themes = new Set\([^\n]+/)[0];
  const handlers = app.slice(app.indexOf('function applyTheme('), app.indexOf('\nfunction ', app.indexOf('async function saveTheme(')));
  const initialize = app.slice(app.indexOf('async function initializeDb('), app.indexOf('\nfunction dismissToast('));
  const saved = new Map(), select = { value: '' }, document = { documentElement: { dataset: {} } };
  const context = {
    document, byId: () => select,
    dbWrite: async (store, record) => { assert.equal(store, 'settings'); saved.set(record.key, record); },
    dbRead: async (store, key) => store === 'settings' ? saved.get(key) : store === 'collections' ? [{ id: 'qa-collection' }] : [{ id: 'qa-environment', group: 'QA' }],
    migrateLegacyDb: async () => {}, showToast() {}, syncHistorySettingsControls() {},
    RunnerLogic: { normalizeHistorySettings: value => value || {} }, fontFamilies: new Map(),
    DEFAULT_FONT: 'fira-code', DEFAULT_UI_SCALE: 1.2, MIN_UI_SCALE: 0.8, MAX_UI_SCALE: 1.5
  };
  const api = vm.runInNewContext(`${declaration}; let activeTheme='dracula', collections=[], environments=[], selectedContainer={}, activeEnvironmentId='', activeFont='', activeScale=1.2, historySettings={}; ${handlers}\n${initialize}\n({saveTheme, restore:async()=>{await initializeDb();applyTheme(activeTheme);}})`, context);
  for (const name of ['paper', 'graphite', 'tide']) {
    await api.saveTheme(name);
    assert.equal(saved.get('activeTheme').value, name);
    assert.equal(document.documentElement.dataset.theme, name);
    document.documentElement.dataset.theme = 'dracula';
    select.value = 'dracula';
    await api.restore();
    assert.equal(document.documentElement.dataset.theme, name);
    assert.equal(select.value, name);
  }
  await api.saveTheme('unknown-theme');
  assert.equal(saved.get('activeTheme').value, 'tide');
  saved.set('activeTheme', { key: 'activeTheme', value: 'unknown-theme' });
  await api.restore();
  assert.equal(document.documentElement.dataset.theme, 'dracula');
});

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return match?.[1] ?? null;
}

test('agent-facing controls have a versioned, named DOM contract', async () => {
  const html = await fs.readFile(path.join(root, 'wwwroot', 'index.html'), 'utf8');
  assert.match(html, /<meta\s+name="vortix-agent-contract"\s+content="2"/);

  const controls = new Map([...html.matchAll(/<(?:button|select)\b[^>]*\bid="([^"]+)"[^>]*>/g)]
    .map(match => [match[1], match[0]]));
  const expected = new Map([
    ['new-request', 'request.new'],
    ['send-request', 'request.send'],
    ['save-collection-request', 'request.save'],
    ['add-collection', 'collection.new'],
    ['environment-select', 'environment.select'],
    ['manage-environments-direct', 'environment.manage'],
    ['quick-open-button', 'collection.search'],
    ['import-collection', 'collection.import'],
    ['export-collection', 'collection.export'],
    ['run-collection', 'runner.open'],
    ['manage-environments', 'settings.open'],
    ['workspace-fullscreen-toggle', 'workspace.fullscreen.toggle'],
    ['refresh-agent-safe-state', 'agent.snapshot.refresh'],
    ['ai-friendly-trigger', 'agent.help.open'],
    ['copy-ai-safe-context', 'agent.context.copy'],
    ['copy-maestri-agent-prompt', 'agent.prompt.copy']
  ]);

  for (const [id, action] of expected) {
    assert.ok(controls.has(id), `expected control #${id}`);
    assert.equal(attribute(controls.get(id), 'data-vortix-action'), action, `#${id} action name`);
  }

  const fields = new Map([...html.matchAll(/<(?:input|select|textarea|div|span|pre)\b[^>]*\bid="([^"]+)"[^>]*>/g)]
    .map(match => [match[1], match[0]]));
  for (const [id, field] of [
    ['method', 'request.method'], ['route', 'request.route'], ['base-url', 'request.base-url'],
    ['query-params', 'request-params'], ['headers', 'request.headers'], ['body-mode', 'request.body-mode'],
    ['body', 'request.body'], ['auth-type', 'request.auth-type'], ['response-status', 'response.status'],
    ['response-headers', 'response.headers'], ['response-body', 'response.body'],
    ['agent-safe-state-output', 'agent.safe-state'],
    ['ai-friendly-status', 'agent.capability-status']
  ]) {
    assert.ok(fields.has(id), `expected field or region #${id}`);
    assert.equal(attribute(fields.get(id), 'data-vortix-field') ?? attribute(fields.get(id), 'data-vortix-region'), field, `#${id} contract name`);
  }
});

test('request editor tabs have complete tab-to-panel relationships', async () => {
  const html = await fs.readFile(path.join(root, 'wwwroot', 'index.html'), 'utf8');
  const tabs = [...html.matchAll(/<button\b(?=[^>]*\bdata-editor-tab="([^"]+)")([^>]*)>/g)];
  const panels = [...html.matchAll(/<(?:div|section)\b(?=[^>]*\bdata-editor-panel="([^"]+)")([^>]*)>/g)];
  assert.ok(tabs.length >= 5, 'expected request editor tabs');
  assert.equal(panels.length, tabs.length, 'every editor tab has a panel');

  for (const [, name, tab] of tabs) {
    const tabId = `editor-tab-${name}`;
    const panelId = `editor-panel-${name}`;
    assert.equal(attribute(tab, 'id'), tabId);
    assert.equal(attribute(tab, 'role'), 'tab');
    assert.equal(attribute(tab, 'aria-controls'), panelId);
    const panel = panels.find(([, panelName]) => panelName === name)?.[2];
    assert.ok(panel, `expected panel for ${name}`);
    assert.equal(attribute(panel, 'id'), panelId);
    assert.equal(attribute(panel, 'role'), 'tabpanel');
    assert.equal(attribute(panel, 'aria-labelledby'), tabId);
  }
});

test('workspace tabs label the active request panel and retain keyboard navigation', async () => {
  const html = await fs.readFile(path.join(root, 'wwwroot', 'index.html'), 'utf8');
  const app = await fs.readFile(path.join(root, 'wwwroot', 'app.js'), 'utf8');
  assert.match(html, /id="request-workspace-panel"[^>]*role="tabpanel"[^>]*aria-labelledby="workspace-tab-0"/);
  assert.ok(app.includes("select.id='workspace-tab-'+index"));
  assert.ok(app.includes("panel.setAttribute('aria-labelledby',active.id)"));
});

test('request editor keyboard navigation moves focus and synchronizes tab panels', async () => {
  const app = await fs.readFile(path.join(root, 'wwwroot', 'app.js'), 'utf8');
  const start = app.indexOf('function setEditorTab(');
  const end = app.indexOf('\nfunction responseTestField(', start);
  assert.ok(start >= 0 && end > start, 'request tab handlers should be present');

  let focused = null;
  const names = ['params', 'headers', 'body', 'auth', 'scripts', 'tests'];
  const tabs = names.map(name => {
    const attributes = { 'aria-selected': String(name === 'params') };
    return {
      dataset: { editorTab: name },
      tabIndex: name === 'params' ? 0 : -1,
      classList: { toggle() {} },
      setAttribute(key, value) { attributes[key] = value; },
      getAttribute(key) { return attributes[key] ?? null; },
      closest(selector) { return selector === '[data-editor-tab]' ? this : null; },
      focus() { focused = this; }
    };
  });
  const panels = names.map(name => ({ dataset: { editorPanel: name }, hidden: name !== 'params' }));
  const document = {
    querySelectorAll(selector) {
      if (selector === '[data-editor-tab]') return tabs;
      if (selector === '[data-editor-panel]') return panels;
      return [];
    }
  };
  const context = {
    document,
    renderBodyHighlight() {},
    updateInsomniaScriptPreview() {},
    syncActiveWorkspaceTab() {}
  };
  const handlers = vm.runInNewContext(`${app.slice(start, end)};({ setEditorTab, handleEditorTabKeydown })`, context);
  const press = (from, key) => {
    let prevented = false;
    handlers.handleEditorTabKeydown({
      key,
      currentTarget: { querySelectorAll: () => tabs },
      target: tabs[names.indexOf(from)],
      preventDefault() { prevented = true; }
    });
    assert.ok(prevented, `${key} should be handled`);
  };

  press('params', 'ArrowRight');
  assert.equal(focused, tabs[1]);
  assert.equal(tabs[1].getAttribute('aria-selected'), 'true');
  assert.equal(tabs[1].tabIndex, 0);
  assert.equal(panels[1].hidden, false);
  assert.equal(panels[0].hidden, true);

  press('headers', 'Home');
  assert.equal(focused, tabs[0]);
  assert.equal(panels[0].hidden, false);
  press('params', 'End');
  assert.equal(focused, tabs[5]);
  assert.equal(panels[5].hidden, false);
  press('tests', 'ArrowLeft');
  assert.equal(focused, tabs[4]);
  assert.equal(tabs[4].getAttribute('aria-selected'), 'true');
  assert.equal(panels[4].hidden, false);
});

test('Maestri Portal guide describes safe UI-only operation and available controls', async () => {
  const guide = await fs.readFile(path.join(root, 'docs', 'maestri-portal.md'), 'utf8');
  const readme = await fs.readFile(path.join(root, 'README.md'), 'utf8');
  assert.match(guide, /Portal/i);
  assert.match(guide, /data-vortix-action/);
  assert.match(guide, /data-vortix-field/);
  assert.match(guide, /window\.vortixAgent\.describe\(\)/);
  assert.match(guide, /describe\(\{ region: 'request-editor', includeState: true \}\)/);
  assert.match(guide, /região desconhecida[\s\S]{0,80}listas vazias/i);
  assert.match(guide, /Estados dos controles não comprovam consentimento/i);
  assert.match(guide, /window\.vortixAgent\.snapshot\(\)/);
  assert.match(guide, /agent-safe-state/);
  assert.match(guide, /Bridge v2 ativo/);
  assert.match(guide, /agent\.help\.open/);
  assert.match(guide, /GET|HEAD|OPTIONS/);
  assert.match(guide, /POST[\s\S]*PUT[\s\S]*PATCH[\s\S]*DELETE/);
  assert.match(guide, /consentimento explícito/i);
  assert.match(guide, /não (?:leia|acesse|consulte)[\s\S]{0,80}(?:token|senha|segredo|cofre|IndexedDB)/i);
  assert.match(guide, /Antes de enviar qualquer request, desmarque[\s\S]{0,140}Salvar credenciais de Auth[\s\S]{0,100}(?:histórico|histórico é gravado)/i);
  assert.match(guide, /Nunca.*(?:endpoint|fetch|guard)/i);
  assert.match(guide, /Copiar contexto seguro/);
  assert.match(guide, /bloquear a cópia[\s\S]{0,120}somente leitura/i);
  assert.match(readme, /## Automação por IA com Maestri Portal/);
  assert.match(readme, /selo \*\*Bridge v2 ativo\*\*/);
  assert.match(readme, /\[guia para agentes no Maestri Portal\]\(docs\/maestri-portal\.md\)/i);
  assert.match(readme, /\.agents\/skills\/vortix-maestri-operator\/SKILL\.md/);
});

function safeContextCopyHandler(app, dependencies) {
  const resolveStart = app.indexOf('function resolveAiFriendlyStatus(');
  const resolveEnd = app.indexOf('\nfunction updateAiFriendlyStatus(', resolveStart);
  const copyStart = app.indexOf('async function copyAiSafeContext(');
  const copyEnd = app.indexOf('\nasync function copyMaestriAgentPrompt(', copyStart);
  assert.ok(resolveStart >= 0 && resolveEnd > resolveStart, 'AI readiness resolver should exist');
  assert.ok(copyStart >= 0 && copyEnd > copyStart, 'safe context copy handler should exist');
  return vm.runInNewContext(`${app.slice(resolveStart, resolveEnd)}\n${app.slice(copyStart, copyEnd)}; copyAiSafeContext`, dependencies);
}

function fullscreenControlHandlers(app, dependencies) {
  const start = app.indexOf('function syncFullscreenControl(');
  const end = app.indexOf('\nfunction openAiFriendlyHelp(', start);
  assert.ok(start >= 0 && end > start, 'fullscreen control handlers should exist');
  return vm.runInNewContext(`${app.slice(start, end)}; ({ setupFullscreenControl, toggleWorkspaceFullscreen })`, dependencies);
}

test('fullscreen button starts windowed, follows Fullscreen API events, and leaves Escape native', async () => {
  const app = await fs.readFile(path.join(root, 'wwwroot', 'app.js'), 'utf8');
  const html = await fs.readFile(path.join(root, 'wwwroot', 'index.html'), 'utf8');
  const buttonTag = html.match(/<button\b[^>]*id="workspace-fullscreen-toggle"[^>]*>/)?.[0];
  assert.ok(buttonTag, 'fullscreen toggle should exist');
  assert.match(buttonTag, /aria-pressed="false"/);
  assert.match(buttonTag, /disabled/);
  assert.doesNotMatch(app.slice(app.indexOf('function setupFullscreenControl('), app.indexOf('\nfunction openAiFriendlyHelp(')), /keyboardLock|addEventListener\('keydown'/);

  const button = { disabled: true, title: '', attributes: {}, setAttribute(name, value) { this.attributes[name] = value; }, getAttribute(name) { return this.attributes[name] ?? null; } };
  const listeners = {};
  let requests = 0;
  let exits = 0;
  const document = {
    fullscreenEnabled: true,
    fullscreenElement: null,
    exitFullscreen: async () => { exits += 1; document.fullscreenElement = null; listeners.fullscreenchange?.(); },
    addEventListener(name, handler) { listeners[name] = handler; }
  };
  document.documentElement = {
    async requestFullscreen(...args) { requests += 1; assert.equal(args.length, 0); document.fullscreenElement = this; listeners.fullscreenchange?.(); }
  };
  const handlers = fullscreenControlHandlers(app, {
    document,
    byId: id => id === 'workspace-fullscreen-toggle' ? button : null,
    showToast() { throw Error('successful transitions should not show an error'); }
  });

  handlers.setupFullscreenControl();
  assert.equal(requests, 0, 'initialization must not enter fullscreen automatically');
  assert.equal(typeof button.onclick, 'function');
  assert.equal(button.disabled, false);
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  assert.match(button.title, /Entrar em tela cheia/);
  assert.deepEqual(Object.keys(listeners), ['fullscreenchange']);

  await button.onclick();
  assert.equal(requests, 1);
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.match(button.title, /Sair da tela cheia/);
  await button.onclick();
  assert.equal(exits, 1);
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  assert.match(button.title, /Entrar em tela cheia/);

  await button.onclick();
  document.fullscreenElement = null;
  listeners.fullscreenchange();
  assert.equal(button.getAttribute('aria-pressed'), 'false', 'native exit event should clear pressed state');
});

test('fullscreen support and rejected requests provide feedback without keyboard interception', async () => {
  const app = await fs.readFile(path.join(root, 'wwwroot', 'app.js'), 'utf8');
  const button = { disabled: false, title: '', attributes: {}, setAttribute(name, value) { this.attributes[name] = value; }, getAttribute(name) { return this.attributes[name] ?? null; } };
  const unsupportedDocument = { fullscreenEnabled: false, fullscreenElement: null, documentElement: {}, exitFullscreen() {}, addEventListener() {} };
  const unsupported = fullscreenControlHandlers(app, {
    document: unsupportedDocument,
    byId: id => id === 'workspace-fullscreen-toggle' ? button : null,
    showToast() { throw Error('unsupported mode uses disabled control feedback'); }
  });
  unsupported.setupFullscreenControl();
  assert.equal(button.disabled, true);
  assert.equal(button.getAttribute('aria-label'), 'Tela cheia indisponível');
  assert.match(button.title, /indisponível/i);

  const messages = [];
  const rejectedButton = { ...button, attributes: {} };
  const rejectedDocument = {
    fullscreenEnabled: true,
    fullscreenElement: null,
    documentElement: { requestFullscreen: async () => { throw Error('denied'); } },
    exitFullscreen() {}, addEventListener() {}
  };
  const rejected = fullscreenControlHandlers(app, {
    document: rejectedDocument,
    byId: id => id === 'workspace-fullscreen-toggle' ? rejectedButton : null,
    showToast: (...args) => messages.push(args)
  });
  rejected.setupFullscreenControl();
  await rejectedButton.onclick();
  assert.equal(rejectedButton.getAttribute('aria-pressed'), 'false');
  assert.match(messages[0][0], /tela cheia/i);
  assert.match(messages[0][1], /permissões/i);
});

test('safe context copy uses the v2 snapshot, keeps sentinels out, and sends no requests', async () => {
  const app = await fs.readFile(path.join(root, 'wwwroot', 'app.js'), 'utf8');
  const fallback = { value: 'STALE_CONTEXT_SENTINEL', hidden: false, readOnly: true, focused: false, selected: false, focus() { this.focused = true; }, select() { this.selected = true; } };
  const status = { textContent: 'stale status', hidden: false };
  const snapshot = { contractVersion: 2, request: { method: 'PATCH', routePresent: true, authConfigured: true }, response: { statusCode: null } };
  const snapshotSecrets = ['ROUTE_SECRET_SENTINEL', 'AUTH_SECRET_SENTINEL', 'BODY_SECRET_SENTINEL'];
  let copied = '';
  let sends = 0;
  const messages = [];
  const reads = [];
  const fields = new Map([
    ['ai-safe-context-fallback', fallback], ['ai-safe-context-status', status],
    ['route', { value: snapshotSecrets[0] }], ['auth', { value: snapshotSecrets[1] }], ['body', { value: snapshotSecrets[2] }]
  ]);
  const copy = safeContextCopyHandler(app, {
    byId(id) { reads.push(id); return fields.get(id) ?? null; },
    window: { vortixAgent: { contractVersion: 2, describe() {}, snapshot: () => snapshot } },
    navigator: { clipboard: { async writeText(value) { copied = value; } } },
    showToast: (...args) => messages.push(args),
    fetch() { sends += 1; },
    sendCurrentRequest() { sends += 1; }
  });

  await copy();
  assert.equal(copied, JSON.stringify(snapshot, null, 2));
  assert.equal(fallback.value, '');
  assert.equal(fallback.hidden, true);
  assert.deepEqual(reads, ['ai-safe-context-fallback', 'ai-safe-context-status']);
  assert.equal(snapshotSecrets.some(secret => copied.includes(secret) || JSON.stringify(messages).includes(secret)), false);
  assert.equal(sends, 0);
});

test('clipboard denial selects readonly snapshot fallback; missing or old bridge clears stale state', async () => {
  const app = await fs.readFile(path.join(root, 'wwwroot', 'app.js'), 'utf8');
  const html = await fs.readFile(path.join(root, 'wwwroot', 'index.html'), 'utf8');
  const helpStart = html.indexOf('<dialog class="app-dialog ai-help-dialog"');
  const helpEnd = html.indexOf('</dialog>', helpStart);
  const helpHtml = html.slice(helpStart, helpEnd);
  const statusTag = helpHtml.match(/<output\b[^>]*\bid="ai-safe-context-status"[^>]*>/)?.[0];
  assert.ok(statusTag, 'copy feedback should use the implicit status role of output');
  assert.match(statusTag, /aria-live="polite"/);
  assert.match(statusTag, /hidden/);
  const fallbackTag = helpHtml.match(/<textarea\b[^>]*\bid="ai-safe-context-fallback"[^>]*>/)?.[0];
  assert.ok(fallbackTag, 'AI help should contain the manual-copy field');
  assert.match(fallbackTag, /readonly/);
  assert.match(fallbackTag, /hidden/);
  const snapshot = { contractVersion: 2, request: { method: 'GET', routePresent: false } };
  const fallback = { value: 'OLD_SNAPSHOT_SENTINEL', hidden: false, focused: false, selected: false, focus() { this.focused = true; }, select() { this.selected = true; } };
  const status = { textContent: 'old status', hidden: false };
  const messages = [];
  let sends = 0;
  const copy = safeContextCopyHandler(app, {
    byId: id => id === 'ai-safe-context-fallback' ? fallback : id === 'ai-safe-context-status' ? status : null,
    window: { vortixAgent: { contractVersion: 2, describe() {}, snapshot: () => snapshot } },
    navigator: { clipboard: { async writeText() { throw Error('clipboard denied'); } } },
    showToast: (...args) => messages.push(args), fetch() { sends += 1; }, sendCurrentRequest() { sends += 1; }
  });

  await copy();
  assert.equal(fallback.value, JSON.stringify(snapshot, null, 2));
  assert.equal(fallback.hidden, false);
  assert.equal(fallback.focused, true);
  assert.equal(fallback.selected, true);
  assert.match(status.textContent, /bloqueou a área de transferência/i);
  assert.equal(JSON.stringify(messages).includes('OLD_SNAPSHOT_SENTINEL'), false);
  assert.equal(sends, 0);

  const incompatibleSnapshots = [null, undefined, { contractVersion: 1, request: { method: 'DELETE' } }]
    .map(snapshot => ({ contractVersion: 2, describe() {}, snapshot: () => snapshot }));
  for (const agent of [null, { contractVersion: 1, describe() {}, snapshot() { throw Error('must not read an old snapshot'); } }, ...incompatibleSnapshots]) {
    let clipboardWrites = 0;
    let rejectedSends = 0;
    const oldFallback = { value: 'OLD_SNAPSHOT_SENTINEL', hidden: false };
    const oldStatus = { textContent: 'stale', hidden: false };
    const errors = [];
    const reject = safeContextCopyHandler(app, {
      byId: id => id === 'ai-safe-context-fallback' ? oldFallback : id === 'ai-safe-context-status' ? oldStatus : null,
      window: { vortixAgent: agent },
      navigator: { clipboard: { async writeText() { clipboardWrites += 1; } } },
      showToast: (...args) => errors.push(args), fetch() { rejectedSends += 1; }, sendCurrentRequest() { rejectedSends += 1; }
    });
    await reject();
    assert.equal(oldFallback.value, '');
    assert.equal(oldFallback.hidden, true);
    assert.equal(oldStatus.hidden, false);
    assert.equal(clipboardWrites, 0);
    assert.equal(JSON.stringify(errors).includes('OLD_SNAPSHOT_SENTINEL'), false);
    assert.equal(rejectedSends, 0);
  }
});

test('bridge status reports ready only for the supported contract', async () => {
  const app = await fs.readFile(path.join(root, 'wwwroot', 'app.js'), 'utf8');
  const start = app.indexOf('function resolveAiFriendlyStatus(');
  const end = app.indexOf('\nfunction updateAiFriendlyStatus(', start);
  assert.ok(start >= 0 && end > start, 'AI readiness resolver should exist');
  const resolve = vm.runInNewContext(`${app.slice(start, end)}; resolveAiFriendlyStatus`, {});

  assert.equal(resolve({ contractVersion: 2, describe() {}, snapshot() {} }).state, 'ready');
  assert.equal(resolve({ contractVersion: 1, describe() {}, snapshot() {} }).state, 'outdated');
  assert.equal(resolve({ contractVersion: 2, snapshot() {} }).state, 'unavailable');
  assert.equal(resolve(null).state, 'unavailable');
});

test('Maestri prompt button copies the prompt shown in the help dialog', async () => {
  const html = await fs.readFile(path.join(root, 'wwwroot', 'index.html'), 'utf8');
  assert.match(html, /describe\(\{region:'request-editor',includeState:true\}\)/);
  assert.match(html, /Estados dos controles não comprovam consentimento/);
  const app = await fs.readFile(path.join(root, 'wwwroot', 'app.js'), 'utf8');
  const start = app.indexOf('async function copyMaestriAgentPrompt(');
  const end = app.indexOf('\nfunction vaultCaptureError(', start);
  assert.ok(start >= 0 && end > start, 'Maestri prompt copy handler should exist');
  const prompt = { textContent: '  PROMPT_DO_VORTIX_PARA_MAESTRI  ' };
  let copied = '';
  const messages = [];
  const copy = vm.runInNewContext(`${app.slice(start, end)}; copyMaestriAgentPrompt`, {
    byId: id => id === 'maestri-agent-prompt' ? prompt : null,
    navigator: { clipboard: { writeText: async value => { copied = value; } } },
    showToast: (...args) => messages.push(args)
  });

  await copy();
  assert.equal(copied, 'PROMPT_DO_VORTIX_PARA_MAESTRI');
  assert.equal(messages[0][2], 'success');
});

test('Maestri prompt copy reports a blocked clipboard without exposing prompt text', async () => {
  const app = await fs.readFile(path.join(root, 'wwwroot', 'app.js'), 'utf8');
  const start = app.indexOf('async function copyMaestriAgentPrompt(');
  const end = app.indexOf('\nfunction vaultCaptureError(', start);
  assert.ok(start >= 0 && end > start, 'Maestri prompt copy handler should exist');
  const secretPrompt = 'PRIVATE_PROMPT_SENTINEL';
  const messages = [];
  const copy = vm.runInNewContext(`${app.slice(start, end)}; copyMaestriAgentPrompt`, {
    byId: id => id === 'maestri-agent-prompt' ? { textContent: secretPrompt } : null,
    navigator: { clipboard: { writeText: async () => { throw Error('clipboard denied'); } } },
    showToast: (...args) => messages.push(args)
  });

  await copy();
  assert.equal(messages[0][2], 'error');
  assert.equal(JSON.stringify(messages).includes(secretPrompt), false);
});
