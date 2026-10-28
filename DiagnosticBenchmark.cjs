const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const { buildRecord } = require('./wwwroot/agent-diagnostics.js');

const root = __dirname;
const outputPath = path.join(root, 'docs', 'superpowers', 'validation', '2026-10-27-compact-diagnostics-benchmark.json');
const fixtureClockMs = 1001;
const recordClockMs = 1000;
const repetitions = 5;

const diagnosticsSource = fs.readFileSync(path.join(root, 'wwwroot', 'agent-diagnostics.js'), 'utf8');
const bridgeSource = fs.readFileSync(path.join(root, 'wwwroot', 'agent-bridge.js'), 'utf8');
const harnessPath = path.join(root, 'AIAgentBridge.test.cjs');

function hashOf(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function element({ id = '', dataset = {}, value = '', checked = false, disabled, hidden = false, textContent = '', className = '', type = '', label = '', attributes = {}, open } = {}) {
  const elementAttributes = { ...attributes, ...(label ? { 'aria-label': label } : {}) };
  const result = {
    id, dataset, value, checked, hidden, textContent, className, type,
    children: [], options: [], descendants: [],
    getAttribute(name) { return elementAttributes[name] ?? null; },
    contains(target) { return target === this || this.descendants.includes(target); },
    classList: { contains(name) { return className.split(/\s+/).includes(name); } }
  };
  if (disabled !== undefined) result.disabled = disabled;
  if (open !== undefined) result.open = open;
  return result;
}

function createDocument() {
  const values = {
    url: 'https://private.example.test/tenant/42',
    route: '/users/private-user-42',
    params: 'api_key=PARAM_SENTINEL',
    headers: 'Authorization: HEADER_SENTINEL',
    body: '{"token":"BODY_SENTINEL"}',
    auth: 'AUTH_SENTINEL',
    environment: 'ENVIRONMENT_SENTINEL',
    response: 'RESPONSE_SENTINEL',
    phrase: 'TESTE_SENTINEL'
  };
  const elements = new Map([
    ['method', element({ id: 'method', value: 'PATCH' })],
    ['base-url', element({ id: 'base-url', value: values.url })],
    ['route', element({ id: 'route', value: values.route })],
    ['query-params', element({ id: 'query-params' })],
    ['headers', element({ id: 'headers', value: values.headers })],
    ['body-mode', element({ id: 'body-mode', value: 'json' })],
    ['body', element({ id: 'body', value: values.body })],
    ['multipart-fields-list', element({ id: 'multipart-fields-list' })],
    ['auth-type', element({ id: 'auth-type', value: 'bearer' })],
    ['auth-inheritance-mode', element({ id: 'auth-inheritance-mode', value: 'custom' })],
    ['bearer-token', element({ id: 'bearer-token', value: values.auth, type: 'password' })],
    ['basic-username', element({ id: 'basic-username' })],
    ['basic-password', element({ id: 'basic-password', type: 'password' })],
    ['api-key-value', element({ id: 'api-key-value', type: 'password' })],
    ['save-token-history', element({ id: 'save-token-history', checked: true })],
    ['test-data-phrase', element({ id: 'test-data-phrase', value: values.phrase })],
    ['confirm-test-data', element({ id: 'confirm-test-data', checked: true })],
    ['write-guard', element({ id: 'write-guard', hidden: false })],
    ['send-request', element({ id: 'send-request', disabled: false })],
    ['environment-select', element({ id: 'environment-select', value: values.environment })],
    ['workspace-tabs', element({ id: 'workspace-tabs' })],
    ['response-status', element({ id: 'response-status', textContent: '200 OK', className: 'status ok' })],
    ['response-headers', element({ id: 'response-headers', textContent: values.response })],
    ['response-body', element({ id: 'response-body', textContent: values.response })]
  ]);
  elements.get('query-params').children = [{}, {}];
  elements.get('environment-select').options = [{}, {}, {}];

  const actions = [
    element({ id: 'send-request', dataset: { vortixAction: 'request.send' }, label: 'Enviar', disabled: true }),
    element({ id: 'refresh-agent-safe-state', dataset: { vortixAction: 'agent.snapshot.refresh' }, label: 'Gerar estado seguro', disabled: false }),
    element({ id: 'ai-friendly-trigger', dataset: { vortixAction: 'agent.help.open' }, label: 'Bridge v2 ativo', disabled: false }),
    element({ id: 'copy-maestri-agent-prompt', dataset: { vortixAction: 'agent.prompt.copy' }, label: 'Copiar prompt', disabled: false })
  ];
  const fields = [
    element({ id: 'method', dataset: { vortixField: 'request.method' }, value: 'PATCH', disabled: false }),
    element({ id: 'bearer-token', dataset: { vortixField: 'request.auth.bearer' }, value: values.auth, type: 'password', disabled: false }),
    element({ id: 'ai-friendly-status', dataset: { vortixField: 'agent.capability-status' }, textContent: 'Bridge v2 ativo' })
  ];
  const requestEditor = element({ id: 'request-editor', dataset: { vortixRegion: 'request-editor' } });
  const historyRegion = element({ id: 'history-panel', dataset: { vortixRegion: 'history' }, open: true });
  const regions = [requestEditor, historyRegion];
  const tabs = [element({ id: 'workspace-tab-0', dataset: { workspaceTabId: 'tab-1' }, label: 'Users' })];
  tabs[0].getAttribute = name => name === 'aria-selected' ? 'true' : null;
  const activeEditorTab = element({
    id: 'editor-tab-params', dataset: { editorTab: 'params' },
    attributes: { 'aria-selected': 'true', 'aria-controls': 'params-panel' }
  });
  requestEditor.descendants = [actions[0], actions[1], fields[0], fields[1], activeEditorTab];

  const meta = element();
  meta.content = '2';
  const doc = {
    getElementById(id) { return elements.get(id) ?? null; },
    querySelector(selector) {
      if (selector === 'meta[name="vortix-agent-contract"]') return meta;
      if (selector === '[data-editor-tab][aria-selected="true"]') return activeEditorTab;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-vortix-action]') return actions;
      if (selector === '[data-vortix-field]') return fields;
      if (selector === '[data-vortix-region]') return regions;
      if (selector === '[data-editor-tab]') return [activeEditorTab];
      if (selector === '#workspace-tabs [role="tab"]') return tabs;
      return [];
    }
  };
  return { document: doc, values, elements, actions, fields, regions, activeEditorTab };
}

