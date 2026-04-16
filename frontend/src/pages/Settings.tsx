import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth, User } from '../stores/auth';
import { usePrefs, COMMON_TIMEZONES, TzPref } from '../stores/prefs';
import { useState, useEffect } from 'react';
import PageHeader, { useTzFormatter } from '../components/PageHeader';

interface XeroStatus {
  connected: boolean;
  orgName: string | null;
  connectedAt: string | null;
  lastSyncedAt: string | null;
  refreshCron: string | null;
}

const cronPresets = [
  { label: 'Manual only', value: '' },
  { label: 'Every 5 minutes', value: '*/5 * * * *' },
  { label: 'Every 15 minutes', value: '*/15 * * * *' },
  { label: 'Every hour', value: '7 * * * *' },
  { label: 'Every 6 hours', value: '15 */6 * * *' },
  { label: 'Daily at 6am', value: '0 6 * * *' },
  { label: 'Every weekday at 9am', value: '0 9 * * 1-5' },
];

export default function Settings() {
  const user = useAuth((s) => s.user);
  const adminActiveTenantId = useAuth((s) => s.adminActiveTenantId);
  const token = useAuth((s) => s.token);
  const setAuth = useAuth((s) => s.setAuth);
  const effectiveTenantId = user?.role === 'admin' ? adminActiveTenantId : user?.tenantId;
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const tz = usePrefs((s) => s.tz);
  const setTz = usePrefs((s) => s.setTz);
  const fmtTime = useTzFormatter();

  const status = useQuery<XeroStatus>({
    queryKey: ['xero-status'],
    queryFn: () => api.get('/api/xero/status'),
  });

  // Draft state - nothing is committed until "Save settings" is clicked.
  // Initial values reflect the currently-saved state; `dirty` computes what
  // actually needs a server or local write so we don't hammer endpoints.
  const [draftName, setDraftName] = useState<string>(user?.name ?? '');
  const [draftTz, setDraftTz] = useState<TzPref>(tz);
  const [draftCron, setDraftCron] = useState<string>('');

  // Sync drafts with source-of-truth when that source changes (login,
  // tenant switch, xero-status arriving). Guarded by saved-value equality
  // so typing isn't clobbered.
  useEffect(() => { setDraftName(user?.name ?? ''); }, [user?.name]);
  useEffect(() => { setDraftTz(tz); }, [tz]);
  useEffect(() => {
    setDraftCron(status.data?.refreshCron ?? '');
  }, [status.data?.refreshCron]);

  const nameDirty = draftName !== (user?.name ?? '');
  const tzDirty = draftTz !== tz;
  const cronDirty = draftCron !== (status.data?.refreshCron ?? '');
  const dirty = nameDirty || tzDirty || cronDirty;

  const saveAll = useMutation({
    mutationFn: async () => {
      // Run writes in order so we can attribute errors correctly.
      if (nameDirty) {
        const updated = await api.patch<User>('/api/auth/me', {
          name: draftName.trim() || null,
        });
        if (token) setAuth(token, updated);
      }
      if (tzDirty) {
        setTz(draftTz);
      }
      if (cronDirty) {
        if (!effectiveTenantId) throw new Error('Pick a tenant before saving the schedule');
        await api.patch(`/api/tenants/${effectiveTenantId}/refresh-cron`, {
          refreshCron: draftCron || null,
        });
        await qc.invalidateQueries({ queryKey: ['xero-status'] });
      }
    },
    onSuccess: () => {
      setErr(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
    onError: (e: Error) => setErr(e.message),
  });

  const disconnect = useMutation({
    mutationFn: () => api.delete('/api/xero/disconnect'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['xero-status'] }),
    onError: (e: Error) => setErr(e.message),
  });

  const isAdmin = user?.role === 'admin';
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <div className="space-y-8">
      <PageHeader tag="Settings" title="Preferences & connections" />

      {err && (
        <div className="card p-3 text-sm border-[#F2C9C9] bg-[#FBEEEE] text-[#7A1616] dark:border-[#5A1E1E] dark:bg-[#2A0E0E] dark:text-[#FCA5A5]">
          {err}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Display name */}
        <section className="card p-5">
          <div className="smallcaps mb-1">Profile</div>
          <h2 className="font-display text-[16px] text-ink-900 tracking-tight leading-none">Display name</h2>
          <div className="mt-3">
            <input
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder={user?.email ?? 'Your name'}
              maxLength={80}
              className="w-full border hairline rounded-md px-3 py-2 text-sm bg-canvas-raised text-ink-900 focus:outline-none focus:border-accent-600 focus:ring-1 focus:ring-accent-600 transition-colors"
            />
          </div>
          <div className="mt-2 text-[11px] text-ink-400 truncate">
            Signed in as <span className="text-ink-700">{user?.email}</span>
          </div>
        </section>

        {/* Timezone */}
        <section className="card p-5">
          <div className="smallcaps mb-1">Display</div>
          <h2 className="font-display text-[16px] text-ink-900 tracking-tight leading-none">Timezone</h2>
          <div className="mt-3">
            <select
              value={draftTz}
              onChange={(e) => setDraftTz(e.target.value as TzPref)}
              className="w-full border hairline rounded-md px-3 py-2 text-sm bg-canvas-raised text-ink-900 focus:outline-none focus:border-accent-600 focus:ring-1 focus:ring-accent-600 transition-colors"
            >
              {COMMON_TIMEZONES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.value === 'auto' ? `${t.label} - ${browserTz}` : t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-2 text-[11px] text-ink-500">
            Now: <span className="num text-ink-900">{fmtTime(new Date())}</span>
          </div>
        </section>

        {/* Auto-refresh */}
        <section className="card p-5">
          <div className="smallcaps mb-1">Schedule</div>
          <h2 className="font-display text-[16px] text-ink-900 tracking-tight leading-none">Auto-refresh</h2>
          {effectiveTenantId ? (
            <>
              <div className="mt-3">
                <select
                  value={draftCron}
                  onChange={(e) => setDraftCron(e.target.value)}
                  className="w-full border hairline rounded-md px-3 py-2 text-sm bg-canvas-raised text-ink-900 focus:outline-none focus:border-accent-600 focus:ring-1 focus:ring-accent-600 transition-colors"
                >
                  {cronPresets.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-2 text-[11px] text-ink-400">
                How often to repull from Xero automatically.
              </div>
            </>
          ) : (
            <p className="mt-3 text-xs text-ink-400">Pick a tenant from the switcher to set a schedule.</p>
          )}
        </section>

        {/* Xero connection */}
        <section className="card p-5">
          <div className="smallcaps mb-1">Integration</div>
          <h2 className="font-display text-[16px] text-ink-900 tracking-tight leading-none">Xero connection</h2>
          {status.data?.connected ? (
            <div className="mt-3 space-y-1 text-sm">
              <div className="text-ink-900 truncate">
                <strong>{status.data.orgName}</strong>
              </div>
              <div className="text-ink-400 text-[11px]">
                Last synced {fmtTime(status.data.lastSyncedAt)}
              </div>
              {isAdmin && (
                <button
                  onClick={() => disconnect.mutate()}
                  disabled={disconnect.isPending}
                  className="mt-3 inline-flex items-center rounded-md px-3 py-1.5 text-[11px] font-medium text-white bg-[#B91C1C] hover:bg-[#991B1B] border border-[#991B1B] transition-colors disabled:opacity-60"
                >
                  {disconnect.isPending ? 'Disconnecting...' : 'Disconnect Xero'}
                </button>
              )}
            </div>
          ) : (
            <p className="mt-3 text-xs text-ink-500">Not connected. Go to Pulse → Connect Xero.</p>
          )}
        </section>
      </div>

      {/* Save bar */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => saveAll.mutate()}
          disabled={!dirty || saveAll.isPending}
          className="rounded-md px-4 py-2 text-xs font-medium text-white bg-[#166534] hover:bg-[#115029] border border-[#0D3E20] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saveAll.isPending ? 'Saving…' : saved ? 'Saved ✓' : 'Save settings'}
        </button>
        {dirty && !saveAll.isPending && (
          <span className="text-xs text-ink-400">You have unsaved changes.</span>
        )}
      </div>
    </div>
  );
}
