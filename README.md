# CrisoVerde — frontend e backend

Este pacote preserva as alterações enviadas pelo usuário e acrescenta a configuração de build da Railway para a raiz do repositório.

## Deploy na Railway

Configure o Root Directory do serviço como `/` (raiz do repositório), use o `railway.json` da raiz e adicione `DATABASE_URL` referenciando o PostgreSQL, além de `JWT_SECRET` e as demais variáveis do backend. O projeto seleciona Node 22; o build instala as dependências de backend e frontend, compila o React/Vite e depois o Next.js. A migration executa no pre-deploy.

Mantenha o serviço antigo com MySQL separado até concluir e conferir a migração de usuários, saldos e transações. O ZIP não contém credenciais nem dados de produção. Consulte `backend/README.md` para desenvolvimento local.
