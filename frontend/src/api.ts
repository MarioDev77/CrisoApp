export type Profile = { id: number; nome: string; email: string; tipo: 'cliente' | 'loja' | 'admin'; id_loja?: number };
export class ApiError extends Error { status: number; constructor(message: string, status: number) { super(message); this.status = status; } }
export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options, credentials: 'include', cache: 'no-store',
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.mensagem || 'Não foi possível concluir a solicitação.', response.status);
  return data as T;
}
export const post = <T = any>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
export const money = (v: unknown) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const dateTime = (v?: string | Date) => v ? new Date(v).toLocaleString('pt-BR') : '—';
export const dateOnly = (v?: string | Date) => v ? new Date(v).toLocaleDateString('pt-BR') : '—';
export const materials = ['papelao', 'plastico', 'aluminio', 'vidro'] as const;
export const materialLabels: Record<(typeof materials)[number], string> = { papelao: 'Papelão', plastico: 'Plástico', aluminio: 'Alumínio', vidro: 'Vidro' };
export function routeFor(profile: Profile) { return `/app/${profile.tipo}/dashboard`; }
