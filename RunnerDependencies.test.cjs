const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = __dirname;
const runnerLogicPath = path.join(root, 'wwwroot', 'runner-logic.js');
const appPath = path.join(root, 'wwwroot', 'app.js');
const htmlPath = path.join(root, 'wwwroot', 'index.html');

test('submit de dataset inválido atualiza a prévia mesmo cancelando o debounce', async () => {
  const app = fs.readFileSync(appPath, 'utf8');
  const start = app.indexOf('async function startRunnerFromForm(');
  const end = app.indexOf('\nasync function rerunRunnerFailures(', start);
  let refreshed = false, error = '';
  const context = {
    runnerBusy: false, runnerHistoryMutating: false,
    clearRunnerError() {}, cancelRunnerDependencyPreviewTimer() {},
    byId: () => ({ value: '[' }),
    RunnerLogic: { parseDataSets: () => { throw new Error('dataset inválido'); } },
    refreshRunnerDependencyPreview: () => { refreshed = true; },
    showRunnerError: message => { error = message; }
  };
  const submit = vm.runInNewContext(`${app.slice(start, end)}; startRunnerFromForm`, context);
  await submit({ preventDefault() {} });
  assert.equal(refreshed, true);
  assert.equal(error, 'dataset inválido');
});

test('captura de outro nome nunca vira dependência da referência', () => {
  const { analyzeRunnerDependencies } = runnerLogic();
  const result = analyzeRunnerDependencies({ cases: [
    caseFor({ method: 'GET', route: '/produce', captureResponseVariable: true, responseVariableName: 'unrelated' }),
    caseFor({ method: 'GET', route: '/consume/{{needed}}' })
  ], environment: {}, vault: {} });
  const reference = result.cases[1].references.find(item => item.name === 'needed');
  assert.deepEqual(reference.candidatesByTarget, {});
  assert.equal(reference.initialSource, 'missing');
});

test('alternativa de captura em conjunto anterior continua explícita após novo candidato', () => {
  const { analyzeRunnerDependencies } = runnerLogic();
  const producer = { method: 'GET', route: '/produce', captureResponseVariable: true, responseVariableName: 'itemId' };
  const consumer = { method: 'GET', route: '/consume/{{itemId}}' };
  const result = analyzeRunnerDependencies({ cases: [
    caseFor(producer, { datasetOrdinal: 1 }), caseFor(consumer, { datasetOrdinal: 1 }),
    caseFor(producer, { datasetOrdinal: 2 }), caseFor(consumer, { datasetOrdinal: 2 })
  ], environment: {}, vault: {} });
  const last = result.cases[3];
  assert.equal(last.references[0].candidatesByTarget.environment.ordinal, 3);
  assert.equal(last.references[0].candidatesByTarget.environment.crossDataset, false);
  assert.ok(last.issues.includes('cross_dataset'), 'older candidate can remain if the new capture fails');
});

test('reexecução invalida revisão quando o contexto muda durante a confirmação', async () => {
  const app = fs.readFileSync(appPath, 'utf8');
  const start = app.indexOf('async function rerunRunnerFailures(');
  const end = app.indexOf('\nfunction activeWorkspaceTab(', start);
  let sends = 0, guards = 0, message = '';
  const context = {
    runnerBusy: false, runnerHistoryMutating: false,
    runnerFailedCases: [{ stepOrdinal: 2, datasetOrdinal: 1 }],
    runnerDependencyAnalysis: { cases: [] },
    runnerExecutionDependencySnapshot: null,
    cancelRunnerDependencyPreviewTimer() {},
    runnerWriteCases: () => [],
    analyzeRunnerDependencyCases: () => ({ cases: [], complete: true }),
    confirmRunnerDependencyReview: async () => {
      context.runnerDependencyAnalysis = { cases: [], complete: false };
      return true;
    },
    confirmRunnerWrites: async () => { guards++; return true; },
    confirmRunnerRemoteHttp: async () => { guards++; return true; },
    runRunnerCases: async () => { sends++; },
    renderRunnerDependencies() {},
    byId: () => ({ value: '0', checked: true }),
    showRunnerError: value => { message = value; }
  };
  const rerun = vm.runInNewContext(`${app.slice(start, end)}; rerunRunnerFailures`, context);
  await rerun();
  assert.equal(sends, 0);
  assert.equal(guards, 0);
  assert.match(message, /contexto.*mudou/i);
});

test('atualização de fontes durante execução mantém a previsão anterior marcada', () => {
  const app = fs.readFileSync(appPath, 'utf8');
  const start = app.indexOf('function refreshRunnerDependencyPreview(');
  const end = app.indexOf('\nfunction refreshRunnerDependencyPreviewIfOpen(', start);
  const previous = { cases: [], complete: true };
  let rendered;
  const context = {
    runnerBusy: true, runnerEntries: [{}], runnerDependencyAnalysis: previous,
    runnerDependencyStale: false,
    runnerDependencyDatasets: () => { throw Error('não recalcular durante envio'); },
    renderRunnerDependencies: analysis => { rendered = analysis; }
  };
  const refresh = vm.runInNewContext(`${app.slice(start, end)}; refreshRunnerDependencyPreview`, context);
  assert.equal(refresh(), previous);
  assert.equal(rendered, previous);
  assert.equal(context.runnerDependencyStale, true);
});

function runnerLogic() {
  delete require.cache[require.resolve(runnerLogicPath)];
  return require(runnerLogicPath);
}

