# Relatório de auditoria e hardening — CrisoApp

Data: 24/10/2026 · Escopo: `backend/` (Next.js 16 + Prisma 7 + PostgreSQL), `frontend/` (Vite/React), `vercel.json`, `railway.json`, migrations, scripts e docs.
Método: leitura de **todo** o código (54 rotas, 21 libs, schema, 5 migrations, frontend, configs), `npm audit`, busca por segredos/SQL inseguro/XSS, e execução das migrations + das queries alteradas num PostgreSQL 16 real.

## 0. Premissa que muda o prompt: este projeto não usa Supabase

O prompt fala em Supabase, RLS e `service_role`. O CrisoApp **não tem Supabase**: o navegador nunca fala com o banco. Todo acesso passa pela API Next.js (Prisma), que autentica pelo cookie e filtra por dono. Por isso:

| Item do prompt | Situação real |
|---|---|
| RLS / `auth.uid()` | Não se aplica. O equivalente é a autorização por rota (`api({ auth: [...] })` + `WHERE id = sessão`). Verifiquei rota por rota (seção 3). Ativar RLS agora exigiria reescrever o acesso ao banco: **não recomendado**. |
| `service_role` / chave admin no front | Busca em todo o repositório: **nenhuma ocorrência**. Front só chama `/api` relativo; nada de `NEXT_PUBLIC_`/`VITE_` com segredo (só `VITE_CONTATO_PRIVACIDADE`). |
| Segredos no código/ZIP | Nenhum (`.env` não está no ZIP; `.gitignore` cobre `.env*`, `*.pem`, dumps). Chaves vêm de variáveis de ambiente validadas por Zod. |
| SQL injection | Todas as queries brutas usam template tag parametrizado; nenhum `$queryRawUnsafe`. |
| XSS | Nenhum `dangerouslySetInnerHTML`/`innerHTML`; sem `localStorage`/`sessionStorage`; sessão em cookie HttpOnly + SameSite=Strict + `__Host-`. |
| Dependências | `npm audit`: 0 vulnerabilidades (backend e frontend). |

**Resultado geral: não encontrei nenhuma falha que permita a um usuário ler/alterar dados de outro, virar admin ou extrair segredo apenas pelo código.** Os problemas abaixo são de lógica financeira, defesa em profundidade, configuração de infraestrutura e decisões de negócio.

---

## 1. O que foi CORRIGIDO neste pacote (só código; sem tabela nova, sem mudar estrutura)

| # | Gravidade | Problema | Arquivos |
|---|---|---|---|
| C1 | 🟠 Alto | Estorno de resgate contava como "reciclagem": travava saldo estornado por 24 h e consumia o teto diário de reciclagens/créditos | `cliente/carteira`, `cliente/resgatar`, `qr/confirmar`, `admin/dashboard` |
| C2 | 🟡 Médio | Código TOTP podia ser reutilizado por até ~90 s (replay) | `lib/mfa-codigos.ts` |
| C3 | 🟡 Médio | Login, falha de login, falha de MFA, reset de senha e mudança de MFA não geravam auditoria | `auth/login`, `auth/reset-password`, `auth/mfa/confirm`, `auth/mfa/codigos` |
| C4 | 🟡 Médio | Cookie sem `__Host-` e tokens da `JWT_SECRET` antiga ainda eram aceitos em produção | `lib/auth.ts` |
| C5 | 🟡 Médio | Exclusão lógica de cliente deixava hash de senha, foto, segredo de MFA e códigos pendentes | `admin/usuarios/[id]` |
| C6 | 🟢 Baixo | Trocar o e-mail mantinha `email_verificado = true` para um e-mail nunca confirmado | `cliente/perfil` |
| C7 | 🟢 Baixo | `prisma.config.ts` aceita `MIGRATE_DATABASE_URL` (opcional, retrocompatível) para separar o papel do app do papel de migrations | `prisma.config.ts` |

### C1 — Estorno contado como reciclagem (reproduzido no PostgreSQL)
- **Local:** as 5 queries `WHERE tipo = 'credito'` sem filtrar `categoria`. O estorno de resgate cancelado (`admin/resgates/[id]`) grava `tipo=credito, categoria=resgate`.
- **Como explorar / efeito:** cliente com R$ 50 de saldo (R$ 40 estornados + R$ 10 reciclados hoje). Query original: carência = R$ 50,00 → disponível R$ 0. Query corrigida: carência = R$ 10,00 → disponível R$ 40. O estorno também somava nos tetos de 5 reciclagens/dia e `credito_cliente_dia`, e inflava `total_trocas`/`total_creditos` do painel admin.
- **Corrigido:** `AND categoria = 'reciclagem'::"TransacaoCat"` nessas queries. Regra de negócio: estorno devolve dinheiro que já estava disponível, então não entra em carência nem em teto de reciclagem. O limite de 10 débitos/dia **não** foi alterado.

