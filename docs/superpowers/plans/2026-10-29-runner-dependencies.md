# Dependências visuais no Runner — plano de implementação

> Execução conforme executing-plans em terminais Maestri visíveis, com posse exclusiva e revisão independente. Usuário aprovou o SDD e a execução pela squad; não usar subagentes ocultos, worktree TEMP ou solicitar nova escolha de método.

**Objetivo:** explicar relações condicionais e origens de dados no plano visual e na revisão de falhas, sem alterar o executor ou repetir produtores.

**Arquitetura:** análise pura e efêmera em `runner-logic.js`, usando extração compartilhada de campos e regras existentes. UI do diálogo atual, com controles acessíveis. Nenhuma persistência, alteração de CLI/bridge ou dependência nova.

**Stack:** JavaScript clássico/HTML/CSS, Node test runner e ASP.NET Core existentes.

**Contrato aprovado:** [SDD](../specs/2026-10-29-runner-dependencies-design.md). Base `0816037`, branch `feat/runner-dependencies`, SDD inicialmente versionado em `3bcbe17`. README tem alteração local de logo; preservar.

## Posse

- **Senku:** `wwwroot/runner-logic.js`, `wwwroot/app.js`, `wwwroot/index.html`, `wwwroot/style.css`, `RunnerLogic.test.cjs`, novo `RunnerDependencies.test.cjs` e ajustes estritamente necessários de `AIFriendlyUi.test.cjs`/`BeginnerUi.test.cjs`/`StructuredIntegration.test.cjs` para contratos preservados. A adaptação pontual de StructuredIntegration acompanha a extração compartilhada, sem remover assertions de segurança. Um único escritor de produção. Não editar docs, README, CLI, servidor, diagnóstico ou bridge. Não fazer stage/commit/push.
- **Maestro:** este plano, SDD, README, ROADMAP, continuidade/evidência e integração. Pode atualizar o comando CI para incluir teste novo se necessário. Não editar produção durante a posse de Senku.
- **Hange:** revisão somente leitura do diff final e riscos do contrato.
- **Bulma/Chopper:** terminais Shell visíveis de QA; usar banco isolado, sem dados pessoais.

## 1. Regressões e primitivas compartilhadas

- [x] Inspecionar os helpers atuais antes de editar; preservar mensagens/semântica de `prepareSavedRequest`, Auth e captura.
- [x] Criar testes comportamentais em `RunnerDependencies.test.cjs` para captura anterior condicional, captura futura ausente, valores iniciais, sombreamento e ausência de efeitos. Rodar e registrar RED na inexistência do analisador.
- [x] Compartilhar `templateFieldsFromSavedRequest` e validação do nome de captura com o módulo puro; wrappers da UI podem delegar para manter consumidores atuais. Não criar um segundo parser.
- [x] Compartilhar somente os predicados estáticos de requests não suportadas com o preparo existente, preservando erros e ordem relevante; nenhum motor paralelo de envio.
- [x] Rodar `node --test ./RunnerDependencies.test.cjs ./RunnerLogic.test.cjs` e conferir GREEN/regressões reais.

## 2. Análise sem valores

- [x] Derivar casos em ordem dataset-major; usar os mesmos dados normalizados da execução. Sem chamar gerador pré-request, resolver valores, HTTP ou storage.
- [x] Inspecionar referências e ações na ordem; manter presença vazia e fail-closed de cofre. Disponibilidade só por nomes, com objetos sem protótipo.
- [x] Agregar candidatos anteriores separadamente em ambiente/cofre; incluir contagem, ordinal e cruzamento de dataset, sem declarar origem final garantida.
- [x] Implementar issues/enums do SDD, 500 casos e orçamento global de 2.000 referências únicas `(caso,campo,nome)`, com parcial explícito.
- [x] Testar ambiente+captura, vários produtores, cofre anterior versus ambiente posterior, action template inválida, Auth herdada, GraphQL/multipart, captura inválida, requests não suportadas, entrada mutável/argumentos congelados e limites.
- [x] Testar sentinelas de valores em todos os campos; nomes podem existir apenas nos detalhes locais previstos. Saída não contém valores, requests ou mensagens brutas.

## 3. Plano visual e reexecução

