import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.API_PROXY_TARGET || 'http://localhost:3000';
  // Na Vercel o front roda na raiz do domínio ('/'); embutido no Next (Railway) ele é servido em '/web/'.
  const isVercel = process.env.VERCEL === '1';
  return {
    base: mode === 'development' || isVercel ? '/' : '/web/',
    plugins: [react()],
    server: { port: 5173, proxy: { '/api': { target: apiTarget, changeOrigin: true, configure(proxy) { proxy.on('proxyReq', proxyReq => { proxyReq.setHeader('origin', apiTarget); }); } } } },
    preview: { port: 4173 },
    // 'dist' é o que a Vercel espera e o que backend/scripts/copy-frontend.mjs copia para backend/public/web.
    build: { outDir: 'dist', emptyOutDir: true },
  };
});
