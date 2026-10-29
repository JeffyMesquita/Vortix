# Dependências do Runner — validação local em 29/10/2026

Relatório local da entrega do [PR #39](https://github.com/JeffyMesquita/Vortix/pull/39), branch `feat/runner-dependencies`, sobre `0816037` (PR #38). SDD inicial em `3bcbe17`, implementação em `53fc96844e5aa23eb8bb6b215193f6233b4bf272`. Usuário aprovou SDD, implementação e publicação. Os números abaixo descrevem os testes locais anteriores ao PR; consultar o PR para SHA final, checks remotos e merge.

## Resultado

O plano visual explica origens, capturas condicionais, sombreamento e influência entre datasets. Detalhes usam Caso/Passo/Conjunto para distinguir posições de execução e requests. A revisão de falhas informa produtores omitidos e permite cancelar antes dos guards. O analisador não executa ações, não resolve valores nem persiste o mapa; CLI, servidor, histórico e ponte permanecem com seus contratos existentes.

Senku implementou a lógica/UI/testes com posse exclusiva e reportou RED inicial 16/16 por ausência dos helpers/DOM; GREEN inicial e suíte completa foram conferidos depois. A alteração de `StructuredIntegration.test.cjs` somente injeta o módulo RunnerLogic no harness da captura, preservando assertions.

## Revisão e correções

Hange revisou somente leitura: omissão de produtores em cofre bloqueado/indisponível e separação de candidatos da rodada anterior foram corrigidas por Senku, com regressões. A conferência final desses ajustes não encontrou bloqueador.

Na integração, Maestro reproduziu e corrigiu mais quatro casos com RED/GREEN:

1. Mudança de contexto durante confirmação assíncrona continuava a reexecução. Agora a identidade da análise anterior é conferida após cada modal, antes de prosseguir.
2. Atualização de fontes durante envio recalculava a previsão. Agora mantém a análise anterior marcada como tal até terminar.
3. Produtores agregados apenas por destino geravam candidata de nome diferente. Agora são Map por nome em cada destino.
4. Um candidato mais recente do mesmo dataset apagava o aviso de alternativa mais antiga de outro conjunto. O aviso agregado considera todos os datasets, preservando a origem precisa do candidato mais recente.

Hange conferiu esses quatro ajustes somente por leitura de código/testes, sem problema restante. A execução dos testes e smoke abaixo foi feita pelo Maestro. As revisões não são tratadas como execução automatizada ou auditoria completa.

## Evidência automatizada atual

- `node --test` dos dez arquivos anteriores do CI mais `RunnerDependencies.test.cjs`: **447 testes, 446 aprovados, zero falhas, um skip**. Skip de symlink por EPERM no Windows. Log local: `artifacts/runner-deps-qa/final-tests.log`.
- `RunnerDependencies.test.cjs`: **26/26**; cobertura de matching por nome/destino, seed, cofre, pré-request ordenada, Auth herdada, GraphQL/multipart, limites, sentinelas, ausência de mutação, datasets inválidos, reexecução/cancelamento, estado obsoleto e renderização mínima.
- `node --check wwwroot/app.js` e `node --check wwwroot/runner-logic.js`: aprovados.
- Build Release `--no-restore -o ./artifacts/runner-deps-qa/build`: aprovado, zero avisos/erros. Nenhuma dependência foi instalada/restaurada. Log local: `artifacts/runner-deps-qa/final-build.log`.
- `git diff --check` e links documentais conferidos. CI atualizada para incluir o teste novo; os runs remotos da publicação são acompanhados no PR, separadamente desta evidência local.

## Smoke pelo Portal, com mock de loopback

App em `127.0.0.1:63225`, terminal visível **Shikamaru — QA Runner**, SQLite separado `artifacts/runner-deps-qa/workspace.sqlite`. Mock Python padrão em `127.0.0.1:63226`, terminal visível **Bulma — Runtime QA**. Instância QA anterior na63224 preservada. Nenhum banco pessoal ou API real foi usado.

Coleção fictícia importada pela interface: GET `/produce` captura `orderId`; GET `/consume/{{orderId}}` devolve503 na primeira chamada e200 na segunda. Persistência de Auth desativada e conferida no snapshot antes dos envios; fixtures não contêm credenciais.

| Cenário | Evidência observada |
|---|---|
| Plano inicial | Relação do consumidor com o caso1, marcada condicional; abrir plano não chamou o mock. |
| Datasets | Quatro casos para dois conjuntos; prioridade do dataset no primeiro e aviso de alternativa de conjunto anterior no último. |
| JSON inválido | `Revise os conjuntos de dados`; iniciar não enviou chamadas. |
| Primeira execução | Produtor200, consumidor503; contadores `/produce:1`, `/consume/mock-123:1`. |
| Revisão e cancelamento | Modal indica produtor da rodada anterior fora do subconjunto; cancelar manteve contadores1/1. |
| Reexecução aceita | Somente consumidor200; contadores finais `/produce:1`, `/consume/mock-123:2`. Nenhum produtor foi repetido. |
| Previsão durante envio | Resumo identificado como `Previsão anterior ao envio`. |
| POST sem confirmação | Guard visível, checkbox desmarcado, TESTE vazio e Enviar desabilitado; nenhum POST enviado. |
| Viewport1280 | Documento scrollWidth1280; diálogo scrollWidth/clientWidth758/758. Sem overflow horizontal no documento ou diálogo. |

Detalhes nativos abriram por clique e receberam foco DOM no summary. Chamadas de Enter/Space pelo Portal não produziram evento keydown observável nem alternaram o details nesta sessão; não declarar teclado nativo confirmado. Não foi adicionado handler para contornar comportamento da ferramenta. Não é auditoria completa de acessibilidade.

Captura1440 com dados fictícios: [plano com datasets](../../images/runner-dependencies-plan.png). Outras capturas e contadores ficam em `artifacts/runner-deps-qa/`. A captura do modal de revisão falhou quando a janela deixou de renderizar; seu texto/controles e efeitos foram conferidos por DOM e contadores, não por imagem. Capturas não comprovam chamadas de API real.

## Limites e preservação

Sem smoke mobile ou público, benchmark de tokens, alteração de transportes, instalação, auth/routing ou novo deploy. Não houve nova suíte PowerShell nesta entrega local; houve suíte JS com consumidores compartilhados e build. Interfaces de CLI/histórico/bridge foram preservadas por diff e regressões; o mapa não entra em backup/exportação.

Nova logo do README preservada e documentada. Os sete untracked anteriores e o snapshot de recuperação permanecem no checkout, fora da seleção da feature. Nenhuma alteração foi copiada do worktree TEMP. Tentativa de Terra anterior falhou no bootstrap401 e não participou da implementação.