### C2 — Replay de TOTP
- **Antes:** `verificarTotp` aceita a janela −30/0/+30 s; o mesmo código servia várias vezes.
- **Depois:** após validar, o código é "gasto" por 120 s usando o contador atômico que já existe (`rate_limits`) — **sem tabela nova**. Código errado não gasta nada. Se o contador falhar, o login **não** é liberado (falha fechada).
- **Efeito visível:** o admin que digitar duas vezes o mesmo código em < 2 min na segunda recebe "Código MFA incorreto ou já utilizado" e espera o próximo código.

### C3 — Auditoria
Novos eventos em `logs_auditoria`: `login_sucesso`, `login_falha` (só quando a conta existe, para ninguém inundar o log com e-mails aleatórios), `login_mfa_falha`, `senha_redefinida`, `mfa_ativado`, `mfa_codigos_visualizados`, `mfa_codigos_regenerados`. Para loja o id vai no texto (a coluna `id_cliente` é FK de `usuarios`). Nenhum dado pessoal no texto (`auditar` ainda mascara e-mail/telefone).

### C4 — Legados de sessão
- Em produção só vale `__Host-crisoverde_session` (o nome antigo pode ser plantado por um subdomínio — *cookie tossing*).
- Em produção, token assinado com `JWT_SECRET` (chave antiga para tudo) é recusado. Sessões duram 8 h; **na primeira vez após o deploy, quem tinha sessão aberta com a chave antiga precisa entrar de novo.** Depois do deploy, pode apagar `JWT_SECRET` do Railway.

### C5/C6 — veja a tabela acima. C5 não apaga transações nem auditoria.

### Testes
- `tests/unit/seguranca.test.ts` (9 testes, sem banco). **Rodados contra o código original: 4 falham** (replay de TOTP aceito, falha aberta do contador, cookie legado e JWT antigo aceitos em produção); **contra o código corrigido: 9/9 passam**. Suíte completa: 52/52.
- `tests/seguranca-acesso.mjs`: teste caixa-preta (anônimo, cliente A × B, escalada via mass-assignment, CSRF, JWT forjado `alg:none`, corpo > 10 KB, enumeração de e-mail). **Escrito e validado só na sintaxe — precisa de servidor + banco de teste no ar para rodar.**
- Limite da verificação: o sandbox não conseguiu baixar o motor do Prisma, então o `tsc` completo não roda aqui (109 erros idênticos antes e depois, todos por falta do client gerado: nenhum erro novo). Rode `npm run typecheck && npm test && npm run lint` no seu ambiente.

---

## 2. O que NÃO foi alterado e precisa de decisão ou de infraestrutura

### 🔴 CRÍTICO
Nenhum confirmado pelo código.

### 🟠 ALTO

**A1 — O backend do Railway fica acessível direto da internet e o limite por IP está desligado**
- **Local:** `vercel.json` (rewrite `/api` → `crisoapp-production.up.railway.app`), `proxy.ts` (`ORIGIN_SECRET`), `client-ip.ts` (`TRUSTED_PROXY=none`), `docs/DEPLOY_RAILWAY.md`.
- **Risco/impacto:** rewrite da Vercel não injeta o header `x-origin-secret`, então `ORIGIN_SECRET` não pode ser ativado; com `TRUSTED_PROXY=none` todo IP vira `"desconhecido"` e **todos os limites por IP são ignorados** (`deveAplicarLimiteIp`). Também ficam inoperantes `ip_divergente` e os alertas por IP do monitor de QR. Só restam os limites por e-mail/usuário (que, por sua vez, permitem travar a conta de alguém — A8).
- **Como corrigir (escolha uma):** (1) servir o front pelo próprio Railway (o build já suporta: `base: '/web/'` + `copy-frontend`) e usar `TRUSTED_PROXY=hops` com o nº de saltos **medido** num endpoint de teste; ou (2) pôr Cloudflare na frente do Railway com regra que adiciona `x-origin-secret` e `TRUSTED_PROXY=cloudflare`. Não coloquei nada disso no código para não derrubar o login em produção.

