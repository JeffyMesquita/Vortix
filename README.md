<p align="center">
  <img src="wwwroot/vortix-mark.svg" alt="Símbolo Vortix" width="88">
</p>

<h1 align="center">Vortix</h1>

<p align="center">Cliente HTTP local para criar, organizar, executar e repetir requisições de API.</p>
<p align="center">ASP.NET Core 8 · SQLite · JavaScript sem framework</p>

---

<p align="center">
  <img src="docs/images/vortix-workflow.svg" alt="Fluxo: importar cURL, revisar request e validar resposta" width="100%">
</p>

## Índice

- [Visão geral](#visão-geral)
- [Recursos](#recursos)
- [Requisitos](#requisitos)
- [Início rápido](#início-rápido)
- [Primeiro fluxo](#primeiro-fluxo)
- [Autenticação](#autenticação)
  - [Auth herdada por coleção e pasta](#auth-herdada-por-coleção-e-pasta)
- [Modos de body](#modos-de-body)
- [Multipart form-data](#multipart-form-data)
- [GraphQL](#graphql)
- [Importar cURL](#importar-curl)
- [Importar OpenAPI JSON](#importar-openapi-json)
- [Ambientes e variáveis](#ambientes-e-variáveis)
- [Scripts, testes e Runner](#scripts-testes-e-runner)
- [Importação e exportação](#importação-e-exportação)
- [Persistência e backups](#persistência-e-backups)
- [Segurança](#segurança)
- [Configuração](#configuração)
- [Desenvolvimento e validação](#desenvolvimento-e-validação)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Solução de problemas](#solução-de-problemas)
- [Plano de ação](ROADMAP.md)
- [Licenças das fontes](#licenças-das-fontes)

## Visão geral

Vortix é um cliente de APIs para uso local, inspirado no fluxo de trabalho de ferramentas como Insomnia e Postman. O projeto é agnóstico: não inclui URL, rota, parâmetro, credencial ou regra de uma API específica.

A interface roda no navegador. Um servidor ASP.NET Core local encaminha as requisições para a API escolhida e persiste o workspace em SQLite. Assim, o navegador não precisa acessar a API diretamente nem depender de CORS.

A aplicação escuta somente em loopback e foi pensada para uso em computador desktop. Não há login de usuário; mantenha o serviço restrito à própria máquina.

## Recursos

- **Editor de requests:** GET, HEAD, POST, PUT, PATCH, DELETE e OPTIONS; URL base, rota, Params, Headers, body JSON/texto/XML/form URL-encoded/Multipart/GraphQL e Auth Bearer, Basic ou API Key.
- **Coleções:** coleções, pastas e subpastas para organizar requests.
- **Ambientes:** variáveis próprias e Cookie jar isolado por ambiente, com substituição por templates como <code>{{baseUrl}}</code> e <code>{{token}}</code>.
- **Abas e histórico:** até 12 requests abertas; abas, histórico, coleções, ambientes e preferências ficam salvos localmente.
- **Resposta:** visualização Pretty, Árvore ou Raw, cópia de cabeçalhos e body, busca de texto e resposta temporária.
- **Captura de variáveis:** salve um campo JSON da resposta ou o texto completo no ambiente ativo.
- **Testes de resposta:** valide status HTTP, existência de campo JSON, igualdade ou presença de texto.
- **Runner:** execute requests de uma coleção ou pasta em sequência, com conjuntos de dados, intervalo, parada por falha e repetição das falhas.
- **Temas e fontes:** Dracula, Monokai, One Dark, Nord, Solarized Dark e GitHub Dark; Fira Code, JetBrains Mono, Cascadia Code, Cascadia Mono e IBM Plex Mono.
- **Editor JSON:** destaque de sintaxe e formatação com indentação de dois espaços.
- **Intercâmbio:** Vortix JSON, Insomnia v4, Postman Collection v2.1, cURL e OpenAPI 3 em JSON.
- **Backups:** exportação simples em JSON ou arquivo protegido por senha.

Requests novas começam vazias. A URL base e os demais valores vêm do ambiente e da configuração que você criar.

## Requisitos

- **.NET 8 SDK** para executar, compilar ou publicar o projeto.
- Navegador moderno com suporte a IndexedDB e Web Crypto.
- **Node.js 18 ou superior** para os testes de lógica JavaScript.
- **PowerShell e Python 3** para o teste integrado de proteção do SQLite.

A interface não exige npm nem framework JavaScript.

## Início rápido

### Windows

Na pasta do projeto, execute:

~~~powershell
.\Abrir-Testador-API.cmd
~~~

O iniciador reutiliza uma instância Vortix que já responda no health check. Caso não exista, inicia o servidor e abre o navegador.

### Outros sistemas ou execução manual

~~~sh
dotnet run --project ./ApiPublicacaoTester.csproj --no-launch-profile
~~~

Abra:

~~~text
http://127.0.0.1:51873/
~~~

Health check local:

~~~text
http://127.0.0.1:51873/health
~~~

O servidor usa a porta 51873 por padrão. Consulte [Configuração](#configuração) para alterá-la.

## Primeiro fluxo

1. Abra **Configurações → Ambientes** e crie um ambiente.
2. Adicione uma variável chamada <code>baseUrl</code>, por exemplo <code>https://api.example.com</code>.
3. Crie uma coleção e, se quiser, pastas para separar recursos ou cenários.
4. Crie uma request, escolha o método e informe a rota começando por <code>/</code>.
5. Preencha Params na aba **Params**. Os parâmetros são enviados na query string; nomes repetidos e valores vazios são aceitos.
6. Adicione cabeçalhos, autenticação e body nas respectivas abas.
7. Clique em **Enviar**. Depois, salve a request na coleção para reutilizá-la.

Exemplo:

| Campo | Valor |
|---|---|
| URL base | <code>{{baseUrl}}</code> |
| Rota | <code>/v1/users</code> |
| Params | <code>page=1</code> |
| Header | <code>Accept: application/json</code> |

Escolha **Body** para selecionar JSON, texto, XML ou form URL-encoded. O modo define o Content-Type padrão; um header Content-Type informado manualmente o sobrescreve.


## Modos de body

O editor mantém o body como texto e oferece formatos prontos:
<p align="center">
  <img src="docs/images/vortix-body-modes.svg" alt="Exemplos coloridos de JSON, texto, XML e form URL-encoded no Vortix" width="100%">
</p>

| Formato | Content-Type padrão |
|---|---|
| JSON | <code>application/json</code> |
| Texto | <code>text/plain</code> |
| XML | <code>application/xml</code> |
| Form URL-encoded | <code>application/x-www-form-urlencoded</code> |
| Multipart | <code>multipart/form-data</code> com boundary automático |

Exemplos:

~~~json
{"name":"Ana","active":true}
~~~

~~~text
Texto livre para uma API que não recebe JSON.
~~~

~~~xml
<request><name>Ana</name></request>
~~~

~~~text
name=Ana&tag=one&tag=two
~~~

O formato acompanha a request nas abas, histórico, coleções e Runner. Vortix JSON o preserva; Postman e Insomnia recebem o formato e Content-Type correspondentes.

O JSON mantém destaque, indentação e compactação. Para texto, XML e form URL-encoded, o editor mostra o conteúdo sem destaque JSON. O header Content-Type manual pode substituir o padrão. GET, HEAD e OPTIONS continuam sem body.

Multipart e GraphQL têm seções próprias abaixo. Veja o [plano de ação](ROADMAP.md).

## Multipart form-data

<p align="center">
  <img src="docs/images/vortix-multipart-flow.svg" alt="Fluxo multipart: montar campos, gerar boundary e preservar apenas metadados" width="100%">
</p>

Adicione campos de texto e arquivos à mesma request. Nomes repetidos e valores vazios são aceitos. O Vortix cria o <code>Content-Type</code> e o boundary; remova qualquer <code>Content-Type</code> manual em **Headers**, pois ele é rejeitado para evitar um boundary inválido.

Exemplo do metadata que o workspace preserva:

~~~json
[
  { "name": "title", "type": "text", "value": "Ana" },
  { "name": "avatar", "type": "file", "fileName": "avatar.png", "contentType": "image/png" }
]
~~~

| Parte | O que fica salvo | Ao reabrir |
|---|---|---|
| Texto | Nome e valor; valores com nomes sensíveis são omitidos conforme as regras do workspace. | Disponível para edição e envio. |
| Arquivo | Nome do campo, nome do arquivo e tipo MIME. Os bytes não são gravados em SQLite, histórico, backup nem exportação. | Selecione o arquivo novamente. |

O limite total por envio é **10 MB**. O arquivo fica em memória durante a chamada e segue pelo proxy local. A request é preservada em JSON Vortix, Insomnia v4 e Postman Collection v2.1 com os metadados; nenhum formato de exportação inclui os bytes do arquivo.

O Runner executa campos de texto. Requests com arquivos precisam ser enviadas manualmente depois de selecionar os arquivos novamente.

## GraphQL

<p align="center">
  <img src="docs/images/vortix-graphql-flow.svg" alt="Fluxo GraphQL: query, variables e envio JSON por POST" width="100%">
</p>

Edite a query, as variables JSON e o **Operation Name** em campos separados. O Vortix envia um POST com <code>Content-Type: application/json</code>:

~~~graphql
query GetUser($id: ID!) {
  user(id: $id) { id name }
}
~~~

~~~json
{
  "id": "{{userId}}"
}
~~~

O payload enviado é montado pelo Vortix:

~~~json
{
  "query": "query GetUser($id: ID!) { user(id: $id) { id name } }",
  "variables": { "id": "42" },
  "operationName": "GetUser"
}
~~~

Variables precisam ser um objeto JSON. Se o campo ficar vazio, a propriedade <code>variables</code> não é enviada. Templates de ambiente dentro dos valores são resolvidos no envio. Query, variables e operationName ficam salvos na request, histórico e abas; o Runner também os preserva. Requests com método diferente de POST são recusadas.

O intercâmbio Postman Collection v2.1 usa o body GraphQL. Insomnia v4 recebe o envelope JSON de query. Importação e exportação preservam query, variables e operationName. Veja as referências oficiais de [GraphQL no Postman](https://learning.postman.com/docs/use/send-requests/protocols/graphql/graphql-http) e [GraphQL no Insomnia](https://developer.konghq.com/insomnia/graphql/).

Esta fatia não busca schema por introspecção nem oferece autocomplete. A request continua agnóstica: informe o endpoint GraphQL da API que você estiver usando.

### Métodos e proteção de gravação

Todos os métodos suportados estão disponíveis no seletor. POST, PUT, PATCH e DELETE exigem digitar <code>TESTE</code>, marcar a confirmação e aceitar a confirmação final do navegador. No Runner, gravações também exigem a frase e confirmações correspondentes.

Essa proteção é uma confirmação manual. O Vortix não consegue determinar se os dados ou o ambiente de destino são descartáveis. GET, HEAD e OPTIONS não aceitam body.

## Autenticação

<p align="center">
  <img src="docs/images/vortix-auth-modes.svg" alt="Modos Bearer, Basic Auth e API Key no Vortix" width="100%">
</p>

A aba **Auth** oferece três formas comuns de autenticar requests. Selecione o tipo, preencha os campos e reutilize variáveis do ambiente, como <code>{{token}}</code>, <code>{{usuario}}</code> ou <code>{{apiKey}}</code>.

### Bearer

Use o token direto ou uma variável. O Vortix monta o header Authorization ao enviar:

~~~http
Authorization: Bearer {{token}}
~~~

### Basic Auth

Informe usuário e senha em campos separados. O Vortix cria o header Basic durante o envio; você não precisa codificar Base64 manualmente.

### API Key

Informe nome do campo, valor e local de envio. Prefira **Header**. A opção **Query Params** fica disponível para APIs que exigem esse formato e pede confirmação porque valores na URL podem aparecer em logs.

~~~http
X-API-Key: {{apiKey}}
~~~

### Auth herdada por coleção e pasta

<p align="center">
  <img src="docs/images/vortix-auth-inheritance.svg" alt="Precedência da autenticação: request personalizada, pasta mais próxima e coleção" width="100%">
</p>

Configure um padrão uma vez na coleção ou pasta. Requests novas começam em **Herdar**; a aba Auth mostra a origem, como **Herdada de Minha coleção**. Os campos ficam visíveis, mas bloqueados enquanto herdam.

A precedência é request personalizada > pasta mais próxima > coleção. Sem autenticação desativa a herança naquela request. Requests antigas sem `authMode` continuam personalizadas, preservando a configuração anterior.

Exemplo simplificado do JSON Vortix:

~~~json
{
  "auth": {
    "authType": "bearer",
    "bearerToken": "{{token}}"
  },
  "requests": [
    {
      "name": "GET /health",
      "route": "/health",
      "authMode": "inherit",
      "authType": "none"
    },
    {
      "name": "GET /public",
      "route": "/public",
      "authMode": "none",
      "authType": "none"
    }
  ]
}
~~~

O token fica no padrão da coleção, não é copiado para cada request nem para o histórico. O histórico guarda a referência da coleção/pasta e o ambiente da chamada, para reabrir Auth herdada no mesmo escopo. Se `{{token}}` varia entre ambientes, o Vortix resolve o valor do ambiente ativo ao enviar ou executar no Runner. Requests personalizadas continuam guardando seus próprios campos conforme a opção de salvamento.

### Salvamento e intercâmbio

A opção **Salvar credenciais de Auth nas requests locais** controla histórico, abas e padrões de coleção/pasta. Desmarcada, o Vortix mantém os valores só na sessão e não os grava nessas áreas. SQLite protege campos sensíveis com ASP.NET Core Data Protection.

Na importação, você escolhe se guarda credenciais. Na exportação, elas ficam fora por padrão. Marcar **Incluir credenciais de Auth e variáveis sensíveis** grava valores diretamente no JSON sem criptografia.

Vortix JSON e Postman Collection v2.1 preservam Auth de coleção/pasta e requests herdadas. Insomnia v4 não oferece Auth nativa na coleção; ao exportar, o Vortix cria a pasta “Auth padrão” para manter o escopo. As requests herdam da pasta, como no fluxo do Insomnia. Consulte a documentação oficial sobre [Auth em pastas no Insomnia](https://developer.konghq.com/insomnia/requests/) e [herança no Postman](https://learning.postman.com/latest-v-12/docs/use/send-requests/authorization/specifying-authorization-details).


## Importar cURL

O botão de importação aceita coleções JSON ou um comando cURL. Ao colar o comando, o Vortix apenas o interpreta: **não executa o comando nem envia a request**. O resultado abre como rascunho para revisão; salve-o depois em uma coleção.

Exemplo aceito:

~~~sh
curl --request PATCH \
  "https://api.example.com/v1/users/42?notify=true" \
  --header "Accept: application/json" \
  --header "Content-Type: application/json" \
  --data-raw '{"name":"Ana"}'
~~~

A importação converte método, URL, Params, headers e body. Também entende aspas simples/duplas e continuações de linha comuns do shell. O header Bearer vai para **Auth** e fica apenas em memória; marque a opção de salvamento se quiser persistir o token localmente.

A primeira versão aceita `-X`/`--request`, `-H`/`--header`, `--url`, `-d`/`--data`, `--data-raw`, `--data-binary`, `--json` e `-I`/`--head`. Body enviado sem método explícito vira POST; `--data` sem Content-Type recebe `application/x-www-form-urlencoded`.

O Vortix rejeita comandos com credenciais na URL, parâmetros de query sensíveis, autenticação Basic, cookies, upload de arquivo e opções não reconhecidas. Isso evita importar uma chamada alterada silenciosamente. Configure esses campos manualmente e importe a request novamente quando terminar.

## Importar OpenAPI JSON

Importe um documento OpenAPI 3.0, 3.1 ou 3.2 em JSON pelo botão de importação de coleções. O Vortix gera requests por operação, agrupa pela primeira tag, usa o primeiro servidor e converte parâmetros de path, query e header. Exemplos JSON da request viram body editável.

Exemplo mínimo:

~~~json
{
  "openapi": "3.1.1",
  "info": { "title": "Store API" },
  "servers": [{ "url": "https://api.example.com/v1" }],
  "paths": {
    "/users/{id}": {
      "get": {
        "tags": ["Users"],
        "summary": "Get user",
        "parameters": [{ "name": "id", "in": "path", "example": 42 }],
        "responses": { "200": { "content": { "application/json": {} } } }
      }
    }
  }
}
~~~

Variáveis de servidor com valor padrão são criadas em um ambiente OpenAPI. Valores sensíveis e variáveis sem padrão ficam para configuração manual. Parâmetros sem exemplo ficam editáveis; variáveis de path sem exemplo aparecem como <code>{{nome}}</code>. Confira a coleção gerada antes de enviar.

O importador não resolve referências <code>$ref</code> (locais ou externas), não acessa a rede para buscá-las, não aplica automaticamente os requisitos de segurança e não gera body de mídia não JSON. Esses casos aparecem como avisos para revisão manual. A primeira versão aceita JSON; YAML ainda não é importado. Consulte também a <a href="https://spec.openapis.org/oas/latest.html">especificação OpenAPI</a>.

## Ambientes e variáveis

Cada ambiente mantém suas próprias variáveis. Grupos ajudam a separar ambientes como Desenvolvimento, Homologação e Produção; os nomes e valores são definidos por você.

O Cookie jar também é separado por ambiente. Cookies recebidos em <code>Set-Cookie</code> são reutilizados quando domínio, caminho, HTTPS e validade correspondem. A lista mostra nome e metadados, nunca o valor; use **Limpar cookies deste ambiente** para removê-los. Excluir um ambiente também remove seu jar.

~~~http
Set-Cookie: session=exemplo; Path=/; Secure; HttpOnly; SameSite=Lax
~~~

O Vortix preserva SameSite como metadado. Como o envio é feito por um cliente HTTP local, regras de navegação de navegador para SameSite não são aplicadas.

Use <code>{{nomeDaVariavel}}</code> em URL base, rota, Params, Headers e Body. O Vortix substitui os templates antes do envio. Variáveis não definidas geram erro para evitar requests com valores incompletos.

Ao capturar uma variável de resposta, escolha o nome, a origem (campo JSON ou texto completo) e, para JSON, o caminho desejado. Por padrão, a captura ocorre apenas em respostas 2xx e salva o valor no ambiente ativo.

## Scripts, testes e Runner

### Captura de resposta

<p align="center">
  <img src="docs/images/token-capture.svg" alt="Capturar access_token da resposta e reutilizar na próxima request" width="100%">
</p>

**Exemplo:** na request de autenticação, capture <code>access_token</code> para a variável <code>token</code>. Na próxima request, use <code>Authorization: Bearer {{token}}</code>. O valor fica no ambiente ativo e não precisa ser copiado entre chamadas.

~~~json
{
  "access_token": "valor-retornado-pela-api",
  "expires_in": 3600
}
~~~

Na aba **Scripts**, configure a captura de um valor, como <code>data.access_token</code>, para uma variável como <code>token</code>. O painel também mostra o código equivalente para o fluxo After-response do Insomnia, que pode ser copiado.

Scripts importados não são executados. O importador converte apenas formas simples de <code>insomnia.environment.set()</code> e <code>pm.environment.set()</code> em captura nativa. JavaScript arbitrário é ignorado e sinalizado.

### Testes de resposta

A aba **Testes** permite até 20 verificações por request:

- status HTTP igual a um código;
- campo JSON existente;
- campo JSON igual a um valor;
- campo JSON contendo um valor.

Os testes rodam depois do envio manual e durante o Runner. Uma falha de teste marca a request como falha na rodada. Ao exportar testes ou captura para Insomnia/Postman, o Vortix pede confirmação para gerar scripts no arquivo.

### Runner de coleção

Selecione uma coleção ou pasta e clique em **Executar seleção**. O Runner percorre as requests em sequência e permite:

- fornecer até 100 conjuntos de variáveis JSON;
- definir intervalo entre requests;
- parar na primeira falha;
- executar novamente somente requests que falharam;
- acompanhar status, duração e resultado de cada request.

Exemplo de conjunto de dados JSON para o Runner:

~~~json
[
  { "userId": "101", "name": "Ana" },
  { "userId": "102", "name": "Rui" }
]
~~~

Use <code>/v1/users/{{userId}}</code> na rota e <code>{"name":"{{name}}"}</code> no body. O Runner substitui as variáveis em cada iteração.

Cada rodada aceita até 500 requests. Credenciais solicitadas manualmente pelo helper de token permanecem no fluxo interativo e não são executadas pelo Runner. O relatório é temporário; requests e variáveis capturadas continuam salvas.

## Importação e exportação

| Formato | Importar | Exportar |
|---|:---:|:---:|
| Vortix JSON v2 | Sim | Sim |
| API Studio JSON legado v1/v2 | Sim | — |
| Insomnia Export JSON v4 | Sim | Sim |
| Postman Collection v2.1 | Sim | Sim |
| Comando cURL | Sim | - |
| OpenAPI 3.0/3.1/3.2 JSON | Sim | - |
| Ambiente Postman | Sim | Acompanha a coleção exportada |

Na importação, o Vortix pede confirmação antes de guardar credenciais Bearer, Basic, API Key e variáveis sensíveis com proteção local. A exportação omite credenciais por padrão; se marcar a opção, o JSON poderá conter esses valores sem criptografia. Cookies e chaves privadas continuam fora do export.

Exports Insomnia e Postman podem conter scripts After-response/Post-response gerados para captura e testes. O Vortix pede confirmação antes de gerar esses scripts. Revise o arquivo e o código antes de importá-lo em outro cliente.

## Persistência e backups

Histórico, coleções, pastas, ambientes, Cookie jars, requests, abas e configurações ficam em um banco SQLite local. Valores de cookies são protegidos com Data Protection. O body das respostas não é persistido. Requests e variáveis podem conter dados sensíveis, portanto proteja o computador e os backups.

Em Windows, sem configuração personalizada, o banco fica em:

~~~text
%LOCALAPPDATA%/ApiPublicacaoTester/api-studio.sqlite
~~~

Em outros sistemas, o diretório parte de <code>Environment.SpecialFolder.LocalApplicationData</code>. O caminho pode ser definido com <code>ApiStudio__DatabasePath</code>.

Na primeira execução, o Vortix tenta importar os dados antigos do IndexedDB do navegador. A cópia antiga é preservada no navegador; se a migração falhar, os dados permanecem disponíveis para nova tentativa.

### Proteção de dados

O SQLite inteiro não é criptografado. ASP.NET Core Data Protection protege campos reconhecidos como sensíveis e bodies não vazios. A proteção depende do key ring e da identidade que executa o aplicativo. Mantenha acesso às chaves ao mover o banco ou trocar a identidade do processo.

As credenciais de Auth seguem a opção de salvamento da request ou do histórico. No helper **Solicitar token**, client_id/client_secret são pedidos a cada envio e não entram no histórico.

### Backup do workspace

Em **Configurações → Backup do workspace**, escolha:

- **Backup simples:** JSON sem criptografia. Pode conter dados sensíveis.
- **Backup com senha:** arquivo protegido com AES-GCM de 256 bits e chave derivada por PBKDF2-SHA-256. Exige senha de pelo menos 12 caracteres; a senha não é salva nem recuperável.

A restauração substitui o workspace local, incluindo histórico, coleções, ambientes e configurações. Faça um backup antes e guarde a senha do arquivo protegido separada dele.

## Segurança

- O serviço escuta somente em <code>127.0.0.1</code>; os endpoints locais também validam origem e host.
- A interface não oferece autenticação. Não exponha o serviço à rede local ou à internet por proxy reverso.
- HTTPS é recomendado para a API de destino. HTTP em localhost funciona; HTTP em outros hosts exige habilitação explícita na request e confirmação antes do envio. HTTP não cifra tokens, headers ou body.
- O Vortix valida URL base e rota, não permite trocar de host pela rota e bloqueia alguns cabeçalhos de transporte. Redirecionamentos HTTP não são seguidos automaticamente.
- Configure a autenticação na aba **Auth**. O Vortix gera o header Authorization para Bearer e Basic; não informe esse header manualmente.
- Requests importadas não executam scripts arbitrários.
- Arquivos SQLite, key rings, configurações locais e segredos estão excluídos pelo <code>.gitignore</code>. Não remova essas regras ao preparar um fork ou publicação.

## Configuração

O aplicativo lê as configurações ASP.NET Core por variáveis de ambiente:

| Variável | Padrão | Descrição |
|---|---|---|
| <code>ApiStudio__Port</code> | <code>51873</code> | Porta local. Aceita valores de 1 a 65535. |
| <code>ApiStudio__DatabasePath</code> | LocalApplicationData + <code>ApiPublicacaoTester/api-studio.sqlite</code> | Caminho completo do banco SQLite. A identidade do processo precisa ter permissão de leitura e escrita. |

Exemplo no PowerShell:

~~~powershell
$env:ApiStudio__Port = '51874'
$env:ApiStudio__DatabasePath = 'D:/VortixData/api-studio.sqlite'
dotnet run --project ./ApiPublicacaoTester.csproj --no-launch-profile
~~~

As variáveis valem para o processo iniciado nesse terminal.

## Desenvolvimento e validação

~~~powershell
dotnet restore ./ApiPublicacaoTester.csproj
dotnet build ./ApiPublicacaoTester.csproj -c Release
node --test ./RunnerLogic.test.cjs
powershell -NoProfile -ExecutionPolicy Bypass -File ./WorkspaceProtection.test.ps1
~~~

O teste integrado precisa de Python 3 acessível como <code>python</code>. Ele cria um SQLite temporário, inicia uma instância local isolada e remove a pasta temporária ao finalizar.

Com o Vortix já em execução, valide a página e os endpoints locais:

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./Validar-Testador.ps1
~~~

## Estrutura do projeto

| Caminho | Responsabilidade |
|---|---|
| <code>Program.cs</code> | Host ASP.NET Core, proxy de requests, endpoints locais e validações HTTP. |
| <code>LocalDataStore.cs</code> | Persistência SQLite, proteção de valores e backups do workspace. |
| <code>wwwroot/index.html</code> | Estrutura da interface. |
| <code>wwwroot/app.js</code> | Editor, coleções, ambientes, histórico e fluxos da interface. |
| <code>wwwroot/runner-logic.js</code> | Lógica sem dependência de DOM, importação, validação e Runner. |
| <code>wwwroot/style.css</code> | Layout, temas, tipografia e estados visuais. |
| <code>Abrir-Testador-API.cmd</code> | Atalho de inicialização no Windows. |
| <code>Validar-Testador.ps1</code> | Smoke check contra uma instância em execução. |
| <code>RunnerLogic.test.cjs</code> | Testes de lógica JavaScript. |
| <code>WorkspaceProtection.test.ps1</code> | Teste integrado de persistência e proteção em banco temporário. |

## Solução de problemas

### A porta 51873 já está em uso

Defina <code>ApiStudio__Port</code> para outra porta livre e abra o novo endereço local. O helper do Windows só reutiliza a instância existente quando o health check identifica o Vortix.

### Uma request não chega à API

Confira URL base, rota, método, Params, headers e autenticação. Para HTTP fora de localhost, habilite a opção de HTTP inseguro somente naquela request; prefira HTTPS.

### O envio de gravação é bloqueado

POST, PUT, PATCH e DELETE exigem digitar exatamente <code>TESTE</code>, marcar a confirmação e aceitar a confirmação final. O Runner aplica as próprias confirmações de gravação.

### Dados protegidos não abrem após mover a instalação

Verifique se o banco e o key ring do ASP.NET Core Data Protection foram preservados e se o processo continua usando a identidade correta. Faça backup antes de mudar a identidade do pool ou a localização dos dados.

### Um importador informa que scripts não foram convertidos

O Vortix não executa JavaScript arbitrário. Apenas comandos simples de captura de ambiente são convertidos; scripts incompatíveis precisam ser recriados usando as abas **Scripts** ou **Testes**.

## Licenças das fontes

As fontes Fira Code, JetBrains Mono, IBM Plex Mono, Cascadia Code e Cascadia Mono estão incluídas com suas licenças OFL-1.1 em <code>wwwroot/fonts/licenses/</code>.