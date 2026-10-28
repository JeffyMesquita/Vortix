const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const { buildRecord, readDiagnostic, blockerDefinition } = require('./wwwroot/agent-diagnostics.js');

const CONTROL_NAMES = [
  'request.save',
  'environment.manage',
  'settings.open',
  'execution.prepare',
  'execution.review',
  'execution.execute'
];

const RECORD_KEYS = [
  'diagnosticVersion',
  'revision',
  'contextMatches',
  'observedAtMs',
  'validUntilMs',
  'state',
  'blocker',
  'nextAction',
  'blockers',
  'result'
];

const RESULT_KEYS = [
  'outcome',
  'delivery',
  'httpStatus',
  'proxyStatus',
  'durationMs',
  'assertions',
  'validation',
  'capture',
  'persistence'
];

const EXPECTED_TARGETS = {
  request_not_saved: { kind: 'action', name: 'request.save' },
  unsaved_changes: { kind: 'action', name: 'request.save' },
  request_not_found: { kind: 'region', name: 'collections' },
  environment_not_found: { kind: 'action', name: 'environment.manage' },
  unresolved_variables: { kind: 'action', name: 'environment.manage' },
  vault_locked: { kind: 'action', name: 'settings.open' },
  invalid_request: { kind: 'region', name: 'request-editor' },
  ephemeral_file_unavailable: { kind: 'region', name: 'request-editor' },
  unsupported_preparation_action: { kind: 'region', name: 'request-editor' },
  write_confirmation_required: { kind: 'region', name: 'structured-execution' },
  preparation_expired: { kind: 'action', name: 'execution.prepare' },
  preparation_invalidated: { kind: 'action', name: 'execution.prepare' },
  preparation_cancelled: { kind: 'action', name: 'execution.prepare' },
  execution_in_progress: { kind: 'region', name: 'structured-execution' },
  context_changed: { kind: 'region', name: 'request-workspace' },
  diagnostic_unavailable: { kind: 'region', name: 'structured-execution' },
  diagnostic_stale: { kind: 'region', name: 'structured-execution' }
};

const encoder = new TextEncoder();

function byteLength(value) {
  return encoder.encode(typeof value === 'string' ? value : JSON.stringify(value)).length;
}

function controls(available) {
  return Object.fromEntries(CONTROL_NAMES.map(name => [name, available]));
}

function blockedFacts(overrides = {}) {
  return {
    state: 'blocked',
    contextMatches: true,
    validUntilMs: null,
    blockers: ['unresolved_variables'],
    result: null,
    controls: {
      'request.save': true,
      'environment.manage': true,
      'settings.open': true,
      'execution.prepare': true,
      'execution.review': false,
      'execution.execute': false
    },
    ...overrides
  };
}

function terminalFacts(overrides = {}) {
  const facts = {
    state: 'completed',
    contextMatches: true,
    validUntilMs: null,
    blockers: [],
    controls: controls(true),
    result: {
      outcome: 'success',
      delivery: 'response_received',
      httpStatus: 200,
      proxyStatus: 200,
      durationMs: 12,
      assertions: { passed: 1, failed: 0, partial: 0 },
      validation: 'passed',
      capture: 'not_requested',
      persistence: 'not_requested'
    }
  };
  return { ...facts, ...overrides };
}

function readyFacts(overrides = {}) {
  return blockedFacts({
    state: 'ready_for_review',
    blockers: [],
    validUntilMs: 5000,
    controls: controls(true),
    ...overrides
  });
}

function unavailableSummary() {
  return {
    diagnosticVersion: 1,
    revision: null,
    state: 'unavailable',
    freshness: 'unavailable',
    blocker: 'diagnostic_unavailable',
    nextAction: null
  };
}

test('the module exposes the same pure API globally in a browser-like context', () => {
  const source = fs.readFileSync(require.resolve('./wwwroot/agent-diagnostics.js'), 'utf8');
  const context = vm.createContext({ TextEncoder });
  vm.runInContext(source, context);
  assert.equal(typeof context.VortixDiagnostics.buildRecord, 'function');
  assert.equal(typeof context.VortixDiagnostics.readDiagnostic, 'function');
  assert.equal(typeof context.VortixDiagnostics.blockerDefinition, 'function');
  assert.equal(Object.isFrozen(context.VortixDiagnostics), true);
});

