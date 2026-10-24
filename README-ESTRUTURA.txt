Projeto CrisoVerde separado em frontend e backend.

frontend/: aplicação React + Vite (fonte, dependências e configuração).
backend/: API Next.js, Prisma/PostgreSQL, migrations e deploy. Inclui public/web, a cópia compilada do frontend que o Next serve no mesmo domínio para manter /api e cookies same-origin.

Configure backend/.env a partir de backend/.env.example, instale as dependências e configure PostgreSQL conforme backend/README.md. O frontend usa /api no mesmo domínio; para hospedar frontend em domínio separado, configure proxy same-origin ou implemente CORS/cookies adequados.
