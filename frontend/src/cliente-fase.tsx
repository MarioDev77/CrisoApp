import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, dateTime, materialLabels, materials, money, post } from './api';
import { EmptyState, ErrorBlock, formatCode, fmtNum, newKey, notify, PageTitle, Panel, Progress, Skeleton, Stat, StatsSkeleton, StatusBadge, Table, useLoad } from './ui';

const emoji: Record<string, string> = { papelao: '📦', plastico: '🧴', aluminio: '🥫', vidro: '🍾' };
const tipoRotulo: Record<string, string> = { reciclagem: 'Reciclagem', resgate_pix: 'Resgate em dinheiro', resgate_recompensa: 'Recompensa', desconto_loja: 'Desconto na loja', estorno: 'Estorno', outro: 'Movimentação' };

function MovimentosTabela({ itens, vazio }: { itens: any[]; vazio: string }) {
  return <Table columns={['Data', 'Operação', 'Origem', 'Valor', 'Status', 'Ref.']} empty={vazio} rows={itens.map(m => [
    dateTime(m.criado_em),
    <div><strong>{tipoRotulo[m.tipo_operacao] || 'Movimentação'}</strong><br /><small className="muted">{m.materiais && m.materiais !== '-' ? m.materiais : ''}</small></div>,
    m.origem,
    <span className={m.tipo === 'credito' ? 'positive' : 'negative'}>{m.tipo === 'credito' ? '+' : '−'}{money(m.valor)}</span>,
    <div><StatusBadge value={m.status_rotulo} />{m.disponivel_em && <><br /><small className="muted">livre em {dateTime(m.disponivel_em)}</small></>}</div>,
    <span title="Identificador da transação">#{m.id}</span>,
  ])} />;
}

/** Início do aluno: saldo, reciclagem, meta do mês, recompensas e últimas movimentações (tudo vindo do servidor). */
export function StudentDashboard({ nome, onNavigate }: { nome: string; onNavigate: (id: string) => void }) {
  const d = useLoad<any>('/cliente/dashboard');
  const x = d.data;
  return <>
    <PageTitle title={`Olá, ${nome.split(' ')[0]} 👋`} description="Acompanhe suas Crisomoedas, sua reciclagem e suas recompensas." action={<button className="button subtle" onClick={() => void d.reload()} disabled={d.loading}>Atualizar</button>} />
    <ErrorBlock error={d.error} />
    {d.loading && !x ? <><StatsSkeleton /><Panel><Skeleton lines={4} /></Panel></> : x && <>
      <div className="stats-grid">
        <Stat label="Saldo disponível" value={money(x.carteira.saldo)} icon="◉" caption={x.carteira.saldo_pendente > 0 ? `+ ${money(x.carteira.saldo_pendente)} em carência` : 'Crisomoedas'} />
        <Stat label="Materiais reciclados" value={`${fmtNum(x.resumo.total_reciclado_kg)} kg`} icon="♻" caption="peso estimado pela regra da plataforma" />
        <Stat label="Reciclagens confirmadas" value={x.resumo.reciclagens} icon="▦" caption={`${x.resumo.operacoes_totais} movimentações no total`} />
        <Stat label="Vouchers ativos" value={x.recompensas.vouchers_ativos} icon="★" caption="prontos para usar" />
      </div>
      <div className="two-up">
        <Panel title="Meta de reciclagem do mês">
          <div className="progress-meta"><strong>{fmtNum(x.meta_mensal.reciclado_kg)} kg de {fmtNum(x.meta_mensal.meta_kg)} kg</strong><span className="muted">{x.meta_mensal.percentual}%</span></div>
          <Progress value={x.meta_mensal.percentual} label="Progresso da meta mensal de reciclagem" tone={x.meta_mensal.atingida ? 'gold' : 'green'} />
          <p className="inline-note">{x.meta_mensal.atingida ? 'Meta do mês atingida. Parabéns!' : x.meta_mensal.reciclado_kg === 0 ? 'Você ainda não reciclou neste mês. Leve seus materiais a uma loja parceira.' : `Faltam ${fmtNum(x.meta_mensal.meta_kg - x.meta_mensal.reciclado_kg)} kg para a meta.`} A meta é definida pela administração.</p>
        </Panel>
        <Panel title="Recompensas" action={<button className="button subtle small" onClick={() => onNavigate('recompensas')}>Ver loja</button>}>
          {x.recompensas.disponiveis === 0 ? <EmptyState icon="★" title="Nenhuma recompensa cadastrada ainda">Assim que a administração publicar recompensas, elas aparecem aqui.</EmptyState> : <>
            <p style={{ margin: '0 0 10px' }}><strong>{x.recompensas.alcancaveis}</strong> de {x.recompensas.disponiveis} recompensas cabem no seu saldo agora.</p>
            {x.recompensas.destaques.length ? <ul className="bar-list">{x.recompensas.destaques.map((r: any) => <li key={r.id}><div className="bar-head"><span>{r.nome}</span><strong>{money(r.custo)}</strong></div></li>)}</ul> : <p className="inline-note">Recicle mais para desbloquear sua primeira recompensa.</p>}
          </>}
        </Panel>
      </div>
      <Panel title="Atalhos"><div className="shortcut-grid"><button onClick={() => onNavigate('qrcode')}><span>▦</span><strong>Ler QR Code</strong><small>Confirmar crédito ou desconto</small></button><button onClick={() => onNavigate('recompensas')}><span>★</span><strong>Recompensas</strong><small>Trocar Crisomoedas por benefícios</small></button><button onClick={() => onNavigate('reciclagem')}><span>♻</span><strong>Minha reciclagem</strong><small>Materiais e status de cada troca</small></button></div></Panel>
      <Panel title="Últimas movimentações" action={<button className="button subtle small" onClick={() => onNavigate('historico')}>Ver tudo</button>}>
        {x.ultimas_movimentacoes.length === 0 ? <EmptyState icon="▤" title="Nenhuma movimentação ainda" action={<button className="button primary" onClick={() => onNavigate('como-funciona')}>Como funciona</button>}>Quando você confirmar seu primeiro QR Code de reciclagem, ele aparece aqui.</EmptyState> : <MovimentosTabela itens={x.ultimas_movimentacoes} vazio="" />}
      </Panel>
    </>}
  </>;
}

