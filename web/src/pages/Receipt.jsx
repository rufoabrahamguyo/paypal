import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { money, stateLabel } from '../lib/format.js';
import { useLoad, useTitle } from '../lib/hooks.js';
import { ErrorNote, Loading, Mark } from '../components/ui.jsx';

const OUTCOME = {
  RELEASED: 'Paid to the seller after the buyer confirmed the item',
  PAID: 'Paid to the seller with PayPal Checkout',
  VOIDED: 'Hold cancelled. The buyer was not charged',
  RESOLVED_RELEASE: 'Dispute ruling: paid to the seller',
  RESOLVED_PARTIAL: 'Dispute ruling: partly refunded to the buyer',
  RESOLVED_REFUND: 'Dispute ruling: refunded. The buyer was not charged',
};

const Line = ({ k, children, total }) => <div className={`summary-line${total ? ' summary-total' : ''}`}><span>{k}</span><span>{children}</span></div>;

// The digital receipt, issued once the money has settled. Printable.
export default function Receipt() {
  const { id } = useParams();
  const { data: v, error } = useLoad(() => api(`/api/orders/${encodeURIComponent(id)}`), [id]);
  useTitle(v ? `Receipt ${v.order.id}` : 'Receipt');
  if (error) return <main className="page" id="main"><ErrorNote error={error} /></main>;
  if (!v) return <main className="page" id="main"><Loading /></main>;
  const { order: o, listing: l, seller: s, events } = v;
  if (!o.settled) {
    return (
      <main className="page" id="main">
        <div className="callout callout-warn">The receipt is issued once the payment settles. This order is: <b>{stateLabel(o.state)}</b>.</div>
        <p><Link to={`/o/${o.id}`}>Back to the order</Link></p>
      </main>
    );
  }
  const charged = o.captured_amount ?? (o.state === 'PAID' ? o.amount : 0);
  const returned = Math.max(0, Math.round((o.amount - charged) * 100) / 100);
  const issued = events.at(-1)?.created_at || o.updated_at;
  const mono = (x) => <span className="mono">{x || '—'}</span>;
  return (
    <main className="page" id="main">
      <div className="no-print" style={{ display: 'flex', gap: 8, justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 16 }}>
        <Link to={`/o/${o.id}`}>← Back to the order</Link>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>Print or save as PDF</button>
      </div>
      <article className="card receipt stack">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div className="brand"><span className="brand-mark"><Mark /></span><span><span className="brand-name">Funguo</span><span className="brand-sub">Escrow on PayPal</span></span></div>
          <div style={{ textAlign: 'right' }}>
            <h1>Receipt</h1>
            <p className="meta" style={{ margin: '4px 0 0' }}>No. <span className="mono">RCT-{o.id.replace(/^ord_/, '')}</span><br />Issued {new Date(issued).toLocaleString()}</p>
          </div>
        </div>
        <div className="pair">
          <div><p className="eyebrow">Buyer</p><p style={{ margin: '4px 0 0' }}>{o.buyer_name || '—'}<br /><span className="meta">{o.buyer_email || ''}</span></p></div>
          <div><p className="eyebrow">Seller</p><p style={{ margin: '4px 0 0' }}>{s.name}<br /><span className="meta">{s.verified ? 'National ID verified' : ''}</span></p></div>
        </div>
        <div>
          <p className="eyebrow">Item</p>
          <Line k={l.title}>{money(o.amount, o.currency)}</Line>
          <Line k="Payment option">{o.payment_option === 'checkout' ? 'PayPal Checkout' : 'Pal-Lock (authorization hold)'}</Line>
          <Line k="Authorized by PayPal">{money(o.amount, o.currency)}</Line>
          <Line k="Returned to the buyer">{money(returned, o.currency)}</Line>
          <Line k="Total charged" total>{money(charged, o.currency)}</Line>
        </div>
        <div className={`callout ${charged ? 'callout-ok' : 'callout-warn'}`} style={{ margin: 0 }}><b>Outcome.</b> {OUTCOME[o.state] || stateLabel(o.state)}.</div>
        <div>
          <p className="eyebrow">PayPal references</p>
          <Line k="Funguo order">{mono(o.id)}</Line>
          <Line k="PayPal order">{mono(o.paypal_order_id)}</Line>
          <Line k="Authorization">{mono(o.authorization_id)}</Line>
          <Line k="Capture">{mono(o.capture_id)}</Line>
          {o.tracking_number && <Line k="Shipment">{o.carrier} {mono(o.tracking_number)}</Line>}
          <Line k="Ordered">{new Date(o.created_at).toLocaleString()}</Line>
        </div>
        <p className="fine" style={{ margin: 0 }}>Funguo's platform fee{o.platform_fee ? ` (${money(o.platform_fee, o.currency)})` : ''} is paid by the seller from the captured amount. PayPal Sandbox transaction; no real money moved.</p>
      </article>
    </main>
  );
}
