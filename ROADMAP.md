# Vortix — plano de ação

Evoluímos em fatias pequenas. Cada feature deve resolver um fluxo completo antes de começarmos a seguinte.

## Critério de pronto para cada feature

- [ ] Escrever cenário de uso e critérios de aceite.
- [ ] Criar primeiro os testes de regressão e de comportamento.
- [ ] Implementar a menor mudança que fecha o fluxo.
- [ ] Verificar armazenamento e exposição de segredos.
- [ ] Atualizar o README com como usar, exemplo e limitações.
- [ ] Adicionar diagrama ou captura quando ajudar a explicar a experiência.
- [ ] Rodar testes direcionados, build e validação do diff.
- [ ] Conferir estados visuais e teclado em uma instância local isolada.
- [ ] Publicar a feature somente depois de passar pelos itens acima.

## Base já coberta

- [x] Requests HTTP, Params, Headers e body editável.
- [x] Coleções, pastas, subpastas, abas e histórico local.
- [x] Ambientes e variáveis, incluindo captura de valores da resposta.
- [x] Testes de resposta e execução sequencial pelo Runner.
- [x] Temas, fontes locais, editor JSON e escala global de texto.
- [x] Importação de cURL e OpenAPI JSON.
- [x] Intercâmbio Vortix JSON, Insomnia v4 e Postman Collection v2.1.
- [x] Projeto agnóstico de API: nenhuma rota ou credencial específica fica no core.

## Rodada atual

### 1. Basic Auth e API Key

**Status: concluída nesta rodada.**

- [x] Campos de usuário/senha e API Key por header ou query.
- [x] Envio pelo proxy local; validação de cabeçalhos e valores.
- [x] Salvamento controlado pela opção de credenciais, com proteção no SQLite.
- [x] Histórico, abas, coleções, importação e exportação atualizados.
- [x] Confirmação visível para API Key enviada na query.
- [x] Teste Node, teste integrado local, build e revisão da tela Auth.
- [x] README e diagrama de autenticação atualizados.

### 2. Cookie jar por ambiente

**Status: concluída nesta rodada.**

- [x] Isolar o jar por ambiente e reutilizar cookies conforme domínio, caminho, HTTPS e validade.
- [x] Preservar SameSite como metadado; o cliente HTTP não aplica regras de navegação de browser.
- [x] Proteger cabeçalhos de cookie no SQLite e ocultar valores na interface.
- [x] Permitir inspecionar e limpar cookies do ambiente ativo.
- [x] Excluir o jar ao remover o ambiente.
- [x] Testar isolamento, Path, expiração, proteção em repouso e persistência após reinício.
- [x] Documentar fluxo e limitações no README.

### 3. Raw e form URL-encoded

**Status: concluída nesta rodada.**

- [x] JSON, texto, XML e form URL-encoded com Content-Type padrão.
- [x] Sobrescrever Content-Type em Headers.
- [x] Preservar bodyMode em abas, histórico, coleções, Runner e intercâmbio Vortix/Insomnia/Postman.
- [x] Testar bytes e Content-Type no proxy local, incluindo override manual.
- [x] Documentar exemplos e limitações no README.

### 4. Multipart/form-data

**Status: concluída com suporte a arquivos efêmeros.**

- [x] Testar campos repetidos/vazios, bytes binários, boundary automático e rejeição de Content-Type manual em mock local.
- [x] Criar editor de campos de texto e arquivos, com remoção individual.
- [x] Gerar boundary automaticamente e rejeitar Content-Type manual para multipart.
- [x] Manter os bytes do arquivo em memória; limitar a 10 MB por envio.
- [x] Salvar texto e metadados; ao reabrir, pedir nova seleção do arquivo.
- [x] Preservar campos e metadados em Vortix, Insomnia v4 e Postman v2.1 sem exportar bytes.
- [x] Runner executa multipart de texto; requests com arquivos pedem envio manual.
- [x] Documentar limites, persistência e fluxo visual no README.

### 5. GraphQL

**Status: concluída.**