**A2 — Dados pessoais continuam gravados em claro ao lado da cópia cifrada**
- **Local:** `pii.ts` (`camposEmailUsuario`, `camposTelefoneUsuario`, `camposEnderecoLoja`…) grava `email`, `telefone`, `endereco`, `responsavel` **e** `*_enc`; `qr_codes.ip_gerado`, `logs_auditoria.ip`, `transacoes.nome_cliente` idem.
- **Impacto:** contra um dump/backup/leitura do banco, a cifragem hoje não protege nada — o texto claro está na coluna ao lado. É a fase "expand" da migração; a fase "contract" (parar de gravar o claro e depois esvaziar as colunas) ainda não aconteceu. `email` tem `UNIQUE` e `CHECK` em claro e é usado no login, então a troca é uma operação em etapas.
- **Como corrigir:** rodar `npm run db:encrypt` em cópia restaurada → validar contagens → mudar `pii.ts` para parar de gravar o claro (guardando um valor mascarado/sentinela) → esvaziar colunas legadas. **Proponho fazer em uma etapa própria, com backup, depois da sua aprovação.**

**A3 — Controle documentado que o código não aplica: resgate sem e-mail confirmado**
- **Local:** `RELATORIO_SEGURANCA_FASES.md` (V1/V7) diz que resgate/QR exigem e-mail confirmado; `cliente/resgatar` e `qr/confirmar` exigem só `perfilCompleto` (nome, e-mail com formato válido, celular) — **nunca** `emailVerificado`. O cadastro não confirma nada e o celular nunca é verificado.
- **Como explorar:** cadastrar-se com e-mail/celular de outra pessoa, acumular crédito e pedir resgate; o pagamento manual do admin usaria dados não provados. Também permite "ocupar" o e-mail de alguém antes dele.
- **Como corrigir:** exigir `emailVerificado` (e a tela de confirmação) em `resgatar` e `qr/confirmar`. **Não alterei:** o backend hoje não obriga ninguém a confirmar o e-mail, então a regra bloquearia resgate de todos os clientes atuais até confirmarem, e depende do Resend estar funcionando em produção. Me diga se quer ativar.

**A4 — (provável) o app conecta ao banco com o usuário dono/superusuário**
- **Local:** `db.ts` / `DATABASE_URL`; você criou as tabelas pelo console do Railway. Não consigo confirmar sem ver a URL.
- **Impacto:** qualquer falha futura (ou vazamento da URL) permite `DROP TABLE`/`ALTER`. Você me pediu "menor privilégio".
- **Como corrigir:** `docs/PROPOSTA_ENDURECIMENTO_BANCO.sql` seção A (papel `criso_app`, só DML; testado: `DROP`/`ALTER`/`TRUNCATE`/`CREATE` negados). Depois, `DATABASE_URL` = `criso_app` e `MIGRATE_DATABASE_URL` = dono (C7).

### 🟡 MÉDIO

| # | Problema / local | Impacto | Como corrigir |
|---|---|---|---|
| A5 | **QR de crédito não é preso a um cliente** (`qr/gerar` não recebe `id_cliente`; `qr/confirmar` aceita qualquer cliente logado). | Quem enxergar a tela da loja nos 60 s (ou fotografar) resgata os créditos no lugar do cliente. | Loja identifica o cliente (`/cliente/identificar` já existe) e `gerar` grava `id_cliente`; `confirmar` recusa se for outro. Muda o fluxo da loja: decisão sua. |
| A6 | **Busca de clientes pela loja** (`loja/clientes/buscar`): substring de nome (≥ 3 letras) devolve `id` + `nome` de clientes; e-mail exato confirma se existe cadastro. | Qualquer loja ativa pode varrer a base de nomes (15 buscas/15 min). | Deixar só e-mail exato + QR de identificação, ou ao menos devolver o primeiro nome. A tela "Registrar troca" usa isso: decisão sua. |
| A7 | **Logs de auditoria não são imutáveis** e `admin_alterou_*` grava só o valor novo. | Quem tem acesso ao banco/app reescreve o histórico; não dá para ver o "antes". | SQL seção D (trigger append-only; apaga só > 12 meses = o cron atual; testado) + registrar valor anterior em `taxas`/`limites`. |
| A8 | **Travar conta alheia:** `login-email` = 20 tentativas/15 min por e-mail, sem olhar o IP. | Qualquer pessoa mantém o admin (ou um cliente) impedido de entrar. | Contar só tentativas que falham e combinar conta+IP (precisa de IP confiável → A1) e/ou alertar o admin por e-mail. |
| A9 | **Cadastro do MFA do admin:** a sessão sem MFA alcança `mfa/setup`. | Quem descobrir a senha do admin antes do primeiro enrolamento cadastra o próprio autenticador. | Faça o 1º login e o cadastro do MFA logo após o `db:seed`; o aviso de login admin por e-mail já ajuda a perceber. |
| A10 | **Admin único, sem papéis.** Qualquer admin altera taxas/limites antifraude, cria lojas e reseta o MFA de outro admin só com a senha. | Um admin comprometido controla tudo. | Perfil "super-admin" para taxas/MFA, exigir TOTP recente (`sessaoAutenticadaRecentemente`) nessas ações. Muda o modelo: decisão sua. |
| A11 | **Banco sem constraints/índices:** contadores negativos, e-mail/telefone malformado, `email_hash` sem índice (todo login faz `WHERE email_hash = ? OR email = ?`). | Dado inválido e varredura de tabela conforme cresce. | SQL seções B e C (NOT VALID, não reprova dado antigo; testado). |
| A12 | **Exclusão de cliente com saldo/resgate pendente** não é tratada. | Saldo some silenciosamente; resgate pendente continua aprovável. | Bloquear a exclusão se `saldo > 0` ou houver resgate `pendente/aprovado`, ou cancelar/estornar antes. |
| A13 | **Códigos de recuperação do MFA são guardados de forma reversível** para "rever na tela". | Sessão + senha mostram todos os códigos. | Mostrar uma única vez, guardar só o hash. É escolha de usabilidade sua. |

