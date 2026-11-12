import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";

const k = () => crypto.randomBytes(32).toString("base64");
const SEGREDO = "s".repeat(40);
async function carregar(amb: Record<string, string | undefined> = {}) {
  vi.resetModules();
  for (const n of ["TRUSTED_PROXY", "TRUSTED_PROXY_HOPS", "CLIENT_IP_HEADER", "ORIGIN_SECRET", "NODE_ENV"]) delete process.env[n];
  Object.assign(process.env, { DATABASE_URL: "postgresql://x:y@localhost:5432/z", JWT_SECRET: "x".repeat(48), DATA_ENCRYPTION_KEYS: `k1:${k()}`, BLIND_INDEX_KEY: k() }, amb);
  return { ip: await import("../../src/lib/client-ip"), disp: await import("../../src/lib/dispositivo") };
}
const H = (o: Record<string, string>) => new Headers(o);

describe("identificação do IP: só cabeçalhos de proxy confiável", () => {
  it("none (padrão): IP desconhecido e NÃO confiável, mesmo com cabeçalhos forjados", async () => {
    const { ip } = await carregar({ TRUSTED_PROXY: "none" });
    const r = ip.resolverIp(H({ "x-forwarded-for": "6.6.6.6", "x-real-ip": "6.6.6.6", "cf-connecting-ip": "6.6.6.6" }));
    expect(r).toMatchObject({ ip: "desconhecido", confiavel: false });
  });
  it("railway: usa X-Real-IP e ignora X-Forwarded-For/CF forjados", async () => {
    const { ip } = await carregar({ TRUSTED_PROXY: "railway" });
    expect(ip.resolverIp(H({ "x-real-ip": "203.0.113.9", "x-forwarded-for": "6.6.6.6", "cf-connecting-ip": "7.7.7.7" })).ip).toBe("203.0.113.9");
    expect(ip.resolverIp(H({ "x-forwarded-for": "6.6.6.6" }))).toMatchObject({ confiavel: false });
  });
  it("hops: conta a partir da direita; o que o cliente forjou à esquerda não vale", async () => {
    const { ip } = await carregar({ TRUSTED_PROXY: "hops", TRUSTED_PROXY_HOPS: "1" });
    expect(ip.clientIp(H({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 203.0.113.9" }))).toBe("203.0.113.9");
    const dois = await carregar({ TRUSTED_PROXY: "hops", TRUSTED_PROXY_HOPS: "2" });
    expect(dois.ip.clientIp(H({ "x-forwarded-for": "1.1.1.1, 198.51.100.4, 203.0.113.9" }))).toBe("198.51.100.4");
  });
  it("vercel: só aceita o cabeçalho com ORIGIN_SECRET válido (timing-safe)", async () => {
    const { ip } = await carregar({ TRUSTED_PROXY: "vercel", ORIGIN_SECRET: SEGREDO, CLIENT_IP_HEADER: "x-vercel-forwarded-for" });
    expect(ip.resolverIp(H({ "x-vercel-forwarded-for": "203.0.113.9", "x-origin-secret": SEGREDO })).ip).toBe("203.0.113.9");
    const semSegredo = ip.resolverIp(H({ "x-vercel-forwarded-for": "6.6.6.6" }));
    expect(semSegredo).toMatchObject({ ip: "desconhecido", confiavel: false });
    expect(ip.resolverIp(H({ "x-vercel-forwarded-for": "6.6.6.6", "x-origin-secret": "errado".padEnd(40, "x") })).confiavel).toBe(false);
    expect(ip.resolverIp(H({ "x-vercel-forwarded-for": "6.6.6.6", "x-origin-secret": "curto" })).confiavel).toBe(false);
  });
  it("vercel sem ORIGIN_SECRET configurado é recusado na configuração", async () => {
    const { ip } = await carregar({ TRUSTED_PROXY: "vercel" });
    expect(() => ip.resolverIp(new Headers())).toThrow(/ORIGIN_SECRET/);
  });
  it("valor que não é IP é rejeitado (lixo, injeção, nome de host)", async () => {
    const { ip } = await carregar({ TRUSTED_PROXY: "railway" });
    for (const ruim of ["abc", "999.1.1.1", "1.1.1.1; DROP TABLE", "<script>", "", "1.2.3"]) expect(ip.resolverIp(H({ "x-real-ip": ruim })).confiavel).toBe(false);
  });
  it("IPv6 vira o prefixo /64 (rotacionar dentro do /64 não escapa do limite); IPv4-mapeado vira IPv4", async () => {
    const { ip } = await carregar({ TRUSTED_PROXY: "railway" });
    const a = ip.resolverIp(H({ "x-real-ip": "2001:db8:abcd:12:1111:2222:3333:4444" })).ip;
    const b = ip.resolverIp(H({ "x-real-ip": "2001:db8:abcd:12::9" })).ip;
    expect(a).toBe(b); expect(a).toBe("2001:0db8:abcd:0012::/64");
    expect(ip.normalizarIp("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(ip.normalizarIp("203.0.113.9:5432")).toBe("203.0.113.9");
    expect(ip.normalizarIp("[2001:db8::1]:443")).toBe("2001:0db8:0000:0000::/64");
  });
  it("alerta operacional: só em produção, no máximo 1 por minuto, e só se o IP não é confiável", async () => {
    const { ip } = await carregar({ TRUSTED_PROXY: "none", NODE_ENV: "production", SESSION_SECRET: "s".repeat(40), OTP_PEPPER: "o".repeat(40), QR_SIGNING_SECRET: "q".repeat(40) });
    const espia = vi.spyOn(console, "log").mockImplementation(() => {});
    const info = ip.resolverIp(new Headers());
    ip.alertarIpNaoConfiavel(info, 1_000_000); ip.alertarIpNaoConfiavel(info, 1_030_000); ip.alertarIpNaoConfiavel(info, 1_061_000);
    const alertas = espia.mock.calls.filter((c) => String(c[0]).includes("ip_nao_identificado"));
    espia.mockRestore();
    expect(alertas.length).toBe(2);
    ip.alertarIpNaoConfiavel({ ip: "1.2.3.4", confiavel: true, modo: "railway" }, 9_999_999); // confiável: silêncio
  });
});

describe("cookie de dispositivo conhecido", () => {
  let d: Awaited<ReturnType<typeof carregar>>["disp"];
  beforeEach(async () => { d = (await carregar()).disp; });
  const cookie = (v: string) => `${d.COOKIE_DISPOSITIVO}=${v}`;

  it("reconhece o dono, ignora e-mail de outra conta e normaliza maiúsculas", () => {
    const v = d.valorDispositivo(null, "Maria@Example.com");
    expect(d.dispositivoConhecido(cookie(v), "maria@example.com")).toBe(true);
    expect(d.dispositivoConhecido(cookie(v), "outra@example.com")).toBe(false);
    expect(d.dispositivoConhecido(null, "maria@example.com")).toBe(false);
  });
  it("assinatura adulterada, expirada ou de outra chave é rejeitada", () => {
    const v = d.valorDispositivo(null, "maria@example.com");
    const [id, exp, sig] = v.split(".");
    expect(d.dispositivoConhecido(cookie(`${id}.${exp}.${"0".repeat(sig.length)}`), "maria@example.com")).toBe(false);
    expect(d.dispositivoConhecido(cookie(`${id}.${Number(exp) + 999}.${sig}`), "maria@example.com")).toBe(false);
    const depois = Math.floor(Date.now() / 1000) + 31 * 86400;
    expect(d.dispositivoConhecido(cookie(v), "maria@example.com", depois)).toBe(false);
  });
  it("guarda até 5 contas, renova a atual e não contém e-mail em claro", () => {
    let v = "";
    for (let i = 0; i < 7; i++) v = d.valorDispositivo(v ? cookie(v) : null, `u${i}@example.com`);
    expect(v.split("~").length).toBe(5);
    expect(v).not.toMatch(/example|@/);
    expect(d.dispositivoConhecido(cookie(v), "u6@example.com")).toBe(true);
    expect(d.dispositivoConhecido(cookie(v), "u0@example.com")).toBe(false);
  });
  it("atributos: HttpOnly, SameSite=Strict, Path=/, 30 dias", () => {
    expect(d.opcoesCookieDispositivo()).toMatchObject({ httpOnly: true, sameSite: "strict", path: "/", maxAge: 2592000 });
  });
});
