(function (root) {
  function attach(adapters) {
    const field = id => document.getElementById(id);
    const card = field('structured-card'), prepare = field('structured-prepare'), approve = field('structured-approve'), execute = field('structured-execute'), cancel = field('structured-cancel');
    const status = field('structured-status'), review = field('structured-review'), writeGuard = field('structured-write-guard');
    const errors = {
      request_not_found: 'Request salva não encontrada.', environment_not_found: 'Selecione um ambiente disponível.',
      unresolved_variables: 'Há variáveis sem valor. Revise o ambiente e prepare novamente.', vault_locked: 'Desbloqueie o cofre do ambiente e prepare novamente.',
      invalid_request: 'Revise URL, dados e configurações da request salva.', ephemeral_file_unavailable: 'Arquivos efêmeros exigem o envio manual.',
      unsupported_preparation_action: 'Este fluxo exige o envio manual.', approval_required: 'Revise e aprove a preparação antes de executar.',
      preparation_expired: 'Preparação expirada. Prepare novamente.', preparation_invalidated: 'Dados alterados. Prepare e aprove novamente.',
      preparation_cancelled: 'Preparação cancelada; nenhuma chamada iniciada.', execution_in_progress: 'Aguarde a execução em andamento.'
    };
    let preparation = null, executionId = '', materialized = null, sourcesStamp = '', target = null, approved = false, expiresAt = 0, disposed = false;
    const controller = root.StructuredExecution.createStructuredExecution({
      now: () => performance.now(), newId: () => crypto.randomUUID(), readSources: adapters.readSources,
      materialize: sources => { materialized = adapters.materialize(sources); return materialized; }, run: adapters.run
    });
    const message = text => { if (status.textContent !== text) status.textContent = text; };
    function reset(code) {
      if (preparation?.preparationId) controller.cancelFromUi(preparation.preparationId);
      preparation = null; approved = false; materialized = null; sourcesStamp = ''; review.hidden = true;
      field('structured-confirm').checked = false; field('structured-phrase').value = '';
      message(errors[code] || 'Salve e selecione uma request para preparar.');
    }
    function refresh() {
      if (disposed) return;
      let running = false;
      if (executionId) {
        const result = controller.get_execution({ executionId });
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
          else if (JSON.stringify(adapters.readSources(target)) !== sourcesStamp) reset('preparation_invalidated');
        } catch { reset('preparation_invalidated'); }
      }
      const writeReady = !writeGuard.hidden ? field('structured-confirm').checked && field('structured-phrase').value.trim() === 'TESTE' : true;
      prepare.disabled = running || adapters.isBusy() || !adapters.getTarget();
      approve.disabled = !preparation?.preparationId || approved || running || !!executionId || !writeReady;
      execute.disabled = !approved || running || !!executionId || adapters.isBusy();
      cancel.disabled = !preparation?.preparationId || running || !!executionId;
    }
    prepare.onclick = () => {
      if (adapters.isBusy()) return;
      reset(); executionId = ''; target = adapters.getTarget();
      if (!target) { refresh(); return; }
      try {
        sourcesStamp = JSON.stringify(adapters.readSources(target));
        preparation = controller.prepare_request(target);
        if (!preparation.preparationId) { message(errors[preparation.blockers?.[0]] || errors[preparation.error] || errors.invalid_request); refresh(); return; }
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
      const accepted = await adapters.confirmReview(materialized.review);
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
    const interval = setInterval(refresh, 500);
    document.addEventListener('input', refresh);
    document.addEventListener('change', refresh);
    window.addEventListener('pagehide', () => { disposed = true; clearInterval(interval); controller.dispose(); materialized = null; sourcesStamp = ''; }, { once: true });
    refresh();
  }
  root.StructuredUi = Object.freeze({ attach });
})(globalThis);
