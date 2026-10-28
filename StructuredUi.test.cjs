const assert = require('node:assert/strict');
const fs = require('node:fs');
const { TextDecoder, TextEncoder } = require('node:util');
const vm = require('node:vm');
const test = require('node:test');

function harness(method = 'GET') {
  const elements = new Map();
  const ids = ['structured-card', 'structured-prepare', 'structured-approve', 'structured-execute', 'structured-cancel', 'structured-status', 'structured-review', 'structured-write-guard', 'structured-confirm', 'structured-phrase', 'structured-destination', 'structured-effects', 'structured-diagnostic-summary', 'structured-diagnostic-go', 'save-collection-request', 'manage-environments-direct', 'manage-environments', 'request-workspace-panel', 'workspace-tabs', 'collections-tree', 'method', 'request-editor-tabs', 'confirmation-dialog'];
  for (const elementId of ids) {
    const hidden = ['structured-review', 'structured-write-guard', 'structured-diagnostic-go'].includes(elementId);
    elements.set(elementId, { textContent: '', disabled: false, hidden, checked: false, value: '', dataset: {}, open: false, tagName: elementId === 'structured-card' ? 'DETAILS' : '', focus() { this.focused = true; }, removeAttribute(name) { if (name === 'data-vortix-diagnostic') delete this.dataset.vortixDiagnostic; }, getAttribute() { return null; }, addEventListener() {} });
  }
  const card = elements.get('structured-card');
  card.getAttribute = name => name === 'data-vortix-diagnostic' ? card.dataset.vortixDiagnostic ?? null : null;
  for (const elementId of ['structured-prepare', 'structured-approve', 'structured-execute', 'structured-cancel', 'structured-status', 'structured-review', 'structured-write-guard', 'structured-confirm', 'structured-phrase', 'structured-destination', 'structured-effects', 'structured-diagnostic-summary', 'structured-diagnostic-go']) elements.get(elementId).parentElement = card;
  card.parentElement = elements.get('request-workspace-panel');
  card.querySelector = selector => selector === 'summary' ? { focus() { this.focused = true; } } : null;
  const readiness = { blocker: null, contextMatches: true, requestSaved: true, draftDirty: false, requestExists: true, environmentExists: true, executorBusy: false, revision: 1 };
  let time = 0, sequence = 0, timerSequence = 0;
  const timers = new Map(), listeners = new Map();
  const context = vm.createContext({
    TextDecoder, TextEncoder,
    document: { getElementById: elementId => elements.get(elementId), addEventListener() {}, querySelector: selector => selector === 'dialog[open]' && elements.get('confirmation-dialog').open ? elements.get('confirmation-dialog') : null, querySelectorAll: () => [] },
    window: { addEventListener(name, callback, options) { const entries = listeners.get(name) || []; entries.push({ callback, once: options?.once }); listeners.set(name, entries); } }, performance: { now: () => time },
    crypto: { randomUUID: () => `id-${++sequence}` },
    setInterval(callback) { const id = ++timerSequence; timers.set(id, callback); return id; }, clearInterval(id) { timers.delete(id); }, structuredClone,
    method
  });
  vm.runInContext(fs.readFileSync('./wwwroot/agent-diagnostics.js', 'utf8'), context);
  for (const file of ['structured-execution.js', 'structured-ui.js', 'agent-bridge.js']) vm.runInContext(fs.readFileSync(`./wwwroot/${file}`, 'utf8'), context);
  vm.runInContext(`
    var calls = 0, revision = 0, canConfirm = true, pendingResult = null, completeRun, pendingConfirmation = null, completeConfirmation, sourceReads = 0, materializeCalls = 0, readinessReads = 0, preparationBlocker = null;
    var finalFacts = {delivery:'response_received', httpStatus:200, proxyStatus:200, durationMs:1, assertions:{passed:1,failed:0,partial:0},capture:'not_requested',persistence:'completed'};
    var diagnosticReadiness = null;
    var currentOrigin = {tabId:'tab-1',collectionId:'c1',folderId:'',requestId:'r1',environmentId:'e1'};
    var confirmationDialog = null;
    var target = { collectionId:'c1', folderId:null, requestId:'r1', environmentId:'e1' };
    diagnosticReadiness = ${JSON.stringify(readiness)};
    confirmationDialog = document.getElementById('confirmation-dialog');
    var diagnosticHandle = StructuredUi.attach({
      getTarget: () => target, isBusy: () => false,
      getDiagnosticReadiness: origin => { readinessReads++; const contextMatches = !origin || ((origin.tabId === undefined || origin.tabId === currentOrigin.tabId) && origin.collectionId === currentOrigin.collectionId && (origin.folderId || '') === currentOrigin.folderId && origin.requestId === currentOrigin.requestId && origin.environmentId === currentOrigin.environmentId); return {...diagnosticReadiness, contextMatches, origin:{...currentOrigin}, revision:diagnosticReadiness.revision + revision}; },
      readSources: () => { sourceReads++; return { revision, method, origin:{tabId:currentOrigin.tabId} }; },
      materialize: source => { materializeCalls++; if (preparationBlocker) throw Object.assign(Error('Fixture blocker'), {code:preparationBlocker}); return {request: {method:source.method}, warnings:[], review: {method:source.method,destination:'http://127.0.0.1',capture:false,saveResponseBody:false}}; },
      confirmReview: async () => { if (!pendingConfirmation) return canConfirm; confirmationDialog.open = true; try { return await pendingConfirmation; } finally { confirmationDialog.open = false; } },
      run: async () => { calls++; return pendingResult || finalFacts; }
    });
  `, context);
  return {
    context, element: elementId => elements.get(elementId), readiness,
    field: name => elements.get(`structured-${name}`),
    tick: () => { for (const callback of timers.values()) callback(); },
    advance: amount => { time += amount; }, timerCount: () => timers.size,
    emit(name, event) { for (const entry of [...(listeners.get(name) || [])]) { if (entry.once) listeners.set(name, listeners.get(name).filter(item => item !== entry)); entry.callback(event); } }
  };
}

