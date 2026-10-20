# Política de segurança

## Versões com suporte

Correções de segurança são aplicadas à versão mais recente da branch `master`. Esta política não promete suporte para cópias antigas ou forks.

## Como relatar uma vulnerabilidade

Não publique vulnerabilidades, provas de conceito exploráveis, tokens ou dados de usuários em issues, discussões, pull requests ou capturas públicas.

Use **Security → Report a vulnerability** na página do repositório para abrir um aviso privado. Se essa opção não estiver disponível, abra uma issue pública mínima informando apenas que precisa de um canal privado de segurança; não inclua detalhes técnicos até que os mantenedores indiquem um canal adequado.

Inclua no relato privado: versão/commit afetado, impacto, passos de reprodução seguros e uma sugestão de correção, se houver. Use somente dados e serviços fictícios ou sob sua autorização.

## Escopo

Relatos relevantes incluem exposição de dados ou segredos, quebra do isolamento entre workspaces, bypass de autenticação, execução de código e falhas no proxy que permitam atingir redes ou serviços não públicos.

O Vortix é um cliente de API e encaminha requests para serviços configurados pelo próprio usuário. Uma API de destino retornar erro, permitir uma operação destrutiva configurada pelo usuário ou exigir autenticação não é, por si só, uma vulnerabilidade do Vortix.

## Práticas para quem contribui

- Nunca inclua segredos, cookies, bancos locais ou dados reais em mudanças e testes.
- Use mocks de loopback e credenciais fictícias nos testes.
- Não tente acessar sistemas, contas ou redes sem autorização.
- Mantenha detalhes de uma vulnerabilidade privada até a correção e a divulgação coordenada.
