## Issue relacionada

Closes #

## Resumo

<!-- O que muda e qual problema resolve? -->

## Tipo de mudança

- [ ] Correção
- [ ] Funcionalidade
- [ ] Documentação ou exemplo
- [ ] Segurança ou privacidade
- [ ] Manutenção ou build

## Áreas afetadas

- [ ] Interface e acessibilidade
- [ ] Requests, autenticação ou proxy
- [ ] Coleções, ambientes ou persistência
- [ ] Importação/exportação
- [ ] Runner ou CLI
- [ ] Hospedagem/configuração
- [ ] Documentação

<!-- Liste arquivos/módulos importantes e explique impactos em render.yaml, Dockerfile ou configuração, se houver. -->

## Evidência visual (quando aplicável)

<!-- Inclua antes/depois. Use somente conteúdo fictício; remova tokens, cookies, URLs privadas e dados reais. -->

## Validação

- [ ] `dotnet restore ./VortixApiClient.csproj`
- [ ] `dotnet build ./VortixApiClient.csproj -c Release`
- [ ] `node --test ./RunnerLogic.test.cjs ./VortixRunner.test.cjs`
- [ ] Testes PowerShell aplicáveis
- [ ] Teste manual descrito abaixo

**Comandos executados e resultado:**

<!-- Informe exatamente o que rodou. Explique verificações não executadas. -->

## Checklist

- [ ] O projeto continua agnóstico de API; exemplos usam dados fictícios.
- [ ] Não incluí tokens, senhas, dados pessoais, bancos locais ou configuração privada.
- [ ] Atualizei a documentação quando necessário.
- [ ] Considerei acessibilidade, teclado e estados de erro/sucesso para mudanças de UI.
- [ ] Considerei impactos em compatibilidade e nos modos local/hospedado.
