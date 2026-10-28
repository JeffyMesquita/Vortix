# SDD — diagnóstico compacto e leitura progressiva

**Status:** alternativa A, contrato e [plano](../plans/2026-10-27-compact-diagnostics.md) aprovados; implementação autorizada e integrada localmente. [Validação](../validation/2026-10-27-compact-diagnostics.md): testes, smoke funcional e conferência visual por imagem registrados; descoberta comparável permanece não medida. Sem commit, publicação ou autorização para APIs reais.

**Base:** `master` em `eafccf9`; [continuidade](../../continuity.md), [descoberta e alternativas](2026-10-27-next-features-discovery.md) e [execução revisada entregue](../../structured-execution.md).

## 1. Objetivo

Permitir que pessoa e agente entendam o estado de uma request individual, o impedimento conhecido e o próximo controle útil sem reconstruir a bancada inteira. O diagnóstico usa os mesmos fatos da execução revisada, com leitura progressiva e sem aumentar autoridade de execução.

O ganho esperado é clareza e menos interpretação/navegação. Economia de tokens é hipótese a medir, não critério presumido de sucesso. O baseline inclui o campo atual `execution.status`, não apenas snapshots completos.

## 2. Escopo e não objetivos

### Incluído

- Editor ativo e seu painel de execução revisada; orientação anterior à preparação quando faltam request salva ou ambiente.
- Consulta compacta somente leitura, impedimentos conhecidos e resultado seguro sob demanda.
- Orientação visual contextual, foco por ação explícita e estados acessíveis.
- Contrato DOM v2 preservado, regressões de privacidade e protocolo de medição.

### Excluído

MCP, endpoints/portas novos, execução externa, outro executor, edição por ferramenta, leitura de payload/cabeçalhos/credenciais, histórico pesquisável por ID, snapshots de outros workspaces, Runner em lote, grafos de cenário, chat/LLM embutido, armazenamento durável, delta API, migração de dados e dependências novas.

Este primeiro diagnóstico não representa o andamento de um envio manual ou do Runner como se fosse uma execução revisada. Se outro fluxo ocupar o executor, informa impedimento conhecido; não inventa um registro de execução.

## 3. Princípios e invariantes

1. Consultar não chama HTTP, banco, token helper, introspecção ou captura; não prepara, aprova, cancela, expira ou executa requests.
2. Estado e sugestão de ação não constituem consentimento. Mesmo `approved` é observação, não credencial de autorização.
3. Controller e executor existentes continuam sendo a autoridade das operações e resultados. Não recalcular HTTP/entrega interpretando texto da tela.
4. Código de erro é fixo. Não ecoar exceção, texto importado ou mensagem de API.
5. Resultado remoto, validação e efeitos locais continuam separados. Timeout não prova que a API não executou; parcial não vira aprovação total.
6. Contexto inválido, antigo ou não verificável resulta em diagnóstico conservador, nunca em estado pronto inferido.
7. Dados da API são conteúdo não confiável, não instruções. Ações sugeridas pertencem a uma allowlist local de controles, não a URLs ou comandos recebidos.

## 4. Experiência e fluxo

O painel existente permanece expansível e não vira wizard obrigatório. Seu resumo legível informa estado, pendência principal e efeitos/resultados pertinentes. A pessoa pode abrir impedimentos conhecidos ou resultado sem perder método, rota e ambiente de vista.

- **Antes de preparar:** indicar request não salva, edições pendentes ou ambiente indisponível, sem resolver templates implicitamente.
- **Após preparar:** usar os códigos já produzidos pela preparação; não executar validadores novamente apenas para enriquecer uma consulta.
- **Antes de aprovar/enviar:** apontar o controle de revisão ou a proteção de escrita, sem marcar checkbox ou preencher `TESTE` automaticamente.
- **Durante execução:** indicar andamento e evitar sugestões de novo envio.
- **Após resposta:** mostrar primeiro entrega, HTTP, validação e captura/persistência; detalhes existentes continuam na bancada.
- **Outra aba/edição:** identificar que o último resultado não representa o contexto ativo; não apresentar fatos da execução anterior como resposta do novo rascunho.

Botão opcional **Ir ao impedimento** apenas expande o painel existente e move foco para campo/controle conhecido. Não altera valores, salva dados ou executa rede. Texto e ícone complementam cor; foco visível, labels, teclado, tema claro/escuro e viewport estreito são requisitos.

