const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const { createStructuredExecution } = require('./wwwroot/structured-execution.js');

const TTL_MS = 300000;

function defaultFacts(overrides = {}) {
  return {
    delivery: 'response_received',
    httpStatus: 200,
    proxyStatus: 200,
    durationMs: 1,
    assertions: { passed: 0, failed: 0, partial: 0 },
    capture: 'not_requested',
    persistence: 'not_requested',
    ...overrides
  };
}

function codedError(code, message = '') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function flush() {
  return new Promise(resolve => setImmediate(resolve));
}

function harness(options = {}) {
  const state = {
    time: 0,
    sequence: 0,
    calls: 0,
    readCalls: 0,
    materializeCalls: 0,
    sources: options.sources ?? { method: 'GET', environmentVersion: 1 },
    readError: options.readError ?? null,
    materializeError: options.materializeError ?? null,
    runImpl: options.run ?? (() => Promise.resolve(defaultFacts())),
    materializeImpl: options.materialize ?? null,
    requests: []
  };

  const controller = createStructuredExecution({
    now: () => state.time,
    newId: () => `fixture-${++state.sequence}`,
    readSources: () => {
      state.readCalls += 1;
      if (state.readError) throw state.readError;
      return structuredClone(state.sources);
    },
    materialize: sources => {
      state.materializeCalls += 1;
      if (state.materializeError) throw state.materializeError;
      if (state.materializeImpl) return state.materializeImpl(sources);
      return {
        request: { ...sources, method: String(sources.method || 'GET').toUpperCase() },
        warnings: []
      };
    },
    run: prepared => {
      state.calls += 1;
      state.requests.push(prepared);
      return state.runImpl(prepared);
    }
  });

  return {
    controller,
    state,
    input: { collectionId: 'c1', folderId: null, requestId: 'r1', environmentId: 'e1' },
    advance(milliseconds) { state.time += milliseconds; },
    setSources(value) { state.sources = value; },
    setReadError(error) { state.readError = error; },
    setMaterializeError(error) { state.materializeError = error; },
    setRun(run) { state.runImpl = run; },
    setMaterialize(materialize) { state.materializeImpl = materialize; }
  };
}

function prepareApproved(context, input = context.input) {
  const preparation = context.controller.prepare_request(input);
  assert.equal(preparation.state, 'ready_for_review');
  assert.deepEqual(context.controller.approveFromUi(preparation.preparationId), { approved: true });
  return preparation;
}

async function executeFacts(facts) {
  const context = harness();
  context.setRun(() => Promise.resolve(facts));
  const preparation = prepareApproved(context);
  const execution = context.controller.execute_prepared({ preparationId: preparation.preparationId });
  assert.equal(typeof execution.executionId, 'string');
  await flush();
  return {
    context,
    preparation,
    execution,
    summary: context.controller.get_execution({ executionId: execution.executionId })
  };
}

async function executeRejection(error) {
  const context = harness();
  context.setRun(() => Promise.reject(error));
  const preparation = prepareApproved(context);
  const execution = context.controller.execute_prepared({ preparationId: preparation.preparationId });
  assert.equal(typeof execution.executionId, 'string');
  await flush();
  return {
    context,
    preparation,
    execution,
    summary: context.controller.get_execution({ executionId: execution.executionId })
  };
}

test('exports a factory through CommonJS and the StructuredExecution browser global', () => {
  assert.equal(typeof createStructuredExecution, 'function');

  const source = fs.readFileSync(path.join(__dirname, 'wwwroot', 'structured-execution.js'), 'utf8');
  const sandbox = {};
  vm.runInNewContext(source, sandbox);
  assert.equal(typeof sandbox.StructuredExecution, 'object');
  assert.equal(typeof sandbox.StructuredExecution.createStructuredExecution, 'function');
  assert.equal(typeof sandbox.StructuredExecution.prepare_request, 'undefined');
});

test('prepares without effects and returns only the allowlisted preparation facts', () => {
  const context = harness();
  const result = context.controller.prepare_request(context.input);

  assert.deepEqual(Object.keys(result).sort(), [
    'blockers',
    'contractVersion',
    'expiresInSeconds',
    'method',
    'nextAction',
    'preparationId',
    'state',
    'warnings'
  ]);
  assert.equal(result.contractVersion, 1);
  assert.equal(result.state, 'ready_for_review');
  assert.equal(result.expiresInSeconds, 300);
  assert.equal(result.method, 'GET');
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.nextAction, 'review_in_ui');
  assert.equal(context.state.readCalls, 1);
  assert.equal(context.state.materializeCalls, 1);
  assert.equal(context.state.calls, 0);
  assert.equal(JSON.stringify(result).includes('environmentVersion'), false);
});

