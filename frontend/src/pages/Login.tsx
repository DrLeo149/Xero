import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth, User } from '../stores/auth';

export default function Login() {
  const [searchParams] = useSearchParams();
  const xeroError = searchParams.get('xero') === 'error' ? searchParams.get('msg') : null;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
    <div className="min-h-screen flex items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="text-center mb-8">
          <div className="font-display text-[36px] leading-none text-ink-900 tracking-tight">
            mynumbers
          </div>
          <div className="smallcaps mt-2">Live Finance</div>
        </div>

        <div className="card p-8">
          <div className="text-center mb-6">
            <h1 className="font-display text-[22px] text-ink-900 tracking-tight leading-none">
              Sign in to your account
            </h1>
            <p className="text-[13px] text-ink-400 mt-2 leading-relaxed">
              Welcome back - sign in to continue where you left off.
            </p>
          </div>

          {xeroError && (
            <div className="mb-4 text-sm text-[#7A1616] bg-[#FBEEEE] border border-[#F2C9C9] dark:text-[#FCA5A5] dark:bg-[#2A0E0E] dark:border-[#5A1E1E] rounded-md p-3">
              Xero connection failed: {xeroError}
            </div>
          )}

          {err && (
            <div className="mb-4 text-sm text-[#7A1616] bg-[#FBEEEE] border border-[#F2C9C9] dark:text-[#FCA5A5] dark:bg-[#2A0E0E] dark:border-[#5A1E1E] rounded-md p-3">
              {err}
            </div>
          )}

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-[12px] font-medium text-ink-700 mb-1.5">
                Email <span className="text-[#B91C1C]">*</span>
              </label>
              <input
                type="email"
                required
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border hairline rounded-md px-3 py-2.5 text-sm bg-canvas-raised text-ink-900 placeholder:text-ink-300 focus:outline-none focus:border-accent-600 focus:ring-1 focus:ring-accent-600 transition-colors"
              />
            </div>

            <div>
              <label className="block text-[12px] font-medium text-ink-700 mb-1.5">
                Password <span className="text-[#B91C1C]">*</span>
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full border hairline rounded-md px-3 py-2.5 pr-10 text-sm bg-canvas-raised text-ink-900 placeholder:text-ink-300 focus:outline-none focus:border-accent-600 focus:ring-1 focus:ring-accent-600 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  tabIndex={-1}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-ink-400 hover:text-ink-700 transition-colors"
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <div className="text-[12px]">
              <span className="text-ink-500">Forgot Password? </span>
              <a href="mailto:adarsh@ankyadvisors.com?subject=Password%20reset" className="text-accent-600 font-semibold hover:underline">
                Reset Now
              </a>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-accent-600 hover:bg-accent-700 text-white rounded-md py-3 text-sm font-semibold transition-colors disabled:opacity-50"
            >
              {loading ? 'Signing in...' : 'Login'}
            </button>

            <p className="text-[11px] text-ink-400 text-center leading-relaxed">
              By continuing, you agree to our{' '}
              <a href="#" className="text-accent-600 font-semibold hover:underline">Terms of Service</a>{' '}
              and{' '}
              <a href="#" className="text-accent-600 font-semibold hover:underline">Privacy Policy</a>
            </p>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 border-t hairline" />
            <span className="text-[11px] uppercase tracking-wider text-ink-400">Or</span>
            <div className="flex-1 border-t hairline" />
          </div>

          {/* Xero connect - the headline self-serve path */}
          <a
            href="/api/xero/signup"
            className="w-full flex items-center justify-center gap-2.5 rounded-md py-2.5 px-4 text-sm font-semibold transition-opacity hover:opacity-90 border"
            style={{
              backgroundColor: '#FFFFFF',
              borderColor: '#13B5EA',
              color: '#13B5EA',
            }}
          >
            <span
              className="inline-flex items-center justify-center rounded-full text-white font-bold text-[10px]"
              style={{ backgroundColor: '#13B5EA', width: 18, height: 18 }}
            >
              X
            </span>
            Sign in with Xero
          </a>

          <p className="text-[11px] text-ink-400 text-center mt-3 leading-relaxed">
            New here? Connect Xero and we'll set up your dashboard automatically.
          </p>
        </div>
      </div>
    </div>
  );
}
