(function (root) {
  function attach(adapters) {
    const field = id => document.getElementById(id);
    const card = field('structured-card'), prepare = field('structured-prepare'), approve = field('structured-approve'), execute = field('structured-execute'), cancel = field('structured-cancel');
    const status = field('structured-status'), review = field('structured-review'), writeGuard = field('structured-write-guard');
    const diagnosticSummary = field('structured-diagnostic-summary'), diagnosticGo = field('structured-diagnostic-go'), diagnostics = root.VortixDiagnostics;
    const controlElements = {
      'request.save': 'save-collection-request', 'environment.manage': 'manage-environments-direct', 'settings.open': 'manage-environments',
      'execution.prepare': 'structured-prepare', 'execution.review': 'structured-approve', 'execution.execute': 'structured-execute'
    };
    const regionFocusElements = { collections: 'collections-tree', 'request-editor': 'method', 'request-workspace': 'method' };
    const errors = {
      request_not_saved: 'Salve a request para preparar uma execução revisada.',
      unsaved_changes: 'Salve as alterações da request antes de preparar.',
      write_confirmation_required: 'Confirme a proteção de escrita manualmente antes de revisar.',
      context_changed: 'O contexto mudou; o resultado anterior não representa a request ativa.',
      diagnostic_unavailable: 'Diagnóstico indisponível.',
      diagnostic_stale: 'Diagnóstico antigo; atualize o painel para consultar o estado atual.',
      request_not_found: 'Request salva não encontrada.', environment_not_found: 'Selecione um ambiente disponível.',
      unresolved_variables: 'Há variáveis sem valor. Revise o ambiente e prepare novamente.', vault_locked: 'Desbloqueie o cofre do ambiente e prepare novamente.',
      invalid_request: 'Revise URL, dados e configurações da request salva.', ephemeral_file_unavailable: 'Arquivos efêmeros exigem o envio manual.',
      unsupported_preparation_action: 'Este fluxo exige o envio manual.', approval_required: 'Revise e aprove a preparação antes de executar.',
      preparation_expired: 'Preparação expirada. Prepare novamente.', preparation_invalidated: 'Dados alterados. Prepare e aprove novamente.',
      preparation_cancelled: 'Preparação cancelada; nenhuma chamada iniciada.', execution_in_progress: 'Aguarde a execução em andamento.'
    };
    let preparation = null, executionId = '', materialized = null, sourcesStamp = '', target = null, approved = false, expiresAt = 0, disposed = false;
    let diagnosticRecord = null, diagnosticOrigin = null, diagnosticOriginRevision = null, diagnosticTarget = null, diagnosticBlockers = [];
    const controller = root.StructuredExecution.createStructuredExecution({
      now: () => performance.now(), newId: () => crypto.randomUUID(), readSources: adapters.readSources,
      materialize: sources => { materialized = adapters.materialize(sources); return materialized; }, run: adapters.run
    });
    const message = text => { if (status.textContent !== text) status.textContent = text; };
    function nodeAvailable(node) {
      if (!node || node.hidden || node.disabled || node.inert || document.querySelector('dialog[open]')) return false;
      for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
        if (ancestor.hidden || ancestor.inert || ancestor.getAttribute?.('aria-hidden') === 'true') return false;
        const tagName = String(ancestor.tagName || '').toLowerCase();
        if (tagName === 'dialog' && !ancestor.open) return false;
        if (tagName === 'details' && !ancestor.open) return false;
      }
      return true;
    }
    function controlAvailability() {
      const controls = {};
      for (const controlName of Object.keys(controlElements)) controls[controlName] = nodeAvailable(field(controlElements[controlName]));
      return controls;
    }
    function safeDiagnosticBlockers(codes) {
      const unique = [];
      for (const code of Array.isArray(codes) ? codes : []) {
        try {
          if (diagnostics.blockerDefinition(code).code === code && !unique.includes(code)) unique.push(code);
        } catch {}
      }
      return unique;
    }
    function diagnosticFocusNode(target) {
      if (!target || typeof target.name !== 'string') return null;
      if (target.kind === 'action') return field(controlElements[target.name]);
      if (target.name === 'structured-execution') return card.querySelector('summary') || field('structured-status');
      return field(regionFocusElements[target.name]);
    }
    function resultFacts(result) {
      const outcomes = new Set(['success', 'http_error', 'assertion_failed', 'transport_error', 'local_error', 'unknown']);
      const deliveries = new Set(['not_sent', 'response_received', 'unknown']);
      const captures = new Set(['not_requested', 'completed', 'failed', 'skipped']);
      const persistence = new Set(['not_requested', 'completed', 'failed']);
      const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
      const httpStatus = value => Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
      const assertions = result?.assertions || {};
      return {
        outcome: outcomes.has(result?.outcome) ? result.outcome : 'unknown',
        delivery: deliveries.has(result?.delivery) ? result.delivery : 'unknown',
        httpStatus: httpStatus(result?.httpStatus), proxyStatus: httpStatus(result?.proxyStatus),
        durationMs: typeof result?.durationMs === 'number' && Number.isFinite(result.durationMs) && result.durationMs >= 0 ? result.durationMs : 0,
        assertions: { passed: count(assertions.passed), failed: count(assertions.failed), partial: count(assertions.partial) },
        capture: captures.has(result?.capture) ? result.capture : 'not_requested',
        persistence: persistence.has(result?.persistence) ? result.persistence : 'not_requested'
      };
    }
    function diagnosticText(record) {
      if (record.state === 'blocked') return errors[record.blocker] || 'Impedimento conhecido; confira a bancada.';
      if (record.state === 'unknown') return errors[record.blocker] || errors.diagnostic_unavailable;
      if (record.state === 'unavailable') return errors.diagnostic_unavailable;
      if (record.state === 'ready_for_review') return 'Preparação pronta para revisão manual.';
      if (record.state === 'approved') return 'Aprovação observada; o envio continua sujeito aos controles existentes.';
      if (record.state === 'running') return 'Execução em andamento. Não repita o envio.';
      if (record.state === 'completed' && record.result) {
        const deliveries = { not_sent: 'não enviada', response_received: 'resposta recebida', unknown: 'desconhecida' };
        const validations = { not_run: 'validação não executada', passed: 'validação aprovada', failed: 'validação reprovada', partial: 'validação parcial' };
        return `Resultado ${record.result.outcome}; entrega ${deliveries[record.result.delivery]}; HTTP ${record.result.httpStatus ?? 'sem resposta'}; ${validations[record.result.validation]}.`;
      }
      return 'Sem preparação para a request ativa.';
    }
    function invalidateDiagnosticContext() {
      card.removeAttribute('data-vortix-diagnostic');
      diagnosticSummary.textContent = '';
      diagnosticGo.hidden = true;
      diagnosticTarget = null;
    }
    function publishDiagnostic(running, executionSummary, readinessOverride) {
      if (!diagnostics?.buildRecord) {
        invalidateDiagnosticContext();
        diagnosticSummary.textContent = errors.diagnostic_unavailable;
        return;
      }
      let readiness = readinessOverride || null;
      if (!readiness) {
        try { readiness = adapters.getDiagnosticReadiness(diagnosticOrigin || adapters.getTarget()); }
        catch { readiness = null; }
      }
      if (!readiness) readiness = { blocker: 'diagnostic_unavailable', contextMatches: false, origin: null, revision: null };
      let contextMatches = readiness.contextMatches === true;
      const revisionChanged = !!diagnosticOrigin && readiness.revision !== diagnosticOriginRevision;
      if (diagnosticOrigin && !revisionChanged) contextMatches = readiness.contextMatches === true;
      if (diagnosticOrigin && revisionChanged) contextMatches = false;
      if (!executionId && !preparation?.preparationId && (!diagnosticOrigin || revisionChanged || !contextMatches)) {
        if (revisionChanged || !contextMatches) diagnosticBlockers = [];
        if (!contextMatches) {
          try { readiness = adapters.getDiagnosticReadiness(); } catch { readiness = null; }
        }
        diagnosticOrigin = readiness?.origin || null;
        diagnosticOriginRevision = readiness?.revision ?? null;
        contextMatches = readiness?.contextMatches === true;
      }
      let state = 'idle', blockers = [], result = null;
      if (running) state = 'running';
      else if (executionId && executionSummary && !executionSummary.error) {
        if (contextMatches) { state = 'completed'; result = resultFacts(executionSummary); }
        else { state = 'unknown'; blockers = ['context_changed']; }
      } else if (executionId) { state = 'unknown'; blockers = ['diagnostic_unavailable']; }
      else if (!contextMatches) { state = 'unknown'; blockers = ['context_changed']; }
      else if (diagnosticBlockers.length) { state = 'blocked'; blockers = diagnosticBlockers; }
      else if (readiness.blocker) { state = 'blocked'; blockers = [readiness.blocker]; }
      else if (preparation?.preparationId) {
        const writeReady = writeGuard.hidden || (field('structured-confirm').checked && field('structured-phrase').value.trim() === 'TESTE');
        if (approved) state = 'approved';
        else if (!writeReady) { state = 'blocked'; blockers = ['write_confirmation_required']; }
        else state = 'ready_for_review';
      }
      const controls = controlAvailability();
      const facts = {
        state, contextMatches, validUntilMs: state === 'ready_for_review' || state === 'approved' ? expiresAt : null,
        blockers, result, controls
      };
      try {
        diagnosticRecord = diagnostics.buildRecord(facts, diagnosticRecord, performance.now());
        card.dataset.vortixDiagnostic = JSON.stringify(diagnosticRecord);
        const summaryText = diagnosticText(diagnosticRecord);
        if (diagnosticSummary.textContent !== summaryText) diagnosticSummary.textContent = summaryText;
        diagnosticTarget = diagnosticRecord.blocker ? diagnostics.blockerDefinition(diagnosticRecord.blocker) : null;
        const focusTarget = diagnosticFocusNode(diagnosticTarget?.target);
        const focusAvailable = diagnosticTarget?.target?.kind === 'action'
          ? controls[diagnosticTarget.target.name] === true
          : nodeAvailable(focusTarget);
        diagnosticGo.hidden = !focusTarget || !focusAvailable;
      } catch {
        invalidateDiagnosticContext();
        diagnosticSummary.textContent = errors.diagnostic_unavailable;
      }
    }
    diagnosticGo.onclick = () => {
      if (!diagnosticTarget?.target) return;
      card.open = true;
      const target = diagnosticFocusNode(diagnosticTarget.target);
      if (nodeAvailable(target)) target.focus();
    };
    function rememberDiagnosticOrigin(source) {
      try {
        const readiness = adapters.getDiagnosticReadiness(source);
        diagnosticOrigin = readiness?.origin || null;
        diagnosticOriginRevision = readiness?.revision ?? null;
      } catch { diagnosticOrigin = null; diagnosticOriginRevision = null; }
    }
    function reset(code) {
      if (preparation?.preparationId) controller.cancelFromUi(preparation.preparationId);
      preparation = null; approved = false; materialized = null; sourcesStamp = ''; review.hidden = true;
      if (!executionId) {
        diagnosticOrigin = null; diagnosticOriginRevision = null;
        diagnosticBlockers = safeDiagnosticBlockers(code ? [code] : []);
      }
      field('structured-confirm').checked = false; field('structured-phrase').value = '';
      message(errors[code] || 'Salve e selecione uma request para preparar.');
    }
    function refresh() {
      if (disposed) return;
      let readiness = null;
      try { readiness = adapters.getDiagnosticReadiness(diagnosticOrigin || target || adapters.getTarget()); }
      catch {}
      let diagnosticContextMatches = readiness?.contextMatches === true;
      if (diagnosticOrigin && readiness?.revision !== diagnosticOriginRevision) diagnosticContextMatches = false;
      let running = false, executionSummary = null;
      if (executionId) {
        const result = controller.get_execution({ executionId });
        executionSummary = result;
        running = result.state === 'running';
        if (running) message('Executando preparação. Aguarde; não repita o envio.');
        else if (!result.error) {
          const outcome = result.outcome === 'success' && result.assertions?.partial > 0 ? 'validação parcial' : { success: 'concluído', http_error: 'erro HTTP', assertion_failed: 'teste reprovado', transport_error: 'falha de transporte', local_error: 'falha local', unknown: 'resultado desconhecido' }[result.outcome] || 'resultado desconhecido';
          const effect = { not_requested: 'não solicitada', completed: 'confirmado', failed: 'falhou', skipped: 'não aplicada' };
          message(`Execução ${executionId}: ${outcome}. HTTP ${result.httpStatus ?? 'sem resposta'}; testes ${result.assertions?.passed || 0} aprovados, ${result.assertions?.failed || 0} reprovados, ${result.assertions?.partial || 0} parciais. Captura: ${effect[result.capture] || 'desconhecida'}. Histórico: ${effect[result.persistence] || 'desconhecido'}.${result.delivery === 'unknown' ? ' Entrega desconhecida; confira a API antes de repetir.' : ''}`);
          materialized = null;
        }
      } else if (preparation?.preparationId) {
        try {
          if (performance.now() >= expiresAt) reset('preparation_expired');
          else if (!readiness || readiness.revision !== diagnosticOriginRevision) reset('preparation_invalidated');
          else if (readiness.contextMatches && JSON.stringify(adapters.readSources(target)) !== sourcesStamp) reset('preparation_invalidated');
        } catch { reset('preparation_invalidated'); }
      }
      const writeReady = !writeGuard.hidden ? field('structured-confirm').checked && field('structured-phrase').value.trim() === 'TESTE' : true;
      prepare.disabled = running || adapters.isBusy() || !adapters.getTarget();
      approve.disabled = !preparation?.preparationId || approved || running || !!executionId || !writeReady || !diagnosticContextMatches;
      execute.disabled = !approved || running || !!executionId || adapters.isBusy() || !diagnosticContextMatches;
      cancel.disabled = !preparation?.preparationId || running || !!executionId || !diagnosticContextMatches;
      publishDiagnostic(running, executionSummary, readiness);
    }
    prepare.onclick = () => {
      if (adapters.isBusy()) return;
      reset(); executionId = ''; target = adapters.getTarget();
      if (!target) { refresh(); return; }
      rememberDiagnosticOrigin(target);
      try {
        sourcesStamp = JSON.stringify(adapters.readSources(target));
        preparation = controller.prepare_request(target);
        if (!preparation.preparationId) {
          diagnosticBlockers = safeDiagnosticBlockers(preparation.blockers?.length ? preparation.blockers : [preparation.error]);
          message(errors[preparation.blockers?.[0]] || errors[preparation.error] || errors.invalid_request); refresh(); return;
        }
        diagnosticBlockers = [];
        expiresAt = performance.now() + preparation.expiresInSeconds * 1000;
        const preview = materialized.review;
        field('structured-destination').textContent = `${preview.method} · ${preview.destination} · Ambiente: ${preview.environment}`;
        field('structured-effects').textContent = `Confira a rota na request salva. ${preview.testCount} teste(s) configurado(s). Histórico sem credenciais de Auth; body ${preview.saveResponseBody ? 'retido conforme configurações' : 'não retido'}. ${preview.capture ? `Captura configurada será aplicada ao ${preview.captureTarget === 'vault' ? 'cofre' : 'ambiente'} revisado.` : 'Sem captura de variáveis.'}${preparation.warnings?.includes('insecure_http') ? ' Atenção: HTTP sem TLS.' : ''}${preparation.warnings?.includes('api_key_query') ? ' Atenção: API Key na query pode aparecer em logs da API.' : ''}`;
        writeGuard.hidden = !['POST', 'PUT', 'PATCH', 'DELETE'].includes(preview.method);
        review.hidden = false; card.open = true; message('Preparação pronta para revisão. Nenhuma chamada enviada.');
      } catch { reset('invalid_request'); }
      refresh();
    };
    approve.onclick = async () => {
      refresh(); if (approve.disabled) return;
      const currentId = preparation.preparationId;
      const confirmation = adapters.confirmReview(materialized.review);
      refresh();
      const accepted = await confirmation;
      refresh();
      if (!accepted || currentId !== preparation?.preparationId || approve.disabled) { approve.focus(); return; }
      const result = controller.approveFromUi(currentId);
      if (result.error) reset(result.error);
      else { approved = true; message('Preparação aprovada uma vez. Executar iniciará a chamada revisada.'); }
      refresh(); if (approved) execute.focus();
    };
    execute.onclick = async () => {
      refresh(); if (execute.disabled) return;
      execute.disabled = true;
      const result = await controller.execute_prepared({ preparationId: preparation.preparationId });
      if (result.error) reset(result.error);
      else { executionId = result.executionId; approved = false; review.hidden = true; field('structured-confirm').checked = false; field('structured-phrase').value = ''; materialized = null; sourcesStamp = ''; target = null; }
      refresh();
    };
    cancel.onclick = () => { reset('preparation_cancelled'); refresh(); prepare.focus(); };
    let interval = setInterval(refresh, 500);
    card.addEventListener('toggle', refresh);
    document.addEventListener('input', refresh);
    document.addEventListener('change', refresh);
    window.addEventListener('pagehide', event => {
      invalidateDiagnosticContext();
      disposed = true; clearInterval(interval); interval = null;
      if (event.persisted) {
        if (!executionId) { reset('preparation_invalidated'); target = null; }
      } else {
        controller.dispose(); materialized = null; sourcesStamp = ''; target = null;
      }
      prepare.disabled = true; approve.disabled = true; execute.disabled = true; cancel.disabled = true;
    });
    window.addEventListener('pageshow', event => {
      if (!event.persisted) return;
      disposed = false;
      if (interval === null) interval = setInterval(refresh, 500);
      refresh();
    });
    refresh();
    return Object.freeze({ invalidateDiagnosticContext });
  }
  root.StructuredUi = Object.freeze({ attach });
})(globalThis);
