const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

function harness() {
  const source = fs.readFileSync('./wwwroot/app.js', 'utf8');
  const run = source.slice(source.indexOf('async function runStructuredRequest('), source.indexOf('\nfunction initializeStructuredExecution('));
  const sources = { revision: 1 };
  let calls = 0, renders = 0, capturedEnvironment = '';
  const context = {
    performance: { now: () => 10 }, requestSendInProgress: false, updateGuard() {},
    activeWorkspaceTab: () => ({ id: 'another-tab', dirty: false }), activeSaved: { id: 'r2' },
    getStructuredSources: () => sources,
    saveHistory: async () => ({ id: 'history' }), saveHistoryResponse: async () => true,
    executeApiRequest: async () => { calls++; return { proxyStatus: 200, result: { status: 200, body: '{}', headers: {} } }; },
    writeMethods: new Set(['POST', 'PUT', 'PATCH', 'DELETE']),
    requestBodyContractTestResult: () => null, responseResultsForRequest: () => [{ passed: true }],
    captureResponseVariable: async request => { capturedEnvironment = request.environmentId; return { ok: true }; },
    showResponse: () => { renders++; }, renderResponseTestResults() {}, renderRequestBodyContractResult() {}, clearCurrentResponseExample() {},
    RunnerLogic: { redactSecretValues: value => value }, byId: () => ({})
  };
  const handler = vm.runInNewContext(`${run}\nrunStructuredRequest`, context);
  const prepared = {
    call: { method: 'GET', environmentId: 'e1', captureResponseVariable: true }, historyRequest: {}, secrets: {}, historySettings: {},
    origin: { tabId: 'source-tab', requestId: 'r1', collectionId: 'c1', folderId: '' }, sourceStamp: JSON.stringify(sources)
  };
  return { handler, context, sources, prepared, calls: () => calls, renders: () => renders, capturedEnvironment: () => capturedEnvironment };
}

test('structured execution shares transport and never paints a different tab', async () => {
  const page = harness();
  const result = await page.handler(page.prepared);
  assert.equal(result.delivery, 'response_received');
  assert.equal(result.httpStatus, 200);
  assert.equal(page.calls(), 1);
  assert.equal(page.renders(), 0);
  assert.equal(page.capturedEnvironment(), 'e1');
  assert.equal(page.context.requestSendInProgress, false);
});

test('failed required history and edits during its await prevent sending', async () => {
  for (const edit of [false, true]) {
    const page = harness();
    page.context.saveHistory = async () => { if (edit) page.sources.revision++; return edit ? { id: 'history' } : null; };
    const result = await page.handler(page.prepared);
    assert.equal(result.delivery, 'not_sent');
    assert.equal(page.calls(), 0);
    assert.equal(page.context.requestSendInProgress, false);
  }
});

test('post-response persistence failure cannot erase delivery evidence', async () => {
  const page = harness();
  page.context.saveHistoryResponse = async () => false;
  const result = await page.handler(page.prepared);
  assert.equal(result.delivery, 'response_received');
  assert.equal(result.persistence, 'failed');
  assert.equal(page.calls(), 1);
});

test('network failure distinguishes proxy status from unknown destination delivery', async () => {
  const page = harness();
  page.context.executeApiRequest = async () => ({ proxyStatus: 502, result: { error: 'SECRET_SENTINEL' } });
  const result = await page.handler(page.prepared);
  assert.equal(result.delivery, 'unknown');
  assert.equal(result.httpStatus, null);
  assert.equal(result.proxyStatus, 502);
  assert.doesNotMatch(JSON.stringify(result), /SECRET_SENTINEL/);
});

test('response capture writes into the explicit environment rather than the active one', async () => {
  const source = fs.readFileSync('./wwwroot/app.js', 'utf8');
  const save = source.slice(source.indexOf('async function saveEnvironmentVariable('), source.indexOf('\nasync function captureResponseVariable('));
  let stored;
  const context = {
    activeEnvironmentId: 'another', environments: [{ id: 'another', variables: {} }, { id: 'target', variables: {} }],
    dbWrite: async (store, value) => { stored = value; }, renderEnvironmentSelect() {}
  };
  const handler = vm.runInNewContext(`${save}\nsaveEnvironmentVariable`, context);
  await handler('id', 'fixture', 'target');
  assert.equal(stored.id, 'target');
  assert.equal(stored.variables.id, 'fixture');
  assert.deepEqual(context.environments[0].variables, {});
});

test('approval controls do not mark the saved request dirty', () => {
  const source = fs.readFileSync('./wwwroot/app.js', 'utf8');
  const handler = source.match(/trackDraft=event=>\{[^\r\n]+\};/)[0];
  let changes = 0;
  const track = vm.runInNewContext(`const ${handler}; trackDraft`, { syncActiveWorkspaceTab: () => { changes++; } });
  track({ target: { id: 'structured-confirm', closest: selector => selector === '#structured-card', matches: () => false } });
  assert.equal(changes, 0);
});

test('application credentials and execution adapters remain in private lexical scope', () => {
  const source = fs.readFileSync('./wwwroot/app.js', 'utf8').replace(/startApp\(\);\s*\}\)\(\);\s*$/, '})();');
  const context = vm.createContext({
    window: { ApiStudioRunner: require('./wwwroot/runner-logic.js') },
    document: { getElementById: () => ({}), querySelectorAll: () => [] },
    URL, TextEncoder, TextDecoder, Set, Map
  });
  vm.runInContext(source, context);
  assert.equal(vm.runInContext('typeof getStructuredSources', context), 'undefined');
  assert.equal(vm.runInContext('typeof runStructuredRequest', context), 'undefined');
  assert.equal(vm.runInContext('typeof secretVaultValues', context), 'undefined');
});
