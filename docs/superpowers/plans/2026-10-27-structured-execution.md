# Execução estruturada — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar preparação, revisão visual, execução única e consulta compacta para uma request salva, sem expor execução externa nem remover proteções.

**Architecture:** Um controlador independente do DOM guarda preparações e resumos em memória; adaptadores da aplicação resolvem dados locais e reutilizam o executor individual. A interface acessível possui a autorização; o bridge v2 continua somente leitura. A extração é limitada ao envio individual, sem segundo motor de HTTP ou migração do Runner.

**Tech Stack:** JavaScript vanilla, módulos no padrão UMD já usado por RunnerLogic, Node `node:test`, ASP.NET Core .NET 10, SQLite local e IndexedDB no modo público existentes.

**Especificação aprovada:** `docs/superpowers/specs/2026-10-26-structured-execution-design.md`.

**Entrega:** implementação e validação registradas em `docs/superpowers/validation/2026-10-27-structured-execution.md`. Os checkboxes abaixo são a sequência original de planejamento, não um registro automático de execução. Preparação pura e UI foram separadas em `wwwroot/structured-request.js` e `wwwroot/structured-ui.js`, com suítes próprias, para não concentrar essas responsabilidades em `app.js`. O transporte individual existente foi reutilizado, sem reescrever o envio manual. Benchmark comparável de tokens e transporte externo permanecem fora da entrega.

## Regras de trabalho

- Preservar as alterações existentes em `AIFriendlyUi.test.cjs`, `docs/maestri-portal.md`, `wwwroot/app.js`, `wwwroot/index.html`, `wwwroot/style.css` e a nota não rastreada `Orquestrador.md`.
- Não criar branch/worktree, commit, PR ou deploy sem autorização. Este plano não inclui publicação.
- Implementar uma tarefa de cada vez. Cada tarefa começa com testes vermelhos, passa pela implementação mínima e termina com testes verdes. Não apresentar scaffolding isolado como feature concluída.
- Usar fixtures e banco temporário. Não executar APIs reais nem inspecionar dados/credenciais pessoais.
- Não instalar dependências novas. Não adicionar MCP, endpoint novo ou métodos de escrita a `window.vortixAgent`.

## Arquivos e responsabilidades

| Arquivo | Responsabilidade |
| --- | --- |
| Criar `wwwroot/structured-execution.js` | Controlador sem DOM: validação das entradas, snapshots privados, autorização, execução única, classificação e limite de resumos |
| Criar `StructuredExecution.test.cjs` | Testes determinísticos do controlador, tempo, concorrência e não exposição de dados |
| Modificar `wwwroot/app.js` | Adaptadores de dados salvos, executor individual compartilhado, autorização privada e vínculo de resultado com aba de origem |
| Modificar `wwwroot/index.html` | Carregar módulo antes de `app.js`; cartão de preparação/revisão, controles e região de estado |
| Modificar `wwwroot/style.css` | Estilos locais do cartão reutilizando tokens existentes, sem paletas novas |
| Modificar `AIFriendlyUi.test.cjs` | Integração de preparação/revisão/envio, foco, guard e ausência de efeitos antes de execução |
| Modificar `AIAgentBridge.test.cjs` | Garantir que o bridge público segue somente leitura e não expõe snapshots internos |
| Modificar `.github/workflows/ci.yml` | Acrescentar a nova suíte Node à lista existente |
| Modificar `README.md`, `docs/maestri-portal.md`, `ROADMAP.md` | Uso visual, limites, autorização e evidência efetivamente obtida |

Não criar camada genérica de eventos, sistema de plugins ou pastas com um arquivo. Só separar adaptador adicional se a revisão do trecho afetado em `app.js` revelar responsabilidades independentes que não possam ficar claras em funções focadas.

## API privada de implementação

Exportar `createStructuredExecution` pelo padrão UMD para Node e carregamento no navegador. A fábrica não contém credenciais ou instâncias globais. A instância fica em escopo privado de `app.js`; não anexá-la a `window`.

