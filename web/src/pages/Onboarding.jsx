import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useLoad, useTitle } from '../lib/hooks.js';
import { useToast } from '../lib/toast.jsx';
import { ErrorNote } from '../components/ui.jsx';
import FlowSteps from '../components/FlowSteps.jsx';

// Seller identity verification: submit the National ID, fix any issue, then the dashboard opens.
export default function Onboarding() {
  useTitle('Verify your identity');
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const { data, error, setData } = useLoad(() => api('/api/seller/kyc'));
  const kyc = data?.kyc;
  const verified = kyc?.status === 'verified';

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api('/api/seller/identity', { form: new FormData(e.target) });
      e.target.reset();
      setData({ kyc: res.kyc });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) { toast(err.message); }
    setBusy(false);
  }

  const slot = (name, label, capture) => (
    <label className="lbl">{label} {kyc?.documents[name] && <span className="ok">on file</span>}
      <input name={name} type="file" accept="image/png,image/jpeg,image/webp" capture={capture} className="field" />
    </label>
  );

  return (
    <main id="main" className="onboard">
      <FlowSteps label="Seller setup" steps={['Account created', 'Verify your identity', 'Open your dashboard']} current={verified ? 2 : 1} />
      <h1 className="page-title">Verify your identity</h1>
      <p className="page-lead">Buyers pay into a hold because they know who they are paying. Before you can request payments, submit your National ID. Buyers never see these documents. Only the audit desk can open them.</p>
      <ErrorNote error={error} />
      {verified && (
        <div className="callout callout-ok stack">
          <b>Identity verified.</b> <span>Your shop is ready. Buyers will see a verified badge on your profile.</span>
          {/* A full page load lets the server re-check the gate before the dashboard opens. */}
          <a className="btn btn-primary" href="/seller">Open your dashboard</a>
        </div>
      )}
      {kyc?.status === 'rejected' && (
        <div className="callout callout-bad"><b>We could not verify you yet.</b> {kyc.note}<br />Fix this below and submit again.</div>
      )}
      {kyc && !verified && (
        <form onSubmit={submit} className="card card-pad stack" style={{ marginTop: 16 }}>
          <label className="lbl">National ID number
            <input name="national_id_number" className="field" autoComplete="off" placeholder="e.g. 12345678" />
            <span className="fine">{kyc.national_id_last4 ? `On file: ending ${kyc.national_id_last4}. Leave blank to keep it.` : 'Only the last 4 digits are kept on your profile.'}</span>
          </label>
          <div className="id-grid">
            {slot('id_front', 'ID card, front', 'environment')}
            {slot('id_back', 'ID card, back', 'environment')}
            {slot('face', 'Photo of your face', 'user')}
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>{busy ? 'Checking…' : 'Submit for verification'}</button>
          <p className="fine" style={{ margin: 0 }}>Checks run as soon as you submit: the number must be valid and not used by another shop, and each photo must be a clear, separate picture.</p>
        </form>
      )}
      <p className="fine" style={{ marginTop: 16 }}>Questions? <Link to="/support">Contact support</Link>.</p>
    </main>
  );
}
