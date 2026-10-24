import { env } from "./env";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" })[c]!);

export async function enviarCodigoRecuperacao(para: string, nome: string, codigo: string): Promise<void> {
  const e = env();
  if (!e.RESEND_API_KEY || !e.RESEND_FROM_EMAIL) throw new Error("Resend não configurado");
  const primeiro = esc((nome || "").trim().split(" ")[0] || "tudo bem");
  const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f6faf6">
<h2 style="color:#14532d;text-align:center">CrisoVerde</h2>
<div style="background:#fff;border-radius:12px;padding:28px 24px">
<p>Olá, ${primeiro}.</p><p>Use o código abaixo para redefinir sua senha:</p>
<p style="text-align:center;font-size:32px;font-weight:700;letter-spacing:8px;color:#15803d">${esc(codigo)}</p>
<p style="color:#6b7280;font-size:13px">Este código expira em 10 minutos. Se você não fez esta solicitação, ignore este e-mail.</p>
</div></div>`;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${e.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: e.RESEND_FROM_EMAIL, to: para, subject: "Seu código de verificação — CrisoVerde", html }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`Resend HTTP ${r.status}`);
}