Dependências explícitas da fábrica:

- `now()`: relógio monotônico, `performance.now()` na aplicação.
- `newId()`: identificador opaco, `crypto.randomUUID()` na aplicação.
- `readSources(input)`: leitura síncrona dos dados locais e políticas relevantes; retorna cópia independente ou impedimento tipado, sem gravação/HTTP. A cópia inclui contexto de ambiente, Auth herdada e versão do cofre, mas não deve atravessar o contrato público.
- `materialize(sources)`: prepara request resolvida e metadados de revisão uma única vez, sem efeitos externos; executa somente ações locais puras existentes.
- `run(prepared)`: executor individual compartilhado, assíncrono; retorna fatos de transporte, testes, captura e persistência. Não deve inferir autorização: o controlador só o chama depois do consumo atômico.

Objeto retornado pela fábrica: `prepare_request(input)`, `execute_prepared(input)`, `get_execution(input)`, `approveFromUi(preparationId)`, `cancelFromUi(preparationId)` e `dispose()`.

Os dois métodos `FromUi` são capacidades privadas do adaptador visual, não ferramentas públicas. JavaScript na mesma origem não é uma fronteira de autenticação: não alegar que isso impede código malicioso da página. Transporte externo e autenticação ficam fora deste recorte.

## Tarefa 1 — Contrato, preparação e expiração

**Arquivos:** criar `StructuredExecution.test.cjs` e `wwwroot/structured-execution.js`.

- [ ] Escrever testes de entrada estrita: objeto simples, quatro chaves permitidas, IDs não vazios e limitados a 256 caracteres, `folderId` nulo ou string não vazia; rejeitar campos extras e chaves herdadas sem ler valores desnecessários. Erros usam códigos fixos.
- [ ] Criar fixture determinística reutilizável na suíte. O exemplo abaixo define o contrato do harness; expandir fixtures para Auth, cofre, ações e efeitos antes dos respectivos testes.

```js
const assert = require('node:assert/strict');
const test = require('node:test');
const { createStructuredExecution } = require('./wwwroot/structured-execution.js');

function fixture() {
  let time = 0;
  let sequence = 0;
  let calls = 0;
  const sources = { method: 'GET', environmentVersion: 1 };
  const controller = createStructuredExecution({
    now: () => time,
    newId: () => `fixture-${++sequence}`,
    readSources: () => structuredClone(sources),
    materialize: source => ({ request: source, warnings: [] }),
    run: async () => {
      calls += 1;
      return {
        delivery: 'response_received', httpStatus: 200, proxyStatus: 200,
        durationMs: 1, assertions: { passed: 0, failed: 0, partial: 0 },
        capture: 'not_requested', persistence: 'not_requested'
      };
    }
  });
  return {
    controller, sources,
    input: { collectionId: 'c1', folderId: null, requestId: 'r1', environmentId: 'e1' },
    advance: milliseconds => { time += milliseconds; },
    callCount: () => calls
  };
}

test('preparar não envia; executar sem aprovação também não', async () => {
  const context = fixture();
  const preparation = context.controller.prepare_request(context.input);
  assert.equal(preparation.state, 'ready_for_review');
  assert.equal(context.callCount(), 0);
  const result = await context.controller.execute_prepared({ preparationId: preparation.preparationId });
  assert.equal(result.error, 'approval_required');
  assert.equal(context.callCount(), 0);
});
```

- [ ] Executar `node --test ./StructuredExecution.test.cjs`; confirmar falha pela ausência do módulo, não por erro do harness.
- [ ] Implementar controlador mínimo com uma preparação privada, cópia independente das fontes e snapshot resolvido, IDs injetados e expiração em 300.000 ms. Bloqueios não retêm snapshot nem retornam ID utilizável.
- [ ] Adicionar e passar testes de fontes ausentes, cofre bloqueado, multipart sem arquivo, ações sem suporte, warning de body não bloqueador e nova preparação invalidando a anterior.
- [ ] Verificar expiração exatamente no limite; testar alteração do objeto de entrada e de fontes depois de preparar sem mutação do snapshot. Não expor a cópia interna no retorno.

