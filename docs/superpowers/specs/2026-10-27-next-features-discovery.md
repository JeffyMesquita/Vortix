# Próxima rodada SDD — descoberta e escolha do recorte

**Estado:** alternativa A, [SDD detalhado](2026-10-27-compact-diagnostics-design.md) e [plano](../plans/2026-10-27-compact-diagnostics.md) aprovados; implementação autorizada e integrada localmente, sem commit ou publicação. [Evidência atual](../validation/2026-10-27-compact-diagnostics.md) registra testes, smoke, medição e conferência visual concluída no escopo documentado. As alternativas seguintes permanecem propostas. SDD é usado aqui como desenvolvimento orientado por especificação: problema, requisitos, contrato, aceitação, testes e somente depois implementação.

## Norte

Tornar testes de API fáceis, visuais e eficientes para pessoas e agentes. Minimizar contexto e ações necessários para uma tarefa correta, sem reduzir supervisão, permissões, redaction ou certeza sobre efeitos remotos.

Base atual e evidências: [fichário de continuidade](../../continuity.md). O executor individual e as proteções existem; não há transporte externo novo. O Runner já oferece execução sequencial, datasets, progresso, histórico e repetição de falhas.

## Alternativas

### A. Diagnóstico compacto e leitura progressiva — recomendada

**Problema:** o agente ainda precisa combinar sinais de preparação, bloqueios, resultados e efeitos locais. O texto visível de `execution.status` é útil, mas não é um contrato estruturado de decisão. A mensagem genérica `invalid_request` também pode exigir investigação adicional pela pessoa.

**Hipótese:** um diagnóstico somente leitura, produzido pelos mesmos fatos da UI, orienta o próximo passo com menos ambiguidade e sem releitura completa da bancada.

**Primeiro incremento proposto:** request individual; estado de preparação/execução, impedimentos tipados e próximo controle relevante. UI explica a pendência e leva ao campo existente. Resultado mostra primeiro HTTP/entrega, contagens de testes e efeitos locais; detalhes continuam progressivos, sem abrir payload para o agente.

Reutilizar o controlador e o bridge/DOM existentes. Não expor a instância privada, não inventar um segundo motor, não quebrar o contrato DOM v2 ou transformar `ready` em autorização.

**Benefício esperado, ainda não comprovado:** menos interpretação e navegação. A projeção pode até ser maior que o texto atual; ela só é útil se melhorar a tarefa ou a clareza sem aumentar desnecessariamente o contexto.

**Custo/risco:** definir uma allowlist realmente segura e manter UI/contrato consistentes; diagnóstico não pode ecoar erros ou valores remotos.

### B. Dependências visuais em cenários do Runner

**Problema a confirmar:** esclarecer que um passo depende de dados capturados em outro e o que a repetição de um passo exige.

Não propor outro Runner, outro histórico ou simplesmente um botão de repetir falhas: já existem. O diferencial precisaria ser a explicação de dependências, pré-requisitos e efeitos, com revisão de reexecução segura. Começar por uma sequência linear existente; sem editor de grafos, loops ou linguagem nova.

**Benefício potencial:** pessoas e agentes entendem a sequência sem reconstruir relações a cada erro.

**Custo/risco:** inferência incompleta de templates e capturas, efeitos de escrita e estado remoto desconhecido. Não repetir dependências ou escritas automaticamente para fazer um cenário passar.

### C. Adaptador externo para execução estruturada

**Problema:** o contrato interno ainda não pode ser chamado como ferramenta de um agente externo.

**Benefício potencial:** reduzir cliques e viagens de contexto na execução de requests salvas.

**Custo/risco:** fronteira de confiança, identidade, sessão, escopo, autorização humana, replay, encerramento da aba, exposição local/pública e isolamento. Exige um SDD próprio e decisão explícita do transporte. Não presumir que MCP sozinho fornece segurança ou que a autorização da UI pode virar `confirmed: true`.

Não é o próximo incremento recomendado antes de medir o fluxo atual e estabilizar o diagnóstico de leitura. Não adicionar servidor, porta, token ou endpoint neste documento.

## Recorte recomendado para detalhar primeiro

**A: diagnóstico seguro de uma request individual.** Primeiro tornar o estado e o próximo passo inequívocos; medir contra o melhor fluxo já existente; só depois decidir se novas ferramentas de execução compensam seu custo e risco.

A escolha de A e o contrato do [SDD detalhado](2026-10-27-compact-diagnostics-design.md) foram confirmados. O plano está preparado; B e C permanecem alternativas futuras, não entregas autorizadas desta rodada.

## Requisitos candidatos de A

