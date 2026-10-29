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
    dbWrite: async (store, value) => { stored = value; }, renderEnvironmentSelect() {},
    RunnerLogic: require('./wwwroot/runner-logic.js')
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

function diagnosticReadinessHarness() {
  const source = fs.readFileSync('./wwwroot/app.js', 'utf8');
  const start = source.indexOf('function getDiagnosticReadiness(');
  assert.ok(start >= 0, 'app.js should define the private diagnostic readiness adapter');
  const end = source.indexOf('\nfunction ', start + 1);
  assert.ok(end > start, 'diagnostic readiness adapter should be a focused function');
  const state = {
    tab: { id: 'tab-private', dirty: false },
    saved: { id: 'request-private', collectionId: 'collection-private', folderId: '' },
    selectedContainer: { collectionId: 'collection-private', folderId: '' },
    collections: [{ id: 'collection-private', requests: [{ id: 'request-private' }] }],
    environments: [{ id: 'environment-private' }],
    activeEnvironmentId: 'environment-private',
    requestSendInProgress: false,
    revision: 7,
    sourceReads: 0,
    secretReads: 0
  };
  const context = {
    activeWorkspaceTab: () => state.tab,
    get activeSaved() { return state.saved; },
    get selectedContainer() { return state.selectedContainer; },
    get collections() { return state.collections; },
    get environments() { return state.environments; },
    get activeEnvironmentId() { return state.activeEnvironmentId; },
    get requestSendInProgress() { return state.requestSendInProgress; },
    get structuredDiagnosticContextRevision() { return state.revision; },
    findCollection: id => state.collections.find(collection => collection.id === id),
    findFolder: collection => collection,
    getStructuredSources() { state.sourceReads += 1; throw Error('source materialization forbidden'); },
    vaultResolutionInput() { state.secretReads += 1; throw Error('credential access forbidden'); }
  };
  const handler = vm.runInNewContext(`${source.slice(start, end)}\ngetDiagnosticReadiness`, context);
  return { handler, state };
}

test('diagnostic readiness distinguishes private blockers without materializing sources or reading secrets', () => {
  const page = diagnosticReadinessHarness();
  const origin = {
    collectionId: 'collection-private', folderId: '', requestId: 'request-private', environmentId: 'environment-private'
  };
  const ready = page.handler(origin);
  assert.deepEqual({
    blocker: ready.blocker,
    contextMatches: ready.contextMatches,
    requestSaved: ready.requestSaved,
    draftDirty: ready.draftDirty,
    requestExists: ready.requestExists,
    environmentExists: ready.environmentExists,
    executorBusy: ready.executorBusy,
    revision: ready.revision
  }, {
    blocker: null, contextMatches: true, requestSaved: true, draftDirty: false,
    requestExists: true, environmentExists: true, executorBusy: false, revision: 7
  });

  page.state.saved = null;
  assert.equal(page.handler(null).blocker, 'request_not_saved');
  page.state.saved = { id: 'request-private', collectionId: 'collection-private', folderId: '' };
  page.state.tab.dirty = true;
  assert.equal(page.handler(origin).blocker, 'unsaved_changes');
  page.state.tab.dirty = false;
  page.state.collections[0].requests = [];
  assert.equal(page.handler(origin).blocker, 'request_not_found');
  page.state.collections[0].requests = [{ id: 'request-private' }];
  page.state.environments = [];
  assert.equal(page.handler(origin).blocker, 'environment_not_found');
  page.state.environments = [{ id: 'environment-private' }];
  page.state.requestSendInProgress = true;
  assert.equal(page.handler(origin).blocker, 'execution_in_progress');
  assert.equal(page.state.sourceReads, 0);
  assert.equal(page.state.secretReads, 0);
  assert.deepEqual(Object.keys(ready.origin).sort(), ['collectionId', 'environmentId', 'folderId', 'requestId', 'tabId'].sort());
  assert.doesNotMatch(JSON.stringify(ready.origin), /SECRET_SENTINEL|BODY_SENTINEL/);
});

test('tab navigation changes diagnostic origin without changing semantic revision', () => {
  const page = diagnosticReadinessHarness();
  const origin = {
    tabId: 'tab-private', collectionId: 'collection-private', folderId: '',
    requestId: 'request-private', environmentId: 'environment-private'
  };
  const original = page.handler(origin);
  assert.equal(original.contextMatches, true);
  page.state.tab = { id: 'tab-other', dirty: false };
  const away = page.handler(origin);
  assert.equal(away.contextMatches, false);
  assert.equal(away.revision, original.revision);
  page.state.tab = { id: 'tab-private', dirty: false };
  const returned = page.handler(origin);
  assert.equal(returned.contextMatches, true);
  assert.equal(returned.revision, original.revision);

  const source = fs.readFileSync('./wwwroot/app.js', 'utf8');
  const start = source.indexOf('function activateWorkspaceTab(');
  const end = source.indexOf('\nfunction ', start + 1);
  assert.ok(start >= 0 && end > start, 'workspace activation should be a focused function');
  assert.match(source.slice(start, end), /invalidateStructuredDiagnosticContext\(false\)/);
});
