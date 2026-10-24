# Backend CrisoVerde

Pré-requisitos: Node.js 20.19+ e PostgreSQL 14+.

## Configuração local

1. Crie `backend/.env` a partir de `.env.example` e configure `DATABASE_URL`, `JWT_SECRET` e as demais integrações necessárias.
2. Na pasta `backend`, rode `npm ci`. Na pasta `frontend`, rode `npm ci`.
3. Em `backend`, rode `npm run db:generate`, `npm run db:migrate:deploy` e `npm run db:seed`.
4. Inicie a API em um terminal com `npm run dev` (dentro de backend).
5. Inicie o Vite em outro terminal com `npm run dev` (dentro de frontend). O proxy Vite encaminha `/api` para a API local.

Para produção, a partir de backend execute `npm run build` e depois `npm run start`. O build compila o frontend irmão e copia o resultado para `backend/public/web`, para servir frontend e API no mesmo domínio. Configure o serviço de deploy com o diretório de build contendo as pastas backend e frontend, e use `backend` como diretório da aplicação. Configure `DATABASE_URL` e secrets no painel do provedor; o ZIP não contém credenciais nem banco hospedado.