## Tarefa 2 — Aprovação, concorrência e consultas

**Arquivos:** `wwwroot/structured-execution.js`, `StructuredExecution.test.cjs`.

- [ ] Criar testes vermelhos para aprovação de outra preparação, cancelamento, expiração após aprovação, edição de fontes após aprovação e falhas de leitura. Todas devem impedir `run`.
- [ ] Antes do envio, chamar `readSources` novamente e comparar fontes de maneira determinística com a cópia privada. Não regenerar timestamp/UUID das ações preparadas. Comparação inclui políticas, testes, Auth herdada, valores relevantes e versão do cofre; sem hashes persistidos ou logs de segredos.
- [ ] Testar dois `execute_prepared` síncronos/concorrentes com promessa de transporte ainda pendente. Reservar execução e consumir aprovação antes de chamar `run`; os dois resultados devem ter o mesmo `executionId` e uma chamada de transporte.
- [ ] Testar preparação distinta durante execução: retornar `execution_in_progress`. Nova preparação não cancela o HTTP ativo nem remove seu registro.
- [ ] Implementar estado `running` imediatamente consultável; finalizar por callbacks da promessa sem exigir uma segunda chamada de execução. Consultas devem ser cópias seguras independentes.
- [ ] Cobrir timeout, exceção antes do envio e exceção após início de transporte. `delivery: unknown` nunca produz reenvio automático. O adaptador deve fornecer etapa de falha; exceção sem evidência suficiente é `unknown`, não `not_sent`.
- [ ] Cobrir 21 resumos: remover apenas o mais antigo finalizado; manter execução ativa. `dispose()` libera preparações e snapshots e não tenta cancelar/repetir operações remotas. IDs desconhecidos retornam `execution_not_found`.
- [ ] Executar `node --test ./StructuredExecution.test.cjs`; confirmar todos os casos verdes.

## Tarefa 3 — Fatos e resumo seguro do resultado

**Arquivos:** `wwwroot/structured-execution.js`, `StructuredExecution.test.cjs`.

- [ ] Criar testes por tabela: HTTP 200 com testes verdes, HTTP 422, HTTP 200 com assertiva reprovada, contrato parcial, falha de rede, falha local anterior ao transporte, falha de persistência/captura posterior à resposta.
- [ ] Implementar resumo por lista explícita de campos, nunca espalhando objeto de resposta/erro remoto. Preservar `httpStatus: null` sem resposta; `proxyStatus` é independente.
- [ ] Sanitizar enumerações e validar contagens/duração como números finitos não negativos. Fatos inválidos retornam resultado desconhecido/local tipado, sem transformar ausência de informação em sucesso.
- [ ] Adicionar sentinelas distintos a URL, query, Auth, ambiente, body, erro, nomes de variáveis e valores de assertivas. Serializar todos os retornos e garantir ausência de cada sentinela; testar `prepare_request`, falhas, consultas durante envio e consultas finais.
- [ ] Confirmar que `partial > 0` permanece visível mesmo com `outcome: success`; UI nunca descreve contrato parcial como totalmente aprovado. Sem testes configurados, contagem zero não equivale a cobertura de testes.
- [ ] Executar `node --test ./StructuredExecution.test.cjs` e `node --check ./wwwroot/structured-execution.js`.

## Tarefa 4 — Adaptadores e extração mínima do envio individual

**Arquivos:** `wwwroot/app.js`, `wwwroot/index.html`, `AIFriendlyUi.test.cjs`, `AIAgentBridge.test.cjs`.