function caseFor(request, options = {}) {
  return {
    request,
    dataset: options.dataset || {},
    datasetNumber: options.datasetOrdinal || 1,
    datasetOrdinal: options.datasetOrdinal || 1,
    stepOrdinal: options.stepOrdinal || 1,
    authScopes: options.authScopes || []
  };
}

function reference(result, caseOrdinal, name, field) {
  const item = result.cases.find(caseItem => caseItem.caseOrdinal === caseOrdinal);
  assert.ok(item, `case ${caseOrdinal} should exist`);
  return item.references.find(ref => ref.name === name && (!field || ref.field === field));
}

test('analisa captura anterior como candidato condicional e não expõe valores', () => {
  const { analyzeRunnerDependencies } = runnerLogic();
  assert.equal(typeof analyzeRunnerDependencies, 'function');
  const result = analyzeRunnerDependencies({
    cases: [
      caseFor({ method: 'GET', route: '/token', captureResponseVariable: true, responseVariableName: 'token' }, { stepOrdinal: 1 }),
      caseFor({ method: 'GET', route: '/me', headers: 'Authorization: Bearer {{token}}' }, { stepOrdinal: 2 })
    ],
    environment: {},
    vault: {}
  });
  assert.equal(result.analysisVersion, 1);
  assert.equal(result.complete, true);
  assert.equal(result.cases.length, 2);
  assert.deepEqual(result.cases[0].capture, { name: 'token', target: 'environment', conditional: true });
  const ref = reference(result, 2, 'token', 'headers');
  assert.equal(ref.initialSource, 'missing');
  assert.equal(ref.conditional, true);
  assert.deepEqual(ref.candidatesByTarget.environment, { ordinal: 1, count: 1, crossDataset: false, shadowed: false });
  assert.equal(result.cases[0].capture.conditional, true);
  assert.equal(Object.hasOwn(result, 'ready'), false);
  assert.equal(Object.hasOwn(result, 'approved'), false);
  assert.equal(JSON.stringify(result).includes('SEGREDO_NAO_DEVE_APARECER'), false);
});

test('não reordena produtor posterior e mantém referência sem origem anterior', () => {
  const { analyzeRunnerDependencies } = runnerLogic();
  const result = analyzeRunnerDependencies({
    cases: [
      caseFor({ method: 'GET', route: '/me', headers: 'X-Token: {{token}}' }, { stepOrdinal: 1 }),
      caseFor({ method: 'GET', route: '/token', captureResponseVariable: true, responseVariableName: 'token' }, { stepOrdinal: 2 })
    ],
    environment: {},
    vault: {}
  });
  const ref = reference(result, 1, 'token', 'headers');
  assert.equal(ref.initialSource, 'missing');
  assert.deepEqual(ref.candidatesByTarget, {});
  assert.equal(ref.conditional, false);
  assert.equal(result.cases[1].capture.name, 'token');
});

test('preserva precedência dataset, pré-request e cofre sobre captura em ambiente, inclusive vazio', () => {
  const { analyzeRunnerDependencies } = runnerLogic();
  const capture = caseFor({ method: 'GET', route: '/token', captureResponseVariable: true, responseVariableName: 'token' }, { stepOrdinal: 1 });
  const datasetCase = caseFor({ method: 'GET', route: '/a', headers: 'X: {{token}}' }, { dataset: { token: '' }, stepOrdinal: 2 });
  const preRequestCase = caseFor({
    method: 'GET', route: '/b', headers: 'X: {{token}}',
    preRequestActions: [{ type: 'template', name: 'token', value: 'fixed-lit' }]
  }, { stepOrdinal: 3 });
  const vaultCase = caseFor({ method: 'GET', route: '/c', headers: 'X: {{token}}' }, { stepOrdinal: 4 });
  const result = analyzeRunnerDependencies({
    cases: [capture, datasetCase, preRequestCase, vaultCase],
    environment: { token: '' },
    vault: { token: '' }
  });

  const datasetRef = reference(result, 2, 'token', 'headers');
  assert.equal(datasetRef.initialSource, 'dataset');
  assert.equal(datasetRef.shadowed, true);
  assert.equal(datasetRef.conditional, false);
  assert.ok(result.cases[1].issues.includes('multiple_candidates') === false);

  const preRequestRef = reference(result, 3, 'token', 'headers');
  assert.equal(preRequestRef.initialSource, 'pre-request');
  assert.equal(preRequestRef.shadowed, true);
  assert.equal(preRequestRef.conditional, false);

  const vaultRef = reference(result, 4, 'token', 'headers');
  assert.equal(vaultRef.initialSource, 'vault');
  assert.equal(vaultRef.shadowed, true);
  assert.equal(vaultRef.conditional, false);
  assert.equal(JSON.stringify(result).includes('fixed-lit'), false);
});

test('ambiente inicial com captura anterior gera aviso de possível atualização', () => {
  const { analyzeRunnerDependencies } = runnerLogic();
  const result = analyzeRunnerDependencies({
    cases: [
      caseFor({ method: 'GET', route: '/token', captureResponseVariable: true, responseVariableName: 'token' }, { stepOrdinal: 1 }),
      caseFor({ method: 'GET', route: '/me', headers: 'X: {{token}}' }, { stepOrdinal: 2 })
    ],
    environment: { token: '' },
    vault: {}
  });
  const ref = reference(result, 2, 'token');
  assert.equal(ref.initialSource, 'environment');
  assert.equal(ref.conditional, true);
  assert.equal(ref.shadowed, false);
  assert.ok(result.cases[1].issues.includes('existing_value'));
});

