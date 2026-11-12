import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { api, formData } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import { useToast } from '../lib/toast.jsx';
import { useTitle } from '../lib/hooks.js';
import { dashPath, safeNext } from '../lib/format.js';
import { Brand } from '../components/ui.jsx';

function useNext() {
  const [params] = useSearchParams();
  return safeNext(params.get('next') || '');
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
    </svg>
  );
}

function continueWithGmail({ intent, next, form, toast }) {
  const q = new URLSearchParams({ intent });
  if (next) q.set('next', next);
  if (intent === 'signup') {
    const country = form.country.value;
    const role = form.role.value;
    if (!country) {
      toast('Choose your country');
      return;
    }
    q.set('country', country);
    q.set('role', role);
  }
  window.location.assign(`/api/auth/google/start?${q}`);
}

function AuthFrame({ eyebrow, script, children }) {
  return (
    <main className="auth-shell" id="main">
      <aside className="auth-hero">
        <div className="auth-hero-copy">
          <span className="auth-hero-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="22" height="22">
              <circle cx="11.5" cy="16" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path d="M15.5 16h11M22.2 16v3.2M26.5 16v2.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </span>
          <p className="auth-hero-eyebrow">{eyebrow}</p>
          <p className="auth-hero-script">{script}</p>
        </div>
      </aside>
      <div className="auth-panel">
        <div className="auth-form">
          <div className="auth-brand"><Brand to="/" /></div>
          {children}
        </div>
      </div>
    </main>
  );
}

// After signing in, refresh the session and go where the server says.
function useFinish() {
  const { refresh } = useSession();
  const navigate = useNavigate();
  return async (res) => {
    await refresh();
    navigate(res.next || '/', { replace: true });
  };
}

export function Login() {
  const { user } = useSession();
  const toast = useToast();
  const next = useNext();
  const finish = useFinish();
  const [busy, setBusy] = useState(false);
  const [params] = useSearchParams();
  const error = params.get('error');
  useTitle('Sign in');
  if (user) return <Navigate to={next || dashPath(user.role)} replace />;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = formData(e.target);
      if (next) body.next = next;
      await finish(await api('/api/auth/login', { json: body }));
    } catch (err) {
      toast(err.message);
      setBusy(false);
    }
  }

  return (
    <AuthFrame eyebrow="Money that stays locked until" script="Release">
      <form onSubmit={submit} className="stack">
        <h1>Sign in</h1>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button
          className="btn btn-gmail btn-block"
          type="button"
          onClick={(e) => continueWithGmail({ intent: 'login', next, form: e.currentTarget.form, toast })}
        >
          <GoogleMark /> Continue with Gmail
        </button>
        <p className="auth-or">or</p>
        <label className="lbl">Email
          <input name="email" type="email" required autoComplete="username" className="field" placeholder="Email" />
        </label>
        <label className="lbl">Password
          <input name="password" type="password" required autoComplete="current-password" className="field" placeholder="Password" />
        </label>
        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>Sign in</button>
        <p className="auth-switch">No account yet? <Link to={next ? `/signup?next=${encodeURIComponent(next)}` : '/signup'}>Create one</Link></p>
        <p className="fine auth-demo">Demo audit: admin@funguo.test / funguo-demo</p>
      </form>
    </AuthFrame>
  );
}

export function Signup() {
  const { user } = useSession();
  const toast = useToast();
  const next = useNext();
  const finish = useFinish();
  const [params] = useSearchParams();
  const [countries, setCountries] = useState([]);
  const [busy, setBusy] = useState(false);
  const role = params.get('role') === 'buyer' ? 'buyer' : 'seller';
  const error = params.get('error');
  const country = params.get('country') || '';
  useTitle('Create an account');

  useEffect(() => {
    api('/api/countries').then(setCountries).catch((err) => toast(err.message));
  }, [toast]);

  if (user) return <Navigate to={next || dashPath(user.role)} replace />;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = formData(e.target);
      if (next) body.next = next;
      await finish(await api('/api/auth/signup', { json: body }));
    } catch (err) {
      toast(err.message);
      setBusy(false);
    }
  }

  return (
    <AuthFrame eyebrow="One link from a shop to a" script="Hold">
      <form onSubmit={submit} className="stack">
        <h1>Create an account</h1>
        <label className="lbl">I am
          <select name="role" defaultValue={role} className="field">
            <option value="seller">Selling — I want to be paid</option>
            <option value="buyer">Buying — I was sent a link</option>
          </select>
        </label>
        <label className="lbl">Country
          <select name="country" required className="field" key={`${country}:${countries.length}`} defaultValue={country}>
            <option value="" disabled>Choose your country</option>
            {countries.map((c) => <option key={c.code} value={c.code}>{c.name} — {c.label}</option>)}
          </select>
        </label>
        <p className="fine">Prices on your account use this country's currency. Kenya is KSh.</p>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button
          className="btn btn-gmail btn-block"
          type="button"
          onClick={(e) => continueWithGmail({ intent: 'signup', next, form: e.currentTarget.form, toast })}
        >
          <GoogleMark /> Continue with Gmail
        </button>
        <p className="fine">Uses a @gmail.com address. Google confirms it, so there is no password to set.</p>
        <p className="auth-or">or</p>
        <label className="lbl">Name
          <input name="name" required autoComplete="name" className="field" placeholder="Full name" />
        </label>
        <label className="lbl">Email
          <input name="email" type="email" required autoComplete="username" className="field" placeholder="Email" />
        </label>
        <label className="lbl">Password
          <input name="password" type="password" required minLength={8} autoComplete="new-password" className="field" placeholder="Password" />
        </label>
        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>Create account</button>
        <p className="auth-switch">Already registered? <Link to={next ? `/login?next=${encodeURIComponent(next)}` : '/login'}>Sign in</Link></p>
      </form>
    </AuthFrame>
  );
}