- [x] Escrever query e variables JSON em campos separados, com operationName opcional.
- [x] Validar query não vazia, variables como objeto JSON e envio somente por POST.
- [x] Montar envelope JSON e resolver templates de ambiente antes do envio.
- [x] Preservar query/variables/opName em coleções, abas, histórico e Runner.
- [x] Importar/exportar GraphQL para Vortix, Insomnia v4 e Postman v2.1.
- [x] Testar builder, método, payload e proxy em mock local; build sem warnings.
- [x] Documentar exemplo e fluxo visual no README.

### 6. Autenticação herdada por coleção e pasta

**Status: concluída.**

- [x] Precedência: request personalizada > pasta mais próxima > coleção.
- [x] Exibir origem da Auth e os modos Herdar, Personalizar e Sem autenticação.
- [x] Salvar padrão no nível de coleção ou pasta usando a opção existente de consentimento para credenciais.
- [x] Não copiar segredos herdados para requests, abas ou histórico; salvar apenas `authMode` e o escopo quando aplicável.
- [x] Histórico restaura coleção/pasta e ambiente original antes de resolver Auth herdada.
- [x] Preservar defaults em Vortix JSON, Insomnia v4 e Postman Collection v2.1.
- [x] Runner resolve a mesma cadeia e as variáveis pelo ambiente ativo.
- [x] Testar precedência, isolamento entre coleções/ambientes, persistência de abas e proteção recursiva no SQLite.
- [x] Atualizar README com exemplo JSON, diagrama local e referências oficiais.
- [x] Verificar UI desktop em SQLite temporário: Auth herdada, GET local e Runner concluídos.
- [x] Node 67/67, build Release sem avisos, teste integrado de proteção do SQLite aprovado.

### 7. README visual e exemplos

**Status: concluída nesta rodada.**

- [x] Incluir diagrama local colorido para herança Auth, combinando com os diagramas já existentes.
- [x] Adicionar JSON de exemplo e explicar prioridade, ambientes, histórico e Runner.
- [x] Testar links da imagem e presença dos exemplos junto da suíte Node.

### 8. OAuth 2.0

**Status: Client Credentials e Authorization Code + PKCE implementados e validados; popup PKCE conferido visualmente com OAuth mock local.**

#### Client Credentials

- [x] Criar testes de formulário, autenticação Basic/body, expiração e erros antes da implementação.
- [x] Enviar <code>grant_type=client_credentials</code> por <code>application/x-www-form-urlencoded</code>.
- [x] Suportar <code>client_secret_basic</code> e <code>client_secret_post</code>; rejeitar query, duplicidade e métodos combinados.
- [x] Isolar perfil sem segredo por ambiente; solicitar <code>client_secret</code> a cada envio e limpar o campo depois.
- [x] Salvar <code>access_token</code> como <code>{{token}}</code> por opção e exibir <code>expires_in</code>.
- [x] Testar com OAuth mock local; conferir armazenamento e ausência de segredo em SQLite.
- [x] Atualizar README com exemplo, diagrama e limites do fluxo.

#### Authorization Code + PKCE

- [x] Usar nova aba de navegador e callback loopback restrito a <code>127.0.0.1</code>.
- [x] Gerar <code>state</code>, <code>code_verifier</code> e <code>code_challenge</code> aleatórios com método S256.
- [x] Validar state e callback específico por provedor; trocar o código com o <code>redirect_uri</code> exato.
- [x] Persistir tokens somente com consentimento explícito e proteção local.
- [x] Testar cancelamento, state inválido, timeout, callback de outro provedor e token exchange em mock local.
- [x] Documentar cadastro da redirect URI, fluxo e limitações por provedor.
- [x] Validar popup/callback PKCE e opções de consentimento de salvamento no navegador usando OAuth mock loopback.

### 9. Exemplos de resposta e mock local


Permitir testar interface e fluxos sem atingir um serviço externo.

