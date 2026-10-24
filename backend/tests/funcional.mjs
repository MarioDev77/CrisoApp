import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
const B = process.env.BASE || 'http://localhost:3200';
import fs from 'node:fs';
// Lê JWT_SECRET e a conexão do .env local (nunca versione segredos reais).
const envFile = Object.fromEntries(fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n').filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.split('=')[0], l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]));
const SECRET = process.env.JWT_SECRET || envFile.JWT_SECRET;
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || envFile.ADMIN_EMAIL).toLowerCase(), ADMIN_SENHA = process.env.ADMIN_SENHA || envFile.ADMIN_SENHA;
const DB_URL = process.env.DATABASE_URL || envFile.DATABASE_URL;
const R = []; const rec = (n, ok, d='') => { R.push({n, ok, d}); console.log((ok?'PASS ':'FAIL ')+n+(d?'  -> '+d:'')); };
const t = (n, c, d) => rec(n, !!c, d);
const sql = q => execSync('psql "$DB_URL" -tA -c "$Q"', { env: { ...process.env, DB_URL, Q: q } }).toString().trim();
let ipSeq = 10;
const novoIp = () => `203.0.113.${ipSeq++}`;

// cliente HTTP com "jar" de cookie por sessão
function sessao(ip = novoIp()) {
  const s = { cookie: '', ip };
  s.call = async (m, p, body, extra = {}) => {
    const h = { 'Content-Type': 'application/json', ...extra };
    if (s.ip) h['X-Forwarded-For'] = s.ip;
    if (s.cookie) h.Cookie = s.cookie;
    const r = await fetch(B + p, { method: m, headers: h, body: (body === undefined || body === null) ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
    const sc = r.headers.getSetCookie?.() ?? [];
    const c = sc.find(x => x.startsWith('__Host-crisoverde_session='));
    if (c) s.cookie = c.split(';')[0].replace(/^__Host-crisoverde_session=$/, '') === '' ? '' : c.split(';')[0];
    let j = null; try { j = await r.json(); } catch {}
    return { s: r.status, j, h: r.headers, setCookie: sc };
  };
  return s;
}
const login = async (email, senha, ip) => { const x = sessao(ip); const r = await x.call('POST', '/api/auth/login', { email, senha }); return { x, r }; };

// --- infraestrutura / cabeçalhos
const anon = sessao();
let r = await anon.call('GET', '/api/health'); t('health 200', r.s === 200);
r = await anon.call('GET', '/api/ready'); t('ready 200 (banco ok)', r.s === 200);
t('cabeçalhos de segurança presentes', r.h.get('x-frame-options') === 'DENY' && r.h.get('x-content-type-options') === 'nosniff' && /default-src 'self'/.test(r.h.get('content-security-policy') || ''));

// --- admin: sessão por cookie HttpOnly
const A = await login(ADMIN_EMAIL, ADMIN_SENHA);
t('login admin 200', A.r.s === 200 && A.r.j?.perfil?.tipo === 'admin', `status ${A.r.s}`);
const sc = A.r.setCookie.find(x => x.startsWith('__Host-crisoverde_session=')) || '';
t('cookie de sessão é HttpOnly + SameSite=Strict', /HttpOnly/i.test(sc) && /SameSite=Strict/i.test(sc), sc.replace(/=[^;]+/, '=…').slice(0, 90));
t('token NÃO vem no corpo JSON (LEGACY_BEARER=false)', A.r.j && !('token' in A.r.j));
t('id do admin é número', typeof A.r.j?.perfil?.id === 'number', `typeof=${typeof A.r.j?.perfil?.id}`);
const adm = A.x; const admId = A.r.j.perfil.id;

r = await anon.call('POST', '/api/auth/login', { email: ADMIN_EMAIL, senha: 'errada1234' }); t('senha errada → 401', r.s === 401);
r = await anon.call('POST', '/api/auth/login', '{json quebrado'); t('JSON malformado → 400', r.s === 400, `status ${r.s}`);
r = await anon.call('POST', '/api/auth/login', { email: 'x@y.com', senha: 'a'.repeat(20000) }); t('corpo > 10 KB → 413', r.s === 413, `status ${r.s}`);
r = await anon.call('POST', '/api/auth/login', { email: 'nao-e-email', senha: 'abc12345' }); t('e-mail inválido → 400', r.s === 400 && /inválido/i.test(r.j?.mensagem || ''), r.j?.mensagem);

// --- cliente
const maria = sessao();
r = await maria.call('POST', '/api/auth/cadastro', { nome: "Maria O'Neil", email: 'maria@email.com', senha: 'Senha1234', telefone: '11999' });
t('cadastro cliente → 201', r.s === 201, `status ${r.s} ${r.j?.mensagem || ''}`);
const loginSemIp = sessao(null);
const sufixoLimite = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let bloqueiosIpDesconhecido = 0;
for (let i = 0; i < 70; i++) {
  const tentativa = await loginSemIp.call('POST', '/api/auth/login', { email: `tentativa-${sufixoLimite}-${i}@example.test`, senha: 'SenhaIncorreta1' });
  if (tentativa.s === 429) bloqueiosIpDesconhecido++;
}
t('70 logins com e-mails diferentes e IP desconhecido não ativam limite global', bloqueiosIpDesconhecido === 0, `429=${bloqueiosIpDesconhecido}`);
const loginValidoSemIp = await loginSemIp.call('POST', '/api/auth/login', { email: 'maria@email.com', senha: 'Senha1234' });
t('login válido continua aceito após 70 e-mails distintos sem IP', loginValidoSemIp.s === 200, `status ${loginValidoSemIp.s}`);
const emailTentado = `repetido-${sufixoLimite}@example.test`;
let ultimaTentativa;
for (let i = 0; i < 11; i++) ultimaTentativa = await loginSemIp.call('POST', '/api/auth/login', { email: emailTentado, senha: 'SenhaIncorreta1' });
t('11 tentativas para o mesmo e-mail e IP desconhecido → 429 com Retry-After', ultimaTentativa.s === 429 && /^\d+$/.test(ultimaTentativa.h.get('retry-after') || ''), `status ${ultimaTentativa.s} retry-after=${ultimaTentativa.h.get('retry-after')}`);
r = await sessao().call('POST', '/api/auth/cadastro', { nome: 'Outra', email: 'MARIA@Email.com', senha: 'Senha1234' });
t('e-mail duplicado com outra caixa → 400 (regressão corrigida)', r.s === 400, `status ${r.s}`);
t('nome gravado SEM escape duplo de HTML', sql("select nome from usuarios where email='maria@email.com'") === "Maria O'Neil", sql("select nome from usuarios where email='maria@email.com'"));
r = await sessao().call('POST', '/api/auth/cadastro', { nome: 'Fraca', email: 'fraca@email.com', senha: 'abcdefgh' }); t('senha sem número → 400', r.s === 400);
const mariaId = Number(sql("select id from usuarios where email='maria@email.com'"));
r = await maria.call('GET', '/api/cliente/carteira'); t('carteira inicial zerada', r.s === 200 && r.j.saldo === 0 && typeof r.j.total_trocas === 'number', JSON.stringify(r.j));

// --- loja
r = await adm.call('POST', '/api/admin/lojas', { nome: 'Loja T', responsavel: 'Resp', email: 'Loja@T.com', senha: 'LojaSenha123', telefone: '1', endereco: 'Rua' });
t('admin cria loja', r.s === 200 && typeof r.j?.loja?.id === 'number', `status ${r.s} ${JSON.stringify(r.j)}`);
const lojaId = r.j?.loja?.id;
const L = await login('loja@t.com', 'LojaSenha123'); t('login loja', L.r.s === 200 && L.r.j.perfil?.tipo === 'loja'); const loja = L.x;
sql(`insert into lojas(nome,responsavel,email,senha,status) select 'P','P','pend@t.com',senha,'pendente' from lojas where id=${lojaId}`);
r = (await login('pend@t.com', 'LojaSenha123')).r; t('loja PENDENTE não loga (corrigido)', r.s === 403, `status ${r.s}`);

// --- QR crédito
r = await loja.call('POST', '/api/qr/gerar', { valor: 1, materiais: { papelao: 14, plastico: 0, aluminio: 0, vidro: 0 } });
t('loja gera QR crédito', r.s === 200 && r.j.token && typeof r.j.id_transacao === 'number', `status ${r.s} ${JSON.stringify(r.j)}`);
const qr1 = r.j?.token;
r = await maria.call('POST', '/api/qr/validar', { token: qr1 }); t('cliente valida QR (0,50)', r.s === 200 && r.j.valido === true && r.j.valor === 0.5, JSON.stringify(r.j));
r = await maria.call('POST', '/api/qr/confirmar', { token: qr1 }); t('confirma crédito → saldo 0,50', r.s === 200 && r.j.novo_saldo === 0.5, `status ${r.s} ${JSON.stringify(r.j)}`);
r = await maria.call('POST', '/api/qr/confirmar', { token: qr1 }); t('reuso do QR recusado', r.s === 400);
r = await maria.call('GET', '/api/cliente/carteira'); t('carteira: ganho 0,50 / 0,70 kg / 1 troca', r.j.saldo === 0.5 && r.j.total_ganho === 0.5 && r.j.total_reciclado_kg === 0.7 && r.j.total_trocas === 1, JSON.stringify(r.j));

// --- QR débito
r = await loja.call('POST', '/api/qr/gerar', { valor: 0.25, tipo: 'debito', produto: 'Caneta' }); const qr2 = r.j?.token; t('gera QR débito', r.s === 200 && qr2);
r = await maria.call('POST', '/api/qr/confirmar', { token: qr2 }); t('confirma débito → saldo 0,25', r.s === 200 && r.j.novo_saldo === 0.25, `status ${r.s} ${JSON.stringify(r.j)}`);
r = await loja.call('POST', '/api/qr/gerar', { valor: 5, tipo: 'debito', produto: 'Caro' });
r = await maria.call('POST', '/api/qr/confirmar', { token: r.j.token }); t('débito sem saldo → 400', r.s === 400 && /insuficiente/i.test(r.j?.mensagem || ''));
r = await loja.call('POST', '/api/qr/gerar', { valor: 0, tipo: 'debito', produto: 'X' }); t('débito valor 0 → 400', r.s === 400);

// --- resgate (estava quebrado antes)
r = await maria.call('POST', '/api/cliente/resgatar', { valor: 0.1, forma: 'pix' }); t('resgate válido → saldo 0,15 (antes: 500)', r.s === 200 && r.j.novo_saldo === 0.15, `status ${r.s} ${JSON.stringify(r.j)}`);
r = await maria.call('POST', '/api/cliente/resgatar', { valor: 99 }); t('resgate acima do saldo → 400', r.s === 400);
r = await maria.call('POST', '/api/cliente/resgatar', { valor: -5 }); t('resgate negativo → 400', r.s === 400);
r = await maria.call('GET', '/api/cliente/historico'); t('histórico cliente: 3 itens, ids numéricos', r.s === 200 && r.j.length === 3 && typeof r.j[0].id === 'number', `len=${r.j?.length}`);
r = await maria.call('GET', '/api/cliente/historico?tipo=debito'); t('histórico filtrado (2 débitos)', r.j.length === 2);
r = await maria.call('GET', '/api/cliente/historico?tipo=xxx'); t('filtro inválido → 400', r.s === 400);

// --- identificação e busca
r = await maria.call('GET', '/api/cliente/meu-qr'); const qd = r.j?.qr_data; t('meu-qr gera identificador', r.s === 200 && qd);
r = await loja.call('POST', '/api/cliente/identificar', { qr_data: qd }); t('loja identifica cliente', r.s === 200 && r.j.nome === "Maria O'Neil" && r.j.id_cliente === mariaId, JSON.stringify(r.j));
r = await loja.call('POST', '/api/cliente/identificar', { qr_data: qd.slice(0, -2) + 'zz' }); t('identificador adulterado → 400', r.s === 400);
r = await loja.call('GET', '/api/loja/clientes/buscar?busca=Ma'); t('busca com menos de 3 caracteres retorna lista vazia', r.s === 200 && r.j.usuarios.length === 0, `n=${r.j?.usuarios?.length}`);
r = await loja.call('GET', '/api/loja/clientes/buscar?busca=maria%40'); t('busca por parte de e-mail não encontra cliente', r.s === 200 && r.j.usuarios.length === 0, `n=${r.j?.usuarios?.length}`);
r = await loja.call('GET', '/api/loja/clientes/buscar?busca=MARIA%40EMAIL.COM&limite=20');
t('e-mail exato encontra cliente sem expor saldo/trocas', r.s === 200 && r.j.usuarios.length === 1 && r.j.usuarios[0].id === mariaId && !('saldo' in r.j.usuarios[0]) && !('total_trocas' in r.j.usuarios[0]), JSON.stringify(r.j));
r = await loja.call('GET', '/api/loja/clientes/buscar?busca=O%27Neil'); t('busca por nome com apóstrofo (3+ caracteres) funciona sem dados de saldo', r.s === 200 && r.j.usuarios.length === 1 && !('saldo' in r.j.usuarios[0]), `n=${r.j?.usuarios?.length}`);
const prefixBusca = `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
for (let i = 0; i < 6; i++) sql(`insert into usuarios(nome,email,senha,tipo,status) values ('Cliente ${prefixBusca} ${i}','${prefixBusca}${i}@example.test',NULL,'cliente','ativo')`);
r = await loja.call('GET', `/api/loja/clientes/buscar?busca=${prefixBusca}&limite=20`);
t('busca da loja retorna no máximo 5 resultados', r.s === 200 && r.j.usuarios.length === 5, `n=${r.j?.usuarios?.length}`);
sql(`delete from usuarios where email like '${prefixBusca}%'`);
for (let i = 0; i < 10; i++) r = await loja.call('GET', '/api/loja/clientes/buscar?busca=O%27Neil');
t('busca pela loja permite 15 chamadas na janela', r.s === 200, `status ${r.s}`);
r = await loja.call('GET', '/api/loja/clientes/buscar?busca=O%27Neil');
t('16ª busca pela loja em 15 min → 429 com Retry-After', r.s === 429 && /^\d+$/.test(r.h.get('retry-after') || ''), `status ${r.s} retry-after=${r.h.get('retry-after')}`);

// --- painel loja
const mes = new Date().toISOString().slice(0, 7);
for (const [p, ck] of [['/api/loja/perfil', j => j.email === 'loja@t.com'], ['/api/loja/dashboard', j => j.total_trocas === 1 && j.total_kg === 0.7], ['/api/loja/historico', j => j.trocas?.length === 1], ['/api/loja/historico?dias=7', j => j.trocas?.length === 1], ['/api/loja/vendas', j => j.total_vendas === 1 && j.total_debitado === 0.25], ['/api/loja/vendas?mes=' + mes, j => j.total_vendas === 1], ['/api/config/taxas', j => j.papelao === 7]]) {
  r = await loja.call('GET', p); t('GET ' + p, r.s === 200 && ck(r.j || {}), `status ${r.s} ${JSON.stringify(r.j).slice(0, 100)}`);
}

// --- painel admin
for (const [p, ck] of [['/dashboard', j => j.total_clientes === 1 && j.total_lojas === 2 && j.lojas_pendentes === 1 && j.total_trocas === 1 && j.total_resgates === 2 && j.materiais_mes.papelao === 14], ['/usuarios', j => j.total === 1], ['/usuarios?status=ativo', j => j.total === 1], ['/lojas', j => j.lojas?.length === 1 && j.lojas[0].total_trocas === 1], ['/lojas/pendentes', j => j.lojas?.length === 1], ['/transacoes', j => j.total === 3], ['/transacoes?tipo=credito&dias=30', j => j.total === 1], ['/transacoes?tipo=resgate', j => j.total === 2], ['/qrcode/listar', j => j.total >= 3 && j.metricas.usados === 2], ['/qrcode/listar?status=usado', j => j.total === 2], ['/qrcode/listar?status=expirado', j => typeof j.total === 'number'], ['/configuracoes/taxas', j => j.papelao === 7], ['/relatorios/lojas', j => j.lojas?.find(l => l.nome === 'Loja T')?.total_trocas === 1], ['/relatorios/lojas?mes=' + mes, j => j.lojas?.find(l => l.nome === 'Loja T')?.total_debitos === 0.25], ['/auditoria', j => j.total >= 1]]) {
  r = await adm.call('GET', '/api/admin' + p); t('admin GET ' + p, r.s === 200 && ck(r.j || {}), `status ${r.s} ${JSON.stringify(r.j).slice(0, 110)}`);
}
r = await adm.call('POST', '/api/admin/configuracoes/taxas', { papelao: 5, plastico: 10, aluminio: 6, vidro: 4 }); t('admin altera taxas (upsert)', r.s === 200 && r.j.taxas.papelao === 5);
r = await loja.call('GET', '/api/config/taxas'); t('nova taxa vale para a loja', r.j.papelao === 5);
await adm.call('POST', '/api/admin/configuracoes/taxas', { papelao: 7, plastico: 10, aluminio: 6, vidro: 4 });
r = await adm.call('POST', '/api/admin/configuracoes-qr', { expiracao_segundos: 60, max_tentativas: 5 }); t('admin altera config QR', r.s === 200);
r = await loja.call('POST', '/api/qr/gerar', { valor: 1, materiais: { papelao: 7 } }); const qr4 = r.j?.token;
r = await adm.call('POST', '/api/admin/qrcode/invalidar', { token: qr4 }); t('admin invalida QR', r.s === 200);
r = await maria.call('POST', '/api/qr/confirmar', { token: qr4 }); t('QR invalidado não confirma', r.s === 400);
r = await adm.call('POST', '/api/admin/qrcode/invalidar', { token: qr1 }); t('não é possível "invalidar" QR já usado', r.s === 404);
r = await adm.call('GET', '/api/admin/auditoria?acao=admin_invalidou_qrcode'); t('auditoria registrou ação admin', r.j?.total === 1);

// --- autorização
r = await maria.call('GET', '/api/admin/dashboard'); t('cliente em rota admin → 403', r.s === 403);
r = await loja.call('GET', '/api/admin/dashboard'); t('loja em rota admin → 403', r.s === 403);
r = await loja.call('GET', '/api/cliente/carteira'); t('loja em rota cliente → 403', r.s === 403);
r = await maria.call('GET', '/api/loja/perfil'); t('cliente em rota loja → 403', r.s === 403);
r = await anon.call('GET', '/api/admin/dashboard'); t('sem sessão → 401', r.s === 401);
r = await sessao().call('GET', '/api/admin/dashboard', undefined, { Authorization: 'Bearer abc.def.ghi' }); t('Bearer ignorado quando LEGACY_BEARER=false', r.s === 401);

// --- validação de entrada
r = await adm.call('POST', '/api/admin/usuarios/abc/bloquear', {}); t('id não numérico → 400 (antes 500)', r.s === 400, `status ${r.s}`);
r = await adm.call('POST', '/api/admin/usuarios/99999999999/bloquear', {}); t('id gigante → 400', r.s === 400);
r = await loja.call('GET', '/api/loja/historico?dias=abc'); t('dias=abc → 400 (antes 500)', r.s === 400, `status ${r.s}`);
r = await maria.call('POST', '/api/qr/validar', {}); t('validar sem token → 400', r.s === 400);
r = await adm.call('POST', '/api/admin/usuarios/' + admId + '/bloquear', {}); t('admin NÃO consegue bloquear admin/si mesmo', r.s === 404, `status ${r.s}`);
r = await adm.call('DELETE', '/api/admin/usuarios/' + admId); t('admin NÃO consegue apagar admin/si mesmo', r.s === 404);

// --- anti-fraude de crédito
r = await loja.call('POST', '/api/qr/gerar', { valor: 1, materiais: { papelao: 7000000 } }); t('QR com 7.000.000 unidades → 400 (antes: R$ 250 mil)', r.s === 400, `status ${r.s} ${r.j?.mensagem}`);
r = await loja.call('POST', '/api/qr/gerar', { valor: 1, materiais: { papelao: 1001 } }); t('1.001 unidades (> teto 1000) → 400', r.s === 400);
r = await loja.call('POST', '/api/qr/gerar', { valor: 1, materiais: { papelao: 3 } }); t('quantidade que não gera crédito → 400', r.s === 400);
r = await loja.call('POST', '/api/qr/gerar', { valor: 1, materiais: { papelao: -5 } }); t('quantidade negativa → 400', r.s === 400);

// --- concorrência financeira
{ const atual = Number(sql(`select saldo from usuarios where id=${mariaId}`)); const delta = (1.00 - atual).toFixed(2);
  sql(`update usuarios set saldo=1.00 where id=${mariaId}`);
  sql(`insert into transacoes(id_cliente,nome_cliente,tipo,categoria,valor,kg,materiais_desc) values (${mariaId},'ajuste de teste','credito','reciclagem',${delta},0,'-')`); }
const resg = await Promise.all(Array.from({ length: 6 }, () => maria.call('POST', '/api/cliente/resgatar', { valor: 0.5 })));
const okR = resg.filter(x => x.s === 200).length; const saldoF = sql(`select saldo from usuarios where id=${mariaId}`);
t('6 resgates simultâneos de 0,50 com saldo 1,00: exatamente 2 passam, saldo 0', okR === 2 && Number(saldoF) === 0, `aprovados=${okR} saldo=${saldoF} status=${resg.map(x => x.s)}`);
r = await loja.call('POST', '/api/qr/gerar', { valor: 1, materiais: { papelao: 7 } }); const qr5 = r.j?.token;
const cf = await Promise.all(Array.from({ length: 5 }, () => maria.call('POST', '/api/qr/confirmar', { token: qr5 })));
t('5 confirmações simultâneas do MESMO QR: só 1 credita', cf.filter(x => x.s === 200).length === 1, `status=${cf.map(x => x.s)}`);
t('saldo final consistente (0,25 do único crédito)', Number(sql(`select saldo from usuarios where id=${mariaId}`)) === 0.25);

// --- bloqueio invalida sessão existente
r = await adm.call('POST', `/api/admin/usuarios/${mariaId}/bloquear`, {}); t('admin bloqueia cliente', r.s === 200);
r = await maria.call('GET', '/api/cliente/carteira'); t('cookie ANTIGO de usuário bloqueado → 401 (antes: 200)', r.s === 401, `status ${r.s}`);
r = (await login('maria@email.com', 'Senha1234')).r; t('bloqueado não consegue logar', r.s === 403);
r = await adm.call('POST', `/api/admin/usuarios/${mariaId}/desbloquear`, {}); t('admin desbloqueia', r.s === 200);

// --- recuperação de senha + revogação de sessão
const M2 = await login('maria@email.com', 'Senha1234'); const maria2 = M2.x;
r = await anon.call('POST', '/api/auth/forgot-password', { email: 'maria@email.com' }); t('forgot-password resposta genérica', r.s === 200);
r = await sessao().call('POST', '/api/auth/forgot-password', { email: 'naoexiste@email.com' }); t('forgot para e-mail inexistente: mesma resposta', r.s === 200 && /Se este e-mail/.test(r.j.mensagem));
t('código OTP gravado como hash (não em claro)', /^[0-9a-f]{64}$/.test(sql(`select codigo_hash from password_reset_codes where usuario_id=${mariaId} order by id desc limit 1`)));
const h = crypto.createHmac('sha256', SECRET).update('reset:123456').digest('hex');
sql(`update password_reset_codes set codigo_hash='${h}' where usuario_id=${mariaId}`);
const ipR = novoIp();
r = await sessao(ipR).call('POST', '/api/auth/verify-reset-code', { email: 'maria@email.com', codigo: '000000' }); t('código errado → 400', r.s === 400);
r = await sessao(ipR).call('POST', '/api/auth/verify-reset-code', { email: 'maria@email.com', codigo: '123456' }); t('código correto → resetToken', r.s === 200 && r.j.resetToken);
const rt = r.j?.resetToken;
r = await anon.call('POST', '/api/auth/reset-password', { resetToken: rt, novaSenha: 'NovaSenha987' }); t('reset de senha', r.s === 200);
r = await anon.call('POST', '/api/auth/reset-password', { resetToken: rt, novaSenha: 'OutraSenha987' }); t('reuso do resetToken → 400', r.s === 400);
r = await maria2.call('GET', '/api/cliente/carteira'); t('sessão anterior ao reset foi revogada → 401', r.s === 401, `status ${r.s}`);
r = (await login('maria@email.com', 'NovaSenha987')).r; t('login com senha nova', r.s === 200);
// força bruta no OTP: 5 tentativas erradas travam o código
await anon.call('POST', '/api/auth/forgot-password', { email: 'maria@email.com' }).catch(() => {});
sql(`update password_reset_codes set codigo_hash='${h}' where usuario_id=${mariaId} and utilizado=false`);
const ip2 = novoIp(); let ult;
for (let i = 0; i < 6; i++) ult = await sessao(ip2).call('POST', '/api/auth/verify-reset-code', { email: 'maria@email.com', codigo: String(100000 + i) });
t('após 5 tentativas erradas o código trava (429)', ult.s === 429, `status ${ult.s}`);
r = await sessao(ip2).call('POST', '/api/auth/verify-reset-code', { email: 'maria@email.com', codigo: '123456' }); t('mesmo o código certo é recusado depois de travar', r.s === 429, `status ${r.s}`);

// --- logout revoga
const M3 = await login('maria@email.com', 'NovaSenha987'); const m3 = M3.x;
r = await m3.call('POST', '/api/auth/logout'); t('logout 200', r.s === 200);
r = await sessao().call('GET', '/api/cliente/carteira', undefined, { Cookie: M3.x.cookie }); t('cookie anterior ao logout não vale mais', r.s === 401, `status ${r.s}`);

// --- CSRF
r = await sessao().call('POST', '/api/auth/login', { email: 'a@b.com', senha: 'x' }, { Origin: 'https://evil.example' }); t('POST com Origin de outro site → 403', r.s === 403, `status ${r.s}`);
r = await sessao().call('POST', '/api/auth/login', { email: 'a@b.com', senha: 'x' }, { 'Sec-Fetch-Site': 'cross-site' }); t('POST com Sec-Fetch-Site cross-site → 403', r.s === 403);
r = await sessao().call('POST', '/api/auth/login', { email: 'a@b.com', senha: 'x' }, { Origin: B }); t('POST de mesma origem passa (401 de credencial, não 403)', r.s === 401, `status ${r.s}`);

// --- rate limit
const ipL = novoIp(); const rl = sessao(ipL); let last, ra;
for (let i = 0; i < 12; i++) { last = await rl.call('POST', '/api/auth/login', { email: 'rl@x.com', senha: 'xxxxxxxx1' }); if (i === 10) ra = last.h.get('retry-after'); }
t('login: 429 após 10 tentativas (mesmo e-mail) + Retry-After', last.s === 429 && Number(ra) > 0, `status=${last.s} retry-after=${ra}`);
// spoof de X-Forwarded-For: o salto confiável é o ÚLTIMO; mudar o primeiro não burla o limite
let bloqueado = 0; const ipFixo = novoIp();
for (let i = 0; i < 12; i++) { const r2 = await sessao().call('POST', '/api/auth/login', { email: 'spoof@x.com', senha: 'xxxxxxxx1' }, { 'X-Forwarded-For': `9.9.9.${i}, ${ipFixo}` }); if (r2.s === 429) bloqueado++; }
t('spoof de X-Forwarded-For (1º salto) NÃO burla o rate limit', bloqueado >= 1, `429 em ${bloqueado}/12`);
// limite por IP entre e-mails diferentes (credential stuffing)
let n429 = 0; const ipS = novoIp();
for (let i = 0; i < 65; i++) { const r3 = await sessao(ipS).call('POST', '/api/auth/login', { email: `stuff${i}@x.com`, senha: 'xxxxxxxx1' }); if (r3.s === 429) n429++; }
t('credential stuffing (65 e-mails, 1 IP): bloqueado por IP', n429 >= 4, `429 em ${n429}/65`);
// sem IP confiável não derruba todo mundo
r = await sessao('').call('GET', '/api/health', undefined, { 'X-Forwarded-For': '' }); t('requisição sem cabeçalho de proxy continua atendida', r.s === 200);

// --- Google não configurado
r = await anon.call('GET', '/api/auth/google/client-id'); t('google/client-id responde', r.s === 200 && 'clientId' in r.j);
r = await anon.call('POST', '/api/auth/google', { credential: 'x'.repeat(30) }); t('login Google sem GOOGLE_CLIENT_ID → 503', r.s === 503, `status ${r.s}`);

// --- integridade final
t('nenhum saldo negativo no banco', sql('select count(*) from usuarios where saldo < 0') === '0');
t('e-mails todos em minúsculas', sql('select count(*) from usuarios where email <> lower(email)') === '0' && sql('select count(*) from lojas where email <> lower(email)') === '0');
t('saldo de cada cliente = créditos − débitos', sql(`select count(*) from usuarios u where tipo='cliente' and saldo <> coalesce((select sum(case when tipo='credito' then valor else -valor end) from transacoes where id_cliente=u.id),0)`) === '0');

const f = R.filter(x => !x.ok);
console.log(`\nTOTAL ${R.length}  PASS ${R.length - f.length}  FAIL ${f.length}`);
f.forEach(x => console.log('  FAIL:', x.n, '|', x.d));
process.exit(f.length ? 1 : 0);
