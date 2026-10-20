# Contribuindo com o Vortix

Obrigado por ajudar a melhorar o Vortix. Este guia descreve o fluxo local e o que esperamos de issues e pull requests.

## Antes de começar

- Consulte issues existentes antes de abrir uma nova.
- Para mudanças maiores, abra uma issue primeiro para alinhar escopo e abordagem.
- Mantenha o produto agnóstico de API: não inclua rotas, ambientes, credenciais ou regras de uma API específica.
- Não publique tokens, senhas, `client_secret`, cookies, dados pessoais, URLs privadas ou conteúdo real de requests. Use valores fictícios.
- Para vulnerabilidades, siga [`SECURITY.md`](SECURITY.md); não abra uma issue pública com detalhes exploráveis.

## Preparar o ambiente

Requisitos: .NET 10 SDK, Node.js 18 ou superior, PowerShell e Python 3. O Runner CLI também requer Node.js 20 ou superior.

~~~powershell
git clone https://github.com/JeffyMesquita/Vortix.git
Set-Location Vortix
dotnet restore ./VortixApiClient.csproj
dotnet run --project ./VortixApiClient.csproj --no-launch-profile
~~~

Abra `http://127.0.0.1:51873/`. O workspace local usa SQLite fora da pasta do repositório por padrão. Nunca adicione bancos locais, `appsettings` privado, chaves de Data Protection ou arquivos `.env` ao Git.

## Validar as mudanças

Antes de abrir o pull request, execute build e testes:

~~~powershell
dotnet restore ./VortixApiClient.csproj
dotnet build ./VortixApiClient.csproj -c Release
node --test ./RunnerLogic.test.cjs ./VortixRunner.test.cjs
powershell -NoProfile -ExecutionPolicy Bypass -File ./HostingMode.test.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File ./WorkspaceProtection.test.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File ./AuthorizationCodePkce.test.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File ./HistoryRetention.test.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File ./GraphqlIntrospection.test.ps1
~~~

Os testes integrados sobem serviços locais temporários e os encerram ao final. Se não conseguir executar algum, informe no pull request qual comando faltou e por quê; não marque como validado o que não rodou.

## Abrir uma issue

Use os formulários do GitHub para [relatar um bug](https://github.com/JeffyMesquita/Vortix/issues/new?template=bug_report.yml) ou [sugerir uma melhoria](https://github.com/JeffyMesquita/Vortix/issues/new?template=feature_request.yml). Descreva o problema observado, os passos mínimos e o resultado esperado. Em bugs de interface, inclua uma captura com dados fictícios e sem informações sensíveis.

## Abrir um pull request

1. Crie uma branch curta a partir de `master`, por exemplo `fix/collection-order` ou `feat/request-import`.
2. Faça uma mudança focada e explique o problema que ela resolve.
3. Atualize a documentação quando comportamento, configuração ou fluxo de uso mudar.
4. Rode as verificações aplicáveis e registre os resultados no template do pull request.
5. Relacione a issue com `Closes #123` quando o pull request a resolver.
6. Para mudanças visuais, inclua capturas de antes/depois com conteúdo fictício.

O template do pull request também pede resumo, tipo de mudança, áreas tocadas, validação, evidência visual quando aplicável e uma checagem de segurança/segredos.

## Convenções do projeto

- Prefira mudanças pequenas, compatíveis e fáceis de revisar.
- Preserve o funcionamento local e hospedado; descreva impactos em `render.yaml`, `Dockerfile` ou configurações de publicação.
- Não adicione dependências sem necessidade. A interface não exige npm.
- Não persista credenciais em texto puro, logs, exemplos ou histórico. Preserve o comportamento de proteção do cofre e dos backups.
- Não fixe uma API real nos exemplos ou nos dados iniciais; use domínios como `api.example.com` e valores fictícios.
- Respeite as licenças dos recursos incorporados, incluindo as fontes em `wwwroot/fonts/`.

## Revisão e integração

Todo pull request precisa passar pelas verificações automáticas e pela revisão. A equipe pode pedir ajustes de escopo, testes, acessibilidade, segurança ou documentação antes de integrar.

Contribuições aceitas serão distribuídas sob a [licença MIT](LICENSE), salvo quando outro licenciamento compatível for combinado e aceito antes da integração.
