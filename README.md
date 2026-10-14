<p align="center">
  <img src="wwwroot/vortix-mark.svg" alt="Símbolo Vortix" width="88">
</p>

<h1 align="center">Vortix</h1>

<p align="center">Cliente HTTP local para criar, organizar, executar e repetir requisições de API.</p>
<p align="center">ASP.NET Core 8 · SQLite · JavaScript sem framework</p>

---

## Índice

- [Visão geral](#visão-geral)
- [Recursos](#recursos)
- [Requisitos](#requisitos)
- [Início rápido](#início-rápido)
- [Primeiro fluxo](#primeiro-fluxo)
- [Ambientes e variáveis](#ambientes-e-variáveis)
- [Scripts, testes e Runner](#scripts-testes-e-runner)
- [Importação e exportação](#importação-e-exportação)
- [Persistência e backups](#persistência-e-backups)
- [Segurança](#segurança)
- [Configuração](#configuração)
- [Desenvolvimento e validação](#desenvolvimento-e-validação)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Solução de problemas](#solução-de-problemas)
- [Licenças das fontes](#licenças-das-fontes)

## Visão geral

Vortix é um cliente de APIs para uso local, inspirado no fluxo de trabalho de ferramentas como Insomnia e Postman. O projeto é agnóstico: não inclui URL, rota, parâmetro, credencial ou regra de uma API específica.

A interface roda no navegador. Um servidor ASP.NET Core local encaminha as requisições para a API escolhida e persiste o workspace em SQLite. Assim, o navegador não precisa acessar a API diretamente nem depender de CORS.

A aplicação escuta somente em loopback e foi pensada para uso em computador desktop. Não há login de usuário; mantenha o serviço restrito à própria máquina.

## Recursos

- **Editor de requests:** GET, HEAD, POST, PUT, PATCH, DELETE e OPTIONS; URL base, rota, Params, Headers, Body e Bearer.
- **Coleções:** coleções, pastas e subpastas para organizar requests.
- **Ambientes:** grupos de ambientes e variáveis próprias, com substituição por templates como <code>{{baseUrl}}</code> e <code>{{token}}</code>.
- **Abas e histórico:** até 12 requests abertas; abas, histórico, coleções, ambientes e preferências ficam salvos localmente.
- **Resposta:** visualização Pretty, Árvore ou Raw, cópia de cabeçalhos e body, busca de texto e resposta temporária.
- **Captura de variáveis:** salve um campo JSON da resposta ou o texto completo no ambiente ativo.
- **Testes de resposta:** valide status HTTP, existência de campo JSON, igualdade ou presença de texto.
- **Runner:** execute requests de uma coleção ou pasta em sequência, com conjuntos de dados, intervalo, parada por falha e repetição das falhas.
- **Temas e fontes:** Dracula, Monokai, One Dark, Nord, Solarized Dark e GitHub Dark; Fira Code, JetBrains Mono, Cascadia Code, Cascadia Mono e IBM Plex Mono.
- **Editor JSON:** destaque de sintaxe e formatação com indentação de dois espaços.
- **Intercâmbio:** formatos próprios do Vortix, Insomnia v4 e Postman Collection v2.1.
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

Para um body JSON, escolha **Body**, informe o conteúdo e use o botão de formatação quando precisar indentar.

### Métodos e proteção de gravação

Todos os métodos suportados estão disponíveis no seletor. POST, PUT, PATCH e DELETE exigem digitar <code>TESTE</code>, marcar a confirmação e aceitar a confirmação final do navegador. No Runner, gravações também exigem a frase e confirmações correspondentes.

Essa proteção é uma confirmação manual. O Vortix não consegue determinar se os dados ou o ambiente de destino são descartáveis. GET, HEAD e OPTIONS não aceitam body.

## Ambientes e variáveis

Cada ambiente mantém suas próprias variáveis. Grupos ajudam a separar ambientes como Desenvolvimento, Homologação e Produção; os nomes e valores são definidos por você.

Use <code>{{nomeDaVariavel}}</code> em URL base, rota, Params, Headers e Body. O Vortix substitui os templates antes do envio. Variáveis não definidas geram erro para evitar requests com valores incompletos.

Ao capturar uma variável de resposta, escolha o nome, a origem (campo JSON ou texto completo) e, para JSON, o caminho desejado. Por padrão, a captura ocorre apenas em respostas 2xx e salva o valor no ambiente ativo.

## Scripts, testes e Runner

### Captura de resposta

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

Cada rodada aceita até 500 requests. Credenciais solicitadas manualmente pelo helper de token permanecem no fluxo interativo e não são executadas pelo Runner. O relatório é temporário; requests e variáveis capturadas continuam salvas.

## Importação e exportação

| Formato | Importar | Exportar |
|---|:---:|:---:|
| Vortix JSON v2 | Sim | Sim |
| API Studio JSON legado v1/v2 | Sim | — |
| Insomnia Export JSON v4 | Sim | Sim |
| Postman Collection v2.1 | Sim | Sim |
| Ambiente Postman | Sim | Acompanha a coleção exportada |

Ao importar tokens, o Vortix pede confirmação para salvá-los com proteção local; também é possível importar sem esses valores. Durante a exportação, Bearer e variáveis sensíveis são omitidos por padrão. O <code>client_secret</code>, senhas e chaves privadas não são incluídos.

Exports Insomnia e Postman podem conter scripts After-response/Post-response gerados para captura e testes. O Vortix pede confirmação antes de gerar esses scripts. Revise o arquivo e o código antes de importá-lo em outro cliente.

## Persistência e backups

Histórico, coleções, pastas, ambientes, requests, abas e configurações ficam em um banco SQLite local. O body das respostas não é persistido. Requests e variáveis podem conter dados sensíveis, portanto proteja o computador e os backups.

Em Windows, sem configuração personalizada, o banco fica em:

~~~text
%LOCALAPPDATA%/ApiPublicacaoTester/api-studio.sqlite
~~~

Em outros sistemas, o diretório parte de <code>Environment.SpecialFolder.LocalApplicationData</code>. O caminho pode ser definido com <code>ApiStudio__DatabasePath</code>.

Na primeira execução, o Vortix tenta importar os dados antigos do IndexedDB do navegador. A cópia antiga é preservada no navegador; se a migração falhar, os dados permanecem disponíveis para nova tentativa.

### Proteção de dados

O SQLite inteiro não é criptografado. ASP.NET Core Data Protection protege campos reconhecidos como sensíveis e bodies não vazios. A proteção depende do key ring e da identidade que executa o aplicativo. Mantenha acesso às chaves ao mover o banco ou trocar a identidade do processo.

O Bearer só é salvo conforme a opção escolhida no histórico ou na request. No helper **Solicitar token**, as credenciais são pedidas a cada envio, não são salvas no request nem no histórico e são limpas depois do uso.

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
- Authorization deve ser informado na aba **Auth → Bearer**, não como header manual.
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