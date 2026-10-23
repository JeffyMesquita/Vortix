const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = __dirname;

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
    ['refresh-agent-safe-state', 'agent.snapshot.refresh'],
    ['ai-friendly-trigger', 'agent.help.open'],
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
  assert.match(guide, /window\.vortixAgent\.snapshot\(\)/);
  assert.match(guide, /agent-safe-state/);
  assert.match(guide, /IA v2 pronta/);
  assert.match(guide, /agent\.help\.open/);
  assert.match(guide, /GET|HEAD|OPTIONS/);
  assert.match(guide, /POST[\s\S]*PUT[\s\S]*PATCH[\s\S]*DELETE/);
  assert.match(guide, /consentimento explícito/i);
  assert.match(guide, /não (?:leia|acesse|consulte)[\s\S]{0,80}(?:token|senha|segredo|cofre|IndexedDB)/i);
  assert.match(guide, /Antes de enviar qualquer request, desmarque[\s\S]{0,140}Salvar credenciais de Auth[\s\S]{0,100}(?:histórico|histórico é gravado)/i);
  assert.match(guide, /Nunca.*(?:endpoint|fetch|guard)/i);
  assert.match(readme, /## Automação por IA com Maestri Portal/);
  assert.match(readme, /selo \*\*IA v2 pronta\*\*/);
  assert.match(readme, /\[guia para agentes no Maestri Portal\]\(docs\/maestri-portal\.md\)/i);
  assert.match(readme, /\.agents\/skills\/vortix-maestri-operator\/SKILL\.md/);
});

test('AI readiness reports ready only for the supported bridge contract', async () => {
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