- [x] Salvar exemplos nomeados por request, preservando status, headers filtrados e body após confirmação explícita.
- [x] Aplicar limites de tamanho e quantidade; omitir headers de autenticação, cookies e segredos.
- [x] Persistir exemplos com a coleção e preservá-los no formato Vortix JSON.
- [x] Importar e exportar exemplos em Insomnia v4 e Postman v2.1, mantendo o vínculo com a request.
- [x] Pedir confirmação antes de exportar bodies de resposta em JSON sem criptografia.
- [x] Cobrir normalização, limites, imutabilidade e atualizar README e smoke check.
- [x] Simular localmente um exemplo salvo sem fazer chamada HTTP nem iniciar servidor.
- [x] Validar método, caminho e query da request; ordem de query não afeta o matching.
- [x] Manter a simulação dentro da interface, sem listener ou porta de rede.
- [x] Documentar exemplos de sucesso, validação e erro e cobrir os três status em testes.

### 10. Próximos refinamentos

Só entram depois das features anteriores e dos testes de uso:

- [x] Busca global por texto e filtros combináveis por método, status de resposta salvo e coleção/pasta, incluindo subpastas.
- [x] Histórico de respostas com retenção configurável, metadados e bodies desligados por padrão; bodies de token nunca são salvos.
- [x] Comparação lado a lado de respostas do histórico: status, duração, headers filtrados e bodies salvos.
- [x] Importar HTTPie CLI como formato adicional, sem executar o comando; filtrar credenciais e recusar arquivos/opções desconhecidas.
- [x] Schema GraphQL por introspecção com confirmação explícita, cache em memória, browser de tipos e autocomplete.

### 11. Cofre local de segredos

**Status: concluída nesta rodada.**

- [x] Criar cofre opcional por ambiente usando o armazenamento existente do navegador (<code>dbRead</code>/<code>dbWrite('settings', …)</code>) sem endpoint, tabela, autenticação ou senha compartilhada.
- [x] Cifrar com WebCrypto PBKDF2-SHA-256 + AES-GCM-256, salt/IV aleatórios e IV novo em cada gravação/snapshot; senha de 12 a 256 caracteres.
- [x] Persistir apenas ciphertext e metadados; manter senha, chave e valores descriptografados somente em memória e descartá-los no lock/reload.
- [x] Escopar segredos por <code>environmentId</code> e resolver templates com precedência dataset/runner &gt; cofre &gt; ambiente, com proveniência sem valores.
- [x] Falhar fechado quando o cofre está bloqueado e o nome pertence ao índice, sem reutilizar valor obsoleto do ambiente.
- [x] Tratar erro de <code>dbRead</code> ou envelope inválido como <code>unavailable</code>, bloqueando criar/desbloquear falsos e o envio com templates; só ausência real de registro significa nenhum cofre.
- [x] Integrar a resolução no envio manual e no Runner, incluindo URL base, rota, Params, Headers, Auth, Body, GraphQL e multipart.
- [x] Exibir inspetor acessível de referências no editor e no Runner com campo, nome e origem (<code>environment</code>, <code>vault</code>, <code>dataset</code>, <code>missing</code>, <code>locked</code>, <code>unavailable</code>) sem valores.
- [x] Permitir captura de resposta com destino explícito ambiente/cofre; cofre bloqueado, indisponível ou erro de storage nunca cai para o ambiente, e o valor só é publicado após <code>dbWrite</code> confirmado.
- [x] Preservar o envelope opaco em backups simples/protegidos sem misturar valores do cofre às variáveis de ambiente ou coleções.
- [x] Adicionar UI acessível de criar, editar, remover, desbloquear e bloquear cofre, listando apenas nomes e mascarando valores.
- [x] Documentar ativação, precedência, lock/reload, backup e limites no README.
- [x] Cobrir resolução, envelope, IV, senha curta, lock/unlock e backup no teste Node.

### 12. Hospedagem pública gratuita

**Status: modo público implementado e validado localmente; provisionamento externo pendente.**

