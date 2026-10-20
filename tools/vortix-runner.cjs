#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const RunnerLogic = require('../wwwroot/runner-logic.js');

const usage = `Vortix Runner para CI

Uso:
  node tools/vortix-runner.cjs --collection <arquivo.vortix.json> --proxy http://127.0.0.1:51873 [opções]

Opções:
  --collection <arquivo>       Exportação de coleção Vortix JSON v2.
  --proxy <origem>             Proxy Vortix local em 127.0.0.1.
  --data <arquivo>             Array JSON de conjuntos de dados.
  --map-var <nome=ENV>         Mapeia variável Vortix a variável de processo; pode repetir.
  --junit <arquivo.xml>        Grava relatório JUnit.
  --delay <ms>                 Intervalo entre requests (0 a 5000; padrão 0).
  --stop-on-error              Para ao primeiro erro HTTP ou teste falho.
  --allow-writes               Permite POST, PUT, PATCH e DELETE.
  --confirm-test-data TESTE    Confirma gravações de teste; exige --allow-writes.
  --allow-insecure-http        Permite HTTP remoto quando request também autoriza.
  --help                       Exibe esta ajuda.

Segredos não devem ser passados como argumentos. Use --map-var e injete os valores pelo ambiente do processo.
`;

class CliError extends Error {}

function argumentValue(args, index, option) {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new CliError(`Informe um valor para ${option}.`);
  return value;
}

function parseMapVar(value) {
  const separator = value.indexOf('=');
  if (separator < 1 || separator === value.length - 1) throw new CliError('Use --map-var nome=VARIAVEL_DE_PROCESSO.');
  const name = value.slice(0, separator), environmentName = value.slice(separator + 1);
  if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/.test(name) || ['__proto__', 'prototype', 'constructor'].includes(name) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(environmentName)) {
    throw new CliError('Nome inválido em --map-var.');
  }
  return { name, environmentName };
}

function parseArguments(args) {
  const options = { collectionPath: '', proxy: '', dataPath: '', junitPath: '', mappings: [], delay: 0, allowWrites: false, confirmTestData: '', allowInsecureHttp: false, stopOnError: false, help: false };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--collection') options.collectionPath = argumentValue(args, index++, argument);
    else if (argument === '--proxy') options.proxy = argumentValue(args, index++, argument);
    else if (argument === '--data') options.dataPath = argumentValue(args, index++, argument);
    else if (argument === '--junit') options.junitPath = argumentValue(args, index++, argument);
    else if (argument === '--map-var') options.mappings.push(parseMapVar(argumentValue(args, index++, argument)));
    else if (argument === '--delay') {
      const value = argumentValue(args, index++, argument);
      if (!/^\d+$/.test(value) || Number(value) > 5000) throw new CliError('--delay precisa ser um inteiro entre 0 e 5000.');
      options.delay = Number(value);
    } else if (argument === '--allow-writes') options.allowWrites = true;
    else if (argument === '--confirm-test-data') options.confirmTestData = argumentValue(args, index++, argument);
    else if (argument === '--allow-insecure-http') options.allowInsecureHttp = true;
    else if (argument === '--stop-on-error') options.stopOnError = true;
    else throw new CliError('Opção desconhecida. Use --help para consultar as opções.');
  }
  if (options.help) return options;
  if (!options.collectionPath || !options.proxy) throw new CliError('Informe --collection e --proxy.');
  if (options.allowWrites && options.confirmTestData !== 'TESTE') throw new CliError('Gravações exigem --allow-writes --confirm-test-data TESTE.');
  if (!options.allowWrites && options.confirmTestData) throw new CliError('--confirm-test-data exige --allow-writes.');
  return options;
}

function parseProxyOrigin(value) {
  let proxy;
  try { proxy = new URL(value); } catch { throw new CliError('Proxy local inválido.'); }
  if (proxy.protocol !== 'http:' || proxy.hostname !== '127.0.0.1' || proxy.username || proxy.password || proxy.pathname !== '/' || proxy.search || proxy.hash) {
    throw new CliError('Proxy precisa usar HTTP em 127.0.0.1, sem caminho, credenciais ou query.');
  }
  return proxy.origin;
}