test('separa candidatos por destino e conserva cofre anterior e ambiente posterior', () => {
  const { analyzeRunnerDependencies } = runnerLogic();
  const result = analyzeRunnerDependencies({
    cases: [
      caseFor({ method: 'GET', route: '/vault-token', captureResponseVariable: true, responseVariableName: 'token', responseCaptureTarget: 'vault' }, { datasetOrdinal: 1, stepOrdinal: 1 }),
      caseFor({ method: 'GET', route: '/env-token', captureResponseVariable: true, responseVariableName: 'token' }, { datasetOrdinal: 1, stepOrdinal: 2 }),
      caseFor({ method: 'GET', route: '/one', headers: 'X: {{token}}' }, { datasetOrdinal: 1, stepOrdinal: 3 }),
      caseFor({ method: 'GET', route: '/two', headers: 'X: {{token}}' }, { datasetOrdinal: 2, stepOrdinal: 1 })
    ],
    environment: {},
    vault: {}
  });
  const ref = reference(result, 3, 'token');
  assert.deepEqual(ref.candidatesByTarget.environment, { ordinal: 2, count: 1, crossDataset: false, shadowed: false });
  assert.deepEqual(ref.candidatesByTarget.vault, { ordinal: 1, count: 1, crossDataset: false, shadowed: false });
  assert.ok(result.cases[2].issues.includes('multiple_candidates'));
  const crossRef = reference(result, 4, 'token');
  assert.equal(crossRef.candidatesByTarget.environment.crossDataset, true);
  assert.equal(crossRef.candidatesByTarget.vault.crossDataset, true);
  assert.ok(result.cases[3].issues.includes('cross_dataset'));
});

test('múltiplas capturas no mesmo destino preservam contagem e incerteza', () => {
  const { analyzeRunnerDependencies } = runnerLogic();
  const result = analyzeRunnerDependencies({
    cases: [
      caseFor({ method: 'GET', route: '/one', captureResponseVariable: true, responseVariableName: 'token' }, { stepOrdinal: 1 }),
      caseFor({ method: 'GET', route: '/two', captureResponseVariable: true, responseVariableName: 'token' }, { stepOrdinal: 2 }),
      caseFor({ method: 'GET', route: '/use', headers: 'X: {{token}}' }, { stepOrdinal: 3 })
    ],
    environment: {},
    vault: {}
  });
  const ref = reference(result, 3, 'token');
  assert.deepEqual(ref.candidatesByTarget.environment, { ordinal: 2, count: 2, crossDataset: false, shadowed: false });
  assert.ok(result.cases[2].issues.includes('multiple_candidates'));
});

test('captura para cofre bloqueado ou indisponível não registra produtor nem candidato utilizável', () => {
  const { analyzeRunnerDependencies } = runnerLogic();
  for (const [vault, issue] of [[{ locked: true, names: [] }, 'vault_locked'], [{ unavailable: true }, 'vault_unavailable']]) {
    const result = analyzeRunnerDependencies({
      cases: [
        caseFor({ method: 'GET', route: '/token', captureResponseVariable: true, responseVariableName: 'token', responseCaptureTarget: 'vault' }, { stepOrdinal: 1 }),
        caseFor({ method: 'GET', route: '/use', headers: 'X: {{token}}' }, { stepOrdinal: 2 })
      ],
      environment: {},
      vault
    });
    assert.equal(result.cases[0].capture, null);
    assert.ok(result.cases[0].issues.includes(issue));
    const ref = reference(result, 2, 'token');
    assert.deepEqual(ref.candidatesByTarget, {});
    assert.equal(ref.conditional, false);
  }
});

test('cofre bloqueado ou indisponível falha fechado mesmo com ambiente preenchido', () => {
  const { analyzeRunnerDependencies } = runnerLogic();
  const locked = analyzeRunnerDependencies({
    cases: [caseFor({ method: 'GET', route: '/me', headers: 'X: {{token}}' })],
    environment: { token: 'env-value' },
    vault: { locked: true, names: ['token'] }
  });
  const lockedRef = reference(locked, 1, 'token');
  assert.equal(lockedRef.initialSource, 'locked');
  assert.ok(locked.cases[0].issues.includes('vault_locked'));

  const unavailable = analyzeRunnerDependencies({
    cases: [caseFor({ method: 'GET', route: '/me', headers: 'X: {{token}}' })],
    environment: { token: 'env-value' },
    vault: { unavailable: true }
  });
  const unavailableRef = reference(unavailable, 1, 'token');
  assert.equal(unavailableRef.initialSource, 'unavailable');
  assert.ok(unavailable.cases[0].issues.includes('vault_unavailable'));
});

test('validação compartilhada de captura e incompatibilidade estática permanece reutilizável', () => {
  const { isValidCaptureVariableName, runnerRequestStaticIssue } = runnerLogic();
  assert.equal(isValidCaptureVariableName('token'), true);
  assert.equal(isValidCaptureVariableName(''), false);
  assert.equal(isValidCaptureVariableName('bad name'), false);
  assert.equal(isValidCaptureVariableName('__proto__'), false);
  assert.equal(runnerRequestStaticIssue({ method: 'POST', tokenRequest: true }).code, 'unsupported_request');
  assert.equal(runnerRequestStaticIssue({ method: 'GET', bodyMode: 'graphql', graphqlQuery: '{ ping }' }).code, 'unsupported_request');
  assert.equal(runnerRequestStaticIssue({ method: 'POST', route: '/ok' }), null);
});