function controls(overrides = {}) {
  return {
    'request.save': true,
    'environment.manage': true,
    'settings.open': true,
    'execution.prepare': false,
    'execution.review': false,
    'execution.execute': false,
    ...overrides
  };
}

function result({ outcome, delivery, httpStatus, proxyStatus = httpStatus, durationMs, assertions, capture, persistence }) {
  return { outcome, delivery, httpStatus, proxyStatus, durationMs, assertions, capture, persistence };
}

const cases = [
  {
    id: 'get_valid',
    label: 'GET válido',
    statusText: 'Preparação pronta para revisão. Nenhuma chamada enviada.',
    response: { text: '', className: 'status idle' },
    reviewHidden: false,
    writeGuardHidden: true,
    facts: {
      state: 'ready_for_review',
      contextMatches: true,
      validUntilMs: 5000,
      blockers: [],
      result: null,
      controls: controls({ 'execution.prepare': true, 'execution.review': true })
    },
    expected: {
      state: 'ready_for_review',
      blocker: null,
      nextAction: 'execution.review',
      result: null
    }
  },
  {
    id: 'missing_variable',
    label: 'Variável ausente',
    statusText: 'Há variáveis sem valor. Revise o ambiente e prepare novamente.',
    response: { text: '', className: 'status idle' },
    reviewHidden: true,
    writeGuardHidden: true,
    facts: {
      state: 'blocked',
      contextMatches: true,
      validUntilMs: null,
      blockers: ['unresolved_variables'],
      result: null,
      controls: controls({ 'execution.prepare': true })
    },
    expected: {
      state: 'blocked',
      blocker: 'unresolved_variables',
      nextAction: 'environment.manage',
      result: null
    }
  },
  {
    id: 'write_waiting_approval',
    label: 'POST aguardando aprovação',
    statusText: 'Preparação pronta para revisão. Nenhuma chamada enviada.',
    response: { text: '', className: 'status idle' },
    reviewHidden: false,
    writeGuardHidden: false,
    facts: {
      state: 'blocked',
      contextMatches: true,
      validUntilMs: null,
      blockers: ['write_confirmation_required'],
      result: null,
      controls: controls({ 'execution.prepare': true })
    },
    expected: {
      state: 'blocked',
      blocker: 'write_confirmation_required',
      nextAction: null,
      result: null
    }
  },
  {
    id: 'assertion_failed',
    label: 'Assertiva reprovada',
    statusText: 'Execução bench-assertion-failed: teste reprovado. HTTP 200; testes 0 aprovados, 1 reprovados, 0 parciais. Captura: confirmado. Histórico: confirmado.',
    response: { text: '200 OK', className: 'status ok' },
    reviewHidden: true,
    writeGuardHidden: true,
    facts: {
      state: 'completed',
      contextMatches: true,
      validUntilMs: null,
      blockers: [],
      result: result({
        outcome: 'assertion_failed', delivery: 'response_received', httpStatus: 200,
        durationMs: 12, assertions: { passed: 0, failed: 1, partial: 0 },
        capture: 'completed', persistence: 'completed'
      }),
      controls: controls()
    },
    expected: {
      state: 'completed',
      blocker: null,
      nextAction: null,
      result: {
        outcome: 'assertion_failed',
        delivery: 'response_received',
        httpStatus: 200,
        validation: 'failed'
      }
    }
  },
  {
    id: 'partial_validation',
    label: 'Validação parcial',
    statusText: 'Execução bench-partial: validação parcial. HTTP 200; testes 1 aprovados, 0 reprovados, 1 parciais. Captura: não solicitada. Histórico: confirmado.',
    response: { text: '200 OK', className: 'status ok' },
    reviewHidden: true,
    writeGuardHidden: true,
    facts: {
      state: 'completed',
      contextMatches: true,
      validUntilMs: null,
      blockers: [],
      result: result({
        outcome: 'success', delivery: 'response_received', httpStatus: 200,
        durationMs: 15, assertions: { passed: 1, failed: 0, partial: 1 },
        capture: 'not_requested', persistence: 'completed'
      }),
      controls: controls()
    },
    expected: {
      state: 'completed',
      blocker: null,
      nextAction: null,
      result: {
        outcome: 'success',
        delivery: 'response_received',
        httpStatus: 200,
        validation: 'partial'
      }
    }
  },
  {
    id: 'transport_timeout',
    label: 'Timeout de transporte',
    statusText: 'Execução bench-timeout: falha de transporte. HTTP sem resposta; testes 0 aprovados, 0 reprovados, 0 parciais. Captura: não solicitada. Histórico: não solicitado. Entrega desconhecida; confira a API antes de repetir.',
    response: { text: 'sem resposta', className: 'status idle' },
    reviewHidden: true,
    writeGuardHidden: true,
    facts: {
      state: 'completed',
      contextMatches: true,
      validUntilMs: null,
      blockers: [],
      result: result({
        outcome: 'transport_error', delivery: 'unknown', httpStatus: null,
        durationMs: 30000, assertions: { passed: 0, failed: 0, partial: 0 },
        capture: 'not_requested', persistence: 'not_requested'
      }),
      controls: controls()
    },
    expected: {
      state: 'completed',
      blocker: null,
      nextAction: null,
      result: {
        outcome: 'transport_error',
        delivery: 'unknown',
        httpStatus: null,
        validation: 'not_run'
      }
    }
  }
];