test('summary points to a known control without exposing source values', () => {
  const record = buildRecord(blockedFacts(), null, 1000);
  const summary = readDiagnostic(JSON.stringify(record), undefined, 1001);
  assert.equal(summary.state, 'blocked');
  assert.equal(summary.blocker, 'unresolved_variables');
  assert.equal(summary.nextAction, 'environment.manage');
  assert.equal(summary.freshness, 'fresh');
  assert.equal(Object.hasOwn(summary, 'observedAtMs'), false);
  assert.equal(Object.hasOwn(summary, 'result'), false);
});

test('the catalog is closed to seventeen blocker codes with fixed targets', () => {
  assert.equal(Object.keys(EXPECTED_TARGETS).length, 17);
  for (const code of Object.keys(EXPECTED_TARGETS)) {
    const definition = blockerDefinition(code);
    assert.equal(definition.code, code);
    assert.deepEqual(definition.target, EXPECTED_TARGETS[code]);
  }
  const unknown = blockerDefinition('made_up_sentinel');
  assert.deepEqual(unknown, {
    code: 'diagnostic_unavailable',
    target: { kind: 'region', name: 'structured-execution' }
  });
  assert.equal(JSON.stringify(unknown).includes('made_up_sentinel'), false);
});

test('blocker definitions are independent copies', () => {
  const first = blockerDefinition('unresolved_variables');
  first.target.name = 'mutated';
  assert.deepEqual(blockerDefinition('unresolved_variables').target, {
    kind: 'action',
    name: 'environment.manage'
  });
  assert.notStrictEqual(blockerDefinition('unresolved_variables'), blockerDefinition('unresolved_variables'));
});

test('blockers are unique and ordered by fixed priority', () => {
  const facts = blockedFacts({
    blockers: ['execution_in_progress', 'unresolved_variables', 'unresolved_variables', 'request_not_saved']
  });
  const record = buildRecord(facts, null, 1000);
  const view = readDiagnostic(JSON.stringify(record), { view: 'blockers' }, 1000);
  assert.deepEqual(view.blockers.map(entry => entry.code), [
    'execution_in_progress',
    'request_not_saved',
    'unresolved_variables'
  ]);
  assert.equal(view.blocker, 'execution_in_progress');
  assert.equal(view.nextAction, null);
});

test('a blocker only suggests a control that is available', () => {
  const available = buildRecord(blockedFacts(), null, 1000);
  assert.equal(readDiagnostic(JSON.stringify(available), undefined, 1000).nextAction, 'environment.manage');

  const disabledFacts = blockedFacts();
  disabledFacts.controls['environment.manage'] = false;
  assert.equal(buildRecord(disabledFacts, null, 1000).nextAction, null);

  const missingFacts = blockedFacts();
  missingFacts.controls = {};
  assert.equal(buildRecord(missingFacts, null, 1000).nextAction, null);
});

test('ready and approved states are hints for review and execution', () => {
  const ready = readyFacts();
  const readyRecord = buildRecord(ready, null, 1000);
  assert.equal(readyRecord.blocker, null);
  assert.equal(readyRecord.nextAction, 'execution.review');

  const approved = readyFacts({ state: 'approved', controls: controls(true) });
  assert.equal(buildRecord(approved, null, 1000).nextAction, 'execution.execute');

  approved.controls['execution.execute'] = false;
  assert.equal(buildRecord(approved, null, 1000).nextAction, null);

  ready.controls['execution.review'] = false;
  assert.equal(buildRecord(ready, null, 1000).nextAction, null);
});

test('warnings and unknown blocker codes never become blockers', () => {
  const facts = readyFacts({ warnings: ['write_operation'] });
  const record = buildRecord(facts, null, 1000);
  assert.deepEqual(record.blockers, []);
  assert.equal(record.blocker, null);

  const unknown = blockedFacts({ blockers: ['made_up_sentinel', 'request_not_saved'] });
  const unknownRecord = buildRecord(unknown, null, 1000);
  assert.deepEqual(unknownRecord.blockers.map(entry => entry.code), ['request_not_saved']);
  assert.equal(JSON.stringify(unknownRecord).includes('made_up_sentinel'), false);
});

