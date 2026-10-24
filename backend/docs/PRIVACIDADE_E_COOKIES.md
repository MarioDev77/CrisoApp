# Privacidade e cookies

## Implementação na interface

- Banner com escolhas para configurar, rejeitar cookies opcionais e aceitar preferências opcionais.
- Preferências são guardadas no cookie cv_cookie_consent por até 180 dias (SameSite=Lax e Secure quando HTTPS).
- A sessão de autenticação continua no cookie crisoverde_session, criada pelo backend como HttpOnly e SameSite=Strict; a UI não lê nem armazena a sessão.
- Cookies essenciais continuam ativos. O código atual não inclui analytics nem marketing; aceitar essas categorias registra a preferência, mas não liga integrações inexistentes.
- As preferências podem ser abertas em qualquer tela e também na página /privacidade.

## Informações de política

A página /privacidade descreve os dados e as finalidades técnicas observáveis no código, sem alegar fornecedores ou bases legais não confirmados. Antes da publicação final, preencher e revisar:

- nome/razão social, CNPJ, endereço e contato de privacidade;
- bases legais por finalidade;
- fornecedores ativos, compartilhamentos e transferências internacionais;
- prazos de retenção, backups e processo de eliminação;
- processo de atendimento dos direitos dos titulares e responsável pela revisão jurídica.

A página está acessível, mas os campos marcados [PREENCHER] significam que a política ainda requer aprovação do controlador e revisão jurídica.
