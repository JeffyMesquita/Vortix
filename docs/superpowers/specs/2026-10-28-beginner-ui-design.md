# UI para iniciantes — proposta de reorganização

Data: 28/10/2026. Estado: implementado e validado localmente para desktop; [evidências](../validation/2026-10-28-beginner-ui.md). Usuário aprovou o desenho (`sim`) e posteriormente dispensou otimização mobile.

## Objetivo e autorização

O usuário autorizou reorganizar a UI para reduzir informação acumulada, separar configurações e opções avançadas, explicar recursos e facilitar criar/abrir, preencher, enviar e entender a resposta. Confirmações e impedimentos de segurança são requisitos preservados.

Esta proposta concretiza a hierarquia de interação antes da implementação. Não autoriza branch, stage, commit, PR, push, merge, deploy, novas dependências ou requests reais. O checkout principal `D:\Projetos-Pessoais\Vortix`, `master/eafccf9`, é a fonte final; preservar todas as alterações locais. O diagnóstico compacto já existe e não será reimplementado.

## Base observada

Inspeção estática pelo Maestro e por Senku — UI iniciantes, em terminal visível. Não houve validação visual nesta rodada.

- `wwwroot/index.html:90-142`: o envio aparece antes da URL base; execução revisada, HTTP sem TLS e referências antecedem o editor.
- `wwwroot/index.html:392-399`: a proteção de escrita está distante do botão Enviar.
- `wwwroot/index.html:403-460`: cabeçalhos precedem o conteúdo da resposta; ferramentas ocupam espaço mesmo antes do primeiro resultado.
- `wwwroot/index.html:523-598`: configurações reúne aparência, histórico, ambientes, cofre, backup e proteção dos dados em sequência.
- `wwwroot/app.js:2115-2121`: salvar sem coleção termina em toast; o caminho para organizar e salvar não é contínuo.
- `wwwroot/app.js:2282-2290`: navegação do editor depende de uma tablist e de seus seletores. Alterar agrupamento exige preservar teclado, seleção e restauração de abas.
- `wwwroot/structured-ui.js:33-61`: diagnóstico considera indisponíveis controles dentro de details fechados. Uma reorganização não deve remover essa proteção nem sugerir controles invisíveis.

## Alternativas

1. **Divulgação progressiva no workspace atual — recomendada.** Mantém edição e resposta juntas; recolhe ferramentas secundárias e organiza configurações. Reaproveita HTML, CSS, diálogos e handlers atuais. Exige revisar foco e visibilidade após mover controles.
2. **Assistente obrigatório em etapas.** Orienta o primeiro uso, mas interrompe edição rápida e cria sincronização entre etapas e abas. Não recomendado para esta entrega.
3. **Novo modo iniciante paralelo ao atual.** Mantém uma experiência especializada separada, mas duplica estados, documentação e validação. Não recomendado sem evidência de necessidade.

## Desenho recomendado

### Criar ou abrir

Manter Nova requisição e busca de requests visíveis na lateral. Coleções continuam acessíveis; importar, exportar e Runner passam a um grupo textual Ferramentas da coleção, recolhido por padrão. Usar controles nativos, sem menu com semântica ARIA incompleta.

No vazio de coleções, explicar em uma frase que coleções organizam requests e apontar para a ação existente de criação. Preservar avisos de carregamento e falha de storage; erro não vira um workspace vazio fictício.

Se Salvar for acionado sem coleção, oferecer explicitamente Criar coleção no fluxo de salvamento, usando a criação existente. Cancelar deve preservar o rascunho e não criar dados. Não criar coleção silenciosamente nem alterar o formato salvo.

### Preencher

Manter ambiente ativo visível. Ordenar formulário por URL base, método e rota, seções opcionais e envio. Uma frase distingue servidor (`https://api.example.com`) de caminho (`/v1/resource`); exemplos não são preenchidos nem enviados automaticamente.

Manter Params, Headers, Body e Auth acessíveis com nomes técnicos acompanhados de explicações curtas: parâmetros na URL, cabeçalhos, conteúdo enviado e autenticação. Recursos de OAuth/cookies permanecem nos fluxos atuais, com explicação e divulgação progressiva; não migrar credenciais ou configurações entre escopos nesta entrega.

Scripts e Testes ficam identificados como Automação e testes, secundários ao preenchimento básico. Preservar uma navegação por abas coerente: não dividir a tablist em contêineres recolhidos sem ajustar seleção, teclado e restauração. Abrir uma request que usa recursos avançados deve informar isso; recolher não desativa configurações já salvas.

### Enviar

Agrupar proteção de escrita, mensagem de impedimento e botão Enviar numa área de ação após o formulário. Preservar a atualização de `#request-send-status`, `aria-describedby`, estado ocupado, bloqueio de reenvio e confirmação a cada escrita.

Execução revisada continua um fluxo distinto e identificado para requests salvas. Posicioná-la após o preenchimento, junto das ferramentas avançadas, mantendo `#structured-card` e seus controles. Preferir conservar seu details próprio, evitando outra camada de details sobre ele. Referências e origens, estado seguro para IA, geração cURL e permissão HTTP ficam em ferramentas avançadas com descrição breve.

Permitir HTTP continua exigindo opção explícita por request. Se houver opção avançada ativa, exibir indicação resumida no workspace. Nenhum recolhimento altera o valor do controle ou remove aviso de risco pertinente.

### Entender a resposta

Priorizar status e conteúdo recebido; colocar cabeçalhos em details secundário. Antes do envio, mostrar orientação curta sobre onde o resultado aparecerá. Ferramentas sem resultado continuam desabilitadas, com explicação suficiente.

