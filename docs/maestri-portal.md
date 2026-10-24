# Operar o Vortix com o Maestri Portal

Este guia orienta agentes de IA que controlam o Vortix pela interface do Portal. Use os controles visíveis e acessíveis; não dependa de coordenadas fixas nem de chamadas internas do servidor.

O Maestri conecta o agente ao Portal pelo CLI `maestri`; o Portal pode inspecionar DOM, executar JavaScript e clicar/digitar. Não precisa de servidor MCP. Consulte a [documentação oficial de Portais](https://www.themaestri.app/pt-br/docs/portals).

## Contrato de navegação

Confira a versão do contrato DOM antes de usar seletores estáveis:

```js
document.querySelector('meta[name="vortix-agent-contract"]')?.content
// "2"
```

O Vortix disponibiliza duas consultas somente de leitura:

```js
window.vortixAgent.describe() // ações, campos, regiões e abas; sem valores
window.vortixAgent.describe({ region: 'request-editor', includeState: true }) // descoberta focada, com estados seguros
window.vortixAgent.snapshot() // estado resumido e seguro da tela atual
```

`region` usa um nome existente em `data-vortix-region`; a consulta inclui apenas essa região e seus descendentes. Uma região desconhecida retorna listas vazias, sem fallback para o catálogo completo. `includeState: true` acrescenta somente estados booleanos disponíveis, como `disabled` e `expanded`; `selected` das abas já aparece no contrato. A resposta não inclui valores, texto ou conteúdo dos controles. Omitir `includeState` mantém o formato legado de `describe()`.

`snapshot()` informa método, presença de campos, contagens, tipo Auth e metadados da resposta (status HTTP e estado). Omite conteúdo da resposta, URL, rota, valores de Params/Headers/Body/Auth e variáveis do ambiente. O painel **Estado seguro para IA**, dentro de **Referências e origens**, mostra o mesmo JSON ao ser solicitado. Esse estado serve para orientar a navegação; não dispara chamadas e não comprova consentimento nem autorização para gravar.

Estados dos controles não comprovam consentimento ou autorização. Em particular, nenhum estado do bridge substitui a autorização explícita e as confirmações exigidas antes de enviar uma escrita.

## Ajuda dentro do Vortix

O selo **IA v2 pronta** na barra superior verifica se o bridge compatível está carregado. Se estiver ausente ou desatualizado, o selo mostra esse estado. Clique nele para abrir instruções, links para a documentação e um prompt copiável.

No Maestri, abra o Vortix em um Portal e conecte o Portal ao terminal do agente. O Maestri usa sua CLI para controlar o navegador; não precisa de MCP. Para reutilizar as instruções, copie o prompt do Vortix e salve como responsabilidade **Vortix Operator** em **Ajustes → Agentes**. Os controles de ajuda também aparecem no contrato DOM como `agent.help.open` e `agent.prompt.copy`.

O botão **Copiar contexto seguro** copia o JSON atual de `snapshot()` para a área de transferência. Ele não envia requests nem concede autorização. Se o navegador bloquear a cópia, o JSON atual aparece em um campo somente leitura selecionado para cópia manual. Bridge ausente, incompatível ou snapshot fora do contrato v2 não copia estado anterior.

O botão **Tela cheia** usa a Fullscreen API e acompanha `document.fullscreenElement` por `fullscreenchange`. Esc permanece como saída nativa. O estado do botão não tenta inferir o modo F11 do navegador.

Prefira localizar elementos por papel e nome acessível. `data-vortix-action`, `data-vortix-field` e `data-vortix-region` são referências estáveis para encontrar controles, campos e áreas:

| Ação | Seletor | Para que serve |
|---|---|---|
| Nova request | `[data-vortix-action="request.new"]` | Abrir uma request em branco |
| Nova coleção | `[data-vortix-action="collection.new"]` | Criar uma coleção |
| Enviar request | `[data-vortix-action="request.send"]` | Enviar a request atual pela interface |
| Abrir ajuda de IA | `[data-vortix-action="agent.help.open"]` | Consultar status, instruções e prompt copiável |
| Copiar prompt Maestri | `[data-vortix-action="agent.prompt.copy"]` | Copiar o prompt mostrado na ajuda |
| Salvar request | `[data-vortix-action="request.save"]` | Salvar na coleção escolhida |
| Selecionar ambiente | `[data-vortix-action="environment.select"]` | Trocar o ambiente ativo |
| Gerenciar ambientes | `[data-vortix-action="environment.manage"]` | Criar ou editar ambientes |
| Buscar requests | `[data-vortix-action="collection.search"]` | Abrir busca rápida |
| Importar coleção | `[data-vortix-action="collection.import"]` | Abrir importação |
| Exportar coleção | `[data-vortix-action="collection.export"]` | Exportar a coleção selecionada |
| Runner | `[data-vortix-action="runner.open"]` | Preparar execução de coleção ou pasta |
| Configurações | `[data-vortix-action="settings.open"]` | Abrir configurações |
| Gerar estado seguro | `[data-vortix-action="agent.snapshot.refresh"]` | Mostrar o resumo JSON sem valores da request |

Campos úteis usam `data-vortix-field`: `request.method`, `request.route`, `request.base-url`, `request.headers`, `request.body-mode`, `request.body`, `request.auth-type`, `response.status`, `response.headers`, `response.body`, `agent.safe-state` e `agent.capability-status`. `request-params` é uma região com as linhas de query Params. Identificadores ajudam a localizar o campo; não autorizam ler ou repetir valores sensíveis.

As áreas principais usam `data-vortix-region`: `collections`, `history`, `environment`, `request-workspace`, `request-editor`, `request-editor-tabs`, `request-response`, `agent-safe-state` e `agent-help`. As abas Params, Headers, Body, Auth, Scripts e Testes são `tab`; cada uma aponta para seu painel por `aria-controls`, e cada painel retorna a referência por `aria-labelledby`. Use as teclas ←/→, Home e End para navegar pelas abas.

## Fluxo recomendado

1. Confirme que está no Vortix e confira o ambiente ativo. Se não existir ambiente, abra **Gerenciar ambientes** e peça a URL base e os dados que faltarem; não invente valores.
2. Consulte `window.vortixAgent.snapshot()` ou clique **Gerar estado seguro** para ver método, campos preenchidos e status sem ler os valores. Prepare a request pelos campos acessíveis **Método HTTP**, **Rota** e **URL base**. Configure Params, Headers, Body e Auth nas abas correspondentes. Antes de enviar, confirme o destino e o método solicitados.
3. Antes de enviar qualquer request, desmarque **Salvar credenciais de Auth nas requests deste workspace**; essa opção vem marcada por padrão. O Vortix grava o histórico antes do envio, e Auth pode ser persistida ali. Só mantenha a opção ligada se o usuário pedir explicitamente para guardar credenciais. Depois, envie apenas a chamada pedida. GET, HEAD e OPTIONS não exigem a confirmação de gravação do Vortix, mas confira o contrato da API: um endpoint GET ainda pode alterar dados.
4. Leia o status, os cabeçalhos e o body em **Resposta**. Relate o resultado sem copiar tokens, senhas ou outros valores sensíveis.
5. O histórico registra requests enviadas conforme as configurações de retenção. Peça autorização antes de salvar uma request numa coleção. Não persista credenciais sem pedido explícito. Confirme com a pessoa antes de importar, exportar, apagar dados ou executar um Runner com várias requests.

## Gravações e dados sensíveis

- POST, PUT, PATCH e DELETE podem alterar dados. Só envie uma dessas chamadas após consentimento explícito do usuário para aquela operação e após conferir URL e dados de teste.
- Nunca burle o campo `TESTE`, a caixa de confirmação ou a confirmação exibida antes do envio. Se a interface bloquear a operação, pare e explique o que falta.
- Nunca chame endpoints do Vortix ou da API diretamente. Não use `fetch`, console, scripts ou outra rota para enviar requests ou contornar o guard da interface.
- Antes de enviar qualquer request, desmarque **Salvar credenciais de Auth nas requests deste workspace**; ela vem marcada por padrão, e o histórico é gravado antes da chamada. Só deixe essa opção ativa se o usuário pedir explicitamente a persistência de credenciais.
- Não leia, acesse nem consulte tokens, senhas, segredos, valores do cofre, IndexedDB ou localStorage. Não os repita em mensagens, screenshots ou histórico manual. Se a request precisar de uma credencial, peça ao usuário para configurá-la no ambiente ou Auth do Vortix.
- Peça autorização explícita antes de salvar uma request numa coleção.
- Exportações podem conter dados de requests e, conforme as opções escolhidas, credenciais. Só exporte após pedido explícito e confira as opções na tela.
- Se aparecer erro de armazenamento, ambiente indisponível, confirmação pendente ou resposta inesperada, não tente recuperar dados por caminhos alternativos. Informe o erro e peça orientação.

## Prompt de operação para um agente

Copie este texto para as instruções do agente que usará o Portal:

> Você controla o Vortix somente pela interface visual do Maestri Portal. Primeiro inspecione a página e localize os controles por papel/nome acessível, `data-vortix-action` ou `data-vortix-region`; confira `meta[name="vortix-agent-contract"]`. Use as abas Params, Headers, Body, Auth, Scripts e Testes conforme a tarefa. Envie apenas requests pedidas pelo usuário e confira ambiente, URL, rota e método antes de cada envio. Antes de enviar qualquer request, desmarque **Salvar credenciais de Auth nas requests deste workspace**; o histórico é gravado antes da chamada. Só mantenha essa opção ativa se o usuário pedir explicitamente para persistir credenciais. POST, PUT, PATCH e DELETE exigem autorização explícita para aquela operação; nunca contorne o guard ou use endpoints, `fetch`, console ou scripts para enviar chamadas. Nunca leia nem repita credenciais, tokens, senhas, valores do cofre, IndexedDB ou localStorage. Peça autorização explícita antes de salvar uma request numa coleção. Não importe, exporte, apague dados nem rode uma coleção inteira sem autorização explícita. Depois do envio, resuma status e resultado sem incluir segredos. Se faltar ambiente, URL, credencial, autorização ou se a interface mostrar erro, pare e pergunte ao usuário.
