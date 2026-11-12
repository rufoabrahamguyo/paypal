import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AgGridReact } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import { api } from '../lib/api.js';
import { when } from '../lib/format.js';
import { useLoad, useTitle } from '../lib/hooks.js';
import { useToast } from '../lib/toast.jsx';
import { DashHead, ErrorNote, Loading, Panel, Stat, TicketBadge } from '../components/ui.jsx';

const KINDS = ['all', 'order', 'paypal', 'dispute', 'support', 'webhook'];
const DECISION = {
  release_full: ['Released to seller', 'b-emerald'],
  partial_refund: ['Partial refund', 'b-teal'],
  refund_full: ['Hold voided', 'b-violet'],
  escalate_to_human: ['Escalated', 'b-amber'],
};
const KYC_BADGE = { verified: 'b-emerald', rejected: 'b-rose', none: 'b-slate' };
const fmtMoney = (v, cur) => (v == null ? '—' : `${Number(v).toFixed(2)} ${cur || ''}`.trim());

// ---- AI decisions ledger ------------------------------------------------------
function LedgerStats({ rows }) {
  const decided = rows.filter((r) => r.decision);
  const auto = decided.filter((r) => r.decision !== 'escalate_to_human' && !r.human_decision);
  const guarded = decided.filter((r) => r.guardrail);
  const secs = decided.map((r) => r.seconds_to_decide).filter((x) => x != null).sort((a, b) => a - b);
  const returned = decided.reduce((sum, r) => sum + (r.decision === 'refund_full' ? r.amount : r.decision === 'partial_refund' ? r.refund_amount || 0 : 0), 0);
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
  const currencies = [...new Set(decided.map((r) => r.currency))];
  return (
    <section className="stats ledger-stats" aria-label="Agent performance">
      <Stat label="Disputes" value={rows.length} note="Rulings in this ledger" />
      <Stat label="Settled by the agent" value={pct(auto.length, decided.length)} note="No person had to step in" tone="good" />
      <Stat label="Stopped by a guardrail" value={guarded.length} note="Held for a person" tone={guarded.length ? 'warn' : undefined} />
      <Stat label="Median time" value={secs.length ? `${secs[Math.floor(secs.length / 2)]}s` : '—'} note="From open to ruling" />
      <Stat icon="wallet" label="Returned to buyers" value={`${returned.toFixed(2)}${currencies.length === 1 ? ` ${currencies[0]}` : ''}`} note="Voids and partial refunds" />
    </section>
  );
}

const BuyerCell = ({ value }) => <span className={`badge ${value === 'agent' ? 'b-indigo' : 'b-slate'}`}>{value || ''}</span>;
function DecisionCell({ data }) {
  const key = data.human_decision || data.decision;
  const [label, cls] = DECISION[key] || [data.status, 'b-slate'];
  return <span className={`badge ${cls}`}>{label}{data.human_decision ? ' · human' : ''}</span>;
}
function ConfidenceCell({ value }) {
  if (value == null) return <span className="meta">—</span>;
  const pct = Math.round(value * 100);
  return <><div className="mini-meter"><span style={{ width: `${pct}%` }} className={pct >= 70 ? '' : 'is-mid'} /></div><b>{pct}%</b></>;
}

