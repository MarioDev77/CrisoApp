import { z } from "zod";
import { api } from "@/lib/api";
import { hashSenha } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { email } from "@/lib/schemas";
import { auditar } from "@/lib/servicos";

export const GET = api({ auth: ["admin"] }, async () => {
  const lojas = await prisma().loja.findMany({ where: { status: { not: "pendente" }, deletadoEm: null }, orderBy: { id: "asc" } });
  // uma única consulta agregada (o original fazia N+1)
  const cont = await prisma().transacao.groupBy({ by: ["idLoja"], where: { tipo: "credito", idLoja: { in: lojas.map((l) => l.id) } }, _count: { _all: true } });
  const mapa = new Map(cont.map((c) => [c.idLoja, c._count._all]));
  return { lojas: lojas.map((l) => ({ id: l.id, nome: l.nome, responsavel: l.responsavel, email: l.email, status: l.status, total_trocas: mapa.get(l.id) ?? 0 })) };
});

const body = z.object({
  nome: z.string({ error: "Preencha todos os campos obrigatorios" }).trim().min(1, "Preencha todos os campos obrigatorios").max(255),
  responsavel: z.string({ error: "Preencha todos os campos obrigatorios" }).trim().min(1, "Preencha todos os campos obrigatorios").max(255),
  email,
  senha: z.string({ error: "Preencha todos os campos obrigatorios" }).min(8, "Senha deve ter no minimo 8 caracteres").max(72),
  telefone: z.string().trim().max(50).optional().default(""),
  endereco: z.string().trim().max(500).optional().default(""),
});

export const POST = api({ auth: ["admin"], body }, async ({ usuario, body, ip }) => {
  const [a, b] = await Promise.all([
    prisma().loja.findUnique({ where: { email: body.email }, select: { id: true } }),
    prisma().usuario.findUnique({ where: { email: body.email }, select: { id: true } }),
  ]);
  if (a || b) throw new HttpError(409, "E-mail ja cadastrado");
  const loja = await prisma().loja.create({
    data: { nome: body.nome, responsavel: body.responsavel, email: body.email, telefone: body.telefone, endereco: body.endereco, senha: await hashSenha(body.senha), status: "ativo" },
  });
  await auditar("admin_criou_loja", `loja_id=${loja.id} email=${body.email}`, ip, usuario.id);
  return { sucesso: true, loja: { id: loja.id, nome: loja.nome } };
});
