import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaUrl?: string;
};

function createClient(connectionString: string | undefined) {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

const currentUrl = process.env.DATABASE_URL;

if (
  process.env.NODE_ENV !== "production" &&
  globalForPrisma.prisma &&
  globalForPrisma.prismaUrl !== currentUrl
) {
  void globalForPrisma.prisma.$disconnect().catch(() => {});
  globalForPrisma.prisma = undefined;
}

export const db = globalForPrisma.prisma ?? createClient(currentUrl);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
  globalForPrisma.prismaUrl = currentUrl;
}