test('initial diagnostic publishes a private-source-free record without preparation effects', () => {
  const page = harness();
  const card = page.element('structured-card');
  const recordText = card.dataset.vortixDiagnostic;
  assert.equal(typeof recordText, 'string');
  const record = JSON.parse(recordText);
  assert.equal(record.state, 'idle');
  assert.equal(record.contextMatches, true);
  assert.equal(record.revision, 1);
  assert.equal(Object.hasOwn(record, 'requestId'), false);
  assert.equal(Object.keys(page.context.diagnosticHandle).join(','), 'invalidateDiagnosticContext');
  assert.equal(page.context.calls, 0);
  assert.equal(page.context.sourceReads, 0);
  assert.equal(page.context.materializeCalls, 0);
  assert.equal(page.timerCount(), 1);
  assert.doesNotMatch(recordText, /collection-private|request-private|SECRET_SENTINEL|BODY_SENTINEL/);
});

test('diagnostic blocker reuses a known control and focuses it only after an explicit click', () => {
  const page = harness();
  const card = page.element('structured-card');
  card.open = true;
  page.context.diagnosticReadiness.blocker = 'environment_not_found';
  page.tick();
  const record = JSON.parse(card.dataset.vortixDiagnostic);
  assert.equal(record.state, 'blocked');
  assert.equal(record.blocker, 'environment_not_found');
  assert.equal(record.nextAction, 'environment.manage');
  assert.equal(page.field('diagnostic-go').hidden, false);
  page.field('diagnostic-go').onclick();
  assert.equal(page.element('manage-environments-direct').focused, true);
  assert.equal(page.context.calls, 0);
});

test('modal or inert controls cannot become diagnostic suggestions', () => {
  const page = harness();
  const card = page.element('structured-card');
  card.open = true;
  page.context.diagnosticReadiness.blocker = 'request_not_saved';
  page.element('confirmation-dialog').open = true;
  page.tick();
  assert.equal(JSON.parse(card.dataset.vortixDiagnostic).nextAction, null);
  assert.equal(page.field('diagnostic-go').hidden, true);
  page.element('confirmation-dialog').open = false;
  page.element('save-collection-request').inert = true;
  page.tick();
  assert.equal(JSON.parse(card.dataset.vortixDiagnostic).nextAction, null);
  assert.equal(page.field('diagnostic-go').hidden, true);
  page.element('save-collection-request').inert = false;
  page.element('save-collection-request').hidden = true;
  page.tick();
  assert.equal(JSON.parse(card.dataset.vortixDiagnostic).nextAction, null);
  assert.equal(page.field('diagnostic-go').hidden, true);
});