test('revision changes only when semantic facts change', () => {
  const facts = blockedFacts();
  const first = buildRecord(facts, null, 1000);
  assert.equal(first.revision, 1);

  const identical = buildRecord({ ...facts }, first, 1500);
  assert.equal(identical.revision, 1);
  assert.equal(identical.observedAtMs, 1500);

  const ready = readyFacts();
  const changedState = buildRecord(ready, identical, 1600);
  assert.equal(changedState.revision, 2);

  const changedContext = buildRecord({ ...ready, contextMatches: false }, changedState, 1700);
  assert.equal(changedContext.revision, 3);

  const changedResult = buildRecord(terminalFacts(), null, 1000);
  const repeatedResult = buildRecord(terminalFacts(), changedResult, 1100);
  assert.equal(repeatedResult.revision, changedResult.revision);
  const resultChanged = buildRecord(
    terminalFacts({ result: { ...terminalFacts().result, httpStatus: 422 } }),
    repeatedResult,
    1200
  );
  assert.equal(resultChanged.revision, repeatedResult.revision + 1);
});

test('the record has exactly the closed field set', () => {
  const record = buildRecord(blockedFacts(), null, 1000);
  assert.deepEqual(Object.keys(record), RECORD_KEYS);
  assert.equal(record.diagnosticVersion, 1);
  assert.equal(Object.getOwnPropertySymbols(record).length, 0);
});

test('validation is derived once from assertion counts', () => {
  const cases = [
    [{ passed: 1, failed: 2, partial: 1 }, 'failed'],
    [{ passed: 1, failed: 0, partial: 2 }, 'partial'],
    [{ passed: 2, failed: 0, partial: 0 }, 'passed'],
    [{ passed: 0, failed: 0, partial: 0 }, 'not_run']
  ];
  for (const [assertions, expected] of cases) {
    const facts = terminalFacts();
    facts.result.assertions = assertions;
    facts.result.validation = 'passed';
    assert.equal(buildRecord(facts, null, 1000).result.validation, expected);
  }
});

test('the result keeps delivery, proxy status and local effects separate', () => {
  const facts = terminalFacts();
  facts.result = {
    outcome: 'http_error',
    delivery: 'response_received',
    httpStatus: 422,
    proxyStatus: 201,
    durationMs: 20,
    assertions: { passed: 0, failed: 1, partial: 0 },
    validation: 'passed',
    capture: 'failed',
    persistence: 'failed',
    url: 'URL_SENTINEL',
    authorization: 'AUTH_SENTINEL',
    id: 'ID_SENTINEL'
  };
  const record = buildRecord(facts, null, 1000);
  assert.equal(record.result.outcome, 'http_error');
  assert.equal(record.result.httpStatus, 422);
  assert.equal(record.result.proxyStatus, 201);
  assert.equal(record.result.capture, 'failed');
  assert.equal(record.result.persistence, 'failed');
  assert.equal(record.result.validation, 'failed');
  assert.equal(JSON.stringify(record).includes('SENTINEL'), false);
});

test('a non terminal state never publishes a result', () => {
  const facts = blockedFacts({ result: terminalFacts().result });
  assert.equal(buildRecord(facts, null, 1000).result, null);
});

test('invalid facts fail closed to unavailable without echoing input', () => {
  const cases = [
    { ...blockedFacts(), state: 'bogus' },
    { ...blockedFacts(), contextMatches: 'yes' },
    { ...blockedFacts(), state: 'approved', blockers: [], validUntilMs: null },
    { ...blockedFacts(), validUntilMs: 5000 },
    { ...blockedFacts(), blockers: 'unresolved_variables' },
    { ...terminalFacts(), result: { outcome: 'bogus' } }
  ];
  for (const facts of cases) {
    const record = buildRecord(facts, null, 1000);
    assert.equal(record.state, 'unavailable');
    assert.equal(record.blocker, 'diagnostic_unavailable');
    assert.equal(record.nextAction, null);
    assert.equal(JSON.stringify(record).includes('SENTINEL'), false);
    assert.equal(JSON.stringify(record).includes('bogus'), false);
  }
});