function extendFixture(caseDefinition) {
  const base = createDocument();
  const { document, elements } = base;
  const record = buildRecord(caseDefinition.facts, null, recordClockMs);
  const card = element({
    id: 'structured-card',
    dataset: { vortixRegion: 'structured-execution' },
    attributes: { 'data-vortix-diagnostic': JSON.stringify(record) },
    open: true
  });
  elements.set('structured-card', card);
  elements.set('structured-status', element({
    id: 'structured-status',
    dataset: { vortixField: 'execution.status' },
    textContent: caseDefinition.statusText
  }));
  elements.set('structured-prepare', element({
    id: 'structured-prepare',
    dataset: { vortixAction: 'execution.prepare' },
    disabled: !caseDefinition.facts.controls['execution.prepare']
  }));
  elements.set('structured-approve', element({
    id: 'structured-approve',
    dataset: { vortixAction: 'execution.review' },
    disabled: !caseDefinition.facts.controls['execution.review']
  }));
  elements.set('structured-execute', element({
    id: 'structured-execute',
    dataset: { vortixAction: 'execution.execute' },
    disabled: !caseDefinition.facts.controls['execution.execute']
  }));
  elements.set('structured-cancel', element({
    id: 'structured-cancel',
    dataset: { vortixAction: 'execution.cancel' },
    disabled: true
  }));
  elements.set('structured-review', element({
    id: 'structured-review',
    hidden: caseDefinition.reviewHidden
  }));
  elements.set('structured-write-guard', element({
    id: 'structured-write-guard',
    hidden: caseDefinition.writeGuardHidden
  }));
  const response = elements.get('response-status');
  response.textContent = caseDefinition.response.text;
  response.className = caseDefinition.response.className;
  return { ...base, card, record };
}