test('rejects non-strict preparation input before reading sources or invoking getters', () => {
  const cases = [
    ['null', null],
    ['array', []],
    ['missing key', { collectionId: 'c1', folderId: null, requestId: 'r1' }],
    ['extra key', { collectionId: 'c1', folderId: null, requestId: 'r1', environmentId: 'e1', url: 'https://example.test' }],
    ['empty collection id', { collectionId: '', folderId: null, requestId: 'r1', environmentId: 'e1' }],
    ['blank request id', { collectionId: 'c1', folderId: null, requestId: '   ', environmentId: 'e1' }],
    ['long environment id', { collectionId: 'c1', folderId: null, requestId: 'r1', environmentId: 'x'.repeat(257) }],
    ['empty folder id', { collectionId: 'c1', folderId: '', requestId: 'r1', environmentId: 'e1' }],
    ['numeric folder id', { collectionId: 'c1', folderId: 1, requestId: 'r1', environmentId: 'e1' }]
  ];

  for (const [label, input] of cases) {
    const context = harness();
    const result = context.controller.prepare_request(input);
    assert.equal(result.state, 'blocked', label);
    assert.equal(result.preparationId, null, label);
    assert.deepEqual(result.blockers, ['invalid_request'], label);
    assert.equal(result.method, null, label);
    assert.equal(result.expiresInSeconds, 0, label);
    assert.equal(context.state.readCalls, 0, label);
    assert.equal(context.state.materializeCalls, 0, label);
  }

  const inherited = Object.assign(Object.create({ secret: 'inherited' }), {
    collectionId: 'c1', folderId: null, requestId: 'r1', environmentId: 'e1'
  });
  const inheritedContext = harness();
  assert.deepEqual(inheritedContext.controller.prepare_request(inherited).blockers, ['invalid_request']);
  assert.equal(inheritedContext.state.readCalls, 0);

  const withSymbol = { collectionId: 'c1', folderId: null, requestId: 'r1', environmentId: 'e1' };
  withSymbol[Symbol('secret')] = 'value';
  const symbolContext = harness();
  assert.deepEqual(symbolContext.controller.prepare_request(withSymbol).blockers, ['invalid_request']);
  assert.equal(symbolContext.state.readCalls, 0);

  let getterReads = 0;
  const getterInput = { folderId: null, requestId: 'r1', environmentId: 'e1' };
  Object.defineProperty(getterInput, 'collectionId', {
    enumerable: true,
    get() {
      getterReads += 1;
      throw new Error('getter must not run');
    }
  });
  const getterContext = harness();
  assert.deepEqual(getterContext.controller.prepare_request(getterInput).blockers, ['invalid_request']);
  assert.equal(getterReads, 0);
  assert.equal(getterContext.state.readCalls, 0);

  const extraGetter = { ...getterContext.input };
  Object.defineProperty(extraGetter, 'secret', {
    enumerable: true,
    get() {
      getterReads += 1;
      return 'secret';
    }
  });
  const extraContext = harness();
  assert.deepEqual(extraContext.controller.prepare_request(extraGetter).blockers, ['invalid_request']);
  assert.equal(getterReads, 0);
  assert.equal(extraContext.state.readCalls, 0);
});

test('maps typed source failures to fixed blockers without leaking messages or snapshots', () => {
  const codes = [
    'request_not_found',
    'environment_not_found',
    'unresolved_variables',
    'vault_locked',
    'invalid_request',
    'ephemeral_file_unavailable',
    'unsupported_preparation_action'
  ];

  for (const code of codes) {
    const context = harness();
    context.setReadError(codedError(code, 'SENTINEL_SOURCE_ERROR'));
    const result = context.controller.prepare_request(context.input);
    assert.equal(result.state, 'blocked', code);
    assert.equal(result.preparationId, null, code);
    assert.deepEqual(result.blockers, [code], code);
    assert.equal(result.method, null, code);
    assert.equal(context.state.readCalls, 1, code);
    assert.equal(context.state.materializeCalls, 0, code);
    assert.equal(context.state.calls, 0, code);
    assert.equal(JSON.stringify(result).includes('SENTINEL_SOURCE_ERROR'), false, code);
    assert.deepEqual(context.controller.execute_prepared({ preparationId: 'fixture-1' }), { error: 'preparation_not_found' }, code);
  }

  const unknown = harness();
  unknown.setReadError(codedError('secret_error', 'SENTINEL_SOURCE_ERROR'));
  const unknownResult = unknown.controller.prepare_request(unknown.input);
  assert.deepEqual(unknownResult.blockers, ['invalid_request']);
  assert.equal(JSON.stringify(unknownResult).includes('SENTINEL_SOURCE_ERROR'), false);

  const materializeFailure = harness();
  materializeFailure.setMaterializeError(codedError('unsupported_preparation_action', 'SENTINEL_MATERIALIZE_ERROR'));
  const materializeResult = materializeFailure.controller.prepare_request(materializeFailure.input);
  assert.equal(materializeResult.state, 'blocked');
  assert.deepEqual(materializeResult.blockers, ['unsupported_preparation_action']);
  assert.equal(materializeFailure.state.calls, 0);
  assert.equal(JSON.stringify(materializeResult).includes('SENTINEL_MATERIALIZE_ERROR'), false);

  for (const materialized of [null, {}, { request: null }, { request: { method: 'TRACE' } }]) {
    const context = harness();
    context.setMaterialize(() => materialized);
    const result = context.controller.prepare_request(context.input);
    assert.equal(result.state, 'blocked');
    assert.deepEqual(result.blockers, ['invalid_request']);
    assert.equal(context.state.calls, 0);
  }
});

