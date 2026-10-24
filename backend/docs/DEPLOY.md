# Deploy integrado

O bundle React + Vite fica em `public/web`; Next atende a interface e a API no mesmo domínio para manter chamadas `/api/*` e a sessão same-origin.

## Comandos

    npm ci
    npm ci --prefix apps/web
    npm run db:generate
    npm run build
    npm start

O build Vite e as checagens TypeScript passaram. O build Next integrado falhou no sandbox Windows com `EPERM` ao criar uma pasta de rota sob `.next`; execute e confirme `npm run build` no provedor antes da publicação.

Configure variáveis de `.env.example`, banco PostgreSQL, migrações, HTTPS e serviços de e-mail/OAuth usados. O ZIP exclui `.env` real e dependências instaladas. `API_PROXY_TARGET` é usado apenas pelo Vite em desenvolvimento.
