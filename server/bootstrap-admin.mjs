import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { listAllAuthUsers, createSupabaseServices } from './supabase.mjs';

const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
if (!email) throw new Error('Set BOOTSTRAP_ADMIN_EMAIL to the owner account email before bootstrapping.');

const { admin } = createSupabaseServices();
const authUsers = await listAllAuthUsers(admin);
const authUser = authUsers.find((user) => user.email?.trim().toLowerCase() === email);
if (!authUser) {
  throw new Error('Create and confirm the owner account in Supabase Auth before bootstrapping it as admin.');
}

const prisma = new PrismaClient();
try {
  await prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw(Prisma.sql`LOCK TABLE public.profiles IN EXCLUSIVE MODE`);
    const existingAdmins = await transaction.profile.count({ where: { role: 'admin' } });
    if (existingAdmins > 0) {
      throw new Error('An administrator already exists; refusing to bootstrap another.');
    }
    await transaction.profile.upsert({
      where: { id: authUser.id },
      create: {
        id: authUser.id,
        displayName: authUser.user_metadata?.display_name ?? email.split('@')[0],
        role: 'admin',
        status: 'active',
      },
      update: { role: 'admin', status: 'active' },
    });
  });
  console.log(`Bootstrapped Supabase administrator account: ${email}`);
} finally {
  await prisma.$disconnect();
}
