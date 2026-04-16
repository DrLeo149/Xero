import cron from 'node-cron';
import { prisma } from '../db/client.js';
import { runSync } from '../xero/sync.js';

/**
 * Per-tenant cron jobs. One ScheduledTask per tenant that has `refreshCron` set.
 * Jobs are (re)registered at boot and whenever an admin updates a tenant's cron.
 */
const jobs = new Map<string, cron.ScheduledTask>();

export function unscheduleTenant(tenantId: string) {
  const existing = jobs.get(tenantId);
  if (existing) {
    existing.stop();
    jobs.delete(tenantId);
  }
}

export function rescheduleTenant(tenantId: string, expr: string) {
  unscheduleTenant(tenantId);
  if (!cron.validate(expr)) {
    console.warn(`[scheduler] invalid cron "${expr}" for tenant ${tenantId}`);
    return;
  }
  const task = cron.schedule(expr, async () => {
    try {
      console.log(`[scheduler] running scheduled sync for tenant ${tenantId}`);
      await runSync(tenantId, 'scheduled');
    } catch (e) {
      console.error(`[scheduler] sync failed for ${tenantId}:`, e);
    }
  });
  jobs.set(tenantId, task);
  console.log(`[scheduler] registered cron "${expr}" for tenant ${tenantId}`);
}

export async function bootScheduler() {
  const tenants = await prisma.tenant.findMany({
    where: { refreshCron: { not: null } },
    select: { id: true, refreshCron: true },
  });
  for (const t of tenants) {
    if (t.refreshCron) rescheduleTenant(t.id, t.refreshCron);
  }
  console.log(`[scheduler] booted with ${jobs.size} active jobs`);
}
