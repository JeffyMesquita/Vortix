# Vortix — identidade e editor Implementation Plan

> Execução no checkout principal, com terminais Maestri visíveis e um escritor por arquivo. Não criar worktree ou publicar nesta integração. Direção aprovada pelo usuário após rejeição da versão em cards uniformes.

**Goal:** Adaptar o desenho aprovado ao editor real, reduzindo explicações permanentes sem retirar recursos, contratos ou proteções.

**Architecture:** Preservar HTML/JS clássicos, estado e handlers existentes. Acrescentar grupos sem renomear IDs ou mudar persistência. Popovers nativos para ajuda estática; mensagens dinâmicas e consentimentos permanecem no fluxo. CSS com tokens existentes e respeito às preferências de fonte/tema/escala.

**Tech Stack:** HTML, CSS, JavaScript, SVG; ASP.NET Core existente, sem dependências novas.

## Critérios e limites

- Endereço com superfície elevada e hierarquia própria; dados em área aberta; envio em faixa distinta. Seis abas na mesma tablist.
- Sidebar e resposta conservam composição e controles. Apenas ajuda estática vira popover.
- Preservar todos IDs anteriores, contrato v2, data-vortix-action/field/region, aria, structured-card próprio, request-send-status e guards.
- Inputs de parâmetros legíveis em repouso, hover e foco, com placeholders; linha vazia inicial usa helper real sem foco ou serialização de parâmetro vazio.
- Remover última linha não deve recriá-la automaticamente. Draft, seleção de request/aba e consentimentos mantêm comportamento.
- Sem alteração em servidor, Runner, storage, bridge, diagnóstico, metadados SEO/OG ou formatos persistidos. Nenhuma API real.
- Nova marca/vórtice e favicon aprovados como direção; assets anteriores preservados.

## Posse

- Senku: `wwwroot/index.html`, `wwwroot/style.css`, helper de parâmetros em `wwwroot/app.js`, `BeginnerUi.test.cjs`, atualização pontual do favicon em `AIFriendlyUi.test.cjs`.
- Maestro: novos SVGs em wwwroot, plano/spec/continuidade, revisão e smoke.
- Revisão independente somente leitura em terminal visível; sem novo escritor concorrente.

## Passos

- [x] Criar `wwwroot/vortix-symbol.svg` e `wwwroot/vortix-favicon.svg` a partir do candidato v3. Preservar marca anterior.
- [x] Senku adaptar markup/estilo real usando `artifacts/quiet-desktop-proposal/index.html` como referência visual, sem copiar JS simulado.
- [x] Senku mover ajuda explicativa estática para popovers com gatilhos rotulados; não recolher riscos, status ou mensagens que exigem ação. Popovers precisam de fechamento explícito e foco visível.
- [x] Senku melhorar campos/linha inicial usando createQueryParamRow/renderQueryParams; manter buildRequestRoute e count ignorando nomes vazios, sem roubar foco.
- [x] Testes proporcionais: regressão útil da linha vazia/serialização/sem autofocus; manter contratos e teste de favicon novo existente. Não criar suíte espelho de CSS.
- [x] Rodar node --check e testes focados; após integração completa rodar os dez arquivos de testes uma vez e git diff --check.
- [x] Maestro comparar IDs/atributos e hashes de arquivos excluídos; revisão somente leitura do diff e riscos de foco/guards.
- [x] Build --no-restore se cache disponível; não restaurar/adicionar dependências.
- [x] Smoke isolado desktop em loopback: 1440/1280, escala 120%, Dracula/Papel, abas/teclado, parâmetros, ajuda, POST bloqueado. Não enviar requests reais nem mexer no workspace pessoal.
- [x] Atualizar continuidade com evidência e limites. Sem commit/PR/push/merge/deploy nesta etapa de integração.
