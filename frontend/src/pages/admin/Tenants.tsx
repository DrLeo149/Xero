import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useState } from 'react';
import { useAuth } from '../../stores/auth';

interface Tenant {
  id: string;
  companyName: string;
  createdAt: string;
  refreshCron: string | null;
  lastSyncedAt: string | null;
  xeroConnection: { orgName: string; connectedAt: string } | null;
  _count: { users: number; invoices: number };
}

export default function AdminTenants() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ companyName: '', clientEmail: '', clientPassword: '' });
  const [err, setErr] = useState<string | null>(null);
  const setAdminTenant = useAuth((s) => s.setAdminTenant);
  const activeTenantId = useAuth((s) => s.adminActiveTenantId);

  const tenants = useQuery<Tenant[]>({
    queryKey: ['tenants'],
    queryFn: () => api.get('/api/tenants'),
  });

  const createTenant = useMutation({
    mutationFn: (body: typeof form) => api.post('/api/tenants', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenants'] });
      setShowCreate(false);
      setForm({ companyName: '', clientEmail: '', clientPassword: '' });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const deleteTenant = useMutation({
    mutationFn: (id: string) => api.delete(`/api/tenants/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenants'] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Tenants</h1>
        <button onClick={() => setShowCreate(true)} className="bg-brand-600 hover:bg-brand-700 text-white rounded px-4 py-2 text-sm">
          + New tenant
        </button>
      </div>

      {err && <div className="text-sm text-red-600 bg-red-50 rounded p-2">{err}</div>}

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="text-left p-3">Company</th>
              <th className="text-left p-3">Xero</th>
              <th className="text-left p-3">Users</th>
              <th className="text-left p-3">Invoices</th>
              <th className="text-left p-3">Last sync</th>
              <th className="text-left p-3">Auto-refresh</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {tenants.data?.map((t) => (
              <tr key={t.id} className="border-t border-slate-100">
                <td className="p-3 font-medium">{t.companyName}</td>
                <td className="p-3 text-slate-600">{t.xeroConnection?.orgName ?? '- not connected -'}</td>
                <td className="p-3">{t._count.users}</td>
                <td className="p-3">{t._count.invoices}</td>
                <td className="p-3 text-slate-500">
                  {t.lastSyncedAt ? new Date(t.lastSyncedAt).toLocaleString() : '-'}
                </td>
                <td className="p-3 text-slate-500">{t.refreshCron ?? 'manual'}</td>
                <td className="p-3 text-right">
                  <button
                    onClick={() => setAdminTenant(t.id)}
                    className={`text-xs mr-2 ${activeTenantId === t.id ? 'text-emerald-600 font-semibold' : 'text-brand-600'}`}
                  >
                    {activeTenantId === t.id ? 'Active ✓' : 'View'}
                  </button>
                  <button
                    onClick={() => { if (confirm(`Delete ${t.companyName}? All its data will be removed.`)) deleteTenant.mutate(t.id); }}
                    className="text-xs text-red-600"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {tenants.data?.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-slate-500">No tenants yet. Create one to onboard a client.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg p-6 w-full max-w-md space-y-4">
            <h2 className="font-semibold">New tenant</h2>
            <input
              placeholder="Company name"
              value={form.companyName}
              onChange={(e) => setForm({ ...form, companyName: e.target.value })}
              className="w-full border rounded px-3 py-2 text-sm"
            />
            <input
              placeholder="Client user email"
              type="email"
              value={form.clientEmail}
              onChange={(e) => setForm({ ...form, clientEmail: e.target.value })}
              className="w-full border rounded px-3 py-2 text-sm"
            />
            <input
              placeholder="Initial password (≥6 chars)"
              type="password"
              value={form.clientPassword}
              onChange={(e) => setForm({ ...form, clientPassword: e.target.value })}
              className="w-full border rounded px-3 py-2 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCreate(false)} className="text-sm text-slate-500">Cancel</button>
              <button
                onClick={() => createTenant.mutate(form)}
                disabled={createTenant.isPending}
                className="bg-brand-600 hover:bg-brand-700 text-white rounded px-4 py-2 text-sm"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