test('keeps non-blocking warnings and normalizes the reviewed method', () => {
  const context = harness();
  context.setMaterialize(() => ({
    request: { method: 'post' },
    warnings: ['write_operation', 'write_operation', 'body_contract', 'WARNING_SECRET_SENTINEL']
  }));
  const result = context.controller.prepare_request(context.input);
  assert.equal(result.state, 'ready_for_review');
  assert.equal(result.method, 'POST');
  assert.deepEqual(result.warnings, ['write_operation']);
  assert.equal(context.state.calls, 0);
});

test('expires exactly at five minutes and invalidates approval with the preparation', () => {
  const beforeBoundary = harness();
  const first = beforeBoundary.controller.prepare_request(beforeBoundary.input);
  assert.deepEqual(beforeBoundary.controller.approveFromUi(first.preparationId), { approved: true });
  beforeBoundary.advance(TTL_MS - 1);
  const execution = beforeBoundary.controller.execute_prepared({ preparationId: first.preparationId });
  assert.equal(typeof execution.executionId, 'string');
  assert.equal(beforeBoundary.state.calls, 1);

  const atBoundary = harness();
  const second = atBoundary.controller.prepare_request(atBoundary.input);
  assert.deepEqual(atBoundary.controller.approveFromUi(second.preparationId), { approved: true });
  atBoundary.advance(TTL_MS);
  assert.deepEqual(atBoundary.controller.execute_prepared({ preparationId: second.preparationId }), { error: 'preparation_expired' });
  assert.equal(atBoundary.state.calls, 0);
  assert.deepEqual(atBoundary.controller.execute_prepared({ preparationId: second.preparationId }), { error: 'preparation_expired' });

  const approveLate = harness();
  const third = approveLate.controller.prepare_request(approveLate.input);
  approveLate.advance(TTL_MS);
  assert.deepEqual(approveLate.controller.approveFromUi(third.preparationId), { error: 'preparation_expired' });
  assert.equal(approveLate.state.calls, 0);
});

test('keeps private snapshots and never mutates or exposes input and sources', async () => {
  const context = harness();
  const originalInput = structuredClone(context.input);
  const originalSources = structuredClone(context.state.sources);

  const preparation = context.controller.prepare_request(context.input);
  assert.deepEqual(context.input, originalInput);
  assert.deepEqual(context.state.sources, originalSources);
  assert.equal(JSON.stringify(preparation).includes('environmentVersion'), false);
  assert.equal(JSON.stringify(preparation).includes('snapshot'), false);

  assert.deepEqual(context.controller.approveFromUi(preparation.preparationId), { approved: true });
  context.input.requestId = 'mutated-after-preparation';
  context.input.extra = 'not-allowed';
  const execution = context.controller.execute_prepared({ preparationId: preparation.preparationId });
  assert.equal(typeof execution.executionId, 'string');
  await flush();
  assert.equal(context.state.calls, 1);
  assert.equal(context.state.requests[0].method, 'GET');
});

test('invalidates after approval when sources are edited, disappear or throw', () => {
  const edited = harness();
  const editedPreparation = prepareApproved(edited);
  edited.setSources({ method: 'POST', environmentVersion: 2 });
  assert.deepEqual(edited.controller.execute_prepared({ preparationId: editedPreparation.preparationId }), { error: 'preparation_invalidated' });
  assert.deepEqual(edited.controller.execute_prepared({ preparationId: editedPreparation.preparationId }), { error: 'preparation_invalidated' });
  assert.equal(edited.state.calls, 0);

  const failedRead = harness();
  const failedPreparation = prepareApproved(failedRead);
  failedRead.setReadError(codedError('vault_locked', 'SENTINEL_LATE_READ'));
  assert.deepEqual(failedRead.controller.execute_prepared({ preparationId: failedPreparation.preparationId }), { error: 'preparation_invalidated' });
  assert.equal(failedRead.state.calls, 0);

  const changedShape = harness({ sources: { method: 'GET', nested: { a: 1, b: [2, 3] } } });
  const shapePreparation = prepareApproved(changedShape);
  changedShape.setSources({ method: 'GET', nested: { a: 1, b: [3, 2] } });
  assert.deepEqual(changedShape.controller.execute_prepared({ preparationId: shapePreparation.preparationId }), { error: 'preparation_invalidated' });
  assert.equal(changedShape.state.calls, 0);
});

