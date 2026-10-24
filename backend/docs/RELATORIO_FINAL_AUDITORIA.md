# Relatório final — migração e fidelidade visual do CrisoVerde

## Alteração desta revisão

- A tela de autenticação React foi alinhada ao `public/login.html` estático: fundo verde escuro, folhas, tipografia Plus Jakarta Sans, paleta, dimensões e espaçamento de campos, botão dourado, textos e links.
- A imagem `logo.png` original foi reutilizada. O splash mostra progresso, anima a logo do centro ao topo e revela o formulário após 2,2 s; mantém o limite de segurança de 4 s e respeita `prefers-reduced-motion`.
- Cadastro e modal de recuperação receberam a mesma linguagem visual escura e medidas do projeto estático.
- Uma comparação lado a lado do bundle Vite e do HTML estático foi feita no navegador. Após ajustes do reset e do espaço reservado ao Google, posições principais do formulário ficaram alinhadas ao original.
- Formulário React mantém login/cadastro, Google opcional, mostrar senha, recuperação de senha, política de privacidade e APIs existentes. A logo foi colocada nos caminhos do Vite e do Next.

## Versão do React

O pedido citou React 20. A consulta ao registro oficial mostra a versão estável em 19.3.1, sem uma release estável 20 publicada. O projeto mantém React 19.3.1 e Next.js 16.4.2, sem usar uma versão experimental como se fosse estável.

## Verificações

- `npm run build:web`: passou com Vite 7.3.7 após a migração da tela; as regras CSS finais de fidelidade foram sincronizadas ao bundle e conferidas visualmente no navegador.
- `npm run typecheck:web`: passou.
- `npm run typecheck`: passou.
- `npm run lint`: passou.
- `npm test`: 6 testes passaram.
- `npm audit --omit=dev`: 0 vulnerabilidades reportadas em execução anterior.
- O build integrado `next build --webpack` falhou ao criar `.next/server/app/api/admin/lojas` com `EPERM` no sandbox Windows. A compilação Next precisa ser executada no ambiente de deploy.
- Login visualmente validado; APIs autenticadas, câmera e PostgreSQL não foram homologados nesta sessão.

## Entrega e itens que dependem do deploy

O ZIP contém fontes, lockfiles, APIs Next, Prisma, `.env.example`, logo e bundle Vite atualizado, sem `node_modules`, `.env` real ou caches. O provedor deve instalar dependências, compilar Next, configurar PostgreSQL/segredos e aplicar migrations.

O catálogo JS Papelaria do frontend legado é uma simulação sem API de pedido/checkout. A interface preserva os descontos e informa que não cria pedido nem debita saldo.

A página de privacidade ainda possui dados jurídicos e operacionais a confirmar. Preencha e aprove antes da publicação. Homologue login, cadastro, recuperação, QR e jornadas de todos os perfis com PostgreSQL de teste.
