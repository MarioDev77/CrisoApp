# Backend CrisoVerde

Pré-requisitos: Node.js 22 e PostgreSQL 14+.

## Configuração local

1. Crie `backend/.env` a partir de `.env.example` e configure `DATABASE_URL`, `JWT_SECRET` e as integrações necessárias.
2. Na raiz do projeto, rode `npm ci --prefix backend --include=dev` e `npm ci --prefix frontend --include=dev`.
3. Rode `npm run db:migrate:deploy` e, se necessário, `npm --prefix backend run db:seed`.
4. Inicie a API com `npm --prefix backend run dev` e o Vite com `npm --prefix frontend run dev`.

## Railway

Use a raiz do repositório (`/`) como Root Directory e o `railway.json` da raiz. O build instala as dependências das duas pastas, compila Vite, copia os arquivos para o Next e compila o backend. O PostgreSQL deve ser referenciado pela variável `DATABASE_URL`. Mantenha o MySQL antigo e o serviço de produção atual intactos até validar a migração dos dados.