test('compares revalidated sources deterministically regardless of object key order', async () => {
  const context = harness({ sources: { method: 'GET', environmentVersion: 1, nested: { b: 2, a: 1 } } });
  const preparation = prepareApproved(context);
  context.setSources({ nested: { a: 1, b: 2 }, environmentVersion: 1, method: 'GET' });
  const execution = context.controller.execute_prepared({ preparationId: preparation.preparationId });
  assert.equal(typeof execution.executionId, 'string');
  await flush();
  assert.equal(context.state.calls, 1);
});

test('requires explicit approval and does not transfer approval between preparations', async () => {
  const context = harness();
  const first = context.controller.prepare_request(context.input);
  assert.deepEqual(context.controller.execute_prepared({ preparationId: first.preparationId }), { error: 'approval_required' });
  assert.equal(context.state.calls, 0);

  const second = context.controller.prepare_request({ ...context.input, requestId: 'r2' });
  assert.notEqual(first.preparationId, second.preparationId);
  assert.deepEqual(context.controller.execute_prepared({ preparationId: first.preparationId }), { error: 'preparation_invalidated' });
  assert.deepEqual(context.controller.approveFromUi(second.preparationId), { approved: true });
  assert.equal(context.state.calls, 0);

  const execution = context.controller.execute_prepared({ preparationId: second.preparationId });
  assert.equal(typeof execution.executionId, 'string');
  await flush();
  assert.equal(context.state.calls, 1);
});

test('cancels before sending and cannot cancel or replay a consumed execution', async () => {
  const cancelled = harness();
  const preparation = prepareApproved(cancelled);
  assert.deepEqual(cancelled.controller.cancelFromUi(preparation.preparationId), { cancelled: true });
  assert.deepEqual(cancelled.controller.execute_prepared({ preparationId: preparation.preparationId }), { error: 'preparation_cancelled' });
  assert.equal(cancelled.state.calls, 0);
  assert.deepEqual(cancelled.controller.cancelFromUi('missing-preparation'), { error: 'preparation_not_found' });

  let resolveRun;
  const running = harness();
  running.setRun(() => new Promise(resolve => { resolveRun = resolve; }));
  const runningPreparation = prepareApproved(running);
  const execution = running.controller.execute_prepared({ preparationId: runningPreparation.preparationId });
  assert.equal(running.state.calls, 1);
  assert.deepEqual(running.controller.cancelFromUi(runningPreparation.preparationId), { error: 'preparation_consumed' });
  assert.equal(running.controller.get_execution({ executionId: execution.executionId }).state, 'running');
  resolveRun(defaultFacts());
  await flush();
});

test('coalesces concurrent execution attempts and returns safe running and final copies', async () => {
  let resolveRun;
  const context = harness();
  context.setRun(() => new Promise(resolve => { resolveRun = resolve; }));
  const preparation = prepareApproved(context);

  const first = context.controller.execute_prepared({ preparationId: preparation.preparationId });
  const second = context.controller.execute_prepared({ preparationId: preparation.preparationId });
  assert.deepEqual(second, first);
  assert.equal(context.state.calls, 1);

  const running = context.controller.get_execution({ executionId: first.executionId });
  assert.equal(running.state, 'running');
  assert.equal(running.outcome, null);
  assert.equal(running.assertions, null);
  running.state = 'completed';
  assert.equal(context.controller.get_execution({ executionId: first.executionId }).state, 'running');

  resolveRun(defaultFacts());
  await flush();

  const final = context.controller.get_execution({ executionId: first.executionId });
  assert.equal(final.state, 'completed');
  assert.equal(final.outcome, 'success');
  final.assertions.passed = 99;
  assert.equal(context.controller.get_execution({ executionId: first.executionId }).assertions.passed, 0);
  assert.deepEqual(context.controller.execute_prepared({ preparationId: preparation.preparationId }), first);
  assert.equal(context.state.calls, 1);
});

test('allows only one active execution while a different preparation waits', async () => {
  let resolveRun;
  const context = harness();
  context.setRun(() => new Promise(resolve => { resolveRun = resolve; }));
  const firstPreparation = prepareApproved(context);
  const first = context.controller.execute_prepared({ preparationId: firstPreparation.preparationId });
  assert.equal(typeof first.executionId, 'string');

  const secondPreparation = context.controller.prepare_request({ ...context.input, requestId: 'r2' });
  assert.equal(secondPreparation.state, 'ready_for_review');
  assert.deepEqual(context.controller.approveFromUi(secondPreparation.preparationId), { approved: true });
  assert.deepEqual(context.controller.execute_prepared({ preparationId: secondPreparation.preparationId }), { error: 'execution_in_progress' });
  assert.equal(context.state.calls, 1);
  assert.equal(context.controller.get_execution({ executionId: first.executionId }).state, 'running');

  resolveRun(defaultFacts());
  await flush();
  const second = context.controller.execute_prepared({ preparationId: secondPreparation.preparationId });
  assert.equal(typeof second.executionId, 'string');
  assert.notEqual(second.executionId, first.executionId);
  assert.equal(context.state.calls, 2);
  await flush();
});

