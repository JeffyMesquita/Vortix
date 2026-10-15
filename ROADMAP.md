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

### 4. Multipart/form-data — próxima feature

Enviar campos de texto e arquivos sem persistir o conteúdo dos arquivos por padrão.

- [ ] Escrever testes para campos repetidos/vazios, bytes de arquivo e Content-Type com boundary.
- [ ] Criar editor de campos de texto e arquivos com remoção clara de cada item.
- [ ] Gerar boundary automaticamente; impedir Content-Type manual incompatível.
- [ ] Manter os bytes do arquivo somente em memória durante o envio.
- [ ] Persistir metadados e campos de texto; ao reabrir, pedir nova seleção dos arquivos.
- [ ] Preservar o formato no Runner e nos intercâmbios Vortix, Insomnia e Postman.
- [ ] Documentar tamanho, persistência e um exemplo visual no README.

### 5. GraphQL

Adicionar um editor próprio para query e variables, sem confundir o fluxo com body raw.

- [ ] Criar testes para query, variables, operationName e Content-Type.
- [ ] Persistir e executar os campos pelo Runner.
- [ ] Importar/exportar formatos compatíveis do Vortix, Insomnia e Postman.
- [ ] Documentar exemplo, validações e limitações no README.
### 6. Autenticação herdada por coleção e pasta

Evitar repetir credenciais em cada request, mantendo precedência fácil de entender.

- [ ] Definir herança: request substitui pasta; pasta substitui coleção.
- [ ] Mostrar claramente de onde vem a Auth ativa.
- [ ] Permitir sobrescrever ou desativar herança em uma request.
- [ ] Cobrir importação/exportação e execução do Runner.
- [ ] Testar que segredos não vazam entre coleções ou ambientes.

### 7. OAuth 2.0

Fazer depois de consolidar ambientes e herança, pois o fluxo exige armazenar tokens e tratar validade.

- [ ] Começar por Client Credentials e Authorization Code com PKCE.
- [ ] Configurar URLs, scopes e armazenamento local do token.
- [ ] Atualizar ou pedir novo token quando expirar.
- [ ] Nunca persistir client_secret sem consentimento explícito.
- [ ] Testar com servidor OAuth local simulado; documentar callbacks e limites.

### 8. Exemplos de resposta e mock local

Permitir testar interface e fluxos sem atingir um serviço externo.

- [ ] Salvar exemplos de resposta por request e status.
- [ ] Simular respostas no modo de desenvolvimento.
- [ ] Validar matching de método, rota e query.
- [ ] Impedir que o mock vire um servidor acessível à rede sem configuração.
- [ ] Adicionar exemplos para sucesso, validação e erro.

### 9. Próximos refinamentos

Só entram depois das features anteriores e dos testes de uso:

- [ ] Busca global e filtros por método, status e pasta.
- [ ] Histórico de respostas com limite configurável e sem guardar body sensível por padrão.
- [ ] Comparação de respostas e duração.
- [ ] Importação de mais formatos mediante teste de compatibilidade.

## Regra de sequência

Fechamos uma feature — testes, documentação e revisão — antes de iniciar a seguinte. A próxima execução começa por multipart/form-data. GraphQL será uma feature separada, com seus próprios testes e documentação.