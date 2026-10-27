const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

function harness(method = 'GET') {
  const elements = new Map();
  const ids = ['structured-card', 'structured-prepare', 'structured-approve', 'structured-execute', 'structured-cancel', 'structured-status', 'structured-review', 'structured-write-guard', 'structured-confirm', 'structured-phrase', 'structured-destination', 'structured-effects'];
  for (const id of ids) elements.set(id, { textContent: '', disabled: false, hidden: true, checked: false, value: '', focus() { this.focused = true; } });
  let tick, time = 0, sequence = 0;
  const context = vm.createContext({
    document: { getElementById: id => elements.get(id), addEventListener() {} },
    window: { addEventListener() {} }, performance: { now: () => time },
    crypto: { randomUUID: () => `id-${++sequence}` },
    setInterval(callback) { tick = callback; return 1; }, clearInterval() {}, structuredClone,
    method
  });
  for (const file of ['structured-execution.js', 'structured-ui.js']) vm.runInContext(fs.readFileSync(`./wwwroot/${file}`, 'utf8'), context);
  vm.runInContext(`
    var calls = 0, revision = 0, canConfirm = true;
    var finalFacts = {delivery:'response_received', httpStatus:200, proxyStatus:200, durationMs:1, assertions:{passed:1,failed:0,partial:0},capture:'not_requested',persistence:'completed'};
    var target = { collectionId:'c1', folderId:null, requestId:'r1', environmentId:'e1' };
    StructuredUi.attach({
      getTarget: () => target, isBusy: () => false,
      readSources: () => ({ revision, method }),
      materialize: source => ({request: {method:source.method}, warnings:[], review: {method:source.method,destination:'http://127.0.0.1',capture:false,saveResponseBody:false}}),
      confirmReview: async () => canConfirm,
      run: async () => { calls++; return finalFacts; }
    });
  `, context);
  return { context, field: id => elements.get(`structured-${id}`), tick: () => tick(), advance: amount => { time += amount; } };
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