test('extra private facts fields are ignored and never published', () => {
  const facts = blockedFacts({
    url: 'URL_SENTINEL',
    authorization: 'AUTH_SENTINEL',
    requestId: 'ID_SENTINEL',
    variables: { token: 'TOKEN_SENTINEL' }
  });
  const record = buildRecord(facts, null, 1000);
  assert.equal(record.state, 'blocked');
  assert.deepEqual(Object.keys(record), RECORD_KEYS);
  assert.equal(JSON.stringify(record).includes('SENTINEL'), false);
});

test('facts accessors are never invoked and fail closed', () => {
  let stateGetterCalled = false;
  const facts = blockedFacts();
  delete facts.state;
  Object.defineProperty(facts, 'state', {
    enumerable: true,
    get() {
      stateGetterCalled = true;
      return 'blocked';
    }
  });
  assert.equal(buildRecord(facts, null, 1000).state, 'unavailable');
  assert.equal(stateGetterCalled, false);

  let controlGetterCalled = false;
  const controlFacts = blockedFacts();
  delete controlFacts.controls['environment.manage'];
  Object.defineProperty(controlFacts.controls, 'environment.manage', {
    enumerable: true,
    get() {
      controlGetterCalled = true;
      return true;
    }
  });
  assert.equal(buildRecord(controlFacts, null, 1000).nextAction, null);
  assert.equal(controlGetterCalled, false);
});

test('each read returns independent safe data', () => {
  const record = buildRecord(blockedFacts(), null, 1000);
  const first = readDiagnostic(JSON.stringify(record), { view: 'blockers' }, 1000);
  first.blockers[0].target.name = 'mutated';
  first.state = 'approved';
  const second = readDiagnostic(JSON.stringify(record), { view: 'blockers' }, 1000);
  assert.equal(second.blockers[0].target.name, 'environment.manage');
  assert.equal(second.state, 'blocked');

  const terminal = buildRecord(terminalFacts(), null, 1000);
  const firstResult = readDiagnostic(JSON.stringify(terminal), { view: 'result' }, 1000);
  firstResult.result.assertions.passed = 99;
  assert.equal(readDiagnostic(JSON.stringify(terminal), { view: 'result' }, 1000).result.assertions.passed, 1);
});

test('invalid options fail closed without extra properties or getters', () => {
  const rawRecord = JSON.stringify(buildRecord(blockedFacts(), null, 1000));
  const invalidOptions = [
    null,
    [],
    {},
    { view: 'raw' },
    { view: 'summary', id: 'ID_SENTINEL' },
    Object.create({ view: 'summary' })
  ];
  for (const options of invalidOptions) {
    assert.deepEqual(readDiagnostic(rawRecord, options, 1000), {
      diagnosticVersion: 1,
      error: 'invalid_diagnostic_options'
    });
  }

  let getterCalled = false;
  const accessorOptions = {};
  Object.defineProperty(accessorOptions, 'view', {
    enumerable: true,
    get() {
      getterCalled = true;
      return 'summary';
    }
  });
  assert.deepEqual(readDiagnostic(rawRecord, accessorOptions, 1000), {
    diagnosticVersion: 1,
    error: 'invalid_diagnostic_options'
  });
  assert.equal(getterCalled, false);

  const symbolOptions = { view: 'summary' };
  symbolOptions[Symbol('ID_SENTINEL')] = 'ID_SENTINEL';
  assert.deepEqual(readDiagnostic(rawRecord, symbolOptions, 1000), {
    diagnosticVersion: 1,
    error: 'invalid_diagnostic_options'
  });

  const hiddenOptions = {};
  Object.defineProperty(hiddenOptions, 'view', { enumerable: false, value: 'summary' });
  assert.deepEqual(readDiagnostic(rawRecord, hiddenOptions, 1000), {
    diagnosticVersion: 1,
    error: 'invalid_diagnostic_options'
  });
});

test('stale observation cannot look approved or return execution details', () => {
  const facts = readyFacts({
    state: 'approved',
    validUntilMs: 3000,
    controls: { ...controls(true), 'execution.execute': true }
  });
  const record = buildRecord(facts, null, 1000);
  const summary = readDiagnostic(JSON.stringify(record), undefined, 3000);
  assert.equal(summary.state, 'unknown');
  assert.equal(summary.freshness, 'stale');
  assert.equal(summary.blocker, 'diagnostic_stale');
  assert.equal(summary.nextAction, null);
  assert.equal(readDiagnostic(JSON.stringify(record), { view: 'result' }, 3000).result, null);
  assert.equal(record.state, 'approved');
});

