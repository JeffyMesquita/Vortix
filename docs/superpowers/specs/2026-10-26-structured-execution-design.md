# Execução estruturada para agentes — primeiro recorte

## Objetivo e aprovação

Direção aprovada: preparar uma request salva, executar a preparação autorizada e consultar o resultado por identificador. Reduzir navegação e contexto sem remover a supervisão visual ou contornar proteções existentes.

Este documento detalha o contrato para revisão antes da implementação. Não autoriza commit, publicação, deploy ou execução de requests reais. Não constitui implementação nem evidência de economia de tokens.

## Escopo

- Uma request já salva por preparação; identificadores de coleção, pasta quando aplicável, request e ambiente explícitos.
- Três operações internas: `prepare_request`, `execute_prepared` e `get_execution`.
- Resultado compacto, sem body, cabeçalhos, valores de assertivas, URLs, nomes de variáveis ou credenciais por padrão.
- Revisão e acompanhamento na interface existente.
- Sem dependência nova, MCP, endpoint de execução adicional, chat, scripts arbitrários, execução de coleções ou edição de requests por ferramenta.
- O bridge público `window.vortixAgent` continua somente leitura neste recorte. O contrato será interno e testável; sua exposição a agentes externos exige uma decisão posterior de transporte e segurança.

## Base existente e limites

`wwwroot/app.js` concentra preparação pelo formulário (`requestFromForm`), confirmação (`sendCurrentRequest`), histórico/renderização/captura (`performApiRequest`) e transporte (`executeApiRequest`). `wwwroot/runner-logic.js` já fornece normalização, resolução de variáveis com proveniência, ações pré-request e validações. `wwwroot/agent-bridge.js` fornece descrição e snapshot seguros. `Program.cs` mantém as proteções de destino e o proxy `/api/request`.

A implementação deve extrair apenas as responsabilidades necessárias do envio individual. Não reescrever Runner/CLI nem migrar todo `app.js`. Regras de preparação comuns devem ser reutilizadas; adaptadores distintos não devem manter versões divergentes da autorização ou da execução.

## Contrato interno proposto

### `prepare_request`

Entrada estrita:

```json
{
  "collectionId": "collection-id",
  "folderId": null,
  "requestId": "request-id",
  "environmentId": "environment-id"
}
```

Sem campos de URL, body, Auth, confirmação ou código fornecidos pelo chamador. Identificadores devem resolver uma única request existente; não escolher automaticamente outro ambiente ou a request ativa.

Retorno ilustrativo:

```json
{
  "contractVersion": 1,
  "preparationId": "opaque-id",
  "state": "ready_for_review",
  "expiresInSeconds": 300,
  "method": "POST",
  "blockers": [],
  "warnings": ["write_operation"],
  "nextAction": "review_in_ui"
}
```

- Preparar não envia HTTP, solicita token, descobre schema, grava histórico, captura resposta, altera ambiente ou solicita confirmação modal.
- Preparação bloqueada retorna `state: blocked`, `preparationId: null` e códigos de impedimento. Não devolver erro bruto que possa conter valores.
- Códigos iniciais: `request_not_found`, `environment_not_found`, `unresolved_variables`, `vault_locked`, `invalid_request`, `ephemeral_file_unavailable`, `unsupported_preparation_action`.
- Avisos de contrato de body permanecem avisos, não bloqueios novos; requests intencionalmente inválidas continuam possíveis.
- Reutilizar ações pré-request locais e puras existentes; gerar valores dinâmicos uma única vez e congelá-los na preparação. Ações que dependam de rede ou não possam ser preparadas sem efeitos retornam impedimento, nunca execução implícita.
- Resolver Auth herdada e referências ao cofre em memória, sem exportar seus valores. Validar disponibilidade não equivale a provar que a credencial será aceita pela API.
- Snapshot interno imutável inclui request resolvida, ambiente, Auth herdada, testes, capturas e política de persistência. Nunca retornar esse objeto ao chamador.