test('rejects non-strict execution and lookup inputs with fixed error codes', () => {
  const context = harness();
  for (const value of [null, {}, { preparationId: 'x', extra: true }, { preparationId: '' }, { preparationId: 1 }, { executionId: 'x' }]) {
    assert.deepEqual(context.controller.execute_prepared(value), { error: 'invalid_request' });
  }
  for (const value of [null, {}, { executionId: 'x', extra: true }, { executionId: '' }, { executionId: 1 }, { preparationId: 'x' }]) {
    assert.deepEqual(context.controller.get_execution(value), { error: 'invalid_request' });
  }
  assert.deepEqual(context.controller.get_execution({ executionId: 'missing-execution' }), { error: 'execution_not_found' });
  assert.deepEqual(context.controller.execute_prepared({ preparationId: 'missing-preparation' }), { error: 'preparation_not_found' });
  assert.deepEqual(context.controller.approveFromUi(''), { error: 'invalid_request' });
  assert.deepEqual(context.controller.approveFromUi('missing-preparation'), { error: 'preparation_not_found' });
  assert.deepEqual(context.controller.cancelFromUi(''), { error: 'invalid_request' });
});

test('classifies destination HTTP, assertions, partial contracts and local effects by table', async () => {
  const green = await executeFacts(defaultFacts());
  assert.equal(green.summary.state, 'completed');
  assert.equal(green.summary.outcome, 'success');
  assert.equal(green.summary.delivery, 'response_received');
  assert.equal(green.summary.httpStatus, 200);
  assert.equal(green.summary.proxyStatus, 200);
  assert.equal(green.summary.durationMs, 1);

  const proxySeparate = await executeFacts(defaultFacts({ proxyStatus: 502 }));
  assert.equal(proxySeparate.summary.httpStatus, 200);
  assert.equal(proxySeparate.summary.proxyStatus, 502);
  assert.equal(proxySeparate.summary.outcome, 'success');

  const http422 = await executeFacts(defaultFacts({ httpStatus: 422 }));
  assert.equal(http422.summary.outcome, 'http_error');
  assert.equal(http422.summary.httpStatus, 422);

  const failedAssertion = await executeFacts(defaultFacts({ assertions: { passed: 2, failed: 1, partial: 0 } }));
  assert.equal(failedAssertion.summary.outcome, 'assertion_failed');
  assert.deepEqual(failedAssertion.summary.assertions, { passed: 2, failed: 1, partial: 0 });

  const partial = await executeFacts(defaultFacts({ assertions: { passed: 1, failed: 0, partial: 2 } }));
  assert.equal(partial.summary.outcome, 'success');
  assert.deepEqual(partial.summary.assertions, { passed: 1, failed: 0, partial: 2 });

  const notSent = await executeFacts({
    delivery: 'not_sent', httpStatus: null, proxyStatus: null, durationMs: 0,
    assertions: { passed: 0, failed: 0, partial: 0 }, capture: 'not_requested', persistence: 'not_requested'
  });
  assert.equal(notSent.summary.outcome, 'transport_error');
  assert.equal(notSent.summary.delivery, 'not_sent');
  assert.equal(notSent.summary.httpStatus, null);

  const unknownDelivery = await executeFacts({
    delivery: 'unknown', httpStatus: null, proxyStatus: 502, durationMs: 0,
    assertions: { passed: 0, failed: 0, partial: 0 }
  });
  assert.equal(unknownDelivery.summary.outcome, 'transport_error');
  assert.equal(unknownDelivery.summary.delivery, 'unknown');
  assert.equal(unknownDelivery.summary.httpStatus, null);
  assert.equal(unknownDelivery.summary.proxyStatus, 502);

  const localBeforeTransport = await executeFacts({
    delivery: 'not_sent', httpStatus: null, proxyStatus: null, durationMs: 0,
    assertions: { passed: 0, failed: 0, partial: 0 }, failureStage: 'local'
  });
  assert.equal(localBeforeTransport.summary.outcome, 'local_error');
  assert.equal(localBeforeTransport.summary.delivery, 'not_sent');

  const postResponseEffects = await executeFacts(defaultFacts({ capture: 'failed', persistence: 'failed' }));
  assert.equal(postResponseEffects.summary.outcome, 'success');
  assert.equal(postResponseEffects.summary.delivery, 'response_received');
  assert.equal(postResponseEffects.summary.capture, 'failed');
  assert.equal(postResponseEffects.summary.persistence, 'failed');

  const invalidStatus = await executeFacts(defaultFacts({ httpStatus: '200' }));
  assert.equal(invalidStatus.summary.outcome, 'unknown');
  assert.equal(invalidStatus.summary.httpStatus, null);
  assert.equal(invalidStatus.summary.delivery, 'response_received');

  const missingStatus = await executeFacts(defaultFacts({ httpStatus: null }));
  assert.equal(missingStatus.summary.outcome, 'unknown');
  assert.equal(missingStatus.summary.httpStatus, null);

  const invalidEnum = await executeFacts(defaultFacts({ capture: 'SENTINEL_CAPTURE', persistence: 'SENTINEL_PERSISTENCE' }));
  assert.equal(invalidEnum.summary.capture, 'skipped');
  assert.equal(invalidEnum.summary.persistence, 'failed');
  assert.equal(invalidEnum.summary.outcome, 'unknown');
  assert.equal(JSON.stringify(invalidEnum.summary).includes('SENTINEL'), false);
});

