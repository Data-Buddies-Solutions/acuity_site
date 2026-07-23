import { PrismaPg } from "@prisma/adapter-pg";

export function createPrismaAdapter(connectionString: string, max: number) {
  return new PrismaPg({
    allowExitOnIdle: true,
    connectionString,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
    max,
  });
}
