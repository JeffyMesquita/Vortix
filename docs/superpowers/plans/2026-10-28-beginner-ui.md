# UI para iniciantes — plano de implementação

**Goal:** executar o [desenho aprovado](../specs/2026-10-28-beginner-ui-design.md) sem alterar contratos de execução, segurança ou persistência.

**Architecture:** HTML/CSS e scripts clássicos existentes. Divulgação progressiva com `details` e diálogos nativos; handlers locais de apresentação. Sem novo modo persistido, bundler, dependência ou extração global.

**Tech Stack:** HTML, CSS, JavaScript, testes Node e ASP.NET Core 10 para QA isolado.

## Regras e posse

Checkout principal `D:\Projetos-Pessoais\Vortix`, `master/eafccf9`, com trabalho local anterior preservado. Sem stage/branch/commit/PR, push/merge/deploy, dependências novas ou requests reais. A autorização do usuário substitui sugestões de commit/worktree das skills. Agentes somente em terminais Maestri visíveis; não iniciar subagentes.

Senku — UI iniciantes é o único escritor de `wwwroot/index.html`, `wwwroot/style.css`, `wwwroot/app.js`, `BeginnerUi.test.cjs` (novo) e, somente se um contrato de markup mudou, `AIFriendlyUi.test.cjs`. Preservar toda a cobertura de segurança. Nenhuma posse sobre `structured-ui.js`, bridge, diagnóstico, Runner, servidor ou storage. Maestro escreve documentação e revisa. Revisor independente é somente leitura.

## 1. Fixar regressões e reorganizar o fluxo

- [ ] Confirmar raiz/branch e ler a spec aprovada. Comparar alterações desta rodada à cópia anterior dos arquivos, não apenas a HEAD.
- [ ] Criar `BeginnerUi.test.cjs` reutilizando `node:test`, `node:assert/strict`, leitura HTML e VM dos harnesses existentes. Cobrir ordem URL base/editor/guard/envio, cabeçalhos recolhidos, configurações agrupadas e existência única dos IDs preservados.
- [ ] Para novo comportamento, escrever regressão antes da implementação e registrar a falha observada. Casos necessários: salvar sem coleção oferece criação explícita/cancelável; falha/cancelamento preserva rascunho; estado avançado ativo é anunciado sem expor valores; navegação de abas continua coerente.
- [ ] Executar `node --test ./BeginnerUi.test.cjs`; observar falhas esperadas pelos recursos ainda ausentes.
- [ ] Reordenar o markup existente: URL base e método/rota, editor, guard/status/envio. Mover os nós com IDs existentes; não duplicar controles. Preservar `aria-describedby="request-send-status"`.
- [ ] Manter `#structured-card` no details próprio, após o formulário, sem camada recolhida adicional. Agrupar referências/HTTP/cURL como ferramentas avançadas; indicar opções ativas. Preservar `.editor-column` e listeners de rascunho.
- [ ] Identificar Scripts/Testes como automação secundária sem quebrar tablist, teclado ou restauração da aba. Manter Auth/OAuth no fluxo atual.
- [ ] Priorizar body da resposta; usar `<details>` para cabeçalhos. Preservar todos os IDs, status, testes, exemplos e avisos de persistência/simulação.

## 2. Descoberta, salvamento e configurações

- [ ] Agrupar ferramentas da coleção em disclosure textual nativo; manter Nova requisição/busca visíveis. Explicar o vazio sem mascarar falha de storage.
- [ ] Reusar o handler de criação de coleção: oferecer criação explícita a partir de Salvar quando não há coleção, preservar rascunho/cancelamento e continuar a abertura do diálogo de salvamento somente após criação bem-sucedida. Não alterar registro persistido nem criar silenciosamente.
- [ ] Agrupar Configurações por Aparência, Ambientes, Histórico e privacidade, Cofre, Backup e proteção. Preservar controles/avisos e diferenças local/público. Retirar referências a funções internas do texto principal.
- [ ] Aplicar CSS com tokens existentes, foco visível, largura mínima controlada e empilhamento responsivo. Evitar overrides globais e crescimento mecânico de `!important`.
- [ ] Executar `node --check ./wwwroot/app.js`, `node --test ./BeginnerUi.test.cjs ./AIFriendlyUi.test.cjs ./StructuredUi.test.cjs ./AIAgentBridge.test.cjs` e `git diff --check`; corrigir falhas sem afrouxar guards.
- [ ] Reportar alterações, testes, decisões e limitações ao Maestro por ask back. Encerrar posse de escrita antes da revisão visual final.

## 3. Revisar e validar

- [ ] Revisão independente em terminal visível: diff desta rodada, segurança, foco, teclado, handlers e limites da spec. Sem edição concorrente; achados concretos com arquivo/linha/reprodução.
- [ ] Maestro compara os arquivos à baseline e verifica que bridge/diagnóstico/structured-ui permanecem preservados. Atribuir correções exclusivamente ao escritor responsável.
- [ ] Executar nove suítes anteriores mais `BeginnerUi.test.cjs`, sintaxe e `git diff --check`. Esperado: zero falhas; skip de symlink Windows deve ser registrado se persistir.
- [ ] Build Release sem restore automático. Usar runtime de QA com porta livre e SQLite temporário; não usar launcher ou banco pessoal. Operação pelo Portal Maestri, fixture loopback e dados fictícios.
- [ ] Conferir Dracula/Papel, 120%, 1280×900 e 900×800; teclado/foco, vazio, salvo, request avançada, HTTP sem TLS, POST bloqueado e resultado de fixture. Separar observações de screenshot, DOM e execução. Mobile retirado do aceite por instrução posterior do usuário.
- [ ] Atualizar README/guia quando navegação mudar; registrar evidências e limites em `docs/superpowers/validation/2026-10-28-beginner-ui.md` e continuidade. Relatar pendências reais sem publicar.

## Registro final

Implementação desktop, testes, revisão independente, correções e documentação concluídos. O checklist acima preserva a sequência original; o registro de execução e os limites reais estão na [validação final](../validation/2026-10-28-beginner-ui.md). Ramo sem coleções coberto por teste dos helpers reais; smoke UI preservou a recriação automática da coleção padrão, sem manipular storage. Não ampliar mobile após a dispensa do usuário. Nenhuma publicação autorizada ou realizada.