## 5. Fonte de verdade e integração mínima

### Fluxo de dados

1. Controller fornece preparação, aprovação e resumo da execução; app fornece somente os metadados de prontidão/contexto já conhecidos.
2. A UI monta fatos normalizados privados, sem passar request materializada, fontes de variáveis ou segredos ao diagnóstico.
3. Uma função pura produz a projeção segura e chaves de mensagens/ações. A UI usa essa projeção para orientação, sem substituir os guards existentes.
4. A UI publica apenas o registro seguro em `data-vortix-diagnostic` do `#structured-card`; o bridge lê e valida esse registro e aplica a seleção de vista.

O registro DOM não contém instância do controller, callbacks, request interna, IDs de execução/request, origem completa, nomes/valores de variáveis ou texto da resposta. Ele pode ser inspecionado no navegador e, portanto, deve ser seguro por construção.

### Registro DOM interno

Formato fechado; todos os campos são obrigatórios e chaves extras são inválidas:

```json
{
  "diagnosticVersion": 1,
  "revision": 7,
  "contextMatches": true,
  "observedAtMs": 1000,
  "validUntilMs": null,
  "state": "blocked",
  "blocker": "unresolved_variables",
  "nextAction": "environment.manage",
  "blockers": [
    { "code": "unresolved_variables", "target": { "kind": "action", "name": "environment.manage" } }
  ],
  "result": null
}
```

`contextMatches` é booleano; os dois campos de tempo são monotônicos do documento, nunca datas absolutas. `observedAtMs` deve ser finito, não negativo e não futuro no relógio da leitura. `validUntilMs` é finito e posterior à observação para estados `ready_for_review`/`approved`; nos demais é `null`. `state`, `blocker`, `nextAction`, `blockers` e `result` seguem os tipos das seções seguintes. O leitor calcula `freshness`; timestamps e `contextMatches` não entram em nenhuma vista pública.

### Responsabilidades propostas

- `wwwroot/agent-diagnostics.js` e `AgentDiagnostics.test.cjs`: projeção pura, catálogo fechado, validação e seleção das vistas. Seguir o padrão de módulo existente; exportar funções, nunca uma instância com dados.
- `wwwroot/structured-ui.js`: alimentar/publicar a projeção nos pontos de atualização já existentes e renderizar mensagens coerentes.
- `wwwroot/app.js`: fornecer booleans de prontidão/contexto e invalidar a publicação ao mudar aba, ambiente ou rascunho, sem expor getters de dados privados.
- `wwwroot/agent-bridge.js`: acrescentar `diagnose()` somente leitura; não resolver dados ou chamar o controller.
- `wwwroot/index.html`/`style.css`: affordances acessíveis e carregamento do módulo antes de bridge/UI.
- Suítes atuais de bridge, UI e integração: compatibilidade e ausência de efeitos; CI, guia e roadmap atualizados apenas na implementação.

Sem event bus, store global, polling adicional ou refatoração geral de `app.js`. Aproveitar o refresh atual de 500 ms e os eventos existentes. Se um ponto de contexto exigir callback novo, ele permanece privado e só invalida/publica diagnóstico, não altera autorização.

## 6. Compatibilidade e API de leitura

Manter `window.vortixAgent.contractVersion === 2`, `describe()` e `snapshot()` com seus formatos/comportamentos atuais. Adicionar `diagnose()` ao objeto congelado é extensão aditiva; `diagnosticVersion: 1` versiona o contrato novo independentemente.

Chamadas aceitas:

```js
window.vortixAgent.diagnose()
window.vortixAgent.diagnose({ view: 'summary' })
window.vortixAgent.diagnose({ view: 'blockers' })
window.vortixAgent.diagnose({ view: 'result' })
```

Sem argumento equivale a `summary`. Quando presente, a entrada deve ser objeto simples com exatamente uma propriedade própria de dados `view`, com um dos três valores acima. Rejeitar `null`, arrays, extras, símbolos, accessors e seletores/IDs arbitrários sem invocar getters.

Entrada inválida retorna somente `{ "diagnosticVersion": 1, "error": "invalid_diagnostic_options" }`, sem eco ou exceção bruta. Cada retorno é uma cópia independente de dados seguros; mutá-lo não altera UI, controller ou leitura posterior.

## 7. Vistas e campos

### `summary` — padrão

