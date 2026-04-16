import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { track } from '../lib/telemetry';

/**
 * Shared manual-refresh button. Posts to /api/xero/sync, invalidates every
 * query key that reads from the local cache so the UI re-renders with fresh
 * data, and shows a spinner while the sync is running.
 *
 * Surfaced in PageHeader so every data tab gets it automatically - no more
 * "only Pulse has a refresh button" asymmetry.
 */
export default function RefreshButton() {
  const qc = useQueryClient();

  const sync = useMutation({
    mutationFn: () =>
      api.post<{ status: string; errorMsg?: string | null; itemsSynced?: number }>('/api/xero/sync'),
    onSuccess: () => {
      // Invalidate every dashboard query so the active tab re-fetches and
      // all sibling tabs re-fetch the next time they become active.
      qc.invalidateQueries({ queryKey: ['pulse'] });
      qc.invalidateQueries({ queryKey: ['profit'] });
      qc.invalidateQueries({ queryKey: ['cashflow'] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['xero-status'] });
    },
  });

  return (
    <button
      onClick={() => { track('manual_refresh_clicked'); sync.mutate(); }}
      disabled={sync.isPending}
      title="Pull the latest data from Xero"
      className="border hairline rounded-md bg-canvas-raised text-ink-900 hover:border-ink-300 hover:bg-canvas-sunken px-3 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-70 inline-flex items-center gap-1.5"
    >
      {sync.isPending ? (
        <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
          <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        </svg>
      ) : (
        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
          <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M3 21v-5h5" />
        </svg>
      )}
      {sync.isPending ? 'Syncing…' : 'Refresh'}
    </button>
  );
}
