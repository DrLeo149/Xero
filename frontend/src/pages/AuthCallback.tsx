import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, User } from '../stores/auth';
import { api } from '../lib/api';

/**
 * /auth/callback
 *
 * Xero OAuth redirects here with #token=<jwt> in the fragment.
 * We store the token, fetch the user profile, and redirect to the dashboard.
 * The token is in the fragment (not query string) so it never hits the server logs.
 */
export default function AuthCallback() {
  const setAuth = useAuth((s) => s.setAuth);
  const nav = useNavigate();

  useEffect(() => {
    const hash = window.location.hash;
    const token = new URLSearchParams(hash.replace('#', '?')).get('token');

    if (!token) {
      nav('/login', { replace: true });
      return;
    }

    // Temporarily set the token so api.get can use it
    useAuth.setState({ token });

    api.get<User>('/api/auth/me')
      .then((user) => {
        setAuth(token, user);
        nav('/', { replace: true });
      })
      .catch(() => {
        useAuth.getState().logout();
        nav('/login?xero=error&msg=session_failed', { replace: true });
      });
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas">
      <div className="text-center">
        <div className="font-display text-[24px] text-ink-900 tracking-tight mb-3">
          Setting up your dashboard...
        </div>
        <div className="text-sm text-ink-400">This takes a few seconds</div>
        <div className="mt-6 flex justify-center">
          <svg className="animate-spin h-6 w-6 text-accent-600" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.2" strokeWidth="4" />
            <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          </svg>
        </div>
      </div>
    </div>
  );
}