test('classifies rejections and timeouts as unknown transport without retrying', async () => {
  const localError = new Error('SENTINEL_LOCAL_MESSAGE');
  localError.stage = 'local';
  const local = await executeRejection(localError);
  assert.equal(local.summary.state, 'completed');
  assert.equal(local.summary.outcome, 'local_error');
  assert.equal(local.summary.delivery, 'unknown');
  assert.equal(local.summary.httpStatus, null);
  assert.equal(JSON.stringify(local.summary).includes('SENTINEL_LOCAL_MESSAGE'), false);

  const transportError = new Error('SENTINEL_TRANSPORT_MESSAGE');
  transportError.stage = 'transport';
  const transport = await executeRejection(transportError);
  assert.equal(transport.summary.state, 'completed');
  assert.equal(transport.summary.outcome, 'transport_error');
  assert.equal(transport.summary.delivery, 'unknown');
  assert.equal(JSON.stringify(transport.summary).includes('SENTINEL_TRANSPORT_MESSAGE'), false);

  const timeoutError = new Error('SENTINEL_TIMEOUT_MESSAGE');
  timeoutError.name = 'TimeoutError';
  const timeout = await executeRejection(timeoutError);
  assert.equal(timeout.summary.state, 'completed');
  assert.equal(timeout.summary.outcome, 'transport_error');
  assert.equal(timeout.summary.delivery, 'unknown');

  const postResponseError = new Error('SENTINEL_POST_RESPONSE_MESSAGE');
  postResponseError.delivery = 'response_received';
  postResponseError.httpStatus = 200;
  postResponseError.capture = 'failed';
  postResponseError.persistence = 'failed';
  const postResponse = await executeRejection(postResponseError);
  assert.equal(postResponse.summary.state, 'completed');
  assert.equal(postResponse.summary.outcome, 'success');
  assert.equal(postResponse.summary.delivery, 'response_received');
  assert.equal(postResponse.summary.httpStatus, 200);
  assert.equal(postResponse.summary.capture, 'failed');
  assert.equal(postResponse.summary.persistence, 'failed');
  assert.equal(JSON.stringify(postResponse.summary).includes('SENTINEL_POST_RESPONSE_MESSAGE'), false);

  const opaqueError = new Error('SENTINEL_OPAQUE_MESSAGE');
  const opaque = await executeRejection(opaqueError);
  assert.equal(opaque.summary.state, 'unknown');
  assert.equal(opaque.summary.outcome, 'unknown');
  assert.equal(opaque.summary.delivery, 'unknown');
  assert.equal(opaque.summary.httpStatus, null);
  assert.equal(opaque.context.state.calls, 1);
  assert.deepEqual(
    opaque.context.controller.execute_prepared({ preparationId: opaque.preparation.preparationId }),
    { executionId: opaque.execution.executionId }
  );
  assert.equal(opaque.context.state.calls, 1);
  assert.equal(JSON.stringify(opaque.summary).includes('SENTINEL_OPAQUE_MESSAGE'), false);
});

test('local post-response errors preserve delivery and destination status', async () => {
  const error = Object.assign(new Error('PRIVATE_SENTINEL'), { stage: 'local', delivery: 'response_received', httpStatus: 201, persistence: 'failed' });
  const result = await executeRejection(error);
  assert.equal(result.summary.outcome, 'local_error');
  assert.equal(result.summary.delivery, 'response_received');
  assert.equal(result.summary.httpStatus, 201);
  assert.equal(result.summary.persistence, 'failed');
  const early = await executeFacts(defaultFacts({ delivery: 'not_sent', httpStatus: null, outcome: 'local_error' }));
  assert.equal(early.summary.outcome, 'local_error');
});

