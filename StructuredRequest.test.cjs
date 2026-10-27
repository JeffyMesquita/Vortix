const assert = require('node:assert/strict');
const test = require('node:test');
const { materializeSavedRequest, reviewDestination } = require('./wwwroot/structured-request.js');

function sources(overrides = {}) {
  return {
    saved: { method: 'GET', baseUrl: '{{baseUrl}}', route: '/health', headers: '', responseTests: [] },
    environment: { id: 'test', variables: { baseUrl: 'http://127.0.0.1:51873' } },
    authScopes: [], vault: { locked: true, names: [] },
    origin: { tabId: 'tab1', requestId: 'r1', collectionId: 'c1', folderId: '' },
    historySettings: { limit: 50, saveResponseBody: false }, ...overrides
  };
}

test('saved preparation resolves the explicit environment without changing its source', () => {
  const source = sources(), before = JSON.stringify(source);
  const prepared = materializeSavedRequest(source);
  assert.equal(prepared.request.call.baseUrl, 'http://127.0.0.1:51873');
  assert.equal(prepared.request.call.environmentId, 'test');
  assert.equal(prepared.request.historyRequest.saveBearerToken, false);
  assert.equal(JSON.stringify(source), before);
});

test('preparation freezes dynamic actions once and preserves inherited auth without persisting it', () => {
  const source = sources({ saved: { method: 'POST', baseUrl: '{{baseUrl}}', route: '/{{id}}', authMode: 'inherit', preRequestActions: [{ type: 'uuid', name: 'id' }] }, authScopes: [{ auth: { authType: 'bearer', bearerToken: 'AUTH_SENTINEL' } }] });
  const prepared = materializeSavedRequest(source);
  assert.match(prepared.request.call.route, /^\/[a-f0-9-]{36}$/);
  assert.equal(prepared.request.call.bearerToken, 'AUTH_SENTINEL');
  assert.equal(prepared.request.historyRequest.saveBearerToken, false);
  assert.ok(prepared.warnings.includes('write_operation'));
});

test('errors are fixed codes, never raw templates, values or unsupported token flows', () => {
  for (const saved of [
    { baseUrl: '{{MISSING_SENTINEL}}', route: '/health' },
    { baseUrl: 'file:///tmp/SECRET_SENTINEL', route: '/health' },
    { tokenRequest: true },
    { bodyMode: 'multipart', multipartFields: [{ name: 'file', type: 'file', fileName: 'private.txt' }] }
  ]) {
    assert.throws(() => materializeSavedRequest(sources({ saved })), error => {
      assert.doesNotMatch(error.message, /SENTINEL|private/);
      return ['invalid_request', 'unresolved_variables', 'ephemeral_file_unavailable', 'unsupported_preparation_action'].includes(error.code);
    });
  }
});

test('review displays only origin, never path/query/credentials or secret host', () => {
  assert.equal(reviewDestination('https://user:password@example.test/private?token=SECRET', {}), 'https://example.test');
  assert.equal(reviewDestination('https://SECRET.example.test', { key: 'SECRET' }), null);
});

test('preparation rejects literal and resolved base URL queries and fragments before approval', () => {
  for (const baseUrl of ['https://api.example.test?tenant=QUERY_SENTINEL', 'https://api.example.test#FRAGMENT_SENTINEL']) {
    for (const saved of [{ baseUrl, route: '/health' }, { baseUrl: '{{baseUrl}}', route: '/health' }]) {
      const source = sources({ saved, environment: { id: 'test', variables: { baseUrl } } });
      assert.throws(() => materializeSavedRequest(source), error => error.code === 'invalid_request' && error.message === 'invalid_request');
    }
  }
});
