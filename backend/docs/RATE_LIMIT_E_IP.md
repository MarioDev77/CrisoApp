# Rate limit distribuído e identificação do IP (Etapa 2)

## Como o limitador funciona agora

- **Fonte única: PostgreSQL** (tabela `rate_limits`, sem schema novo). O `Map` em memória foi removido: ele divergia do banco e bloqueava indevidamente.
- Cada contagem é **uma instrução atômica** (`INSERT … ON CONFLICT DO UPDATE`), válida entre instâncias e processos. O relógio é o do banco (`now()`).
- A chave gravada é **HMAC**: nem IP nem e-mail aparecem em claro. `429` sempre leva `Retry-After` (segundos restantes da janela).
- Primitivas (`rate-limit.ts`): `contar`, `limitar`, `estornar` (devolve 1), `zerar`, `estenderJanela`, `limparExpirados`.

## Login: o que conta como falha

| Regra | Chave | Limite | Observação |
|---|---|---|---|
| `login-ip` | IP | 300 / 15 min | Inundação geral (alto, por causa de redes compartilhadas como escolas). Conta toda requisição. |
| `login-falha-ip` | IP | 40 falhas / 15 min | Só com IP confiável. |
| `login-falha` | IP + e-mail | 8 falhas / 15 min | Só com IP confiável. Quem erra a senha alheia gasta o **próprio** orçamento. |
| `login-conta` | e-mail | 15 falhas / 15 min → contenção | Funciona **sem** IP confiável. |

- A tentativa é **reservada de forma atômica** antes de verificar a senha (rajadas paralelas não passam do limite) e **devolvida** quando o login dá certo, quando era só o pedido do código MFA ou quando a senha estava certa mas a conta está bloqueada/pendente. Só senha errada e código MFA errado gastam o orçamento.
- **Contenção progressiva por conta:** ao passar de 15 falhas, quem **não** tem o cookie de dispositivo recebe `429` por 15 min; reincidindo nas 24 h seguintes: 30 min, 60 min… até 4 h. Gera o log `conta_sob_ataque` (nível `warn`).
- **Cookie `__Host-crisoverde_dispositivo`** (30 dias, HttpOnly, Secure, SameSite=Strict): só HMACs assinados; criado no login com sucesso. O dono, no navegador de sempre, não é trancado por um terceiro. Mesmo ele tem teto (100 falhas / 15 min).
- Recuperação de senha: `forgot-email` agora conta **e-mails enviados** por conta (5/h) e, ao exceder, responde igual e não envia (sem `429`, sem revelar nada). O limite por e-mail do `verify-reset-code` virou só um teto de inundação (60): o limite real é por código (5 tentativas atômicas).

## IP do cliente: o que está provado e o que não está

Fatos verificados na documentação (consulta de 12/11/2026):

1. **Vercel → origem externa:** a Vercel encaminha `x-real-ip`/`x-forwarded-for` com o IP do visitante.
2. **Borda do Railway:** sobrescreve `X-Real-IP` e `X-Forwarded-For` com o IP de **quem conectou** (relatos de usuários e da equipe; há respostas divergentes sobre o que sobra na cadeia). No seu caso, quem conecta ao Railway é a Vercel.
3. **Conclusão:** atrás do rewrite da Vercel, o IP do usuário **provavelmente não chega** nesses cabeçalhos. Usar `railway`/`hops` ali faria **todos os usuários compartilharem os IPs da Vercel**, derrubando todos juntos num ataque. Por isso o padrão continua `none` e **não escolhi `TRUSTED_PROXY_HOPS` por suposição**.

### Matriz de decisão

| Topologia | `TRUSTED_PROXY` | Pré-condição |
|---|---|---|
| **Hoje:** navegador → Vercel (rewrite `/api`) → Railway | `none` (padrão) | Nenhuma. Protege por conta/dispositivo e por balde global (10× o teto). Alerta `ip_nao_identificado` ativo. |
| Front servido pelo Railway (o build já suporta `base: '/web/'`) | `railway` | Confirmar com o diagnóstico direto no Railway. |
| Vercel com `ORIGIN_SECRET` injetado | `vercel` + `CLIENT_IP_HEADER` | A doc da Vercel mostra o segredo via `routes` + `transforms`. **Não validei** se isso convive com seus `rewrites`/`headers` (CSP). Teste num deploy de preview. |
| Cloudflare na frente do Railway | `cloudflare` | Regra que injeta `x-origin-secret` e origem aceitando só a Cloudflare. |

### Diagnóstico (rode antes de mudar qualquer coisa)

```bash
# 1) pelo domínio da Vercel (passa pelo rewrite)
curl -s -H "Authorization: Bearer $CRON_SECRET" https://SEU-DOMINIO-VERCEL/api/diagnostico/ip
# 2) direto no Railway
curl -s -H "Authorization: Bearer $CRON_SECRET" https://crisoapp-production.up.railway.app/api/diagnostico/ip
```

Compare o seu IP público real (`curl ifconfig.me`) com `cabecalhos_recebidos`. Se `x-real-ip`/`x-forwarded-for` trouxerem um IP da Vercel (o mesmo para qualquer visitante), **não** use `railway`/`hops` nessa rota. Atenção: com `ORIGIN_SECRET` definido, o `proxy.ts` rejeita requisições sem o cabeçalho; hoje a Vercel não o injeta (item A1 da auditoria anterior).

### Alerta operacional

Com IP não confiável em produção, o backend registra `ip_nao_identificado` (nível `error`, no máximo 1/min por processo). **Crie um alerta no Railway para esse texto**: ele é o sinal de que a proteção por IP não está efetiva. Os limites por IP passam a usar um balde global com teto 10× maior, e os limites por IP+e-mail ficam desligados (não viram balde por e-mail do mundo inteiro).

## Testes

- `tests/unit/ip-e-dispositivo.test.ts` (sem banco): modos de proxy, cabeçalhos forjados, `ORIGIN_SECRET` (timing-safe), IPv6 /64, alerta, cookie de dispositivo.
- `tests/unit/rate-limit-pg.test.ts` (**PostgreSQL real**): rode com `TEST_DATABASE_URL=postgresql://… npx vitest run tests/unit/rate-limit-pg.test.ts` num banco **descartável** com as migrations aplicadas. Sem a variável, os testes são pulados. Cobre concorrência (300 paralelas, 3 conexões independentes), expiração, relógio do banco, HMAC, 429/`Retry-After` via `api()`, falsificação de cabeçalhos e os cenários de ataque ao login.
- Limite conhecido: "múltiplas instâncias" foi simulado com pools/conexões independentes dentro de um processo. A garantia vem do PostgreSQL, não do processo; um teste com processos separados exige o client do Prisma gerado.

## Riscos residuais (honestos)

- **BAIXO:** com contenção ativa, o dono num aparelho **novo** (sem cookie) fica sem entrar até a janela passar (máx. 4 h) e deve usar "Esqueci a senha". Um atacante persistente (100+ falhas/15 min) também pode bloquear o dono com cookie; com IP confiável o limite por IP o contém.
- **BAIXO:** um terceiro pode esgotar os 5 e-mails/hora de recuperação de uma conta alheia (a janela é de 1 h).
- **INFORMATIVO:** `/api/cadastro` ainda responde de forma diferente para e-mail já cadastrado (enumeração de contas); fora do escopo desta etapa.
