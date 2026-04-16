import { useAuth } from '../stores/auth';

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const { token, user, adminActiveTenantId } = useAuth.getState();
  const headers = new Headers(opts.headers);
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  // Admin: if a tenant is actively selected, forward it so backend scopes correctly
  if (user?.role === 'admin' && adminActiveTenantId) {
    headers.set('X-Tenant-Id', adminActiveTenantId);
  }

  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401) {
    useAuth.getState().logout();
    throw new Error('Unauthorized');
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
