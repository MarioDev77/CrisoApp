import { z } from "zod";
import { api } from "@/lib/api";
import { verificarIdentificadorCliente } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { HttpError, notFound } from "@/lib/errors";
import { num } from "@/lib/servicos";

const body = z.object({ qr_data: z.string({ error: "Codigo invalido" }).trim().min(5).max(200) });

export const POST = api(
  { auth: ["loja"], body, limites: [{ nome: "busca-cliente", por: "usuario", max: 30, janelaSeg: 300, msg: "Muitas buscas. Aguarde alguns minutos." }] },
  async ({ body }) => {
    const id = verificarIdentificadorCliente(body.qr_data);
    if (!id) throw new HttpError(400, "Codigo invalido ou expirado. Peca ao cliente para gerar um novo.");
    const c = await prisma().usuario.findFirst({ where: { id, tipo: "cliente", status: "ativo", deletadoEm: null } });
    if (!c) throw notFound("Cliente nao encontrado");
    return { sucesso: true, id_cliente: c.id, nome: c.nome, saldo: num(c.saldo) };
  },
);
