import { useEffect, useState, type FormEvent } from 'react';
import { api, dateTime, materialLabels, materials, money, post } from './api';
import { Chart, EmptyState, ErrorBlock, fmtNum, notify, PageTitle, Panel, Progress, Skeleton, Stat, StatsSkeleton, StatusBadge, Table, Trend, useLoad } from './ui';

const emoji: Record<string, string> = { papelao: '📦', plastico: '🧴', aluminio: '🥫', vidro: '🍾' };
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const rotuloPeriodo = (iso: string, g: string) => (g === 'mes' ? `${iso.slice(5, 7)}/${iso.slice(0, 4)}` : g === 'semana' ? `sem ${dm(iso)}` : dm(iso));
const isoHoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const isoMenos = (dias: number) => new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 10);

/** Painel de impacto ambiental. Todos os números vêm de agregações no banco (/admin/impacto). */
export function ImpactPage() {
  const [dias, setDias] = useState('30'); const [de, setDe] = useState(''); const [ate, setAte] = useState('');
  const [material, setMaterial] = useState(''); const [loja, setLoja] = useState(''); const [metrica, setMetrica] = useState<'kg' | 'operacoes' | 'unidades'>('kg');
  const [meta, setMeta] = useState(''); const [salvando, setSalvando] = useState(false);
  const personalizado = dias === 'custom';
  const qs = new URLSearchParams();
  if (personalizado) { if (de) qs.set('de', de); if (ate) qs.set('ate', ate); } else qs.set('dias', dias);
  if (material) qs.set('material', material); if (loja) qs.set('loja', loja);
  const lojas = useLoad<any>('/admin/lojas');
  const r = useLoad<any>(personalizado && !de && !ate ? null : `/admin/impacto?${qs}`);
  const x = r.data;
  useEffect(() => { if (x?.meta_mensal) setMeta(String(x.meta_mensal.meta_kg_por_cliente)); }, [x?.meta_mensal?.meta_kg_por_cliente]);
  const salvarMeta = async (e: FormEvent) => {
    e.preventDefault(); setSalvando(true);
    try { await post('/admin/configuracoes/metas', { meta_reciclagem_mensal_kg: Number(meta) }); notify('Meta mensal atualizada.'); await r.reload(); }
    catch (err) { notify(err instanceof Error ? err.message : 'Não foi possível salvar.', 'error'); } finally { setSalvando(false); }
  };
  const g = x?.periodo?.granularidade || 'dia';
  const serie = (x?.serie || []).map((p: any) => ({ label: rotuloPeriodo(p.periodo, g), value: p[metrica] }));
  const unidadeMetrica = metrica === 'kg' ? 'kg (estimado)' : metrica === 'operacoes' ? 'operações' : 'unidades';
  return <>
    <PageTitle title="Impacto ambiental" description="Indicadores calculados no servidor a partir das reciclagens confirmadas." action={<button className="button subtle" onClick={() => void r.reload()} disabled={r.loading}>Atualizar</button>} />
    <div className="toolbar">
      <label className="field-label compact-label">Período<select value={dias} onChange={e => { setDias(e.target.value); if (e.target.value === 'custom') { setDe(isoMenos(29)); setAte(isoHoje()); } }}><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option><option value="365">Últimos 12 meses</option><option value="custom">Personalizado…</option></select></label>
      {personalizado && <><label className="field-label compact-label">De<input type="date" value={de} max={ate || undefined} onChange={e => setDe(e.target.value)} /></label><label className="field-label compact-label">Até<input type="date" value={ate} min={de || undefined} onChange={e => setAte(e.target.value)} /></label></>}
      <label className="field-label compact-label">Material<select value={material} onChange={e => setMaterial(e.target.value)}><option value="">Todos</option>{materials.map(m => <option key={m} value={m}>{materialLabels[m]}</option>)}</select></label>
      <label className="field-label compact-label">Ponto de coleta<select value={loja} onChange={e => setLoja(e.target.value)}><option value="">Todos</option>{(lojas.data?.lojas || []).map((l: any) => <option key={l.id} value={l.id}>{l.nome}</option>)}</select></label>
    </div>
    <ErrorBlock error={r.error} />
    {r.loading && !x ? <><StatsSkeleton count={6} /><Panel><Skeleton lines={6} /></Panel></> : x && <>
      <p className="fine-print">Período: {x.periodo.de.split('-').reverse().join('/')} a {x.periodo.ate.split('-').reverse().join('/')} ({x.periodo.dias} dias) · comparado com {x.periodo.periodo_anterior.de.split('-').reverse().join('/')} a {x.periodo.periodo_anterior.ate.split('-').reverse().join('/')}</p>
      <div className="stats-grid">
        <div><Stat label="Reciclagens confirmadas" value={fmtNum(x.resumo.operacoes, 0)} icon="♻" /><Trend value={x.variacao.operacoes} /></div>
        <div><Stat label="Material coletado (est.)" value={`${fmtNum(x.resumo.kg, 1)} kg`} icon="▤" caption={`${fmtNum(x.resumo.unidades, 0)} unidades`} /><Trend value={x.variacao.kg} /></div>
        <div><Stat label="Alunos participantes" value={fmtNum(x.resumo.participantes, 0)} icon="♙" caption={`${x.participacao.percentual}% dos ${x.participacao.clientes_ativos} ativos`} /><Trend value={x.variacao.participantes} /></div>
        <Stat label="Pontos de coleta ativos" value={fmtNum(x.resumo.lojas_ativas, 0)} icon="⌂" />
        <Stat label="Créditos distribuídos" value={x.resumo.creditos === null ? '—' : money(x.resumo.creditos)} icon="↗" caption={x.resumo.creditos === null ? 'indisponível com filtro de material' : undefined} />
      </div>
      {x.resumo.operacoes === 0 && <div className="alert info">Nenhuma reciclagem confirmada neste recorte. Os gráficos abaixo ficam vazios até haver registros.</div>}
      <Panel title="Evolução da coleta" action={<label className="field-label compact-label" style={{ margin: 0 }}>Métrica<select value={metrica} onChange={e => setMetrica(e.target.value as any)}><option value="kg">Peso estimado (kg)</option><option value="operacoes">Operações</option><option value="unidades">Unidades</option></select></label>}>
        <Chart title={`Evolução por ${g === 'dia' ? 'dia' : g === 'semana' ? 'semana' : 'mês'}`} unit={unidadeMetrica} data={serie} kind="line" digits={metrica === 'kg' ? 2 : 0} />
      </Panel>
      <div className="two-up">
        <Panel title="Por tipo de material">
          <Chart title="Unidades por material" unit="unidades" kind="bar" digits={0} color="#d1ad4b" data={x.por_material.map((m: any) => ({ label: materialLabels[m.material as keyof typeof materialLabels], value: m.unidades }))} />
          <Table columns={['Material', 'Operações', 'Unidades', 'Peso (est.)']} rows={x.por_material.map((m: any) => [`${emoji[m.material]} ${materialLabels[m.material as keyof typeof materialLabels]}`, fmtNum(m.operacoes, 0), fmtNum(m.unidades, 0), `${fmtNum(m.kg, 2)} kg`])} />
        </Panel>
        <Panel title="Pontos de coleta (top 10)">
          <Chart title="Peso estimado por ponto de coleta" unit="kg (estimado)" kind="bar" digits={2} data={x.por_loja.map((l: any) => ({ label: l.nome.slice(0, 10), value: l.kg }))} />
          <Table columns={['Loja', 'Operações', 'Peso (est.)']} rows={x.por_loja.map((l: any) => [l.nome, fmtNum(l.operacoes, 0), `${fmtNum(l.kg, 2)} kg`])} empty="Sem registros neste recorte." />
        </Panel>
      </div>
      <div className="two-up">
        <Panel title="Participação dos alunos">
          <div className="progress-meta"><strong>{x.participacao.participantes} de {x.participacao.clientes_ativos} alunos ativos</strong><span className="muted">{x.participacao.percentual}%</span></div>
          <Progress value={x.participacao.percentual} label="Participação dos alunos ativos no período" />
          <p className="inline-note">Alunos distintos com ao menos uma reciclagem confirmada no período.</p>
        </Panel>
        <Panel title={`Meta mensal (${x.meta_mensal.mes || 'mês atual'})`}>
          <div className="progress-meta"><strong>{x.meta_mensal.atingiram} de {x.meta_mensal.participantes_no_mes} participantes atingiram</strong><span className="muted">{x.meta_mensal.percentual_dos_participantes}%</span></div>
          <Progress value={x.meta_mensal.percentual_dos_participantes} label="Participantes que atingiram a meta mensal" tone="gold" />
          <form className="inline-form" onSubmit={salvarMeta} style={{ marginTop: 12 }}>
            <label className="field-label">Meta por aluno (kg/mês)<input type="number" min="0.1" max="10000" step="0.1" value={meta} onChange={e => setMeta(e.target.value)} required /></label>
            <button className="button primary" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar meta'}</button>
          </form>
        </Panel>
      </div>
      <Panel title="Como estes números são calculados">
        <ul className="bar-list" style={{ listStyle: 'disc', paddingLeft: 18 }}><li>{x.metodologia.conta}</li><li>{x.metodologia.kg}</li><li>{x.metodologia.impacto_ambiental}</li><li>Alunos, campanhas e turmas não são exibidos por turma/campanha porque esses dados ainda não existem no sistema.</li></ul>
      </Panel>
    </>}
  </>;
}