test('preparation blockers and reset reasons remain fixed diagnostic codes', () => {
  for (const blocker of ['unresolved_variables', 'vault_locked', 'invalid_request']) {
    const page = harness();
    page.element('structured-card').open = true;
    page.context.preparationBlocker = blocker;
    page.field('prepare').onclick();
    page.tick();
    const record = JSON.parse(page.element('structured-card').dataset.vortixDiagnostic);
    assert.equal(record.state, 'blocked');
    assert.equal(record.blocker, blocker);
    assert.equal(page.context.calls, 0);
  }

  const cancelled = harness();
  cancelled.element('structured-card').open = true;
  cancelled.field('prepare').onclick();
  cancelled.field('cancel').onclick();
  assert.equal(JSON.parse(cancelled.element('structured-card').dataset.vortixDiagnostic).blocker, 'preparation_cancelled');

  const expired = harness();
  expired.element('structured-card').open = true;
  expired.field('prepare').onclick();
  expired.advance(300001);
  expired.tick();
  assert.equal(JSON.parse(expired.element('structured-card').dataset.vortixDiagnostic).blocker, 'preparation_expired');

  const invalidated = harness();
  invalidated.element('structured-card').open = true;
  invalidated.field('prepare').onclick();
  vm.runInContext('revision++', invalidated.context);
  invalidated.tick();
  assert.equal(JSON.parse(invalidated.element('structured-card').dataset.vortixDiagnostic).blocker, 'preparation_invalidated');
});

test('idle diagnostics adopt the active tab without retaining unrelated blockers', () => {
  const page = harness();
  const card = page.element('structured-card');
  card.open = true;
  page.context.currentOrigin.tabId = 'tab-2';
  page.context.diagnosticReadiness.blocker = 'request_not_saved';
  page.context.diagnosticHandle.invalidateDiagnosticContext();
  page.tick();
  let record = JSON.parse(card.dataset.vortixDiagnostic);
  assert.equal(record.state, 'blocked');
  assert.equal(record.blocker, 'request_not_saved');
  assert.equal(record.nextAction, 'request.save');
  page.context.diagnosticReadiness.blocker = null;
  page.context.preparationBlocker = 'unresolved_variables';
  page.field('prepare').onclick();
  assert.equal(JSON.parse(card.dataset.vortixDiagnostic).blocker, 'unresolved_variables');
  page.context.currentOrigin.tabId = 'tab-3';
  page.context.diagnosticHandle.invalidateDiagnosticContext();
  page.tick();
  record = JSON.parse(card.dataset.vortixDiagnostic);
  assert.equal(record.state, 'idle');
  assert.equal(record.blocker, null);
  assert.equal(page.context.calls, 0);
});

test('tab navigation suspends preparation guidance and restores its origin without a semantic edit', () => {
  const page = harness();
  const card = page.element('structured-card');
  card.open = true;
  page.field('prepare').onclick();
  let record = JSON.parse(card.dataset.vortixDiagnostic);
  assert.equal(record.state, 'ready_for_review');
  const revision = page.context.diagnosticReadiness.revision;

  page.context.currentOrigin.tabId = 'tab-2';
  page.context.diagnosticHandle.invalidateDiagnosticContext();
  page.tick();
  record = JSON.parse(card.dataset.vortixDiagnostic);
  assert.equal(record.state, 'unknown');
  assert.equal(record.blocker, 'context_changed');
  assert.equal(page.context.diagnosticReadiness.revision, revision);

  page.context.currentOrigin.tabId = 'tab-1';
  page.context.diagnosticHandle.invalidateDiagnosticContext();
  page.tick();
  record = JSON.parse(card.dataset.vortixDiagnostic);
  assert.equal(record.state, 'ready_for_review');
  assert.equal(page.field('approve').disabled, false);
  assert.equal(page.context.diagnosticReadiness.revision, revision);
  assert.equal(page.context.calls, 0);
});