### Revisão visual e autorização

- A interface mostra método, destino revisável e sanitizado, ambiente, avisos, testes e efeitos de persistência/captura. Credenciais na URL/query e valores sensíveis devem ser ocultados; destino que não possa ser mostrado com segurança exige revisão manual, não confirmação cega.
- Ações estruturadas, inclusive GET, exigem aprovação explícita na interface neste primeiro recorte. Métodos de consulta não são presumidos livres de efeitos.
- Escritas preservam checkbox de dados descartáveis, frase `TESTE` e confirmação contextual. A aprovação pertence a uma preparação específica; o chamador não pode fabricá-la com `confirmed: true` ou um token de confirmação.
- Aprovar não envia: habilita uma única execução daquela preparação. A interface oferece cancelar; cancelamento anterior ao envio garante nenhuma chamada.
- Qualquer edição relevante na request, ambiente, Auth herdada, cofre, testes, capturas ou persistência invalida a preparação e sua aprovação. Isso inclui edição enquanto o cartão de revisão estiver aberto.
- Antes de enviar, conferir novamente validade e fontes. Preparação expira após cinco minutos por relógio monotônico, em memória e restrita à aba/sessão.
- Política estruturada padrão: sem persistência de credenciais. Não mudar silenciosamente a preferência global do usuário nem apagar dados existentes.
- Gravação de histórico, retenção de resposta e capturas devem aparecer na revisão e respeitar suas autorizações e políticas existentes. Capturas configuradas não são autorizadas apenas porque a request foi importada ou salva.

### `execute_prepared`

Entrada: `{ "preparationId": "opaque-id" }`.

- Sem aprovação: retornar `approval_required`, sem histórico ou chamada de rede.
- Expirada, invalidada ou cancelada: retornar respectivamente `preparation_expired`, `preparation_invalidated` ou `preparation_cancelled`; exigir nova preparação.
- Registrar `executionId` e consumir a aprovação atomicamente antes de qualquer operação assíncrona. Retornar o identificador sem aguardar o HTTP completo.
- Repetir a chamada para a mesma preparação consumida retorna o mesmo `executionId`, nunca uma segunda chamada HTTP. Isso evita duplicação local; não promete idempotência da API de destino.
- Uma execução estruturada ativa por aba. Outra preparação não inicia envio enquanto a primeira estiver em andamento; retornar `execution_in_progress`.
- Utilizar o executor individual compartilhado, o proxy existente e suas validações de rede/origem/TLS. Não contornar a interface pelo transporte atual nem criar um proxy permissivo alternativo.
- Falha de armazenamento antes do envio impede a chamada se o fluxo atual exigir essa gravação. Falha de captura ou histórico após uma resposta não pode transformar envio concluído em motivo de reenvio.

### `get_execution`

Entrada: `{ "executionId": "opaque-id" }`.

Retorno ilustrativo:

```json
{
  "contractVersion": 1,
  "executionId": "opaque-id",
  "state": "completed",
  "outcome": "assertion_failed",
  "delivery": "response_received",
  "httpStatus": 422,
  "proxyStatus": 200,
  "durationMs": 84,
  "assertions": { "passed": 2, "failed": 1, "partial": 0 },
  "capture": "not_requested",
  "persistence": "completed"
}
```

