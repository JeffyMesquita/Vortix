# Diagnóstico compacto — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Delegação só é permitida em terminais interativos visíveis do workspace Maestri, conforme as regras efetivas; o template não autoriza subagentes ocultos.

**Goal:** Oferecer diagnóstico somente leitura de uma request individual, com impedimento e próxima ação úteis, detalhes progressivos e evidência comparável de utilidade.

**Execução em 27/10/2026:** tarefas 1–5 implementadas e integradas localmente; tarefa 6 com testes automatizados, CI, documentação, smoke funcional, conferência visual por imagem e 90 leituras sintéticas registrados em [validação](../validation/2026-10-27-compact-diagnostics.md). Descoberta comparável e economia de tokens não foram demonstradas. As caixas abaixo preservam o roteiro detalhado, não substituem esse registro de evidência. Sem commit/publicação.

**Architecture:** Projeção pura compartilhada produz um registro seguro; UI existente publica e apresenta os mesmos fatos; bridge v2 acrescenta `diagnose()` sem acesso ao controller ou fontes sensíveis. A autorização e a execução atuais permanecem intactas.

**Tech Stack:** JavaScript vanilla, módulos no padrão existente, DOM v2, Node `node:test`/`vm`, ASP.NET Core .NET 10 e PowerShell já utilizados. Sem dependência nova.

**Contrato aprovado:** [SDD de diagnóstico compacto](../specs/2026-10-27-compact-diagnostics-design.md). Após o planejamento, o usuário autorizou a implementação e a equipe visível no Maestri. Sem autorização implícita para commit, PR, API real ou deploy.

## 1. Preparação e limites

- Preservar alterações documentais atuais em README, roadmap, fichário e specs, além da nota local não rastreada `Orquestrador.md`. Não fazer stash/reset ou adicionar arquivos indiscriminadamente.
- Antes da implementação, conferir `AGENTS.md` efetivo, branch, status e mudanças desde `eafccf9`. Criar branch/worktree apenas quando autorizado; não converter esta etapa documental em operação Git.
- Ler o SDD completo e seguir sua matriz de aceitação. Não mudar limites, semântica ou escopo para fazer testes passarem.
- Em cada tarefa: teste vermelho pelo motivo esperado; mudança mínima; testes verdes; revisão do trecho e evidência. Não apresentar arquivos isolados ainda sem fluxo integrado como feature pronta.
- Sem novo endpoint/MCP, execução externa, consulta por ID, polling adicional, armazenamento persistente, event bus ou refatoração geral do controller existente.

## 2. Arquivos e posse

| Arquivo | Mudança/responsabilidade |
| --- | --- |
| Criar `wwwroot/agent-diagnostics.js` | Catálogo fechado, projeção, revisão semântica, validação do registro e vistas |
| Criar `AgentDiagnostics.test.cjs` | Contratos puros, relógio, limites, sentinelas e entradas malformadas |
| `wwwroot/structured-ui.js` | Alimentar/publicar registro, mensagens coerentes e navegação explícita ao impedimento |
| `wwwroot/app.js` | Metadados mínimos de prontidão/contexto e invalidação síncrona privada |
| `wwwroot/agent-bridge.js` | Método aditivo `diagnose()` somente leitura |
| `wwwroot/index.html`, `wwwroot/style.css` | Ordem de scripts e controles acessíveis, reutilizando tokens atuais |
| `StructuredUi.test.cjs`, `StructuredIntegration.test.cjs` | Fluxo real da UI/controller, contexto, ciclo de vida e ausência de efeitos |
| `AIAgentBridge.test.cjs`, `AIFriendlyUi.test.cjs` | Compatibilidade v2, vistas, controle visível e acessibilidade |
| `.github/workflows/ci.yml` | Incluir a nova suíte sem remover as oito existentes |
| Guias, continuidade, roadmap e validação | Uso e evidência obtida, distinguindo proposta de entrega |

Um único escritor por arquivo. A integração em `app.js` e `structured-ui.js` é serializada. Não dividir em pastas/camadas artificiais; separar outra responsabilidade só se a revisão do trecho demonstrar necessidade.

## 3. Interface interna da projeção

Namespace de funções puras `VortixDiagnostics`, no padrão de carregamento do projeto, sem instância ou dados globais:

- `buildRecord(facts, previousRecord, nowMs)`: cria o registro interno descrito no SDD, usando `previousRecord: null` na primeira publicação. Recebe fatos normalizados privados, não request materializada ou fonte de variáveis.
- `readDiagnostic(rawRecord, options, nowMs)`: valida opções/JSON, verifica contexto/frescor e seleciona a vista. `rawRecord` é string ou `null`; leitura inválida degrada com códigos fixos.
- `blockerDefinition(code)`: retorna cópia da definição estática de um dos 17 códigos; código desconhecido recebe a definição fixa de indisponibilidade, sem eco.

