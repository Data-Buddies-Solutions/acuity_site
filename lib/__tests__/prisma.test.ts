import { expect, it } from "bun:test";

import { createPrismaAdapter } from "../prisma-adapter";

it("passes database pool configuration through the Prisma adapter", async () => {
  const adapter = createPrismaAdapter(
    "postgresql://user:password@pooled.db.prisma.io:5432/acuity",
    2,
  );
  const connection = await adapter.connect();

  try {
    expect(connection.underlyingDriver().options).toMatchObject({
      connectionString: "postgresql://user:password@pooled.db.prisma.io:5432/acuity",
      max: 2,
    });
  } finally {
    await connection.dispose();
  }
});
