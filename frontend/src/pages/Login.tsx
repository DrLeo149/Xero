import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth, User } from '../stores/auth';

export default function Login() {
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
      const res = await api.post<{ token: string; user: User }>('/api/auth/login', { email, password });
      setAuth(res.token, res.user);
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

        <form onSubmit={submit} className="card p-8 space-y-5">
          <div>
            <h1 className="font-display text-2xl text-ink-900 tracking-tight">Sign in</h1>
            <p className="text-sm text-ink-400 mt-1">Access your financial dashboard</p>
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
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