`facts` contém exatamente `state`, `contextMatches`, `validUntilMs`, `blockers`, `result` e `controls`. `blockers` são códigos conhecidos; seus targets vêm do catálogo, nunca de texto externo. `controls` contém os seis nomes de ações permitidos no SDD com booleans de disponibilidade real: visível, habilitado e não inerte. `result` vem da cópia segura do resumo terminal; a projeção seleciona campos explicitamente e não serializa IDs/metadados internos.

Produzir `diagnosticVersion`, `revision`, relógios monotônicos e os demais campos do registro exatamente como no SDD. A revisão compara conteúdo semântico, ignorando somente `observedAtMs`; contexto, prazo, estado, impedimentos, próxima ação ou resultado alterados incrementam a revisão. Overflow ou dados inválidos não podem promover prontidão.

## Tarefa 1 — Projeção e catálogo puros

**Arquivos:** `AgentDiagnostics.test.cjs`, `wwwroot/agent-diagnostics.js`.

- [ ] Criar a suíte com `node:test`/`assert`. Começar pela fixture mínima completa abaixo; os nomes/exportações são os da seção 3.

```js
const assert = require('node:assert/strict');
const test = require('node:test');
const { buildRecord, readDiagnostic } = require('./wwwroot/agent-diagnostics.js');

function blockedFacts() {
  return {
    state: 'blocked', contextMatches: true, validUntilMs: null,
    blockers: ['unresolved_variables'], result: null,
    controls: {
      'request.save': true, 'environment.manage': true, 'settings.open': true,
      'execution.prepare': true, 'execution.review': false, 'execution.execute': false
    }
  };
}

test('summary points to a known control without exposing source values', () => {
  const record = buildRecord(blockedFacts(), null, 1000);
  const summary = readDiagnostic(JSON.stringify(record), undefined, 1001);
  assert.equal(summary.state, 'blocked');
  assert.equal(summary.blocker, 'unresolved_variables');
  assert.equal(summary.nextAction, 'environment.manage');
  assert.equal(summary.freshness, 'fresh');
  assert.equal(Object.hasOwn(summary, 'observedAtMs'), false);
  assert.equal(Object.hasOwn(summary, 'result'), false);
});
```

- [ ] Rodar `rtk proxy node --test ./AgentDiagnostics.test.cjs`; confirmar falha por módulo/exportação inexistente, não erro de sintaxe da fixture.
- [ ] Implementar o módulo puro e os 17 códigos/targets/ações do SDD. Construir saídas por campos explícitos; nunca espalhar request, erro ou fonte em registro público.
- [ ] Adicionar testes por tabela para todos os códigos, prioridade, duplicatas, targets desconhecidos, ações ausentes/desabilitadas/inertes e warnings que não podem virar bloqueios.
- [ ] Cobrir revisão inicial, tick idêntico, mudança de estado/contexto/resultado e cópias independentes. Publicação idêntica pode atualizar o instante observado sem mudar revisão ou anúncio.
- [ ] Rodar a suíte até ficar verde e `rtk proxy node --check ./wwwroot/agent-diagnostics.js`. Sem instalar formatter ou dependência.

## Tarefa 2 — Vistas, frescor, limites e privacidade

**Arquivos:** `AgentDiagnostics.test.cjs`, `wwwroot/agent-diagnostics.js`.

- [ ] Adicionar testes vermelhos para `summary`, `blockers` e `result`, opções extras/ID arbitrário, `null`, array, símbolos, accessors e versão desconhecida.
- [ ] Validar opções antes de tocar no registro. Usar descritores próprios para não invocar getters. Não permitir caminhos alternativos de consulta ao armazenamento ou histórico.
- [ ] Acrescentar o teste de fronteira temporal abaixo, mantendo exatamente a semântica de observação do SDD.

```js
test('stale observation cannot look approved or return execution details', () => {
  const facts = blockedFacts();
  facts.state = 'approved'; facts.blockers = []; facts.validUntilMs = 3000;
  facts.controls['execution.execute'] = true;
  const record = buildRecord(facts, null, 1000);
  const summary = readDiagnostic(JSON.stringify(record), undefined, 3000);
  assert.equal(summary.state, 'unknown');
  assert.equal(summary.freshness, 'stale');
  assert.equal(summary.nextAction, null);
  assert.equal(readDiagnostic(JSON.stringify(record), { view: 'result' }, 3000).result, null);
  assert.equal(record.state, 'approved');
});
```