test('diagnostic follows review approval and a running execution without suggesting repeated sends', async () => {
  const page = harness();
  const card = page.element('structured-card');
  card.open = true;
  page.advance(0.25);
  page.field('prepare').onclick();
  page.tick();
  let record = JSON.parse(card.dataset.vortixDiagnostic);
  assert.equal(record.state, 'ready_for_review');
  assert.equal(record.nextAction, 'execution.review');
  assert.equal(record.observedAtMs, 0.25);
  assert.equal(record.validUntilMs, 300000.25);

  vm.runInContext('pendingConfirmation = new Promise(resolve => { completeConfirmation = resolve; })', page.context);
  const approval = page.field('approve').onclick();
  record = JSON.parse(card.dataset.vortixDiagnostic);
  assert.equal(page.element('confirmation-dialog').open, true);
  assert.equal(record.state, 'ready_for_review');
  assert.equal(record.nextAction, null);
  assert.equal(vm.runInContext('window.vortixAgent.diagnose().nextAction', page.context), null);
  vm.runInContext('completeConfirmation(true)', page.context);
  await approval;
  page.tick();
  record = JSON.parse(card.dataset.vortixDiagnostic);
  assert.equal(record.state, 'approved');
  assert.equal(record.nextAction, 'execution.execute');

  vm.runInContext('pendingResult = new Promise(resolve => { completeRun = resolve; })', page.context);
  await page.field('execute').onclick();
  page.tick();
  record = JSON.parse(card.dataset.vortixDiagnostic);
  assert.equal(record.state, 'running');
  assert.equal(record.nextAction, null);
  assert.equal(page.context.calls, 1);
  vm.runInContext('completeRun({...finalFacts, assertions:{passed:0,failed:0,partial:1}})', page.context);
  await new Promise(resolve => setImmediate(resolve));
  page.tick();
  record = JSON.parse(card.dataset.vortixDiagnostic);
  assert.equal(record.state, 'completed');
  assert.equal(record.result.assertions.partial, 1);
  assert.equal(record.result.validation, 'partial');
});

test('diagnostic invalidation hides a prior result and republishes it as context changed', async () => {
  const page = harness();
  const card = page.element('structured-card');
  card.open = true;
  page.field('prepare').onclick();
  await page.field('approve').onclick();
  await page.field('execute').onclick();
  await new Promise(resolve => setImmediate(resolve));
  page.tick();
  assert.equal(JSON.parse(card.dataset.vortixDiagnostic).state, 'completed');
  page.context.diagnosticReadiness.revision += 1;
  page.context.diagnosticHandle.invalidateDiagnosticContext();
  assert.equal(card.dataset.vortixDiagnostic, undefined);
  page.tick();
  const record = JSON.parse(card.dataset.vortixDiagnostic);
  assert.equal(record.state, 'unknown');
  assert.equal(record.contextMatches, false);
  assert.equal(record.blocker, 'context_changed');
  assert.equal(record.result, null);
});

test('prepare and approve are side-effect free; execution uses one prepared call', async () => {
  const page = harness();
  page.field('prepare').onclick();
  assert.equal(page.context.calls, 0);
  assert.equal(page.field('execute').disabled, true);
  await page.field('approve').onclick();
  assert.equal(page.context.calls, 0);
  assert.equal(page.field('execute').disabled, false);
  await page.field('execute').onclick();
  await new Promise(resolve => setImmediate(resolve));
  page.tick();
  assert.equal(page.context.calls, 1);
  assert.match(page.field('status').textContent, /HTTP 200/);
  await page.field('execute').onclick();
  assert.equal(page.context.calls, 1);
});

test('write review requires TESTE and checkbox before contextual approval', async () => {
  const page = harness('POST');
  page.field('prepare').onclick();
  assert.equal(page.field('approve').disabled, true);
  page.field('confirm').checked = true;
  page.field('phrase').value = 'TESTE';
  page.tick();
  await page.field('approve').onclick();
  assert.equal(page.field('execute').disabled, false);
  assert.equal(page.context.calls, 0);
});

test('editing after approval and expiration both require new preparation', async () => {
  const page = harness();
  page.field('prepare').onclick();
  await page.field('approve').onclick();
  vm.runInContext('revision++', page.context);
  page.tick();
  assert.equal(page.field('execute').disabled, true);
  assert.match(page.field('status').textContent, /alterados/);
  page.field('prepare').onclick();
  page.advance(300000);
  page.tick();
  assert.match(page.field('status').textContent, /expirada/);
  assert.equal(page.context.calls, 0);
});