1. A mesma execução produz os fatos exibidos na UI e no diagnóstico; sem classificadores paralelos divergentes.
2. Leitura não executa HTTP, histórico, captura, obtenção de token ou mudança no formulário.
3. Estado diferencia bloqueado, pronto para revisão, aprovado, em andamento e resultado final, preservando entrega desconhecida e validação parcial.
4. Impedimentos usam códigos fixos e regiões/controles estáveis; sem payloads, destinos completos, credenciais, nomes/valores de variáveis ou texto bruto da API na projeção padrão.
5. `ready`, ausência de bloqueios e sugestões de próxima ação não autorizam execução nem fabricam aprovação.
6. O agente pede apenas o contexto necessário. A pessoa pode ver orientação legível e detalhes existentes com teclado, foco e estados de loading/erro preservados.
7. Limites de tamanho, campos, tipos e retenção serão fechados no SDD; usar números derivados dos casos de teste, não tetos arbitrários apresentados como já aprovados.
8. Preservar contratos externos/persistidos atuais e políticas de rede, Auth, cofre e isolamento. Não há migração de dados ou ampliação de leitura sensível neste recorte.

## Aceitação candidata

- **Dado** que falta uma variável, **quando** consultar o diagnóstico, **então** receber impedimento fixo e região útil, sem o valor/nome sensível e sem chamar a API.
- **Dada** uma escrita sem aprovação, **quando** consultar a próxima ação, **então** receber orientação de revisão, nunca uma autorização de execução.
- **Dado** timeout após início do transporte, **quando** consultar o resultado, **então** manter entrega desconhecida e proibir recomendação automática de replay.
- **Dada** resposta recebida com falha de captura/persistência, **quando** consultar o resultado, **então** preservar HTTP/entrega e separar o efeito local.
- **Dada** validação parcial, **quando** abrir o resumo, **então** identificá-la sem afirmar aprovação completa.
- **Dados** sentinelas em URL, query, Auth, body, variáveis e mensagens, **quando** serializar qualquer diagnóstico, **então** nenhum deles aparecer na projeção.
- **Dada** navegação de abas/cache ou expiração, **quando** consultar de novo, **então** mostrar o estado vigente sem ressuscitar aprovação ou atribuir resultado à request errada.

## Medição que decide se o incremento vale a pena

Comparar a mesma tarefa, fixture, estado inicial e resultado esperado. Baselines: fluxo atual com seletores/regiões focados e leitura direta de `execution.status`; snapshot completo só quando a descoberta realmente o exigir. Não fabricar economia comparando sempre o pior baseline com o melhor novo caminho.

Casos mínimos: GET válido; variável ausente; POST aguardando aprovação; assertiva reprovada; validação parcial; timeout com entrega desconhecida. Dados descartáveis em loopback, sem credenciais reais.

Registrar sucesso correto da tarefa, chamadas de ferramenta, caracteres/bytes de contexto por etapa, duração e intervenções humanas. Tokens só com cliente/modelo/tokenizer identificados; sem isso, rotular caracteres/bytes e não inferir percentual de tokens. Separar descoberta inicial e uso recorrente.

Aceitação de eficiência: nenhum vazamento, envio sem autorização ou falsa certeza; resultado funcional equivalente e orientação mais clara. Ganho numérico exige evidência repetível. Sem ganho mensurável de tarefa ou clareza, reavaliar o incremento em vez de ampliar a API.

## O que o SDD final deverá fechar após a escolha

- Objetivo, não objetivos e casos de uso prioritários.
- Contrato exato de entrada/saída, enumerações, limites e política de compatibilidade.
- Fonte de verdade, componentes afetados e transições de estado.
- Fronteiras de confiança, redaction, autorização e tratamento de conteúdo não confiável.
- Estados visuais/acessíveis, erro, vazio, loading e recuperação.
- Exemplos de aceitação, regressões, fixtures e protocolo de medição.
- Entregas pequenas, critérios de parada e rollback, sem introduzir dependências especulativas.

Backlog oficial continua no GitHub Issues. Nesta atualização, a consulta não retornou issues abertas; este documento não cria issues, PR, commit ou autorização de implementação.

## Execução do trabalho de especificação

No Maestri, toda delegação exige terminal interativo visível do workspace, com personagem e papel no nome. Exemplos de responsáveis futuros, não execuções iniciadas: `Kakashi — Tech Lead` para contrato, `Sakura — Frontend` para clareza/acessibilidade e `Shikamaru — QA` para aceitação e medições. Modelos e disponibilidade precisam ser confirmados; sem recurso visível exposto, não substituir por subagente oculto ou API assíncrona.