test('captura inválida e requests estaticamente incompatíveis não viram produtores', () => {
  const { analyzeRunnerDependencies } = runnerLogic();
  const result = analyzeRunnerDependencies({
    cases: [
      caseFor({ method: 'GET', route: '/bad', captureResponseVariable: true, responseVariableName: 'bad name' }, { stepOrdinal: 1 }),
      caseFor({ method: 'POST', route: '/token', tokenRequest: true, captureResponseVariable: true, responseVariableName: 'token' }, { stepOrdinal: 2 }),
      caseFor({ method: 'GET', route: '/graphql', bodyMode: 'graphql', graphqlQuery: '{ ping }', captureResponseVariable: true, responseVariableName: 'token2' }, { stepOrdinal: 3 }),
      caseFor({ method: 'POST', route: '/upload', bodyMode: 'multipart', multipartFields: [{ name: 'file', type: 'file', fileName: 'x.bin' }], captureResponseVariable: true, responseVariableName: 'token3' }, { stepOrdinal: 4 })
    ],
    environment: {},
    vault: {}
  });
  assert.equal(result.cases[0].capture, null);
  assert.ok(result.cases[0].issues.includes('invalid_capture'));
  for (const index of [1, 2, 3]) {
    assert.equal(result.cases[index].capture, null);
    assert.ok(result.cases[index].issues.includes('unsupported_request'));
  }
});

test('ações pré-request são declaradas em ordem, sem gerar UUID ou timestamp e sem executar valores', () => {
  const { analyzeRunnerDependencies } = runnerLogic();
  const result = analyzeRunnerDependencies({
    cases: [caseFor({
      method: 'GET', route: '/items/{{request_id}}', headers: 'X: {{derived}}',
      preRequestActions: [
        { type: 'template', name: 'token', value: '{{missing}}' },
        { type: 'template', name: 'derived', value: '{{token}}' },
        { type: 'uuid', name: 'request_id' },
        { type: 'timestamp', name: 'sent_at' }
      ]
    })],
    environment: {},
    vault: {}
  });
  const missingActionRef = reference(result, 1, 'missing', 'pre-request');
  assert.equal(missingActionRef.initialSource, 'missing');
  const tokenActionRef = reference(result, 1, 'token', 'pre-request');
  assert.equal(tokenActionRef.initialSource, 'pre-request');
  assert.equal(tokenActionRef.conditional, true);
  const derivedRef = reference(result, 1, 'derived', 'headers');
  assert.equal(derivedRef.initialSource, 'pre-request');
  assert.equal(derivedRef.conditional, true);
  const requestIdRef = reference(result, 1, 'request_id', 'route');
  assert.equal(requestIdRef.initialSource, 'pre-request');
  assert.equal(requestIdRef.conditional, false);
  assert.equal(JSON.stringify(result).includes('fixed-lit'), false);
});

test('extração compartilhada cobre Auth herdada, GraphQL e multipart', () => {
  const { analyzeRunnerDependencies, templateFieldsFromSavedRequest } = runnerLogic();
  assert.equal(typeof templateFieldsFromSavedRequest, 'function');
  const fields = templateFieldsFromSavedRequest({
    method: 'POST', route: '/gql', bodyMode: 'graphql',
    graphqlQuery: 'query Q($id: ID!) { item(id: $id) { id } }',
    graphqlVariables: '{"id":"{{gqlId}}"}',
    authMode: 'inherit',
    multipartFields: []
  }, [{ id: 'c', name: 'Collection', auth: { authType: 'bearer', bearerToken: '{{token}}' } }]);
  assert.equal(fields['auth.bearerToken'], '{{token}}');
  assert.equal(fields['graphql.variables'], '{"id":"{{gqlId}}"}');

  const result = analyzeRunnerDependencies({
    cases: [caseFor({
      method: 'POST', route: '/gql', bodyMode: 'graphql', authMode: 'inherit',
      graphqlQuery: 'query Q($id: ID!) { item(id: $id) { id } }',
      graphqlVariables: '{"id":"{{gqlId}}"}'
    }, { authScopes: [{ id: 'c', name: 'Collection', auth: { authType: 'bearer', bearerToken: '{{token}}' } }] })],
    environment: {},
    vault: {}
  });
  assert.ok(reference(result, 1, 'token', 'auth.bearerToken'));
  assert.ok(reference(result, 1, 'gqlId', 'graphql.variables'));

  const multipart = analyzeRunnerDependencies({
    cases: [caseFor({
      method: 'POST', route: '/upload', bodyMode: 'multipart',
      multipartFields: [{ name: 'tag', type: 'text', value: '{{part}}' }]
    })],
    environment: {},
    vault: {}
  });
  assert.ok(reference(multipart, 1, 'part', 'multipart[0].value'));
});

test('deriva casos em ordem dataset-major com ordinais estáveis e limite de UI', () => {
  const { createRunnerCases } = runnerLogic();
  const entries = [{ request: { id: 'a' } }, { request: { id: 'b' } }];
  const cases = createRunnerCases(entries, [{ first: true }, { second: true }]);
  assert.deepEqual(cases.map(item => [item.stepOrdinal, item.datasetOrdinal, item.request.id, Object.keys(item.dataset)[0]]), [
    [1, 1, 'a', 'first'], [2, 1, 'b', 'first'], [1, 2, 'a', 'second'], [2, 2, 'b', 'second']
  ]);
  assert.equal(createRunnerCases(entries, [{}, {}, {}], 2).length, 2);
});

