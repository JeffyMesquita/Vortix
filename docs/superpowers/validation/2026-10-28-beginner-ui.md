# UI para iniciantes — entrega e validação local

Data: 28/10/2026. Checkout final: `D:\Projetos-Pessoais\Vortix`, `master/eafccf9`, alterações sem stage/commit. [Desenho aprovado](../specs/2026-10-28-beginner-ui-design.md) e [plano](../plans/2026-10-28-beginner-ui.md).

## Resultado

URL base precede método/rota; editor precede a área de envio com guard/status/botão juntos. Ferramentas avançadas e ferramentas da coleção usam disclosures nativos; execução revisada mantém details próprio. Conteúdo da resposta vem antes dos cabeçalhos recolhidos. Configurações tem rótulo visível e cinco grupos; ajuda/bridge e tela cheia ficam em Ajuda e exibição. Scripts/Testes continuam na mesma tablist, com identificação de automação. Indicador avançado não publica valores.

Salvar oferece criação explícita e cancelável se não houver coleção. Rota inválida interrompe antes de oferecer criação. O helper real de criação conserva a seleção enquanto `dbWrite` está pendente, publica o destino após sucesso e restaura seleção em erro. Rascunho não é alterado por cancelamento/falha. Copy de proteção distingue SQLite local protegido e armazenamento do navegador público sem criptografia automática.

Produção alterada nesta rodada: `wwwroot/index.html`, `wwwroot/style.css`, `wwwroot/app.js`. Testes: novo `BeginnerUi.test.cjs`. README e guia do Portal atualizados. Nenhuma mudança nesta rodada em `structured-ui.js`, `agent-bridge.js`, `agent-diagnostics.js`, Runner, servidor, persistência ou dependências. Os três primeiros e `AIFriendlyUi.test.cjs` conferiram por SHA-256 com a baseline desta rodada. Mudanças já existentes nesses arquivos em relação a HEAD pertencem ao diagnóstico compacto anterior e foram preservadas.

## Coordenação e revisão

Maestro: Lelouch — Maestro. Implementador: Senku — UI iniciantes, terminal visível DeepSeek V4.1 Flash / OpenCode Go, posse exclusiva dos arquivos acordados. Revisão independente: Hange — Revisão UI, inicialmente Luna; após encerrar por quota, o mesmo terminal foi substituído por peer DeepSeek. A execução Go apareceu na tela; isso não é atestado independente do servidor sobre o modelo.

Revisor encontrou zero regressões bloqueantes. Corrigidos os achados de validação de rota antes da criação e prova da seleção durante write pendente. O bridge recolhido no grupo de ajuda é decisão deliberada do desenho, sem mudança de lógica. Corrigido também o destino obsoleto na falha de criação encontrado no preflight. Não foi feita segunda revisão independente após as duas últimas correções pequenas; Maestro inspecionou o diff e executou a suíte final.

Baseline preservada: `D:\Projetos-Pessoais\Vortix-checkpoints\2026-10-28-beginner-ui-baseline-092234`, sete arquivos com manifesto. O worktree TEMP antigo não foi fonte. O artefato local `2026-10-28-beginner-ui-review.diff`, preservado fora da seleção versionável, compara produção à baseline desta rodada, não a HEAD.

## Verificações automatizadas atuais

```powershell
rtk proxy node --test --test-reporter=tap ./RunnerLogic.test.cjs ./VortixRunner.test.cjs ./AIFriendlyUi.test.cjs ./AIAgentBridge.test.cjs ./StructuredExecution.test.cjs ./StructuredRequest.test.cjs ./StructuredUi.test.cjs ./StructuredIntegration.test.cjs ./AgentDiagnostics.test.cjs ./BeginnerUi.test.cjs
rtk proxy node --check ./wwwroot/app.js
rtk proxy git diff --check
```

Execução final pelo Maestro: **413 testes, 412 aprovados, zero falhas, um ignorado**, saída 0, aproximadamente 5,32 s. Skip existente de symlink `EPERM` no Windows. Sintaxe e diff-check passaram. Build Release `--no-restore` passou no início desta rodada, zero avisos/erros; não houve alteração C# posterior. As cinco suítes PowerShell não foram reexecutadas nesta rodada.

Senku observou RED/GREEN no teste do helper real de criação/rollback e no indicador avançado; depois acrescentou Promise controlada para testar seleção enquanto a gravação permanece pendente e caso de rota inválida sem persistência. Testes estruturais da UI complementam a execução em browser, não a substituem.

