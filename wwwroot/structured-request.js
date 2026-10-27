(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./runner-logic.js') : root.ApiStudioRunner);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StructuredRequest = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (logic) {
  function blocked(code) {
    const error = new Error(code);
    error.code = code;
    return error;
  }

  function reviewDestination(value, secrets) {
    try {
      const origin = new URL(value).origin;
      if (Object.values(secrets || {}).some(secret => String(secret || '') && decodeURI(origin).toLowerCase().includes(String(secret).toLowerCase()))) return null;
      return origin;
    } catch { return null; }
  }

  function materializeSavedRequest(sources) {
    const saved = sources.saved;
    if (saved.tokenRequest) throw blocked('unsupported_preparation_action');
    if (saved.bodyMode === 'multipart' && (saved.multipartFields || []).some(field => field.type === 'file')) throw blocked('ephemeral_file_unavailable');
    if (saved.preRequestActionsEnabled !== false && (saved.preRequestActions || []).some(action => !['uuid', 'timestamp', 'template'].includes(action.type))) throw blocked('unsupported_preparation_action');
    try {
      const variables = sources.environment.variables || {};
      const preRequest = saved.preRequestActionsEnabled === false ? { variables: {}, provenance: {}, vaultSecrets: {} }
        : logic.runPreRequestActions(saved.preRequestActions, variables, {}, sources.vault);
      const call = logic.prepareSavedRequest(saved, variables, {}, true, sources.authScopes, sources.vault, preRequest.variables);
      const base = new URL(call.baseUrl);
      if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || !call.route || /[\r\n]/.test(call.route)) throw blocked('invalid_request');
      const insecureOrigin = logic.remoteHttpOrigin(call.baseUrl);
      if (insecureOrigin && !call.allowInsecureHttp) throw blocked('invalid_request');
      if (saved.captureResponseVariable) {
        if (!/^[A-Za-z0-9_.-]{1,80}$/.test(call.responseVariableName) || ['__proto__', 'prototype', 'constructor'].includes(call.responseVariableName)) throw blocked('invalid_request');
        if (call.responseValueSource === 'json') logic.parseJsonPath(call.responseJsonPath);
        if (call.responseCaptureTarget === 'vault' && !sources.vaultCaptureReady) throw blocked('vault_locked');
      }
      const secrets = { ...logic.secretValuesUsedByProvenance(call.resolutionProvenance, sources.vault), ...preRequest.vaultSecrets };
      for (const field of ['bearerToken', 'basicUsername', 'basicPassword', 'apiKeyValue']) if (call[field]) secrets[field] = call[field];
      const destination = reviewDestination(call.baseUrl, secrets);
      if (!destination) throw blocked('invalid_request');
      const warnings = [];
      if (logic.writeMethods.has(call.method)) warnings.push('write_operation');
      if (insecureOrigin) warnings.push('insecure_http');
      if (call.authType === 'apiKey' && call.apiKeyLocation === 'query') warnings.push('api_key_query');
      call.environmentId = sources.environment.id;
      call.collectionId = sources.origin.collectionId;
      call.folderId = sources.origin.folderId;
      call.preRequestSecretValues = preRequest.vaultSecrets;
      call.saveBearerToken = false;
      call.confirmTestData = false;
      call.testDataPhrase = '';
      const historyRequest = { ...call, ...saved, environmentId: call.environmentId, collectionId: call.collectionId, folderId: call.folderId, saveBearerToken: false };
      return {
        request: { method: call.method, call, historyRequest, secrets, origin: sources.origin, historySettings: sources.historySettings, sourceStamp: JSON.stringify(sources) },
        warnings,
        review: { method: call.method, destination, environment: sources.environment.name || sources.environment.id, testCount: call.responseTests.length, capture: call.captureResponseVariable, captureTarget: call.responseCaptureTarget, saveResponseBody: sources.historySettings.saveResponseBody }
      };
    } catch (error) {
      if (error.code) throw error;
      const code = /bloqueado|indisponível/.test(error.message) ? 'vault_locked'
        : /sem valor/.test(error.message) ? 'unresolved_variables' : 'invalid_request';
      throw blocked(code);
    }
  }

  return { materializeSavedRequest, reviewDestination };
});