test('orçamento de referências deduplica por caso, campo e nome e retorna parcial', () => {
  const { analyzeRunnerDependencies } = runnerLogic();
  const cases = [];
  for (let index = 0; index < 401; index++) {
    cases.push(caseFor({ method: 'GET', route: '/items', headers: Array.from({ length: 5 }, (_, item) => `X-${item}: {{v${item}}}`).join('\n') }, { stepOrdinal: index + 1 }));
  }
  const result = analyzeRunnerDependencies({ cases, environment: {}, vault: {} });
  assert.equal(result.complete, false);
  assert.ok(result.issues.includes('reference_limit'));
  const total = result.cases.reduce((sum, item) => sum + item.references.length, 0);
  assert.equal(total, 2000);
  assert.ok(result.cases.at(-1).issues.includes('reference_limit'));
});

test('limite de 500 casos retorna análise parcial explícita', () => {
  const { analyzeRunnerDependencies } = runnerLogic();
  const cases = Array.from({ length: 501 }, (_, index) => caseFor({ method: 'GET', route: '/items', headers: 'X: {{id}}' }, { stepOrdinal: index + 1 }));
  const result = analyzeRunnerDependencies({ cases, environment: {}, vault: {} });
  assert.equal(result.complete, false);
  assert.equal(result.cases.length, 500);
  assert.ok(result.issues.includes('case_limit'));
});

test('não muta argumentos e não retorna sentinelas de ambiente, cofre ou dataset', () => {
  const { analyzeRunnerDependencies } = runnerLogic();
  const request = {
    method: 'GET', route: '/items/{{URL_SENTINEL}}', headers: 'Authorization: Bearer {{AUTH_SENTINEL}}\nX-Body: {{BODY_SENTINEL}}',
    body: '{"value":"{{BODY_SENTINEL}}"}', authMode: 'custom', authType: 'bearer', bearerToken: '{{AUTH_SENTINEL}}',
    captureResponseVariable: true, responseVariableName: 'captured'
  };
  const cases = [caseFor(request, { dataset: { DATASET_SENTINEL: 'DATASET_VALUE_CANARY' } })];
  const environment = { ENV_SENTINEL: 'ENV_VALUE_CANARY', AUTH_SENTINEL: 'AUTH_VALUE_CANARY' };
  const vault = { VAULT_SENTINEL: 'VAULT_VALUE_CANARY' };
  const casesBefore = JSON.stringify(cases);
  const environmentBefore = JSON.stringify(environment);
  const vaultBefore = JSON.stringify(vault);
  const result = analyzeRunnerDependencies({ cases, environment, vault });
  const serialized = JSON.stringify(result);
  for (const sentinel of ['AUTH_VALUE_CANARY', 'BODY_VALUE_CANARY', 'ENV_VALUE_CANARY', 'VAULT_VALUE_CANARY', 'DATASET_VALUE_CANARY']) {
    assert.equal(serialized.includes(sentinel), false, `${sentinel} must not leak`);
  }
  assert.equal(serialized.includes('/items/'), false, 'request routes must not leak');
  assert.equal(JSON.stringify(cases), casesBefore);
  assert.equal(JSON.stringify(environment), environmentBefore);
  assert.equal(JSON.stringify(vault), vaultBefore);
});

test('reexecução identifica produtor da rodada anterior fora do subconjunto', () => {
  const { analyzeRunnerDependencies } = runnerLogic();
  const previous = analyzeRunnerDependencies({
    cases: [
      caseFor({ method: 'GET', route: '/token', captureResponseVariable: true, responseVariableName: 'token' }, { stepOrdinal: 1 }),
      caseFor({ method: 'GET', route: '/me', headers: 'X: {{token}}' }, { stepOrdinal: 2 })
    ],
    environment: {},
    vault: {}
  });
  const previousCaptures = previous.cases
    .filter(item => item.capture)
    .map(item => ({ name: item.capture.name, target: item.capture.target, caseOrdinal: item.caseOrdinal, datasetOrdinal: item.datasetOrdinal }));
  const rerun = analyzeRunnerDependencies({
    cases: [caseFor({ method: 'GET', route: '/me', headers: 'X: {{token}}' }, { stepOrdinal: 2 })],
    environment: {},
    vault: {},
    previousCaptures,
    includedPreviousOrdinals: []
  });
  assert.ok(rerun.cases[0].issues.includes('producer_omitted'));
});

test('reexecução identifica candidato do plano anterior sem confundir ordinal com passo atual', () => {
  const app = fs.readFileSync(appPath, 'utf8');
  const start = app.indexOf('function runnerDependencyIssueLabel(');
  const end = app.indexOf('\nfunction renderRunnerDependencies(', start);
  const context = {};
  const api = vm.runInNewContext(`${app.slice(start, end)}; ({ runnerDependencyReferenceLines })`, context);
  const { analyzeRunnerDependencies } = runnerLogic();
  const previousCaptures = [{ name: 'token', target: 'vault', caseOrdinal: 13, datasetOrdinal: 1 }];
  const result = analyzeRunnerDependencies({
    cases: [
      caseFor({ method: 'GET', route: '/one' }, { stepOrdinal: 1 }),
      caseFor({ method: 'GET', route: '/two' }, { stepOrdinal: 2 }),
      caseFor({ method: 'GET', route: '/use', headers: 'X: {{token}}' }, { stepOrdinal: 3 })
    ],
    environment: {},
    vault: { locked: true, names: [] },
    previousCaptures,
    includedPreviousOrdinals: []
  });
  const ref = reference(result, 3, 'token');
  assert.deepEqual(ref.candidatesByTarget, {});
  assert.deepEqual(ref.previousCandidatesByTarget.vault, { ordinal: 13, count: 1, previous: true, blocked: 'locked' });
  assert.ok(result.cases[2].issues.includes('producer_omitted'));
  assert.ok(result.cases[2].issues.includes('vault_locked'));
  const lines = api.runnerDependencyReferenceLines(ref).join(' ');
  assert.match(lines, /rodada anterior/);
  assert.match(lines, /falha fechada|bloqueado/);
  assert.doesNotMatch(lines, /pode usar captura do passo 13/);
  assert.doesNotMatch(lines, /passo 13/);
});