- [ ] Antes de editar, ler o fluxo completo de `sendCurrentRequest`, `performApiRequest`, `executeApiRequest`, `requestFromForm`, `responseResultsForRequest`, captura, histórico e Auth herdada. Anotar contratos observados no teste de integração, não presumir pureza de helpers.
- [ ] Criar testes vermelhos de preparação por IDs sem trocar a request/ambiente ativo, sem alterar preferências, sem HTTP/histórico e sem chamadas de token/introspecção. Selecionar ambiente diferente do ativo deve produzir as fontes desse ID, não do formulário.
- [ ] Resolver request com `findCollection`, `findFolder` e busca exata no container. Reusar funções de `RunnerLogic` para Auth herdada, resolução com proveniência e pré-request. Não chamar `loadHistoryEntry`, abrir request ou preencher formulário como estratégia de preparação.
- [ ] Extrair preparação comum mínima do formulário e da request salva, sem mudar a precedência existente. Separar coleta de dados do DOM, transformação pura e efeitos. Multipart sem arquivo efêmero disponível é bloqueado.
- [ ] Separar execução/fatos de apresentação onde necessário em `performApiRequest`; conservar um único `executeApiRequest`. O envio manual mantém suas confirmações atuais; o estruturado usa aprovação privada validada, nunca campos de confirmação enviados pelo chamador.
- [ ] Política estruturada de Auth é não persistir; definir também no objeto destinado ao histórico, não apenas no corpo enviado ao proxy. Não alterar checkbox/preferência global. Capturas e retenção precisam corresponder ao cartão aprovado.
- [ ] Instrumentar testes com contadores de rede e efeitos: persistência obrigatória que falha antes impede HTTP; gravação posterior que falha não altera entrega confirmada; captura falha aparece separadamente.
- [ ] Vincular resultado à aba/request de origem. Trocar de aba enquanto envio está pendente não sobrescreve resposta da nova aba, não desabilita seu editor indefinidamente e não atribui exemplo salvo à request errada.
- [ ] Carregar `structured-execution.js` antes de `app.js`. Criar instância em fechamento privado; testar ausência de métodos novos em `window.vortixAgent` e ausência de instância com snapshots em `window`.
- [ ] Executar `node --test ./StructuredExecution.test.cjs ./AIFriendlyUi.test.cjs ./AIAgentBridge.test.cjs ./RunnerLogic.test.cjs ./VortixRunner.test.cjs` e checar sintaxe dos arquivos alterados.

## Tarefa 5 — Cartão visual e acesso por teclado

**Arquivos:** `wwwroot/index.html`, `wwwroot/style.css`, `wwwroot/app.js`, `AIFriendlyUi.test.cjs`.

- [ ] Criar testes vermelhos para botão preparar somente em request salva, seleção explícita de ambiente, estado bloqueado, revisão aprovada, cancelamento e expiração.
- [ ] Adicionar cartão junto ao editor com método, ambiente, destino sanitizado, avisos e efeitos locais. Usar tokens de tema existentes, `textContent` para conteúdo dinâmico e estado por texto/ícone. URL com credencial/query sensível nunca aparece integralmente.
- [ ] Separar botões preparar, aprovar e executar: aprovação não envia; executar sem aprovação permanece bloqueado. Escrita exige checkbox e `TESTE` no contexto da preparação; manter confirmação contextual e consumir autorização uma vez.
- [ ] Associar labels, descrição do botão bloqueado, foco restaurado ao fechar revisão e `aria-live="polite"` sem repetir anúncio quando a mensagem não mudou. Não gerar um segundo anúncio paralelo do mesmo estado.
- [ ] Testar invalidadores durante revisão aberta: edição, troca de ambiente, Auth herdada alterada, cofre bloqueado, testes/persistência modificados e expiração. A UI deve solicitar nova preparação.
- [ ] Mostrar resumo compacto de execução com origem e estados; manter detalhes existentes acessíveis à pessoa. Não criar leitura de payload pelo contrato interno.
- [ ] Executar suítes direcionadas e inspecionar responsabilidades do trecho: extrair funções coesas em vez de adicionar um controlador gigante em `app.js`.

## Tarefa 6 — CI, documentação e validação real isolada

