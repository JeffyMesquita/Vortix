# Correção guiada no envio manual

Estado: direção, especificação e plano aprovados em 30/10/2026. Implementação integrada à entrega de uso geral em 04/11/2026. A política atual remove a frase de teste e a declaração de dados descartáveis do envio manual; veja as [evidências atuais](../validation/2026-11-04-global-api-client.md). A base inicial desta especificação foi `f0f6ad6`.

## Objetivo e decisão

Reduzir o esforço entre descobrir um impedimento de preparação e corrigir a request. Ampliar a faixa existente junto de Enviar, reutilizando `request-send-status`, com uma mensagem contextual e uma ação opcional **Ir ao campo**. Não acrescentar painel permanente.

Alternativas consideradas: atalhos para enviar/salvar e maior destaque ao estado salvo/rascunho. São entregas posteriores; a primeira fatia será correção guiada.

## Comportamento

- Manter a precedência de `updateGuard`: envio em andamento, rota vazia, correção local identificada e orientação normal. Durante envio, ocultar a ação de correção.
- Rota vazia: explicar o impedimento e oferecer foco em `route`, mesmo com Enviar desabilitado.
- Falha local ao preparar o envio: manter a mensagem junto ao envio até uma edição pertinente, troca de request/ambiente ou nova tentativa. Preservar o tratamento existente de erro e sua filtragem de segredos.
- A ação só aparece para destinos identificados explicitamente pela validação. Não classificar erros comparando textos traduzidos ou inferindo seletores a partir de mensagens.
- Rota com formato inválido: focar `route`.
- Parâmetro com valor e chave vazia: abrir a aba Params e focar a chave da primeira linha inválida. Nunca apagar o valor preenchido.
- Captura habilitada com nome inválido: revelar o disclosure da captura e focar `response-variable-name`. Caminho JSON vazio ou inválido: revelar e focar `response-json-path`.
- POST, PUT, PATCH e DELETE não exigem frase ou declaração de dados descartáveis. A correção guiada não concede aprovações da execução revisada ou do Runner.
- Demais erros de preparação, inclusive resolução de variáveis, Auth, cofre, arquivos e HTTP sem TLS: manter orientação geral sem ação quando não houver destino explícito seguro nesta fatia. Não conduzir o usuário automaticamente à habilitação de opções que reduzam proteção.
- Erros de rede, proxy ou resposta HTTP permanecem no fluxo atual de resultado. A faixa de correção não promete sucesso HTTP nem classifica uma resposta remota como erro de formulário.
- Editar um campo não deve disparar envio, ações pré-request, desbloqueio do cofre, gravação de histórico ou confirmação. Não executar novamente a preparação apenas para atualizar a faixa.

## Estrutura e limites

HTML: acrescentar o botão na faixa existente, com `type="button"`, nome acessível e associação à mensagem. Preservar IDs, atributos do contrato DOM e controles atuais.

JavaScript: estado efêmero de correção na camada da interface, com destino privado e conhecido. Acrescentar contexto de foco nos pontos de validação pertinentes, preservando `Error.message`, comportamento e consumidores existentes. Não propagar valores, elementos DOM ou novos destinos pelo bridge de agentes ou armazenamento. Ao clicar, conferir que o alvo ainda pertence ao formulário atual; revelar sua aba/disclosure antes de focar. Alvo removido ou contexto antigo deve limpar a ação sem exceção.

CSS: usar os tokens, botões e estilos de foco existentes. Garantir quebra de linha em desktop estreito, escala ampliada e viewport móvel, sem ocultar o envio ou as confirmações.

Escopo provável: `wwwroot/index.html`, `wwwroot/app.js`, ajustes mínimos em `wwwroot/style.css` e testes de comportamento pertinentes. Usar os harnesses existentes quando suficientes. Não alterar servidor, persistência, Runner, contratos do diagnóstico compacto ou dependências. A execução revisada mantém seu próprio estado; compartilhar somente um helper simples de navegação se isso reduzir duplicação comprovada.

## Critérios de aceite e verificação

1. Rota vazia oferece correção enquanto Enviar segue desabilitado; clique foca a rota sem enviar.
2. Rota inválida e parâmetro sem chave recebem o destino correto; Params abre e o valor do parâmetro permanece intacto.
3. Captura inválida revela o grupo e foca o campo correto; captura desabilitada não cria esses impedimentos.
4. POST usa o envio manual normal; navegar a um campo nunca envia a request nem concede aprovação em outros fluxos.
5. Troca de request/ambiente, edição pertinente e nova tentativa não reaproveitam destinos antigos. Linha removida não causa erro nem foco incorreto.
6. Preparação desconhecida mantém mensagem sem ação; erro remoto segue o resultado atual. Mensagens e metadados novos não expõem segredos.
7. Clique e teclado alcançam o botão e o campo, com foco visível. Atualização de status não rouba foco automaticamente.
8. Testes focados exercitam comportamento, invalidade do destino e ausência de envio/efeitos ao navegar. Rodar sintaxe JS, regressões UI/diagnóstico pertinentes e `git diff --check`.
9. Conferir o app isolado com dados fictícios em Dracula/Papel, desktop 1280 e 1440, escala ampliada e viewport 390. Verificar mensagem, foco real e ausência de overflow; sem API real ou workspace pessoal. Se o runtime visual estiver indisponível, registrar essa lacuna explicitamente.

## Validação e publicação

A aprovação inicial da direção não constituía evidência de implementação ou validação visual. Os checks e limites da entrega atual estão no registro de 04/11/2026. A atualização documental, criação de PR e merge foram autorizados separadamente pelo usuário nessa data; nenhum resultado de CI ou publicação é inferido da aprovação da especificação.
