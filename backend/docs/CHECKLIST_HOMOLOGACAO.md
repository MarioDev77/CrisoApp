# Checklist de homologação

## Feito

- [x] Login React alinhado ao HTML/CSS estático original.
- [x] Logo original e splash com progresso, animação e respeito a movimento reduzido.
- [x] Comparação visual em navegador com o estático após ajuste de espaçamentos.
- [x] Typecheck frontend e backend, ESLint e seis testes Vitest.
- [x] Build de produção Vite; CSS final de fidelidade sincronizado ao bundle.

## Antes de publicar

- [ ] Executar o build integrado Next no provedor. O sandbox Windows bloqueou criação de `.next/server/app/api/admin/lojas` com `EPERM`.
- [ ] PostgreSQL descartável, migrations e validação sem drift.
- [ ] Cadastro, login/logout, sessão, Google e recuperação/e-mail.
- [ ] QR por câmera em HTTPS e jornadas de cliente, loja e administrador.
- [ ] Rotas SPA após refresh, teclado, leitor de tela e tamanhos de tela.
- [ ] Preencher e aprovar dados do controlador, contatos, bases legais, fornecedores e retenção.
- [ ] Configurar segredos, TLS, backups, alertas e serviços externos no provedor.

`tests/funcional.mjs` usa `TRUNCATE`; nunca o aponte para produção.