- [x] Adicionar resumo agregado e detalhes nativos na Sequência existente. Texto fixo nos controles; nomes locais só com `textContent`, nunca IDs/labels/atributos da ponte.
- [x] Reusar o listener de datasets já existente; validar todos os conjuntos em vez de cair para `{}` quando o JSON é inválido. Preservar os erros de início já existentes.
- [x] Atualizar ao abrir, editar datasets e mudar ambiente/cofre com diálogo aberto; recalcular antes de execução/reexecução, sem timer ou leitura contínua de storage.
- [x] Guardar apenas metadados efêmeros do plano anterior para explicar produtores fora do subconjunto; não acrescentar produtores ou casos skipped.
- [x] Revisão adicional do subconjunto antes dos guards já existentes. Cancelamento não envia; confirmação antiga não autoriza novo contexto.
- [x] Durante a execução, rotular a análise como previsão anterior; ao terminar não fabricar estados de captura confirmada.
- [x] Cobrir DOM mínimo: detalhes, revisão/cancelamento, troca de contexto, dataset inválido, guards reaplicados, bridge/histórico intactos. Sem testes espelho de CSS.

## 4. Integração e revisão

- [x] Maestro revisar diff e fontes antes de aceitar a entrega. Senku deve reportar arquivos, RED/GREEN, comandos e limites via ask back.
- [x] Incluir teste novo no comando JS do CI; preservar as suites existentes.
- [x] Hange revisar somente leitura: precedência, candidatos condicionais, vazamentos, referências truncadas, estado obsoleto, reexecução e ausência de persistência/rede.
- [x] Corrigir achados concretos pelo escritor responsável; sem alterações concorrentes no mesmo arquivo.
- [x] Atualizar README/ROADMAP/continuidade com comportamento real e limites, preservando a nova logo já editada.

## 5. Verificação final

- [x] `node --check wwwroot/runner-logic.js` e `node --check wwwroot/app.js`.
- [x] `node --test ./RunnerLogic.test.cjs ./VortixRunner.test.cjs ./AIFriendlyUi.test.cjs ./AIAgentBridge.test.cjs ./StructuredExecution.test.cjs ./StructuredRequest.test.cjs ./StructuredUi.test.cjs ./StructuredIntegration.test.cjs ./AgentDiagnostics.test.cjs ./BeginnerUi.test.cjs ./RunnerDependencies.test.cjs`.
- [x] `dotnet build ./VortixApiClient.csproj -c Release --no-restore -o ./artifacts/runner-deps-qa/build` se cache existente, sem instalar/restaurar dependências. Output separado para preservar processo QA atual.
- [x] Smoke em Portal e Shell visível: banco `artifacts/runner-deps-qa/workspace.sqlite`, porta livre verificada, fixtures fictícias. Conferir plano/precedência/datasets/avisos, teclado, cancelamento e POST bloqueado. Nenhuma API real.
- [x] Conferir `git diff --check`, links, seleção e preservação dos sete untracked. Registrar separadamente inspeção, testes e smoke; nunca inferir preview/renderização por HTTP200.
- [x] Entregar pacote concreto e evidências. Commit/PR/merge da implementação seguem a autorização aplicável à publicação; este plano não publica automaticamente.

## Critério de conclusão local

Quatorze critérios do SDD cobertos por testes/inspeção/smoke conforme sua natureza; nenhum efeito do analisador; nenhuma regressão dos guards/CLI/histórico/bridge; revisão sem bloqueador pendente. Documentar qualquer limite não exercitado. Rollback remove análise/revisão adicional, sem migração.


## Fechamento local

Tarefas concluídas e evidência em ../validation/2026-10-29-runner-dependencies.md. Senku encerrou escrita; Maestro assumiu as correções finais de contexto assíncrono, previsão durante envio e matching/candidatos por nome, com RED/GREEN. Hange conferiu os deltas em leitura. Suíte final447/446aprovados/0falhas/1skip;26testes focados. Smoke de teclado foi tentado pelo Portal, com foco DOM confirmado, porém Enter/Space sem evento keydown observável; não tratar como teclado nativo aprovado. Demais limites estão no relatório. Entrega encaminhada ao [PR #39](https://github.com/JeffyMesquita/Vortix/pull/39); estado vivo e merge no PR.