test('handles a synchronous run failure and still exposes an execution id', async () => {
  const context = harness();
  context.setRun(() => {
    const error = new Error('SENTINEL_SYNC_MESSAGE');
    error.stage = 'local';
    throw error;
  });
  const preparation = prepareApproved(context);
  const execution = context.controller.execute_prepared({ preparationId: preparation.preparationId });
  assert.equal(typeof execution.executionId, 'string');
  assert.equal(context.state.calls, 1);
  assert.equal(context.controller.get_execution({ executionId: execution.executionId }).state, 'running');
  await flush();
  const summary = context.controller.get_execution({ executionId: execution.executionId });
  assert.equal(summary.state, 'completed');
  assert.equal(summary.outcome, 'local_error');
  assert.equal(JSON.stringify(summary).includes('SENTINEL_SYNC_MESSAGE'), false);
});

test('keeps error facts separate from destination status and preserves evidence after transport', async () => {
  const error = new Error('SENTINEL_AFTER_TRANSPORT');
  error.stage = 'transport';
  error.delivery = 'response_received';
  error.httpStatus = 500;
  error.proxyStatus = 200;
  const result = await executeRejection(error);
  assert.equal(result.summary.state, 'completed');
  assert.equal(result.summary.outcome, 'transport_error');
  assert.equal(result.summary.delivery, 'response_received');
  assert.equal(result.summary.httpStatus, 500);
  assert.equal(result.summary.proxyStatus, 200);
  assert.equal(JSON.stringify(result.summary).includes('SENTINEL_AFTER_TRANSPORT'), false);
});

test('materializes dynamic values once and reuses the frozen request', async () => {
  let dynamic = 0;
  const context = harness();
  context.setMaterialize(sources => ({
    request: { method: sources.method, token: `dynamic-${++dynamic}` },
    warnings: []
  }));
  const preparation = context.controller.prepare_request(context.input);
  assert.deepEqual(context.controller.approveFromUi(preparation.preparationId), { approved: true });
  assert.equal(context.state.materializeCalls, 1);

  const execution = context.controller.execute_prepared({ preparationId: preparation.preparationId });
  assert.equal(typeof execution.executionId, 'string');
  await flush();
  assert.equal(context.state.materializeCalls, 1);
  assert.equal(dynamic, 1);
  assert.equal(context.state.requests[0].token, 'dynamic-1');
});

test('retains twenty terminal summaries and evicts only the oldest terminal one', async () => {
  const context = harness();
  const executionIds = [];

  for (let index = 0; index < 21; index += 1) {
    const preparation = context.controller.prepare_request({ ...context.input, requestId: `r${index}` });
    assert.equal(preparation.state, 'ready_for_review');
    assert.deepEqual(context.controller.approveFromUi(preparation.preparationId), { approved: true });
    const execution = context.controller.execute_prepared({ preparationId: preparation.preparationId });
    assert.equal(typeof execution.executionId, 'string');
    executionIds.push(execution.executionId);
    await flush();
  }

  assert.equal(context.state.calls, 21);
  assert.deepEqual(context.controller.get_execution({ executionId: executionIds[0] }), { error: 'execution_not_found' });
  for (const executionId of executionIds.slice(1)) {
    assert.equal(context.controller.get_execution({ executionId }).state, 'completed');
  }
});

test('never evicts a running execution while compacting finished summaries', async () => {
  let resolveActive;
  const context = harness();
  const finishedIds = [];

  for (let index = 0; index < 20; index += 1) {
    const preparation = context.controller.prepare_request({ ...context.input, requestId: `finished-${index}` });
    context.controller.approveFromUi(preparation.preparationId);
    const execution = context.controller.execute_prepared({ preparationId: preparation.preparationId });
    finishedIds.push(execution.executionId);
    await flush();
  }

  context.setRun(() => new Promise(resolve => { resolveActive = resolve; }));
  const activePreparation = context.controller.prepare_request({ ...context.input, requestId: 'active' });
  context.controller.approveFromUi(activePreparation.preparationId);
  const active = context.controller.execute_prepared({ preparationId: activePreparation.preparationId });
  assert.equal(context.controller.get_execution({ executionId: active.executionId }).state, 'running');

  resolveActive(defaultFacts());
  await flush();

  assert.deepEqual(context.controller.get_execution({ executionId: finishedIds[0] }), { error: 'execution_not_found' });
  assert.equal(context.controller.get_execution({ executionId: active.executionId }).state, 'completed');
  for (const executionId of finishedIds.slice(1)) {
    assert.equal(context.controller.get_execution({ executionId }).state, 'completed');
  }
});

