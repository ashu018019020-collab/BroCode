import { PrismaClient } from '@prisma/client';

/** The name to show for an account whose profile row is missing, or has no display name yet. */
function fallbackName(authUser) {
  const named = authUser?.user_metadata?.display_name;
  if (typeof named === 'string' && named.trim()) return named.trim();
  return (authUser?.email ?? '').split('@')[0] ?? '';
}

export function createSupabaseStore(prisma = new PrismaClient()) {
  const shape = (profile) => ({
    id: profile.id,
    name: profile.displayName,
    role: profile.role,
    status: profile.status,
    createdAt: profile.createdAt,
    lastSeenAt: profile.lastSeenAt,
    email: profile.email ?? '',
    // The account's resume position lives on the progress row. It is exposed here so the session
    // endpoint can answer "where was this learner?" without a second query.
    progress: profile.progress ?? null,
  });

  return {
    name: 'prisma',

    async close() {
      await prisma.$disconnect();
    },

    async health() {
      await prisma.$queryRaw`SELECT 1`;
    },

    /**
     * The profile, CREATED ON DEMAND if the database trigger never ran.
     *
     * Why this is not `findUnique`: a missing row made the API answer "profile unavailable", which —
     * now that an account is required for every learning surface — locks a legitimately authenticated
     * learner out of the whole product because of a database trigger they cannot see. The two
     * reliable ways a row goes missing are a migration applied without its trigger and a signup that
     * raced it, and neither is the learner's fault.
     *
     * `upsert` is safe in every direction that matters:
     *   · IDEMPOTENT — `id` is the primary key, and `update` touches nothing at all, so concurrent
     *     calls cannot produce a duplicate row or clobber an existing one;
     *   · a learner can only create a row FOR THEMSELVES, because `id` comes from the verified bearer
     *     token, never from a request body;
     *   · `role` and `status` are NOT written, so the database defaults (`user`, `active`) apply and
     *     this path can never mint an administrator or silently re-enable a banned account — the
     *     caller still checks `status` afterwards and rejects a disabled one.
     */
    async getProfile(userId, authUser) {
      const profile = await prisma.profile.upsert({
        where: { id: userId },
        update: {},
        create: {
          id: userId,
          displayName: fallbackName(authUser),
          email: authUser?.email ?? null,
        },
      });
      return shape(profile);
    },

    async touchProfile(userId, now = new Date()) {
      return prisma.profile.update({
        where: { id: userId },
        data: { lastSeenAt: now },
      });
    },

    async recordSignInEvent(userId, provider, signedInAt = new Date()) {
      return prisma.signInEvent.create({
        data: { userId, provider, signedInAt },
      });
    },

    async listRecentSignIns(limit = 50) {
      const events = await prisma.signInEvent.findMany({
        take: limit,
        orderBy: { signedInAt: 'desc' },
        include: { user: { select: { displayName: true } } },
      });
      return events.map((event) => ({
        id: event.id,
        userId: event.userId,
        name: event.user.displayName,
        provider: event.provider,
        signedInAt: event.signedInAt,
      }));
    },

    async saveProgress(userId, progress, now = new Date()) {
      return prisma.progressSnapshot.upsert({
        where: { userId },
        create: { userId, ...progress, updatedAt: now },
        update: { ...progress, updatedAt: now },
      });
    },

    async listAdminUsers() {
      const profiles = await prisma.profile.findMany({
        include: { progress: true },
        orderBy: { createdAt: 'desc' },
      });
      return profiles.map((profile) => ({
        id: profile.id,
        name: profile.displayName,
        email: profile.email ?? '',
        role: profile.role,
        status: profile.status,
        createdAt: profile.createdAt,
        lastSeenAt: profile.lastSeenAt,
        progress: profile.progress,
      }));
    },

    async updateStatus(userId, status) {
      return prisma.profile.update({
        where: { id: userId },
        data: { status },
      });
    },
  };
}