type Form = { nome: string; descricao: string; categoria: string; custo: string; estoque: string; limitePorCliente: string; validadeDias: string; regras: string; idLoja: string; disponivelAte: string; ativo: boolean };
const formVazio: Form = { nome: '', descricao: '', categoria: 'geral', custo: '', estoque: '', limitePorCliente: '', validadeDias: '30', regras: '', idLoja: '', disponivelAte: '', ativo: true };

/** Catálogo de recompensas + vouchers resgatados (administração). */
export function RewardsAdmin() {
  const [aba, setAba] = useState<'catalogo' | 'vouchers'>('catalogo');
  const cat = useLoad<any>('/admin/recompensas');
  const [status, setStatus] = useState(''); const [pagina, setPagina] = useState(1);
  const vou = useLoad<any>(`/admin/resgates-recompensa?pagina=${pagina}${status ? `&status=${status}` : ''}`);
  const [edit, setEdit] = useState<{ id: number | null; f: Form } | null>(null); const [busy, setBusy] = useState(false);
  const abrirNovo = () => setEdit({ id: null, f: { ...formVazio } });
  const abrirEditar = (r: any) => setEdit({ id: r.id, f: { nome: r.nome, descricao: r.descricao, categoria: r.categoria, custo: String(r.custo), estoque: r.estoque === null ? '' : String(r.estoque), limitePorCliente: r.limite_por_cliente === null ? '' : String(r.limite_por_cliente), validadeDias: String(r.validade_dias), regras: r.regras, idLoja: r.id_loja ? String(r.id_loja) : '', disponivelAte: r.disponivel_ate ? r.disponivel_ate.slice(0, 10) : '', ativo: r.ativo } });
  const salvar = async (e: FormEvent) => {
    e.preventDefault(); if (!edit || busy) return; const f = edit.f; setBusy(true);
    const corpo = { nome: f.nome, descricao: f.descricao, categoria: f.categoria || 'geral', custo: Number(f.custo), estoque: f.estoque === '' ? null : Number(f.estoque), limitePorCliente: f.limitePorCliente === '' ? null : Number(f.limitePorCliente), validadeDias: Number(f.validadeDias), regras: f.regras, idLoja: f.idLoja === '' ? null : Number(f.idLoja), disponivelAte: f.disponivelAte ? new Date(`${f.disponivelAte}T23:59:59-03:00`).toISOString() : null, ativo: f.ativo };
    try { await api(edit.id ? `/admin/recompensas/${edit.id}` : '/admin/recompensas', { method: edit.id ? 'PATCH' : 'POST', body: JSON.stringify(corpo) }); notify('Recompensa salva.'); setEdit(null); await cat.reload(); }
    catch (err) { notify(err instanceof Error ? err.message : 'Não foi possível salvar.', 'error'); } finally { setBusy(false); }
  };
  const alternar = async (r: any) => { if (busy) return; setBusy(true); try { await api(`/admin/recompensas/${r.id}`, { method: 'PATCH', body: JSON.stringify({ ativo: !r.ativo }) }); notify(r.ativo ? 'Recompensa desativada.' : 'Recompensa ativada.'); await cat.reload(); } catch (e) { notify(e instanceof Error ? e.message : 'Erro.', 'error'); } finally { setBusy(false); } };
  const acao = async (v: any, a: 'utilizar' | 'cancelar') => {
    const msg = a === 'cancelar' ? `Cancelar o voucher de ${v.cliente} (${v.recompensa})? ${money(v.custo)} serão devolvidos ao saldo do aluno.` : `Dar baixa no voucher de ${v.cliente}?`;
    if (busy || !window.confirm(msg)) return; setBusy(true);
    try { await api(`/admin/resgates-recompensa/${v.id}`, { method: 'PATCH', body: JSON.stringify({ acao: a }) }); notify('Ação concluída.'); } catch (e) { notify(e instanceof Error ? e.message : 'Não foi possível concluir.', 'error'); } finally { setBusy(false); await Promise.all([vou.reload(), cat.reload()]); }
  };
  const set = (k: keyof Form, v: string | boolean) => setEdit(s => s && { ...s, f: { ...s.f, [k]: v } });
  return <>
    <PageTitle title="Recompensas" description="Cadastre benefícios, controle estoque e acompanhe os vouchers resgatados." action={<button className="button primary" onClick={abrirNovo}>Nova recompensa</button>} />
    <div className="tabs" role="tablist"><button role="tab" aria-selected={aba === 'catalogo'} onClick={() => setAba('catalogo')}>Catálogo</button><button role="tab" aria-selected={aba === 'vouchers'} onClick={() => setAba('vouchers')}>Vouchers resgatados</button></div>
    {aba === 'catalogo' && <Panel><ErrorBlock error={cat.error} />{cat.loading && !cat.data ? <Skeleton lines={5} /> : (cat.data?.recompensas || []).length === 0 ? <EmptyState icon="★" title="Nenhuma recompensa cadastrada" action={<button className="button primary" onClick={abrirNovo}>Cadastrar a primeira</button>}>Os alunos só veem recompensas ativas. Defina custo, estoque e validade.</EmptyState> :
      <Table columns={['Recompensa', 'Custo', 'Estoque', 'Limite/aluno', 'Estabelecimento', 'Resgates', 'Status', 'Ações']} rows={cat.data.recompensas.map((r: any) => [
        <div><strong>{r.nome}</strong><br /><small className="muted">{r.categoria}</small></div>, money(r.custo), r.estoque === null ? 'Sem limite' : r.estoque, r.limite_por_cliente ?? '—', r.estabelecimento || '—', r.resgates,
        <StatusBadge value={r.ativo ? 'ativo' : 'inativo'} />,
        <div className="button-row compact"><button className="button subtle small" disabled={busy} onClick={() => abrirEditar(r)}>Editar</button><button className={`button ${r.ativo ? 'warning' : 'subtle'} small`} disabled={busy} onClick={() => void alternar(r)}>{r.ativo ? 'Desativar' : 'Ativar'}</button></div>,
      ])} />}
      <p className="fine-print">Alterar o custo não muda vouchers já emitidos. Recompensas com resgates não podem ser excluídas; desative-as.</p></Panel>}
    {aba === 'vouchers' && <><div className="toolbar"><label className="field-label compact-label">Status<select value={status} onChange={e => { setStatus(e.target.value); setPagina(1); }}><option value="">Todos</option><option value="ativo">Ativos</option><option value="utilizado">Utilizados</option><option value="cancelado">Cancelados</option><option value="expirado">Expirados</option></select></label><button className="button subtle" onClick={() => void vou.reload()}>Atualizar</button></div>
      <Panel><ErrorBlock error={vou.error} />{vou.loading && !vou.data ? <Skeleton lines={5} /> : <Table columns={['Data', 'Aluno', 'Recompensa', 'Custo', 'Código', 'Validade', 'Status', 'Ações']} empty="Nenhum voucher neste filtro." rows={(vou.data?.resgates || []).map((v: any) => [dateTime(v.criado_em), v.cliente, <div>{v.recompensa}{v.estabelecimento && <><br /><small className="muted">{v.estabelecimento}</small></>}</div>, money(v.custo), <code>{v.codigo.slice(0, 4)}-{v.codigo.slice(4)}</code>, dateTime(v.expira_em), <StatusBadge value={v.status_rotulo} />,
        v.status === 'ativo' ? <div className="button-row compact"><button className="button subtle small" disabled={busy} onClick={() => void acao(v, 'utilizar')}>Dar baixa</button><button className="button danger small" disabled={busy} onClick={() => void acao(v, 'cancelar')}>Cancelar e estornar</button></div> : '—'])} />}
        <div className="pagination"><button className="button subtle small" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>Anterior</button><span>Página {pagina}</span><button className="button subtle small" disabled={pagina * 20 >= (vou.data?.total || 0)} onClick={() => setPagina(pagina + 1)}>Próxima</button></div></Panel></>}
    {edit && <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && !busy && setEdit(null)}><section className="modal-card" role="dialog" aria-modal="true" aria-label="Recompensa" style={{ maxWidth: 560, maxHeight: '92dvh', overflowY: 'auto' }}>
      <button className="close-button" onClick={() => setEdit(null)} aria-label="Fechar">×</button><h2>{edit.id ? 'Editar recompensa' : 'Nova recompensa'}</h2>
      <form className="form-grid tight" onSubmit={salvar}>
        <label className="field-label">Nome<input value={edit.f.nome} onChange={e => set('nome', e.target.value)} required minLength={2} maxLength={120} /></label>
        <label className="field-label">Descrição<textarea className="field" value={edit.f.descricao} onChange={e => set('descricao', e.target.value)} maxLength={1000} /></label>
        <label className="field-label">Categoria<input value={edit.f.categoria} onChange={e => set('categoria', e.target.value)} maxLength={50} required /></label>
        <label className="field-label">Custo (Crisomoedas em R$)<input type="number" min="0.01" step="0.01" value={edit.f.custo} onChange={e => set('custo', e.target.value)} required /></label>
        <label className="field-label">Estoque (vazio = sem limite)<input type="number" min="0" step="1" value={edit.f.estoque} onChange={e => set('estoque', e.target.value)} /></label>
        <label className="field-label">Limite por aluno (vazio = sem limite)<input type="number" min="1" step="1" value={edit.f.limitePorCliente} onChange={e => set('limitePorCliente', e.target.value)} /></label>
        <label className="field-label">Validade do voucher (dias)<input type="number" min="1" max="365" step="1" value={edit.f.validadeDias} onChange={e => set('validadeDias', e.target.value)} required /></label>
        <label className="field-label">Disponível até (opcional)<input type="date" value={edit.f.disponivelAte} onChange={e => set('disponivelAte', e.target.value)} /></label>
        <label className="field-label">Estabelecimento (loja que valida o voucher)<select value={edit.f.idLoja} onChange={e => set('idLoja', e.target.value)}><option value="">Nenhum (baixa só pela administração)</option>{(cat.data?.lojas || []).map((l: any) => <option key={l.id} value={l.id}>{l.nome}</option>)}</select></label>
        <label className="field-label">Regras de utilização<textarea className="field" value={edit.f.regras} onChange={e => set('regras', e.target.value)} maxLength={2000} /></label>
        <label className="check-row"><input type="checkbox" checked={edit.f.ativo} onChange={e => set('ativo', e.target.checked)} />Ativa (visível para os alunos)</label>
        <div className="button-row"><button className="button primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button><button type="button" className="button subtle" disabled={busy} onClick={() => setEdit(null)}>Cancelar</button></div>
      </form></section></div>}
  </>;
}