```json
{
  "diagnosticVersion": 1,
  "revision": 7,
  "state": "blocked",
  "freshness": "fresh",
  "blocker": "unresolved_variables",
  "nextAction": "environment.manage"
}
```

- `revision`: inteiro seguro não negativo, local ao documento; `null` se registro indisponível. Muda quando fatos publicados ou contexto mudam, não a cada tick idêntico. Não é ID global nem prova de autorização e não deve ser comparado entre reloads.
- `state`: `unavailable`, `idle`, `blocked`, `ready_for_review`, `approved`, `running`, `completed` ou `unknown`.
- `freshness`: `fresh`, `stale` ou `unavailable`. É verificada a cada leitura; revisão igual não dispensa essa checagem.
- `blocker`: código principal conhecido ou `null`. Ausência de impedimento conhecido não comprova request válida nem credencial aceita pela API.
- `nextAction`: nome existente de controle permitido ou `null`; nunca ferramenta, script, URL ou autorização fabricada.

### `blockers` — contexto adicional seguro

Os seis campos comuns mais `blockers`, uma lista de impedimentos conhecidos com `{ code, target }`. `target` é `null` ou `{ kind: 'region' | 'action', name: <identificador permitido> }`. Não incluir mensagens livres nem dados da request.

Lista limitada aos códigos do catálogo, sem duplicatas, ordenada por prioridade fixa. Não alegar diagnóstico exaustivo: a preparação atual pode descobrir um impedimento por vez. Warnings de contrato de body permanecem warnings; não viram bloqueios novos.

### `result` — fatos finais sob demanda

Os seis campos comuns mais `result`. Se não houver resultado terminal correspondente ao contexto ativo e vigente, `result: null`. Um resumo terminal de resultado desconhecido também pode ter `result` seguro, com `delivery: unknown`; não confundir isso com leitura degradada por contexto/frescor, que sempre retorna `result: null`. Não pesquisar outro ID nem devolver outro registro como alternativa.

`result` contém somente:

| Campo | Tipo/valores |
| --- | --- |
| `outcome` | `success`, `http_error`, `assertion_failed`, `transport_error`, `local_error`, `unknown` |
| `delivery` | `not_sent`, `response_received`, `unknown` |
| `httpStatus`, `proxyStatus` | Inteiro HTTP 100–599 ou `null`, separados |
| `durationMs` | Número finito não negativo |
| `assertions` | Contagens inteiras seguras não negativas `passed`, `failed`, `partial` |
| `validation` | `not_run`, `passed`, `failed`, `partial` |
| `capture` | `not_requested`, `completed`, `failed`, `skipped` |
| `persistence` | `not_requested`, `completed`, `failed` |

`validation` deriva uma vez das contagens: falhas prevalecem; depois parciais; depois aprovadas; zero em todas é `not_run`. `outcome: success` é resultado técnico e não apaga uma validação parcial ou não executada. Falha de efeito local não pode mudar entrega conhecida para `not_sent`.

## 8. Catálogo e sugestões permitidas

Preservar os códigos já existentes e acrescentar apenas observações de prontidão/contexto necessárias:

| Código | Orientação/target permitido |
| --- | --- |
| `request_not_saved`, `unsaved_changes` | `request.save` |
| `request_not_found` | Região `collections` |
| `environment_not_found`, `unresolved_variables` | `environment.manage` |
| `vault_locked` | `settings.open` |
| `invalid_request` | Região `request-editor` |
| `ephemeral_file_unavailable`, `unsupported_preparation_action` | Região `request-editor`; envio manual requer revisão própria |
| `write_confirmation_required` | Região `structured-execution`; nunca preencher ou atestar dados de teste |
| `preparation_expired`, `preparation_invalidated`, `preparation_cancelled` | `execution.prepare`, somente se o controle estiver disponível |
| `execution_in_progress` | Região `structured-execution`, sem nova execução |
| `context_changed` | Região `request-workspace`, sem fatos do contexto anterior |
| `diagnostic_unavailable`, `diagnostic_stale` | Região `structured-execution`, sem sugestão de envio |

`nextAction` pode ser somente `request.save`, `environment.manage`, `settings.open`, `execution.prepare`, `execution.review`, `execution.execute` ou `null`. Não sugerir controle ausente, desabilitado, oculto ou inerte. Enquanto um diálogo de confirmação bloquear a bancada, manter a fase observada sem sugerir abrir outra revisão ou confirmar em nome da pessoa. Não sugerir excluir, exportar, importar, executar coleção ou acionar diretamente o envio manual.