async function readJsonFile(filePath, label, maximumBytes = 15 * 1024 * 1024) {
  let text;
  try {
    const file = await fs.readFile(filePath);
    if (file.byteLength > maximumBytes) throw new CliError(`${label} ultrapassa o limite de tamanho.`);
    text = file.toString('utf8');
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(`Não foi possível ler ${label}.`);
  }
  try { return JSON.parse(text); }
  catch { throw new CliError(`${label} contém JSON inválido.`); }
}

function createEnvironment(document, mappings) {
  if (!document || typeof document !== 'object' || Array.isArray(document) || document.format !== 'api-studio-collection' || document.version !== 2 || !document.collection || typeof document.collection !== 'object' || Array.isArray(document.collection)) {
    throw new CliError('Use uma exportação de coleção Vortix JSON v2.');
  }
  if (!Array.isArray(document.collection.requests) || !Array.isArray(document.collection.folders)) throw new CliError('Estrutura da coleção Vortix está inválida.');
  const source = document.environment?.variables;
  if (source != null && (typeof source !== 'object' || Array.isArray(source))) throw new CliError('Variáveis do ambiente estão inválidas.');
  const environment = Object.create(null);
  for (const [name, value] of Object.entries(source || {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/.test(name) || ['__proto__', 'prototype', 'constructor'].includes(name)) throw new CliError('Nome de variável inválido no ambiente.');
    Object.defineProperty(environment, name, { value: String(value ?? ''), enumerable: true, writable: true, configurable: true });
  }
  const ciOverrides = Object.create(null);
  for (const mapping of mappings) {
    if (!Object.hasOwn(process.env, mapping.environmentName)) throw new CliError(`Variável de processo ausente: ${mapping.environmentName}.`);
    Object.defineProperty(ciOverrides, mapping.name, { value: process.env[mapping.environmentName], enumerable: true, writable: true, configurable: true });
  }
  return { environment, ciOverrides };
}

function isLoopbackHost(hostname) {
  const host = String(hostname).toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
}

function validatePreparedRequest(request, options) {
  let base;
  try { base = new URL(request.baseUrl); } catch { throw new CliError('Request contém URL base inválida.'); }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new CliError('URL base precisa ser HTTP ou HTTPS, sem credenciais, query ou fragmento.');
  if (base.protocol === 'http:' && !isLoopbackHost(base.hostname) && (!options.allowInsecureHttp || !request.allowInsecureHttp)) {
    throw new CliError('HTTP remoto exige --allow-insecure-http e autorização salva na request.');
  }
  const route = String(request.route || '');
  const rawPath = route.split('?')[0];
  let decodedPath;
  try { decodedPath = decodeURIComponent(rawPath); } catch { throw new CliError('Rota contém codificação inválida.'); }
  if (!route.startsWith('/') || route.startsWith('//') || route.includes('\\') || route.includes('#') || route.includes('://') || decodedPath.split('/').some(segment => segment === '.' || segment === '..')) {
    throw new CliError('Rota inválida.');
  }
}

function setVariable(target, name, value) {
  const key = String(name || '');
  if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key)) throw new CliError('Nome de variável de resposta inválido.');
  Object.defineProperty(target, key, { value: String(value), enumerable: true, writable: true, configurable: true });
}

function captureResponseVariable(request, response, environment) {
  if (!request.captureResponseVariable) return;
  if (request.responseSuccessOnly !== false && (response.status < 200 || response.status >= 300)) return;
  let value;
  try {
    if (request.responseValueSource === 'text') value = String(response.body ?? '');
    else value = RunnerLogic.jsonPathValue(JSON.parse(String(response.body ?? '')), request.responseJsonPath || 'access_token');
  } catch { throw new CliError('Falha ao capturar variável da resposta.'); }
  if (value === undefined) throw new CliError('Falha ao capturar variável da resposta.');
  setVariable(environment, request.responseVariableName || 'token', value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value));
}

function safeApiCall(request, options, environmentId) {
  const call = { ...request };
  for (const key of ['authMode', 'authSource', 'collectionId', 'folderId', 'graphqlQuery', 'graphqlVariables', 'graphqlOperationName', 'saveBearerToken', 'resolutionProvenance', 'responseCaptureTarget']) delete call[key];
  call.environmentId = environmentId;
  call.saveBearerToken = false;
  call.confirmTokenRequest = false;
  call.confirmTestData = options.allowWrites;
  call.testDataPhrase = options.allowWrites ? options.confirmTestData : '';
  return call;
}

