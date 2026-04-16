import bcrypt from 'bcrypt';
import { prisma } from './client.js';
import { env } from '../lib/env.js';

async function main() {
  const existing = await prisma.user.findUnique({ where: { email: env.SEED_ADMIN_EMAIL } });
  if (existing) {
    console.log(`[seed] Admin ${env.SEED_ADMIN_EMAIL} already exists - skipping.`);
    return;
  }

  const passwordHash = await bcrypt.hash(env.SEED_ADMIN_PASSWORD, 10);
  await prisma.user.create({
    data: {
      email: env.SEED_ADMIN_EMAIL,
      passwordHash,
      role: 'admin',
      tenantId: null,
    },
  });
  console.log(`[seed] Created admin user: ${env.SEED_ADMIN_EMAIL}`);
  console.log(`[seed] IMPORTANT: change the password after first login.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