`ready_for_review` aponta a `execution.review`; `approved` pode apontar a `execution.execute` se o controle estiver habilitado e os fatos/contexto estiverem vigentes. Ambos são hints: o operador continua sujeito ao consentimento e às validações existentes.

## 9. Prioridade, contexto e ciclo de vida

- Registro ausente/corrompido/versão desconhecida: `unavailable`, `diagnostic_unavailable`, sem ação. Não procurar dados no armazenamento ou em outro painel.
- Publicação antiga: `unknown`, `freshness: stale`, `diagnostic_stale`, sem ação/resultado. Contexto sem correspondência: `unknown`, `freshness: unavailable`, `context_changed`, sem ação/resultado. Resultado terminal desconhecido com contexto vigente mantém `freshness: fresh` e pode ser detalhado em `result`.
- Execução correspondente em andamento/finalizada usa seus fatos; não trocar uma execução em andamento por `idle` apenas porque outro controle mudou.
- Sem execução correspondente: primeiro prontidão e impedimentos da preparação; depois aprovação observada, revisão pendente ou `idle`.
- Proteção de escrita ainda não satisfeita antes da aprovação é impedimento conhecido. Depois de aprovar, seguir a semântica de revogação/cancelamento existente; não criar regras de autorização paralelas no leitor.
- Resultado não deve representar outra aba, ambiente ou edição do rascunho. Manter apenas os marcadores mínimos de origem em escopo privado para comparação; eles não entram no registro público.

Invalidar a publicação sincronicamente ao iniciar mudança de aba/ambiente/rascunho ou ao descartar contexto; só republicar após conhecer o contexto novo. Enquanto isso, o leitor retorna `unknown`/`unavailable`, sem revalidar nem alterar o controller. Preservar os cuidados existentes com BFCache, confirmação assíncrona antiga e execução única.

O registro guarda internamente um instante monotônico da observação e validade da preparação quando aplicável, sem expor timestamps absolutos. Limite inicial proposto de frescor: 2.000 ms, quatro ciclos do refresh existente. O leitor usa a menor validade entre esse limite e o prazo publicado da preparação; ao ultrapassar, apenas degrada a leitura, sem expirar/cancelar o controller. Background throttling resulta em leitura conservadora, não extensão de aprovação.

O limite de frescor é escolha de contrato a validar em fixtures com relógio controlado e browser; não é latência medida nem motivo para acrescentar polling. UI e diagnóstico devem sinalizar contexto em atualização sem repetir anúncios a cada tick.

## 10. Limites e privacidade por construção

Tetos iniciais do contrato, em bytes UTF-8 serializados: `summary` 512; `result` 2.048; `blockers` e registro DOM 4.096. São tetos de segurança, não metas de conteúdo ou economia comprovada.

Justificativa verificável: seis campos comuns com enums fechados e uma revisão inteira; resultado com campos fixos e três contagens; no máximo 17 códigos distintos de impedimento com targets fechados. Os testes devem construir os maiores valores permitidos e provar que todos cabem. Caso a conta não feche, revisar o contrato antes da implementação; não truncar dados silenciosamente.

Registro maior que o teto, JSON inválido, campos extras, número não finito/inseguro ou enum fora da allowlist produzem `diagnostic_unavailable`, sem eco. Usar APIs nativas e construção explícita de campos, sem espalhar objetos de request/erro ou atribuir chaves arbitrárias a objetos de saída.

O DOM é uma superfície pública da página e pode ser modificado por código da mesma origem; um registro aparentemente `approved` nunca substitui validação privada da execução. Não apresentar essa projeção como nova fronteira de autenticação.

## 11. Matriz de aceitação e regressão

