# Correção guiada no envio — plano de implementação

> Registro do plano aprovado em 30/10/2026. A entrega foi integrada ao cliente de uso geral em 04/11/2026. Os passos sobre frase e declaração de dados descartáveis representam o requisito original, substituído pela política atual de envio manual. Consulte a [especificação atualizada](../specs/2026-10-30-guided-request-correction-design.md) e a [validação de 04/11](../validation/2026-11-04-global-api-client.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Levar do impedimento local ao campo certo, sem perder o rascunho ou executar efeitos.

**Architecture:** Ampliar a faixa de envio existente. Estado efêmero privado em `app.js`, com destinos identificados pela própria validação. Reutilizar abas, disclosures e estilos atuais.

**Tech Stack:** HTML, CSS, JavaScript sem framework; Node `node:test` e harness `vm` existente. Sem dependências novas.

**Spec:** `docs/superpowers/specs/2026-10-30-guided-request-correction-design.md`.

**Estado:** plano aprovado pelo usuário ("fechou"). Sem nova aprovação de escopo pendente. Após falhas de bootstrap, Hinata — Correção guiada UX respondeu ao teste solicitado pelo usuário, com Luna xhigh confirmado na tela e conta Pessoal em `maestri list`. Tasks 1/2 encaminhadas com posse exclusiva dos quatro arquivos; Maestro conserva docs, integração e QA visual.

## Global Constraints

- Preservar IDs, atributos do contrato DOM e controles atuais.
- Não classificar erros comparando textos traduzidos ou inferindo seletores a partir de mensagens.
- Não executar novamente a preparação apenas para atualizar a faixa.
- Não preencher, marcar ou aprovar automaticamente.
- Não alterar servidor, persistência, Runner, contratos do diagnóstico compacto ou dependências.
- Delegações restritas a Luna xhigh em terminais visíveis do Maestri; conta Pessoal. Bootstrap indisponível não autoriza trocar conta, modelo ou autenticação.
- Nenhuma publicação, PR, merge ou deploy. Preservar arquivos preexistentes não rastreados.

## Review Focus

Cobrir nos testes abaixo: remoção da linha alvo, troca de request/ambiente, confirmação de escrita parcialmente preenchida, erro sem destino e preparação com efeitos que não podem repetir. Conferir foco real e layout no navegador; harness não comprova renderização.

## Task 1: Navegação e faixa contextual

**Files:** modificar `wwwroot/index.html`, `wwwroot/app.js`, `wwwroot/style.css`; criar `GuidedRequestCorrection.test.cjs` usando o padrão `vm` de `BeginnerUi.test.cjs`.

**Interfaces:** funções privadas `clearRequestCorrection()`, `setRequestCorrection(message, target = null)` e `focusRequestCorrection()`. `target` é elemento DOM do formulário atual, nunca seletor vindo de mensagem. `setRequestCorrection` não rouba foco; renderização de `updateGuard` conserva precedência de envio/rota vazia/escrita, depois erro local e orientação normal. Botão `request-correction-go`, texto **Ir ao campo**, `type="button"`, `aria-describedby="request-send-status"`.

- [ ] Escrever testes de rota vazia com Enviar desabilitado, botão acessível, clique que foca sem enviar e abertura de Params/disclosures ancestrais antes do foco. Testar alvo removido e modal aberto: limpar destino inválido ou impedir navegação enquanto modal bloquear o formulário; nenhum foco atravessa modal.
- [ ] Rodar `node --test ./GuidedRequestCorrection.test.cjs`; confirmar falha pela ausência do comportamento.
- [ ] Implementar interfaces e botão. Conferir `isConnected`, pertença ao editor atual, `disabled` e visibilidade após revelar o grupo. Sem timers, rede, armazenamento ou preparação. Reutilizar `setEditorTab` e disclosures nativos; não compartilhar estado com execução revisada.
- [ ] Ajustar apenas o layout necessário na faixa existente, com quebra de linha e foco pelos tokens atuais.
- [ ] Rodar `node --test ./GuidedRequestCorrection.test.cjs ./BeginnerUi.test.cjs` e `node --check wwwroot/app.js`; exigir zero falhas.

## Task 2: Validação com destino explícito e descarte de contexto antigo

**Files:** modificar `wwwroot/app.js` e `GuidedRequestCorrection.test.cjs`.

**Interfaces:** `withRequestCorrectionTarget(target, validate)` executa callback síncrono uma única vez, associa privadamente um erro lançado ao alvo e relança o mesmo erro. Usar `WeakMap` privado para não acrescentar DOM a erros serializáveis. `sendCurrentRequest` consome a associação somente no tratamento de falhas locais de preparação. Usar as interfaces da Task 1 para limpar/publicar a correção.

- [ ] Escrever testes para rota inválida, parâmetro com valor sem chave, captura com nome/caminho inválido e captura desabilitada. Verificar mensagem original, erro relançado e preservação dos valores. Cobrir confirmação com frase faltante e checkbox faltante.
- [ ] Acrescentar testes para edição pertinente, troca de aba/ambiente, nova tentativa, linha removida e erro desconhecido. Verificar que navegação não executa ações pré-request, grava histórico, desbloqueia cofre, altera consentimento ou envia request. Resultado remoto não se torna correção local.
- [ ] Rodar a suíte focada e confirmar falhas novas antes de implementar.
- [ ] Anotar destinos nos pontos pertinentes de `buildRequestRoute`, `validateResponseCaptureForm` e confirmação de escrita. Aplicar `withRequestCorrectionTarget` somente ao trecho que valida aquele campo; resolução de variável e cofre não herdam um destino enganoso. Não transformar falha de rede em erro de campo.
- [ ] Integrar descarte aos fluxos existentes de edição e troca de contexto, sem confundir simples troca de aba Params/Auth com alteração semântica. Limpar antes de nova tentativa. Durante envio, ocultar a ação. Não executar validadores com efeitos em listeners de edição.
- [ ] Publicar mensagens fixas ou já filtradas, sem acrescentar URL, credencial, valor de campo ou metadado sensível à faixa/bridge. Erro sem destino mantém orientação geral.
- [ ] Rodar `node --test ./GuidedRequestCorrection.test.cjs ./BeginnerUi.test.cjs ./StructuredUi.test.cjs ./StructuredIntegration.test.cjs ./AIFriendlyUi.test.cjs ./AIAgentBridge.test.cjs`; exigir zero falhas.

## Task 3: Conferência visual e entrega

**Files:** criar `docs/superpowers/validation/2026-10-30-guided-request-correction.md`; atualizar a seção de uso pertinente do `README.md` apenas para documentar o comportamento entregue.

**Interfaces:** resultado integrado das Tasks 1/2; nenhuma nova API.

- [ ] Subir uma instância isolada em terminal Shell visível do Maestri, com SQLite temporário e porta livre, reutilizando os scripts de QA existentes. Não reutilizar workspace pessoal nem instalar dependências. Reutilizar Portal adequado após conferir URL/estado.
- [ ] Conferir Dracula/Papel, 1280/1440, escala ampliada e viewport 390: rota vazia, Params inválido, captura inválida, POST bloqueado, troca de request/ambiente e erro sem destino. Usar dados fictícios e não chamar API real. Confirmar teclado, foco DOM real, mensagem e ausência de overflow; registrar exatamente os tamanhos/escala usados.
- [ ] Rodar `node --check wwwroot/app.js`, testes focados da Task 2, `dotnet build ./VortixApiClient.csproj -c Release --no-restore` e `git diff --check`. Não repetir suites aprovadas sem mudança ou preocupação nova.
- [ ] Revisar diff contra a spec: nenhum segredo, guard reduzido, alteração de persistência, dependência nova ou efeito ao navegar. Registrar checks atuais e lacunas, distinguindo harness de browser e ausência de envio real.
- [ ] Entregar resultado local, arquivos, evidências e limites. Commit de implementação e publicação seguem autorização aplicável; não misturar arquivos locais alheios.

## Execução

Método solicitado: Luna xhigh em terminais visíveis, com posse exclusiva de implementação dos arquivos das Tasks 1/2; orquestrador integra e verifica. Reutilizar Sakura — UX e DX se o usuário recuperar sua sessão Pessoal. Não reenviar trabalho ao terminal parado no shell. Confirmar TUI/modelo/checkout antes de delegar e usar ask back. Sem Luna disponível, registrar impedimento e aguardar orientação do usuário, preservando este plano.

Revisão do plano: interfaces e tarefas cobrem os nove critérios de aceite da spec; nenhuma alteração funcional realizada nesta etapa.
