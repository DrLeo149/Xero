import { useAuth } from '../stores/auth';

/**
 * Lightweight frontend telemetry: batches events and flushes to the backend
 * every 10s or on tab close via navigator.sendBeacon (reliable on unload).
 * Emits a `page_active` heartbeat every 15s while the tab is focused -
 * backend multiplies these by 15 to compute total active view time per user.
 */

interface Event {
  eventType: string;
  meta?: Record<string, any>;
  occurredAt: string;
}

const queue: Event[] = [];
const MAX_BATCH = 50;

export function track(eventType: string, meta?: Record<string, any>) {
  queue.push({ eventType, meta, occurredAt: new Date().toISOString() });
  if (queue.length >= MAX_BATCH) flush();
}

function flush() {
  const { token } = useAuth.getState();
  if (!token || queue.length === 0) return;
  const batch = queue.splice(0, queue.length);
  const body = JSON.stringify({ events: batch });

  // fetch with keepalive survives tab close without needing sendBeacon (which can't set Authorization header)
  fetch('/api/telemetry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body,
    keepalive: true,
  }).catch(() => {
    // On failure, re-queue (capped)
    if (queue.length < 200) queue.unshift(...batch);
  });
}

let heartbeatTimer: number | null = null;
let flushTimer: number | null = null;

export function startTelemetry() {
  if (typeof window === 'undefined') return;

  // Heartbeat: every 15s while tab is visible
  heartbeatTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') {
      track('page_active', { path: window.location.pathname });
    }
  }, 15_000);

  // Batched flush: every 10s
  flushTimer = window.setInterval(flush, 10_000);

  // Flush on unload
  window.addEventListener('beforeunload', () => {
    track('session_end');
    flush();
  });

  // Session start marker
  track('session_start', { path: window.location.pathname, ua: navigator.userAgent });
}

export function stopTelemetry() {
  if (heartbeatTimer) window.clearInterval(heartbeatTimer);
  if (flushTimer) window.clearInterval(flushTimer);
  flush();
}
