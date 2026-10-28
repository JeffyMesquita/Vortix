# Entrega de 28/10/2026 — rastreabilidade de sessões

Escopo: diagnóstico compacto e reorganização desktop. O usuário autorizou commit, PR e merge e pediu registro dos IDs para futuras retomadas. Este documento é um índice operacional; IDs não substituem instruções, autorização nem evidência de execução. Não contém tokens ou arquivos de autenticação.

## IDs confirmados

| Terminal/papel | Runtime observado ou informado | Sessão | Terminal Maestri | Fonte e limite |
| --- | --- | --- | --- | --- |
| Lelouch — Maestro | GPT-6.1 Sol, `medium`, Codex CLI | `01a1825e-32de-7690-bfe7-ab4d74878a95` | `46bfb2c1-98c8-472f-9ea4-bf55d45bdd4f` | `CODEX_THREAD_ID`/`MAESTRI_TERMINAL_ID` do processo atual; modelo/esforço observados na tela. |
| Senku — UI iniciantes | `opencode-go/deepseek-v4.1-flash`, metadata informada pelo runtime | Não exposta diretamente pelo terminal; candidata abaixo | `4b2da632-2bae-49c0-95da-e39d8a9eb65d` | Relato do próprio agente a partir de `maestri debug`; sessão não vem de uma variável nativa. |
| Hange — Revisão UI, peer final | `opencode-go/deepseek-v4.1-flash`, OpenCode 1.19.5 | Não exposta diretamente pelo terminal; candidata abaixo | `dde905e3-ff6d-49b8-bcc8-d6a40db7a3da` | Relato do agente a partir de `maestri debug`; `OPENCODE_PID` é PID, não ID de sessão. |
| Hange — revisão Luna anterior | GPT-6 Luna `xhigh`, Codex CLI | Não confirmado | Mesmo nó Maestri, substituído em processo | Sessão terminou por quota; não confundir o nome de papel `luna_reviewer` com um ID. |
| Bulma — Runtime QA | Shell, sem sessão de IA | Não se aplica | `d3bc443e-3def-4acb-80eb-3edabed942c3` | Saída de `maestri debug` executado no próprio terminal visível. |
| Chopper — Fixture QA | Shell, sem sessão de IA | Não se aplica | `8182fe73-8970-4bd8-b5aa-b42ab29c3c3a` | Saída de `maestri debug` executado no próprio terminal visível. |
| Erwin — Head, histórico | Comando de retomada Codex observado | `01a1820e-d14b-72f1-bb9e-1ece9a8c0ae8` | Não confirmado nesta consulta | `maestri check` mostrou `codex resume` com esse ID; processo antigo encerrado. Não é o Maestro atual. |

Kakashi, Sakura e Shikamaru participaram do diagnóstico anterior. Foram listados sob Erwin, mas não estavam diretamente acessíveis ao Maestro desta rodada. Seus IDs não foram confirmados; não deduzir a associação a partir de nomes ou memórias de outras sessões.

## Sessões OpenCode encontradas no projeto

Consulta somente de metadados: `opencode --pure session list --format json -n 30`, com filtro exato de diretório Vortix antes de exibir os resultados. Os IDs e títulos abaixo existem na listagem local; a associação ao terminal é uma **candidata por título/escopo**, não vínculo atestado pelo terminal.

| Candidata | ID OpenCode | Título da listagem |
| --- | --- | --- |
| Senku | `ses_e7d955789ffe21eFIqMEsL8i0a` | Análise read-only da UI para iniciantes |
| Hange, peer DeepSeek | `ses_e7cb636cbffeZViF7U1GNtviEE` | Revisão somente leitura da UI iniciante do Vortix |

Para retomar, primeiro confirme o título, diretório e instruções atuais na ferramenta nativa. ID de terminal Maestri, sessão OpenCode, sessão Codex, PID e ID de chamada de ferramenta são identificadores diferentes. Recriar/substituir um processo pode manter o nó Maestri sem preservar a sessão do provider. Não copiar auth entre homes nem assumir que IDs de Codex são retomáveis em outra conta/home.

## Evidências e limites

- [Continuidade](../continuity.md), [validação desktop](../superpowers/validation/2026-10-28-beginner-ui.md) e [diagnóstico compacto](../superpowers/validation/2026-10-27-compact-diagnostics.md).
- Baseline local de comparação da UI: `Vortix-checkpoints/2026-10-28-beginner-ui-baseline-092234`, pasta irmã do repositório. Não é fonte de código para sobrescrever o checkout.
- Serviços de QA encerrados e portas conferidas; somente fixture loopback e dados fictícios foram usados. Mobile foi dispensado expressamente pelo usuário.
- Registro preparado na branch `feat/beginner-ui-compact-diagnostics`. O PR e os runs de CI são a fonte do resultado da publicação; a autorização de merge não inclui operações de API ou mudança de credenciais.