**Arquivos:** `.github/workflows/ci.yml`, `README.md`, `docs/maestri-portal.md`, `ROADMAP.md`.

- [ ] Incluir `./StructuredExecution.test.cjs` no comando Node de `.github/workflows/ci.yml`, preservando as outras suítes.
- [ ] Documentar que o contrato ainda é interno, como operar o cartão pela UI, resultado desconhecido após timeout/reload e ausência de persistência durável dos IDs. Não instruir agentes a invocar APIs privadas ou contornar interface.
- [ ] Registrar o recorte no roadmap, distinguindo implementação, testes, revisão e smoke. Não atualizar outras features ou corrigir status de hospedagem sem evidência própria.
- [ ] Executar os comandos abaixo; guardar resultados e códigos de saída sem segredos:

```powershell
node --test ./StructuredExecution.test.cjs ./RunnerLogic.test.cjs ./VortixRunner.test.cjs ./AIFriendlyUi.test.cjs ./AIAgentBridge.test.cjs
node --check ./wwwroot/structured-execution.js
node --check ./wwwroot/app.js
node --check ./wwwroot/agent-bridge.js
dotnet build ./VortixApiClient.csproj -c Release --no-restore
git diff --check
```

- [ ] Executar testes de proteção existentes com as pré-condições dos próprios scripts: `HostingMode.test.ps1` e `WorkspaceProtection.test.ps1`. Não atribuir sucesso de Node à proteção de rede/isolamento.
- [ ] Iniciar instância em porta livre, `ApiStudio__HostingMode=local` e `ApiStudio__DatabasePath` em diretório temporário exclusivo. Criar somente coleção/ambiente/fixtures descartáveis nesse workspace.
- [ ] Validar visualmente GET preparado sem HTTP, aprovação sem HTTP, execução com exatamente uma chamada, POST bloqueado sem confirmação, POST contra fixture descartável com aprovação, duplo clique, timeout e consulta sem reenvio.
- [ ] Validar edição após aprovação, troca de aba durante envio, captura/persistência revisadas, teclado, estados vazio/erro/andamento e temas claro/escuro. Conferir quebra de layout em viewport estreito sem mudar configuração pessoal.
- [ ] Medir baseline visual versus novo fluxo com mesma fixture e tarefa: chamadas de ferramenta, bytes/caracteres de contexto retornado, tempo e intervenções. Só chamar contagem de tokens se houver tokenizer/modelo identificado; não equiparar caracteres a tokens. Ganho de ferramenta externa ainda não é mensurável sem transporte externo.
- [ ] Revisão independente de segurança/regressões sobre diff final; corrigir achados concretos e repetir verificações afetadas. Não criar cadeia recursiva de revisores.
- [ ] Encerrar somente processos e abas criados para QA; preservar evidência sanitizada e todas as alterações alheias. Entregar limites e pendências, sem commit/publicação implícitos.

## Divisão de trabalho autorizada

- Orquestrador: integração acoplada em `app.js`, UI, decisões de fronteira de confiança e validação ponta a ponta.
- `deepseek_worker`, somente com bridge confirmado: controlador e suíte nova em tarefa delimitada com posse exclusiva dos dois arquivos. Se bridge indisponível, informar e seguir localmente; nunca afirmar execução DeepSeek sem resultado confirmado.
- `luna_reviewer`: revisão independente do controlador e da integração, configurado conforme papel disponível. Distinguir modelo configurado de modelo efetivamente confirmado.
- Evitar dois agentes escrevendo o mesmo arquivo. Não delegar o caminho crítico para ficar ocioso esperando: executar em paralelo apenas trabalho realmente independente.

## Critério de entrega

As três operações funcionam internamente com dados salvos e revisão visual; só a execução aprovada chama a API. Duplicação local é impedida, perda de resultado não causa replay, segredos não atravessam o resumo e o fluxo manual permanece funcionando. CI, build e smoke isolado têm evidência atual. MCP, transporte externo e execução de cenários ficam explicitamente fora desta entrega.