- [ ] Implementar leitura com falha fechada: instante futuro/inválido, prazo ausente nos estados que o exigem, JSON malformado, extras, enums inválidos e número não finito/inseguro. Degradar leitura não altera o registro original nem o controller.
- [ ] Cobrir frescor imediatamente antes/no limite, prazo da preparação menor que 2.000 ms e contexto divergente. Distinguir resultado terminal desconhecido vigente de observação antiga, que sempre omite `result`.
- [ ] Cobrir HTTP 422, status de proxy independente, assertiva falha, parcial, zero testes, captura/persistência falha e entrega desconhecida. Derivar `validation` por prioridade das contagens uma única vez e reutilizar a função na checagem do registro.
- [ ] Inserir sentinelas em URL/query/Auth/body/variáveis/mensagens/nomes e injetar chaves extras/protótipos no registro. Serializar todas as vistas e erros e provar que não há eco nem campos privados.
- [ ] Construir os maiores pacotes permitidos pelo catálogo, contagens e números; medir com `TextEncoder`. Provar tetos de 512/2.048/4.096 bytes e registro até 4.096, sem truncamento. Se não couber, revisar o contrato, não elevar o limite silenciosamente.
- [ ] Rodar `rtk proxy node --test ./AgentDiagnostics.test.cjs` e confirmar que mutação do retorno não afeta consultas posteriores.

## Tarefa 3 — Prontidão e contexto privados na aplicação

**Arquivos:** `wwwroot/app.js`, `StructuredIntegration.test.cjs`.

- [ ] Traçar `initializeStructuredExecution`, `getStructuredSources`, `syncActiveWorkspaceTab`, `activateWorkspaceTab`, seleção de ambiente, salvamento de ambiente/Auth/request e ciclo de vida do cofre. Identificar também importação/restauração que altere esses dados, sem refatorar os fluxos não afetados.
- [ ] Criar testes vermelhos para distinguir request não salva, draft sujo, request removida, ambiente ausente e executor ocupado sem resolver templates ou ler credenciais.
- [ ] Acrescentar adaptador privado `getDiagnosticReadiness(origin)` com booleans de prontidão/contexto e uma revisão semântica local. Não retornar nome, URL, body, valor ou instância de cofre; não chamar `getStructuredSources` apenas para diagnosticar.
- [ ] Reter a tupla mínima de origem e revisão semântica em escopo privado do painel, antes de liberar `materialized`/`sourcesStamp`. Comparar origem com aba/request/ambiente ativos e marcar edição posterior como contexto inválido. Não armazenar JSON de fontes ou segredos para essa finalidade.
- [ ] Manter apenas um contador local para alterações semânticas relevantes; troca de aba sozinha é distinguida pela origem, não por copiar dados sensíveis. Mudanças de valores/políticas/Auth/cofre invalidam conservadoramente o contexto; tema, escala e foco não alteram a semântica.
- [ ] Fazer `StructuredUi.attach` retornar somente um handle privado com `invalidateDiagnosticContext()`. Guardá-lo dentro da IIFE do app. Chamar invalidação antes de transições de contexto/awaits; republicar só após conhecer o contexto novo. Esse handle não cancela/aprova requests nem é adicionado a `window`.
- [ ] Testar troca de aba antes/durante/depois do envio, ambiente mudado e retorno à origem sem edição, edição/salvamento após resposta e alteração de Auth/cofre. Nenhuma janela transitória pode atribuir resultado anterior ao novo rascunho.
- [ ] Executar `rtk proxy node --test ./StructuredIntegration.test.cjs ./StructuredRequest.test.cjs ./StructuredExecution.test.cjs` e sintaxe de `app.js`. Preservar as regressões atuais de histórico e captura.

## Tarefa 4 — Publicação e orientação no painel

**Arquivos:** `wwwroot/structured-ui.js`, `wwwroot/index.html`, `wwwroot/style.css`, `StructuredUi.test.cjs`, `AIFriendlyUi.test.cjs`.

