import { defineConfig } from 'vitest/config';

// jsdom em https para os testes do cookie (atributo Secure só é gravado em https).
export default defineConfig({ test: { environment: 'jsdom', environmentOptions: { jsdom: { url: 'https://criso.test/' } }, include: ['tests/**/*.test.{ts,tsx}'] } });
