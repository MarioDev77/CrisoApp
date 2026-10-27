// Teste de integração da nova fase (dashboard, reciclagem/QR, loja de recompensas, impacto ambiental).
// Roda contra um servidor Next já em execução e um PostgreSQL REAL. Não usa mocks.
//   1) migrations aplicadas  2) npm run dev (porta 3200)  3) node tests/nova-fase.mjs
// As sessões são assinadas com o SESSION_SECRET do .env (mesmo mecanismo do app), então toda requisição
// passa pelo middleware real de autenticação/autorização, CSRF, validação e rate limit.
import 'dotenv/config';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';

const BASE = process.env.BASE || 'http://localhost:3200';
const SECRET = new TextEncoder().encode(process.env.SESSION_SECRET || process.env.JWT_SECRET);
const COOKIE = process.env.COOKIE_NAME || (process.env.NODE_ENV === 'production' ? '__Host-crisoverde_session' : 'crisoverde_session');
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const q = async (sql, params) => (await db.query(sql, params)).rows;

let pass = 0, fail = 0;
const t = (nome, ok, detalhe = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${nome}${!ok && detalhe ? '  -> ' + detalhe : ''}`); };
const rnd = Math.random().toString(36).slice(2, 8);
let ipSeq = 1 + Math.floor(Math.random() * 150);

async function sessao(tipo, id, versao = 0) {
  const jwt = await new SignJWT({ tipo, v: versao, mfa: true }).setProtectedHeader({ alg: 'HS256', kid: 'current' }).setSubject(String(id)).setIssuedAt().setExpirationTime('1h').sign(SECRET);
  const ip = `198.51.100.${(ipSeq++ % 250) + 1}`;
  return { cookie: `${COOKIE}=${jwt}`, ip, tipo, id };
}
async function call(s, metodo, path, body) {
  const headers = { 'Content-Type': 'application/json', 'X-Forwarded-For': s?.ip || '198.51.100.250' };
  if (s?.cookie) headers.Cookie = s.cookie;
  const r = await fetch(BASE + path, { method: metodo, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j };
}
const get = (s, p) => call(s, 'GET', p);
const post = (s, p, b = {}) => call(s, 'POST', p, b);
const patch = (s, p, b = {}) => call(s, 'PATCH', p, b);
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.0051;

// ---------- massa de teste (SQL direto; login é coberto pelos testes existentes) ----------
const hash = await bcrypt.hash('Senha1234', 4);
async function novoCliente(nome) {
  const email = `${nome.toLowerCase()}.${rnd}@teste.local`;
  const [u] = await q(`INSERT INTO usuarios (nome, email, senha, tipo, status, telefone, email_verificado) VALUES ($1,$2,$3,'cliente','ativo','11987654321',true) RETURNING id, email`, [`${nome} Silva`, email, hash]);
  return u;
}
async function novaLoja(nome) {
  const email = `${nome.toLowerCase()}.${rnd}@loja.local`;
  const [l] = await q(`INSERT INTO lojas (nome, responsavel, email, telefone, senha, status) VALUES ($1,'Resp',$2,'11987654321',$3,'ativo') RETURNING id`, [`Loja ${nome} ${rnd}`, email, hash]);
  return l;
}
const [adminRow] = await q(`SELECT id, versao_sessao FROM usuarios WHERE tipo='admin' ORDER BY id LIMIT 1`);
const admin = await sessao('admin', adminRow.id, adminRow.versao_sessao);
const ana = await novoCliente('Ana'), bruno = await novoCliente('Bruno'), carla = await novoCliente('Carla');
const l1 = await novaLoja('Um'), l2 = await novaLoja('Dois');
const sAna = await sessao('cliente', ana.id), sBruno = await sessao('cliente', bruno.id), sCarla = await sessao('cliente', carla.id);
const sL1 = await sessao('loja', l1.id), sL2 = await sessao('loja', l2.id);
const envelhecer = (idCliente) => q(`UPDATE transacoes SET criado_em = criado_em - interval '3 days' WHERE id_cliente=$1 AND categoria='reciclagem'`, [idCliente]); // fora da carência
const ledger = async (idCliente) => {
  const [r] = await q(`SELECT u.saldo::float8 AS saldo, COALESCE((SELECT sum(CASE WHEN tipo='credito' THEN valor ELSE -valor END) FROM transacoes WHERE id_cliente=u.id),0)::float8 AS razao FROM usuarios u WHERE u.id=$1`, [idCliente]);
  return r;
};
const fluxoQr = async (sLoja, sCliente, materiais) => { // loja gera → cliente valida → confirma
  const g = await post(sLoja, '/api/qr/gerar', { tipo: 'credito', materiais });
  if (g.s !== 200) return { g };
  const v = await post(sCliente, '/api/qr/validar', { token: g.j.token });
  const c = await post(sCliente, '/api/qr/confirmar', { token: g.j.token, id_transacao: g.j.id_transacao });
  return { g, v, c, token: g.j.token };
};

console.log('\n== 1. Autenticação e autorização das rotas novas ==');
const rotasCliente = ['/api/cliente/dashboard', '/api/cliente/reciclagens', '/api/cliente/recompensas', '/api/cliente/recompensas/meus'];
const rotasAdmin = ['/api/admin/impacto', '/api/admin/recompensas', '/api/admin/resgates-recompensa', '/api/admin/configuracoes/metas'];
for (const p of [...rotasCliente, ...rotasAdmin]) t(`sem login → 401 em ${p}`, (await get(null, p)).s === 401);
for (const p of rotasCliente) t(`admin/loja em rota de aluno → 403 (${p})`, (await get(admin, p)).s === 403 && (await get(sL1, p)).s === 403);
for (const p of rotasAdmin) t(`aluno/loja em rota de admin → 403 (${p})`, (await get(sAna, p)).s === 403 && (await get(sL1, p)).s === 403);
t('aluno não cria recompensa (403)', (await post(sAna, '/api/admin/recompensas', { nome: 'X', custo: 1 })).s === 403);
t('aluno não altera meta (403)', (await post(sAna, '/api/admin/configuracoes/metas', { meta_reciclagem_mensal_kg: 1 })).s === 403);
t('aluno não baixa voucher de loja (403)', (await post(sAna, '/api/loja/recompensas/utilizar', { codigo: 'ABCD-EFGH' })).s === 403);
t('cookie inválido → 401', (await get({ cookie: `${COOKIE}=abc.def.ghi`, ip: '198.51.100.9' }, '/api/cliente/dashboard')).s === 401);

console.log('\n== 2. Estados vazios (conta nova) ==');
let r = await get(sAna, '/api/cliente/dashboard');
t('dashboard de conta nova: saldo 0, sem movimentações, sem simulação', r.s === 200 && r.j.carteira.saldo === 0 && r.j.ultimas_movimentacoes.length === 0 && r.j.resumo.operacoes_totais === 0 && r.j.campanhas === null, JSON.stringify(r.j));
t('meta mensal vem com 0% e a meta definida', r.j.meta_mensal.percentual === 0 && r.j.meta_mensal.meta_kg > 0);
r = await get(sAna, '/api/cliente/reciclagens');
t('reciclagens vazias', r.s === 200 && r.j.total === 0 && r.j.reciclagens.length === 0 && Object.values(r.j.totais_por_material).every((v) => v === 0));
r = await get(sAna, '/api/cliente/recompensas/meus');
t('vouchers vazios', r.s === 200 && r.j.resgates.length === 0);

console.log('\n== 3. QR Code: fluxo, detalhes e proteção contra duplicidade ==');
let f = await fluxoQr(sL1, sAna, { papelao: 14, plastico: 10 }); // 0,50 + 0,25 = 0,75 ; 24 un = 1,2 kg
t('loja gera QR de crédito', f.g.s === 200 && f.g.j.codigo, JSON.stringify(f.g.j));
t('validar traz materiais, kg e carência para conferência', f.v.s === 200 && f.v.j.materiais.papelao === 14 && f.v.j.materiais.plastico === 10 && near(f.v.j.kg, 1.2) && near(f.v.j.valor, 0.75) && f.v.j.carencia_horas >= 0, JSON.stringify(f.v.j));
t('confirmar devolve a operação com referência, kg e status', f.c.s === 200 && f.c.j.operacao?.referencia_qr === f.g.j.id_transacao && near(f.c.j.operacao.kg, 1.2) && f.c.j.operacao.status && near(f.c.j.novo_saldo, 0.75), JSON.stringify(f.c.j));
const [trx] = await q(`SELECT id, id_qr_transacao, kg::float8 AS kg FROM transacoes WHERE id_cliente=$1 AND categoria='reciclagem'`, [ana.id]);
t('transação grava a referência do QR', trx && trx.id_qr_transacao === f.g.j.id_transacao);
r = await post(sAna, '/api/qr/confirmar', { token: f.token });
t('reutilizar o mesmo QR → 400, sem novo crédito', r.s === 400 && (await q(`SELECT 1 FROM transacoes WHERE id_cliente=$1`, [ana.id])).length === 1);
r = await post(sBruno, '/api/qr/confirmar', { token: f.token });
t('outro aluno também não consegue usar o QR já usado', r.s === 400);
r = await post(sBruno, '/api/qr/validar', { token: 'TOKEN-INEXISTENTE' });
t('QR inexistente → 404 sem detalhes internos', r.s === 404 && !/prisma|sql|stack/i.test(JSON.stringify(r.j)));
// expirado
const gExp = await post(sL1, '/api/qr/gerar', { tipo: 'credito', materiais: { vidro: 8 } });
await q(`UPDATE qr_codes SET expira_em = now() - interval '1 minute' WHERE token=$1`, [gExp.j.token]);
r = await post(sBruno, '/api/qr/confirmar', { token: gExp.j.token });
t('QR expirado → 400 e nenhum crédito', r.s === 400 && (await q(`SELECT 1 FROM transacoes WHERE id_cliente=$1`, [bruno.id])).length === 0);
// invalidado pelo admin
const gInv = await post(sL1, '/api/qr/gerar', { tipo: 'credito', materiais: { vidro: 8 } });
await q(`UPDATE qr_codes SET status='invalido' WHERE token=$1`, [gInv.j.token]);
r = await post(sBruno, '/api/qr/confirmar', { token: gInv.j.token });
t('QR invalidado → 400 e nenhum crédito', r.s === 400 && (await q(`SELECT 1 FROM transacoes WHERE id_cliente=$1`, [bruno.id])).length === 0);
// cliente não define o valor
const gOk = await post(sL1, '/api/qr/gerar', { tipo: 'credito', materiais: { papelao: 7 }, valor: 9999 });
t('valor enviado pelo navegador é ignorado (recalculado no servidor)', gOk.s === 200 && near((await post(sBruno, '/api/qr/validar', { token: gOk.j.token })).j.valor, 0.25));
// concorrência: 8 confirmações simultâneas do mesmo QR
const gConc = await post(sL1, '/api/qr/gerar', { tipo: 'credito', materiais: { aluminio: 12 } }); // 0,50
const resConc = await Promise.all(Array.from({ length: 8 }, () => post(sBruno, '/api/qr/confirmar', { token: gConc.j.token })));
t('8 confirmações simultâneas do mesmo QR → exatamente 1 sucesso', resConc.filter((x) => x.s === 200).length === 1, resConc.map((x) => x.s).join(','));
const lb = await ledger(bruno.id);
t('saldo = livro-razão após concorrência (sem crédito duplicado)', near(lb.saldo, 0.5) && near(lb.razao, 0.5), JSON.stringify(lb));
t('uma única transação por QR (UNIQUE id_qr_transacao)', (await q(`SELECT count(*)::int AS n FROM transacoes WHERE id_qr_transacao=$1`, [gConc.j.id_transacao]))[0].n === 1);
// UNIQUE no banco funciona como barreira final
let uniqueOk = false; try { await q(`INSERT INTO transacoes (id_cliente, tipo, categoria, valor, id_qr_transacao) VALUES ($1,'credito','reciclagem',1,$2)`, [bruno.id, gConc.j.id_transacao]); } catch (e) { uniqueOk = e.code === '23505'; }
t('banco recusa segundo crédito para o mesmo QR (23505)', uniqueOk);
// loja não confirma QR; só o cliente
t('loja não pode confirmar QR (403)', (await post(sL1, '/api/qr/confirmar', { token: gOk.j.token })).s === 403);
// débito por QR (fluxo existente)
await envelhecer(ana.id);
const gDeb = await post(sL1, '/api/qr/gerar', { tipo: 'debito', valor: 0.25, produto: 'Caderno' });
const cDeb = await post(sAna, '/api/qr/confirmar', { token: gDeb.j.token });
t('débito por QR continua funcionando e traz referência', cDeb.s === 200 && cDeb.j.operacao.tipo === 'debito' && near(cDeb.j.novo_saldo, 0.5), JSON.stringify(cDeb.j));
const lAna0 = await ledger(ana.id);
t('ledger consistente após crédito + débito', near(lAna0.saldo, lAna0.razao) && near(lAna0.saldo, 0.5), JSON.stringify(lAna0));

console.log('\n== 4. Dashboard do aluno e acompanhamento da reciclagem ==');
r = await get(sAna, '/api/cliente/dashboard');
t('dashboard mostra o saldo real (total 0,50) e carência zerada após envelhecer', r.s === 200 && near(r.j.carteira.saldo_total, 0.5) && near(r.j.carteira.saldo, 0.5) && r.j.carteira.saldo_pendente === 0, JSON.stringify(r.j.carteira));
t('dashboard: operações, kg e últimas movimentações corretas', r.j.resumo.operacoes_totais === 2 && r.j.resumo.reciclagens === 1 && near(r.j.resumo.total_reciclado_kg, 1.2) && r.j.ultimas_movimentacoes.length === 2);
t('movimentações trazem tipo, status, origem e referência', r.j.ultimas_movimentacoes.every((m) => m.tipo_operacao && m.status && m.status_rotulo && m.origem && m.id) && r.j.ultimas_movimentacoes.some((m) => m.tipo_operacao === 'desconto_loja') && r.j.ultimas_movimentacoes.some((m) => m.tipo_operacao === 'reciclagem' && m.referencia_qr === f.g.j.id_transacao));
t('meta mensal: kg do mês e percentual coerentes', near(r.j.meta_mensal.reciclado_kg, 1.2) && r.j.meta_mensal.percentual === Math.min(100, Math.round((1.2 / r.j.meta_mensal.meta_kg) * 100)));
const dashB = await get(sBruno, '/api/cliente/dashboard');
t('aluno B só vê os próprios dados (não vê os da Ana)', dashB.j.resumo.operacoes_totais === 1 && near(dashB.j.carteira.saldo_total, 0.5) && !JSON.stringify(dashB.j).includes('Ana'));
// carência real: crédito novo fica pendente
const fNovo = await fluxoQr(sL1, sCarla, { papelao: 7 });
const dashC = await get(sCarla, '/api/cliente/dashboard');
t('crédito recente fica em carência (status e saldo pendente)', fNovo.c.s === 200 && dashC.j.carteira.saldo === 0 && near(dashC.j.carteira.saldo_pendente, 0.25) && dashC.j.ultimas_movimentacoes[0].status === 'em_carencia' && dashC.j.ultimas_movimentacoes[0].disponivel_em, JSON.stringify(dashC.j.ultimas_movimentacoes[0]));
t('confirmar já informa que está em carência', fNovo.c.j.operacao.status === 'em_carencia' && fNovo.c.j.operacao.disponivel_em);
r = await get(sAna, '/api/cliente/reciclagens');
t('lista de reciclagens da Ana: 1 item com materiais por tipo, kg e referência QR', r.s === 200 && r.j.total === 1 && r.j.reciclagens[0].materiais.papelao === 14 && near(r.j.reciclagens[0].kg, 1.2) && r.j.reciclagens[0].referencia_qr === f.g.j.id_transacao && r.j.totais_por_material.plastico === 10, JSON.stringify(r.j));
t('filtro por material: sem alumínio → 0; com plástico → 1', (await get(sAna, '/api/cliente/reciclagens?material=aluminio')).j.total === 0 && (await get(sAna, '/api/cliente/reciclagens?material=plastico')).j.total === 1);
t('material inválido → 400', (await get(sAna, '/api/cliente/reciclagens?material=ouro')).s === 400);
t('aluno B não enxerga reciclagens da Ana por parâmetro (não existe id)', (await get(sBruno, '/api/cliente/reciclagens?idCliente=' + ana.id)).j.total === 1 && (await get(sBruno, '/api/cliente/reciclagens?idCliente=' + ana.id)).j.reciclagens[0].materiais.aluminio === 12);
// compatibilidade: histórico antigo
r = await get(sAna, '/api/cliente/historico');
t('histórico mantém os campos antigos (id,tipo,valor,categoria,loja,materiais,criado_em)', r.s === 200 && ['id', 'tipo', 'valor', 'categoria', 'loja', 'materiais', 'criado_em'].every((k) => k in r.j[0]));
t('histórico filtrado por tipo continua funcionando', (await get(sAna, '/api/cliente/historico?tipo=debito')).j.length === 1 && (await get(sAna, '/api/cliente/historico?tipo=xxx')).s === 400);
r = await get(sAna, '/api/cliente/carteira');
t('carteira mantém o formato original', r.s === 200 && ['saldo', 'saldo_total', 'saldo_pendente', 'total_ganho', 'total_utilizado', 'total_reciclado_kg', 'total_trocas'].every((k) => k in r.j));

console.log('\n== 5. Meta mensal (administração) ==');
t('meta inválida → 400', (await post(admin, '/api/admin/configuracoes/metas', { meta_reciclagem_mensal_kg: -1 })).s === 400 && (await post(admin, '/api/admin/configuracoes/metas', { meta_reciclagem_mensal_kg: 'abc' })).s === 400);
t('admin define a meta em 2 kg', (await post(admin, '/api/admin/configuracoes/metas', { meta_reciclagem_mensal_kg: 2 })).s === 200 && (await get(admin, '/api/admin/configuracoes/metas')).j.meta_reciclagem_mensal_kg === 2);
r = await get(sAna, '/api/cliente/dashboard');
t('dashboard reflete a nova meta (1,2/2 = 60%)', r.j.meta_mensal.meta_kg === 2 && r.j.meta_mensal.percentual === 60 && r.j.meta_mensal.atingida === false, JSON.stringify(r.j.meta_mensal));
t('mudança de meta foi auditada', (await q(`SELECT 1 FROM logs_auditoria WHERE acao='admin_alterou_meta_reciclagem' AND criado_em > now() - interval '1 minute'`)).length >= 1);

console.log('\n== 6. Loja de recompensas ==');
const nomeR = (n) => `${n} ${rnd}`;
const mk = async (extra) => post(admin, '/api/admin/recompensas', { nome: nomeR('Brinde'), custo: 0.25, categoria: 'papelaria', ...extra });
t('admin: validações do catálogo (custo ≤ 0, nome curto, loja inexistente)', (await mk({ custo: 0 })).s === 400 && (await mk({ custo: -5 })).s === 400 && (await mk({ nome: 'A' })).s === 400 && (await mk({ idLoja: 999999 })).s === 400);
const rA = (await mk({ nome: nomeR('Caderno'), custo: 0.25, estoque: 1, idLoja: l1.id, validadeDias: 10, regras: 'Retirar na loja.' })).j.id;
const rB = (await mk({ nome: nomeR('Mochila'), custo: 100 })).j.id;
const rC = (await mk({ nome: nomeR('Inativa'), ativo: false })).j.id;
const rD = (await mk({ nome: nomeR('Lapis'), custo: 0.25, limitePorCliente: 1, idLoja: l2.id })).j.id;
const rE = (await mk({ nome: nomeR('Passada'), custo: 0.25, disponivelAte: new Date(Date.now() - 3600_000).toISOString() })).j.id;
t('admin cria recompensas', [rA, rB, rC, rD, rE].every(Number.isInteger));
r = await get(sAna, '/api/cliente/recompensas');
const porId = Object.fromEntries((r.j.recompensas || []).map((x) => [x.id, x]));
t('catálogo mostra ativas; esconde inativa e encerrada', r.s === 200 && porId[rA] && porId[rB] && !porId[rC] && !porId[rE]);
t('catálogo marca saldo suficiente/insuficiente com dados do servidor', porId[rA].saldo_suficiente === true && porId[rB].saldo_suficiente === false && porId[rA].estabelecimento === `Loja Um ${rnd}`);
t('busca e categoria', (await get(sAna, `/api/cliente/recompensas?busca=caderno`)).j.recompensas.some((x) => x.id === rA) && !(await get(sAna, `/api/cliente/recompensas?categoria=inexistente`)).j.recompensas.length);
t('aluno não altera catálogo (PATCH 403)', (await patch(sAna, `/api/admin/recompensas/${rA}`, { custo: 0.01 })).s === 403);

const saldoAntes = (await ledger(ana.id)).saldo;
const k1 = uid();
r = await post(sAna, `/api/cliente/recompensas/${rA}/resgatar`, { chave: k1, custo: 0.01, valor: 0.01 }); // tenta forçar preço
t('resgate válido concluído; cobra o preço do BANCO, não o enviado', r.s === 200 && r.j.voucher.codigo && near(r.j.novo_saldo, saldoAntes - 0.25), JSON.stringify(r.j));
const voucherAna = r.j.voucher;
let lg = await ledger(ana.id);
t('saldo = livro-razão após resgate', near(lg.saldo, lg.razao) && near(lg.saldo, saldoAntes - 0.25), JSON.stringify(lg));
const [vrow] = await q(`SELECT v.*, t.valor::float8 AS tv, t.forma, t.tipo::text AS ttipo, t.categoria::text AS tcat FROM resgates_recompensa v JOIN transacoes t ON t.id = v.id_transacao WHERE v.id_cliente=$1 AND v.chave=$2`, [ana.id, k1]);
t('voucher ligado ao lançamento do débito no mesmo livro-razão', vrow && near(vrow.tv, 0.25) && vrow.forma === 'recompensa' && vrow.ttipo === 'debito' && vrow.tcat === 'resgate' && near(vrow.custo, 0.25));
t('estoque baixou para 0', (await q(`SELECT estoque FROM recompensas WHERE id=$1`, [rA]))[0].estoque === 0);
r = await post(sAna, `/api/cliente/recompensas/${rA}/resgatar`, { chave: k1 });
t('repetir a MESMA tentativa não cobra de novo (idempotente)', r.s === 200 && r.j.mensagem === 'Resgate já registrado.' && near((await ledger(ana.id)).saldo, saldoAntes - 0.25) && (await q(`SELECT 1 FROM resgates_recompensa WHERE id_cliente=$1`, [ana.id])).length === 1);
r = await post(sBruno, `/api/cliente/recompensas/${rA}/resgatar`, { chave: uid() });
t('recompensa esgotada → 409 sem débito', r.s === 409 && near((await ledger(bruno.id)).saldo, 0.5));
r = await post(sAna, `/api/cliente/recompensas/${rB}/resgatar`, { chave: uid() });
t('saldo insuficiente → 400 sem débito', r.s === 400 && near((await ledger(ana.id)).saldo, saldoAntes - 0.25));
t('recompensa inativa → 409', (await post(sAna, `/api/cliente/recompensas/${rC}/resgatar`, { chave: uid() })).s === 409);
t('recompensa encerrada → 409', (await post(sAna, `/api/cliente/recompensas/${rE}/resgatar`, { chave: uid() })).s === 409);
t('recompensa inexistente → 404', (await post(sAna, `/api/cliente/recompensas/99999999/resgatar`, { chave: uid() })).s === 404);
t('chave ausente/curta → 400', (await post(sAna, `/api/cliente/recompensas/${rD}/resgatar`, {})).s === 400 && (await post(sAna, `/api/cliente/recompensas/${rD}/resgatar`, { chave: 'x' })).s === 400);
t('id da recompensa inválido → 400', (await post(sAna, `/api/cliente/recompensas/abc/resgatar`, { chave: uid() })).s === 400);
t('carência impede gastar crédito recente (Carla: 0,25 em carência)', (await post(sCarla, `/api/cliente/recompensas/${rD}/resgatar`, { chave: uid() })).s === 400 && near((await ledger(carla.id)).saldo, 0.25));
r = await post(sAna, `/api/cliente/recompensas/${rD}/resgatar`, { chave: uid() });
t('limite por cliente: 1º resgate ok', r.s === 200);
t('limite por cliente: 2º resgate → 409', (await post(sAna, `/api/cliente/recompensas/${rD}/resgatar`, { chave: uid() })).s === 409);
const voucherD = r.j.voucher;

// concorrência: Bruno tem 0,50; recompensa custa 0,40 com estoque 100 → só 1 de 10 requisições (chaves distintas) pode passar
const rF = (await mk({ nome: nomeR('Camiseta'), custo: 0.4, estoque: 100 })).j.id;
await envelhecer(bruno.id);
const resF = await Promise.all(Array.from({ length: 10 }, () => post(sBruno, `/api/cliente/recompensas/${rF}/resgatar`, { chave: uid() })));
const okF = resF.filter((x) => x.s === 200).length;
lg = await ledger(bruno.id);
t('10 resgates simultâneos com saldo para 1 → exatamente 1 sucesso', okF === 1, resF.map((x) => x.s).join(','));
t('saldo nunca fica negativo e bate com o razão', lg.saldo >= 0 && near(lg.saldo, 0.1) && near(lg.saldo, lg.razao), JSON.stringify(lg));
t('estoque baixou exatamente 1', (await q(`SELECT estoque FROM recompensas WHERE id=$1`, [rF]))[0].estoque === 99);
// concorrência: mesma chave 10x (duplo clique / retry)
await q(`UPDATE usuarios SET saldo = saldo + 1, total_ganho = total_ganho + 1 WHERE id=$1`, [carla.id]);
await q(`INSERT INTO transacoes (id_cliente, nome_cliente, tipo, categoria, valor, kg, forma, criado_em) VALUES ($1,'Carla Silva','credito','reciclagem',1,0,'pix', now() - interval '5 days')`, [carla.id]);
await envelhecer(carla.id);
const rG = (await mk({ nome: nomeR('Estojo'), custo: 0.3, estoque: 50 })).j.id;
const kG = uid();
const resG = await Promise.all(Array.from({ length: 6 }, () => post(sCarla, `/api/cliente/recompensas/${rG}/resgatar`, { chave: kG })));
t('6 requisições simultâneas com a mesma chave (duplo clique/retry) → 1 voucher e 1 débito', (await q(`SELECT 1 FROM resgates_recompensa WHERE id_cliente=$1 AND chave=$2`, [carla.id, kG])).length === 1 && resG.every((x) => x.s === 200), resG.map((x) => x.s).join(','));
lg = await ledger(carla.id);
t('Carla: saldo = razão e debitou só 0,30', near(lg.saldo, lg.razao) && near(lg.saldo, 1.25 - 0.3), JSON.stringify(lg));

console.log('\n== 7. Vouchers: consulta, uso, cancelamento e isolamento ==');
r = await get(sAna, '/api/cliente/recompensas/meus');
t('aluno vê os próprios vouchers com status, validade e instruções', r.s === 200 && r.j.resgates.length === 2 && r.j.resgates.every((v) => v.status === 'ativo' && v.expira_em && v.instrucoes) && r.j.resgates.some((v) => v.regras === 'Retirar na loja.'));
t('aluno B não vê vouchers da Ana', !(await get(sBruno, '/api/cliente/recompensas/meus')).j.resgates.some((v) => v.id === (r.j.resgates[0]?.id)) && (await get(sBruno, '/api/cliente/recompensas/meus')).j.resgates.length === 1);
const codigoA = voucherAna.codigo.replace('-', '');
t('loja de OUTRA loja não consulta o voucher (404)', (await post(sL2, '/api/loja/recompensas/consultar', { codigo: voucherAna.codigo })).s === 404);
r = await post(sL1, '/api/loja/recompensas/consultar', { codigo: voucherAna.codigo.toLowerCase() });
t('loja dona consulta o voucher (aceita hífen/caixa) e vê só o primeiro nome', r.s === 200 && r.j.voucher.status === 'ativo' && r.j.voucher.cliente === 'Ana' && !('email' in r.j.voucher));
t('código inválido → 404 e sem vazamento', (await post(sL1, '/api/loja/recompensas/consultar', { codigo: 'ZZZZ-ZZZZ' })).s === 404);
t('loja de outra loja não dá baixa (404)', (await post(sL2, '/api/loja/recompensas/utilizar', { codigo: voucherAna.codigo })).s === 404);
const baixas = await Promise.all([post(sL1, '/api/loja/recompensas/utilizar', { codigo: voucherAna.codigo }), post(sL1, '/api/loja/recompensas/utilizar', { codigo: voucherAna.codigo }), post(sL1, '/api/loja/recompensas/utilizar', { codigo: voucherAna.codigo })]);
t('baixa simultânea do mesmo voucher → só 1 sucesso (uso único)', baixas.filter((x) => x.s === 200).length === 1 && baixas.filter((x) => x.s === 409).length === 2, baixas.map((x) => x.s).join(','));
t('voucher utilizado aparece como Utilizado para o aluno', (await get(sAna, '/api/cliente/recompensas/meus')).j.resgates.find((v) => v.codigo === codigoA)?.status === 'utilizado');
r = await get(admin, '/api/admin/resgates-recompensa');
const idVA = r.j.resgates.find((v) => v.codigo === codigoA)?.id;
t('admin lista resgates e filtra por status', r.s === 200 && idVA && (await get(admin, '/api/admin/resgates-recompensa?status=utilizado')).j.resgates.some((v) => v.codigo === codigoA) && (await get(admin, '/api/admin/resgates-recompensa?status=xxx')).s === 400);
t('admin não cancela voucher já utilizado (409)', (await patch(admin, `/api/admin/resgates-recompensa/${idVA}`, { acao: 'cancelar' })).s === 409);
// cancelar voucher D (ativo): estorno
const saldoPreCancel = (await ledger(ana.id)).saldo;
const idVD = (await get(admin, '/api/admin/resgates-recompensa')).j.resgates.find((v) => v.codigo === voucherD.codigo.replace('-', ''))?.id;
const cancelamentos = await Promise.all([patch(admin, `/api/admin/resgates-recompensa/${idVD}`, { acao: 'cancelar' }), patch(admin, `/api/admin/resgates-recompensa/${idVD}`, { acao: 'cancelar' })]);
lg = await ledger(ana.id);
t('cancelamento simultâneo: 1 estorno só; saldo volta e bate com o razão', cancelamentos.filter((x) => x.s === 200).length === 1 && near(lg.saldo, saldoPreCancel + 0.25) && near(lg.saldo, lg.razao), JSON.stringify({ c: cancelamentos.map((x) => x.s), lg }));
t('após cancelar, o limite por cliente é liberado', (await post(sAna, `/api/cliente/recompensas/${rD}/resgatar`, { chave: uid() })).s === 200);
t('ação inválida → 400', (await patch(admin, `/api/admin/resgates-recompensa/${idVD}`, { acao: 'apagar' })).s === 400);
// voucher vencido
await q(`UPDATE resgates_recompensa SET expira_em = now() - interval '1 hour' WHERE id_cliente=$1 AND status='ativo' AND id_recompensa=$2`, [ana.id, rD]);
const vencido = (await get(sAna, '/api/cliente/recompensas/meus')).j.resgates.find((v) => v.status === 'expirado');
t('voucher vencido aparece como Expirado', !!vencido);
const codigoVencido = vencido.codigo;
t('loja não dá baixa em voucher vencido (409)', (await post(sL2, '/api/loja/recompensas/utilizar', { codigo: codigoVencido })).s === 409);
t('admin não cancela voucher vencido (409)', (await patch(admin, `/api/admin/resgates-recompensa/${vencido.id}`, { acao: 'cancelar' })).s === 409);
// edição de catálogo não altera vouchers antigos
await patch(admin, `/api/admin/recompensas/${rA}`, { custo: 50, nome: 'Renomeada' });
t('mudar preço/nome no catálogo não altera voucher já emitido', (await get(sAna, '/api/cliente/recompensas/meus')).j.resgates.find((v) => v.codigo === codigoA).custo === 0.25);
t('PATCH vazio/inválido → 400; recompensa inexistente → 404', (await patch(admin, `/api/admin/recompensas/${rA}`, {})).s === 400 && (await patch(admin, `/api/admin/recompensas/${rA}`, { custo: 0 })).s === 400 && (await patch(admin, `/api/admin/recompensas/99999999`, { ativo: false })).s === 404);
t('operações de recompensa foram auditadas', (await q(`SELECT count(*)::int AS n FROM logs_auditoria WHERE acao IN ('recompensa_resgatada','admin_criou_recompensa','admin_cancelou_voucher','loja_baixou_voucher') AND criado_em > now() - interval '5 minutes'`))[0].n >= 8);
// histórico do aluno reflete os status do voucher
r = await get(sAna, '/api/cliente/historico');
t('histórico do aluno mostra resgate de recompensa e estorno', r.j.some((m) => m.tipo_operacao === 'resgate_recompensa' && m.status === 'voucher_utilizado') && r.j.some((m) => m.tipo_operacao === 'estorno'), JSON.stringify(r.j.map((m) => [m.tipo_operacao, m.status])));

console.log('\n== 8. Regressão: resgate em dinheiro (PIX), débito por QR e bloqueio ==');
await q(`UPDATE usuarios SET saldo = saldo + 1, total_ganho = total_ganho + 1 WHERE id=$1`, [ana.id]);
await q(`INSERT INTO transacoes (id_cliente, nome_cliente, tipo, categoria, valor, kg, forma, criado_em) VALUES ($1,'Ana Silva','credito','reciclagem',1,0,'pix', now() - interval '5 days')`, [ana.id]);
const lgAna = await ledger(ana.id);
r = await post(sAna, '/api/cliente/resgatar', { valor: 0.1, forma: 'pix' });
t('resgate PIX (fluxo existente) continua pendente e debita', r.s === 200 && r.j.status === 'pendente' && near(r.j.novo_saldo, lgAna.saldo - 0.1), JSON.stringify(r.j));
const hist = (await get(sAna, '/api/cliente/historico')).j.find((m) => m.tipo_operacao === 'resgate_pix');
t('histórico mostra o PIX como "aguardando aprovação"', hist?.status === 'pendente' && /aguardando/i.test(hist.status_rotulo));
const idPix = (await q(`SELECT id FROM resgates WHERE id_cliente=$1 ORDER BY id DESC LIMIT 1`, [ana.id]))[0].id;
t('admin aprova o PIX; histórico passa a "aprovado"', (await patch(admin, `/api/admin/resgates/${idPix}`, { status: 'aprovado' })).s === 200 && (await get(sAna, '/api/cliente/historico')).j.find((m) => m.tipo_operacao === 'resgate_pix').status === 'aprovado');
lg = await ledger(ana.id);
t('Ana: saldo = razão no final', near(lg.saldo, lg.razao), JSON.stringify(lg));
t('rotas antigas do admin respondem', (await get(admin, '/api/admin/dashboard')).s === 200 && (await get(admin, '/api/admin/transacoes')).s === 200 && (await get(admin, '/api/admin/qrcode/listar')).s === 200 && (await get(admin, '/api/admin/resgates')).s === 200 && (await get(admin, '/api/admin/relatorios/lojas')).s === 200);
t('rotas antigas da loja respondem', (await get(sL1, '/api/loja/dashboard')).s === 200 && (await get(sL1, '/api/loja/historico')).s === 200 && (await get(sL1, '/api/loja/vendas')).s === 200);
const dashL = (await get(sL1, '/api/loja/vendas')).j;
t('voucher não polui "vendas com moedas" da loja (só descontos por QR)', dashL.vendas.every((v) => !/Recompensa:/.test(v.produto)));
// bloqueio invalida sessão (regressão de segurança)
await post(admin, `/api/admin/usuarios/${bruno.id}/bloquear`);
t('aluno bloqueado perde acesso às rotas novas imediatamente (401)', (await get(sBruno, '/api/cliente/dashboard')).s === 401 && (await post(sBruno, `/api/cliente/recompensas/${rD}/resgatar`, { chave: uid() })).s === 401);

console.log('\n== 9. Painel de impacto ambiental ==');
r = await get(admin, '/api/admin/impacto');
t('impacto responde com estrutura completa', r.s === 200 && r.j.resumo && r.j.serie && r.j.por_material.length === 4 && r.j.por_loja && r.j.participacao && r.j.meta_mensal && r.j.metodologia && r.j.anterior && r.j.variacao);
const dias = r.j.periodo;
const [esp] = await q(`SELECT count(*)::int AS n, COALESCE(sum(kg),0)::float8 AS kg, COALESCE(sum(valor),0)::float8 AS cred, count(DISTINCT id_cliente)::int AS part
  FROM transacoes WHERE tipo='credito' AND categoria='reciclagem'
  AND criado_em >= (($1::date)::timestamp AT TIME ZONE 'America/Sao_Paulo') AND criado_em < (($2::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')`, [dias.de, dias.ate]);
t('indicadores batem com a contagem direta no banco', r.j.resumo.operacoes === esp.n && near(r.j.resumo.kg, esp.kg) && near(r.j.resumo.creditos, esp.cred) && r.j.resumo.participantes === esp.part, JSON.stringify({ api: r.j.resumo, esp }));
t('série tem 1 ponto por dia (30) e soma = total', r.j.serie.length === 30 && r.j.serie.reduce((s, p) => s + p.operacoes, 0) === r.j.resumo.operacoes);
const [esp2] = await q(`SELECT COALESCE(sum((materiais->>'papelao')::numeric),0)::float8 AS p, COALESCE(sum((materiais->>'plastico')::numeric),0)::float8 AS pl FROM transacoes WHERE tipo='credito' AND categoria='reciclagem' AND criado_em >= (($1::date)::timestamp AT TIME ZONE 'America/Sao_Paulo') AND criado_em < (($2::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')`, [dias.de, dias.ate]);
const pm = Object.fromEntries(r.j.por_material.map((m) => [m.material, m]));
t('unidades por material batem com o banco; kg = unidades × 0,05', pm.papelao.unidades === esp2.p && pm.plastico.unidades === esp2.pl && near(pm.papelao.kg, esp2.p * 0.05));
t('resgates/estornos NÃO entram na reciclagem', (await q(`SELECT count(*)::int AS n FROM transacoes WHERE categoria='resgate' AND criado_em > now() - interval '1 day'`))[0].n > 0 && r.j.resumo.operacoes === esp.n);
t('resposta não contém dados pessoais (nome/e-mail de alunos)', !/@teste\.local|Ana Silva|Bruno Silva|Carla Silva/.test(JSON.stringify(r.j)));
t('sem estimativa de CO₂ no painel novo (metodologia declarada)', !/co2/i.test(JSON.stringify(Object.keys(r.j.resumo))) && /Nenhuma emiss/i.test(r.j.metodologia.impacto_ambiental));
// filtros
r = await get(admin, `/api/admin/impacto?loja=${l1.id}&dias=7`);
const [espL] = await q(`SELECT count(*)::int AS n FROM transacoes WHERE tipo='credito' AND categoria='reciclagem' AND id_loja=$1 AND criado_em >= now() - interval '8 days'`, [l1.id]);
t('filtro por loja (ponto de coleta) limita os resultados', r.s === 200 && r.j.resumo.operacoes === espL.n && r.j.por_loja.every((l) => l.id === l1.id) && r.j.serie.length === 7, JSON.stringify(r.j.resumo));
r = await get(admin, `/api/admin/impacto?material=aluminio&loja=${l1.id}&dias=7`);
const [espA] = await q(`SELECT count(*)::int AS n, COALESCE(sum((materiais->>'aluminio')::numeric),0)::float8 AS u FROM transacoes WHERE tipo='credito' AND categoria='reciclagem' AND id_loja=$1 AND COALESCE((materiais->>'aluminio')::numeric,0) > 0 AND criado_em >= now() - interval '8 days'`, [l1.id]);
t('filtro por material: só operações com o material; unidades e kg derivados; créditos omitidos', r.j.resumo.operacoes === espA.n && r.j.resumo.unidades === espA.u && near(r.j.resumo.kg, espA.u * 0.05) && r.j.resumo.creditos === null && r.j.por_material.length === 1);
r = await get(admin, '/api/admin/impacto?de=2020-01-01&ate=2020-01-10');
t('período sem registros: zeros, série preenchida e sem erro', r.s === 200 && r.j.resumo.operacoes === 0 && r.j.resumo.kg === 0 && r.j.serie.length === 10 && r.j.serie.every((p) => p.operacoes === 0) && r.j.por_loja.length === 0 && r.j.variacao.operacoes === null);
t('granularidade semanal/mensal conforme o período', (await get(admin, '/api/admin/impacto?dias=120')).j.periodo.granularidade === 'semana' && (await get(admin, '/api/admin/impacto?dias=300')).j.periodo.granularidade === 'mes');
t('datas inválidas/invertidas/período > 366 → 400', (await get(admin, '/api/admin/impacto?de=2026-13-45')).s === 400 && (await get(admin, '/api/admin/impacto?de=2026-05-10&ate=2026-05-01')).s === 400 && (await get(admin, '/api/admin/impacto?de=2024-01-01&ate=2026-01-01')).s === 400 && (await get(admin, '/api/admin/impacto?dias=0')).s === 400);
t('material/loja inválidos → 400; injeção em parâmetro é neutra', (await get(admin, '/api/admin/impacto?material=ouro')).s === 400 && (await get(admin, "/api/admin/impacto?loja=1;DROP TABLE usuarios")).s === 400 && (await q(`SELECT 1 FROM usuarios LIMIT 1`)).length === 1);
// duplicidade não infla: reenviar confirmação não muda o total
const antes = (await get(admin, '/api/admin/impacto?dias=1')).j.resumo.operacoes;
await post(sAna, '/api/qr/confirmar', { token: f.token }); await post(sCarla, '/api/qr/confirmar', { token: f.token });
t('repetir confirmações de QR já usados não infla o painel', (await get(admin, '/api/admin/impacto?dias=1')).j.resumo.operacoes === antes);
r = await get(admin, '/api/admin/impacto?dias=30');
t('participação: % de clientes ativos que reciclaram', r.j.participacao.clientes_ativos >= r.j.participacao.participantes && r.j.participacao.percentual === Math.round((r.j.participacao.participantes / r.j.participacao.clientes_ativos) * 1000) / 10);
t('meta mensal agregada coerente (atingiram ≤ participantes)', r.j.meta_mensal.atingiram <= r.j.meta_mensal.participantes_no_mes && r.j.meta_mensal.meta_kg_por_cliente === 2);

console.log('\n== 10. Cabeçalhos e CSRF nas rotas novas ==');
const csrf = await fetch(BASE + `/api/cliente/recompensas/${rD}/resgatar`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: sCarla.cookie, Origin: 'https://evil.example', 'X-Forwarded-For': '198.51.100.77' }, body: JSON.stringify({ chave: uid() }) });
t('POST de outra origem é barrado (CSRF) nas rotas novas', csrf.status === 403);
const grande = await fetch(BASE + `/api/admin/recompensas`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: admin.cookie, 'X-Forwarded-For': '198.51.100.78' }, body: JSON.stringify({ nome: 'x'.repeat(20000), custo: 1 }) });
t('corpo > 10 KB é recusado (413)', grande.status === 413);
t('respostas não são cacheáveis', (await fetch(BASE + '/api/cliente/recompensas', { headers: { Cookie: sAna.cookie, 'X-Forwarded-For': '198.51.100.79' } })).headers.get('cache-control') === 'no-store');

console.log(`\nRESULTADO: ${pass} passaram, ${fail} falharam`);
await db.end();
process.exit(fail ? 1 : 0);