function createBridge(fixture) {
  const window = {};
  const context = vm.createContext({
    window,
    document: fixture.document,
    performance: { now: () => fixtureClockMs },
    TextEncoder,
    fetch() { throw new Error('benchmark must not fetch'); },
    localStorage: { getItem() { throw new Error('benchmark must not read storage'); } },
    indexedDB: { open() { throw new Error('benchmark must not read storage'); } }
  });
  vm.runInContext(diagnosticsSource, context, { filename: 'agent-diagnostics.js' });
  vm.runInContext(bridgeSource, context, { filename: 'agent-bridge.js' });
  return { context, api: window.vortixAgent };
}

function parseStatusText(text) {
  const observed = { state: null, blocker: null, nextAction: null, result: null };
  if (/pronta para revisão/i.test(text)) {
    observed.state = 'ready_for_review';
    observed.nextAction = 'execution.review';
  }
  if (/variáveis sem valor/i.test(text)) {
    observed.state = 'blocked';
    observed.blocker = 'unresolved_variables';
    observed.nextAction = 'environment.manage';
  }
  if (/^Execução /.test(text) && !/falha de transporte|teste reprovado|validação parcial/i.test(text)) {
    observed.state = 'completed';
    observed.result = {
      outcome: 'unknown',
      delivery: 'response_received',
      httpStatus: null,
      validation: 'not_run'
    };
  }
  if (/falha de transporte|teste reprovado|validação parcial/i.test(text)) {
    observed.state = 'completed';
    const httpMatch = text.match(/HTTP\s+(\d{3})/);
    let outcome = 'unknown';
    let validation = 'not_run';
    let delivery = 'response_received';
    if (/teste reprovado/i.test(text)) {
      outcome = 'assertion_failed';
      validation = 'failed';
    } else if (/validação parcial/i.test(text)) {
      outcome = 'success';
      validation = 'partial';
    } else if (/falha de transporte/i.test(text)) {
      outcome = 'transport_error';
      validation = 'not_run';
      delivery = 'unknown';
    }
    if (/Entrega desconhecida/i.test(text)) delivery = 'unknown';
    observed.result = {
      outcome,
      delivery,
      httpStatus: httpMatch ? Number(httpMatch[1]) : null,
      validation
    };
  }
  return observed;
}

function readExecutionStatus(fixture) {
  const status = fixture.document.getElementById('structured-status');
  const text = status.textContent;
  return {
    observed: parseStatusText(text),
    readCalls: 1,
    callNames: ['getElementById(structured-status)'],
    chars: text.length,
    bytes: Buffer.byteLength(text, 'utf8')
  };
}

