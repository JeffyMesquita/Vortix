# Validação — execução estruturada interna

## Escopo

Requests salvas individuais, preparação pura, revisão visual e execução única. Sem MCP ou endpoint novo. Nenhuma API real, credencial pessoal, commit ou publicação.

## Evidência automatizada

- Suítes Node: 346 testes, 345 passaram, um ignorado e nenhuma falha. Controlador, preparação salva, UI com controlador real, integração do envio e suítes preexistentes cobrem aprovação, expiração, concorrência, sentinelas, isolamento lexical e falha local após resposta.
- Build Release .NET 10 sem avisos/erros; sintaxe dos quatro arquivos JavaScript de execução e diff conferidos.
- `HostingMode.test.ps1`: passou. Origem, isolamento de sessões/OAuth, persistência de Cookie jar, restauração, SSRF e rate limit preservados no escopo testado.
- `WorkspaceProtection.test.ps1`: passou. Cifragem, migração idempotente e sobrevivência após restart preservadas no escopo testado.
- Gates adicionais antes do PR: `AuthorizationCodePkce.test.ps1`, `HistoryRetention.test.ps1` e `GraphqlIntrospection.test.ps1` passaram. Restore/build e as oito suítes Node foram repetidos; 18 links locais da documentação foram conferidos.

## Execução visual

Instância local em porta temporária e banco SQLite exclusivo em diretório temporário; servidor de fixture Python restrito ao loopback. Ambos foram encerrados ao final. Temas alterados somente no workspace descartável; viewport restaurado.

- Preparar e aprovar GET não chamaram a fixture; primeiro envio ocorreu somente ao executar.
- GET lento seguido de troca de aba: resposta não sobrescreveu a nova aba; resumo final informou HTTP 200.
- POST bloqueado sem checkbox/frase; com aprovação contextual, executou na fixture descartável.
- Editar rota após aprovação invalidou preparação e manteve execução desabilitada.
- POST com assertiva HTTP 200 e captura JSON: uma assertiva passou, captura e histórico confirmados; aprovação/execução acionadas também pelo teclado.
- Fixture registrou exatamente três chamadas: um GET `/slow` e dois POST `/fixture`. Preparações, aprovações e invalidação não geraram chamadas adicionais.
- Inspeção visual em Dracula e Papel, além de viewport 900 x 800. Card com botões quebrando linha sem corte do conteúdo principal.

Evidência visual sanitizada e versionada: [execução revisada](../../images/structured-execution-reviewed.jpg). Não copiar o banco temporário para o repositório.

## Revisão e correções

Revisão independente estática identificou exposição de helpers em scripts clássicos, revisão incompleta de captura e perda de evidência de entrega em erro local. Corrigidos com encapsulamento da aplicação, revisão dos efeitos e classificação que preserva resposta conhecida. Verificação adicional confirmou ausência de bloqueadores nesses ajustes; não equivale a auditoria completa do produto.

Smoke revelou que controles de aprovação estavam sendo tratados como edição do rascunho. Corrigido no rastreamento do editor e coberto por teste de regressão.

## Limites e medição

Na mesma tela final de fixture: snapshot DOM de 8.417 caracteres; texto do resumo de execução de 157 caracteres. O resumo cobre somente resultado; não substitui descoberta, revisão e autorização. Não são contagens de tokens, nem benchmark de ponta a ponta ou percentual de economia.

Sem validação de transporte externo, integração real Maestri ou APIs de terceiros. Timeout/perda de estado segue conservador: entrega desconhecida não autoriza replay. Recarregar descarta IDs em memória. A captura para cofre e cenários de falha são cobertos pelos testes/limites existentes, mas não foram exercitados com um cofre real no smoke visual desta rodada.

A delegação pelo bridge foi iniciada, mas não retornou metadados confirmados. Não atribuir a entrega a uma execução DeepSeek comprovada. As verificações locais e a revisão independente são a evidência desta entrega.
