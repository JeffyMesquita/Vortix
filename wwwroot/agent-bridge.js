(() => {
  const byId = id => document.getElementById(id);
  const all = selector => Array.from(document.querySelectorAll(selector) || []);
  const nameOf = (element, attribute) => element?.dataset?.[attribute] || null;
  const contractVersion = () => {
    const value = Number(document.querySelector('meta[name="vortix-agent-contract"]')?.content);
    return Number.isInteger(value) && value > 0 ? value : null;
  };
  const valueOf = id => {
    const value = byId(id)?.value;
    return value === undefined || value === null || value === '' ? null : String(value);
  };
  const hasValue = id => Boolean(String(byId(id)?.value || '').trim());
  const authConfigured = () => {
    if (valueOf('auth-inheritance-mode') === 'none') return false;
    switch (valueOf('auth-type')) {
      case 'bearer': return hasValue('bearer-token');
      case 'basic': return hasValue('basic-username') || hasValue('basic-password');
      case 'apiKey': return hasValue('api-key-value');
      default: return false;
    }
  };
  const countChildren = id => byId(id)?.children?.length || 0;
  const responseState = () => {
    const status = byId('response-status');
    const states = ['idle', 'pending', 'ok', 'bad'];
    return states.find(state => status?.classList?.contains(state)) || 'unknown';
  };
  const responseStatusCode = () => {
    const match = String(byId('response-status')?.textContent || '').match(/(?:^|\D)([1-5]\d\d)(?:\D|$)/);
    return match ? Number(match[1]) : null;
  };

  function describe() {
    return {
      contractVersion: contractVersion(),
      readOnly: true,
      actions: all('[data-vortix-action]').map(element => ({
        name: nameOf(element, 'vortixAction'), id: element.id || null
      })),
      fields: all('[data-vortix-field]').map(element => ({
        name: nameOf(element, 'vortixField'),
        id: element.id || null,
        kind: element.type || element.tagName?.toLowerCase() || null,
        sensitive: element.type === 'password' || /auth|body|header|key|password|secret|token/i.test(nameOf(element, 'vortixField') || '')
      })),
      regions: all('[data-vortix-region]').map(element => ({
        name: nameOf(element, 'vortixRegion'), id: element.id || null
      })),
      editorTabs: all('[data-editor-tab]').map(element => ({
        name: element.dataset?.editorTab || null,
        id: element.id || null,
        panelId: element.getAttribute('aria-controls'),
        selected: element.getAttribute('aria-selected') === 'true'
      }))
    };
  }

  function snapshot() {
    const method = valueOf('method');
    const responseStateValue = responseState();
    const environments = byId('environment-select');
    const activeTab = document.querySelector('[data-editor-tab][aria-selected="true"]');
    return {
      contractVersion: contractVersion(),
      environment: {
        selected: Boolean(environments?.value),
        count: Math.max(0, (environments?.options?.length || 0) - 1)
      },
      workspace: {
        openRequestTabs: all('#workspace-tabs [role="tab"]').length,
        activeEditorTab: activeTab?.dataset?.editorTab || null
      },
      request: {
        method,
        baseUrlPresent: hasValue('base-url'),
        routePresent: hasValue('route'),
        paramsCount: countChildren('query-params'),
        headersPresent: hasValue('headers'),
        bodyPresent: hasValue('body'),
        bodyMode: valueOf('body-mode'),
        authType: valueOf('auth-type'),
        authConfigured: authConfigured(),
        authPersistenceEnabled: byId('save-token-history')?.checked === true,
        requiresWriteConfirmation: ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
      },
      response: {
        statusCode: responseStatusCode(),
        state: responseStateValue,
        available: responseStateValue === 'ok' || responseStateValue === 'bad'
      }
    };
  }

  window.vortixAgent = Object.freeze({
    contractVersion: contractVersion(),
    describe,
    snapshot
  });
})();
