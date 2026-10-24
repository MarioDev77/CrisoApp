import { cp, mkdir, rm } from 'node:fs/promises';
const from = new URL('../../frontend/dist/', import.meta.url);
const to = new URL('../public/web/', import.meta.url);
await rm(to, { recursive: true, force: true });
await mkdir(to, { recursive: true });
await cp(from, to, { recursive: true });
