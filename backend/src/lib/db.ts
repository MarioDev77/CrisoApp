import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "./env";

const g = globalThis as unknown as { __prisma?: PrismaClient };

function criar(): PrismaClient {
  const e = env();
  const adapter = new PrismaPg({
    connectionString: e.DATABASE_URL,
    max: e.DB_POOL_MAX,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 10_000,
    query_timeout: 12_000,
  });
  return new PrismaClient({ adapter });
}

export function prisma(): PrismaClient {
  if (!g.__prisma) g.__prisma = criar();
  return g.__prisma;
}
