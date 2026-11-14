# CrisoApp — Segunda auditoria e hardening (Etapas 1–3): relatório técnico e plano de implantação

Data: 14/11/2026. Escopo: cookies/consentimento, rate limit/IP, QR, e-mail, MFA, auditoria, banco, APIs. Nenhum deploy, migration ou dado real foi usado: tudo foi executado num PostgreSQL 16 descartável com as migrations reais.

## 1. Resumo executivo

Nenhuma vulnerabilidade **CRÍTICA** foi encontrada. Havia dois problemas **ALTOS** comprovados no login (terceiro bloqueando a conta alheia; login correto contado como falha), ambos corrigidos. O gerenciamento de cookies virou consentimento granular real e o app deixou de contatar o Google Fonts antes de qualquer escolha. O rate limit passou a ter o PostgreSQL como única fonte de verdade. A arquitetura, o design e as regras financeiras foram preservados.

**Três pontos que dependem de você** (não dá para resolver só com código): (1) o IP real do usuário **não chega com segurança** ao backend atrás do rewrite da Vercel; (2) duas proteções novas ficam **desligadas por padrão** até você ativar (QR preso ao cliente e e-mail verificado obrigatório); (3) o endurecimento do banco está **testado, mas não aplicado**.

## 2. Situação anterior (comprovada no código)

- Cookies: um botão "Entendi", estrutura `v: 2`, sem escolha real; `index.html` contatava `fonts.googleapis.com`/`fonts.gstatic.com` a cada abertura.
- `TRUSTED_PROXY=none` (padrão) → IP `"desconhecido"` → limites por IP ignorados; o limite `ip+email` virava um balde por e-mail para o mundo todo; todo login (inclusive o correto) gastava o limite; `Map` em memória divergia do contador do PostgreSQL.
- QR de crédito aceito por qualquer cliente logado; confirmação de e-mail **documentada como obrigatória, mas inexistente** nas rotas e **sem tela** no frontend.
- Auditoria administrativa gravava só o valor novo, e a de resgate era gravada **depois** da transação.

## 3–4. Vulnerabilidades e gravidade

| # | Gravidade | Tipo | Problema | Situação |
|---|---|---|---|---|
| 1 | ALTO | comprovada | Terceiro bloqueia a conta de outra pessoa só conhecendo o e-mail (balde global por e-mail) | **corrigido** |
| 2 | ALTO | comprovada | Login correto contava como falha | **corrigido** |
| 3 | MÉDIO | comprovada | Google Fonts contatado sem consentimento (IP do visitante ao Google) | **corrigido** (fonte local) |
| 4 | MÉDIO | comprovada | "Consentimento" sem escolha real | **corrigido** |
| 5 | MÉDIO | comprovada | Contador em memória divergente do banco (bloqueios indevidos) | **corrigido** |
| 6 | MÉDIO | comprovada | Proteção por IP desligada em silêncio | **corrigido** (balde global + alerta) |
| 7 | MÉDIO | comprovada | QR de crédito não preso ao cliente (A5 da auditoria anterior) | **corrigido, mas opt-in** até ligar a chave |
| 8 | MÉDIO | comprovada | Exigência de e-mail confirmado só na documentação | **tela + chave criadas; ativação pendente** |
| 9 | MÉDIO | comprovada | Auditoria do resgate fora da transação (mudança financeira sem registro se o processo cair) | **corrigido** |
| 10 | MÉDIO | condicional | 1º cadastro do MFA do admin com sessão de só senha: quem tem a senha cadastra o próprio autenticador | **mitigado** (ver 6); resíduo em 10 |
| 11 | MÉDIO | condicional | IP real do visitante indisponível atrás do rewrite Vercel→Railway | **não corrigível só com código**; mitigado sem depender de IP |
| 12 | BAIXO | comprovada | CSP liberava `accounts.google.com` com o login Google desativado | **corrigido** (backend e `vercel.json`) |
| 13 | BAIXO | comprovada | Recuperação de senha: bombardeio de e-mails / limite por e-mail usável para travar a vítima | **corrigido** |
| 14 | BAIXO | comprovada | Falhas em `mfa/codigos` sem auditoria; auditoria de configuração só com valor novo | **corrigido** |
| 15 | BAIXO | comprovada | App com privilégios amplos no banco; `DELETE` físico possível no histórico financeiro | **proposta A–E testada; aplicação pendente** |
| 16 | INFORMATIVO | recomendação | `cadastro` responde diferente para e-mail já existente (enumeração) | não alterado |
| 17 | INFORMATIVO | recomendação | Códigos de recuperação do MFA são guardados de forma reversível (permite "ver códigos") | não alterado (removeria função) |
| 18 | INFORMATIVO | recomendação | Reset de MFA por admin não avisa o dono da conta | não alterado |
| 19 | INFORMATIVO | recomendação | `loja/clientes/buscar` por trecho do nome (A6 anterior) | não alterado: decisão sua |
| 20 | INFORMATIVO | fato | `jspdf` contém a URL `cdnjs` (inativa; a CSP bloqueia); 8 "moderate" só em devDependencies de lint | sem ação |
| 21 | INFORMATIVO | fato | Dados pessoais ainda convivem em claro e cifrado (dupla escrita) | plano em `PLANO_MIGRACAO_PII.md` |

