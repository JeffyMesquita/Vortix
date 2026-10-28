(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VortixDiagnostics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DIAGNOSTIC_VERSION = 1;
  const FRESHNESS_MS = 2000;
  const MAX_SUMMARY_BYTES = 512;
  const MAX_RESULT_BYTES = 2048;
  const MAX_BLOCKERS_BYTES = 4096;
  const MAX_RECORD_BYTES = 4096;

  const NO_VALUE = Symbol('no_value');
  const INVALID = Symbol('invalid');
  const encoder = new TextEncoder();

  const CONTROL_NAMES = [
    'request.save',
    'environment.manage',
    'settings.open',
    'execution.prepare',
    'execution.review',
    'execution.execute'
  ];
  const CONTROL_SET = new Set(CONTROL_NAMES);

  const STATES = new Set([
    'unavailable',
    'idle',
    'blocked',
    'ready_for_review',
    'approved',
    'running',
    'completed',
    'unknown'
  ]);

  const VIEWS = new Set(['summary', 'blockers', 'result']);
  const OUTCOMES = new Set(['success', 'http_error', 'assertion_failed', 'transport_error', 'local_error', 'unknown']);
  const DELIVERIES = new Set(['not_sent', 'response_received', 'unknown']);
  const VALIDATIONS = new Set(['not_run', 'passed', 'failed', 'partial']);
  const CAPTURES = new Set(['not_requested', 'completed', 'failed', 'skipped']);
  const PERSISTENCES = new Set(['not_requested', 'completed', 'failed']);

  const BLOCKER_ORDER = [
    'context_changed',
    'diagnostic_unavailable',
    'diagnostic_stale',
    'execution_in_progress',
    'request_not_saved',
    'unsaved_changes',
    'request_not_found',
    'environment_not_found',
    'unresolved_variables',
    'vault_locked',
    'invalid_request',
    'ephemeral_file_unavailable',
    'unsupported_preparation_action',
    'write_confirmation_required',
    'preparation_expired',
    'preparation_invalidated',
    'preparation_cancelled'
  ];

  const BLOCKER_DEFINITIONS = {
    request_not_saved: { code: 'request_not_saved', target: { kind: 'action', name: 'request.save' } },
    unsaved_changes: { code: 'unsaved_changes', target: { kind: 'action', name: 'request.save' } },
    request_not_found: { code: 'request_not_found', target: { kind: 'region', name: 'collections' } },
    environment_not_found: { code: 'environment_not_found', target: { kind: 'action', name: 'environment.manage' } },
    unresolved_variables: { code: 'unresolved_variables', target: { kind: 'action', name: 'environment.manage' } },
    vault_locked: { code: 'vault_locked', target: { kind: 'action', name: 'settings.open' } },
    invalid_request: { code: 'invalid_request', target: { kind: 'region', name: 'request-editor' } },
    ephemeral_file_unavailable: { code: 'ephemeral_file_unavailable', target: { kind: 'region', name: 'request-editor' } },
    unsupported_preparation_action: { code: 'unsupported_preparation_action', target: { kind: 'region', name: 'request-editor' } },
    write_confirmation_required: { code: 'write_confirmation_required', target: { kind: 'region', name: 'structured-execution' } },
    preparation_expired: { code: 'preparation_expired', target: { kind: 'action', name: 'execution.prepare' } },
    preparation_invalidated: { code: 'preparation_invalidated', target: { kind: 'action', name: 'execution.prepare' } },
    preparation_cancelled: { code: 'preparation_cancelled', target: { kind: 'action', name: 'execution.prepare' } },
    execution_in_progress: { code: 'execution_in_progress', target: { kind: 'region', name: 'structured-execution' } },
    context_changed: { code: 'context_changed', target: { kind: 'region', name: 'request-workspace' } },
    diagnostic_unavailable: { code: 'diagnostic_unavailable', target: { kind: 'region', name: 'structured-execution' } },
    diagnostic_stale: { code: 'diagnostic_stale', target: { kind: 'region', name: 'structured-execution' } }
  };

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
  const SEMANTIC_KEYS = [
    'diagnosticVersion',
    'contextMatches',
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
  const ASSERTION_KEYS = ['passed', 'failed', 'partial'];

  function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function ownDataValue(object, key) {
    if (!isPlainObject(object)) return NO_VALUE;
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) return NO_VALUE;
    return descriptor.value;
  }

  function arrayDataValues(value) {
    if (!Array.isArray(value)) return null;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (!lengthDescriptor || !('value' in lengthDescriptor)) return null;
    const length = lengthDescriptor.value;
    if (!Number.isSafeInteger(length) || length < 0) return null;
    const values = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) return null;
      values.push(descriptor.value);
    }
    return values;
  }

  function safeDataTree(value, depth = 0, seen = new WeakSet()) {
    if (value === null || typeof value !== 'object') return true;
    if (depth > 6 || seen.has(value)) return false;
    seen.add(value);
    if (Array.isArray(value)) {
      const values = arrayDataValues(value);
      if (values === null) return false;
      return values.every(entry => safeDataTree(entry, depth + 1, seen));
    }
    if (!isPlainObject(value)) return false;
    if (Object.getOwnPropertySymbols(value).length !== 0) return false;
    for (const name of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (!descriptor || !('value' in descriptor)) return false;
      if (!safeDataTree(descriptor.value, depth + 1, seen)) return false;
    }
    return true;
  }

  function hasExactKeys(object, keys) {
    if (!isPlainObject(object)) return false;
    if (Object.getOwnPropertySymbols(object).length !== 0) return false;
    const names = Object.getOwnPropertyNames(object);
    if (names.length !== keys.length) return false;
    return keys.every(key => Object.hasOwn(object, key));
  }

  function isSafeCount(value) {
    return Number.isSafeInteger(value) && value >= 0;
  }

  function isClock(value) {
    return typeof value === 'number'
      && Number.isFinite(value)
      && value >= 0
      && value <= Number.MAX_SAFE_INTEGER;
  }

  function isHttpStatus(value) {
    return value === null || (Number.isInteger(value) && value >= 100 && value <= 599);
  }

  function isDuration(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
  }

  function byteLength(value) {
    return encoder.encode(typeof value === 'string' ? value : JSON.stringify(value)).length;
  }

  function copyTarget(target) {
    return { kind: target.kind, name: target.name };
  }

  function copyDefinition(definition) {
    return { code: definition.code, target: copyTarget(definition.target) };
  }

  function blockerDefinition(code) {
    const definition = typeof code === 'string' && Object.hasOwn(BLOCKER_DEFINITIONS, code)
      ? BLOCKER_DEFINITIONS[code]
      : BLOCKER_DEFINITIONS.diagnostic_unavailable;
    return copyDefinition(definition);
  }

  function deriveValidation(assertions) {
    if (assertions.failed > 0) return 'failed';
    if (assertions.partial > 0) return 'partial';
    if (assertions.passed > 0) return 'passed';
    return 'not_run';
  }

  function normalizeControls(value) {
    const normalized = {};
    for (const name of CONTROL_NAMES) normalized[name] = ownDataValue(value, name) === true;
    return normalized;
  }

  function normalizeBlockers(value) {
    const codes = arrayDataValues(value);
    if (codes === null) return null;
    const unique = new Set();
    for (const code of codes) {
      if (typeof code === 'string' && Object.hasOwn(BLOCKER_DEFINITIONS, code)) unique.add(code);
    }
    return Array.from(unique)
      .sort((first, second) => BLOCKER_ORDER.indexOf(first) - BLOCKER_ORDER.indexOf(second))
      .map(code => copyDefinition(BLOCKER_DEFINITIONS[code]));
  }

  function selectResult(value, state) {
    if (value === null) return null;
    if (state !== 'completed' && state !== 'unknown') return null;
    if (!isPlainObject(value)) return INVALID;
    const outcome = ownDataValue(value, 'outcome');
    const delivery = ownDataValue(value, 'delivery');
    const httpStatus = ownDataValue(value, 'httpStatus');
    const proxyStatus = ownDataValue(value, 'proxyStatus');
    const durationMs = ownDataValue(value, 'durationMs');
    const assertions = ownDataValue(value, 'assertions');
    const capture = ownDataValue(value, 'capture');
    const persistence = ownDataValue(value, 'persistence');
    if (!OUTCOMES.has(outcome)) return INVALID;
    if (!DELIVERIES.has(delivery)) return INVALID;
    if (!isHttpStatus(httpStatus)) return INVALID;
    if (!isHttpStatus(proxyStatus)) return INVALID;
    if (!isDuration(durationMs)) return INVALID;
    if (!isPlainObject(assertions)) return INVALID;
    const passed = ownDataValue(assertions, 'passed');
    const failed = ownDataValue(assertions, 'failed');
    const partial = ownDataValue(assertions, 'partial');
    if (!isSafeCount(passed) || !isSafeCount(failed) || !isSafeCount(partial)) return INVALID;
    if (!CAPTURES.has(capture)) return INVALID;
    if (!PERSISTENCES.has(persistence)) return INVALID;
    const counts = { passed, failed, partial };
    return {
      outcome,
      delivery,
      httpStatus,
      proxyStatus,
      durationMs,
      assertions: counts,
      validation: deriveValidation(counts),
      capture,
      persistence
    };
  }

  function actionFor(state, blockers, controlsValue) {
    if (state === 'ready_for_review') return controlsValue['execution.review'] ? 'execution.review' : null;
    if (state === 'approved') return controlsValue['execution.execute'] ? 'execution.execute' : null;
    const primary = blockers[0];
    if (!primary || primary.target.kind !== 'action') return null;
    return controlsValue[primary.target.name] ? primary.target.name : null;
  }

  function semanticKey(record) {
    return JSON.stringify(SEMANTIC_KEYS.map(key => record[key]));
  }

  function withRevision(record, previousRecord) {
    let revision = 1;
    if (safeDataTree(previousRecord) && validRecord(previousRecord)) {
      revision = semanticKey(previousRecord) === semanticKey(record)
        ? previousRecord.revision
        : Math.min(Number.MAX_SAFE_INTEGER, previousRecord.revision + 1);
    }
    record.revision = revision;
    return record;
  }

  function unavailableRecord(observedAtMs) {
    return {
      diagnosticVersion: DIAGNOSTIC_VERSION,
      revision: 0,
      contextMatches: false,
      observedAtMs,
      validUntilMs: null,
      state: 'unavailable',
      blocker: 'diagnostic_unavailable',
      nextAction: null,
      blockers: [copyDefinition(BLOCKER_DEFINITIONS.diagnostic_unavailable)],
      result: null
    };
  }

  function buildRecord(facts, previousRecord, nowMs) {
    const observedAtMs = isClock(nowMs) ? nowMs : 0;
    if (!isPlainObject(facts) || !isClock(nowMs)) {
      return withRevision(unavailableRecord(observedAtMs), previousRecord);
    }

    const state = ownDataValue(facts, 'state');
    if (!STATES.has(state)) return withRevision(unavailableRecord(observedAtMs), previousRecord);

    const contextMatches = ownDataValue(facts, 'contextMatches');
    if (typeof contextMatches !== 'boolean') {
      return withRevision(unavailableRecord(observedAtMs), previousRecord);
    }

    if (state === 'unavailable') return withRevision(unavailableRecord(observedAtMs), previousRecord);

    const blockers = normalizeBlockers(ownDataValue(facts, 'blockers'));
    if (blockers === null) return withRevision(unavailableRecord(observedAtMs), previousRecord);

    const controlsValue = normalizeControls(ownDataValue(facts, 'controls'));
    const selectedResult = selectResult(ownDataValue(facts, 'result'), state);
    if (selectedResult === INVALID) return withRevision(unavailableRecord(observedAtMs), previousRecord);

    const deadlineValue = ownDataValue(facts, 'validUntilMs');
    let deadline = null;
    if (state === 'ready_for_review' || state === 'approved') {
      if (!isClock(deadlineValue) || deadlineValue <= observedAtMs) {
        return withRevision(unavailableRecord(observedAtMs), previousRecord);
      }
      deadline = deadlineValue;
    } else if (deadlineValue !== null) {
      return withRevision(unavailableRecord(observedAtMs), previousRecord);
    }

    const nextAction = actionFor(state, blockers, controlsValue);
    const record = {
      diagnosticVersion: DIAGNOSTIC_VERSION,
      revision: 0,
      contextMatches,
      observedAtMs,
      validUntilMs: deadline,
      state,
      blocker: blockers.length ? blockers[0].code : null,
      nextAction,
      blockers,
      result: selectedResult
    };

    if (!contextMatches) {
      record.state = 'unknown';
      record.validUntilMs = null;
      record.blocker = 'context_changed';
      record.nextAction = null;
      record.blockers = [copyDefinition(BLOCKER_DEFINITIONS.context_changed)];
      record.result = null;
    }

    const finalized = withRevision(record, previousRecord);
    if (byteLength(finalized) <= MAX_RECORD_BYTES) return finalized;
    return withRevision(unavailableRecord(observedAtMs), previousRecord);
  }

  function sameTarget(actual, expected) {
    return hasExactKeys(actual, ['kind', 'name'])
      && actual.kind === expected.kind
      && actual.name === expected.name;
  }

  function validBlockers(blockers) {
    const entries = arrayDataValues(blockers);
    if (entries === null) return false;
    let previousPriority = -1;
    const seen = new Set();
    for (const entry of entries) {
      if (!hasExactKeys(entry, ['code', 'target'])) return false;
      if (typeof entry.code !== 'string' || !Object.hasOwn(BLOCKER_DEFINITIONS, entry.code)) return false;
      if (seen.has(entry.code)) return false;
      seen.add(entry.code);
      if (!sameTarget(entry.target, BLOCKER_DEFINITIONS[entry.code].target)) return false;
      const priority = BLOCKER_ORDER.indexOf(entry.code);
      if (priority <= previousPriority) return false;
      previousPriority = priority;
    }
    return true;
  }

  function validResult(value) {
    if (value === null) return true;
    if (!hasExactKeys(value, RESULT_KEYS)) return false;
    if (!OUTCOMES.has(value.outcome)) return false;
    if (!DELIVERIES.has(value.delivery)) return false;
    if (!isHttpStatus(value.httpStatus)) return false;
    if (!isHttpStatus(value.proxyStatus)) return false;
    if (!isDuration(value.durationMs)) return false;
    if (!hasExactKeys(value.assertions, ASSERTION_KEYS)) return false;
    if (!isSafeCount(value.assertions.passed)) return false;
    if (!isSafeCount(value.assertions.failed)) return false;
    if (!isSafeCount(value.assertions.partial)) return false;
    if (!VALIDATIONS.has(value.validation)) return false;
    if (value.validation !== deriveValidation(value.assertions)) return false;
    if (!CAPTURES.has(value.capture)) return false;
    if (!PERSISTENCES.has(value.persistence)) return false;
    return true;
  }

  function validRecord(record) {
    if (!hasExactKeys(record, RECORD_KEYS)) return false;
    if (record.diagnosticVersion !== DIAGNOSTIC_VERSION) return false;
    if (!isSafeCount(record.revision)) return false;
    if (typeof record.contextMatches !== 'boolean') return false;
    if (!isClock(record.observedAtMs)) return false;
    if (record.validUntilMs !== null && !isClock(record.validUntilMs)) return false;
    if (!STATES.has(record.state)) return false;
    if (record.blocker !== null && !Object.hasOwn(BLOCKER_DEFINITIONS, record.blocker)) return false;
    if (record.nextAction !== null && !CONTROL_SET.has(record.nextAction)) return false;
    if (!validBlockers(record.blockers)) return false;

    const expectedBlocker = record.blockers.length ? record.blockers[0].code : null;
    if (record.blocker !== expectedBlocker) return false;

    if (record.state === 'unavailable') {
      if (record.contextMatches !== false) return false;
      if (record.validUntilMs !== null) return false;
      if (record.nextAction !== null) return false;
      if (record.blockers.length !== 1 || record.blockers[0].code !== 'diagnostic_unavailable') return false;
      return record.result === null;
    }

    if (record.contextMatches === false) {
      if (record.state !== 'unknown') return false;
      if (record.validUntilMs !== null) return false;
      if (record.nextAction !== null) return false;
      if (record.blockers.length !== 1 || record.blockers[0].code !== 'context_changed') return false;
      return record.result === null;
    }

    if (record.state === 'ready_for_review') {
      if (!isClock(record.validUntilMs) || record.validUntilMs <= record.observedAtMs) return false;
      if (record.nextAction !== null && record.nextAction !== 'execution.review') return false;
    } else if (record.state === 'approved') {
      if (!isClock(record.validUntilMs) || record.validUntilMs <= record.observedAtMs) return false;
      if (record.nextAction !== null && record.nextAction !== 'execution.execute') return false;
    } else {
      if (record.validUntilMs !== null) return false;
      if (record.nextAction !== null) {
        const target = record.blockers.length ? record.blockers[0].target : null;
        if (!target || target.kind !== 'action' || target.name !== record.nextAction) return false;
      }
    }

    if (record.state !== 'completed' && record.state !== 'unknown' && record.result !== null) return false;
    return validResult(record.result);
  }

  function selectedView(options) {
    if (options === undefined) return 'summary';
    if (!isPlainObject(options)) return null;
    if (Object.getOwnPropertySymbols(options).length !== 0) return null;
    const names = Object.getOwnPropertyNames(options);
    if (names.length !== 1 || names[0] !== 'view') return null;
    const descriptor = Object.getOwnPropertyDescriptor(options, 'view');
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) return null;
    return VIEWS.has(descriptor.value) ? descriptor.value : null;
  }

  function parseRecord(rawRecord) {
    if (typeof rawRecord !== 'string') return null;
    let record;
    try {
      record = JSON.parse(rawRecord);
    } catch {
      return null;
    }
    return validRecord(record) ? record : null;
  }

  function unavailableView(view) {
    const common = {
      diagnosticVersion: DIAGNOSTIC_VERSION,
      revision: null,
      state: 'unavailable',
      freshness: 'unavailable',
      blocker: 'diagnostic_unavailable',
      nextAction: null
    };
    if (view === 'blockers') {
      return { ...common, blockers: [copyDefinition(BLOCKER_DEFINITIONS.diagnostic_unavailable)] };
    }
    if (view === 'result') return { ...common, result: null };
    return common;
  }

  function limited(view, value) {
    const limit = view === 'result' ? MAX_RESULT_BYTES : view === 'blockers' ? MAX_BLOCKERS_BYTES : MAX_SUMMARY_BYTES;
    return byteLength(value) <= limit ? value : unavailableView(view);
  }

  function degradedView(record, view, freshness, code) {
    const definition = copyDefinition(BLOCKER_DEFINITIONS[code]);
    const common = {
      diagnosticVersion: DIAGNOSTIC_VERSION,
      revision: record.revision,
      state: code === 'diagnostic_unavailable' ? 'unavailable' : 'unknown',
      freshness,
      blocker: code,
      nextAction: null
    };
    if (view === 'blockers') return limited(view, { ...common, blockers: [definition] });
    if (view === 'result') return limited(view, { ...common, result: null });
    return limited(view, common);
  }

  function presentRecord(record, view) {
    const common = {
      diagnosticVersion: DIAGNOSTIC_VERSION,
      revision: record.revision,
      state: record.state,
      freshness: 'fresh',
      blocker: record.blocker,
      nextAction: record.nextAction
    };
    if (view === 'blockers') {
      return limited(view, {
        ...common,
        blockers: record.blockers.map(entry => copyDefinition(entry))
      });
    }
    if (view === 'result') {
      if (record.result === null) return limited(view, { ...common, result: null });
      return limited(view, {
        ...common,
        result: {
          outcome: record.result.outcome,
          delivery: record.result.delivery,
          httpStatus: record.result.httpStatus,
          proxyStatus: record.result.proxyStatus,
          durationMs: record.result.durationMs,
          assertions: {
            passed: record.result.assertions.passed,
            failed: record.result.assertions.failed,
            partial: record.result.assertions.partial
          },
          validation: record.result.validation,
          capture: record.result.capture,
          persistence: record.result.persistence
        }
      });
    }
    return limited(view, common);
  }

  function readDiagnostic(rawRecord, options, nowMs) {
    let view;
    try { view = selectedView(options); } catch { view = null; }
    if (view === null) return { diagnosticVersion: DIAGNOSTIC_VERSION, error: 'invalid_diagnostic_options' };
    if (typeof rawRecord !== 'string' || !isClock(nowMs) || byteLength(rawRecord) > MAX_RECORD_BYTES) {
      return unavailableView(view);
    }
    const record = parseRecord(rawRecord);
    if (!record || record.observedAtMs > nowMs) return unavailableView(view);
    if (record.state === 'unavailable') return degradedView(record, view, 'unavailable', 'diagnostic_unavailable');
    if (!record.contextMatches) return degradedView(record, view, 'unavailable', 'context_changed');
    const elapsed = nowMs - record.observedAtMs;
    const deadlineReached = record.validUntilMs !== null && nowMs >= record.validUntilMs;
    if (elapsed >= FRESHNESS_MS || deadlineReached) {
      return degradedView(record, view, 'stale', 'diagnostic_stale');
    }
    return presentRecord(record, view);
  }

  return Object.freeze({
    buildRecord,
    readDiagnostic,
    blockerDefinition
  });
});