/** Acompanhamento das reciclagens confirmadas do aluno. */
export function RecyclingPage({ onNavigate }: { onNavigate: (id: string) => void }) {
  const [pagina, setPagina] = useState(1); const [material, setMaterial] = useState('');
  const r = useLoad<any>(`/cliente/reciclagens?pagina=${pagina}${material ? `&material=${material}` : ''}`);
  const x = r.data;
  return <>
    <PageTitle title="Minha reciclagem" description="Cada troca confirmada por QR Code, com materiais, peso estimado e situação do crédito." action={<button className="button primary" onClick={() => onNavigate('qrcode')}>Ler QR Code</button>} />
    <ErrorBlock error={r.error} />
    {r.loading && !x ? <><StatsSkeleton /><Panel><Skeleton lines={5} /></Panel></> : x && <>
      <div className="stats-grid">{materials.map(m => <Stat key={m} label={materialLabels[m]} value={`${fmtNum(x.totais_por_material[m], 0)} un.`} icon={emoji[m]} caption="total reciclado" />)}</div>
      <div className="toolbar"><label className="field-label compact-label">Material<select value={material} onChange={e => { setMaterial(e.target.value); setPagina(1); }}><option value="">Todos</option>{materials.map(m => <option key={m} value={m}>{materialLabels[m]}</option>)}</select></label></div>
      <Panel title="Reciclagens confirmadas">
        {x.total === 0 ? <EmptyState icon="♻" title={material ? 'Nenhuma reciclagem com esse material' : 'Você ainda não reciclou por aqui'} action={!material && <button className="button primary" onClick={() => onNavigate('como-funciona')}>Ver como funciona</button>}>{material ? 'Tente outro material ou limpe o filtro.' : 'Leve papelão, plástico, alumínio ou vidro a uma loja parceira e leia o QR Code gerado por ela.'}</EmptyState> :
          <Table columns={['Data', 'Loja', 'Materiais', 'Peso (est.)', 'Créditos', 'Situação', 'Ref. QR']} rows={x.reciclagens.map((t: any) => [
            dateTime(t.criado_em), t.loja || '—',
            <div className="chip-row">{materials.filter(m => t.materiais[m] > 0).map(m => <span className="chip" key={m}>{emoji[m]} {materialLabels[m]}: {t.materiais[m]}</span>)}</div>,
            `${fmtNum(t.kg, 2)} kg`, <span className="positive">+{money(t.creditos)}</span>,
            <div><StatusBadge value={t.status_rotulo} />{t.disponivel_em && <><br /><small className="muted">livre em {dateTime(t.disponivel_em)}</small></>}</div>,
            t.referencia_qr ? `#${t.referencia_qr}` : '—',
          ])} />}
        <div className="pagination"><button className="button subtle small" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>Anterior</button><span>Página {pagina}</span><button className="button subtle small" disabled={pagina * x.por_pagina >= x.total} onClick={() => setPagina(pagina + 1)}>Próxima</button></div>
      </Panel>
      <p className="fine-print">Créditos de reciclagem ficam em carência por um tempo antes de poderem ser gastos. O peso é estimado pela regra da plataforma (0,05 kg por unidade), não é pesagem real.</p>
    </>}
  </>;
}

