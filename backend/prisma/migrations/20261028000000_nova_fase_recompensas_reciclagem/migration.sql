-- Nova fase: loja de recompensas + referência de QR nas transações.
-- Migração ADITIVA: não remove nem altera colunas/tabelas existentes. Linhas antigas ficam com id_qr_transacao NULL
-- (o UNIQUE do PostgreSQL aceita vários NULL).

-- 1) Cada QR Code gera no máximo uma transação (barreira no banco, além do FOR UPDATE da rota).
ALTER TABLE "transacoes" ADD COLUMN "id_qr_transacao" INTEGER;
CREATE UNIQUE INDEX "transacoes_id_qr_transacao_key" ON "transacoes"("id_qr_transacao");

-- 2) Catálogo de recompensas
CREATE TABLE "recompensas" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "descricao" VARCHAR(1000) NOT NULL DEFAULT '',
    "categoria" VARCHAR(50) NOT NULL DEFAULT 'geral',
    "custo" DECIMAL(10,2) NOT NULL,
    "estoque" INTEGER,
    "limite_por_cliente" INTEGER,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "disponivel_ate" TIMESTAMPTZ,
    "validade_dias" INTEGER NOT NULL DEFAULT 30,
    "regras" VARCHAR(2000) NOT NULL DEFAULT '',
    "id_loja" INTEGER,
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "recompensas_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "recompensas_custo_positivo" CHECK ("custo" > 0),
    CONSTRAINT "recompensas_estoque_nao_negativo" CHECK ("estoque" IS NULL OR "estoque" >= 0),
    CONSTRAINT "recompensas_limite_positivo" CHECK ("limite_por_cliente" IS NULL OR "limite_por_cliente" > 0),
    CONSTRAINT "recompensas_validade_positiva" CHECK ("validade_dias" BETWEEN 1 AND 365)
);
CREATE INDEX "recompensas_ativo_categoria_idx" ON "recompensas"("ativo", "categoria");
CREATE INDEX "recompensas_id_loja_idx" ON "recompensas"("id_loja");
ALTER TABLE "recompensas" ADD CONSTRAINT "recompensas_id_loja_fkey" FOREIGN KEY ("id_loja") REFERENCES "lojas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3) Vouchers resgatados
CREATE TYPE "ResgateRecompensaStatus" AS ENUM ('ativo', 'utilizado', 'cancelado', 'expirado');

CREATE TABLE "resgates_recompensa" (
    "id" SERIAL NOT NULL,
    "id_cliente" INTEGER NOT NULL,
    "id_recompensa" INTEGER NOT NULL,
    "nome_recompensa" VARCHAR(120) NOT NULL,
    "custo" DECIMAL(10,2) NOT NULL,
    "codigo" VARCHAR(16) NOT NULL,
    "status" "ResgateRecompensaStatus" NOT NULL DEFAULT 'ativo',
    "chave" VARCHAR(64) NOT NULL,
    "id_transacao" INTEGER,
    "expira_em" TIMESTAMPTZ NOT NULL,
    "usado_em" TIMESTAMPTZ,
    "cancelado_em" TIMESTAMPTZ,
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "resgates_recompensa_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "resgates_recompensa_custo_positivo" CHECK ("custo" > 0)
);
CREATE UNIQUE INDEX "resgates_recompensa_codigo_key" ON "resgates_recompensa"("codigo");
CREATE UNIQUE INDEX "resgates_recompensa_id_transacao_key" ON "resgates_recompensa"("id_transacao");
CREATE UNIQUE INDEX "resgates_recompensa_id_cliente_chave_key" ON "resgates_recompensa"("id_cliente", "chave");
CREATE INDEX "resgates_recompensa_id_cliente_criado_em_idx" ON "resgates_recompensa"("id_cliente", "criado_em");
CREATE INDEX "resgates_recompensa_id_recompensa_status_idx" ON "resgates_recompensa"("id_recompensa", "status");
CREATE INDEX "resgates_recompensa_status_criado_em_idx" ON "resgates_recompensa"("status", "criado_em");
ALTER TABLE "resgates_recompensa" ADD CONSTRAINT "resgates_recompensa_id_cliente_fkey" FOREIGN KEY ("id_cliente") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "resgates_recompensa" ADD CONSTRAINT "resgates_recompensa_id_recompensa_fkey" FOREIGN KEY ("id_recompensa") REFERENCES "recompensas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4) Atalho para o painel de impacto (somente créditos de reciclagem, por data)
CREATE INDEX "transacoes_reciclagem_criado_em_idx" ON "transacoes"("criado_em") WHERE "tipo" = 'credito' AND "categoria" = 'reciclagem';