## 5. Arquivos modificados

**Etapa 1 (cookies):** `frontend/src/consent.ts` (novo), `App.tsx`, `styles.css`, `main.tsx`, `index.html`, `vercel.json`, `package.json`/lock, `vitest.config.ts`, `tests/*`, `backend/docs/PRIVACIDADE_E_COOKIES.md`.
**Etapa 2 (rate limit/IP):** `backend/src/lib/{client-ip,rate-limit,dispositivo,login-protecao,api,env}.ts`, rotas `auth/{login,forgot-password,verify-reset-code}`, `api/diagnostico/ip` (novo), testes, `docs/RATE_LIMIT_E_IP.md`.
**Etapa 3:** `qr/{gerar,validar,confirmar}`, `cliente/{resgatar,perfil}`, `cliente/recompensas/[id]/resgatar`, `auth/mfa/{setup,confirm,codigos}`, `lib/{qr-vinculo,auditoria-admin,perfil,email,mfa-codigos,env}.ts`, 6 rotas admin (config, status, recompensa, resgate), `proxy.ts`, `frontend/src/App.tsx` (painel de e-mail, `id_cliente`), `vercel.json`, docs e SQL.

## 6. Correções implementadas (Etapa 3)

- **QR preso ao cliente:** `qr/gerar` aceita `id_cliente` (a tela "Registrar troca" já mostrava o cliente identificado e agora o envia). `validar` e **`confirmar` revalidam o vínculo** (no `confirmar`, dentro da transação com o QR travado `FOR UPDATE`). Outro cliente recebe 403 e fica o rastro `qr_outro_cliente`. QR sem vínculo continua valendo; `QR_CREDITO_EXIGE_CLIENTE=true` torna a identificação obrigatória.
- **E-mail:** rotas reais confirmadas (`/api/auth/verificar-email/solicitar|confirmar`); criado o painel "Confirmar e-mail" no perfil. Confirmar QR, resgatar e resgatar recompensa exigem e-mail confirmado **só com `EXIGIR_EMAIL_VERIFICADO=true`**. Trocar o e-mail volta a marcá-lo como não confirmado.
- **MFA:** o segredo pendente expira em 15 min; iniciar e ativar ficam no log e **avisam o admin por e-mail**; ativar **encerra todas as outras sessões** da conta; falhas em `mfa/codigos` são auditadas.
- **Auditoria admin:** `antes → depois` só dos campos alterados, **na mesma transação** (taxas, limites antifraude, config do QR, meta, edição de recompensa, bloquear/desbloquear, status do resgate).
- **Banco:** seção E (sem `DELETE` físico em histórico financeiro) somada a A–D, todas executadas e verificadas (ver 9).
- **APIs:** CSRF por Origin/Sec-Fetch-Site + `SameSite=Strict` verificados; não há CORS (só mesma origem); CSP agora só cita o Google quando o login Google está ativo.

## 7. Cookies — melhorias

Banner com as três ações com o mesmo peso; modal por categoria (finalidade, tecnologias, prazo); cookie `cv_cookie_consent` versionado (180 dias, `Path=/`, `SameSite=Lax`, `Secure`, sem `Domain`); revogação remove script e cookies próprios (sem afirmar apagar os do Google); categorias sem integração real aparecem como "Não utilizado"; política `/privacidade` 3.0 com cookies reais. Cookie novo `__Host-crisoverde_dispositivo` (necessário, segurança) documentado.

## 8. Rate limit — melhorias

PostgreSQL como fonte única (incremento atômico, relógio do banco, chave HMAC); falha de login só conta quando é falha real; contenção por conta progressiva (15 min→4 h) com cookie de dispositivo para o dono; modos de IP explícitos (`none|railway|vercel|cloudflare|hops`) com `ORIGIN_SECRET` timing-safe, IPv6 por /64 e alerta `ip_nao_identificado`; endpoint de diagnóstico protegido.

## 9. Testes executados e resultados

| Verificação | Resultado |
|---|---|
| Backend `tsc --noEmit` | **0 erros** (com o client do Prisma gerado) |
| Backend `eslint` | sem avisos |
| Backend `next build --webpack` | passou (achou e corrigiu 1 erro: rota exportando constante) |
| Backend testes **com** PostgreSQL | **126/126** |
| Backend testes **sem** banco (`npm test` comum) | 82 passam, 44 pulados (precisam de `TEST_DATABASE_URL`) |
| Backend testes **como papel `criso_app`** (menor privilégio + triggers A–E ativos) | **126/126** |
| Frontend `tsc`, build, testes | limpo; build ok; **32/32** |
| `npm audit` | produção: **0** (backend e frontend); 8 "moderate" só em devDependencies de lint, idênticas às do zip original |