test('freshness is fresh before the boundary and stale at the boundary', () => {
  const record = buildRecord(readyFacts(), null, 1000);
  const rawRecord = JSON.stringify(record);

  const before = readDiagnostic(rawRecord, undefined, 2999);
  assert.equal(before.state, 'ready_for_review');
  assert.equal(before.freshness, 'fresh');

  const boundary = readDiagnostic(rawRecord, undefined, 3000);
  assert.equal(boundary.state, 'unknown');
  assert.equal(boundary.freshness, 'stale');
  assert.equal(boundary.blocker, 'diagnostic_stale');
  assert.equal(boundary.nextAction, null);
  assert.deepEqual(
    readDiagnostic(rawRecord, { view: 'blockers' }, 3000).blockers.map(entry => entry.code),
    ['diagnostic_stale']
  );
});

test('a preparation deadline shorter than the freshness window degrades at that deadline', () => {
  const facts = readyFacts({
    state: 'approved',
    validUntilMs: 2500,
    controls: { ...controls(true), 'execution.execute': true }
  });
  const rawRecord = JSON.stringify(buildRecord(facts, null, 1000));

  const beforeDeadline = readDiagnostic(rawRecord, undefined, 2499);
  assert.equal(beforeDeadline.state, 'approved');
  assert.equal(beforeDeadline.freshness, 'fresh');
  assert.equal(beforeDeadline.nextAction, 'execution.execute');

  const atDeadline = readDiagnostic(rawRecord, undefined, 2500);
  assert.equal(atDeadline.state, 'unknown');
  assert.equal(atDeadline.freshness, 'stale');
  assert.equal(atDeadline.nextAction, null);
});

test('a completed result also degrades when the observation goes stale', () => {
  const rawRecord = JSON.stringify(buildRecord(terminalFacts(), null, 1000));
  assert.equal(readDiagnostic(rawRecord, { view: 'result' }, 2999).result !== null, true);
  assert.equal(readDiagnostic(rawRecord, { view: 'result' }, 3000).result, null);
});

test('divergent context is unavailable and never returns old results', () => {
  const facts = terminalFacts({ contextMatches: false });
  const rawRecord = JSON.stringify(buildRecord(facts, null, 1000));

  const summary = readDiagnostic(rawRecord, undefined, 1001);
  assert.equal(summary.state, 'unknown');
  assert.equal(summary.freshness, 'unavailable');
  assert.equal(summary.blocker, 'context_changed');
  assert.equal(summary.nextAction, null);

  const blockers = readDiagnostic(rawRecord, { view: 'blockers' }, 1001);
  assert.deepEqual(blockers.blockers.map(entry => entry.code), ['context_changed']);
  assert.equal(readDiagnostic(rawRecord, { view: 'result' }, 1001).result, null);
});

test('an unknown terminal state with fresh context may return a safe result', () => {
  const facts = terminalFacts({ state: 'unknown' });
  const record = buildRecord(facts, null, 1000);
  assert.equal(record.state, 'unknown');
  const view = readDiagnostic(JSON.stringify(record), { view: 'result' }, 1000);
  assert.equal(view.freshness, 'fresh');
  assert.equal(view.result.outcome, 'success');
  assert.equal(view.result.delivery, 'response_received');
});

test('fractional monotonic clocks from performance.now are accepted', () => {
  const record = buildRecord(blockedFacts(), null, 1000.25);
  assert.equal(record.observedAtMs, 1000.25);
  const summary = readDiagnostic(JSON.stringify(record), undefined, 1001.5);
  assert.equal(summary.state, 'blocked');
  assert.equal(summary.freshness, 'fresh');

  const ready = buildRecord(readyFacts({ validUntilMs: 2500.5 }), null, 1000.25);
  const rawRecord = JSON.stringify(ready);
  assert.equal(readDiagnostic(rawRecord, undefined, 2500.499).freshness, 'fresh');
  assert.equal(readDiagnostic(rawRecord, undefined, 2500.5).freshness, 'stale');

  const windowed = buildRecord(readyFacts({ validUntilMs: 5000.5 }), null, 1000.25);
  const windowedRecord = JSON.stringify(windowed);
  assert.equal(readDiagnostic(windowedRecord, undefined, 3000.249).freshness, 'fresh');
  assert.equal(readDiagnostic(windowedRecord, undefined, 3000.25).freshness, 'stale');
});

