import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const telemetryRouter = Router();

const eventSchema = z.object({
  eventType: z.string().min(1).max(64),
  meta: z.record(z.any()).optional(),
  occurredAt: z.string().optional(),
});
const batchSchema = z.object({ events: z.array(eventSchema).max(100) });

/**
 * POST /api/telemetry - ingest a batch of events from the frontend.
 * Frontend batches + flushes every 10s via navigator.sendBeacon.
 */
telemetryRouter.post('/', requireAuth, async (req, res) => {
  const parsed = batchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid batch' });

  const userId = req.user!.sub;
  const tenantId = req.user!.tenantId; // null for admins
  const rows = parsed.data.events.map((e) => ({
    userId,
    tenantId: tenantId ?? null,
    eventType: e.eventType,
    meta: e.meta ? JSON.stringify(e.meta) : null,
    occurredAt: e.occurredAt ? new Date(e.occurredAt) : new Date(),
  }));
  await prisma.usageEvent.createMany({ data: rows });
  res.json({ accepted: rows.length });
});

// --- Admin analytics (read-only) ----------------------------------------------
const analyticsRouter = Router();
analyticsRouter.use(requireAuth, requireRole('admin'));

/**
 * Overview: per-tenant usage aggregates. Uses the `page_active` heartbeat
 * (emitted every 15s while tab is focused) as the source of active view time.
 * Each heartbeat = 15 seconds of active time.
 */
analyticsRouter.get('/overview', async (req, res) => {
  const days = Math.min(parseInt(String(req.query.days ?? '7'), 10), 90);
  const since = new Date(Date.now() - days * 86_400_000);

  const tenants = await prisma.tenant.findMany({ select: { id: true, companyName: true } });
  const result = [];
  for (const t of tenants) {
    const [heartbeatCount, sessionCount, lastEvent, uniqueDays] = await Promise.all([
      prisma.usageEvent.count({
        where: { tenantId: t.id, eventType: 'page_active', occurredAt: { gte: since } },
      }),
      prisma.usageEvent.count({
        where: { tenantId: t.id, eventType: 'session_start', occurredAt: { gte: since } },
      }),
      prisma.usageEvent.findFirst({
        where: { tenantId: t.id },
        orderBy: { occurredAt: 'desc' },
        select: { occurredAt: true, userId: true },
      }),
      prisma.usageEvent.findMany({
        where: { tenantId: t.id, occurredAt: { gte: since } },
        select: { occurredAt: true },
        distinct: ['occurredAt'],
      }),
    ]);
    const activeDays = new Set(uniqueDays.map((e) => e.occurredAt.toISOString().slice(0, 10))).size;
    result.push({
      tenantId: t.id,
      companyName: t.companyName,
      activeViewSeconds: heartbeatCount * 15,
      sessionCount,
      activeDays,
      lastSeenAt: lastEvent?.occurredAt ?? null,
      lastSeenUserId: lastEvent?.userId ?? null,
    });
  }
  res.json({ days, tenants: result });
});

/** Per-widget view counts across all tenants (or a specific one). */
analyticsRouter.get('/widgets', async (req, res) => {
  const tenantId = req.query.tenantId as string | undefined;
  const since = new Date(Date.now() - 30 * 86_400_000);
  const events = await prisma.usageEvent.findMany({
    where: {
      ...(tenantId ? { tenantId } : {}),
      eventType: 'widget_view',
      occurredAt: { gte: since },
    },
    select: { meta: true },
  });
  const counts = new Map<string, number>();
  for (const e of events) {
    try {
      const m = e.meta ? JSON.parse(e.meta) : {};
      const w = m.widget ?? 'unknown';
      counts.set(w, (counts.get(w) ?? 0) + 1);
    } catch {
      /* ignore */
    }
  }
  res.json(
    Array.from(counts, ([widget, count]) => ({ widget, count })).sort((a, b) => b.count - a.count),
  );
});

