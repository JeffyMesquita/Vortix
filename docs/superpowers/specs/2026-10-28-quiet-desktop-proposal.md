# Proposta visual desktop — foco no envio

Estado: usuário aprovou a nova direção ("ta gostei aprovado, pode seguir por ai"). A versão anterior em cards uniformes e V sólido permanece rejeitada; a revisão usa endereço protagonista, dados em área aberta, envio compacto e marca de três caminhos em vórtice. Base de produção `master/c8ace4f`. Adaptação ao produto autorizada dentro do escopo de reorganização já solicitado, conforme plano `../plans/2026-10-28-vortix-flow-ui.md`; nenhuma publicação automática nesta integração.

Revisão em caixas pronta no mesmo Portal/URL. A validação inicial da v1 abaixo é histórica. Nova versão tem editor/resposta lado a lado, seis abas e grupos Endereço/Dados da requisição/Envio. Captura local atual: `artifacts/quiet-desktop-proposal/04-editor-em-caixas.png`.

## Problema e autorização

Usuário trouxe feedback de primeiro uso: texto excessivo, poluição visual e dificuldade para saber onde olhar. A reorganização anterior agrupou recursos, mas manteve explicações e ações concorrentes demais. Usuário aprovou preparar uma proposta visual desktop mais enxuta antes de outra alteração em produção.

## Direção

- Usuário rejeitou a redução estrutural excessiva da primeira proposta. Pedido esclarecido com recorte da tela atual: diminuir texto solto nessa área, manter recursos e separar informações em caixas. A versão vertical com quatro abas não está aprovada para o produto.
- Preservar composição próxima ao app atual: editor à esquerda e resposta à direita. Três grupos funcionais com hierarquia diferente: Endereço em superfície elevada (URL base + método/rota), Dados da requisição em área aberta (seis abas existentes) e Envio em faixa compacta (status/guard/botão). Evitar três cards visualmente iguais.
- Manter acesso visível a Params, Headers, Body, Auth, Scripts e Testes. Ferramentas avançadas e Execução revisada conservam seus disclosures próprios. Ajuda de endereço/parâmetros fica dentro da caixa correspondente, recolhida, sem parágrafos espalhados.
- Fonte de interface legível, monoespaçada para endereço/JSON; preservar marca e família de cores, sem decoração adicional ou novas capacidades.
- Refinamento solicitado: preservar a composição e os controles atuais da sidebar e da resposta. Ferramentas da resposta permanecem visíveis, desabilitadas quando indisponíveis; explicações estáticas passam a popovers/popups. Status, erros e consentimentos continuam junto da ação. O centro conserva as caixas e deve acomodar as capacidades existentes na implementação futura.
- Escritas revelam bloqueio, checkbox, TESTE e confirmação junto do envio; simulação consome a confirmação. Esses requisitos não são reduzidos pelo objetivo visual.
- Parâmetros: uma linha vazia inicial com cabeçalhos e placeholders exemplificativos, borda/fundo visíveis em repouso, hover e foco distintos. Não depender de campo quase invisível ou de ajuda textual para revelar a edição.
- Ícone/favicon: direção aprovada de três caminhos formando um vórtice, mantendo verde/laranja; favicon com fundo próprio para leitura em abas claras/escuras. Novos assets `vortix-symbol.svg` e `vortix-favicon.svg`; marca original preservada.

## Artefato e limites

Protótipo: `artifacts/quiet-desktop-proposal/index.html`, com logo/fonte locais, servido apenas em loopback. Dados fictícios; Enviar apenas simula. Sem fetch, XHR, storage, banco, app.js ou integração de API. Artefatos ignorados por Git. Esse isolamento foi mantido durante a avaliação; após aprovação, a adaptação ao produto segue o plano vinculado no estado inicial. Metadados SEO/OG, diagnóstico e backend ficam fora do diff; apenas favicon muda no head. Sem commit/PR/merge/deploy nesta integração.

A barra com URL completa é proposta de apresentação, não decisão de alterar contratos persistidos de URL base/rota ou o bridge. A implementação futura precisa mapear a apresentação aos contratos existentes e revisar fontes, preferências de escala/tema, estados e guardas; nada disso é validado por este protótipo.