test('cancelled contextual dialog does not approve or send', async () => {
  const page = harness();
  page.field('prepare').onclick();
  vm.runInContext('canConfirm=false', page.context);
  await page.field('approve').onclick();
  assert.equal(page.field('execute').disabled, true);
  assert.equal(page.context.calls, 0);
});

test('browser preparation uses the existing ApiStudioRunner global', () => {
  const context = vm.createContext({ ApiStudioRunner: require('./wwwroot/runner-logic.js'), URL });
  vm.runInContext(fs.readFileSync('./wwwroot/structured-request.js', 'utf8'), context);
  const output = context.StructuredRequest.materializeSavedRequest({
    saved: { baseUrl: 'http://127.0.0.1', route: '/health' }, environment: { id: 'e1', variables: {} },
    vault: {}, authScopes: [], origin: { collectionId: 'c1', folderId: '' }, historySettings: {}
  });
  assert.equal(output.request.method, 'GET');
});

test('partial validation is visibly distinct from a fully completed validation', async () => {
  const page = harness();
  vm.runInContext('finalFacts.assertions.partial=1', page.context);
  page.field('prepare').onclick();
  await page.field('approve').onclick();
  await page.field('execute').onclick();
  await new Promise(resolve => setImmediate(resolve));
  page.tick();
  assert.match(page.field('status').textContent, /validação parcial/);
  assert.doesNotMatch(page.field('status').textContent, /: concluído/);
});

test('back-forward restoration invalidates pending approval and resumes the panel repeatedly', async () => {
  const page = harness();
  for (let cycle = 0; cycle < 2; cycle++) {
    page.field('prepare').onclick();
    await page.field('approve').onclick();
    assert.equal(page.field('execute').disabled, false);
    page.emit('pagehide', { persisted: true });
    assert.equal(page.timerCount(), 0);
    assert.equal(page.element('structured-card').dataset.vortixDiagnostic, undefined);
    page.emit('pageshow', { persisted: true });
    page.emit('pageshow', { persisted: true });
    assert.equal(page.timerCount(), 1);
    assert.equal(typeof page.element('structured-card').dataset.vortixDiagnostic, 'string');
    assert.equal(page.field('execute').disabled, true);
    assert.equal(page.field('prepare').disabled, false);
    page.field('prepare').onclick();
    assert.equal(page.field('approve').disabled, false);
  }
  assert.equal(page.context.calls, 0);
});

test('back-forward restoration retains an in-flight execution without replaying it', async () => {
  const page = harness();
  vm.runInContext('pendingResult = new Promise(resolve => { completeRun = resolve; })', page.context);
  page.field('prepare').onclick();
  await page.field('approve').onclick();
  await page.field('execute').onclick();
  page.emit('pagehide', { persisted: true });
  page.emit('pageshow', { persisted: true });
  assert.equal(page.field('execute').disabled, true);
  assert.equal(page.field('prepare').disabled, true);
  vm.runInContext('completeRun(finalFacts)', page.context);
  await new Promise(resolve => setImmediate(resolve));
  page.tick();
  assert.equal(page.context.calls, 1);
  assert.match(page.field('status').textContent, /HTTP 200/);
  assert.equal(page.field('prepare').disabled, false);
});

test('permanent page teardown stops timers and disables stale controls', () => {
  const page = harness();
  page.field('prepare').onclick();
  page.emit('pagehide', { persisted: false });
  page.emit('pageshow', { persisted: false });
  assert.equal(page.timerCount(), 0);
  for (const name of ['prepare', 'approve', 'execute', 'cancel']) assert.equal(page.field(name).disabled, true);
});

test('a confirmation completing after cache restoration cannot approve a new preparation', async () => {
  const page = harness();
  vm.runInContext('pendingConfirmation = new Promise(resolve => { completeConfirmation = resolve; })', page.context);
  page.field('prepare').onclick();
  const oldApproval = page.field('approve').onclick();
  page.emit('pagehide', { persisted: true });
  page.emit('pageshow', { persisted: true });
  page.field('prepare').onclick();
  vm.runInContext('completeConfirmation(true)', page.context);
  await oldApproval;
  assert.equal(page.field('execute').disabled, true);
  assert.equal(page.field('approve').disabled, false);
  assert.equal(page.context.calls, 0);
});