function readFocusedCurrent(fixture) {
  const status = fixture.document.getElementById('structured-status');
  const prepare = fixture.document.getElementById('structured-prepare');
  const approve = fixture.document.getElementById('structured-approve');
  const execute = fixture.document.getElementById('structured-execute');
  const writeGuard = fixture.document.getElementById('structured-write-guard');
  const review = fixture.document.getElementById('structured-review');
  const response = fixture.document.getElementById('response-status');
  const observed = parseStatusText(status.textContent);
  if (writeGuard.hidden === false && approve.disabled === true) {
    observed.state = 'blocked';
    observed.blocker = 'write_confirmation_required';
    observed.nextAction = null;
  }
  observed.controls = {
    prepareDisabled: prepare.disabled,
    approveDisabled: approve.disabled,
    executeDisabled: execute.disabled
  };
  observed.reviewHidden = review.hidden;
  observed.writeGuardHidden = writeGuard.hidden;
  observed.response = { text: response.textContent, className: response.className };
  const serialized = JSON.stringify(observed);
  return {
    observed,
    readCalls: 7,
    callNames: [
      'getElementById(structured-status)',
      'getElementById(structured-prepare)',
      'getElementById(structured-approve)',
      'getElementById(structured-execute)',
      'getElementById(structured-write-guard)',
      'getElementById(structured-review)',
      'getElementById(response-status)'
    ],
    chars: serialized.length,
    bytes: Buffer.byteLength(serialized, 'utf8')
  };
}

function viewOptions(view) {
  const options = Object.create(null);
  options.view = view;
  return options;
}

function readDiagnose(api, expected, blockersOptions, resultOptions) {
  let received;
  let callName;
  if (expected.result !== null) {
    received = { resultView: api.diagnose(resultOptions) };
    callName = 'diagnose(result)';
  } else if (expected.blocker !== null) {
    received = { blockers: api.diagnose(blockersOptions) };
    callName = 'diagnose(blockers)';
  } else {
    received = { summary: api.diagnose() };
    callName = 'diagnose(summary)';
  }
  const detail = received.resultView || received.blockers || received.summary;
  const observed = {
    state: detail.state,
    blocker: detail.blocker,
    nextAction: detail.nextAction,
    result: received.resultView ? received.resultView.result : null,
    freshness: detail.freshness,
    diagnosticVersion: detail.diagnosticVersion
  };
  const serialized = JSON.stringify(received);
  return {
    observed,
    readCalls: 1,
    callNames: [callName],
    chars: serialized.length,
    bytes: Buffer.byteLength(serialized, 'utf8')
  };
}

