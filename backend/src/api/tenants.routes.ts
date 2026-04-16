import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { rescheduleTenant, unscheduleTenant } from '../scheduler/index.js';

export const tenantsRouter = Router();

// All routes here are admin-only
tenantsRouter.use(requireAuth, requireRole('admin'));

tenantsRouter.get('/', async (_req, res) => {
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      xeroConnection: { select: { orgName: true, connectedAt: true } },
      _count: { select: { users: true, invoices: true } },
    },
  });
  res.json(tenants);
});

const createTenantSchema = z.object({
  companyName: z.string().min(1),
  clientEmail: z.string().email(),
  clientPassword: z.string().min(6),
});

tenantsRouter.post('/', async (req, res) => {
  const parsed = createTenantSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { companyName, clientEmail, clientPassword } = parsed.data;
  const existing = await prisma.user.findUnique({ where: { email: clientEmail.toLowerCase() } });
  if (existing) return res.status(409).json({ error: 'Email already in use' });

  const tenant = await prisma.tenant.create({ data: { companyName } });
  const passwordHash = await bcrypt.hash(clientPassword, 10);
  const user = await prisma.user.create({
    data: {
      email: clientEmail.toLowerCase(),
      passwordHash,
      role: 'client',
      tenantId: tenant.id,
    },
  });
  await prisma.auditLog.create({
    data: {
      userId: req.user!.sub,
      action: 'tenant.create',
      targetTenantId: tenant.id,
      meta: JSON.stringify({ companyName, clientEmail }),
    },
  });
  res.status(201).json({ tenant, user: { id: user.id, email: user.email } });
});

tenantsRouter.delete('/:id', async (req, res) => {
  unscheduleTenant(req.params.id);
  await prisma.tenant.delete({ where: { id: req.params.id } });
  await prisma.auditLog.create({
    data: { userId: req.user!.sub, action: 'tenant.delete', targetTenantId: req.params.id },
  });
  res.json({ ok: true });
});

const cronSchema = z.object({ refreshCron: z.string().nullable() });
tenantsRouter.patch('/:id/refresh-cron', async (req, res) => {
  const parsed = cronSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenant = await prisma.tenant.update({
    where: { id: req.params.id },
    data: { refreshCron: parsed.data.refreshCron },
  });
  if (tenant.refreshCron) rescheduleTenant(tenant.id, tenant.refreshCron);
  else unscheduleTenant(tenant.id);
  res.json(tenant);
});

tenantsRouter.get('/:id/users', async (req, res) => {
  const users = await prisma.user.findMany({
    where: { tenantId: req.params.id },
    select: { id: true, email: true, role: true, createdAt: true, lastLoginAt: true },
  });
  res.json(users);
});