/**
 * Insights: the actionable view of usage.
 *
 * Returns three things in one call:
 *
 *   1. `frictionSignals` - detected UX problems (rapid refresh loops, bounces,
 *      dead dwell). These are the "someone is stuck" signals worth acting on.
 *
 *   2. `tabDwell` - total active time per tab across all tenants, derived from
 *      `page_active` heartbeats. Shows which tabs people actually live in.
 *
 *   3. `tenantEngagement` - per-tenant active time / session count / last seen,
 *      same shape the old /overview returned so the tenant table keeps working.
 *
 * Window defaults to 7 days, capped at 90.
 */
analyticsRouter.get('/insights', async (req, res) => {
  const days = Math.min(parseInt(String(req.query.days ?? '7'), 10), 90);
  const since = new Date(Date.now() - days * 86_400_000);

  // Pull every event in the window once. For a demo-scale app this is fine;
  // if it grows we push aggregation into SQL.
  const events = await prisma.usageEvent.findMany({
    where: { occurredAt: { gte: since } },
    select: {
      userId: true,
      tenantId: true,
      eventType: true,
      meta: true,
      occurredAt: true,
    },
    orderBy: [{ userId: 'asc' }, { occurredAt: 'asc' }],
  });

  // Lookup tables so we can hand the frontend human-readable names, not UUIDs.
  const [users, tenants] = await Promise.all([
    prisma.user.findMany({ select: { id: true, email: true, name: true, tenantId: true } }),
    prisma.tenant.findMany({ select: { id: true, companyName: true } }),
  ]);
  const userMap = new Map(users.map((u) => [u.id, u]));
  const tenantMap = new Map(tenants.map((t) => [t.id, t.companyName]));

  const parsePath = (metaJson: string | null): string | null => {
    if (!metaJson) return null;
    try {
      const m = JSON.parse(metaJson);
      return typeof m.path === 'string' ? m.path : null;
    } catch {
      return null;
    }
  };
  const pathToTab = (path: string | null): string => {
    if (!path) return 'Unknown';
    if (path === '/' || path.startsWith('/pulse')) return 'Pulse';
    if (path.startsWith('/profit')) return 'Profit';
    if (path.startsWith('/cash')) return 'Cash Flow';
    if (path.startsWith('/customers')) return 'Customers';
    if (path.startsWith('/settings')) return 'Settings';
    if (path.startsWith('/admin/analytics')) return 'Admin: Analytics';
    if (path.startsWith('/admin/tenants')) return 'Admin: Tenants';
    if (path.startsWith('/admin')) return 'Admin';
    return path;
  };

  // ---- Tab dwell -----------------------------------------------------------
  // Each page_active heartbeat represents ~15s of active time on that path.
  const tabSeconds = new Map<string, number>();
  const tabUsers = new Map<string, Set<string>>();
  for (const e of events) {
    if (e.eventType !== 'page_active') continue;
    const tab = pathToTab(parsePath(e.meta));
    tabSeconds.set(tab, (tabSeconds.get(tab) ?? 0) + 15);
    if (!tabUsers.has(tab)) tabUsers.set(tab, new Set());
    tabUsers.get(tab)!.add(e.userId);
  }
  const totalSeconds = Array.from(tabSeconds.values()).reduce((a, b) => a + b, 0);
  const tabDwell = Array.from(tabSeconds, ([tab, seconds]) => ({
    tab,
    seconds,
    uniquePct: totalSeconds === 0 ? 0 : (seconds / totalSeconds) * 100,
    uniqueUsers: tabUsers.get(tab)!.size,
  })).sort((a, b) => b.seconds - a.seconds);

  // ---- Friction signal detection ------------------------------------------
  //
  // Three heuristics, tuned for "obvious something is wrong":
  //
  //   - Rapid refresh: same user hits Refresh 3+ times within 2 minutes.
  //     Means they don't trust the numbers and are trying to force an update.
  //
  //   - Bounce: user enters a session, stays under 15s, never interacts.
  //     Means they opened the app, saw nothing useful, and left.
  //
  //   - Dead dwell: 5+ minutes of page_active on the SAME path with zero
  //     interaction events in that run. Means they're staring at a page,
  //     probably confused about what it's showing.
  type Signal = {
    type: 'rapid_refresh' | 'bounce' | 'dead_dwell';
    userId: string;
    userLabel: string;
    tenantName: string | null;
    at: string;
    detail: string;
    // Rank used for sorting - higher = more urgent.
    severity: number;
  };
  const signals: Signal[] = [];

  // Group events by user so we can reason about sequences.
  const byUser = new Map<string, typeof events>();
  for (const e of events) {
    const arr = byUser.get(e.userId) ?? [];
    arr.push(e);
    byUser.set(e.userId, arr);
  }

  const makeLabel = (userId: string): { label: string; tenantName: string | null } => {
    const u = userMap.get(userId);
    if (!u) return { label: 'Unknown user', tenantName: null };
    return {
      label: (u.name?.trim() || u.email),
      tenantName: u.tenantId ? (tenantMap.get(u.tenantId) ?? null) : null,
    };
  };

  const INTERACTION_EVENTS = new Set([
    'widget_interaction',
    'manual_refresh_clicked',
    'filter_changed',
    'export_clicked',
    'suggestion_dismissed',
  ]);

  for (const [userId, userEvents] of byUser) {
    const { label, tenantName } = makeLabel(userId);

    // --- Rapid refresh -----------------------------------------------------
    const refreshes = userEvents
      .filter((e) => e.eventType === 'manual_refresh_clicked')
      .map((e) => e.occurredAt.getTime());
    for (let i = 0; i + 2 < refreshes.length; i++) {
      if (refreshes[i + 2] - refreshes[i] < 120_000) {
        signals.push({
          type: 'rapid_refresh',
          userId,
          userLabel: label,
          tenantName,
          at: new Date(refreshes[i + 2]).toISOString(),
          detail: `hit Refresh 3+ times in under 2 minutes - likely fighting stale data`,
          severity: 3,
        });
        break; // only flag once per user per window
      }
    }

    // --- Sessionize (90s gap = new session) -------------------------------
    const sessions: { start: number; end: number; events: typeof userEvents }[] = [];
    let current: { start: number; end: number; events: typeof userEvents } | null = null;
    for (const e of userEvents) {
      const t = e.occurredAt.getTime();
      if (!current || t - current.end > 90_000) {
        current = { start: t, end: t, events: [e] };
        sessions.push(current);
      } else {
        current.end = t;
        current.events.push(e);
      }
    }

    // --- Bounce: <15s session with zero interaction events ----------------
    for (const s of sessions) {
      const duration = s.end - s.start;
      if (duration > 15_000) continue;
      const hasInteraction = s.events.some((e) => INTERACTION_EVENTS.has(e.eventType));
      if (hasInteraction) continue;
      // Must also have at least one session_start or page_view - otherwise
      // a single stray heartbeat counts as a bounce which is noise.
      const hasEntry = s.events.some(
        (e) => e.eventType === 'session_start' || e.eventType === 'page_view',
      );
      if (!hasEntry) continue;
      signals.push({
        type: 'bounce',
        userId,
        userLabel: label,
        tenantName,
        at: new Date(s.start).toISOString(),
        detail: `bounced in ${Math.max(1, Math.round(duration / 1000))}s without touching anything`,
        severity: 1,
      });
    }

    // --- Dead dwell: 5+ min of page_active on same path, no interactions --
    let runPath: string | null = null;
    let runStart: number | null = null;
    let runLast: number | null = null;
    let runHasInteraction = false;

    const flushRun = () => {
      if (runPath === null || runStart === null || runLast === null) return;
      const duration = runLast - runStart;
      if (duration >= 5 * 60_000 && !runHasInteraction) {
        signals.push({
          type: 'dead_dwell',
          userId,
          userLabel: label,
          tenantName,
          at: new Date(runLast).toISOString(),
          detail: `stared at ${pathToTab(runPath)} for ${Math.round(duration / 60_000)} min with zero clicks - likely stuck`,
          severity: 2,
        });
      }
    };

    for (const e of userEvents) {
      const t = e.occurredAt.getTime();
      if (e.eventType === 'page_active') {
        const path = parsePath(e.meta);
        if (path !== runPath) {
          flushRun();
          runPath = path;
          runStart = t;
          runHasInteraction = false;
        }
        runLast = t;
      } else if (INTERACTION_EVENTS.has(e.eventType)) {
        runHasInteraction = true;
      }
    }
    flushRun();
  }

  // Sort: highest severity first, then most recent.
  signals.sort((a, b) => {
    if (b.severity !== a.severity) return b.severity - a.severity;
    return new Date(b.at).getTime() - new Date(a.at).getTime();
  });

  // ---- Tenant engagement rollup (reuses heartbeat -> seconds math) --------
  const tenantRows = await Promise.all(
    tenants.map(async (t) => {
      const [heartbeatCount, sessionCount, lastEvent, dayRows] = await Promise.all([
        prisma.usageEvent.count({
          where: { tenantId: t.id, eventType: 'page_active', occurredAt: { gte: since } },
        }),
        prisma.usageEvent.count({
          where: { tenantId: t.id, eventType: 'session_start', occurredAt: { gte: since } },
        }),
        prisma.usageEvent.findFirst({
          where: { tenantId: t.id },
          orderBy: { occurredAt: 'desc' },
          select: { occurredAt: true },
        }),
        prisma.usageEvent.findMany({
          where: { tenantId: t.id, occurredAt: { gte: since } },
          select: { occurredAt: true },
        }),
      ]);
      const activeDays = new Set(dayRows.map((e) => e.occurredAt.toISOString().slice(0, 10))).size;
      return {
        tenantId: t.id,
        companyName: t.companyName,
        activeViewSeconds: heartbeatCount * 15,
        sessionCount,
        activeDays,
        lastSeenAt: lastEvent?.occurredAt ?? null,
      };
    }),
  );
  tenantRows.sort((a, b) => b.activeViewSeconds - a.activeViewSeconds);

  // ---- Expert review chip clicks ------------------------------------------
  // Who tapped the "Free expert review" CTA, how many times, and from where.
  // This is the highest-intent signal in the product, so it gets its own list.
  const expertClickMap = new Map<
    string,
    { userId: string; userLabel: string; tenantName: string | null; count: number; lastAt: string; fromPaths: Set<string> }
  >();
  for (const e of events) {
    if (e.eventType !== 'expert_review_clicked') continue;
    const u = userMap.get(e.userId);
    const label = u?.name || u?.email || e.userId.slice(0, 8);
    const existing = expertClickMap.get(e.userId);
    const fromPath = parsePath(e.meta) ?? '';
    if (existing) {
      existing.count += 1;
      existing.lastAt = e.occurredAt.toISOString();
      if (fromPath) existing.fromPaths.add(fromPath);
    } else {
      expertClickMap.set(e.userId, {
        userId: e.userId,
        userLabel: label,
        tenantName: e.tenantId ? tenantMap.get(e.tenantId) ?? null : null,
        count: 1,
        lastAt: e.occurredAt.toISOString(),
        fromPaths: fromPath ? new Set([fromPath]) : new Set(),
      });
    }
  }
  const expertReviewClicks = Array.from(expertClickMap.values())
    .map((r) => ({ ...r, fromPaths: Array.from(r.fromPaths) }))
    .sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());

  res.json({
    days,
    frictionSignals: signals.slice(0, 25),
    tabDwell,
    tenantEngagement: tenantRows,
    expertReviewClicks,
  });
});

/** Live presence: users with activity in the last 2 minutes. */
analyticsRouter.get('/live', async (_req, res) => {
  const since = new Date(Date.now() - 2 * 60_000);
  const recent = await prisma.usageEvent.findMany({
    where: { occurredAt: { gte: since }, eventType: 'page_active' },
    distinct: ['userId'],
    select: { userId: true, tenantId: true, occurredAt: true },
    orderBy: { occurredAt: 'desc' },
  });
  const userIds = recent.map((r) => r.userId);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, email: true, tenantId: true },
  });
  const tenantIds = [...new Set(users.map((u) => u.tenantId).filter(Boolean) as string[])];
  const tenants = await prisma.tenant.findMany({
    where: { id: { in: tenantIds } },
    select: { id: true, companyName: true },
  });
  const tenantMap = new Map(tenants.map((t) => [t.id, t.companyName]));
  res.json(
    users.map((u) => ({
      userId: u.id,
      email: u.email,
      tenantId: u.tenantId,
      companyName: u.tenantId ? tenantMap.get(u.tenantId) : null,
    })),
  );
});

export { analyticsRouter };