- [ ] Escrever testes vermelhos para registro ausente no início, bloqueios/prontidão, revisão humana aberta, aprovação observada, execução, resultado parcial e leitura após contexto invalidado.
- [ ] Alimentar os fatos após os guards existentes calcularem disponibilidade dos controles. O novo modelo orienta a leitura; não habilita controles por conta própria nem cria outra regra de consentimento.
- [ ] Publicar registro seguro em `#structured-card.dataset.vortixDiagnostic` dentro do refresh existente, sem outro timer. A cada observação, renovar instante; só alterar revisão/texto anunciado quando os fatos semânticos mudarem.
- [ ] Reutilizar o catálogo para mensagens de impedimento. Gerar o resumo legível a partir dos mesmos fatos/resultados; não interpretar uma frase já renderizada para criar JSON.
- [ ] Adicionar **Ir ao impedimento** somente quando houver target conhecido. Click explícito expande o painel existente e move foco; não altera campos, navega a URL externa ou executa preparação/rede. Usar mapa local de identificadores, nunca seletores recebidos da API.
- [ ] Testar modais: controle da bancada oculto/inativo/inert não é sugerido; confirmação não é acionada automaticamente. Preservar retorno de foco e impedir que confirmação antiga após BFCache aprove nova preparação.
- [ ] Cobrir `pagehide`/`pageshow`: sem publicação vigente durante suspensão/contexto desconhecido; um timer ao retomar; sem ressuscitar aprovação, duplicar envio ou expor outro resultado. Não chamar APIs de execução a partir de leitura/atualização do diagnóstico.
- [ ] Usar tokens CSS existentes, ícone/texto além de cor e `aria-live="polite"` sem anúncio por tick idêntico. Preservar labels, IDs e comportamento dos controles atuais.
- [ ] Atualizar ordem dos scripts: `runner-logic.js`, `agent-diagnostics.js`, `agent-bridge.js`, módulos de execução e `app.js`, todos na ordem `defer` apropriada.
- [ ] Rodar `rtk proxy node --test ./AgentDiagnostics.test.cjs ./StructuredUi.test.cjs ./StructuredIntegration.test.cjs ./AIFriendlyUi.test.cjs`. Revisar responsabilidades do trecho; não deslocar toda a complexidade a um novo controller gigante.

## Tarefa 5 — `diagnose()` no bridge v2

**Arquivos:** `wwwroot/agent-bridge.js`, `AIAgentBridge.test.cjs`, `AIFriendlyUi.test.cjs`.

- [ ] Criar testes vermelhos que carreguem a projeção real no DOM sintético do bridge. Preservar todas as verificações existentes de `describe()` e `snapshot()`.
- [ ] Acrescentar função `diagnose(options)` que lê somente `data-vortix-diagnostic` do painel e delega a `readDiagnostic`, passando `performance.now()`. Não acessar estado privado, storage, valores de campos ou controller.
- [ ] Adicionar somente esse método ao objeto congelado `window.vortixAgent`. Preservar `contractVersion === 2` e formatos de `describe`/`snapshot`; não instalar setter/registro público de callback ou expor instância.
- [ ] Espionar HTTP, storage, preparação, aprovação, cancelamento e captura: cada vista, erro de opção e registro inválido deve produzir zero efeitos. Não mascarar timer de UI como efeito da consulta; congelar o relógio/agendamento do harness para isolar a leitura.
- [ ] Testar objeto de retorno independente, getters não chamados, tamanhos, sentinelas e registro adulterado. Record aparentemente aprovado não pode aprovar/executar no controller; testar a separação com o controller real.
- [ ] Testar carregamento do bridge antes do painel estar pronto e ausência do módulo/registro: diagnóstico indisponível, sem quebrar métodos v2 ou procurar dados por caminho alternativo.
- [ ] Rodar `rtk proxy node --test ./AgentDiagnostics.test.cjs ./AIAgentBridge.test.cjs ./AIFriendlyUi.test.cjs ./StructuredUi.test.cjs ./StructuredIntegration.test.cjs` e sintaxe dos módulos alterados.

## Tarefa 6 — CI, smoke, medição e entrega

**Arquivos:** `.github/workflows/ci.yml`, `README.md`, `docs/maestri-portal.md`, `docs/structured-execution.md`, `docs/continuity.md`, `ROADMAP.md`; criar `docs/superpowers/validation/2026-10-27-compact-diagnostics.md` somente ao registrar execução real.

- [ ] Incluir `AgentDiagnostics.test.cjs` no CI, mantendo as oito suítes atuais. Sem alterar permissões ou integrações externas.
- [ ] Documentar vistas, campos, limites, frescor, contexto e o fato de `nextAction` não autorizar nada. Marcar proposta como entregue só após gates concluídos.
- [ ] Rodar as nove suítes Node, sintaxe, build e diff. Estes comandos ainda não foram executados para a feature proposta:

