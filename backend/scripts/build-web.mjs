// Compila o frontend irmão e copia para public/web, se a pasta ../frontend existir.
// No Railway com Root Directory = backend a pasta não existe (o front está na Vercel): pula sem erro.
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const frontend = fileURLToPath(new URL('../../frontend', import.meta.url));
if (!existsSync(`${frontend}/package.json`)) {
  console.log('[build:web] ../frontend não encontrado — pulando build do frontend (API apenas).');
  process.exit(0);
}
const run = (cmd, cwd = process.cwd()) => execSync(cmd, { cwd, stdio: 'inherit' });
run('npm ci', frontend);
run('npm run build', frontend);
run('node scripts/copy-frontend.mjs');
