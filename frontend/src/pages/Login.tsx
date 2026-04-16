import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth, User } from '../stores/auth';

export default function Login() {
  const [searchParams] = useSearchParams();
  const xeroError = searchParams.get('xero') === 'error' ? searchParams.get('msg') : null;

  const [showAdmin, setShowAdmin] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const setAuth = useAuth((s) => s.setAuth);
  const nav = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const res = await api.post<{ token: string; refreshToken: string; user: User }>('/api/auth/login', { email, password });
      setAuth(res.token, res.user, res.refreshToken);
      nav('/');
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <div className="font-display text-[40px] leading-none text-ink-900 tracking-tight">
            mynumbers
          </div>
          <div className="smallcaps mt-3">Live Finance</div>
        </div>

        {xeroError && (
          <div className="mb-6 text-sm text-[#7A1616] bg-[#FBEEEE] border border-[#F2C9C9] dark:text-[#FCA5A5] dark:bg-[#2A0E0E] dark:border-[#5A1E1E] rounded-md p-3 text-center">
            Xero connection failed: {xeroError}
          </div>
        )}

        {!showAdmin ? (
          <div className="card p-8 space-y-6">
            <div className="text-center">
              <h1 className="font-display text-2xl text-ink-900 tracking-tight">
                Connect your Xero
              </h1>
              <p className="text-sm text-ink-400 mt-2 leading-relaxed">
                One click. No signup form. We create your dashboard automatically from your Xero data.
              </p>
            </div>

            <a
              href="/api/xero/signup"
              className="w-full flex items-center justify-center gap-3 rounded-md py-3 px-4 text-sm font-semibold transition-colors"
              style={{
                backgroundColor: '#13B5EA',
                color: '#FFFFFF',
              }}
            >
              {/* Xero logo mark */}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M7.3 8.3l4.2 3.7-4.2 3.7M12.5 8.3l4.2 3.7-4.2 3.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Connect with Xero
            </a>

            <div className="text-center">
              <p className="text-[11px] text-ink-400 leading-relaxed">
                We'll pull your invoices, contacts, and reports. Read-only - we never write to your Xero.
              </p>
            </div>

            <div className="border-t hairline pt-4 text-center">
              <button
                onClick={() => setShowAdmin(true)}
                className="text-xs text-ink-400 hover:text-ink-700 transition-colors"
              >
                Admin login
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="card p-8 space-y-5">
            <div>
              <h1 className="font-display text-2xl text-ink-900 tracking-tight">Admin sign in</h1>
              <p className="text-sm text-ink-400 mt-1">For practice administrators only</p>
            </div>

            {err && (
              <div className="text-sm text-[#7A1616] bg-[#FBEEEE] border border-[#F2C9C9] dark:text-[#FCA5A5] dark:bg-[#2A0E0E] dark:border-[#5A1E1E] rounded-md p-3">
                {err}
              </div>
            )}

            <div>
              <label className="smallcaps block mb-2">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border hairline rounded-md px-3 py-2.5 text-sm bg-canvas-raised text-ink-900 focus:outline-none focus:border-accent-600 focus:ring-1 focus:ring-accent-600 transition-colors"
              />
            </div>

            <div>
              <label className="smallcaps block mb-2">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border hairline rounded-md px-3 py-2.5 text-sm bg-canvas-raised text-ink-900 focus:outline-none focus:border-accent-600 focus:ring-1 focus:ring-accent-600 transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-accent-600 hover:bg-accent-700 text-white rounded-md py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>

            <div className="text-center">
              <button
                type="button"
                onClick={() => setShowAdmin(false)}
                className="text-xs text-ink-400 hover:text-ink-700 transition-colors"
              >
                Back to Xero connect
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
