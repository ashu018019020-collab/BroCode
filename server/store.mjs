import { PrismaClient } from '@prisma/client';

export function createSupabaseStore(prisma = new PrismaClient()) {
  return {
    async close() {
      await prisma.$disconnect();
    },

    async health() {
      await prisma.$queryRaw`SELECT 1`;
    },

    async getProfile(userId) {
      const profile = await prisma.profile.findUnique({ where: { id: userId } });
      if (!profile) return null;
      return {
        id: profile.id,
        name: profile.displayName,
        role: profile.role,
        status: profile.status,
        createdAt: profile.createdAt,
        lastSeenAt: profile.lastSeenAt,
      };
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
