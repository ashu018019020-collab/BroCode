import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { listAllAuthUsers, createSupabaseServices } from './supabase.mjs';
import { databaseConfigured } from './db-config.mjs';

/**
 * `npm run bootstrap:admin` — promote exactly ONE existing, confirmed account to administrator.
 *
 * There are two places a role can live, matching the two account stores:
 *   Postgres configured → `profiles.role` (the richer store)
 *   otherwise           → `app_metadata.brocode_role` on the Supabase user, which only a secret key
 *                         can write, so a client cannot promote itself.
 *
 * Both refuse to run when an administrator already exists: the first owner is a bootstrapping step,
 * not a role-granting API. The account must exist and be confirmed in Supabase Auth first — signing
 * up is the user's own action.
 */
const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
if (!email) throw new Error('Set BOOTSTRAP_ADMIN_EMAIL to the owner account email before bootstrapping.');

const { admin } = createSupabaseServices();
const authUsers = await listAllAuthUsers(admin);
const authUser = authUsers.find((user) => user.email?.trim().toLowerCase() === email);
if (!authUser) {
  throw new Error('Create and confirm the owner account in Supabase Auth before bootstrapping it as admin.');
}
if (!(authUser.email_confirmed_at || authUser.confirmed_at)) {
  throw new Error('Confirm the owner account first (email link, or confirm it from the Supabase dashboard).');
}

if (databaseConfigured()) {
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
    console.log(`Bootstrapped Supabase administrator account: ${email} (store: prisma)`);
  } finally {
    await prisma.$disconnect();
  }
} else {
  const existingAdmins = authUsers.filter((user) => user.app_metadata?.brocode_role === 'admin');
  if (existingAdmins.length > 0) {
    throw new Error('An administrator already exists; refusing to bootstrap another.');
  }
  // Read-modify-write: never depend on how GoTrue merges metadata.
  const { error } = await admin.auth.admin.updateUserById(authUser.id, {
    app_metadata: { ...(authUser.app_metadata ?? {}), brocode_role: 'admin' },
  });
  if (error) throw error;
  console.log(`Bootstrapped Supabase administrator account: ${email} (store: supabase-auth)`);
}
