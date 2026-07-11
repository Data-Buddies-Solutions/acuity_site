import { createMigrationReportHandler } from "./handler";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

export const GET = createMigrationReportHandler();
