# SEO básico e prévia social — Vortix

## Correção após retorno do usuário: thumbnail ausente no WhatsApp

Após o PR #36, o usuário mostrou título e descrição presentes, mas sem thumbnail. Requisições com user-agent `WhatsApp/2.24.0.0 A` e `facebookexternalhit/1.1` receberam HTTP 200 no HTML e no PNG, com MIME correto e sem redirects. O arquivo publicado tinha 1.312.784 bytes. Isso comprova entrega HTTP, não compatibilidade com a prévia do aplicativo; a validação anterior não cobria um orçamento de peso.

Hipótese desta correção: peso excessivo do asset. Exportada a mesma arte como JPEG baseline, qualidade 82, via encoder nativo disponível no Windows, sem nova geração visual, recorte, resize ou dependência. Original preservado. Novo arquivo `wwwroot/social/vortix-og-v2.jpg`: **1717×916, 87.884 bytes**, redução de **93,31%**. `og:image` e `twitter:image` usam a nova URL HTTPS; MIME declarado `image/jpeg`; dimensões, alt e identidade canonical preservados. A URL versionada evita reutilizar o endereço do PNG em caches de imagem, sem alterar canonical ou `og:url`.

Adotado orçamento conservador do projeto de **200 KiB**. Não declarar que esse é um limite oficial do WhatsApp: a documentação Meta consultada retornou HTTP 429 e fontes de terceiros divergem nos números. O ponto verificado é a redução do arquivo, não uma confirmação causal dentro do cliente.

Regressão RED/GREEN observada com head apontando ao PNG antigo e após a troca. Teste exige o JPEG, assinatura, dimensões reais via SOF coerentes com tags e tamanho dentro do orçamento. AIFriendlyUi 20/20, sintaxe e diff-check passaram. Confirmação visual no WhatsApp continua dependendo de novo teste pelo usuário; nenhuma mensagem ou configuração de privacidade foi manipulada pela automação.

Os registros abaixo preservam a primeira entrega do PNG e seus limites.

Data: 28/10/2026. Base: `master/000ef3401ccb87a7acda6877e058330b795869fd`; branch `feat/seo-social-preview`. Escopo: corrigir apresentação de links compartilhados e metadados básicos, sem redesenhar UI ou retomar mobile.

## Diagnóstico em produção

GET somente leitura da raiz pública, com user-agent `facebookexternalhit/1.1`: HTTP 200, zero tags `og:*`, nenhuma meta description e nenhum canonical. `robots.txt` e `sitemap.xml`: HTTP 404. Conferência pelo Portal Maestri confirmou título `Vortix — API Client`, ausência de OG e de JSON-LD renderizado. A captura fornecida pelo usuário mostra uma prévia simples do domínio; ela não mede indexação ou ranking.

## Correção

- Título: **Vortix — Cliente de APIs para criar e testar requisições**.
- Descrição: **Crie, organize e teste requisições HTTP no navegador. Use coleções, ambientes e testes de resposta no Vortix, sem criar conta.**
- Canonical e `og:url`: `https://vortixapiclient.jeffymesquita.dev/`, coerentes com `render.yaml`.
- Open Graph: website, site_name, locale `pt_BR`, título, descrição, imagem PNG, dimensões e alt. Twitter: `summary_large_image`, título, descrição, imagem e alt iguais aos OG.
- Card em `wwwroot/social/vortix-og-v1.png`, **1717×916**, **1.312.784 bytes**, fundo escuro e identidade Vortix. A dimensão pedida ao gerador era 1200×640; o PNG entregue tem outra dimensão, então as tags declaram os números reais. Sem redimensionamento posterior ou promessa de dimensões inexistentes.
- `robots.txt`: permite raiz, exclui `/api/` e `/oauth/` do rastreamento e referencia sitemap absoluto. Sitemap XML contém apenas a raiz canonical, sem data de modificação inventada.

Não foram adicionados analytics, keywords, avaliações, schema com dados inventados, dependências ou scripts de metadata. Requests, estado privado e credenciais não alimentam tags ou imagem. `robots.txt` orienta rastreamento; não substitui autorização ou controles de acesso do servidor.