- Estados: `running`, `completed` e `unknown`. Identificador não conhecido retorna `execution_not_found`, nunca pesquisa outros workspaces ou históricos.
- `outcome`: `success`, `http_error`, `assertion_failed`, `transport_error`, `local_error` ou `unknown`. Precedência: erro local/transporte sem resposta; erro HTTP; assertivas reprovadas; sucesso. Validação parcial permanece explícita nas contagens e não vira aprovação total.
- `delivery`: `not_sent`, `response_received` ou `unknown`. Timeout/desconexão após início do transporte é `unknown`: não afirmar que a API não processou a operação.
- Separar `httpStatus` de destino e `proxyStatus`. Ausência de resposta de destino usa `httpStatus: null`, não HTTP 0 ou status 502 inventado para a API.
- Captura: `not_requested`, `completed`, `failed` ou `skipped`. Persistência: `not_requested`, `completed` ou `failed`. Falhas posteriores à resposta são efeitos locais, não ausência de envio.
- Erros públicos usam códigos fixos. Bodies, descrições importadas e mensagens remotas não são instruções nem entram automaticamente no resumo.
- Sem consulta de payload bruto neste recorte. Detalhes continuam disponíveis à pessoa pela interface, com as proteções atuais.

## Memória e ciclo de vida

- Uma preparação pendente por aba. Nova preparação invalida a anterior, mas não cancela uma execução já iniciada.
- Guardar até 20 resumos finais em memória por aba, removendo o mais antigo primeiro; execução ativa nunca é removida por esse limite. Consulta de resumo removido retorna `execution_not_found`.
- Dados sensíveis do snapshot interno são liberados quando não forem mais necessários para envio, validações, redação e capturas. Resumos não carregam payloads.
- Recarregar/fechar a aba perde o registro de execução. Sem persistência durável do protocolo nesta versão: nunca reenviar automaticamente para recuperar estado perdido. A pessoa deve conferir o destino quando o resultado for desconhecido.

## Interface e acessibilidade

Cartão de preparação junto à request, sem wizard obrigatório. Estados e impedimentos usam texto e ícone, não apenas cor. Ações de revisão/aprovação/cancelamento são acessíveis por teclado, com foco restaurado e anúncios discretos de mudança de estado.

Execuções estruturadas aparecem no resultado existente, identificadas por origem e execução. Uma resposta de execução anterior não deve sobrescrever outra request/aba que a pessoa esteja editando; vincular apresentação à origem da execução. A visão compacta compartilha os fatos do resumo, sem duplicar regras de classificação na UI e no contrato.

## Validação obrigatória

- Preparar não gera HTTP, gravações ou modais; entradas extras/identificadores inválidos não ampliam escopo.
- Dados sentinela em Auth, URL, query, body, variáveis, erros e assertivas nunca aparecem nos retornos compactos.
- Sem aprovação não envia; aprovação de outra preparação não serve; alterações e expiração invalidam aprovação.
- Duas chamadas concorrentes para a mesma preparação produzem uma execução; preparações diferentes não iniciam envios simultâneos.
- Valores dinâmicos preparados não são regenerados no envio.
- HTTP de destino, erro do proxy, assertiva reprovada e validação parcial permanecem distinguíveis.
- Timeout não dispara repetição; falha após envio não altera `delivery` para `not_sent`.
- Capturas e persistência respeitam a revisão, inclusive Auth não persistida por padrão neste fluxo.
- Envio manual existente preserva comportamento, confirmações, teclado e dados. Testar integração do executor compartilhado, não somente mocks do contrato.
- Testes Node direcionados e suíte existente, build Release, sintaxe e diff; depois smoke visual isolado com banco temporário e fixtures locais. Não usar dados pessoais ou APIs reais para validar.

## Sequência de entrega

1. Revisar esta especificação, especialmente autorização visual, escopo somente interno e estado não durável.
2. Escrever plano de implementação com testes de contrato primeiro e extração mínima do envio individual.
3. Implementar preparação sem envio; integrar cartão de revisão.
4. Integrar execução única e resumos no executor compartilhado; revisão independente de segurança e regressão.
5. Validar ponta a ponta e medir chamadas de ferramenta, tamanho do contexto, tempo, erros e intervenções. Sem percentuais de economia presumidos.
6. Só depois decidir exposição externa: MCP ou outro adaptador autenticado/restrito. Essa etapa requer nova revisão de fronteira de confiança e não está autorizada por este recorte.