test('future or invalid reading clocks degrade the reading', () => {
  const record = buildRecord(blockedFacts(), null, 1000);
  const future = JSON.stringify({ ...record, observedAtMs: 2000 });
  assert.deepEqual(readDiagnostic(future, undefined, 1000), unavailableSummary());
  assert.deepEqual(readDiagnostic(JSON.stringify(record), undefined, -1), unavailableSummary());
  assert.deepEqual(readDiagnostic(JSON.stringify(record), undefined, -0.5), unavailableSummary());
  assert.deepEqual(readDiagnostic(JSON.stringify(record), undefined, Number.NaN), unavailableSummary());
  assert.deepEqual(readDiagnostic(JSON.stringify(record), undefined, Number.POSITIVE_INFINITY), unavailableSummary());
  assert.deepEqual(readDiagnostic(JSON.stringify(record), undefined, Number.NEGATIVE_INFINITY), unavailableSummary());
  assert.deepEqual(readDiagnostic(JSON.stringify(record), undefined, Number.MAX_SAFE_INTEGER + 1), unavailableSummary());
  assert.deepEqual(readDiagnostic(JSON.stringify(record), undefined, '1000'), unavailableSummary());
  assert.deepEqual(readDiagnostic(JSON.stringify(record), undefined, undefined), unavailableSummary());
});

test('an unavailable record reads as unavailable with a fixed code', () => {
  const record = buildRecord(null, null, 1000);
  assert.equal(record.state, 'unavailable');
  const view = readDiagnostic(JSON.stringify(record), { view: 'blockers' }, 1000);
  assert.equal(view.state, 'unavailable');
  assert.equal(view.freshness, 'unavailable');
  assert.equal(view.blocker, 'diagnostic_unavailable');
  assert.deepEqual(view.blockers.map(entry => entry.code), ['diagnostic_unavailable']);
  assert.equal(readDiagnostic(JSON.stringify(record), { view: 'result' }, 1000).result, null);
});

test('corrupt records fail closed with fixed codes and no echo', () => {
  const record = buildRecord(blockedFacts(), null, 1000);
  const corruptions = [
    '{',
    JSON.stringify({ ...record, diagnosticVersion: 2 }),
    JSON.stringify({ ...record, extra: 'EXTRA_SENTINEL' }),
    JSON.stringify({ ...record, revision: Number.MAX_SAFE_INTEGER + 1 }),
    JSON.stringify({ ...record, state: 'approved_now' }),
    JSON.stringify({ ...record, validUntilMs: 5000 }),
    JSON.stringify({ ...record, observedAtMs: -1 }),
    JSON.stringify({ ...record, blocker: 'made_up_sentinel' }),
    JSON.stringify({ ...record, nextAction: 'execution.execute' }),
    JSON.stringify({ ...record, blockers: [{ code: 'request_not_saved', target: { kind: 'action', name: 'URL_SENTINEL' } }] })
  ];
  for (const corrupted of corruptions) {
    const summary = readDiagnostic(corrupted, undefined, 1000);
    assert.deepEqual(summary, unavailableSummary());
    assert.equal(JSON.stringify(summary).includes('SENTINEL'), false);
  }

  assert.deepEqual(readDiagnostic(undefined, undefined, 1000), unavailableSummary());
  assert.deepEqual(readDiagnostic(42, undefined, 1000), unavailableSummary());
  assert.deepEqual(readDiagnostic(null, undefined, 1000), unavailableSummary());
});

test('ready and approved records without a future deadline are invalid', () => {
  const record = buildRecord(readyFacts({ state: 'approved', controls: controls(true) }), null, 1000);
  const missingDeadline = JSON.stringify({ ...record, validUntilMs: null });
  const pastDeadline = JSON.stringify({ ...record, validUntilMs: 1000 });
  assert.deepEqual(readDiagnostic(missingDeadline, undefined, 1000), unavailableSummary());
  assert.deepEqual(readDiagnostic(pastDeadline, undefined, 1000), unavailableSummary());
});