O que foi provado com **rotas reais e banco real**: 401/403, IDOR, mass assignment, injeção de SQL em e-mail/token (nunca 500), CSRF, login sob ataque (8 erros bloqueiam só o IP atacante; vítima em outro IP entra; muitos IPs → contenção e o dono com cookie entra), 5 confirmações paralelas do mesmo QR creditam **uma vez**, outro cliente não consome o QR, valor sempre recalculado no servidor, e-mail verificado ligado/desligado, auditoria antes→depois e fluxo completo do MFA (ativar derruba a sessão "invasora"). Nos limites: 300 chamadas paralelas em 3 conexões → exatamente o máximo passa; expiração; 429 com `Retry-After`; cabeçalhos forjados não escapam.
**Prova de mutação:** quebrei de propósito o vínculo do QR (`confirmar` e `validar`), a invalidação de sessão do MFA, o antes/depois, o `ORIGIN_SECRET`, o estorno no login e um contador não atômico: os testes reprovaram em todos.
**Banco (executado num banco descartável com o schema real):** como `criso_app`, `DROP`, `CREATE`, `TRUNCATE`, `DELETE` em `transacoes`/`usuarios`, `UPDATE` e `DELETE` de log recente e `DROP TRIGGER` foram **bloqueados**; `UPDATE`, `INSERT` em log, upsert em `rate_limits` e a retenção de logs > 12 meses continuaram **permitidos**. Não testado: leitura de `_prisma_migrations` (a tabela não existe nesse banco, pois apliquei o SQL direto).

**Não executado / limites honestos:** navegador real (layout do banner e do painel de e-mail não foram vistos); envio real de e-mail (Resend não configurado); comportamento real da Vercel/Railway (só a documentação e o diagnóstico); "múltiplas instâncias" simulado com conexões independentes, não processos separados.

## 10. Pendentes

1. **IP real atrás da Vercel** (item 11): rodar o diagnóstico; decidir entre servir o front pelo Railway (`TRUSTED_PROXY=railway`) ou validar `ORIGIN_SECRET` via `routes`+`transforms` num preview (não testado com os seus `rewrites`/CSP).
2. Ativar `QR_CREDITO_EXIGE_CLIENTE` e `EXIGIR_EMAIL_VERIFICADO` (plano abaixo).
3. Aplicar o SQL A–E (primeiro numa cópia).
4. Passo adicional no 1º cadastro do MFA do admin (**código enviado ao e-mail**): exige tela nova; não implementei por não alterar o frontend sem necessidade. Hoje: expiração, aviso por e-mail, auditoria e queda das outras sessões.
5. Fase 4 da migração de dados pessoais (mudança de schema: precisa da sua aprovação).
6. Itens informativos 16–19.

## 11. Configuração na Vercel e no Railway

**Railway (backend):** `TRUSTED_PROXY=none` até o diagnóstico; `ALLOWED_ORIGINS=https://<seu-dominio-vercel>` (o CSRF compara `Origin` com o `Host`, que atrás do rewrite é o do Railway); `GOOGLE_LOGIN_ATIVO=false`; `QR_CREDITO_EXIGE_CLIENTE=false`; `EXIGIR_EMAIL_VERIFICADO=false`; `CRON_SECRET`, `DATA_ENCRYPTION_KEYS`, `BLIND_INDEX_KEY` e `RESEND_*` conferidos; **alertas de log** para `ip_nao_identificado` (erro) e `conta_sob_ataque` (aviso). Depois do SQL: `DATABASE_URL` com o papel `criso_app` e `MIGRATE_DATABASE_URL` com o dono.
**Vercel (frontend):** `VITE_CONTATO_PRIVACIDADE` (canal de privacidade exibido na política); `vercel.json` já traz a CSP sem Google nem Google Fonts; os `rewrites` não foram alterados. O build agora instala `vitest`/`jsdom` (devDependencies).

## 12. Plano de implantação seguro

1. **Backup restaurável** e teste do restore numa cópia.
2. Subir o código com **todas as chaves desligadas**. Conferir login, QR (crédito e débito), resgate, painel admin e o banner de cookies no celular.
3. Rodar o **diagnóstico de IP** (pelo domínio da Vercel e direto no Railway) e decidir a topologia (`docs/RATE_LIMIT_E_IP.md`).
4. **Banco:** aplicar A→E **na cópia**, rodar a suíte contra ela, depois na produção, uma seção por vez, com o "DESFAZER" à mão.
5. **QR preso ao cliente:** acompanhar o log `qr_credito_gerado` (`vinculado: true/false`). Quando as lojas só gerarem vinculado, ligar `QR_CREDITO_EXIGE_CLIENTE=true`.
6. **E-mail:** medir `SELECT count(*) AS clientes, count(*) FILTER (WHERE email_verificado) AS confirmados FROM usuarios WHERE tipo='cliente' AND deletado_em IS NULL;`, avisar os clientes, confirmar que o Resend entrega em produção, só então ligar `EXIGIR_EMAIL_VERIFICADO=true`. Reverter = desligar a chave.
7. **Dados pessoais:** fases 1–3 de `PLANO_MIGRACAO_PII.md`; a fase 4 só com aprovação e backup validado.