function Ledger() {
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState('');
  useEffect(() => {
    let timer;
    let live = true;
    const load = async () => {
      try {
        const next = await api('/api/admin/disputes');
        if (!live) return;
        setRows(next);
        if (next.some((r) => r.status === 'OPEN' || r.status === 'RUNNING')) timer = setTimeout(load, 3000);
      } catch { /* the audit trail below shows errors */ }
    };
    load();
    return () => { live = false; clearTimeout(timer); };
  }, []);

  const columnDefs = useMemo(() => [
    { field: 'created_at', headerName: 'Opened', sort: 'desc', width: 170, valueFormatter: (p) => when(p.value) },
    { field: 'item', headerName: 'Item', flex: 2, minWidth: 200, tooltipField: 'complaint' },
    { field: 'seller', headerName: 'Seller', flex: 1, minWidth: 140 },
    { field: 'buyer_kind', headerName: 'Buyer', width: 100, cellRenderer: BuyerCell },
    { field: 'amount', headerName: 'Held', width: 120, type: 'numericColumn', valueFormatter: (p) => fmtMoney(p.value, p.data.currency) },
    { field: 'decision', headerName: 'Decision', width: 170, valueGetter: (p) => (p.data.human_decision ? `${p.data.human_decision} (human)` : p.data.decision || p.data.status), cellRenderer: DecisionCell },
    { field: 'refund_amount', headerName: 'Refund', width: 110, type: 'numericColumn', valueFormatter: (p) => (p.value ? fmtMoney(p.value, p.data.currency) : '—') },
    { field: 'confidence', headerName: 'Confidence', width: 150, filter: 'agNumberColumnFilter', cellRenderer: ConfidenceCell },
    { field: 'guardrail', headerName: 'Guardrail', flex: 2, minWidth: 220, tooltipField: 'guardrail', valueFormatter: (p) => p.value || '—' },
    { field: 'proposed_decision', headerName: 'Agent wanted', width: 140, valueFormatter: (p) => p.value || '—' },
    { field: 'engine', headerName: 'Engine', width: 150 },
    { field: 'seconds_to_decide', headerName: 'Time', width: 90, type: 'numericColumn', valueFormatter: (p) => (p.value == null ? '—' : `${p.value}s`) },
    { field: 'order_state', headerName: 'Order', width: 160 },
    { field: 'authorization_id', headerName: 'PayPal authorization', width: 220, cellClass: 'mono' },
    { field: 'capture_id', headerName: 'PayPal capture', width: 200, cellClass: 'mono', valueFormatter: (p) => p.value || '—' },
  ], []);

  const tall = rows && rows.length > 12;
  return (
    <section className="stack" aria-labelledby="ledgerTitle" style={{ marginTop: 18 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, alignItems: 'end' }}>
        <div>
          <h2 id="ledgerTitle" className="section-title" style={{ margin: 0 }}>AI decisions ledger</h2>
          <p className="meta" style={{ margin: '4px 0 0' }}>Every dispute the agent ruled on: what it decided, how sure it was, which guardrail stopped it, and the PayPal call it made. Click a row to open the order.</p>
        </div>
        <input className="field" type="search" placeholder="Filter decisions…" aria-label="Filter decisions" style={{ maxWidth: 240, marginTop: 0 }} value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      {rows && <LedgerStats rows={rows} />}
      <div className="ag-theme-quartz-auto-dark ledger-grid" role="region" aria-label="Dispute decisions" style={tall ? { height: 520 } : undefined}>
        {rows && (
          <AgGridReact
            rowData={rows}
            columnDefs={columnDefs}
            quickFilterText={filter}
            domLayout={tall ? 'normal' : 'autoHeight'}
            animateRows
            pagination={rows.length > 25}
            paginationPageSize={25}
            defaultColDef={{ sortable: true, filter: true, resizable: true, minWidth: 90 }}
            rowClass="ledger-row"
            onRowClicked={(e) => navigate(`/o/${e.data.order_id}`)}
          />
        )}
      </div>
    </section>
  );
}

// ---- identity review ------------------------------------------------------------
function IdShot({ row, kind, label }) {
  return (
    <div>
      <p className="lbl">{label}</p>
      {row[kind] ? <img className="id-preview" alt={label} src={`/api/admin/sellers/${row.seller_id}/identity/${kind}`} /> : <p className="meta" style={{ margin: 0 }}>Missing</p>}
    </div>
  );
}

function IdentityCard({ row, onChange }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const status = row.kyc_status || 'none';
  async function review(next) {
    setBusy(true);
    try {
      await api(`/api/admin/sellers/${row.seller_id}/kyc`, { json: { status: next, note } });
      toast(next === 'verified' ? 'Seller confirmed' : 'Sent back to the seller', 'info');
      setNote('');
      await onChange();
    } catch (err) { toast(err.message); }
    setBusy(false);
  }
  return (
    <article className="card card-pad stack">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <h2>{row.name}</h2>
          <p className="meta" style={{ margin: '4px 0 0' }}>{row.email || ''} · {row.complete ? 'all three on file' : 'incomplete'}{row.national_id_last4 ? ` · ID ending ${row.national_id_last4}` : ''} · {when(row.submitted_at)}</p>
        </div>
        <span className={`badge ${KYC_BADGE[status] || 'b-slate'}`}>{status === 'none' ? 'not submitted' : status}</span>
      </div>
      {row.kyc_note && <p className="meta" style={{ margin: 0 }}>Issue sent to the seller: {row.kyc_note}</p>}
      <div className="id-grid">
        <IdShot row={row} kind="id_front" label="ID card, front" />
        <IdShot row={row} kind="id_back" label="ID card, back" />
        <IdShot row={row} kind="face" label="Photo of their face" />
      </div>
      <div className="stack">
        <label className="lbl">What the seller must fix <span className="opt">required to reject</span>
          <input className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. The face photo does not match the ID photo" />
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button className="btn btn-success" type="button" disabled={busy} onClick={() => review('verified')}>Confirm identity</button>
          <button className="btn btn-alert" type="button" disabled={busy} onClick={() => review('rejected')}>Send back to fix</button>
        </div>
      </div>
    </article>
  );
}

