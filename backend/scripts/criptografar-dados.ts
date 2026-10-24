import "dotenv/config";
import { prisma } from "../src/lib/db";
import { cifrar, decifrar, estaCifrado, hashEmail, hashTelefone, hashTokenQr, indiceCego, chaveRateLimit, mascararEmail, mascararTelefone, normalizarEmail, normalizarTelefone, precisaRotacionar } from "../src/lib/crypto";

const LOTE = 500;
const dryRun = process.argv.includes("--dry-run");
const confirmado = process.argv.includes("--confirm-test-db");

function textoCifradoAtual(valor: string | null, contexto: string) {
  if (valor && estaCifrado(valor) && !precisaRotacionar(valor)) return valor;
  const claro = valor && estaCifrado(valor) ? decifrar(valor, contexto) : valor;
  return claro == null || claro === "" ? null : cifrar(claro, contexto);
}

async function main() {
  if (!dryRun && !confirmado) throw new Error("Execução real bloqueada: use --confirm-test-db somente após confirmar backup restaurável e banco de teste.");
  const db = prisma();
  const totais: Record<string, number> = {};
  const processar = async <T>(nome: string, contar: () => Promise<number>, buscar: (skip: number, take: number) => Promise<T[]>, atualizar: (tx: typeof db, item: T) => Promise<boolean>) => {
    const total = await contar();
    let feitos = 0;
    for (let offset = 0; offset < total; offset += LOTE) {
      const itens = await buscar(offset, LOTE);
      if (dryRun) {
        for (const item of itens) if (await atualizar(db, item)) feitos++;
      } else {
        await db.$transaction(async (tx) => {
          for (const item of itens) if (await atualizar(tx as typeof db, item)) feitos++;
        }, { maxWait: 10_000, timeout: 120_000 });
      }
    }
    totais[nome] = feitos;
  };

  await processar("usuarios", () => db.usuario.count(), (skip, take) => db.usuario.findMany({ skip, take }), async (tx, u) => {
    const email = normalizarEmail(u.email);
    const telefone = normalizarTelefone(u.telefone);
    const emailEnc = textoCifradoAtual(u.emailEnc, "usuarios.email") ?? cifrar(email, "usuarios.email");
    const telefoneEnc = textoCifradoAtual(u.telefoneEnc, "usuarios.telefone") ?? (telefone ? cifrar(telefone, "usuarios.telefone") : null);
    const emailHashValue = hashEmail(email);
    const telefoneHashValue = telefone ? hashTelefone(telefone) : null;
    const googleIdHash = u.googleId ? indiceCego(u.googleId, "usuarios.google_id") : null;
    if (!dryRun && (u.emailEnc !== emailEnc || u.emailHash !== emailHashValue || u.telefoneEnc !== telefoneEnc || u.telefoneHash !== telefoneHashValue || u.googleIdHash !== googleIdHash)) {
      await tx.usuario.update({ where: { id: u.id }, data: { emailEnc, emailHash: emailHashValue, telefoneEnc, telefoneHash: telefoneHashValue, googleIdHash } });
    }
    return Boolean(u.emailEnc !== emailEnc || u.emailHash !== emailHashValue || u.telefoneEnc !== telefoneEnc || u.telefoneHash !== telefoneHashValue || u.googleIdHash !== googleIdHash);
  });

  await processar("lojas", () => db.loja.count(), (skip, take) => db.loja.findMany({ skip, take }), async (tx, l) => {
    const email = normalizarEmail(l.email);
    const telefone = normalizarTelefone(l.telefone);
    const values = {
      emailEnc: textoCifradoAtual(l.emailEnc, "lojas.email") ?? cifrar(email, "lojas.email"),
      emailHash: hashEmail(email),
      telefoneEnc: textoCifradoAtual(l.telefoneEnc, "lojas.telefone") ?? (telefone ? cifrar(telefone, "lojas.telefone") : null),
      telefoneHash: telefone ? hashTelefone(telefone) : null,
      enderecoEnc: textoCifradoAtual(l.enderecoEnc, "lojas.endereco") ?? (l.endereco ? cifrar(l.endereco, "lojas.endereco") : null),
      responsavelEnc: textoCifradoAtual(l.responsavelEnc, "lojas.responsavel") ?? cifrar(l.responsavel, "lojas.responsavel"),
    };
    const changed = Object.entries(values).some(([k, v]) => l[k as keyof typeof l] !== v);
    if (!dryRun && changed) await tx.loja.update({ where: { id: l.id }, data: values });
    return changed;
  });

  await processar("qr_codes", () => db.qrCode.count(), (skip, take) => db.qrCode.findMany({ skip, take }), async (tx, q) => {
    const dados = JSON.stringify({ valor: q.valor.toString(), materiais: q.materiais, materiaisDesc: q.materiaisDesc, produto: q.produto });
    const dadosEnc = textoCifradoAtual(q.dadosEnc, "qr_codes.dados") ?? cifrar(dados, "qr_codes.dados");
    const ipEnc = textoCifradoAtual(q.ipEnc, "qr_codes.ip_gerado") ?? (q.ipGerado ? cifrar(q.ipGerado, "qr_codes.ip_gerado") : null);
    const tokenHash = hashTokenQr(q.token);
    const changed = q.dadosEnc !== dadosEnc || q.ipEnc !== ipEnc || q.tokenHash !== tokenHash;
    if (!dryRun && changed) await tx.qrCode.update({ where: { token: q.token }, data: { dadosEnc, ipEnc, tokenHash } });
    return changed;
  });

  await processar("transacoes", () => db.transacao.count({ where: { nomeCliente: { not: null } } }), (skip, take) => db.transacao.findMany({ where: { nomeCliente: { not: null } }, skip, take }), async (tx, t) => {
    const nomeClienteEnc = textoCifradoAtual(t.nomeClienteEnc, "transacoes.nome_cliente") ?? (t.nomeCliente ? cifrar(t.nomeCliente, "transacoes.nome_cliente") : null);
    if (!dryRun && t.nomeClienteEnc !== nomeClienteEnc) await tx.transacao.update({ where: { id: t.id }, data: { nomeClienteEnc } });
    return t.nomeClienteEnc !== nomeClienteEnc;
  });

  await processar("logs_auditoria", () => db.logAuditoria.count(), (skip, take) => db.logAuditoria.findMany({ skip, take }), async (tx, l) => {
    const ipEnc = textoCifradoAtual(l.ipEnc, "logs_auditoria.ip") ?? (l.ip ? cifrar(l.ip, "logs_auditoria.ip") : null);
    const detalhe = (l.detalhe ?? "").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, mascararEmail).replace(/(?:\+?\d[\d ()-]{8,}\d)/g, mascararTelefone);
    const changed = l.ipEnc !== ipEnc || l.detalhe !== detalhe;
    if (!dryRun && changed) await tx.logAuditoria.update({ where: { id: l.id }, data: { ipEnc, detalhe } });
    return changed;
  });

  await processar("rate_limits", () => db.rateLimit.count(), (skip, take) => db.rateLimit.findMany({ skip, take }), async (tx, r) => {
    if (/^[^:]+:[a-f0-9]{32}$/.test(r.chave)) return false;
    const prefixo = r.chave.split(":", 1)[0].slice(0, 100);
    const chave = `${prefixo}:${chaveRateLimit(r.chave)}`;
    if (!dryRun) await tx.rateLimit.update({ where: { chave: r.chave }, data: { chave } });
    return true;
  });

  // Em dry-run, prova a leitura e o índice sem escrever no banco.
  if (dryRun) {
    const amostra = `amostra-${Date.now()}@example.invalid`;
    if (hashEmail(decifrar(cifrar(amostra, "usuarios.email"), "usuarios.email")) !== hashEmail(amostra)) throw new Error("Falha na conferência de amostra simulada");
  } else {
    const quantidade = await db.usuario.count({ where: { emailEnc: { not: null } } });
    if (quantidade) {
      const alvo = Math.floor(Math.random() * quantidade);
      const u = await db.usuario.findFirst({ where: { emailEnc: { not: null } }, skip: alvo, select: { emailEnc: true, emailHash: true } });
      if (!u?.emailEnc || hashEmail(decifrar(u.emailEnc, "usuarios.email")) !== u.emailHash) throw new Error("A verificação da amostra de e-mail falhou");
    }
  }
  console.log(JSON.stringify({ modo: dryRun ? "dry-run" : "gravacao", alteracoes_por_tabela: totais }));
  await db.$disconnect();
}

main().catch(async () => {
  console.error("Backfill interrompido. Nenhum valor sensível foi impresso.");
  await prisma().$disconnect().catch(() => {});
  process.exitCode = 1;
});
