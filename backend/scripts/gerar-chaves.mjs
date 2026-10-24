// Uso: node scripts/gerar-chaves.mjs
// Gera chaves novas. Guarde NO PAINEL DO RAILWAY (variáveis) e em um cofre/gerenciador de senhas. NUNCA no Git.
import crypto from "node:crypto";
const b = () => crypto.randomBytes(32).toString("base64");
console.log(`DATA_ENCRYPTION_KEYS=k1:${b()}`);
console.log(`BLIND_INDEX_KEY=${b()}`);
console.log(`SESSION_SECRET=${b()}`);
console.log(`QR_SIGNING_SECRET=${b()}`);
console.log(`OTP_PEPPER=${b()}`);
console.log("\n# Rotação: acrescente uma chave NOVA NA FRENTE:  DATA_ENCRYPTION_KEYS=k2:<nova>,k1:<antiga>");
console.log("# Depois rode o script de re-cifra e só então remova k1.");
console.log("# ATENÇÃO: perder DATA_ENCRYPTION_KEYS/BLIND_INDEX_KEY = perder os dados cifrados. Faça backup das chaves separado do banco.");