test('dispose clears preparations and summaries without cancelling or repeating the run', async () => {
  let resolveRun;
  const context = harness();
  context.setRun(() => new Promise(resolve => { resolveRun = resolve; }));
  const preparation = prepareApproved(context);
  const execution = context.controller.execute_prepared({ preparationId: preparation.preparationId });
  assert.equal(context.state.calls, 1);

  context.controller.dispose();
  assert.deepEqual(context.controller.get_execution({ executionId: execution.executionId }), { error: 'execution_not_found' });
  assert.deepEqual(context.controller.execute_prepared({ preparationId: preparation.preparationId }), { error: 'preparation_not_found' });
  assert.deepEqual(context.controller.approveFromUi(preparation.preparationId), { error: 'preparation_not_found' });
  assert.deepEqual(context.controller.cancelFromUi(preparation.preparationId), { error: 'preparation_not_found' });

  resolveRun(defaultFacts());
  await flush();
  assert.equal(context.state.calls, 1);
  assert.deepEqual(context.controller.get_execution({ executionId: execution.executionId }), { error: 'execution_not_found' });
});

test('dispose also drops an unapproved snapshot and permits a clean new preparation', () => {
  const context = harness();
  const preparation = context.controller.prepare_request(context.input);
  context.controller.dispose();
  assert.deepEqual(context.controller.approveFromUi(preparation.preparationId), { error: 'preparation_not_found' });
  assert.deepEqual(context.controller.execute_prepared({ preparationId: preparation.preparationId }), { error: 'preparation_not_found' });

  const replacement = context.controller.prepare_request({ ...context.input, requestId: 'r2' });
  assert.equal(replacement.state, 'ready_for_review');
  assert.notEqual(replacement.preparationId, preparation.preparationId);
});

test('never exposes URL, query, Auth, environment, body, error, variable or assertion sentinels', async () => {
  const sentinels = {
    url: 'SENTINEL_URL_7f3a',
    query: 'SENTINEL_QUERY_7f3a',
    auth: 'SENTINEL_AUTH_7f3a',
    environment: 'SENTINEL_ENVIRONMENT_7f3a',
    body: 'SENTINEL_BODY_7f3a',
    error: 'SENTINEL_ERROR_7f3a',
    variable: 'SENTINEL_VARIABLE_7f3a',
    assertion: 'SENTINEL_ASSERTION_7f3a'
  };

  const sources = {
    method: 'POST',
    url: `https://api.example.test/${sentinels.url}?${sentinels.query}`,
    query: { value: sentinels.query },
    environment: { name: sentinels.environment },
    auth: { bearerToken: sentinels.auth },
    body: { value: sentinels.body },
    variables: { [sentinels.variable]: sentinels.query },
    assertions: [{ name: 'status', expected: sentinels.assertion }]
  };

  const context = harness({ sources });
  context.setMaterialize(source => ({ request: { ...source, method: 'POST' }, warnings: [] }));
  context.setRun(() => Promise.resolve({
    ...defaultFacts(),
    url: sentinels.url,
    query: sentinels.query,
    auth: sentinels.auth,
    environment: sentinels.environment,
    body: sentinels.body,
    error: sentinels.error,
    headers: { authorization: sentinels.auth },
    variables: { [sentinels.variable]: sentinels.query },
    assertions: {
      passed: 0,
      failed: 0,
      partial: 0,
      values: [sentinels.assertion],
      names: [sentinels.variable]
    }
  }));

  const outputs = [];
  const preparation = context.controller.prepare_request(context.input);
  outputs.push(preparation);
  outputs.push(context.controller.execute_prepared({ preparationId: preparation.preparationId }));
  outputs.push(context.controller.approveFromUi(preparation.preparationId));
  const execution = context.controller.execute_prepared({ preparationId: preparation.preparationId });
  outputs.push(execution);
  outputs.push(context.controller.get_execution({ executionId: execution.executionId }));
  await flush();
  outputs.push(context.controller.get_execution({ executionId: execution.executionId }));
  outputs.push(context.controller.get_execution({ executionId: 'missing' }));
  outputs.push(context.controller.execute_prepared({ preparationId: 'missing' }));
  outputs.push(context.controller.execute_prepared({ ...context.input, url: sentinels.url }));
  outputs.push(context.controller.approveFromUi('missing'));
  outputs.push(context.controller.cancelFromUi('missing'));

  const blocked = harness();
  blocked.setReadError(codedError('vault_locked', sentinels.error));
  outputs.push(blocked.controller.prepare_request(blocked.input));

  const rejected = harness();
  rejected.setRun(() => Promise.reject(new Error(sentinels.error)));
  const rejectedPreparation = rejected.controller.prepare_request(rejected.input);
  rejected.controller.approveFromUi(rejectedPreparation.preparationId);
  const rejectedExecution = rejected.controller.execute_prepared({ preparationId: rejectedPreparation.preparationId });
  outputs.push(rejectedExecution);
  await flush();
  outputs.push(rejected.controller.get_execution({ executionId: rejectedExecution.executionId }));

  const serialized = JSON.stringify(outputs);
  for (const [name, sentinel] of Object.entries(sentinels)) {
    assert.equal(serialized.includes(sentinel), false, `${name} sentinel leaked`);
  }
});