## Validação e revisão

Suite final Node: **416 testes, 415 aprovados, zero falhas, um skip `EPERM` de symlink Windows**, saída 0, aproximadamente 5,02 s. `AIFriendlyUi.test.cjs`: 20/20 após tornar o PNG obrigatório; sintaxe e diff-check passaram. Os três testes novos cobrem unicidade/consistência de tags, host oficial/robots/sitemap e existência/assinatura/dimensões reais do PNG. RED inicial observado na ausência de metadata; revisão corrigiu um typo de host antes da publicação.

Instância isolada em loopback `54605`, SQLite temporário, terminal Shell visível Bulma — Runtime QA. GETs com user-agent de crawler:

| Recurso | HTTP | Content-Type |
| --- | --- | --- |
| `/` | 200 | `text/html` |
| `/robots.txt` | 200 | `text/plain` |
| `/sitemap.xml` | 200 | `text/xml` |
| `/social/vortix-og-v1.png` | 200 | `image/png` |

HTML servido contém 11 tags OG; canonical, og:image e XML conferem com a origem pública correta. O conteúdo é estático no head, disponível sem executar JavaScript. Não houve operação de API nem acesso a banco pessoal.

Implementação mecânica em terminal visível Senku — UI iniciantes; imagem e integração pelo Maestro. Revisão independente em terminal visível Hange — Revisão UI: nenhum bloqueante; domínio, HTTPS, coerência, PNG e preservação de scripts/bridge conferidos. [Índice de sessões existente](../../operations/2026-10-28-delivery-sessions.md): mesmos terminais, sem criar outros agentes.

## Fontes e limites

Open Graph e propriedades de imagem conferidos na [especificação oficial](https://ogp.me/). A inspeção trata metadata/compartilhamento, não uma auditoria completa de SEO. Não foram medidos tráfego, posições, indexação ou Core Web Vitals; não foi configurado Search Console.

Teste local não comprova prévia real no WhatsApp/Facebook/X. Após publicar, conferir novamente HTML e PNG na origem pública; aplicativos podem manter prévias anteriores em cache. Nenhuma mensagem foi enviada por conta do usuário para testar compartilhamento.

## Asset e prompt final

Modo: ferramenta interna `image_gen`, sem API key ou CLI alternativa. Arquivo selecionado copiado para `wwwroot/social/vortix-og-v1.png`; original preservado em generated_images. Conteúdo visual e grafia inspecionados pelo Maestro. Prompt usado:

```text
Use case: ads-marketing. Asset type: Open Graph social-sharing image for the real developer tool Vortix, meant to be committed as a production website asset. Create ONE finished landscape PNG, exactly 1200 x 640 pixels. Sophisticated restrained developer-tool brand card, highly legible as a small WhatsApp link preview. Flat dark charcoal/navy background #15191f with very subtle faint grid/network lines on the right, generous whitespace, no mock browser or phone, no screenshot, no gradients dominating the image, no stock art. Palette: mint #82d9bd, small warm orange #ffad66 accent, warm off-white text. On left around x90 y110 a large simple brand mark: thin mint monoline V, its left and right tips extend outward horizontally; a small mint circle at left outer endpoint, small orange circle at right outer endpoint, mint circle at bottom vertex. Match this simple existing mark concept rather than a swirl/vortex. Exact title text very large and bold near left center: "Vortix". Exact subtitle below title on one readable line: "Cliente de APIs no navegador". A smaller supporting line below it with exact Portuguese accents and typography: "Crie, envie e entenda suas requisições.". Typography: refined sturdy modern monospace, inspired by Fira Code, generous tracking and strong contrast, perfect spelling. Right third: a quiet abstract cluster of three rounded outline rectangles connected by a thin mint path with small nodes, evoking request and response, no fake controls, no extra words or code. Keep all important copy and the complete logo in central safe area with at least 80px margins; content should survive a modest center crop to 1.91:1. Do not add URL, personal name, watermark, third-party logo, fake statistics, pricing, security promises, or any text other than the three exact strings. Professional minimal graphic, crisp edges, polished spacing.
```