test('dataset inválido retorna issue fixa sem analisar como objeto vazio', () => {
  const { analyzeRunnerDependencies } = runnerLogic();
  const result = analyzeRunnerDependencies({ cases: [], datasets: [{ valid: true }, null], environment: {}, vault: {} });
  assert.equal(result.complete, false);
  assert.deepEqual(result.cases, []);
  assert.ok(result.issues.includes('invalid_dataset'));
});

test('UI usa analisador, extração compartilhada e revisão antes dos guards de reexecução', async () => {
  const app = fs.readFileSync(appPath, 'utf8');
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.match(html, /id="runner-dependency-summary"/);
  assert.match(html, /id="runner-dependency-details"/);
  assert.match(app, /RunnerLogic\.analyzeRunnerDependencies\(/);
  assert.match(app, /RunnerLogic\.createRunnerCases\(/);
  assert.match(app, /RunnerLogic\.templateFieldsFromSavedRequest\(/);
  assert.match(app, /RunnerLogic\.isValidCaptureVariableName\(/);
  const rerunStart = app.indexOf('async function rerunRunnerFailures(');
  const rerunEnd = app.indexOf('\nfunction activeWorkspaceTab(', rerunStart);
  const rerun = app.slice(rerunStart, rerunEnd);
  assert.ok(rerunStart >= 0 && rerunEnd > rerunStart);
  assert.ok(rerun.indexOf('confirmRunnerDependencyReview') < rerun.indexOf('confirmRunnerWrites'));
  assert.ok(rerun.indexOf('confirmRunnerDependencyReview') < rerun.indexOf('confirmRunnerRemoteHttp'));
  const start = app.slice(app.indexOf('async function startRunnerFromForm('), rerunStart);
  assert.ok(start.indexOf('refreshRunnerDependencyPreview') < start.indexOf('confirmRunnerWrites'));
  assert.ok(start.indexOf('refreshRunnerDependencyPreview') < start.indexOf('confirmRunnerRemoteHttp'));
});

test('revisão de reexecução cancela sem executar e não inclui produtores omitidos', async () => {
  const app = fs.readFileSync(appPath, 'utf8');
  const start = app.indexOf('async function confirmRunnerDependencyReview(');
  const end = app.indexOf('\nasync function rerunRunnerFailures(', start);
  assert.ok(start >= 0 && end > start);
  let dialog = null;
  const context = {
    confirmWithDialog: async options => { dialog = options; return false; },
    runnerDependencyIssueLabel: issue => issue
  };
  const api = vm.runInNewContext(`${app.slice(start, end)}; ({ confirmRunnerDependencyReview })`, context);
  const cases = [{ stepOrdinal: 1, datasetOrdinal: 1 }];
  const analysis = { complete: true, issues: [], cases: [{ caseOrdinal: 1, stepOrdinal: 1, datasetOrdinal: 1, issues: ['producer_omitted'], references: [], capture: null }] };
  const accepted = await api.confirmRunnerDependencyReview(cases, analysis);
  assert.equal(accepted, false);
  assert.ok(dialog);
  assert.match(dialog.description, /1/);
  assert.match(dialog.warning, /produtor|captura|rodada anterior/i);
  assert.equal(JSON.stringify(dialog).includes('SEGREDO'), false);
});

test('renderização mínima mantém resumo genérico, detalhes locais e estado parcial', () => {
  const app = fs.readFileSync(appPath, 'utf8');
  const start = app.indexOf('function runnerDependencyIssueLabel(');
  const end = app.indexOf('\nfunction analyzeRunnerDependencyCases(', start);
  assert.ok(start >= 0 && end > start);
  const node = () => ({ textContent: '', hidden: false, dataset: {}, className: '', children: [], append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = [...items]; } });
  const summary = node(), details = node(), nodes = new Map([['runner-dependency-summary', summary], ['runner-dependency-details', details]]);
  const context = { byId: id => nodes.get(id) || null, document: { createElement: () => node() }, runnerDependencyStale: false };
  const api = vm.runInNewContext(`${app.slice(start, end)}; ({ renderRunnerDependencies })`, context);
  const analysis = {
    analysisVersion: 1, complete: false, issues: ['reference_limit'],
    cases: [{
      caseOrdinal: 1, stepOrdinal: 1, datasetOrdinal: 2, issues: [],
      sources: { dataset: 0, 'pre-request': 0, vault: 0, environment: 0, locked: 0, unavailable: 0, missing: 1 },
      references: [{ name: 'token', field: 'headers', initialSource: 'missing', candidatesByTarget: {}, conditional: false, shadowed: false }],
      capture: null
    }]
  };
  api.renderRunnerDependencies(analysis);
  assert.match(summary.textContent, /1 passo/);
  assert.match(summary.textContent, /Análise parcial/);
  assert.equal(details.hidden, false);
  assert.equal(details.children.length, 1);
  assert.match(details.children[0].children[0].textContent, /Conjunto 2/);
  const text = details.children[0].children[1].children[0].children.map(item => item.textContent).join(' ');
  assert.match(text, /token/);
  assert.equal(text.includes('VALOR_CANARY'), false);
  api.renderRunnerDependencies({ analysisVersion: 1, complete: false, issues: ['invalid_dataset'], cases: [] });
  assert.equal(summary.textContent, 'Revise os conjuntos de dados');
});

test('snapshot de execução guarda apenas metadados mínimos e não muta a análise', () => {
  const app = fs.readFileSync(appPath, 'utf8');
  const start = app.indexOf('function createRunnerDependencyExecutionSnapshot(');
  const end = app.indexOf('\nfunction refreshRunnerDependencyPreview(', start);
  assert.ok(start >= 0 && end > start, 'snapshot helper should exist');
  const api = vm.runInNewContext(`${app.slice(start, end)}; ({ createRunnerDependencyExecutionSnapshot })`, {});
  const analysis = {
    analysisVersion: 1, complete: true, issues: [], cases: [
      { caseOrdinal: 1, stepOrdinal: 1, datasetOrdinal: 1, capture: { name: 'token', target: 'environment' }, references: [{ name: 'TOKEN_SENTINEL', initialSource: 'missing' }], issues: ['SENTINEL_ISSUE'] },
      { caseOrdinal: 2, stepOrdinal: 2, datasetOrdinal: 1, capture: null, references: [], issues: [] }
    ]
  };
  const snapshot = api.createRunnerDependencyExecutionSnapshot(analysis);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), {
    analysisVersion: 1,
    cases: [
      { caseOrdinal: 1, stepOrdinal: 1, datasetOrdinal: 1, capture: { name: 'token', target: 'environment' } },
      { caseOrdinal: 2, stepOrdinal: 2, datasetOrdinal: 1, capture: null }
    ]
  });
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.cases), true);
  assert.equal(JSON.stringify(snapshot).includes('TOKEN_SENTINEL'), false);
});