Explicações de HTTP devem descrever a resposta da API, sem equiparar 2xx a testes aprovados, persistência concluída ou operação de negócio bem-sucedida. Preservar estados distintos para simulação, histórico, resposta real, erro de transporte, validação parcial e ausência de testes.

Preservar Pretty/Árvore/Raw, busca, cópia, exemplos, avisos de dados sensíveis e resultados de testes. Resultados e impedimentos não ficam escondidos apenas porque ferramentas de configuração foram recolhidas.

### Configurações e descoberta

Configurações continua em diálogo próprio, com acesso textual claro. Agrupar por assunto em seções nativas expansíveis: Aparência; Ambientes; Histórico e privacidade; Cofre; Backup e proteção dos dados. Manter todos os IDs, ações, consentimentos e diferenças local/público.

Retirar detalhes internos como nomes de funções de storage do texto principal do produto. Manter consequências compreensíveis: onde os dados ficam, quando são cifrados, limites do cofre, irreversibilidade e riscos do backup/restauração. Detalhes técnicos podem ir para ajuda expansível ou documentação.

Cada recurso secundário recebe uma frase que responde para que serve e quando usar. Não criar tour obrigatório, novo painel de telemetria, preferência persistida de modo iniciante ou novos timers.

## Contratos e segurança

- Preservar meta contrato v2, IDs únicos, `data-vortix-action`, `data-vortix-field`, `data-vortix-region` e relações de rótulo/controle.
- Preservar `.editor-column` e seus listeners de rascunho; mudanças de layout não podem invalidar ou salvar uma request por acidente.
- Preservar todos os controles `structured-*`, projeção privada, frescor, contextos, aprovação, execução única, cancelamento e `#structured-execute:disabled`.
- Não afrouxar `TESTE`, checkbox, confirmação manual, consentimentos de persistência, cofre, restrições HTTP ou proteções local/público.
- Manter foco alcançável por teclado e retorno ao gatilho em diálogos. Navegação explícita para destino recolhido precisa abri-lo antes de focar, sem transformar navegação em execução ou aprovação.
- Não mudar servidor, contratos persistidos, transporte, endpoints, armazenamento, limites de rede ou implementação do diagnóstico.

## Responsabilidades e sequência propostas

1. Maestro mantém esta spec, continuidade e critérios de aceite; revisa mudanças antes de declarar entrega.
2. Senku — UI iniciantes recebe a implementação mecânica após revisão do desenho: posse exclusiva de `wwwroot/index.html`, `wwwroot/style.css` e dos handlers de apresentação acordados em `wwwroot/app.js`. Não alterar `structured-ui.js` sem devolver achado ao Maestro e ampliar explicitamente a posse.
3. Um revisor visível independente recebe somente leitura sobre o diff. Testes de regressão ficam com um único escritor explicitamente atribuído antes de começar. Não reutilizar nomes de agentes inacessíveis como se estivessem conectados.
4. Primeiro entregar reorganização do formulário, ações e resposta; depois configurações e acabamento. Cada etapa deve continuar funcional. Sem extração ampla de scripts ou divisão global do CSS nesta entrega.

## Critérios de aceite e validação

- Nova request e request salva percorrem criar/abrir, preencher, enviar e inspecionar sem configuração obrigatória de recursos opcionais.
- URL base e rota têm rótulos e ordem compreensíveis; há uma ação principal clara por área e acesso textual às ferramentas recolhidas.
- Salvar sem coleção oferece continuação explícita e cancelável; falha de storage não perde rascunho.
- POST/PUT/PATCH/DELETE continuam bloqueados sem as confirmações; alterar request/ambiente invalida aprovação revisada. GET também preserva aprovação no fluxo revisado.
- Teclado funciona em abas, grupos expansíveis e diálogos; foco não vai para controles recolhidos. Recursos ativos não são desativados ao recolher.
- HTTP, entrega, testes, simulação, captura e persistência continuam distinguíveis. Sem dados sensíveis novos no DOM de diagnóstico ou screenshots.
- Testes atuais Node passam; acrescentar regressões úteis para novos comportamentos, usando os harnesses existentes. Não afrouxar testes de segurança para acomodar layout.
- Conferir temas Dracula/Papel, escala 120%, 1280×900 e 900×800: sem sobreposição/perda de controles; rolagem deliberada quando necessária. Conferência/otimização 390×844 retirada do aceite por instrução posterior do usuário; preservar correções já feitas.
- Smoke em instância isolada, com SQLite temporário e fixture loopback, pelo Portal Maestri. Nunca usar launcher/banco pessoal. Nenhuma API real.
- Revisar diff, sintaxe de scripts alterados e `git diff --check`. Build e suites PowerShell somente conforme impacto; não alegar validação que não ocorreu.

## Evidência desta preparação

Suíte Node completa reexecutada em 28/10: 403 testes, 402 aprovados, zero falhas, um skip `EPERM` de symlink, saída 0. `git diff --check` passou antes das alterações documentais. As 29 cópias do checkpoint conferiram com o manifesto SHA-256; ZIP de 689.302 bytes conferiu com o arquivo `.sha256` adjacente. Isso não é teste de restauração.

Na preparação, nenhum código de UI foi alterado. Build, suites PowerShell e inspeção visual não foram reexecutados naquela etapa. O usuário aprovou a hierarquia concreta com `sim`; prosseguir pela implementação e validação, sem nova aprovação intermediária para mudanças dentro do desenho.
