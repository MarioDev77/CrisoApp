import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const senha = process.env.ADMIN_SENHA;
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL ausente");
  if (!email || !senha) throw new Error("Defina ADMIN_EMAIL e ADMIN_SENHA para criar o administrador inicial");
  if (senha.length < 12) throw new Error("ADMIN_SENHA deve ter ao menos 12 caracteres");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const existe = await prisma.usuario.findFirst({ where: { tipo: "admin" } });
    if (existe) return console.log("[seed] já existe um administrador; nada a fazer.");
    await prisma.usuario.create({
      data: { nome: "Administrador", email, senha: await bcrypt.hash(senha, 12), tipo: "admin", status: "ativo", emailVerificado: true },
    });
    console.log("[seed] administrador inicial criado.");
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error("[seed] falhou:", e.message); process.exit(1); });