### 🟢 BAIXO
- Rejeitar loja pendente faz `DELETE` físico (`admin/lojas/[id]/rejeitar`); o prompt pede exclusão lógica. Só há o log como rastro.
- `configuracoes/taxas` usa `.catch(padrão)`: valor inválido volta silenciosamente ao padrão em vez de dar erro 400.
- Retenção: o cron apaga logs > 12 meses e QR usados > 30 dias — confirme a política (financeiro/LGPD).
- `OTP_PEPPER` serve para 4 finalidades (hash do reset, da verificação, dos códigos de recuperação e assinatura do JWT de reset). Separe em chaves distintas na próxima rotação.
- `env.ts` ainda tem `MFA_ESCOPO` (default `admin_loja`) que **não é usada**; o código exige MFA só do admin. Remover para não confundir.
- Não há rota de autoexclusão/exportação dos dados pelo próprio cliente (LGPD). Loja não tem "esqueci a senha".
- Senha: mínimo 8, letras + números; sem checagem de senhas vazadas.
- `admin/qrcode/listar` mostra IP em claro, enquanto `auditoria` mostra "registrado". Padronize.

---

## 3. Matriz de endpoints (quem acessa / dono do dado / risco IDOR)

Todas as rotas passam por `api({ auth })`: sessão validada no banco a cada requisição (status, exclusão, `versao_sessao`), perfil conferido, corpo ≤ 10 KB, Zod, CSRF por Origin/Sec-Fetch-Site. Admin sem MFA só alcança `mfa/setup`, `mfa/confirm` e `logout`.

| Grupo | Perfil | Filtro de dono | IDOR / escalada |
|---|---|---|---|
| `cliente/*` (carteira, historico, perfil, resgatar, meu-qr) | cliente | `WHERE id = sessão` / `id_cliente = sessão`; nenhum aceita id do cliente | Não. Mass assignment barrado pelo Zod (campos extras descartados). |
| `qr/validar`, `qr/confirmar` | cliente | QR é *bearer* de 60 s; débito/crédito aplicado à **sessão**; trava `FOR UPDATE` no QR e no cliente | Não há IDOR; limite de adivinhação 10–20/15 min com 31⁸ combinações. Ver A5. |
| `qr/gerar`, `loja/*` | loja | `id_loja = sessão`; valor recalculado no servidor | Não. |
| `cliente/identificar`, `loja/clientes/buscar` | loja | QR selado AES-GCM 90 s / busca | Ver A6. |
| `admin/*` | admin (+MFA) | ids validados por `idParam`; só atua em `tipo=cliente`; admin não se bloqueia/reseta | Não. Ver A10. |
| `auth/*` | público (limitado) | respostas genéricas; hash falso p/ conta inexistente | Reset: código HMAC, 5 tentativas atômicas, token de 10 min preso ao código, uso único. |
| `cron/maintenance` | segredo `CRON_SECRET` (comparação em tempo constante) | — | — |

## 4. Migrations

Nenhuma migration nova foi colocada em `prisma/migrations` (o Railway aplica tudo que estiver lá a cada deploy). A proposta está em `docs/PROPOSTA_ENDURECIMENTO_BANCO.sql`, em 4 seções independentes (A papéis, B constraints, C índices, D log imutável), cada uma com "o que muda / por quê / impacto / DESFAZER". **Testei tudo no PostgreSQL 16:** aplicar, os comportamentos esperados (DDL negado, CHECKs recusando dado ruim, trigger bloqueando UPDATE/DELETE recente e liberando o DELETE de retenção) e o desfazer.
