# Dependências visuais no Runner — primeira fatia

Estado: SDD proposto para revisão, sem implementação. Direção aprovada pelo usuário: explicar dependências na sequência existente e riscos de reexecutar falhas. Este documento fecha o recorte concreto antes do plano de implementação. Base inspecionada: `0816037` (PR #38). A alteração local da logo no README e os sete arquivos untracked anteriores permanecem preservados.

## Objetivo e cenário

Uma coleção captura um identificador ou token no passo 1 e o utiliza no passo 2. Hoje o Runner mostra origens de variáveis, mas não explica que uma captura anterior pode fornecer o dado, que outro escopo pode prevalecer ou que reexecutar apenas falhas deixa produtores fora da seleção.

A primeira entrega acrescenta uma explicação efêmera ao plano do Runner visual, antes de enviar requests. Diferencia disponibilidade inicial, capturas possíveis e referências ausentes ou não analisáveis. Não promete sucesso HTTP, captura ou autorização.

## Alternativas e decisão

1. **Explicação no plano linear existente — escolhida.** Reutiliza sequência, campos e resolução atuais. Permite entregar informação útil sem novo executor.
2. **Replanejar automaticamente dependências.** Não escolhido: pode repetir escritas, sobrescrever dados e produzir efeitos remotos imprevistos.
3. **Editor de grafo ou paridade completa com CLI.** Não escolhido nesta fatia: amplia UI, contratos e diferenças de armazenamento sem necessidade demonstrada.

Não criar grafo, loops, reordenação, execução automática de produtores, outro histórico, transporte externo, MCP, novas dependências ou migração. Não corrigir implicitamente o isolamento de variáveis entre datasets: é comportamento existente que esta entrega precisa explicar.

## Fontes de verdade verificadas

| Responsabilidade | Fonte atual |
|---|---|
| Ordem e Auth herdada | `flattenRequests`, `resolveInheritedAuth`, `authScopesBeforeRunnerTarget` |
| Plano visual | `openRunnerDialog` e `renderRunnerPlan`, em `app.js` |
| Casos da rodada | `startRunnerFromForm`: dataset externo, entradas internas, limite de 500 casos |
| Templates e origem | `inspectTemplateReferences`, `templateReferenceSource`, `resolveTemplateWithProvenance` |
| Campos efetivos da request | `templateFieldsFromSavedRequest`, incluindo Auth herdada, GraphQL e multipart |
| Ações temporárias | `normalizePreRequestActions` e semântica ordenada de `runPreRequestActions` |
| Captura visual | `runRunnerCases`, `captureResponseVariable` e `saveEnvironmentVariable` |
| Reexecução | `rerunRunnerFailures`, somente casos classificados como falha |
| Histórico seguro | Allowlist de `createRunnerHistorySnapshot`; não comporta mapa de dependências |

Não existe `buildRunnerPlan` na base. O CLI tem `planCases`, que já usa um marcador de captura anterior no pré-plano; sua execução mantém capturas em memória e difere do cofre/persistência da UI. CLI e JUnit ficam inalterados.

O listener de `runner-datasets` já chama `renderRunnerPlan` ao editar o campo. Estender essa atualização existente; não criar outro listener paralelo. O preview atual considera apenas o primeiro dataset, o que não basta para a nova explicação.

## Semântica da análise

### Disponibilidade e precedência

Preservar `dataset > pré-request > cofre > ambiente`. Cofre indisponível impede a resolução após dataset/pré-request; não cair para ambiente. Cofre bloqueado impede referências aos seus nomes conhecidos. Valor vazio configurado continua sendo presença, conforme o resolvedor atual.

A análise inspeciona os campos efetivos e declarações das ações nativas, sem executar ações, gerar UUID/timestamp, resolver valores ou preparar uma request para envio. Reutilizar o parser de referências e as regras de origem existentes; compartilhar a extração de campos hoje local a `app.js`, sem criar cópia divergente.

Inspecionar ações pré-request na ordem configurada. Uma declaração não prova que seu resultado existirá: referências ausentes/bloqueadas no template ou em ação anterior tornam a disponibilidade posterior condicional ou não analisável. UUID/timestamp são apenas saídas declaradas, sem geração no pré-plano. Não marcar a request como suprida apenas pela presença de um nome de ação.

Para cada referência, registrar origem inicial e capturas anteriores potencialmente relevantes. Uma captura em ambiente não vence dataset, pré-request ou segredo de mesmo nome no cofre. Uma captura no cofre pode superar ambiente, mas continua condicionada ao sucesso e à disponibilidade do cofre. Ações pré-request são temporárias por caso e não se tornam produtoras para os seguintes.

### Capturas são possibilidades

No Runner visual atual, a captura só é chamada após transporte sem erro e HTTP 2xx, mesmo quando a opção `responseSuccessOnly` não está marcada. Uma assertiva reprovada pode coexistir com captura bem-sucedida. JSON inválido, caminho ausente, falha de persistência ou cofre indisponível podem impedir atualização.

Logo, nunca chamar uma captura prevista de valor disponível ou produtor confirmado. Se existirem vários produtores, informar o candidato mais recente de cada destino e a existência dos anteriores. Se ele falhar, uma captura anterior ou valor inicial pode continuar vigente. Uma captura anterior no cofre pode prevalecer sobre uma posterior no ambiente: ordem temporal não substitui a precedência de escopos. Não assumir que o último candidato necessariamente vence.

Uma captura inválida ou request estaticamente incompatível com o Runner não fornece produtor previsto válido. Para captura, compartilhar a regra de nome de `saveEnvironmentVariable` com `validateResponseCaptureForm` e a análise: regex `^[A-Za-z0-9_.-]{1,80}$`, excluindo `__proto__`, `prototype` e `constructor`. Não copiar uma terceira regra.

Para incompatibilidades estáticas, compartilhar as checagens já presentes em `prepareSavedRequest`: `tokenRequest`, método não suportado, multipart com arquivo e GraphQL fora de POST. Extrair apenas esses predicados puros e reutilizá-los no preparo existente e na análise, preservando mensagens/validações de execução. Emitir `unsupported_request` no caso e omitir sua captura como candidata. Isso não é uma previsão completa de executabilidade: URL, valores, consentimento e resultado remoto continuam sujeitos ao executor atual. Não consultar respostas, JSONPath de resultados reais ou valores para inferir sucesso.

### Datasets e reexecução

Respeitar a ordem real de casos, incluindo os datasets. As capturas visuais atualizam o ambiente/cofre e podem ser observadas pelo dataset seguinte. Não reiniciar artificialmente a disponibilidade entre conjuntos. Identificar relações que cruzam conjuntos, sem exibir dados das linhas.

Uma variável inicialmente existente tem origem inicial válida; não declarar dependência obrigatória de captura só porque há produtor anterior. Mostrar a possível atualização e eventual uso de dado anterior se a captura falhar.

Na reexecução, analisar apenas o subconjunto de falhas que será realmente enviado, no estado atual. Informar quando candidatos da rodada anterior ficaram fora. Casos ignorados por parada não são falhas selecionadas automaticamente. Nunca acrescentar produtores, reutilizar confirmação antiga ou prometer restaurar estado remoto.

## Contrato interno proposto

Adicionar uma função pura `analyzeRunnerDependencies` em `runner-logic.js`, consumida apenas pela UI nesta fatia. Não adicionar método ao `window.vortixAgent`.

**Entrada:** casos ordenados derivados das entradas/datasets já validados; índice da entrada e do dataset; campos de template efetivos/Auth herdada; metadados de captura; disponibilidade inicial por nomes de ambiente/cofre; declarações pré-request. Para reexecução, incluir somente metadados do plano anterior necessários para identificar produtores omitidos, sem dados de resposta. Não passar valores do ambiente/cofre à análise quando basta presença.

**Saída efêmera:**

- `analysisVersion: 1`, `complete: boolean`, `issues: string[]`.
- `cases[]`: `caseOrdinal`, `stepOrdinal`, `datasetOrdinal`, `issues`, contagens por origem, referências e captura prevista. Não retornar um booleano genérico de executabilidade.
- Cada referência: nome configurado local, categoria fixa de campo, `initialSource`, `candidatesByTarget`, `conditional` e `shadowed`. `candidatesByTarget` contém no máximo duas entradas, uma por destino `environment`/`vault`, com ordinal do candidato anterior mais recente, quantidade de candidatos daquele destino e `crossDataset`. Ordinais referem-se à lista de casos analisada; não escolher uma origem final entre ramos condicionais.
- Origem inicial: `dataset`, `pre-request`, `vault`, `environment`, `locked`, `unavailable`, `missing`, exatamente as categorias de `templateReferenceSource`. Campo não extraível não inventa uma origem `unknown`: sinalizar `unsupported_reference` e `complete: false`.
- Captura: nome configurado local, destino `environment` ou `vault`, `conditional: true`; omitir captura inválida como candidata e emitir issue fixa.
- Issues: `invalid_dataset`, `case_limit`, `reference_limit`, `invalid_capture`, `unsupported_request`, `unsupported_reference`, `producer_omitted`, `cross_dataset`, `multiple_candidates`, `existing_value`, `vault_locked`, `vault_unavailable`.

Nomes servem exclusivamente à explicação local e ao matching interno. Não são identificadores DOM, títulos de botões, atributos `data-vortix-*`, logs, mensagens globais ou campos da ponte. Categorias de campo são fixas, nunca nomes de headers/query/chaves da resposta.

Não retornar valores, URLs, rotas, headers, bodies, credenciais, texto bruto de erro ou conteúdo de dataset. IDs da análise são ordinais locais à revisão. Resultado não contém `ready`, aprovação ou sugestão de execução automática.

**Limites:** manter 500 casos, até 100 datasets e até 10 ações por request já existentes. A nova projeção processa no máximo 2.000 referências únicas no total da análise, deduplicadas pela tupla `(caseOrdinal, categoria de campo, nome)`; esse é orçamento inicial de UI, não novo limite de requests. Repetir o mesmo nome no mesmo campo/caso conta uma vez; em outro campo ou caso conta novamente. Ao excedê-lo, retornar `complete: false` e `reference_limit`; não concluir que referências restantes estão resolvidas. Agregar candidatos por referência, sem gerar todas as combinações de arestas. Entrada não analisável produz issue fixa e estado parcial, nunca erro bruto.

## Experiência e acessibilidade

Preservar a seção **Sequência**, os controles e os resultados. Acrescentar resumo compacto de relações/avisos, com detalhes recolhidos por passo e identificação de dataset quando necessária. Priorizar pendências; não mostrar um grafo ou outra tabela de resultados.

Exemplos de mensagens, com ordinais ilustrativos:

- “Pode usar captura do passo 1; depende do sucesso da captura.”
- “Há valor inicial disponível; uma captura anterior pode atualizá-lo.”
- “O conjunto de dados tem prioridade sobre esta captura.”
- “Pode usar captura do conjunto anterior.”
- “Referência sem origem inicial ou captura anterior identificada.”
- “Análise parcial; confira os dados antes de executar.”

Nomes configurados podem aparecer apenas no detalhe local, usando `textContent`; valores nunca aparecem. Resumo e nomes acessíveis dos controles permanecem genéricos. Usar `details`/`summary`, foco visível, texto além de cor e aviso agregado com `aria-live="polite"`, sem anunciar cada referência ou roubar foco ao digitar.

Datasets inválidos exibem “Revise os conjuntos de dados” em vez de analisar silenciosamente `{}`. Não alterar as validações/erros já exigidos para iniciar uma rodada.

Recalcular ao abrir, editar datasets, trocar ambiente/cofre enquanto o diálogo estiver aberto, antes da confirmação inicial e antes de reexecutar falhas. O resultado descreve a revisão atual; durante a execução fica identificado como previsão anterior, sem evoluir para resultado confirmado. Nenhum temporizador ou leitura contínua do storage.

Na reexecução, apresentar uma revisão explícita do subconjunto e dos avisos antes dos guards existentes. Cancelar essa revisão não executa nada. Os guards de escrita, HTTP e TESTE continuam sendo exigidos para os mesmos casos e não recebem autorização da análise.

## Segurança, armazenamento e consumidores

- Função pura: sem HTTP, clipboard, storage, execução de ações, desbloqueio de cofre ou alterações nos argumentos.
- Não registrar análise no histórico, coleção, abas, backup, exportação, JUnit ou ponte IA. Manter allowlists existentes.
- Não buscar referências externas nem executar scripts importados.
- Preservar o funcionamento de local/público, sessões, SSRF, Auth e cofre. Nenhuma mudança no servidor ou formato persistido.
- Mudança de contexto invalida a revisão. Bloqueio/indisponibilidade de cofre não produz fallback de ambiente nem estado de sucesso.

## Aceitação e validação necessária na implementação

1. Captura prevista no passo 1 e referência no passo 2 geram relação condicional sem valor no resultado.
2. Referência ao produtor posterior continua sem origem anterior; não reordenar a sequência.
3. Dataset, pré-request e cofre sombreiam captura em ambiente conforme precedência real, inclusive com valores configurados vazios.
4. Ambiente com valor inicial mais captura anterior gera aviso de possível atualização, sem declarar ausência obrigatória.
5. Múltiplos candidatos conservam a incerteza quando o mais recente falha; não inventar sucesso nem apagar fallback anterior. Uma captura mais antiga em cofre não perde prioridade só porque outra mais recente grava no ambiente; candidatos são separados por destino.
6. Cofre locked/unavailable, captura em cofre e colisão com ambiente preservam falha fechada e destinos distintos.
7. Dados de dois conjuntos são analisados em ordem real; referências que podem observar captura de conjunto anterior ficam explícitas.
8. Auth herdada, GraphQL, multipart de texto e templates pré-request reutilizam a extração existente; ação não é executada durante análise.
9. Reexecutar falhas revisa apenas o subconjunto e produtores omitidos; cancelar não envia; guards reaplicados; nenhum produtor/skipped é incluído.
10. Sentinelas de valores em URL, Auth, headers, bodies, ambiente, cofre, dataset e mensagens não aparecem na saída. Nomes locais não entram no contrato/labels/IDs da ponte.
11. Acima de 500 casos ou do orçamento de referências, análise limitada/parcial sem falsa completude; UI não trava com os casos máximos suportados.
12. Fixtures diferentes de sucesso HTTP, falha de assertiva, falha de captura e valor anterior demonstram que a previsão não se converte em resultado confirmado.
13. Sem mutação/HTTP/storage/UUID/timestamp no pré-plano; histórico/exportação/CLI permanecem equivalentes à base.
14. Smoke desktop isolado: abrir detalhes, editar datasets, avisos, teclado/foco, troca de contexto e cancelamento da revisão; sem APIs reais ou banco pessoal. Mobile permanece fora do escopo previamente dispensado.

Usar testes puros e DOM mínimo com spies para ausência de efeitos; integração somente com mocks loopback. Depois executar suíte JS atual, build e checks proporcionais, revisão independente e smoke pelo Portal. Não criar teste que apenas espelha CSS.

## Entregas pequenas e posse prevista

1. **Lógica e regressões:** compartilhar extração de campos, analisar disponibilidade/candidatos sem valores e testar precedência/limites. `runner-logic.js` e `RunnerLogic.test.cjs`; um escritor.
2. **Plano visual:** integrar na sequência e atualizações já existentes, com resumo/detalhes acessíveis. `app.js`, `index.html`, `style.css` e testes UI; mesmo escritor ou implementação serializada para evitar disputa de `app.js`.
3. **Reexecução revisada:** avisos do subconjunto, cancelamento e guards preservados; testar sem rede real.
4. **Integração:** README/roadmap/evidência, revisão independente, suite/build/smoke. Publicação é etapa posterior, sobre diff concreto.

Não introduzir novo framework, planejador, store, barrel ou abstração de transporte. Se a mudança não couber de forma coesa nos helpers atuais, extrair apenas a responsabilidade afetada e justificar no plano.

Rollback: retirar a chamada/renderização da análise e sua revisão adicional, retornando ao Runner atual. Como nenhum dado persistido muda, não há migração reversa. Não remover guards anteriores.

## Proveniência e revisão do SDD

Senku mapeou fluxo e consumidores; Hange fez revisão somente leitura de riscos e do SDD concreto, sem bloqueador de arquitetura. Maestro redigiu este SDD e incorporou os quatro ajustes de contrato: retirar executabilidade genérica, definir unidade do orçamento, compartilhar validação do nome de captura e remover a origem indefinida `unknown`. A autorrevisão também separou candidatos por destino para preservar a prioridade do cofre sobre ambiente. Um achado do mapeamento sobre ausência de listener de datasets foi corrigido por inspeção: ele já existe.

Tentativa solicitada de GPT-6.1 Terra no terminal visível Kakashi, conta Pessoal: primeira inicialização falhou no socket do daemon; com `--no-daemon`, bootstrap falhou `workspace routing discovery unauthorized (401)`. O modelo não executou a tarefa e não produziu este documento. Nenhuma mudança de conta, auth ou routing foi feita para contornar a falha.

Esta rodada executou apenas inspeção e documentação; não validou a implementação proposta. Consulta atual de GitHub Issues não encontrou issues abertas. [Descoberta anterior](2026-10-27-next-features-discovery.md), seção B, fornece o contexto; este recorte não retoma o diagnóstico compacto.