// ---- complaints -----------------------------------------------------------------
function TicketCard({ ticket: t, onChange }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (fn, msg) => {
    setBusy(true);
    try { await fn(); toast(msg, 'info'); await onChange(); } catch (err) { toast(err.message); }
    setBusy(false);
  };
  return (
    <article className="card card-pad stack">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
        <div><h2>{t.subject}</h2><p className="meta" style={{ margin: '4px 0 0' }}>{t.author_role} · {t.author_email} · {t.topic}{t.order_id ? ` · ${t.order_id}` : ''}</p></div>
        <TicketBadge status={t.status} />
      </div>
      <p style={{ margin: 0 }}>{t.body}</p>
      <form className="stack" onSubmit={(e) => {
        e.preventDefault();
        const body = new FormData(e.target).get('body');
        run(async () => { await api(`/api/support/${t.id}/replies`, { json: { author_role: 'support', body } }); e.target.reset(); }, 'Reply sent');
      }}>
        <label className="lbl">Support reply
          <textarea name="body" required rows={2} className="field" placeholder="What should the buyer or seller know?" />
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button className="btn btn-primary" type="submit" disabled={busy}>Send reply</button>
          <button className="btn btn-line" type="button" disabled={busy} onClick={() => run(() => api(`/api/support/${t.id}/status`, { json: { status: 'in_review' } }), 'Ticket updated')}>Mark in review</button>
          <button className="btn btn-success" type="button" disabled={busy} onClick={() => run(() => api(`/api/support/${t.id}/status`, { json: { status: 'resolved' } }), 'Ticket updated')}>Resolve</button>
        </div>
      </form>
      <Link to={`/support/${t.id}`}>Open the thread</Link>
    </article>
  );
}

export default function Admin() {
  useTitle('Audit');
  const navigate = useNavigate();
  const [kind, setKind] = useState('all');
  const { data, error, reload } = useLoad(() => api('/api/admin/audit'));
  const rows = data ? data.trail.filter((r) => kind === 'all' || r.kind === kind) : [];

  const open = data?.counts.tickets_open || 0;
  return (
    <main id="main" className="page">
      <DashHead
        kicker="Audit desk"
        title="Audit trail"
        lead="Every order transition, PayPal call, dispute decision, webhook, and support ticket."
      />
      <ErrorNote error={error} />
      {!data ? <Loading>Loading the trail…</Loading> : (
        <>
          <section className="stats" aria-label="Audit counts">
            <Stat icon="orders" label="Orders" value={data.counts.orders} note="Across every shop" />
            <Stat icon="audit" label="State changes" value={data.counts.events} note="Recorded on the trail" />
            <Stat icon="wallet" label="PayPal calls" value={data.counts.paypal_calls} note="Authorize, capture, void" />
            <Stat icon="flag" label="Open reports" value={open} note={open ? 'Waiting on this desk' : 'Inbox is clear'} tone={open ? 'warn' : 'good'} />
          </section>
          <div className="dash-board">
            <Panel title="Open reports">
              {data.tickets.length ? data.tickets.map((t) => <TicketCard key={t.id} ticket={t} onChange={reload} />)
                : <p className="empty">No open complaints.</p>}
            </Panel>
            <Panel title="Identity checks">
              <p className="meta" style={{ margin: 0, padding: '12px 18px 0' }}>ID cards and face photos stay on this desk. Buyers never see them.</p>
              {data.identities?.length ? data.identities.map((row) => <IdentityCard key={row.seller_id} row={row} onChange={reload} />)
                : <p className="empty">No identity documents yet.</p>}
            </Panel>
          </div>
          <Ledger />
          <div className="filters section-gap" role="toolbar" aria-label="Filter the trail">
            {KINDS.map((k) => <button key={k} type="button" className="btn btn-line" aria-pressed={k === kind} onClick={() => setKind(k)}>{k}</button>)}
          </div>
          <div className="card table-wrap">
            {rows.length ? (
              <table className="data">
                <thead><tr><th>When</th><th>Kind</th><th>What happened</th><th>Actor</th></tr></thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i} tabIndex={row.href ? 0 : undefined} data-href={row.href || undefined}
                      onClick={() => row.href && navigate(row.href)}
                      onKeyDown={(e) => { if (row.href && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); navigate(row.href); } }}>
                      <td className="meta">{when(row.at)}</td>
                      <td><span className="badge b-slate">{row.kind}</span></td>
                      <td><b>{row.title || ''}</b><div className="meta">{row.summary}</div></td>
                      <td className="meta">{row.actor || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="empty">Nothing in this filter yet.</p>}
          </div>
        </>
      )}
    </main>
  );
}