test('reexecução usa snapshot original quando a prévia é substituída por lock/dataset', async () => {
  const app = fs.readFileSync(appPath, 'utf8');
  const start = app.indexOf('async function rerunRunnerFailures(');
  const end = app.indexOf('\nfunction activeWorkspaceTab(', start);
  const snapshot = {
    analysisVersion: 1,
    cases: [
      { caseOrdinal: 1, stepOrdinal: 1, datasetOrdinal: 1, capture: { name: 'token', target: 'environment' } },
      { caseOrdinal: 2, stepOrdinal: 2, datasetOrdinal: 1, capture: null }
    ]
  };
  const calls = [];
  const context = {
    runnerBusy: false, runnerHistoryMutating: false,
    runnerFailedCases: [{ stepOrdinal: 2, datasetOrdinal: 1 }],
    runnerDependencyAnalysis: { cases: [], complete: true },
    runnerExecutionDependencySnapshot: snapshot,
    cancelRunnerDependencyPreviewTimer() {},
    runnerWriteCases: () => [],
    analyzeRunnerDependencyCases: (cases, options) => { calls.push({ cases, options }); return { cases: [{ issues: ['producer_omitted'] }], complete: true }; },
    confirmRunnerDependencyReview: async () => true,
    confirmRunnerWrites: async () => true,
    confirmRunnerRemoteHttp: async () => true,
    runRunnerCases: async () => {},
    renderRunnerDependencies() {},
    byId: () => ({ value: '0', checked: true }),
    showRunnerError() {}
  };
  const rerun = vm.runInNewContext(`${app.slice(start, end)}; rerunRunnerFailures`, context);
  await rerun();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].options.previousCaptures.map(item => ({ ...item })), [{ name: 'token', target: 'environment', caseOrdinal: 1, datasetOrdinal: 1 }]);
  assert.deepEqual(calls[0].options.includedPreviousOrdinals, [2]);
});

test('dois reruns consecutivos preservam ordem e produtor do snapshot original', async () => {
  const app = fs.readFileSync(appPath, 'utf8');
  const start = app.indexOf('async function rerunRunnerFailures(');
  const end = app.indexOf('\nfunction activeWorkspaceTab(', start);
  const snapshot = {
    analysisVersion: 1,
    cases: [
      { caseOrdinal: 1, stepOrdinal: 1, datasetOrdinal: 1, capture: { name: 'token', target: 'environment' } },
      { caseOrdinal: 2, stepOrdinal: 2, datasetOrdinal: 1, capture: null }
    ]
  };
  const calls = [];
  const context = {
    runnerBusy: false, runnerHistoryMutating: false,
    runnerFailedCases: [{ stepOrdinal: 2, datasetOrdinal: 1 }],
    runnerDependencyAnalysis: { cases: [], complete: true },
    runnerExecutionDependencySnapshot: snapshot,
    cancelRunnerDependencyPreviewTimer() {},
    runnerWriteCases: () => [],
    analyzeRunnerDependencyCases: (cases, options) => { calls.push(options); return { cases: [], complete: true }; },
    confirmRunnerDependencyReview: async () => true,
    confirmRunnerWrites: async () => true,
    confirmRunnerRemoteHttp: async () => true,
    runRunnerCases: async () => {},
    renderRunnerDependencies() {},
    byId: () => ({ value: '0', checked: true }),
    showRunnerError() {}
  };
  const rerun = vm.runInNewContext(`${app.slice(start, end)}; rerunRunnerFailures`, context);
  await rerun();
  context.runnerDependencyAnalysis = { cases: [{ capture: null }], complete: false };
  context.runnerFailedCases = [{ stepOrdinal: 2, datasetOrdinal: 1 }];
  await rerun();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => call.previousCaptures[0].caseOrdinal), [1, 1]);
  assert.deepEqual(calls.map(call => call.includedPreviousOrdinals), [[2], [2]]);
});

