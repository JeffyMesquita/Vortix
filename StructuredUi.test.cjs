const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

function harness(method = 'GET') {
  const elements = new Map();
  const ids = ['structured-card', 'structured-prepare', 'structured-approve', 'structured-execute', 'structured-cancel', 'structured-status', 'structured-review', 'structured-write-guard', 'structured-confirm', 'structured-phrase', 'structured-destination', 'structured-effects'];
  for (const id of ids) elements.set(id, { textContent: '', disabled: false, hidden: true, checked: false, value: '', focus() { this.focused = true; } });
  let time = 0, sequence = 0, timerSequence = 0;
  const timers = new Map(), listeners = new Map();
  const context = vm.createContext({
    document: { getElementById: id => elements.get(id), addEventListener() {} },
    window: { addEventListener(name, callback, options) { const entries = listeners.get(name) || []; entries.push({ callback, once: options?.once }); listeners.set(name, entries); } }, performance: { now: () => time },
    crypto: { randomUUID: () => `id-${++sequence}` },
    setInterval(callback) { const id = ++timerSequence; timers.set(id, callback); return id; }, clearInterval(id) { timers.delete(id); }, structuredClone,
    method
  });
  for (const file of ['structured-execution.js', 'structured-ui.js']) vm.runInContext(fs.readFileSync(`./wwwroot/${file}`, 'utf8'), context);
  vm.runInContext(`
    var calls = 0, revision = 0, canConfirm = true, pendingResult = null, completeRun, pendingConfirmation = null, completeConfirmation;
    var finalFacts = {delivery:'response_received', httpStatus:200, proxyStatus:200, durationMs:1, assertions:{passed:1,failed:0,partial:0},capture:'not_requested',persistence:'completed'};
    var target = { collectionId:'c1', folderId:null, requestId:'r1', environmentId:'e1' };
    StructuredUi.attach({
      getTarget: () => target, isBusy: () => false,
      readSources: () => ({ revision, method }),
      materialize: source => ({request: {method:source.method}, warnings:[], review: {method:source.method,destination:'http://127.0.0.1',capture:false,saveResponseBody:false}}),
      confirmReview: async () => pendingConfirmation || canConfirm,
      run: async () => { calls++; return pendingResult || finalFacts; }
    });
  `, context);
  return {
    context, field: id => elements.get(`structured-${id}`),
    tick: () => { for (const callback of timers.values()) callback(); },
    advance: amount => { time += amount; }, timerCount: () => timers.size,
    emit(name, event) { for (const entry of [...(listeners.get(name) || [])]) { if (entry.once) listeners.set(name, listeners.get(name).filter(item => item !== entry)); entry.callback(event); } }
  };
}

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
    page.emit('pageshow', { persisted: true });
    page.emit('pageshow', { persisted: true });
    assert.equal(page.timerCount(), 1);
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
