import { NextResponse } from "next/server";

import { getSmsInbox } from "@/lib/sms/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const inbox = await getSmsInbox(url.searchParams.get("inboxId"));

  if (!inbox) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(inbox);
}