async function timedFetch(url, init, timeoutMs = 30_000, externalSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromCaller = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener('abort', abortFromCaller, { once: true });
  try { return await fetch(url, { ...init, redirect: 'manual', signal: controller.signal }); }
  finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', abortFromCaller);
  }
}

async function assertProxyReady(origin, signal) {
  try {
    const response = await timedFetch(`${origin}/health`, { headers: { 'X-Api-Studio': '1' } }, 5_000, signal);
    const health = await response.json();
    if (!response.ok || health?.product !== 'VortixApiClient' || health?.hostingMode !== 'local') throw new Error();
  } catch { throw new CliError('Proxy Vortix local indisponível em /health.'); }
}

async function invokeProxy(origin, request, signal) {
  try {
    const response = await timedFetch(`${origin}/api/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Studio': '1', Origin: origin },
      body: JSON.stringify(request)
    }, 30_000, signal);
    if (response.status >= 300 && response.status < 400) {
      return { proxyStatus: response.status, result: { status: response.status, reason: '', headers: {}, body: '', error: 'proxy-redirect' } };
    }
    let result;
    try { result = await response.json(); } catch { throw new Error(); }
    return { proxyStatus: response.status, result };
  } catch { return { proxyStatus: 0, result: { status: 0, reason: '', headers: {}, body: '', error: 'local-proxy' } }; }
}

async function cleanupCookieJar(origin, environmentId) {
  try {
    const key = encodeURIComponent(`cookiejar:${environmentId}`);
    const response = await timedFetch(`${origin}/api/storage/settings?key=${key}`, { method: 'DELETE', headers: { 'X-Api-Studio': '1', Origin: origin } }, 5_000);
    return response.ok;
  } catch { return false; }
}

function formatJunit(results, durationMs) {
  const failures = results.filter(result => result.outcome === 'failed').length;
  const skipped = results.filter(result => result.outcome === 'skipped').length;
  const cases = results.map((result, index) => {
    const time = (result.durationMs / 1000).toFixed(3);
    const name = `Request ${index + 1}`;
    if (result.outcome === 'skipped') return `  <testcase classname="Vortix.Runner" name="${name}" time="${time}"><skipped/></testcase>`;
    if (result.outcome === 'failed') {
      const message = result.status ? `Request or response checks failed (HTTP ${result.status}).` : 'Request or response checks failed.';
      return `  <testcase classname="Vortix.Runner" name="${name}" time="${time}"><failure message="${message}" type="VortixRunnerFailure"/></testcase>`;
    }
    return `  <testcase classname="Vortix.Runner" name="${name}" time="${time}"/>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="Vortix Runner" tests="${results.length}" failures="${failures}" skipped="${skipped}" time="${(durationMs / 1000).toFixed(3)}">\n${cases.join('\n')}\n</testsuite>\n`;
}

function requestResult(durationMs, status, outcome) {
  return { outcome, durationMs: Math.max(0, durationMs), status: Number(status) || 0 };
}

function waitBeforeNextRequest(delayMs, signal) {
  if (delayMs <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise(resolve => {
    let timer;
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    timer = setTimeout(finish, delayMs);
    if (signal?.aborted) finish();
    else signal?.addEventListener('abort', finish, { once: true });
  });
}

function mergeEnvironment(environment, capturedVariables, ciOverrides) {
  return Object.assign(Object.create(null), environment, capturedVariables, ciOverrides);
}

function planCases(entries, datasets, environment, ciOverrides, options, environmentId) {
  const planned = [], planningCaptures = Object.create(null);
  for (const dataset of datasets) {
    for (const entry of entries) {
      const request = RunnerLogic.prepareSavedRequest(entry.request, mergeEnvironment(environment, planningCaptures, ciOverrides), dataset, options.allowWrites, entry.authScopes || []);
      request.environmentId = environmentId;
      validatePreparedRequest(request, options);
      planned.push({ entry, dataset });
      if (request.captureResponseVariable) setVariable(planningCaptures, request.responseVariableName || 'token', 'VORTIX_PREFLIGHT_CAPTURE');
    }
  }
  return planned;
}

async function executeCases(cases, environment, ciOverrides, options, origin, environmentId, signal) {
  const results = [];
  const capturedVariables = Object.create(null);
  let stopped = false, cancelled = false;
  for (let caseIndex = 0; caseIndex < cases.length; caseIndex++) {
    if (stopped || signal?.aborted) {
      if (signal?.aborted) cancelled = true;
      results.push(requestResult(0, 0, 'skipped'));
      continue;
    }
    const { entry, dataset } = cases[caseIndex], started = Date.now();
    let outcome = 'passed', status = 0;
    try {
      const request = RunnerLogic.prepareSavedRequest(entry.request, mergeEnvironment(environment, capturedVariables, ciOverrides), dataset, options.allowWrites, entry.authScopes || []);
      request.environmentId = environmentId;
      validatePreparedRequest(request, options);
      const { proxyStatus, result } = await invokeProxy(origin, safeApiCall(request, options, environmentId), signal);
      if (signal?.aborted) {
        cancelled = true;
        outcome = 'skipped';
      } else {
        status = Number(result?.status) || 0;
        const tests = RunnerLogic.evaluateResponseTests(request.responseTests, result || {});
        const hasTests = tests.length > 0, failedTests = tests.some(item => !item.passed);
        const httpFailed = !!result?.error || proxyStatus >= 400 || status < 200 || status >= 300 && !hasTests;
        if (httpFailed || failedTests) outcome = 'failed';
        if (!httpFailed && status >= 200 && status < 300) captureResponseVariable(request, result, capturedVariables);
      }
    } catch { outcome = 'failed'; }
    results.push(requestResult(Date.now() - started, status, outcome));
    if (outcome === 'failed' && options.stopOnError) stopped = true;
    if (options.delay > 0 && caseIndex < cases.length - 1 && !stopped && !cancelled) await waitBeforeNextRequest(options.delay, signal);
  }
  return { results, cancelled };
}

async function canonicalPath(filePath) {
  const absolute = path.resolve(filePath);
  try { return await fs.realpath(absolute); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = path.dirname(absolute);
    if (parent === absolute) throw error;
    return path.join(await canonicalPath(parent), path.basename(absolute));
  }
}

async function validateReportPath(reportPath, inputPaths) {
  if (path.extname(reportPath).toLowerCase() !== '.xml') throw new CliError('O relatório JUnit precisa usar a extensão .xml.');
  try {
    const info = await fs.lstat(reportPath);
    if (info.isSymbolicLink() || !info.isFile()) throw new CliError('O relatório JUnit precisa ser um arquivo regular, sem link simbólico.');
  } catch (error) {
    if (error instanceof CliError) throw error;
    if (error.code !== 'ENOENT') throw new CliError('Não foi possível validar o caminho do relatório JUnit.');
  }
  const comparable = value => process.platform === 'win32' ? value.toLowerCase() : value;
  const reportCanonical = comparable(await canonicalPath(reportPath));
  const protectedPaths = [...inputPaths, __filename, require.resolve('../wwwroot/runner-logic.js')];
  for (const protectedPath of protectedPaths) {
    const resolvedProtected = comparable(await canonicalPath(protectedPath));
    if (reportCanonical === resolvedProtected) throw new CliError('Relatório JUnit precisa usar arquivo separado da coleção, dos dados e dos arquivos do Runner.');
    try {
      const [reportInfo, protectedInfo] = await Promise.all([fs.stat(reportPath), fs.stat(protectedPath)]);
      if (reportInfo.dev === protectedInfo.dev && reportInfo.ino === protectedInfo.ino) throw new CliError('Relatório JUnit não pode substituir arquivos de entrada ou do Runner.');
    } catch (error) {
      if (error instanceof CliError) throw error;
      if (error.code !== 'ENOENT') throw new CliError('Não foi possível validar o caminho do relatório JUnit.');
    }
  }
}

async function readDataSets(filePath) {
  if (!filePath) return RunnerLogic.parseDataSets('');
  let fileInfo;
  try { fileInfo = await fs.stat(filePath); }
  catch { throw new CliError('Não foi possível ler os dados de execução.'); }
  if (!fileInfo.isFile()) throw new CliError('Os dados de execução precisam estar em um arquivo.');
  if (fileInfo.size > 100_000) throw new CliError('Os dados de execução ultrapassam 100 KB.');
  let handle, source;
  try {
    handle = await fs.open(filePath, 'r');
    const chunks = [];
    let totalBytes = 0;
    while (totalBytes <= 100_000) {
      const buffer = Buffer.alloc(Math.min(8192, 100_001 - totalBytes));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      totalBytes += bytesRead;
      if (totalBytes > 100_000) throw new CliError('Os dados de execução ultrapassam 100 KB.');
      chunks.push(buffer.subarray(0, bytesRead));
    }
    source = Buffer.concat(chunks, totalBytes).toString('utf8');
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError('Não foi possível ler os dados de execução.');
  } finally {
    await handle?.close().catch(() => {});
  }
  try { return RunnerLogic.parseDataSets(source); }
  catch { throw new CliError('Os dados de execução precisam ser um array JSON válido de até 100 KB.'); }
}

async function main(args = process.argv.slice(2)) {
  let options;
  try { options = parseArguments(args); }
  catch (error) { process.stderr.write(`${error.message}\nUse --help para consultar as opções.\n`); return 2; }
  if (options.help) { process.stdout.write(usage); return 0; }
  let origin = '', environmentId = '', proxyReady = false, cookieJarCleaned = false;
  const cancellation = new AbortController();
  const cancel = () => cancellation.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    if (options.junitPath) await validateReportPath(path.resolve(options.junitPath), [options.collectionPath, options.dataPath].filter(Boolean));
    origin = parseProxyOrigin(options.proxy);
    const document = await readJsonFile(options.collectionPath, 'coleção');
    const { environment, ciOverrides } = createEnvironment(document, options.mappings);
    const entries = RunnerLogic.flattenRequests(document.collection);
    if (!entries.length) throw new CliError('A coleção não contém requests.');
    const datasets = await readDataSets(options.dataPath);
    if (entries.length * datasets.length > 500) throw new CliError('A execução excede o limite de 500 requests.');
    if (entries.some(entry => RunnerLogic.writeMethods.has(String(entry.request.method || 'GET').toUpperCase())) && (!options.allowWrites || options.confirmTestData !== 'TESTE')) {
      throw new CliError('A coleção inclui gravações. Use --allow-writes --confirm-test-data TESTE para autorizá-las.');
    }
    environmentId = `vortix-runner-${crypto.randomUUID()}`;
    const cases = planCases(entries, datasets, environment, ciOverrides, options, environmentId);
    await assertProxyReady(origin, cancellation.signal);
    proxyReady = true;
    const started = Date.now();
    const { results, cancelled } = await executeCases(cases, environment, ciOverrides, options, origin, environmentId, cancellation.signal);
    const durationMs = Date.now() - started;
    let cleanupSucceeded = true;
    try { cleanupSucceeded = await cleanupCookieJar(origin, environmentId); } catch { cleanupSucceeded = false; }
    cookieJarCleaned = cleanupSucceeded;
    if (!cleanupSucceeded) throw new CliError('Não foi possível limpar o Cookie jar temporário do proxy.');
    if (options.junitPath) {
      try {
        await fs.mkdir(path.dirname(path.resolve(options.junitPath)), { recursive: true });
        await fs.writeFile(options.junitPath, formatJunit(results, durationMs), 'utf8');
      } catch { throw new CliError('Não foi possível gravar o relatório JUnit.'); }
    }
    const failed = results.filter(result => result.outcome === 'failed').length;
    const skipped = results.filter(result => result.outcome === 'skipped').length;
    const passed = results.length - failed - skipped;
    process.stdout.write(`Runner: ${passed} concluídas, ${failed} falhas, ${skipped} ignoradas.\n`);
    if (cancelled || cancellation.signal.aborted) return 130;
    return failed ? 1 : 0;
  } catch (error) {
    if (proxyReady && environmentId && !cookieJarCleaned) {
      cookieJarCleaned = await cleanupCookieJar(origin, environmentId);
    }
    if (cancellation.signal.aborted) {
      if (proxyReady && environmentId && !cookieJarCleaned) process.stderr.write('Runner interrompido; não foi possível limpar o Cookie jar temporário.\n');
      else process.stderr.write('Runner interrompido.\n');
      return 130;
    }
    const message = error instanceof CliError ? error.message : 'Falha ao preparar ou executar o Runner.';
    process.stderr.write(`${message}\n`);
    return 2;
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}

module.exports = { main };

if (require.main === module) {
  main().then(code => { process.exitCode = code; }).catch(() => {
    process.stderr.write('Falha interna no Runner CLI.\n');
    process.exitCode = 2;
  });
}
