# Vortix — integração do editor e identidade

Estado: implementado e validado localmente após aprovação da nova direção visual. Sem commit, PR, push, merge ou deploy desta integração. Base `master/c8ace4f`; alterações anteriores e arquivos locais preservados.

## Resultado

- Endereço em superfície elevada, Dados da requisição em área aberta e envio em faixa própria. Seis abas na mesma tablist; desktop >=1100 usa seis colunas.
- Sidebar e resposta conservam seus controles e composição. Oito popovers com fechamento explícito contêm explicações estáticas. `request-note`, `request-send-status`, `response-persistence-note`, guards e confirmações ficam no fluxo.
- `app-storage-note` permanece atualizado pelo modo local/público, agora dentro de Sobre o workspace. Seletores `.sidebar-bottom strong` e `#history-panel .history-hint` preservados.
- Parâmetros têm linha inicial sem foco, labels/placeholders, borda visível, hover e foco. Remover todas as linhas não as recria até nova abertura/restauração da request.
- Marca e favicon novos: `wwwroot/vortix-symbol.svg` / `vortix-favicon.svg`, derivados do vórtice aprovado; asset antigo preservado. SEO e OG intactos.

## Evidência automatizada

- `node --check wwwroot/app.js`: passou.
- Dez arquivos de testes do CI: **417 testes, 416 aprovados, zero falhas, um skip**. Skip: symlink indisponível por EPERM no Windows. Log local ignorado: `artifacts/flow-ui-qa/node-tests.log`.
- `dotnet build ./VortixApiClient.csproj -c Release --no-restore`: passou, zero avisos/erros, após integração. Sem restore ou dependências novas.
- `git diff --check`: passou.
- Verificador local `artifacts/flow-ui-qa/verify-contract.cjs`: todos IDs anteriores preservados; 383 IDs únicos; conjuntos action/field/region iguais; scripts carregados iguais. Head idêntico ao baseline exceto href do favicon. Arquivos excluídos comparados após normalização de newline: bridge, diagnóstico, structured UI/execution/request, RunnerLogic, Program e LocalDataStore sem alteração.

## Revisão e correções

Senku implementou em terminal visível com posse exclusiva. Hange fez revisão somente leitura; alinhamento da tabela corrigido. Alegação de token `--surface-raised` ausente foi descartada: ele existe no root e como alias de temas.

Maestro encontrou e corrigiu via Senku duas regressões antes da entrega:

1. Não descartar entrada com valor sem nome: `buildRequestRoute` restaurado exatamente ao baseline. Teste cobre erro original, linha totalmente vazia ignorada e preservação do rascunho.
2. Regra de tema vencia hover/foco dos parâmetros: seletores corrigidos no bloco de temas, sem `!important`, e borda de repouso reforçada. Sem afetar inputs globais.

## Smoke no app real

Portal **Vortix — Integração visual**, `http://127.0.0.1:63224/`, processo em Shell visível Chopper. Banco separado em `artifacts/flow-ui-qa/workspace.sqlite`; nenhum workspace pessoal foi usado. Sem enviar request a API.

- 1440×900 / Dracula e 1280×900 / Papel, escala 1.2: sem overflow horizontal; seis abas na mesma linha.
- Edição de rota e parâmetro atualizou o contador. End/Home/ArrowRight/ArrowLeft alternaram abas; trocar de request e voltar restaurou Auth e a rota/parâmetro do rascunho.
- Popover abriu/fechou pelo botão e devolveu foco ao gatilho. Configurações fechou devolvendo foco a `manage-environments`.
- POST revelou write guard e manteve Enviar desabilitado sem checkbox/TESTE. Não foi enviado GET/POST nem executada preparação.
- Foco real confirmado via `:focus`/`:focus-visible`, borda accent e outline visível nos dois temas. Hover confirmado via `:hover` e mudança de borda. Em Papel: repouso `color(srgb 0.307647 0.351177 0.410392)` sobre branco, hover `color(srgb 0.200314 0.417569 0.548392)`, foco `rgb(7,89,133)`. Dracula: hover `color(srgb 0.560863 0.463216 0.739529)`, foco `rgb(189,147,249)`.
- Console capturado sem erros durante a conferência.

Capturas locais: `artifacts/flow-ui-qa/dracula-1440.png` e `paper-1280.png`. Podem conter buffer preto fora do viewport CSS; não comprovam requests reais. Protótipos anteriores preservados em artifacts, incluindo `vertical-v1.html` e `boxed-v2.html`.

## Limites e continuidade

Não houve nova suíte PowerShell, smoke mobile, envio real, smoke público ou validação de crawler/social. Escape nativo de popovers não foi confirmado pelo mecanismo de teclas do Portal; há fechamento explícito validado com retorno de foco. Isso não é auditoria completa de acessibilidade. O teste completo foi executado antes da última correção exclusivamente CSS; após ela, houve smoke de hover/foco, diff-check e build final, sem repetição desnecessária da suíte JS.

Terminais Maestri: Maestro `46bfb2c1-98c8-472f-9ea4-bf55d45bdd4f`; Senku `4b2da632-2bae-49c0-95da-e39d8a9eb65d`; Hange `dde905e3-ff6d-49b8-bcc8-d6a40db7a3da`; Chopper `8182fe73-8970-4bd8-b5aa-b42ab29c3c3a`. IDs de terminal não são IDs OpenCode. Sessões OpenCode atuais não foram confirmadas novamente; registros anteriores em `docs/operations/2026-10-28-delivery-sessions.md` não devem ser tratados como novo atestado de vínculo.