## Smoke pelo Portal Maestri

Instância isolada em `http://127.0.0.1:59626`, SQLite temporário em `%TEMP%/vortix-beginner-qa-e756fd9860d949b2a8ff499c92cca13c/qa.sqlite`. Fixture estática Python em loopback `57122`, com JSON fictício. Serviços executaram nos terminais Shell visíveis Bulma — Runtime QA e Chopper — Fixture QA.

- Envio manual GET pelo Portal, após desmarcar persistência de Auth: HTTP **200 OK**, JSON fictício exibido, cabeçalhos recolhidos; UI informou persistência no histórico. Log da fixture registrou exatamente **um GET**, sem POST ou outra chamada.
- POST com frase vazia e checkbox desmarcado: guard visível, Enviar desabilitado e orientação para `TESTE`. Nenhuma escrita enviada.
- Salvar request fictícia em coleção existente: diálogo fechou e foco retornou a Salvar. Preparação revisada ficou `ready_for_review`, aprovação disponível e execução desabilitada; nenhuma chamada adicional.
- Editar rota invalidou a preparação e voltou a bloquear aprovação e execução, com mensagem correspondente.
- End levou foco e seleção a Testes; Home e setas mantiveram navegação circular na mesma tablist. Fechar Configurações pelo botão devolveu foco ao gatilho. Escape pelo comando sintético do Portal não fechou o diálogo nessa conferência; não foi usado como evidência de funcionamento do Escape nativo.
- Ramo sem coleções foi validado pelos testes com helpers reais, não por smoke visual: excluir a última coleção pela UI recria Minha coleção, comportamento preexistente. Não houve manipulação de storage ou estado privado para forçar essa condição.
- Nenhum erro de console foi retornado na leitura registrada. Isso não equivale a cobertura de todos os caminhos.

## Revisão visual desktop

Temas Dracula/Papel e escala 120%, viewports CSS 1280×900 e 900×800. Capturas e DOM foram usados para conferir hierarquia, rótulo de Configurações, grupos e abas. Após corrigir o corte das abas, medidas `clientWidth/scrollWidth`: **404/404 em 1280** e **488/488 em 900**. Header em 900: **492/492**. Dropdown de ajuda conferido dentro do viewport desktop. Rolagem vertical do editor é deliberada quando o conteúdo ultrapassa a altura.

- [Dracula desktop 900](../../images/beginner-ui-dracula-900.png)
- [Dracula desktop 1280](../../images/beginner-ui-dracula-1280.png)
- [Papel desktop 900](../../images/beginner-ui-paper-900.png)
- [Papel desktop 1280](../../images/beginner-ui-paper-1280.png)

Captura do Portal foi intermitente com erro de página sem renderização. Ativar janela e Tela cheia permitiu capturas; isso não comprova causa definitiva. Algumas imagens precedem o último ajuste do placeholder vazio e o copy de proteção; não apresentá-las como prova desses dois ajustes. O buffer de captura pode conter área escura além do viewport CSS conferido. Não houve auditoria completa de acessibilidade ou teste com leitores de tela.

## Mudança de escopo e encerramento

O usuário dispensou expressamente otimização de layout mobile durante a validação. Interrompidos novos ajustes e conferências mobile. Correções pequenas já feitas de rolagem e quebra de abas foram preservadas; capturas mobile intermediárias permanecem como registro, sem compromisso de acabamento ou aceite móvel.

Os serviços isolados foram encerrados por Ctrl+C nos próprios terminais; depois não havia listeners em 59626 ou 57122. Portal e terminais foram preservados. Nenhum banco pessoal, API real, segredo ou configuração de conta foi usado no smoke. Nenhum stage/branch/commit/PR, push/merge/deploy ou instalação. Build não comprova UI; fixture não comprova integração externa.

## Preparação de publicação autorizada

Após a entrega local, o usuário autorizou commit, PR e merge. [Índice de sessões](../../operations/2026-10-28-delivery-sessions.md) distingue IDs confirmados de candidatos. Workflow atualizado para executar também `BeginnerUi.test.cjs`, junto do diagnóstico e das suítes existentes. Build Release `--no-restore` e 413 testes Node passaram novamente na branch de publicação (412 aprovados, zero falhas, um skip). O CI do PR executará também as cinco suítes PowerShell; resultado remoto deve ser consultado no PR/run correspondente.