/** Detalhes extras na conferência do QR (materiais, peso, carência). */
export function QrDetails({ v }: { v: any }) {
  if (v.tipo !== 'credito' || !v.materiais) return null;
  return <div style={{ margin: '12px 0' }}>
    <div className="chip-row">{materials.filter(m => v.materiais[m] > 0).map(m => <span className="chip" key={m}>{emoji[m]} {materialLabels[m]}: {v.materiais[m]} un.</span>)}</div>
    <p className="inline-note">Peso estimado: {fmtNum(v.kg, 2)} kg · Referência do QR: #{v.id_transacao}.{v.carencia_horas > 0 ? ` O crédito entra no saldo e fica livre para uso após ${v.carencia_horas} h.` : ''} O valor é recalculado pelo servidor ao confirmar.</p>
  </div>;
}

/** Comprovante exibido depois de confirmar um QR. */
export function QrSuccess({ r, onClose }: { r: any; onClose: () => void }) {
  const o = r.operacao;
  return <Panel title="Operação concluída" action={<button className="button subtle small" onClick={onClose}>Fechar</button>}>
    <div className="alert success" role="status">{r.mensagem}</div>
    {o && <div className="confirm-card">
      <div><span className="muted">Tipo</span><strong>{o.tipo === 'credito' ? 'Reciclagem' : 'Desconto'}</strong></div>
      <div><span className="muted">Loja</span><strong>{o.loja || '—'}</strong></div>
      <div><span className="muted">Valor</span><strong className={o.tipo === 'credito' ? 'positive' : 'negative'}>{o.tipo === 'credito' ? '+' : '−'}{money(o.valor)}</strong></div>
      {o.tipo === 'credito' && <div><span className="muted">Peso estimado</span><strong>{fmtNum(o.kg, 2)} kg</strong></div>}
      <div><span className="muted">Situação</span><strong>{o.status === 'em_carencia' ? `Em carência até ${dateTime(o.disponivel_em)}` : 'Concluído'}</strong></div>
      <div><span className="muted">Referências</span><strong>Transação #{o.id_transacao} · QR #{o.referencia_qr}</strong></div>
    </div>}
    <p className="inline-note">Novo saldo total: {money(r.novo_saldo)}</p>
    {o?.materiais && <div className="chip-row">{materials.filter(m => o.materiais[m] > 0).map(m => <span className="chip" key={m}>{emoji[m]} {materialLabels[m]}: {o.materiais[m]}</span>)}</div>}
  </Panel>;
}