| Caso | Resultado exigido |
| --- | --- |
| Sem request salva ou rascunho editado | Impedimento tipado; nenhuma leitura provoca salvamento |
| Variável ausente ou cofre bloqueado | Código/target úteis sem nome/valor sensível; zero rede |
| Preparação válida GET | Revisão disponível, não autorização de envio |
| Escrita sem proteção/aprovação | Orientação da revisão; nenhuma atestação automática |
| Preparação aprovada que expira | Leitura conservadora, sem estender validade; executor continua validando |
| Request em andamento | Não sugerir novo envio nem regenerar valores preparados |
| HTTP 422 | Status do destino separado do proxy e das assertivas |
| HTTP 200 com assertiva reprovada/parcial/ausente | `failed`, `partial` e `not_run` distinguíveis |
| Timeout após início do transporte | Entrega desconhecida; sem replay automático ou sugestão de reenvio |
| Falha local após resposta | Preservar HTTP/entrega e separar efeito local |
| Troca de aba/ambiente/edição | Não atribuir resultado anterior ao contexto novo, nem durante a transição |
| BFCache e confirmação antiga | Retomar observação sem restaurar aprovação ou repetir envio |
| Sentinelas em todos os campos sensíveis/erros | Não aparecem em nenhuma vista, JSON, mensagem de erro ou record DOM |
| Leitura repetida/mutação de retorno | Zero efeitos e estado privado inalterado |
| Opções inválidas, getters e atributos adulterados | Falha fechada com códigos fixos; sem eco nem busca alternativa |
| Clientes v2 existentes | `describe`, `snapshot`, IDs, guards e fluxos atuais continuam funcionando |
| Teclado, temas e viewport estreito | Orientação utilizável, foco visível, sem dependência exclusiva de cor |

Testes puros com relógio controlado; testes do bridge em DOM sintético; UI com controller real e contadores de rede/storage; suíte existente; build/sintaxe/diff; smoke isolado no navegador. Testar os modos local e público no escopo afetado. Não usar banco pessoal ou APIs reais.

## 12. Protocolo de medição

Comparar três caminhos na mesma fixture/tarefa: fluxo atual com campo `execution.status`; fluxo atual com região/seletores focados; novo diagnóstico com expansão sob demanda. Snapshot completo só quando realmente necessário à descoberta. Separar descoberta inicial e uso recorrente.

Casos: GET válido, variável ausente, POST aguardando aprovação, assertiva reprovada, validação parcial e timeout. Registrar sucesso correto, chamadas de ferramenta, caracteres/bytes recebidos por etapa, duração e intervenções. Tokens somente com cliente/modelo/tokenizer identificados; sem estimativa escondida baseada em caracteres.

Usar pelo menos cinco repetições por caso e caminho, com mesmos estados iniciais e política de autorização. Publicar mediana e faixa de variação, falhas e contexto adicional solicitado; cinco repetições não autorizam alegar significância estatística ou ganhos universais. Começar por harness determinístico; benchmark com agente real só em terminal visível autorizado no Maestri.

Gate obrigatório: zero vazamento, zero envio não autorizado, zero replay indevido e zero falsa certeza sobre entrega/validação nos casos de aceitação. Gate de utilidade: a orientação precisa resolver os casos sem reconstrução desnecessária da bancada. Se o ganho de contexto não aparecer, reportar sem percentual e reduzir/reavaliar a projeção em vez de ampliar a API.

## 13. Entrega incremental, rollback e governança

1. Projeção/catalogação pura com casos e sentinelas; sem publicação pública ainda.
2. Publicação segura e orientação no painel existente, com invalidação de contexto e testes de ciclo de vida.
3. `diagnose()` aditivo no bridge, documentação e compatibilidade v2.
4. Validação isolada e relatório comparável; decisão explícita sobre manter/ampliar o recorte conforme evidência.

Cada incremento deve manter o produto utilizável. Rollback remove o método/publicação novos e restaura a orientação anterior, sem migrar ou apagar dados, sem alterar executor/proxy/permissões. Não criar feature flag ou camada de compatibilidade especulativa.

No Maestri, eventual delegação somente em terminal interativo visível do workspace ativo, com `<personagem de anime> — <papel>`. Responsabilidades futuras, não agentes iniciados: `Kakashi — Tech Lead` para contrato, `Sakura — Frontend` para UI, `Shikamaru — QA` para regressão/medição. Modelo e disponibilidade precisam ser confirmados; sem recurso exposto, não usar background como substituto.

## 14. Decisão registrada e próximo passo

O usuário confirmou este contrato de leitura aditivo, seu escopo no painel revisado, vistas, frescor e limites. O plano correspondente detalha tarefas/testes e posse de arquivos. A implementação é o próximo gate; aprovar o SDD não autoriza automaticamente MCP, APIs reais, commits, PR, merge ou deploy.
