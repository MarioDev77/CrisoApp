import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.API_PROXY_TARGET || 'http://localhost:3000';
  return {
    base: mode === 'development' ? '/' : '/web/',
    plugins: [react()],
    server: { port: 5173, proxy: { '/api': { target: apiTarget, changeOrigin: true, configure(proxy) { proxy.on('proxyReq', proxyReq => { proxyReq.setHeader('origin', apiTarget); }); } } } },
    preview: { port: 4173 },
    build: { outDir: '../../public/web', emptyOutDir: true },
  };
});
