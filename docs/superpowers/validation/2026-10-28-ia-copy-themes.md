# IA, clipboard, temas e visualização de Bodies

Estado: alterações locais implementadas e verificadas; sem commit, PR, push ou deploy. Preserva o diff anterior da reorganização visual. Não foram enviados requests a APIs.

## IA friendly

Contrato v2 permanece `readOnly: true`, sem executor mutante, sem leitura de clipboard e sem expor valores da requisição/resposta. Todos IDs/atributos anteriores preservados. Descoberta ampliada com `request.command.copy`, `auth.pkce.redirect.copy`, `request.capture-example.copy`, `response.path.copy`, `request.body.format` e `request.body.minify`.

Foi encontrada uma divergência introduzida pela linha inicial vazia de Params: o estado seguro contava linhas, enquanto o badge contava nomes configurados. `snapshot().request.paramsCount` agora conta nomes preenchidos. RED observado (3 em vez de 1); GREEN 16/16 em AIAgentBridge. Regressão cobre linha vazia, valor órfão, nome configurado e omissão de sentinelas de nomes/valores. A validação original da request continua rejeitando valor sem nome.

Os IDs de copiar caminhos são sequenciais e opacos (`response-path-copy-N`); dados do caminho não entram em IDs, labels ou catálogo da ponte. Ações continuam usando os handlers da interface. Na árvore, hover/foco revela o botão antes do clique.

## Copiar

Sete botões estáticos e os botões de caminho JSON usam só ícone SVG, labels visualmente ocultos, aria-label/title contextuais, foco e área de 30×30px CSS. `copy-curl-label` continua atualizável sem apagar o SVG ao alternar cURL/HTTPie.

`copyToClipboard` aguarda `navigator.clipboard.writeText`, mostra toast `info` com mensagem fixa e propaga rejeição. Não há payload no toast. Callers mantêm seus catches; contexto seguro mantém fallback readonly/foco/seleção manual quando a cópia é bloqueada. Confirmação para exportar comandos com dados sensíveis permanece a montante, sem alteração.

No Portal, copiar Body da resposta simulada e copiar caminho JSON após hover produziram **Copiado para a área de transferência** em toast info. Não foi lido o clipboard pessoal. Rejeição/fallback foram exercitados pelos testes automatizados.

## Temas

Agora são 11: nove anteriores mais Aurora (escuro, verde-água) e Areia (claro, quente). Select, whitelist, persistência, tokens JSON, aliases e regras compartilhadas estão integrados. Fonte/escala preservadas. Conferidos na UI; Aurora restaurado após reload.

Bordas novas ajustadas para contraste mínimo de 3:1. O smoke detectou texto escuro sobre o fundo real do primário Aurora, diferente do fundo usado no primeiro cálculo; corrigido `--on-accent` para branco. DOM confirmou branco sobre `#246f66`; contraste calculado 5,93:1, hover 6,87:1. Não declarar aprovação de contraste só comparando texto com `--accent` quando o fundo efetivo usa `--accent-strong`.

## Entrada/saída

Entrada JSON: identar em 2 espaços, compactar, Tab/Shift-Tab e autoindentação de Enter já existiam. Smoke confirmou a formatação e os cinco tipos de token (pontuação, chave, string, número e literal). Trocar para Texto removeu o overlay e ocultou as ferramentas JSON; voltar a JSON restaurou-as.

Saída JSON: Pretty indentado, Raw original e Árvore já existiam. Validados pelo recurso **Simular local** com exemplos importados apenas no banco QA. Keys/strings/números/literais receberam cores das duas novas paletas. Não há tokenizer específico de XML/GraphQL na entrada; formatos não JSON são texto simples. Cabeçalhos usam o tokenizer JSON existente, com possível coloração cosmética de dígitos; não foi ampliado nesta tarefa.

## Sobreposição da coluna de resposta

O cenário com exemplo salvo aberto revelou e o usuário confirmou sobreposição de Body, cabeçalhos e exemplos. Filhos flex podiam encolher abaixo do conteúdo; a seção do Body tinha min-height zero e filhos com mínimo maior, transbordando nas seguintes.

Correção CSS: filhos diretos da coluna preservam altura; a seção do Body cresce sem encolher; o output usa base definida de 220px. A coluna rola entre seções e o conteúdo longo rola internamente. Nenhum controle foi ocultado.

Smoke final em 1280/1440, escala 1.2, com cabeçalhos e exemplos abertos: intervalos dos blocos não se cruzam. Corpo normal e corpo de 200 itens (1004 linhas Pretty) conferidos. Pretty com clientHeight 218 e scrollHeight 18701; rolagem interna chegou a 500 enquanto a coluna ficou em zero. Árvore também manteve rolagem interna (218/7275). Capturas: `artifacts/flow-ui-qa/response-overlap-before.png`, `response-fixed-top.png`, `response-fixed-examples.png`.

## Verificação e limites

- Dez arquivos de testes: **420 testes, 419 aprovados, zero falhas, um skip EPERM**. Log: `artifacts/flow-ui-qa/ia-copy-themes-tests.log`.
- Build Release --no-restore: zero avisos/erros. Checks de sintaxe e diff-check passaram.
- Verificação DOM: 384 IDs únicos, nenhum anterior removido, ações anteriores preservadas com adições intencionais; fields/regions iguais. Head só altera favicon em relação ao master. Diagnóstico, execução estruturada, RunnerLogic e servidor sem alterações.
- Revisão independente de Hange, somente leitura: nenhum ajuste necessário em clipboard/segurança/bridge. Senku implementou UI/handlers/temas; Maestro corrigiu contagem da ponte e revisou/renderizou o resultado.

Suite/build ocorreram após os fixes de ícones e do teste antigo de clipboard; a última rodada posterior foi apenas CSS (sobreposição e contraste Aurora), seguida de smoke/diff-check, sem repetição da suíte JS. Não houve suíte PowerShell, smoke mobile, envio real, teste social/crawler ou publicação. O teste antigo de VortixRunner foi adaptado à delegação pelo helper, mantendo cobertura de await/clipboard e as assertions de exportação segura.

Portal **Vortix — Integração visual**, http://127.0.0.1:63224/, banco QA separado. Fixtures locais ignoradas por Git: `copy-body-fixture.json` e `long-response-fixture.json` dentro de artifacts/flow-ui-qa. IDs de terminais/sessões continuam registrados no relatório anterior e em docs/operations; não foram inferidos novos IDs OpenCode.
