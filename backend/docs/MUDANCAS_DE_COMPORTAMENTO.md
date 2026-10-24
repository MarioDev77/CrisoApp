# Mudanças de comportamento em relação ao Express/MySQL original

Todas são intencionais (correção de falhas encontradas na auditoria). **Confirme as marcadas com ⚠️**, pois envolvem regra de negócio.

| # | Mudança | Motivo |
|---|---|---|
| 1 | ⚠️ QR de crédito: padrão máximo de **200 unidades por material** (`QR_MAX_UNIDADES_POR_MATERIAL`; teto configurável até 100.000) | Antes não havia teto: uma loja gerou QR de 7.000.000 unidades e o cliente recebeu R$ 250.001,25 |
| 2 | ⚠️ Confirmar crédito com mais de 200 kg agora **bloqueia** (antes só registrava log) | Anti-fraude (com o teto acima, 4 materiais × 1000 × 0,05 kg = 200 kg) |
| 3 | ⚠️ QR de crédito que resulta em 0 moedas é recusado | Antes gerava QR sem valor |
| 4 | ⚠️ "Dia" dos limites diários (5 créditos / 10 débitos) usa o fuso `APP_TIMEZONE` (padrão America/Sao_Paulo) | Antes usava o fuso do servidor (UTC no Railway) |
| 5 | Sessão validada no banco a cada requisição (status, exclusão, versão) | Bloquear/excluir/trocar senha/logout passam a valer na hora (antes: até 8 h) |
| 6 | Loja `pendente` não consegue logar | Antes conseguia |
| 7 | Admin só bloqueia/exclui **clientes** (não admins nem a si mesmo) | Evita lock-out |
| 8 | E-mails normalizados em minúsculas com CHECK no banco | PostgreSQL diferencia maiúsculas; MySQL não |
| 9 | Sem escape de HTML na gravação (React escapa na exibição) | O escape duplo gravava `O&amp;#x27;Neil` |
| 10 | Token em cookie HttpOnly + SameSite=Strict; `Authorization: Bearer` só com `LEGACY_BEARER=true` | Reduz impacto de XSS |
| 11 | Prefixo secreto do admin removido | Segurança por obscuridade; o padrão estava público no repositório |
| 12 | Paginação/limites em históricos; `dias`, `mes`, IDs validados (400 em vez de 500) | Abuso de recursos e erros 500 |
| 13 | Resgate de saldo corrigido (estava quebrado no original: `import()` em CommonJS) | Bug do projeto original |
| 14 | bcrypt custo 12 em todos os cadastros | O original usava 10 no cadastro |
| 15 | Rate limits por IP (login, cadastro, reset…) além de IP+e-mail | Credential stuffing |
| 16 | Redefinir senha revoga todas as sessões | Segurança |
| 17 | Recuperação de senha segue **somente para clientes** (como no original) | Lojas continuam sem recuperação: pendência |
| 18 | Confirmação de e-mail obrigatória para confirmar QR e pedir resgate | Reduz fraude; exige entrega funcional de e-mail |
| 19 | MFA obrigatório antes das rotas administrativas | Primeiro acesso precisa provisionar autenticador e guardar códigos de recuperação |
| 20 | Resgate exige sessão autenticada nos últimos 5 minutos e tem teto de R$ 100/dia | Protege operações financeiras; pode exigir novo login |
| 21 | Crédito limita R$ 300 por loja/dia e R$ 150 por cliente/dia; crédito fica em carência por 24 h | Tetos definidos com o usuário; prazos e cancelamentos precisam de homologação |
| 22 | Resposta de resgate inclui `status` e `id_resgate` | Mudança intencional do contrato deste endpoint para representar aprovação/pagamento/cancelamento |
