# Nova fase — dashboard, reciclagem por QR, loja de recompensas e impacto ambiental

Escopo: evolução do que já existia, sem trocar stack, autenticação, sessões, MFA, CSRF/CSP, rate limit ou o livro-razão (`transacoes` + `usuarios.saldo`).

## O que o sistema já tinha e foi reaproveitado
- Saldo e histórico: `usuarios.saldo` + `transacoes`. Continuam sendo a única fonte (não há segundo sistema financeiro).
- QR Code: a LOJA gera (`/qr/gerar`), o CLIENTE valida e confirma (`/qr/validar`, `/qr/confirmar`). Não há aprovação manual nem status "recusado/cancelado" no fluxo; nada disso foi inventado.
- Carência (`limites_antifraude.carencia_horas`), tetos diários, auditoria (`auditar`), `api()` com auth/validação/rate limit.
- Resgate em dinheiro (PIX) continua exatamente como era (`/cliente/resgatar`, `/admin/resgates`).

## Funcionalidades
| Área | Rotas novas | Observações |
|---|---|---|
| Dashboard do aluno | `GET /api/cliente/dashboard` | Saldo (mesma função de `/cliente/carteira`), kg, operações, 5 últimas movimentações com status, meta mensal, recompensas alcançáveis. Sem campanhas (não existem no modelo). |
| Reciclagem / QR | `GET /api/cliente/reciclagens`; `/qr/validar` e `/qr/confirmar` ganharam campos | Materiais por tipo, kg estimado, carência, referência do QR. Campos antigos preservados. `GET /cliente/historico` ganhou `tipo_operacao`, `status`, `origem`, `referencia_qr`. |
| Loja de recompensas | `GET /cliente/recompensas`, `GET /cliente/recompensas/meus`, `POST /cliente/recompensas/{id}/resgatar`; admin: `/admin/recompensas`, `/admin/recompensas/{id}`, `/admin/resgates-recompensa`, `/admin/resgates-recompensa/{id}`; loja: `/loja/recompensas/consultar`, `/loja/recompensas/utilizar` | Débito no livro-razão existente (`forma='recompensa'`), voucher com código, uso único, estorno pelo admin. |
| Impacto ambiental | `GET /api/admin/impacto`, `GET/POST /api/admin/configuracoes/metas` | Só admin. Agregações no PostgreSQL. Sem dados pessoais. |

## Banco (migração aditiva `20261028000000_nova_fase_recompensas_reciclagem`)
- `transacoes.id_qr_transacao` (nullable, UNIQUE): um QR nunca gera duas transações. Linhas antigas ficam NULL.
- Tabelas `recompensas` e `resgates_recompensa` (+ enum). Nada existente foi removido/alterado.
- Índice parcial para consultas de reciclagem por data.
Aplicar com `npm run db:migrate:deploy` (não destrutiva). Faça backup antes, como em qualquer deploy.

## Regras de integridade do resgate
1. Conta do aluno travada (`FOR UPDATE`) → resgates simultâneos do mesmo aluno são serializados.
2. Chave de idempotência por tentativa (`UNIQUE(id_cliente, chave)`): duplo clique/retry devolve o mesmo voucher, sem novo débito.
3. Recompensa travada (`FOR UPDATE`): preço, estoque, validade e limite por aluno vêm do banco; o navegador só envia a chave.
4. Usa o saldo **disponível** (exclui créditos de reciclagem em carência), como o resgate em dinheiro.
5. `UPDATE ... WHERE saldo >= custo` e `estoque > 0` na própria instrução.
6. Tudo numa transação; auditoria (`recompensa_resgatada`) dentro dela.
7. Voucher vencido não é reembolsado automaticamente (decisão a confirmar pela administração).

## Painel de impacto — o que conta
Somente crédito de categoria `reciclagem` (confirmado pelo cliente). Estornos/resgates não entram. QRs expirados/invalidados nunca viram transação.
O **peso (kg)** é estimado pela regra da plataforma (0,05 kg/unidade, qualquer material), não é pesagem. Nenhuma emissão de CO₂ é calculada no painel novo, pois não há metodologia documentada. Turma e campanha não existem no modelo de dados, então não há filtro por elas; "ponto de coleta" = loja.

## Meta mensal
`configuracoes.meta_reciclagem_mensal_kg` (admin altera no painel de impacto). Se nunca configurada, vale 5 kg por aluno/mês.

## Testes
- `npm test` — unitários (inclui `tests/unit/nova-fase.test.ts`).
- `npm run test:integration` — `tests/nova-fase.mjs`: HTTP real + PostgreSQL real (autorização, concorrência, idempotência, consistência saldo × razão, filtros do painel). Precisa do app rodando em `BASE` (padrão `http://localhost:3200`) e `COOKIE_NAME=__Host-crisoverde_session` quando o app roda em produção.