/** Loja de recompensas: catálogo + meus resgates. Preço, saldo e estoque são conferidos de novo no servidor. */
export function RewardsPage({ onNavigate }: { onNavigate: (id: string) => void }) {
  const navigate = useNavigate();
  const [aba, setAba] = useState<'catalogo' | 'meus'>('catalogo');
  const [busca, setBusca] = useState(''); const [buscaAplicada, setBuscaAplicada] = useState(''); const [categoria, setCategoria] = useState('');
  const cat = useLoad<any>(`/cliente/recompensas?${new URLSearchParams({ ...(buscaAplicada ? { busca: buscaAplicada } : {}), ...(categoria ? { categoria } : {}) })}`);
  const meus = useLoad<any>('/cliente/recompensas/meus');
  const [sel, setSel] = useState<any>(null); const [busy, setBusy] = useState(false); const [voucher, setVoucher] = useState<any>(null); const [erro, setErro] = useState('');
  const chave = useRef('');
  useEffect(() => { const t = window.setTimeout(() => setBuscaAplicada(busca.trim()), 350); return () => window.clearTimeout(t); }, [busca]);
  const abrir = (r: any) => { chave.current = newKey(); setSel(r); setVoucher(null); setErro(''); };
  const confirmar = async () => {
    if (!sel || busy) return; setBusy(true); setErro('');
    try { const d = await post<any>(`/cliente/recompensas/${sel.id}/resgatar`, { chave: chave.current }); setVoucher(d.voucher); notify(d.mensagem); await Promise.all([cat.reload(), meus.reload()]); }
    catch (e) {
      if (e instanceof ApiError && e.data.perfil_incompleto) { notify('Complete seu perfil para continuar.', 'error'); navigate('/app/cliente/perfil'); return; }
      setErro(e instanceof Error ? e.message : 'Não foi possível concluir o resgate.'); void cat.reload();
    } finally { setBusy(false); }
  };
  const saldo = Number(cat.data?.saldo_disponivel || 0);
  return <>
    <PageTitle title="Loja de recompensas" description="Troque suas Crisomoedas por benefícios de estabelecimentos parceiros." />
    <div className="tabs" role="tablist"><button role="tab" aria-selected={aba === 'catalogo'} onClick={() => setAba('catalogo')}>Catálogo</button><button role="tab" aria-selected={aba === 'meus'} onClick={() => setAba('meus')}>Meus resgates{meus.data?.resgates?.length ? ` (${meus.data.resgates.length})` : ''}</button></div>
    {aba === 'catalogo' && <>
      <ErrorBlock error={cat.error} />
      <div className="toolbar">
        <label className="field-label compact-label">Buscar<input type="search" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Nome da recompensa" maxLength={60} /></label>
        <label className="field-label compact-label">Categoria<select value={categoria} onChange={e => setCategoria(e.target.value)}><option value="">Todas</option>{(cat.data?.categorias || []).map((c: string) => <option key={c} value={c}>{c}</option>)}</select></label>
        <div className="alert info" style={{ margin: 0 }}>Saldo disponível: <strong>{money(saldo)}</strong></div>
      </div>
      {cat.loading && !cat.data ? <Panel><Skeleton lines={5} /></Panel> : (cat.data?.recompensas || []).length === 0 ?
        <Panel><EmptyState icon="★" title={buscaAplicada || categoria ? 'Nada encontrado' : 'Ainda não há recompensas'}>{buscaAplicada || categoria ? 'Tente outra busca ou limpe os filtros.' : 'Quando a administração cadastrar recompensas, elas aparecem aqui.'}</EmptyState></Panel> :
        <div className="product-grid">{cat.data.recompensas.map((r: any) => {
          const pode = r.disponivel && r.saldo_suficiente;
          return <article className="product-card reward-card" key={r.id} data-off={!pode}>
            <span className="reward-meta"><span className="chip">{r.categoria}</span></span>
            <h3>{r.nome}</h3>
            {r.descricao && <p>{r.descricao}</p>}
            <div className="reward-price">{money(r.custo)}</div>
            <div className="reward-meta">{r.estabelecimento && <span>🏪 {r.estabelecimento}</span>}<span>Validade: {r.validade_dias} dias após o resgate</span>{r.estoque !== null && r.estoque > 0 && r.estoque <= 10 && <span>Restam {r.estoque}</span>}{r.disponivel_ate && <span>Até {new Date(r.disponivel_ate).toLocaleDateString('pt-BR')}</span>}</div>
            <button className="button primary full" disabled={!pode} onClick={() => abrir(r)} aria-label={`Resgatar ${r.nome}`}>{!r.disponivel ? r.motivo_indisponivel : !r.saldo_suficiente ? `Faltam ${money(r.custo - saldo)}` : 'Resgatar'}</button>
          </article>;
        })}</div>}
    </>}
    {aba === 'meus' && <>
      <ErrorBlock error={meus.error} />
      {meus.loading && !meus.data ? <Panel><Skeleton lines={4} /></Panel> : (meus.data?.resgates || []).length === 0 ?
        <Panel><EmptyState icon="🎟" title="Você ainda não resgatou nada" action={<button className="button primary" onClick={() => setAba('catalogo')}>Ver catálogo</button>}>Os vouchers que você gerar ficam guardados aqui, com código e validade.</EmptyState></Panel> :
        <div className="voucher-list">{meus.data.resgates.map((v: any) => <article className="voucher-card" key={v.id}>
          <header><h3>{v.nome}</h3><StatusBadge value={v.status_rotulo} /></header>
          <code className="voucher-code" aria-label={`Código ${formatCode(v.codigo)}`}>{formatCode(v.codigo)}</code>
          <div className="reward-meta"><span>Custo: {money(v.custo)}</span><span>Resgatado em {dateTime(v.criado_em)}</span><span>Vence em {dateTime(v.expira_em)}</span>{v.usado_em && <span>Usado em {dateTime(v.usado_em)}</span>}{v.estabelecimento && <span>🏪 {v.estabelecimento}</span>}</div>
          {v.instrucoes && <p className="inline-note">{v.instrucoes}</p>}{v.regras && <p className="inline-note">Regras: {v.regras}</p>}
        </article>)}</div>}
      <p className="fine-print">Voucher vencido não é reembolsado automaticamente. Em caso de dúvida, fale com a administração. <button className="inline-link" onClick={() => onNavigate('historico')}>Ver extrato</button></p>
    </>}
    {sel && <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && !busy && setSel(null)}><section className="modal-card" role="dialog" aria-modal="true" aria-label="Confirmar resgate">
      <button className="close-button" onClick={() => setSel(null)} aria-label="Fechar">×</button>
      {voucher ? <>
        <h2>Resgate concluído</h2><p className="muted">Apresente este código no estabelecimento antes de {dateTime(voucher.expira_em)}.</p>
        <code className="voucher-code">{voucher.codigo}</code>
        <p className="inline-note">Seu saldo foi atualizado. O voucher também fica em “Meus resgates”.</p>
        <button className="button primary full" onClick={() => { setSel(null); setAba('meus'); }}>Ver meus resgates</button>
      </> : <>
        <h2>Confirmar resgate?</h2><p><strong>{sel.nome}</strong></p>
        <div className="price-breakdown"><span>Custo<strong>{money(sel.custo)}</strong></span><span>Saldo atual<strong>{money(saldo)}</strong></span><span>Saldo depois<strong>{money(saldo - sel.custo)}</strong></span></div>
        {sel.regras && <p className="fine-print">Regras: {sel.regras}</p>}
        <p className="fine-print">Voucher válido por {sel.validade_dias} dias. O débito é feito pelo servidor e só é desfeito pela administração.</p>
        {erro && <div className="alert error" role="alert">{erro}</div>}
        <div className="button-row"><button className="button primary" disabled={busy} onClick={() => void confirmar()}>{busy ? 'Processando…' : 'Confirmar resgate'}</button><button className="button subtle" disabled={busy} onClick={() => setSel(null)}>Cancelar</button></div>
      </>}
    </section></div>}
  </>;
}