test('the result view publishes only the closed result fields', () => {
  const facts = terminalFacts();
  facts.result = {
    outcome: 'http_error',
    delivery: 'response_received',
    httpStatus: 422,
    proxyStatus: 200,
    durationMs: 0,
    assertions: { passed: 2, failed: 1, partial: 1 },
    validation: 'passed',
    capture: 'failed',
    persistence: 'failed',
    url: 'URL_SENTINEL',
    id: 'ID_SENTINEL'
  };
  const record = buildRecord(facts, null, 1000);
  const view = readDiagnostic(JSON.stringify(record), { view: 'result' }, 1001);
  assert.equal(view.revision, record.revision);
  assert.equal(view.state, 'completed');
  assert.equal(view.freshness, 'fresh');
  assert.equal(view.result.outcome, 'http_error');
  assert.equal(view.result.httpStatus, 422);
  assert.equal(view.result.proxyStatus, 200);
  assert.equal(view.result.validation, 'failed');
  assert.equal(view.result.capture, 'failed');
  assert.equal(view.result.persistence, 'failed');
  assert.deepEqual(Object.keys(view.result), RESULT_KEYS);
  assert.deepEqual(Object.keys(view.result.assertions), ['passed', 'failed', 'partial']);
  assert.equal(JSON.stringify(view).includes('SENTINEL'), false);
});

test('the largest allowed payloads fit the published byte ceilings', () => {
  const maxResult = terminalFacts({
    result: {
      outcome: 'assertion_failed',
      delivery: 'response_received',
      httpStatus: 599,
      proxyStatus: 100,
      durationMs: Number.MAX_VALUE,
      assertions: {
        passed: Number.MAX_SAFE_INTEGER,
        failed: Number.MAX_SAFE_INTEGER,
        partial: Number.MAX_SAFE_INTEGER
      },
      validation: 'failed',
      capture: 'not_requested',
      persistence: 'not_requested'
    }
  });
  const resultRecord = buildRecord(maxResult, null, 1000);
  assert.equal(byteLength(resultRecord) <= 4096, true);
  assert.equal(byteLength(readDiagnostic(JSON.stringify(resultRecord), { view: 'result' }, 1000)) <= 2048, true);
  assert.equal(byteLength(readDiagnostic(JSON.stringify(resultRecord), undefined, 1000)) <= 512, true);

  const allBlockers = Object.keys(EXPECTED_TARGETS);
  const blockersRecord = buildRecord(
    blockedFacts({ blockers: allBlockers, controls: controls(true) }),
    null,
    1000
  );
  assert.equal(blockersRecord.blockers.length, 17);
  assert.equal(byteLength(blockersRecord) <= 4096, true);
  assert.equal(byteLength(readDiagnostic(JSON.stringify(blockersRecord), { view: 'blockers' }, 1000)) <= 4096, true);
  assert.equal(byteLength(readDiagnostic(JSON.stringify(blockersRecord), undefined, 1000)) <= 512, true);

  const readyRecord = buildRecord(readyFacts({ validUntilMs: Number.MAX_SAFE_INTEGER }), null, 1000);
  assert.equal(byteLength(readyRecord) <= 4096, true);
  assert.equal(byteLength(readDiagnostic(JSON.stringify(readyRecord), undefined, 1000)) <= 512, true);
});

test('oversized records degrade without parsing or echoing content', () => {
  const record = JSON.stringify(buildRecord(blockedFacts(), null, 1000));
  const oversized = record + ' '.repeat(4096);
  assert.equal(byteLength(oversized) > 4096, true);
  assert.deepEqual(readDiagnostic(oversized, undefined, 1000), unavailableSummary());
});

test('blockerDefinition never returns a shared mutable definition', () => {
  const first = blockerDefinition('write_confirmation_required');
  first.code = 'mutated';
  first.target.kind = 'action';
  first.target.name = 'mutated';
  assert.deepEqual(blockerDefinition('write_confirmation_required'), {
    code: 'write_confirmation_required',
    target: { kind: 'region', name: 'structured-execution' }
  });
});