test('nova execução só grava snapshot depois dos guards aceitos', async () => {
  const app = fs.readFileSync(appPath, 'utf8');
  const start = app.indexOf('async function startRunnerFromForm(');
  const end = app.indexOf('\nasync function rerunRunnerFailures(', start);
  const preview = { cases: [{ caseOrdinal: 1, stepOrdinal: 1, datasetOrdinal: 1, capture: { name: 'token', target: 'environment' } }], complete: true };
  const runStart = remoteAccepted => {
    const state = { ran: false, snapshotAtRun: null, error: '' };
    const nodes = new Map([
      ['runner-datasets', { value: '' }],
      ['runner-delay', { value: '0' }],
      ['runner-stop-on-error', { checked: true }]
    ]);
    const context = {
      state, runnerBusy: false, runnerHistoryMutating: false, runnerEntries: [{ request: {} }], RUNNER_DEPENDENCY_CASE_LIMIT: 500,
      runnerDependencyAnalysis: preview, runnerExecutionDependencySnapshot: { original: true },
      byId: id => nodes.get(id) || null,
      clearRunnerError() {}, showRunnerError: message => { state.error = message; },
      cancelRunnerDependencyPreviewTimer() {},
      RunnerLogic: { parseDataSets: () => [{}], createRunnerCases: () => [{ stepOrdinal: 1, datasetOrdinal: 1 }] },
      refreshRunnerDependencyPreview: () => preview,
      runnerWriteCases: () => [],
      confirmRunnerWrites: async () => true,
      confirmRunnerRemoteHttp: async () => remoteAccepted,
      createRunnerDependencyExecutionSnapshot: analysis => ({ from: analysis }),
      runRunnerCases: async () => { state.ran = true; state.snapshotAtRun = context.runnerExecutionDependencySnapshot; }
    };
    const startRunner = vm.runInNewContext(`${app.slice(start, end)}; startRunnerFromForm`, context);
    return { state, context, startRunner };
  };

  const cancelled = runStart(false);
  await cancelled.startRunner({ preventDefault() {} });
  assert.equal(cancelled.state.ran, false);
  assert.deepEqual(cancelled.context.runnerExecutionDependencySnapshot, { original: true });

  const accepted = runStart(true);
  await accepted.startRunner({ preventDefault() {} });
  assert.equal(accepted.state.ran, true);
  assert.deepEqual(accepted.context.runnerExecutionDependencySnapshot, { from: preview });
  assert.deepEqual(accepted.state.snapshotAtRun, { from: preview });
});

test('debounce de datasets usa timer único curto e cancela pendências', () => {
  const app = fs.readFileSync(appPath, 'utf8');
  const start = app.indexOf('function cancelRunnerDependencyPreviewTimer(');
  const end = app.indexOf('\nfunction refreshRunnerDependencyPreview(', start);
  assert.ok(start >= 0 && end > start, 'debounce helpers should exist');
  let nextId = 1, renders = 0;
  const timers = [], cleared = [];
  const context = {
    runnerDependencyPreviewTimer: 0,
    byId: () => ({ open: true }), runnerEntries: [{}],
    RUNNER_DEPENDENCY_DEBOUNCE_MS: 150,
    setTimeout: (fn, ms) => { const id = nextId++; timers.push({ id, fn, ms }); return id; },
    clearTimeout: id => cleared.push(id),
    renderRunnerPlan: () => { renders++; }
  };
  const api = vm.runInNewContext(`${app.slice(start, end)}; ({ scheduleRunnerDependencyPreview, cancelRunnerDependencyPreviewTimer })`, context);
  api.scheduleRunnerDependencyPreview();
  const first = timers[0];
  api.scheduleRunnerDependencyPreview();
  assert.deepEqual(cleared, [first.id]);
  assert.equal(timers.at(-1).ms, 150);
  timers.at(-1).fn();
  assert.equal(renders, 1);
  api.scheduleRunnerDependencyPreview();
  const pending = timers.at(-1).id;
  api.cancelRunnerDependencyPreviewTimer();
  assert.ok(cleared.includes(pending));
});

test('plano limita origens a 500 casos e reutiliza o parse dos datasets', () => {
  const app = fs.readFileSync(appPath, 'utf8');
  const start = app.indexOf('function renderRunnerPlan(');
  const end = app.indexOf('\nasync function confirmRunnerDependencyReview(', start);
  assert.ok(start >= 0 && end > start);
  const node = () => ({ textContent: '', className: '', dataset: {}, children: [], append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = [...items]; }, setAttribute() {} });
  const list = node(), parsed = { datasets: Array.from({ length: 100 }, () => ({})) };
  let inspected = 0, refreshArg = null;
  const context = {
    RUNNER_DEPENDENCY_CASE_LIMIT: 500,
    byId: id => id === 'runner-plan-list' ? list : null,
    document: { createElement: () => node() },
    runnerDependencyDatasets: () => parsed,
    refreshRunnerDependencyPreview: value => { refreshArg = value; },
    inspectSavedRequestOriginsAcrossDatasets: (request, datasets) => { inspected += datasets.length; return { references: [], varying: false }; },
    formatInspectorOrigins: () => ''
  };
  const render = vm.runInNewContext(`${app.slice(start, end)}; renderRunnerPlan`, context);
  const entries = Array.from({ length: 6 }, (_, index) => ({ request: { method: 'GET', name: `R${index}`, route: `/${index}` }, path: `/${index}` }));
  render(entries);
  assert.ok(inspected <= 500, `inspection should be bounded, got ${inspected}`);
  assert.equal(refreshArg, parsed);
  assert.equal(list.children.length, entries.length + 1);
  assert.match(list.children.at(-1).textContent, /parcial|500/i);
});
