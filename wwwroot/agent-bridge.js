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
  const bodyPresent = () => {
    const mode = valueOf('body-mode');
    if (mode === 'graphql') return hasValue('graphql-query');
    if (mode === 'multipart') {
      return Array.from(byId('multipart-fields-list')?.children || []).some(row => {
        const fieldValue = selector => row.querySelector(selector)?.value;
        const file = row.querySelector('[data-multipart-file]');
        return Boolean(
          String(fieldValue('[data-multipart-name]') || '').trim() ||
          String(fieldValue('[data-multipart-value]') || '').trim() ||
          file?.files?.length ||
          row.dataset?.savedFileName
        );
      });
    }
    return hasValue('body');
  };
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
  const countEnvironments = select => Array.from(select?.options || [])
    .filter(option => String(option?.value ?? '').trim() !== '').length;
  const responseState = () => {
    const status = byId('response-status');
    const states = ['idle', 'pending', 'ok', 'bad'];
    return states.find(state => status?.classList?.contains(state)) || 'unknown';
  };
  const responseStatusCode = () => {
    const match = String(byId('response-status')?.textContent || '').match(/(?:^|\D)([1-5]\d\d)(?:\D|$)/);
    return match ? Number(match[1]) : null;
  };

  const controlState = element => {
    const state = {};
    if ('disabled' in element) state.disabled = Boolean(element.disabled);
    const expanded = element.getAttribute?.('aria-expanded');
    if (expanded === 'true' || expanded === 'false') state.expanded = expanded === 'true';
    else if ('open' in element) state.expanded = Boolean(element.open);
    return state;
  };

  function describe(options) {
    const regionName = options?.region;
    const hasRegion = regionName !== undefined;
    const region = typeof regionName === 'string'
      ? all('[data-vortix-region]').find(element => nameOf(element, 'vortixRegion') === regionName)
      : null;
    const includeState = options?.includeState === true;
    const select = selector => {
      const elements = all(selector);
      if (!hasRegion) return elements;
      if (!region) return [];
      return elements.filter(element => element === region || region.contains?.(element));
    };
    const withState = (element, description) => {
      if (!includeState) return description;
      const state = controlState(element);
      return Object.keys(state).length ? { ...description, state } : description;
    };

    return {
      contractVersion: contractVersion(),
      readOnly: true,
      actions: select('[data-vortix-action]').map(element => withState(element, {
        name: nameOf(element, 'vortixAction'), id: element.id || null
      })),
      fields: select('[data-vortix-field]').map(element => withState(element, {
        name: nameOf(element, 'vortixField'),
        id: element.id || null,
        kind: element.type || element.tagName?.toLowerCase() || null,
        sensitive: element.type === 'password' || /auth|body|header|key|password|secret|token/i.test(nameOf(element, 'vortixField') || '')
      })),
      regions: select('[data-vortix-region]').map(element => withState(element, {
        name: nameOf(element, 'vortixRegion'), id: element.id || null
      })),
      editorTabs: select('[data-editor-tab]').map(element => ({
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
        count: countEnvironments(environments)
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
        bodyPresent: bodyPresent(),
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