```powershell
rtk proxy node --test ./RunnerLogic.test.cjs ./VortixRunner.test.cjs ./AIFriendlyUi.test.cjs ./AIAgentBridge.test.cjs ./StructuredExecution.test.cjs ./StructuredRequest.test.cjs ./StructuredUi.test.cjs ./StructuredIntegration.test.cjs ./AgentDiagnostics.test.cjs
rtk proxy node --check ./wwwroot/agent-diagnostics.js
rtk proxy node --check ./wwwroot/agent-bridge.js
rtk proxy node --check ./wwwroot/structured-ui.js
rtk proxy node --check ./wwwroot/app.js
rtk proxy dotnet build ./VortixApiClient.csproj -c Release --no-restore
rtk git diff --check
```

- [ ] Rodar as cinco suítes PowerShell atuais segundo suas pré-condições: hospedagem, proteção de workspace, PKCE, retenção e introspecção. Não transformar análise externa cancelada em check aprovado; registrar limitações sem desligar proteções.
- [ ] Smoke em porta livre, modo local e SQLite temporário; conferir leitura antes/depois da preparação, falta de variável, POST sem aprovação, modal, navegação de abas/cache, HTTP/validações/timeout e teclado. Mocks em loopback, sem banco pessoal ou APIs reais. Verificar o modo público no escopo do diagnóstico/isolamento.
- [ ] Checar temas claro/escuro e viewport estreito. Diferenciar restauração real de cache de reload; manter regressão determinística de `persisted: true` quando o browser não restaurar a página no smoke.
- [ ] Medir seis casos por três caminhos e pelo menos cinco repetições: atual com `execution.status`, atual com região/seletores focados, novo diagnóstico sob demanda. Registrar pelo menos 90 observações comparáveis com estados iniciais equivalentes. Separar descoberta inicial e uso recorrente; não cobrar uma consulta desnecessária a um caminho só para piorá-lo.
- [ ] Publicar sucesso correto, chamadas, bytes/caracteres, duração, intervenções, mediana e faixa. Tokens só com cliente/modelo/tokenizer identificados; sem percentuais inferidos. Não adicionar LLM/tokenizer/dependência para produzir uma métrica não autorizada.
- [ ] Gate de segurança: nenhum vazamento, envio sem autorização, replay ou falsa certeza nos casos. Gate de utilidade: orientação resolve a tarefa sem reconstrução desnecessária. Sem benefício, reduzir/reavaliar a projeção em vez de ampliar API.
- [ ] Revisar diff final, repetição de regras, dependências/ciclos, UX e rollback. Encerrar só processos/abas de QA criados na tarefa; preservar dados e alterações alheias. Sem commit/PR/merge/deploy implícitos.

## 4. Cobertura e revisão do plano

| Exigência do SDD | Tarefas |
| --- | --- |
| Campos/vistas, catálogo e limites | 1, 2, 5 |
| Mesmos fatos na UI e no diagnóstico | 1, 3, 4 |
| Leitura sem efeitos e privacidade | 1, 2, 5 |
| Contexto, frescor, BFCache e aprovação antiga | 2, 3, 4, 5 |
| Compatibilidade DOM v2 e acessibilidade | 4, 5, 6 |
| Segurança, testes local/público e medição justa | 2, 5, 6 |
| Entregas incrementais, documentação e rollback | 1–6 |

Autorrevisão documental: nomes das três funções puras e do handle privado são consistentes; cada seção de aceitação tem tarefa correspondente. Números de limites/frescor vêm do SDD aprovado e devem ser provados em teste, não apresentados como medições já feitas.

## 5. Governança de execução

No Maestri, todo agente precisa de terminal interativo visível no workspace ativo; proibidos subagentes ocultos, processos destacados, filas e APIs assíncronas de agentes como alternativa. Não substituir isso por terminal externo ao workspace nem alegar sucesso de um lançador como prova de agente visível.

Nesta execução, `Kakashi — Tech Lead` entregou projeção e benchmark, `Sakura — Frontend` entregou app/UI, e `Shikamaru — QA` entregou testes do bridge e revisão independente. Todos em terminais Maestri visíveis; `Erwin — Head` integrou e corrigiu achados. Metadados observados e limites estão na validação. A visibilidade prevalece sobre outros roteamentos.

Sem terminal visível exposto, informar a limitação e executar apenas o trabalho independente autorizado no processo principal. Não iniciar agentes ou instalar integração para cumprir o plano. Commit, PR e publicação exigem autorização específica e não podem conter assinatura/autoria de IA.

**Estado:** implementação integrada localmente; 403 testes Node, build/sintaxe/diff, cinco suítes PowerShell e revisão visual por imagem conferidos. Descoberta comparável/tokens não medidos. Publicação continua fora da autorização atual.
