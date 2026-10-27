import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';

export type ToastState = { message: string; kind?: 'error' | 'success' };
export const toastEvent = new EventTarget();
export function notify(message: string, kind: ToastState['kind'] = 'success') { toastEvent.dispatchEvent(new CustomEvent('toast', { detail: { message, kind } })); }
export function PageTitle({ title, description, action }: { title: string; description?: string; action?: ReactNode }) { return <div className="page-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>; }
export function Panel({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) { return <section className="panel">{(title || action) && <div className="panel-heading">{title && <h3>{title}</h3>}{action}</div>}{children}</section>; }
export function Stat({ label, value, icon, caption }: { label: string; value: ReactNode; icon: string; caption?: string }) { return <div className="stat-card"><span className="stat-icon">{icon}</span><div><div className="stat-label">{label}</div><strong className="stat-value">{value}</strong>{caption && <small>{caption}</small>}</div></div>; }
export function Table({ columns, rows, empty = 'Nenhum registro encontrado.' }: { columns: string[]; rows: ReactNode[][]; empty?: string }) { return <div className="table-wrap"><table><thead><tr>{columns.map(c => <th key={c}>{c}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row, i) => <tr key={i}>{row.map((c, j) => <td key={j}>{c}</td>)}</tr>) : <tr><td className="empty-cell" colSpan={columns.length}>{empty}</td></tr>}</tbody></table></div>; }
export function useLoad<T>(path: string | null) { const [data, setData] = useState<T | null>(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(true); const reload = useCallback(async () => { if (!path) return; setLoading(true); setError(''); try { setData(await api<T>(path)); } catch (e) { setError(e instanceof Error ? e.message : 'Erro ao carregar.'); } finally { setLoading(false); } }, [path]); useEffect(() => { void reload(); }, [reload]); return { data, error, loading, reload, setData }; }
export function ErrorBlock({ error }: { error: string }) { return error ? <div className="alert error" role="alert">{error}</div> : null; }
export function LoadingBlock() { return <div className="loading-inline"><span className="spinner" />Carregando…</div>; }
export function StatusBadge({ value }: { value: string }) { return <span className={`badge badge-${String(value).toLowerCase().replace(/[^a-z0-9]/g, '-')}`}>{value}</span>; }

// ---- Componentes da nova fase (mesma identidade visual; sem dependências novas) ----
export const newKey = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48).padEnd(16, 'x');
export const formatCode = (c: string) => (c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c);
export const fmtNum = (v: unknown, d = 1) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: d });

export function Skeleton({ lines = 3, height = 18 }: { lines?: number; height?: number }) {
  return <div className="skeleton-group" aria-busy="true" aria-label="Carregando">{Array.from({ length: lines }, (_, i) => <span key={i} className="skeleton" style={{ height, width: `${100 - (i % 3) * 14}%` }} />)}</div>;
}
export function StatsSkeleton({ count = 4 }: { count?: number }) {
  return <div className="stats-grid" aria-busy="true" aria-label="Carregando">{Array.from({ length: count }, (_, i) => <div key={i} className="stat-card"><span className="skeleton" style={{ width: 42, height: 42, borderRadius: 12 }} /><div style={{ flex: 1 }}><span className="skeleton" style={{ height: 12, width: '60%' }} /><span className="skeleton" style={{ height: 24, width: '80%', marginTop: 8 }} /></div></div>)}</div>;
}
export function EmptyState({ icon = '◌', title, children, action }: { icon?: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty-state"><span aria-hidden="true">{icon}</span><strong>{title}</strong>{children && <p>{children}</p>}{action}</div>;
}
export function Progress({ value, label, tone = 'green' }: { value: number; label: string; tone?: 'green' | 'gold' }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v} aria-label={label}><span className={`progress-fill ${tone}`} style={{ width: `${v}%` }} /></div>;
}
export function Trend({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <small className="trend flat">sem base de comparação</small>;
  return <small className={`trend ${value > 0 ? 'up' : value < 0 ? 'down' : 'flat'}`}>{value > 0 ? '▲' : value < 0 ? '▼' : '■'} {fmtNum(Math.abs(value), 1)}% vs. período anterior</small>;
}

type Ponto = { label: string; value: number };
const niceMax = (m: number) => { if (m <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(m))); const f = m / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };
const W = 640, H = 260, PL = 46, PR = 12, PT = 14, PB = 38;

/** Gráfico de barras ou linha em SVG. Tem título, unidade, legenda, estado vazio e tabela alternativa para leitores de tela. */
export function Chart({ title, unit, data, kind = 'bar', color = '#176044', digits = 1 }: { title: string; unit: string; data: Ponto[]; kind?: 'bar' | 'line'; color?: string; digits?: number }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!data.length || total === 0) return <EmptyState icon="▥" title="Sem registros neste recorte">Não há dados para exibir em “{title}”. Ajuste o período ou os filtros.</EmptyState>;
  const max = niceMax(Math.max(...data.map(d => d.value)));
  const iw = W - PL - PR, ih = H - PT - PB;
  const x = (i: number) => PL + (kind === 'bar' ? (iw / data.length) * (i + 0.5) : data.length === 1 ? iw / 2 : (iw / (data.length - 1)) * i);
  const y = (v: number) => PT + ih - (v / max) * ih;
  const bw = Math.max(3, Math.min(46, (iw / data.length) * 0.66));
  const every = Math.max(1, Math.ceil(data.length / 8));
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const path = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(' ');
  return <figure className="chart">
    <figcaption><strong>{title}</strong><span className="chart-legend"><i style={{ background: color }} />{unit}</span></figcaption>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. Total: ${fmtNum(total, digits)} ${unit}.`} preserveAspectRatio="xMidYMid meet">
      {ticks.map(t => <g key={t}><line x1={PL} x2={W - PR} y1={y(max * t)} y2={y(max * t)} stroke="#e2eae5" /><text x={PL - 7} y={y(max * t) + 4} textAnchor="end" className="chart-tick">{fmtNum(max * t, max < 5 ? 2 : 0)}</text></g>)}
      {kind === 'bar' && data.map((d, i) => <rect key={i} x={x(i) - bw / 2} y={y(d.value)} width={bw} height={Math.max(0, PT + ih - y(d.value))} rx={3} fill={color}><title>{`${d.label}: ${fmtNum(d.value, digits)} ${unit}`}</title></rect>)}
      {kind === 'line' && <><path d={`${path} L${x(data.length - 1).toFixed(1)},${PT + ih} L${x(0).toFixed(1)},${PT + ih} Z`} fill={color} opacity={0.1} /><path d={path} fill="none" stroke={color} strokeWidth={2.4} strokeLinejoin="round" />{data.map((d, i) => <circle key={i} cx={x(i)} cy={y(d.value)} r={data.length > 40 ? 1.8 : 3.2} fill="#fff" stroke={color} strokeWidth={1.8}><title>{`${d.label}: ${fmtNum(d.value, digits)} ${unit}`}</title></circle>)}</>}
      {data.map((d, i) => i % every === 0 && <text key={i} x={x(i)} y={H - 14} textAnchor="middle" className="chart-tick">{d.label}</text>)}
      <text x={PL} y={H - 1} className="chart-unit">Eixo vertical: {unit}</text>
    </svg>
    <table className="sr-only"><caption>{title}</caption><thead><tr><th>Período</th><th>{unit}</th></tr></thead><tbody>{data.map((d, i) => <tr key={i}><td>{d.label}</td><td>{fmtNum(d.value, digits)}</td></tr>)}</tbody></table>
  </figure>;
}
