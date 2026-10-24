// Testes de acesso "caixa-preta": o resultado esperado é SEMPRE negado (401/403/400/413) quando não há autorização.
//
// Uso (contra um servidor de TESTE com banco de TESTE — ele cria 2 clientes descartáveis):
//   cd backend && npm run dev          # ou o servidor de homologação
//   BASE=http://localhost:3000 node tests/seguranca-acesso.mjs
// Opcional (testa também loja/admin com contas de teste existentes):
//   LOJA_EMAIL=... LOJA_SENHA=... node tests/seguranca-acesso.mjs
// NÃO rode contra produção: cria usuários e dispara rate limits.
// Nesta revisão o script foi escrito mas NÃO foi executado (o sandbox não tinha o servidor + banco no ar).

const BASE = process.env.BASE || "http://localhost:3000";
const resultados = [];
const t = (nome, ok, detalhe = "") => { resultados.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${nome}${detalhe ? `  -> ${detalhe}` : ""}`); };

function sessao() {
  const s = { cookie: "" };
  s.call = async (metodo, caminho, corpo, extra = {}) => {
    const headers = { "Content-Type": "application/json", ...extra };
    if (s.cookie) headers.Cookie = s.cookie;
    const r = await fetch(BASE + caminho, { method: metodo, headers, body: corpo === undefined ? undefined : typeof corpo === "string" ? corpo : JSON.stringify(corpo) });
    for (const c of r.headers.getSetCookie?.() ?? []) { const par = c.split(";")[0]; if (!/=$/.test(par)) s.cookie = par; }
    let json = null; try { json = await r.json(); } catch {}
    return { status: r.status, json, headers: r.headers };
  };
  return s;
}
const sufixo = Date.now().toString(36);
const negado = (status) => status === 401 || status === 403;

// ---------- 1) sem login: nenhuma rota protegida responde dados
const anon = sessao();
const protegidas = [
  ["GET", "/api/cliente/carteira"], ["GET", "/api/cliente/historico"], ["GET", "/api/cliente/perfil"], ["GET", "/api/cliente/meu-qr"],
  ["POST", "/api/cliente/resgatar", { valor: 1 }], ["POST", "/api/qr/validar", { token: "x" }], ["POST", "/api/qr/confirmar", { token: "x" }],
  ["POST", "/api/qr/gerar", { tipo: "credito", materiais: { papelao: 7 } }], ["GET", "/api/loja/dashboard"], ["GET", "/api/loja/vendas"],
  ["GET", "/api/loja/clientes/buscar?busca=ana"], ["GET", "/api/admin/dashboard"], ["GET", "/api/admin/usuarios"], ["GET", "/api/admin/resgates"],
  ["GET", "/api/admin/auditoria"], ["GET", "/api/admin/transacoes"], ["POST", "/api/admin/usuarios/1/bloquear"], ["DELETE", "/api/admin/usuarios/1"],
  ["PATCH", "/api/admin/resgates/1", { status: "pago" }], ["POST", "/api/admin/configuracoes/taxas", { papelao: 1 }], ["POST", "/api/admin/mfa/resetar", { tipo: "usuario", id: 1, senha: "x" }],
  ["GET", "/api/config/taxas"],
];
for (const [m, p, b] of protegidas) { const r = await anon.call(m, p, b); t(`anônimo ${m} ${p} é negado`, r.status === 401, `status ${r.status}`); }
{ const r = await anon.call("POST", "/api/cron/maintenance"); t("cron sem segredo é negado", r.status === 401, `status ${r.status}`); }

// ---------- 2) dois clientes (A e B) e escalada de privilégio
const A = sessao(), B = sessao();
const senha = "Teste1234abc";
for (const [s, n] of [[A, "a"], [B, "b"]]) {
  const r = await s.call("POST", "/api/auth/cadastro", { nome: `Teste ${n}`, email: `seg-${n}-${sufixo}@exemplo.invalid`, senha, telefone: "75999998888" });
  t(`cadastro do cliente ${n.toUpperCase()}`, r.status === 201, `status ${r.status}`);
}
for (const [m, p, b] of protegidas.filter(([, p]) => /\/api\/(admin|loja)\//.test(p) || p === "/api/qr/gerar")) {
  const r = await A.call(m, p, b);
  t(`cliente A em ${m} ${p} é negado`, negado(r.status), `status ${r.status}`);
}
// mass assignment: campos que o cliente NÃO pode alterar são ignorados
{
  const r = await A.call("PUT", "/api/cliente/perfil", { nome: "Teste a", email: `seg-a-${sufixo}@exemplo.invalid`, telefone: "75999998888", tipo: "admin", saldo: 999999, status: "ativo", id: 1 });
  t("PUT perfil com tipo/saldo/id extras não escala privilégio", r.status === 200, `status ${r.status}`);
  const v = await A.call("GET", "/api/auth/verificar");
  t("após PUT, A continua cliente", v.json?.usuario?.tipo === "cliente", JSON.stringify(v.json?.usuario?.tipo));
  const c = await A.call("GET", "/api/cliente/carteira");
  t("após PUT, saldo de A continua 0", Number(c.json?.saldo_total) === 0, `saldo_total ${c.json?.saldo_total}`);
}
// A não enxerga B: as rotas de cliente não aceitam id e sempre usam o dono da sessão
{
  const hA = await A.call("GET", "/api/cliente/historico?idCliente=1&id_cliente=1");
  t("histórico de A ignora id_cliente da query", hA.status === 200 && Array.isArray(hA.json) && hA.json.length === 0, `status ${hA.status}`);
  const pB = await B.call("GET", "/api/cliente/perfil");
  t("perfil de B mostra o e-mail de B (não o de A)", pB.json?.email?.includes(`seg-b-${sufixo}`), pB.json?.email);
}
// resgate: valor absurdo/negativo e sem saldo
for (const valor of [-5, 0, 1e9, "abc"]) { const r = await A.call("POST", "/api/cliente/resgatar", { valor }); t(`resgate com valor ${JSON.stringify(valor)} é recusado`, r.status >= 400 && r.status < 500, `status ${r.status}`); }
{ const r = await A.call("POST", "/api/cliente/resgatar", { valor: 10 }); t("resgate sem saldo é recusado", r.status >= 400 && r.status < 500, `status ${r.status}`); }
// QR inexistente / curto adivinhado
for (const token of ["00000000-0000-0000-0000-000000000000", "AAAA-AAAA", "' OR 1=1 --"]) { const r = await A.call("POST", "/api/qr/validar", { token }); t(`QR inexistente (${token.slice(0, 12)}) não valida`, r.status === 404 || r.status === 400, `status ${r.status}`); }

// ---------- 3) o que o DevTools consegue forjar
{
  const r = await A.call("POST", "/api/cliente/resgatar", { valor: 1 }, { Origin: "https://evil.example" });
  t("POST com Origin de outro site é bloqueado (CSRF)", r.status === 403, `status ${r.status}`);
  const r2 = await A.call("POST", "/api/qr/validar", { token: "x" }, { "Sec-Fetch-Site": "cross-site" });
  t("POST com Sec-Fetch-Site: cross-site é bloqueado", r2.status === 403, `status ${r2.status}`);
  const grande = await anon.call("POST", "/api/auth/login", JSON.stringify({ email: "a@b.co", senha: "x".repeat(20000) }));
  t("corpo acima de 10 KB é recusado", grande.status === 413, `status ${grande.status}`);
  const j = await anon.call("POST", "/api/auth/login", "{nao-e-json");
  t("JSON inválido vira 400, não 500", j.status === 400, `status ${j.status}`);
  const falso = await sessao(); falso.cookie = "crisoverde_session=eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIiwidGlwbyI6ImFkbWluIn0."; // alg:none forjado
  const f = await falso.call("GET", "/api/admin/dashboard");
  t("JWT forjado (alg none, tipo admin) é negado", f.status === 401, `status ${f.status}`);
  const h = await anon.call("GET", "/api/health");
  t("não vaza X-Powered-By", !h.headers.get("x-powered-by"));
}

// ---------- 4) login não revela se o e-mail existe
{
  const existente = await anon.call("POST", "/api/auth/login", { email: `seg-a-${sufixo}@exemplo.invalid`, senha: "SenhaErrada123" });
  const inexistente = await anon.call("POST", "/api/auth/login", { email: `nao-existe-${sufixo}@exemplo.invalid`, senha: "SenhaErrada123" });
  t("login errado: mesma resposta para e-mail existente e inexistente", existente.status === 401 && inexistente.status === 401 && existente.json?.mensagem === inexistente.json?.mensagem, `${existente.status}/${inexistente.status}`);
  const fp = await anon.call("POST", "/api/auth/forgot-password", { email: `nao-existe-${sufixo}@exemplo.invalid` });
  const fp2 = await anon.call("POST", "/api/auth/forgot-password", { email: `seg-a-${sufixo}@exemplo.invalid` });
  t("recuperar senha: mesma resposta para e-mail existente e inexistente", fp.status === fp2.status && fp.json?.mensagem === fp2.json?.mensagem, `${fp.status}/${fp2.status}`);
}

// ---------- 5) (opcional) loja de teste não alcança nada de admin e não debita sem QR
if (process.env.LOJA_EMAIL && process.env.LOJA_SENHA) {
  const L = sessao();
  const l = await L.call("POST", "/api/auth/login", { email: process.env.LOJA_EMAIL, senha: process.env.LOJA_SENHA, codigo_mfa: process.env.LOJA_MFA });
  t("login da loja de teste", l.status === 200, `status ${l.status}`);
  for (const [m, p, b] of protegidas.filter(([, p]) => p.startsWith("/api/admin/") || p.startsWith("/api/cliente/"))) {
    const r = await L.call(m, p, b); t(`loja em ${m} ${p} é negada`, negado(r.status), `status ${r.status}`);
  }
}

const falhas = resultados.filter((x) => !x).length;
console.log(`\n${resultados.length - falhas}/${resultados.length} verificações passaram.`);
process.exit(falhas ? 1 : 0);
