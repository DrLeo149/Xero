import { useAuth } from '../stores/auth';

/**
 * Auto-refresh logic: when a request gets 401, we try once to exchange the
 * refresh token for a new access token. If that works, replay the original
 * request. If the refresh also fails, log out.
 */
let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  const { refreshToken } = useAuth.getState();
  if (!refreshToken) return false;

  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!res.ok) return false;

    const data = await res.json();
    useAuth.getState().setTokens(data.token, data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

async function request<T>(path: string, opts: RequestInit = {}, isRetry = false): Promise<T> {
  const { token, user, adminActiveTenantId } = useAuth.getState();
  const headers = new Headers(opts.headers);
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (user?.role === 'admin' && adminActiveTenantId) {
    headers.set('X-Tenant-Id', adminActiveTenantId);
  }

  const res = await fetch(path, { ...opts, headers });

  if (res.status === 401 && !isRetry) {
    // Token expired - try refresh (deduplicate concurrent refreshes)
    if (!refreshPromise) {
      refreshPromise = tryRefresh().finally(() => { refreshPromise = null; });
    }
    const refreshed = await refreshPromise;
    if (refreshed) {
      return request<T>(path, opts, true); // retry with new token
    }
    useAuth.getState().logout();
    throw new Error('Session expired');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: any) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: any) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
