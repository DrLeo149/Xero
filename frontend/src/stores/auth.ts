import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface User {
  id: string;
  email: string;
  name: string | null;
  role: 'admin' | 'client';
  tenantId: string | null;
}

/** Returns the best human-readable label for a user - their name if set, otherwise email. */
export function displayName(u: User | null | undefined): string {
  if (!u) return '';
  return u.name?.trim() || u.email;
}

interface AuthState {
  token: string | null;
  refreshToken: string | null;
  user: User | null;
  adminActiveTenantId: string | null;
  setAuth: (token: string, user: User, refreshToken?: string) => void;
  setTokens: (token: string, refreshToken: string) => void;
  logout: () => void;
  setAdminTenant: (tenantId: string | null) => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      refreshToken: null,
      user: null,
      adminActiveTenantId: null,
      setAuth: (token, user, refreshToken) => set({ token, user, ...(refreshToken ? { refreshToken } : {}) }),
      setTokens: (token, refreshToken) => set({ token, refreshToken }),
      logout: () => set({ token: null, refreshToken: null, user: null, adminActiveTenantId: null }),
      setAdminTenant: (tenantId) => set({ adminActiveTenantId: tenantId }),
    }),
    { name: 'xdash-auth' },
  ),
);