- [x] Manter o modo local preso ao loopback e criar modo Render com `PORT` e origem HTTPS configurada.
- [x] Abrir acesso sem senha compartilhada e manter workspace de cada perfil no IndexedDB do navegador.
- [x] Isolar Cookie jars e fluxos OAuth por sessão aleatória `HttpOnly`/`Secure`; esconder os endpoints do SQLite do workspace.
- [x] Validar a origem, bloquear destinos IP não públicos no proxy e limitar chamadas por IP encaminhado.
- [x] Cobrir acesso anônimo, isolamento de sessões e OAuth, bloqueio de workspace, SSRF e rate limit em teste integrado.
- [x] Documentar persistência no navegador, backups protegidos, limites do plano Free e acesso a APIs privadas.
- [x] Incluir `Dockerfile` e `render.yaml` sem credenciais.
- [x] Atualizar o target e a imagem para .NET 10 LTS, com suporte oficial até 14/11/2028.
- [x] Criar o serviço web público no Render, sem senha compartilhada.
- [x] Configurar CNAME de `vortixapiclient.jeffymesquita.dev` e validar o TLS pelo subdomínio.
- [x] Confirmar em teste local que a mesma sessão e seu Cookie jar sobrevivem a um restart controlado do processo com SQLite e key ring estáveis. O teste não simula perda do filesystem no Render Free, que continua podendo apagar o SQLite temporário ao reiniciar ou publicar.

### 13. Histórico local do Runner

**Status: concluída e validada nesta rodada.**

- [x] Salvar ao final rodadas concluídas, com falhas e interrompidas pelo usuário, incluindo etapas não executadas.
- [x] Persistir somente o snapshot permitido (`id`, `startedAt`, `durationMs`, totais, `stopped` e steps com ordinal, outcome, status, duração e contagem de testes).
- [x] Manter até 30 rodadas em no máximo 750 KB, com ordenação estável por `startedAt` e sem alterar o array de origem.
- [x] Aplicar o mesmo allowlist ao exportar e restaurar backups, descartando URLs, bodies, headers, datasets, labels e mensagens de erro.
- [x] Integrar leitura/gravação por `dbRead`/`dbWrite('settings')` para funcionar no SQLite local e no IndexedDB do modo público.
- [x] Normalizar e persistir snapshots antigos ao abrir o Runner para manter IDs de exclusão estáveis.
- [x] Serializar gravação, exclusão e limpeza entre abas com Web Locks e manter controles bloqueados até concluir cada mutação.
- [x] Exibir lista compacta e acessível no Runner; leitor de tela recebe resumo curto separado da lista e navegadores sem Web Locks mostram aviso. Todas as 500 etapas podem ser consultadas, com rótulos de exclusão distintos, além de remoção individual e limpeza total.
- [x] Falhar sem bloquear a execução quando o armazenamento estiver indisponível e mostrar aviso acionável sem sobrescrever histórico desconhecido.
- [x] Documentar privacidade, retenção e controles no README.
- [x] Rodar `node --test ./RunnerLogic.test.cjs` (159/159), `node --check`, build Release sem avisos, `git diff --check` e smoke desktop: duas abas preservaram as rodadas, as 75 etapas puderam ser expandidas, IDs legados foram migrados e excluídos, registros extras foram removidos, o aviso sem Web Locks apareceu, a limpeza total funcionou e não houve erros no browser.

## Feature: exportar ambientes individualmente

**Objetivo:** transferir um ambiente sem exportar a coleção inteira. O arquivo Postman Environment JSON também pode ser importado no Insomnia.

- [x] Adicionar ação **Exportar** na gestão de ambientes.
- [x] Exportar somente o ambiente escolhido como Postman Environment JSON.
- [x] Omitir variáveis sensíveis por padrão; incluir somente após confirmação explícita sobre o arquivo sem criptografia.
- [x] Nunca incluir valores ou envelope do cofre de segredos.
- [x] Reimportar o arquivo pelo importador existente sem criar coleção vazia; manter sufixo para nomes repetidos.
- [x] Testar formato, omissão/inclusão sensível, valores vazios e round-trip pelo importador.
- [x] Validar testes Node, sintaxe JavaScript, build Release e diff.
- [x] Validar visualmente a ação por ambiente, exportar com teclado e importar sem criar coleção vazia.

