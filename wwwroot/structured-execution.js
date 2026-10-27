(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StructuredExecution = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CONTRACT_VERSION = 1;
  const PREPARATION_TTL_MS = 300000;
  const MAX_TERMINAL_SUMMARIES = 20;

  const PREPARE_KEYS = ['collectionId', 'folderId', 'requestId', 'environmentId'];
  const PREPARE_KEY_SET = new Set(PREPARE_KEYS);

  const BLOCKER_CODES = new Set([
    'request_not_found',
    'environment_not_found',
    'unresolved_variables',
    'vault_locked',
    'invalid_request',
    'ephemeral_file_unavailable',
    'unsupported_preparation_action'
  ]);

  const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
  const DELIVERY_VALUES = new Set(['not_sent', 'response_received', 'unknown']);
  const CAPTURE_VALUES = new Set(['not_requested', 'completed', 'failed', 'skipped']);
  const PERSISTENCE_VALUES = new Set(['not_requested', 'completed', 'failed']);

  const MAX_ID_LENGTH = 256;

  function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function dataProperty(object, key) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) return null;
    return descriptor;
  }

  function validId(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH && value.trim().length > 0;
  }

  function validatePrepareInput(input) {
    if (!isPlainObject(input)) return { ok: false };
    if (Object.getOwnPropertySymbols(input).length) return { ok: false };
    const keys = Object.getOwnPropertyNames(input);
    if (keys.length !== PREPARE_KEYS.length) return { ok: false };
    for (const key of keys) {
      if (!PREPARE_KEY_SET.has(key)) return { ok: false };
    }
    const values = {};
    for (const key of PREPARE_KEYS) {
      const descriptor = dataProperty(input, key);
      if (!descriptor) return { ok: false };
      const value = descriptor.value;
      if (key === 'folderId') {
        if (value !== null && !validId(value)) return { ok: false };
      } else if (!validId(value)) {
        return { ok: false };
      }
      values[key] = value;
    }
    return { ok: true, value: values };
  }

  function validateSingleKeyInput(input, key) {
    if (!isPlainObject(input)) return { ok: false };
    if (Object.getOwnPropertySymbols(input).length) return { ok: false };
    const keys = Object.getOwnPropertyNames(input);
    if (keys.length !== 1 || keys[0] !== key) return { ok: false };
    const descriptor = dataProperty(input, key);
    if (!descriptor || !validId(descriptor.value)) return { ok: false };
    return { ok: true, value: descriptor.value };
  }

  function stableJson(value) {
    function canonical(current, seen) {
      if (current === null) return null;
      const type = typeof current;
      if (type === 'string' || type === 'boolean') return current;
      if (type === 'number') return Number.isFinite(current) ? current : null;
      if (type === 'bigint') return current.toString();
      if (type === 'undefined' || type === 'function' || type === 'symbol') return null;
      if (type !== 'object') return null;
      if (seen.has(current)) return '[circular]';
      seen.add(current);
      let result;
      if (Object.prototype.toString.call(current) === '[object Date]') {
        const time = current.getTime();
        result = Number.isNaN(time) ? null : current.toISOString();
      } else if (Array.isArray(current)) {
        result = current.map(item => canonical(item, seen));
      } else {
        result = Object.create(null);
        const keys = Object.keys(current).sort();
        for (const key of keys) {
          const item = current[key];
          if (item === undefined || typeof item === 'function' || typeof item === 'symbol') continue;
          result[key] = canonical(item, seen);
        }
      }
      seen.delete(current);
      return result;
    }
    try {
      return JSON.stringify(canonical(value, new Set()));
    } catch {
      return null;
    }
  }

  function cloneValue(value, seen) {
    if (value === null || typeof value !== 'object') return value;
    const visited = seen || new Map();
    if (visited.has(value)) return visited.get(value);
    if (Object.prototype.toString.call(value) === '[object Date]') return new Date(value.getTime());
    if (Array.isArray(value)) {
      const copy = [];
      visited.set(value, copy);
      for (const item of value) copy.push(cloneValue(item, visited));
      return copy;
    }
    const copy = Object.create(Object.getPrototypeOf(value) === null ? null : Object.prototype);
    visited.set(value, copy);
    for (const key of Object.keys(value)) copy[key] = cloneValue(value[key], visited);
    return copy;
  }

  function blockerFromError(error) {
    try {
      const code = error && typeof error === 'object' ? error.code : undefined;
      return typeof code === 'string' && BLOCKER_CODES.has(code) ? code : 'invalid_request';
    } catch {
      return 'invalid_request';
    }
  }

  function sanitizeBlockers(blockers) {
    const result = [];
    const seen = new Set();
    for (const blocker of Array.isArray(blockers) ? blockers : []) {
      const code = typeof blocker === 'string' && BLOCKER_CODES.has(blocker) ? blocker : 'invalid_request';
      if (!seen.has(code)) {
        seen.add(code);
        result.push(code);
      }
    }
    return result.length ? result : ['invalid_request'];
  }

  function sanitizeWarnings(warnings) {
    if (!Array.isArray(warnings)) return [];
    const allowed = new Set(['write_operation', 'insecure_http', 'api_key_query']);
    const result = [];
    const seen = new Set();
    for (const warning of warnings) {
      if (typeof warning !== 'string' || !allowed.has(warning)) continue;
      const text = warning.slice(0, 256);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      result.push(text);
      if (result.length >= 20) break;
    }
    return result;
  }

  function blockedPreparation(blockers, warnings) {
    return {
      contractVersion: CONTRACT_VERSION,
      preparationId: null,
      state: 'blocked',
      expiresInSeconds: 0,
      method: null,
      blockers: sanitizeBlockers(blockers),
      warnings: sanitizeWarnings(warnings),
      nextAction: 'resolve_blockers'
    };
  }

  function normalizeMaterialized(materialized) {
    if (!isPlainObject(materialized)) throw codedError('invalid_request');
    const request = materialized.request;
    if (!isPlainObject(request)) throw codedError('invalid_request');
    const method = typeof request.method === 'string' ? request.method.trim().toUpperCase() : '';
    if (!METHODS.has(method)) throw codedError('invalid_request');
    return {
      request,
      method,
      warnings: sanitizeWarnings(materialized.warnings)
    };
  }

  function codedError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
  }

  function readOptionalStatus(value) {
    if (value === null || value === undefined) return null;
    return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
  }

  function readHttpStatus(value) {
    if (value === null || value === undefined) return { value: null, valid: true };
    if (Number.isInteger(value) && value >= 100 && value <= 599) return { value, valid: true };
    return { value: null, valid: false };
  }

  function readCount(value) {
    if (value === null || value === undefined) return { value: 0, valid: true };
    if (Number.isInteger(value) && value >= 0) return { value, valid: true };
    return { value: 0, valid: false };
  }

  function readDuration(value) {
    if (value === null || value === undefined) return { value: 0, valid: true };
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return { value, valid: true };
    return { value: 0, valid: false };
  }

  function readEnum(value, allowed, fallback) {
    if (typeof value === 'string' && allowed.has(value)) return { value, valid: true };
    return { value: fallback, valid: false };
  }

  function readOptionalEnum(value, allowed, missingFallback, invalidFallback) {
    if (value === null || value === undefined) return { value: missingFallback, valid: true };
    return readEnum(value, allowed, invalidFallback);
  }

  function readFailureStage(source) {
    if (!source || typeof source !== 'object') return null;
    let candidates = [];
    try {
      if (source.localError === true) return 'local';
      if (source.transportError === true) return 'transport';
      candidates = [source.failureStage, source.errorStage, source.stage];
      if (typeof source.failure === 'string') candidates.push(source.failure);
      else if (isPlainObject(source.failure)) candidates.push(source.failure.stage, source.failure.kind);
    } catch {
      return null;
    }
    for (const candidate of candidates) {
      if (candidate === 'local' || candidate === 'transport') return candidate;
    }
    return null;
  }

  function readErrorFacts(error) {
    const facts = {};
    if (!error || typeof error !== 'object') return facts;
    const keys = ['delivery', 'httpStatus', 'proxyStatus', 'durationMs', 'assertions', 'capture', 'persistence', 'failureStage', 'errorStage', 'stage'];
    for (const key of keys) {
      try {
        if (key in error) facts[key] = error[key];
      } catch {
        // Ignore hostile or throwing accessors; they never enter the summary.
      }
    }
    try {
      if (typeof error.failure === 'string') facts.failure = error.failure;
      else if (isPlainObject(error.failure)) {
        facts.failure = {};
        if (typeof error.failure.stage === 'string') facts.failure.stage = error.failure.stage;
        if (typeof error.failure.kind === 'string') facts.failure.kind = error.failure.kind;
      }
    } catch {
      // Ignore unsafe nested failures.
    }
    return facts;
  }

  function errorStage(error) {
    if (!error || typeof error !== 'object') return null;
    const stage = readFailureStage(error);
    if (stage) return stage;
    let code;
    let name;
    try {
      code = typeof error.code === 'string' ? error.code.toLowerCase() : '';
      name = typeof error.name === 'string' ? error.name.toLowerCase() : '';
    } catch {
      return null;
    }
    if (/timeout|timedout/.test(code) || name === 'timeouterror' || name === 'aborterror') return 'transport';
    if (['econnrefused', 'econnreset', 'enotfound', 'eai_again', 'network_error', 'network', 'transport_error'].includes(code)) return 'transport';
    if (code === 'local' || code === 'local_error' || name === 'localerror') return 'local';
    return null;
  }

  function isTimeoutFailure(error) {
    if (!error || typeof error !== 'object') return false;
    try {
      const code = typeof error.code === 'string' ? error.code.toLowerCase() : '';
      const name = typeof error.name === 'string' ? error.name.toLowerCase() : '';
      return /timeout|timedout/.test(code) || name === 'timeouterror' || name === 'aborterror';
    } catch {
      return false;
    }
  }

  function runningSummary(executionId) {
    return {
      contractVersion: CONTRACT_VERSION,
      executionId,
      state: 'running',
      outcome: null,
      delivery: null,
      httpStatus: null,
      proxyStatus: null,
      durationMs: null,
      assertions: null,
      capture: null,
      persistence: null
    };
  }

  function classifyFacts(executionId, facts) {
    const source = isPlainObject(facts) ? facts : {};
    let invalid = !isPlainObject(facts);

    const delivery = readEnum(source.delivery, DELIVERY_VALUES, 'unknown');
    if (!delivery.valid) invalid = true;

    const http = readHttpStatus(source.httpStatus);
    if (!http.valid) invalid = true;
    if (delivery.value === 'response_received' && http.value === null) invalid = true;
    if (delivery.value !== 'response_received' && http.value !== null) invalid = true;
    const httpStatus = delivery.value === 'response_received' ? http.value : null;

    const proxyStatus = readOptionalStatus(source.proxyStatus);

    const duration = readDuration(source.durationMs);
    if (!duration.valid) invalid = true;

    const assertions = { passed: 0, failed: 0, partial: 0 };
    if (source.assertions !== null && source.assertions !== undefined) {
      if (!isPlainObject(source.assertions)) {
        invalid = true;
      } else {
        for (const key of ['passed', 'failed', 'partial']) {
          const count = readCount(source.assertions[key]);
          if (!count.valid) invalid = true;
          assertions[key] = count.value;
        }
      }
    }

    const capture = readOptionalEnum(source.capture, CAPTURE_VALUES, 'not_requested', 'skipped');
    if (!capture.valid) invalid = true;
    const persistence = readOptionalEnum(source.persistence, PERSISTENCE_VALUES, 'not_requested', 'failed');
    if (!persistence.valid) invalid = true;

    const stage = readFailureStage(source);
    const resolvedDelivery = delivery.value;
    const resolvedHttpStatus = httpStatus;
    let outcome;
    if (stage === 'local' || source.outcome === 'local_error') {
      outcome = 'local_error';
    } else if (stage === 'transport' || source.outcome === 'transport_error') {
      outcome = 'transport_error';
    } else if (invalid) {
      outcome = 'unknown';
    } else if (resolvedDelivery === 'response_received' && resolvedHttpStatus !== null) {
      if (resolvedHttpStatus >= 400) outcome = 'http_error';
      else if (assertions.failed > 0) outcome = 'assertion_failed';
      else outcome = 'success';
    } else if (resolvedDelivery === 'not_sent' || resolvedDelivery === 'unknown') {
      outcome = 'transport_error';
    } else {
      outcome = 'unknown';
    }

    return {
      contractVersion: CONTRACT_VERSION,
      executionId,
      state: 'completed',
      outcome,
      delivery: resolvedDelivery,
      httpStatus: resolvedHttpStatus,
      proxyStatus,
      durationMs: duration.value,
      assertions,
      capture: capture.value,
      persistence: persistence.value
    };
  }

  function classifyError(executionId, error) {
    const stage = errorStage(error);
    const facts = readErrorFacts(error);

    if (!stage) {
      if (facts.delivery !== undefined || facts.httpStatus !== undefined) {
        return classifyFacts(executionId, facts);
      }
      return {
        contractVersion: CONTRACT_VERSION,
        executionId,
        state: 'unknown',
        outcome: 'unknown',
        delivery: 'unknown',
        httpStatus: null,
        proxyStatus: null,
        durationMs: 0,
        assertions: { passed: 0, failed: 0, partial: 0 },
        capture: 'not_requested',
        persistence: 'not_requested'
      };
    }

    if (stage === 'local') {
      return classifyFacts(executionId, { ...facts, delivery: facts.delivery || 'unknown', httpStatus: facts.httpStatus ?? null, failureStage: 'local' });
    }

    const delivery = readEnum(facts.delivery, DELIVERY_VALUES, 'unknown');
    const http = readHttpStatus(facts.httpStatus);
    const resolvedDelivery = isTimeoutFailure(error) ? 'unknown' : (delivery.valid ? delivery.value : 'unknown');
    return {
      contractVersion: CONTRACT_VERSION,
      executionId,
      state: 'completed',
      outcome: 'transport_error',
      delivery: resolvedDelivery,
      httpStatus: resolvedDelivery === 'response_received' && http.valid ? http.value : null,
      proxyStatus: readOptionalStatus(facts.proxyStatus),
      durationMs: readDuration(facts.durationMs).value,
      assertions: { passed: 0, failed: 0, partial: 0 },
      capture: 'not_requested',
      persistence: 'not_requested'
    };
  }

  function copySummary(summary) {
    return {
      contractVersion: CONTRACT_VERSION,
      executionId: summary.executionId,
      state: summary.state,
      outcome: summary.outcome,
      delivery: summary.delivery,
      httpStatus: summary.httpStatus,
      proxyStatus: summary.proxyStatus,
      durationMs: summary.durationMs,
      assertions: summary.assertions
        ? {
            passed: summary.assertions.passed,
            failed: summary.assertions.failed,
            partial: summary.assertions.partial
          }
        : null,
      capture: summary.capture,
      persistence: summary.persistence
    };
  }

  function createStructuredExecution(dependencies) {
    const deps = dependencies && typeof dependencies === 'object' ? dependencies : {};
    for (const name of ['now', 'newId', 'readSources', 'materialize', 'run']) {
      if (typeof deps[name] !== 'function') {
        const error = new Error('invalid_dependencies');
        error.code = 'invalid_dependencies';
        throw error;
      }
    }

    const preparations = new Map();
    const executions = new Map();
    const terminalOrder = [];
    let currentPreparationId = null;
    let activeExecutionId = null;
    let inFlightExecutions = 0;
    let generation = 0;

    function clock() {
      try {
        const value = Number(deps.now());
        return Number.isFinite(value) ? value : 0;
      } catch {
        return 0;
      }
    }

    function isExpired(preparation) {
      if (!preparation) return true;
      if (preparation.expired === true) return true;
      return clock() - preparation.createdAt >= PREPARATION_TTL_MS;
    }

    function clearSnapshot(preparation) {
      preparation.snapshotJson = null;
      preparation.request = null;
    }

    function invalidatePreparation(preparation) {
      if (!preparation) return;
      preparation.invalidated = true;
      preparation.approved = false;
      clearSnapshot(preparation);
    }

    function expirePreparation(preparation) {
      if (!preparation) return;
      preparation.expired = true;
      preparation.approved = false;
      clearSnapshot(preparation);
    }

    function invalidatePendingPreparation() {
      if (!currentPreparationId) return;
      const pending = preparations.get(currentPreparationId);
      if (pending && !pending.executionId) {
        if (!pending.cancelled) invalidatePreparation(pending);
        else clearSnapshot(pending);
        pending.approved = false;
      }
      currentPreparationId = null;
    }

    function enforceTerminalLimit() {
      while (terminalOrder.length > MAX_TERMINAL_SUMMARIES) {
        let index = terminalOrder.findIndex(id => id !== activeExecutionId);
        if (index === -1) break;
        const oldest = terminalOrder.splice(index, 1)[0];
        executions.delete(oldest);
      }
    }

    function finalizeExecution(executionId, facts, error, startedGeneration) {
      if (inFlightExecutions > 0) inFlightExecutions -= 1;
      if (startedGeneration !== generation) return;
      const record = executions.get(executionId);
      if (!record || record.terminal === true) return;
      const summary = error ? classifyError(executionId, error) : classifyFacts(executionId, facts);
      record.summary = summary;
      record.state = summary.state;
      record.terminal = true;
      if (activeExecutionId === executionId) activeExecutionId = null;
      terminalOrder.push(executionId);
      enforceTerminalLimit();
    }

    function dispose() {
      generation += 1;
      for (const preparation of preparations.values()) {
        clearSnapshot(preparation);
        preparation.approved = false;
      }
      preparations.clear();
      executions.clear();
      terminalOrder.length = 0;
      currentPreparationId = null;
      activeExecutionId = null;
    }

    function prepare_request(input) {
      const validated = validatePrepareInput(input);
      if (!validated.ok) return blockedPreparation(['invalid_request']);

      invalidatePendingPreparation();

      let sources;
      try {
        sources = deps.readSources({ ...validated.value });
      } catch (error) {
        return blockedPreparation([blockerFromError(error)]);
      }

      const snapshotJson = stableJson(sources);
      if (snapshotJson === null) return blockedPreparation(['invalid_request']);

      let materialized;
      try {
        materialized = deps.materialize(sources);
      } catch (error) {
        return blockedPreparation([blockerFromError(error)]);
      }

      let prepared;
      try {
        prepared = normalizeMaterialized(materialized);
      } catch (error) {
        return blockedPreparation([blockerFromError(error)]);
      }

      let requestSnapshot;
      try {
        requestSnapshot = cloneValue(prepared.request);
      } catch {
        return blockedPreparation(['invalid_request']);
      }

      let preparationId;
      try {
        preparationId = deps.newId();
      } catch {
        return blockedPreparation(['invalid_request']);
      }
      if (!validId(preparationId)) return blockedPreparation(['invalid_request']);

      const preparation = {
        preparationId,
        input: { ...validated.value },
        request: requestSnapshot,
        snapshotJson,
        method: prepared.method,
        warnings: prepared.warnings,
        createdAt: clock(),
        approved: false,
        cancelled: false,
        invalidated: false,
        expired: false,
        executionId: null
      };
      preparations.set(preparationId, preparation);
      currentPreparationId = preparationId;

      return {
        contractVersion: CONTRACT_VERSION,
        preparationId,
        state: 'ready_for_review',
        expiresInSeconds: PREPARATION_TTL_MS / 1000,
        method: prepared.method,
        blockers: [],
        warnings: prepared.warnings.slice(),
        nextAction: 'review_in_ui'
      };
    }

    function approveFromUi(preparationId) {
      if (!validId(preparationId)) return { error: 'invalid_request' };
      const preparation = preparations.get(preparationId);
      if (!preparation) return { error: 'preparation_not_found' };
      if (preparation.executionId) return { error: 'preparation_consumed' };
      if (preparation.cancelled) return { error: 'preparation_cancelled' };
      if (preparation.invalidated) return { error: 'preparation_invalidated' };
      if (isExpired(preparation)) {
        expirePreparation(preparation);
        return { error: 'preparation_expired' };
      }
      preparation.approved = true;
      return { approved: true };
    }

    function cancelFromUi(preparationId) {
      if (!validId(preparationId)) return { error: 'invalid_request' };
      const preparation = preparations.get(preparationId);
      if (!preparation) return { error: 'preparation_not_found' };
      if (preparation.executionId) return { error: 'preparation_consumed' };
      if (preparation.cancelled) return { cancelled: true };
      if (preparation.invalidated) return { error: 'preparation_invalidated' };
      if (isExpired(preparation)) {
        expirePreparation(preparation);
        return { error: 'preparation_expired' };
      }
      preparation.cancelled = true;
      preparation.approved = false;
      clearSnapshot(preparation);
      return { cancelled: true };
    }

    function execute_prepared(input) {
      const validated = validateSingleKeyInput(input, 'preparationId');
      if (!validated.ok) return { error: 'invalid_request' };
      const preparation = preparations.get(validated.value);
      if (!preparation) return { error: 'preparation_not_found' };
      if (preparation.executionId) return { executionId: preparation.executionId };
      if (preparation.cancelled) return { error: 'preparation_cancelled' };
      if (preparation.invalidated) return { error: 'preparation_invalidated' };
      if (isExpired(preparation)) {
        expirePreparation(preparation);
        return { error: 'preparation_expired' };
      }
      if (!preparation.approved) return { error: 'approval_required' };
      if (activeExecutionId !== null || inFlightExecutions > 0) return { error: 'execution_in_progress' };

      let sources;
      try {
        sources = deps.readSources({ ...preparation.input });
      } catch {
        invalidatePreparation(preparation);
        return { error: 'preparation_invalidated' };
      }
      const currentSnapshot = stableJson(sources);
      if (currentSnapshot === null || currentSnapshot !== preparation.snapshotJson) {
        invalidatePreparation(preparation);
        return { error: 'preparation_invalidated' };
      }

      preparation.approved = false;
      const request = preparation.request;
      let executionId;
      try {
        executionId = deps.newId();
      } catch {
        preparation.approved = false;
        return { error: 'invalid_request' };
      }
      if (!validId(executionId)) return { error: 'invalid_request' };

      preparation.executionId = executionId;
      clearSnapshot(preparation);

      const record = {
        executionId,
        state: 'running',
        terminal: false,
        summary: runningSummary(executionId)
      };
      executions.set(executionId, record);
      activeExecutionId = executionId;
      inFlightExecutions += 1;

      const startedGeneration = generation;
      let result;
      try {
        result = deps.run(request);
      } catch (error) {
        Promise.resolve().then(() => finalizeExecution(executionId, null, error, startedGeneration));
        return { executionId };
      }
      Promise.resolve(result).then(
        facts => finalizeExecution(executionId, facts, null, startedGeneration),
        error => finalizeExecution(executionId, null, error, startedGeneration)
      );
      return { executionId };
    }

    function get_execution(input) {
      const validated = validateSingleKeyInput(input, 'executionId');
      if (!validated.ok) return { error: 'invalid_request' };
      const record = executions.get(validated.value);
      if (!record) return { error: 'execution_not_found' };
      return copySummary(record.summary);
    }

    return {
      prepare_request,
      execute_prepared,
      get_execution,
      approveFromUi,
      cancelFromUi,
      dispose
    };
  }

  return { createStructuredExecution };
});
