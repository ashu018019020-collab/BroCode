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
