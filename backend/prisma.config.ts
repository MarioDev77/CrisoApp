import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  // MIGRATE_DATABASE_URL (opcional): URL do DONO do banco só para `prisma migrate`. O app em runtime usa DATABASE_URL,
  // que pode ser um papel sem permissão de DDL (ver docs/PROPOSTA_ENDURECIMENTO_BANCO.sql, seção A).
  datasource: { url: process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL ?? "" },
});