Referências: [exportar um ambiente no Postman](https://learning.postman.com/docs/use/send-requests/variables/team-environments/) e [importar ambientes Postman no Insomnia](https://developer.konghq.com/how-to/migrate-collections-and-environments-from-postman-to-insomnia/).

### 14. Runner CLI para CI/CD

**Objetivo:** executar coleções Vortix v2 em pipelines, com os guardrails e testes de resposta existentes.

**Status: concluída e validada nesta rodada.**

- [x] Adicionar CLI Node sem dependências, reutilizando `runner-logic.js`.
- [x] Executar somente pelo proxy Vortix em loopback; limpar o Cookie jar temporário após a rodada.
- [x] Mapear variáveis secretas a partir do ambiente do processo sem aceitar valores nos argumentos ou registrá-los.
- [x] Preservar datasets, captura de variáveis em memória, testes de resposta e limite total de 500 requests.
- [x] Bloquear métodos de escrita por padrão; exigir `--allow-writes` e confirmação `TESTE`.
- [x] Gerar JUnit genérico sem URLs, headers, bodies, dados de teste ou valores de variáveis; definir códigos de saída.
- [x] Cobrir sucesso, falha HTTP/assertion, captura, precedência CI, segredo, escrita bloqueada, redirects, colisões JUnit e cancelamento.
- [x] Documentar pré-requisitos Node/.NET, configuração de CI, limites e exemplo no README.
- [x] Validar 178 testes Node (177 passaram; 1 teste de symlink pulado por bloqueio do Windows), sintaxe, build Release sem avisos e smoke ponta a ponta pelo proxy local isolado.

### 15. Ações pré-request e variáveis de ciclo de vida

**Status: concluída e validada nesta rodada.**

- [x] Adicionar ações nativas e ordenadas para UUID, timestamp UTC e templates; não executar JavaScript arbitrário no Vortix.
- [x] Resolver valores temporários em URL, Params, Headers, Auth, Body, GraphQL e multipart com prioridade dataset → pré-request → cofre → ambiente.
- [x] Permitir ativar/desativar e reordenar ações; guardar configuração em coleções, abas e histórico sem salvar valores gerados.
- [x] Executar no envio manual, Runner visual e Runner CLI; remover metadados locais do payload do proxy e preservar redação de valores derivados do cofre.
- [x] Exportar código equivalente para Insomnia e Postman com confirmação; importar somente scripts pré-request gerados e intactos pelo Vortix, desativados para revisão.
- [x] Pedir consentimento separado para persistir texto literal em templates; sem consentimento, omitir essas ações e manter as demais seguras.
- [x] Cobrir regras/precedência/round-trip de scripts com testes Node e executar um caso do Runner CLI via proxy local.
- [x] Atualizar o README com passos, exemplo e limites.
- [x] Rodar 193 testes Node (192 passaram; 1 teste de symlink foi ignorado por `EPERM` no Windows), sintaxe JavaScript, build Release sem avisos e `git diff --check`.
- [x] Conferir a interface Scripts, consentimento e persistência após recarga; uma chamada GET com UUID chegou ao mock loopback e retornou HTTP 200.

### 16. Gerar request como cURL

**Status: concluída e validada nesta rodada.**

**Objetivo:** copiar a request atual para PowerShell ou Bash sem enviá-la nem salvá-la.

- [x] Gerar método, URL, Params, headers e body compatíveis com cURL; avisar quando multipart não puder ser copiado.
- [x] Omitir Auth, body e valores sensíveis por padrão; incluir somente após confirmação explícita.
- [x] Preservar templates sem resolver valores do ambiente ou do cofre; avisar sobre ações pré-request, arquivos e Cookie jar não exportados.
- [x] Usar quoting seguro para PowerShell e Bash/zsh.
- [x] Adicionar prévia acessível e botão de copiar, usando os temas e componentes existentes.
- [x] Cobrir geração, omissão de segredos, duplicidade de Auth/API Key, templates, quoting e validação de URL com testes.
- [x] Documentar exemplos e limitações no README.
- [x] Rodar 213 testes Node (212 passaram; 1 teste de symlink foi ignorado por `EPERM` no Windows), sintaxe JavaScript, build Release sem avisos e `git diff --check`.
- [x] Conferir o fluxo desktop com Playwright em servidor e banco temporários: Body e Auth omitidos por padrão, aparecem após confirmação e a prévia volta ao modo seguro ao fechar; nenhuma API externa foi chamada.

### 17. Gerar request como HTTPie

**Objetivo:** copiar a request atual para o terminal HTTPie, mantendo as salvaguardas do export cURL.

- [x] Gerar método, URL, headers, Params e body HTTPie.
- [x] Emitir body arbitrário com `--raw` e permitir round-trip pelo importador sem executar o comando.
- [x] Omitir Auth, Body e valores sensíveis por padrão; pedir confirmação explícita antes de revelar.
- [x] Preservar templates e avisar sobre ações pré-request, arquivos e Cookie jar não exportados.
- [x] Cobrir sintaxe, quoting PowerShell/Bash, redaction, duplicidades e validação com testes.
- [x] Atualizar README com exemplos e documentação oficial do HTTPie.
- [x] Validar testes, build Release, sintaxe JavaScript e `git diff --check`.
- [x] Conferir o fluxo visual no desktop: seletor HTTPie/cURL, Bash/PowerShell, consentimento de Body e aviso do Cookie jar; modal volta ao modo seguro após fechar, sem enviar requests.

### 18. Exportar coleção como OpenAPI 3.1 JSON

**Status: implementação completa; testes, build Release e smoke visual local passaram.**

- [x] Adicionar a opção **OpenAPI 3.1** ao diálogo de exportação com sufixo `.openapi.json`.
- [x] Passar a coleção sanitizada com `exportCollectionNode(collection,false)` e as variáveis não sensíveis do ambiente ativo ao builder puro.
- [x] Projetar allowlist de método, path, query, headers, body, `Accept` e `Content-Type`; não serializar Auth, exemplos/respostas, scripts, cookies ou Cookie jar.
- [x] Inferir schemas de body sem exportar valores literais; omitir campos sensíveis e avisar que nome, URL, path e nomes de campos podem revelar contexto.
- [x] Emitir `openapi: "3.1.0"`, `info.title` com o nome da coleção e `responses` não vazio em toda operação.
- [x] Converter templates `{{id}}` do Vortix em `{id}`, canonicalizar placeholders pela posição no path e gerar parâmetros `in: path` obrigatórios com o mesmo nome canônico.
- [x] Deduplicar parâmetros de query repetidos e validar media types de `Accept`/`Content-Type` antes de usá-los como chave, caindo no padrão do body com aviso genérico.
- [x] Interromper a exportação diante de colisão de método + path canônico, sem descartar uma request silenciosamente.
- [x] Converter `{{var}}` em `{var}` nos servidores, usar defaults apenas quando seguros, preservar o round-trip de uma variável que ocupa a URL inteira como `baseUrl` e cair para `https://api.example.test` com aviso.
- [x] Exportar Auth somente como metadados de esquema e security requirement, sempre avisando que valores não são representados.
- [x] Produzir avisos para multipart, GraphQL, conteúdo não mapeável, pastas aninhadas, cookies, scripts e exemplos antes do download.
- [x] Atualizar README e ROADMAP com escopo e limitações.
- [x] Executar testes Node direcionados, validação de sintaxe, build Release e smoke visual local do fluxo de download; nenhuma request foi enviada à API de destino.

### 19. Validar respostas com contratos OpenAPI

**Status: concluída e validada nesta rodada.**

**Objetivo:** ao importar OpenAPI, validar respostas reais contra o status, media type e schema da operação, tanto no envio manual quanto no Runner.

- [x] Importar schemas de resposta inline e `$ref` local limitado, sem buscar referências externas.
- [x] Persistir o contrato junto à request, histórico e snapshots de workspace; mantê-lo na exportação Vortix e fora do payload enviado ao proxy.
- [x] Validar status, media type, JSON e regras estruturais suportadas sem exibir ou guardar valores da resposta.
- [x] Comparar método e caminho efetivo incluindo prefixo do servidor; preservar `{{variavel}}` de rota ao reabrir requests.
- [x] Marcar incompatibilidades e regras/ref não suportadas como parciais, sem falso sucesso; Runner mostra avisos amarelos e registra parciais no histórico.
- [x] Exibir resultados junto aos testes da resposta no envio manual, mocks locais e Runner visual.
- [x] Cobrir parsing, limites, redaction, persistência e integração com testes; usar somente mocks locais.
- [x] Atualizar README com exemplo, limites e diagrama do fluxo.
- [x] Preservar a versão OpenAPI no contrato e validar `nullable`, tipos em união e limites exclusivos segundo 3.0/3.1/3.2; schemas e mapas/estruturas de resposta malformados ficam **Parciais** em vez de virarem validações vazias.
- [x] Rodar 268 testes Node (267 passaram; 1 teste de symlink foi ignorado por `EPERM` no Windows), build Release, sintaxe e `git diff --check`; conferir visualmente importação, rota-template e nota do contrato numa instância local com SQLite temporário, sem enviar requests à API.

### 20. Validar body das requests com contratos OpenAPI

**Status: concluída e validada nesta rodada.**

**Objetivo:** encontrar incompatibilidades no body antes do envio, com feedback local e reutilização da especificação importada.

- [x] Importar `requestBody.required`, media types JSON e schemas inline ou em `$ref` local limitado; nunca buscar referências externas.
- [x] Persistir o schema sanitizado junto ao contrato da operação e mantê-lo fora do payload enviado a `/api/request`.
- [x] Validar presença do body, JSON, `Content-Type` e regras estruturais suportadas sem repetir valores nas mensagens.
- [x] Marcar regras malformadas, referências indisponíveis e mídia não JSON como **Parciais**.
- [x] Expor **Validar body** na aba Testes e registrar o resultado do envio manual e do Runner; no Runner, divergência do body é aviso não bloqueante e não aciona **Parar após falha**.
- [x] Cobrir limites, templates, redaction e integração; documentar escopo e limitações no README.
- [x] Rodar 275 testes Node (274 passaram; 1 teste de symlink foi ignorado por `EPERM` no Windows), build Release, sintaxe e `git diff --check`.
- [x] Conferir em SQLite isolado: body sem campo obrigatório ficou **Falhou**, body válido ficou **Passou**; não enviar requests à API de destino.

### 21. Endereçar achados de revisão dos contratos OpenAPI

**Status: concluída e validada nesta rodada.**

- [x] Manter variáveis de caminho de servidor dinâmicas no contrato de resposta, incluindo URL base inteira variável e servidores relativos.
- [x] Usar o `Content-Type` padrão do `bodyMode` quando o cabeçalho estiver ausente; reprovar cabeçalho explícito vazio e `Content-Type` manual em multipart, conforme o proxy.
- [x] Contar somente campos multipart no modo multipart e preservar variáveis de servidor com caminhos de vários segmentos sem afrouxar parâmetros de rota.
- [x] Comparar `uniqueItems` por estrutura JSON, calcular `multipleOf` com precisão decimal e deixar limites de propriedades inconclusivos como **Parciais** acima do teto de inspeção.
- [x] Corrigir paginação/fronteira nos templates da skill e alinhar criação local de issue e seleção de layout com seus contratos.
- [x] Adicionar testes de regressão para os seis achados dos PRs #25 e #26 e preservar o marcador de base path no contrato persistido.
- [x] Rodar 281 testes Node (280 passaram; 1 teste de symlink ignorado por `EPERM` no Windows), build Release sem avisos/erros, `node --check` e `git diff --check`.

### 22. Execução estruturada interna e revisão visual

**Status: implementada com testes automatizados e smoke visual isolado. Sem transporte externo ou MCP.**

Integrada em `master` pelo PR #34, junto à correção do selo do PR #31 e à atualização de CI do PR #33. Estado e limites atuais no [fichário de continuidade](docs/continuity.md); o diagnóstico compacto foi implementado e integrado no checkout principal, com validação concluída no escopo da seção 23, ainda sem commit ou publicação. A [descoberta SDD](docs/superpowers/specs/2026-10-27-next-features-discovery.md) preserva as alternativas futuras.

- [x] Preparar request salva por IDs explícitos, sem HTTP, histórico ou alteração do formulário.
- [x] Aprovação visual por preparação, inclusive GET; escrita com confirmação de dados descartáveis e `TESTE`; expiração em cinco minutos e invalidação por alterações.
- [x] Executar uma única vez por preparação; consultar resumo em memória, sem payloads/credenciais e sem replay automático.
- [x] Separar entrega, status HTTP de destino, status do proxy, testes parciais, captura e persistência; preservar evidência de resposta após falha local.
- [x] Reutilizar proxy e helpers de testes/histórico/captura; manter bridge v2 somente leitura e encapsular dados da aplicação.
- [x] Validar GET, POST, teste visual, captura no ambiente descartável, teclado, invalidação após edição, troca de aba, temas claro/escuro e viewport estreito.
- [x] Registrar evidência e limites em `docs/superpowers/validation/2026-10-27-structured-execution.md`.
- [ ] Decidir transporte externo e sua fronteira de autorização em recorte posterior.
- [ ] Medir economia de tokens e chamadas com tarefas equivalentes; comparação de caracteres de uma tela não comprova economia total.

### 23. Diagnóstico compacto e leitura progressiva

**Status: implementado e integrado localmente; testes, smoke funcional e conferência visual por imagem registrados. Sem commit ou publicação.**

- [x] Aprovar [SDD](docs/superpowers/specs/2026-10-27-compact-diagnostics-design.md) e [plano incremental](docs/superpowers/plans/2026-10-27-compact-diagnostics.md).
- [x] Implementar projeção pura, catálogo fechado e leitura com limites, frescor e contexto; 33 testes direcionados passaram.
- [x] Integrar UI e bridge; corrigir achados de revisão em opções, modal e troca de aba ociosa.
- [x] Validar 403 testes Node (402 aprovados, um ignorado), build/sintaxe/diff e cinco suítes PowerShell; registrar smoke e 90 observações sintéticas em [validação](docs/superpowers/validation/2026-10-27-compact-diagnostics.md).
- [x] Conferir imagens reais em Dracula/Papel, 1280×900/900×800, com diagnóstico e controles acessíveis pela rolagem. Captura do Portal funcionou ao ativar Tela cheia no Vortix.
- [ ] Medir descoberta comparável e economia de tokens; não demonstradas pelo benchmark sintético atual.

### 24. Dependências visuais no Runner

**Status: implementada e validada localmente; entrega no [PR #39](https://github.com/JeffyMesquita/Vortix/pull/39). [Evidências e limites locais](docs/superpowers/validation/2026-10-29-runner-dependencies.md); estado de merge e checks no PR.**

- [x] Aprovar [SDD](docs/superpowers/specs/2026-10-29-runner-dependencies-design.md) e autorizar [plano](docs/superpowers/plans/2026-10-29-runner-dependencies.md) em terminais visíveis.
- [x] Análise pura/efêmera com precedência existente, capturas condicionais, datasets e limites explícitos.
- [x] Explicação com semântica nativa na sequência atual e revisão do subconjunto antes de reexecutar falhas; foco DOM conferido, teclado nativo via Portal não confirmado.
- [x] Preservar guards, histórico, CLI, ponte readonly e ausência de valores na projeção.
- [x] Testes comportamentais, revisão independente, build e smoke isolado com dados fictícios: 447 testes/446 aprovados/zero falhas/um skip; produtor não repetido na reexecução.
- [x] Documentar resultado e limites em evidência de validação antes da entrega.

## Regra de sequência

Fechamos cada feature com teste, documentação e revisão. Busca, histórico, comparação, HTTPie, schema GraphQL e fluxo PKCE visual foram validados em ambiente local/mock.