Essa barra única pertencia à primeira versão; a revisão solicitada volta a representar URL base e rota separadamente. A primeira versão é preservada como `artifacts/quiet-desktop-proposal/vertical-v1.html`; não usar o registro de conferência da v1 abaixo como aprovação da nova revisão.

## Conferência prevista

Desktop 1440×900 e1280×900;900×800 apenas para conferir desktop estreito. Sem nova rodada mobile. Conferir vazio, simulação, POST bloqueado/confirmado, teclado/foco e ajuda. Captura não prova integração ou execução real.

Maestro define/revisa, Senku escreve somente o HTML do protótipo. Hange faz leitura independente. Tentativa de Terra high em Pessoal falhou no bootstrap401; não consumir Trabalho para contornar. Peer GLM em terminal visível como alternativa, sem presumir capacidade ou modelo efetivo até observar execução.

## Entrega e evidência atual

Portal **Vortix — Proposta limpa**, URL local `http://127.0.0.1:63123/`, servido pelo Shell visível Bulma — Runtime QA. Mantido ativo para avaliação. HTML com logo/fonte locais; capturas em `artifacts/quiet-desktop-proposal/01-inicio-desktop.png`, `02-resposta-desktop.png` e `03-papel-desktop.png`. Arquivos locais ignorados pelo Git; screenshots podem conter buffer além do viewport CSS. Não enviar esses dados fictícios como evidência de HTTP real.

Senku entregou e encerrou escrita. Hange informou runtime `opencode-go/glm-5.3-flash`; revisão de estrutura/copy, sem renderização, resultou em remoção de disclaimers repetidos, Testes da resposta apenas quando configurados e indicação da seção avançada ativa. A revisão visual/DOM foi feita pelo Maestro.

Primeiro smoke encontrou CSS display vencendo hidden (guard e status prematuros); corrigido antes da entrega com regra global hidden. Estado final conferido no browser: GET inicial tem guard/status ocultos com display none; simulação revela JSON/HTTP200 e ferramentas; POST exige checkbox e TESTE, abre confirmação e consome aprovação ao simular. Recursos de rede observados antes/depois do envio: apenas SVG/fonte locais, sem chamada de API.

Desktop real 1440×900 e1280×900 sem overflow horizontal. Papel e Dracula inspecionados por imagem. End moveu seleção/foco à aba Auth; menu Avançado indicou Scripts e focou o título do painel; fechar Configurações devolveu foco ao gatilho. Validação é proporcional ao protótipo, não auditoria completa de acessibilidade ou integração com a aplicação. Não executar a suíte de produção como se provasse o desenho; produção, backend e workflow não têm diff nesta etapa.

O protótipo não representa toda a capacidade de Auth, Runner, Body ou diagnóstico. São localizações e estados ilustrativos. Próximo passo: usuário avaliar a direção visual; somente depois planejar adaptação aos contratos e recursos reais. Sem commit, PR, merge, deploy ou retomada de mobile.

## Conferência da revisão em caixas

Usuário esclareceu que queria reduzir texto da área atual e separar grupos, não retirar recursos. A revisão foi conferida em 1440×900 e1280×900. Em1280, scrollWidth=1280; Método e Rota com34px, sem esticar select. Estado GET inicial: seis abas, uma linha de parâmetros com Ex.: page/Ex.: 1, guard e status de sucesso com display none. Simulação GET revelou resposta; POST voltou a bloquear envio e mostrou guard. Sem chamadas de API; recursos observados só logo e fonte em loopback.

Affordance dos campos verificada no browser com janela ativa: repouso escuro borda rgb(97,112,137), hover rgb(132,148,173) e fundo alterado; foco accent rgb(121,224,189), outline2px. Área clara usa borda #7c8a9b, contraste calculado3,52:1 com branco. A nova revisão preserva essas regras. Nenhuma mudança em produção, backend ou workflow; diff-check passou. Servidor local63123 permanece ativo para avaliação.