function compare(observed, expected) {
  const assertions = [];
  const add = (name, actual, wanted) => {
    assertions.push({ name, passed: actual === wanted, actual, expected: wanted });
  };
  add('state', observed.state, expected.state);
  add('blocker', observed.blocker, expected.blocker);
  add('nextAction', observed.nextAction, expected.nextAction);
  if (expected.result === null) {
    add('resultAbsent', observed.result === null, true);
  } else {
    add('result.outcome', observed.result?.outcome ?? null, expected.result.outcome);
    add('result.delivery', observed.result?.delivery ?? null, expected.result.delivery);
    add('result.httpStatus', observed.result?.httpStatus ?? null, expected.result.httpStatus);
    add('result.validation', observed.result?.validation ?? null, expected.result.validation);
  }
  return {
    semanticSuccess: assertions.every(entry => entry.passed),
    assertions
  };
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function median(values) {
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function summarize(observations) {
  const failures = {};
  for (const observation of observations) {
    for (const assertion of observation.assertions) {
      if (!assertion.passed) failures[assertion.name] = (failures[assertion.name] || 0) + 1;
    }
  }
  const durations = observations.map(observation => observation.durationMs);
  const bytes = observations.map(observation => observation.bytes);
  const chars = observations.map(observation => observation.chars);
  const calls = observations.map(observation => observation.readCalls);
  const successes = observations.filter(observation => observation.semanticSuccess).length;
  return {
    observations: observations.length,
    successes,
    successRate: observations.length ? round(successes / observations.length, 4) : null,
    durationMs: {
      median: durations.length ? round(median(durations), 4) : null,
      min: durations.length ? round(Math.min(...durations), 4) : null,
      max: durations.length ? round(Math.max(...durations), 4) : null
    },
    bytes: {
      median: bytes.length ? round(median(bytes), 2) : null,
      min: bytes.length ? Math.min(...bytes) : null,
      max: bytes.length ? Math.max(...bytes) : null
    },
    chars: {
      median: chars.length ? round(median(chars), 2) : null,
      min: chars.length ? Math.min(...chars) : null,
      max: chars.length ? Math.max(...chars) : null
    },
    readCalls: {
      median: calls.length ? round(median(calls), 2) : null,
      min: calls.length ? Math.min(...calls) : null,
      max: calls.length ? Math.max(...calls) : null
    },
    assertionFailures: failures
  };
}

function pathOrderFor(index) {
  const orders = [
    ['execution_status', 'focused_current', 'diagnose'],
    ['focused_current', 'diagnose', 'execution_status'],
    ['diagnose', 'execution_status', 'focused_current']
  ];
  return orders[index % orders.length];
}

const observations = [];
const fixtures = [];

for (let caseIndex = 0; caseIndex < cases.length; caseIndex += 1) {
  const caseDefinition = cases[caseIndex];
  const fixture = extendFixture(caseDefinition);
  const bridge = createBridge(fixture);
  const blockersOptions = viewOptions('blockers');
  const resultOptions = viewOptions('result');
  fixtures.push({
    id: caseDefinition.id,
    label: caseDefinition.label,
    statusText: caseDefinition.statusText,
    controls: caseDefinition.facts.controls,
    record: fixture.record,
    expected: caseDefinition.expected,
    diagnoseView: caseDefinition.expected.result !== null
      ? 'result'
      : caseDefinition.expected.blocker !== null
        ? 'blockers'
        : 'summary'
  });

  for (const pathName of pathOrderFor(caseIndex)) {
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      const startedAt = performance.now();
      let reading;
      if (pathName === 'execution_status') reading = readExecutionStatus(fixture);
      else if (pathName === 'focused_current') reading = readFocusedCurrent(fixture);
      else reading = readDiagnose(bridge.api, caseDefinition.expected, blockersOptions, resultOptions);
      const durationMs = round(performance.now() - startedAt, 4);
      const comparison = compare(reading.observed, caseDefinition.expected);
      observations.push({
        caseId: caseDefinition.id,
        caseLabel: caseDefinition.label,
        path: pathName,
        repetition,
        readCalls: reading.readCalls,
        callNames: reading.callNames,
        networkCalls: 0,
        chars: reading.chars,
        bytes: reading.bytes,
        durationMs,
        observed: {
          state: reading.observed.state,
          blocker: reading.observed.blocker,
          nextAction: reading.observed.nextAction,
          result: reading.observed.result
            ? {
              outcome: reading.observed.result.outcome,
              delivery: reading.observed.result.delivery,
              httpStatus: reading.observed.result.httpStatus,
              validation: reading.observed.result.validation
            }
            : null
        },
        semanticSuccess: comparison.semanticSuccess,
        assertions: comparison.assertions
      });
    }
  }
}

const pathNames = ['execution_status', 'focused_current', 'diagnose'];
const overallByPath = {};
for (const pathName of pathNames) {
  overallByPath[pathName] = summarize(observations.filter(observation => observation.path === pathName));
}

const byCasePath = [];
for (const caseDefinition of cases) {
  for (const pathName of pathNames) {
    const subset = observations.filter(observation => observation.caseId === caseDefinition.id && observation.path === pathName);
    byCasePath.push({
      caseId: caseDefinition.id,
      caseLabel: caseDefinition.label,
      path: pathName,
      overall: summarize(subset)
    });
  }
}

const report = {
  benchmarkVersion: 2,
  benchmarkKind: 'synthetic-node-parser-harness',
  generatedBy: 'DiagnosticBenchmark.cjs',
  realAgentOrBrowserBenchmark: false,
  claims: {
    aiOrAgentUnderstanding: false,
    browserOrNetwork: false,
    discoveryCost: false,
    statisticalSignificance: false
  },
  specification: 'docs/superpowers/specs/2026-10-27-compact-diagnostics-design.md section 12',
  plan: 'docs/superpowers/plans/2026-10-27-compact-diagnostics.md task 6',
  protocol: {
    cases: cases.length,
    paths: pathNames.length,
    repetitionsPerCasePath: repetitions,
    totalObservations: observations.length,
    fixtureClockMs,
    recordClockMs,
    measurementScope: 'recurring reads over known fixtures and known selector/view names',
    discovery: {
      measured: false,
      reason: 'No describe(), selector search or API-surface discovery is charged or claimed. All five repetitions measure recurring reads over a fixture that is already known in advance.'
    },
    readers: {
      deterministic: true,
      handWrittenParsers: ['parseStatusText', 'readFocusedCurrent', 'readDiagnose'],
      note: 'Status text is converted to semantic fields only by fixed local parsers; no AI, model or adaptive interpretation is measured.'
    },
    determinism: 'fixtures, readCalls, chars, bytes, semantic success and observed fields are stable across runs; durationMs is wall-clock',
    paths: {
      execution_status: 'reads the existing data-vortix-field="execution.status" text only, then applies the fixed local parser',
      focused_current: 'reads execution.status plus structured-execution control, review, write-guard and response selectors, then applies the fixed local parser and selector checks',
      diagnose: 'one vortixAgent.diagnose call: summary only when no detail is needed; otherwise only the blockers or result view, each of which already contains the six common summary fields'
    },
    inputs: {
      harness: {
        file: 'AIAgentBridge.test.cjs',
        sha256: hashOf(harnessPath),
        usage: 'element/createDocument copied read-only; structured-execution elements added locally'
      },
      bridge: {
        file: 'wwwroot/agent-bridge.js',
        sha256: hashOf(path.join(root, 'wwwroot', 'agent-bridge.js'))
      },
      diagnostics: {
        file: 'wwwroot/agent-diagnostics.js',
        sha256: hashOf(path.join(root, 'wwwroot', 'agent-diagnostics.js'))
      }
    }
  },
  fixtures,
  observations,
  summary: {
    totalObservations: observations.length,
    overallByPath,
    byCasePath
  },
  limitations: [
    'Synthetic Node harness, not a benchmark of a real agent, browser session, network or API.',
    'Discovery is not measured: describe(), selector search and API-surface discovery are excluded, and every repetition is a recurring read over a fixture already known in advance. No discovery claim is made.',
    'UI status texts are hand-written synthetic fixtures. Success means the fixed local parsers extracted the expected fields; it is not evidence of AI, model or agent understanding and must not be generalized.',
    'The AIAgentBridge.test.cjs element/createDocument helpers were copied read-only; structured-execution elements were added locally to represent the existing index.html panel.',
    'The diagnostic record is produced by buildRecord with a fixed monotonic clock because UI publication integration is outside this benchmark scope.',
    'Five repetitions per case and path are descriptive only; they do not establish statistical significance or universal gains.',
    'Durations are wall-clock microbenchmark samples from one Node process and are sensitive to JIT and OS scheduling; they are not network, rendering or agent latency.',
    'No token counts are reported. Bytes and characters describe only the observed path payload; no LLM, tokenizer or dependency was used.',
    'The execution_status and focused_current paths are deterministic local readers, not a full reproduction of human navigation or every existing UI affordance.',
    'No real API was called, no personal data was used and no network request is part of any path.'
  ]
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

process.stdout.write(`benchmark observations: ${observations.length}\n`);
for (const pathName of pathNames) {
  const summary = overallByPath[pathName];
  process.stdout.write(`${pathName}: success ${summary.successes}/${summary.observations}, bytes median ${summary.bytes.median}, readCalls median ${summary.readCalls.median}, duration median ${summary.durationMs.median}ms\n`);
}
process.stdout.write(`report: ${path.relative(root, outputPath)}\n`);