/** Loja parceira: consulta e dá baixa nos vouchers das suas recompensas. */
export function VoucherValidate() {
  const [codigo, setCodigo] = useState(''); const [v, setV] = useState<any>(null); const [busy, setBusy] = useState(false); const [erro, setErro] = useState('');
  const limpar = (s: string) => s.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 9);
  const consultar = async (e?: FormEvent) => { e?.preventDefault(); setBusy(true); setErro(''); setV(null); try { const d = await post<any>('/loja/recompensas/consultar', { codigo }); setV(d.voucher); } catch (err) { setErro(err instanceof Error ? err.message : 'Não foi possível consultar.'); } finally { setBusy(false); } };
  const baixar = async () => { if (!v || busy || !window.confirm(`Dar baixa em “${v.recompensa}”? Isso não pode ser desfeito.`)) return; setBusy(true); try { await post('/loja/recompensas/utilizar', { codigo }); notify('Voucher utilizado.'); await consultar(); } catch (err) { notify(err instanceof Error ? err.message : 'Não foi possível dar baixa.', 'error'); setBusy(false); } };
  return <>
    <PageTitle title="Validar resgate" description="Confira o código apresentado pelo aluno e dê baixa no benefício." />
    <Panel title="Código do voucher"><form className="stack" onSubmit={consultar}>
      <label className="field-label">Código<input className="code-input" value={codigo} onChange={e => setCodigo(limpar(e.target.value))} placeholder="Ex.: K7M2-9QXA" autoComplete="off" autoCapitalize="characters" spellCheck={false} required /></label>
      <button className="button primary" disabled={busy || codigo.length < 4}>{busy ? 'Consultando…' : 'Consultar'}</button></form>
      {erro && <div className="alert error" role="alert" style={{ marginTop: 12 }}>{erro}</div>}</Panel>
    {v && <Panel title="Voucher"><div className="confirm-card"><div><span className="muted">Recompensa</span><strong>{v.recompensa}</strong></div><div><span className="muted">Aluno</span><strong>{v.cliente}</strong></div><div><span className="muted">Valor</span><strong>{money(v.custo)}</strong></div><div><span className="muted">Validade</span><strong>{dateTime(v.expira_em)}</strong></div><div><span className="muted">Situação</span><strong><StatusBadge value={v.status_rotulo} /></strong></div>{v.usado_em && <div><span className="muted">Utilizado em</span><strong>{dateTime(v.usado_em)}</strong></div>}</div>
      {v.status === 'ativo' ? <button className="button primary" disabled={busy} onClick={() => void baixar()}>Dar baixa no voucher</button> : <div className="alert info">Este voucher não pode mais ser utilizado.</div>}</Panel>}
    <p className="fine-print">Você só enxerga vouchers das recompensas vinculadas à sua loja.</p>
  </>;
}
