import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight } from "lucide-react";

import { Button } from "@/app/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/card";
import { getPortalWorkspaceState } from "@/lib/portal-state";

const analyticsSummary = [
  {
    label: "Call volume",
    note: "Live telephony feed not connected yet",
    value: "Awaiting data",
  },
  {
    label: "Appointments booked",
    note: "Scheduling sync will populate after go-live",
    value: "Awaiting data",
  },
  {
    label: "Response rate",
    note: "Messaging metrics appear once two-way texting is active",
    value: "Awaiting data",
  },
] as const;

const moduleQueue = [
  {
    description: "Review escalations, callbacks, and handoffs that need staff attention.",
    href: "/portal/app/call-center",
    label: "Call Center",
  },
  {
    description: "Monitor patient replies, follow-ups, and unresolved message threads.",
    href: "/portal/app/two-way-texting",
    label: "Two-way Texting",
  },
  {
    description: "Track human follow-up items created after calls or text conversations.",
    href: "/portal/app/tasking",
    label: "Tasking",
  },
  {
    description: "Audit completed interactions, trends, and QA signals after launch.",
    href: "/portal/app/post-call-analytics",
    label: "Post-call Analytics",
  },
] as const;

export default async function PortalOverviewPage() {
  const portalState = await getPortalWorkspaceState();

  if (!portalState.launched) {
    redirect("/portal/app/onboarding");
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-[#6a7b7e]">Overview</p>
        <h2 className="text-3xl font-semibold tracking-[-0.05em] text-[#10272c]">
          Operations home
        </h2>
        <p className="max-w-3xl text-base leading-relaxed text-[#617477]">
          Once the agent is live, this is the default landing state. The overview stays focused on
          launch status, a small analytics summary, and the modules that deserve follow-up.
        </p>
      </section>

      <Card className="rounded-[1.8rem] border-black/6 bg-white">
        <CardHeader>
          <CardTitle>Portal status</CardTitle>
          <CardDescription>Live mode is active for this practice.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <p className="max-w-2xl text-sm leading-relaxed text-[#617477]">
            The onboarding checklist is complete and the portal now defaults to operations review.
            Knowledge base and insurance rules remain available for updates whenever workflows
            change.
          </p>

          <Button asChild variant="primary">
            <Link href="/portal/app/call-center">
              Open call center
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {analyticsSummary.map((item) => (
          <Card key={item.label} className="rounded-[1.8rem] border-black/6 bg-white">
            <CardHeader className="pb-2">
              <CardDescription className="text-xs uppercase tracking-[0.16em] text-[#6a7b7e]">
                {item.label}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold tracking-[-0.04em] text-[#10272c]">
                {item.value}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-[#617477]">{item.note}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="rounded-[1.8rem] border-black/6 bg-white">
        <CardHeader>
          <CardTitle>Operations queue</CardTitle>
          <CardDescription>The live portal modules available from this home screen.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {moduleQueue.map((item) => (
            <div
              key={item.label}
              className="flex flex-col gap-4 rounded-[1.4rem] border border-black/6 bg-[#f7fbfa] px-4 py-4 lg:flex-row lg:items-start lg:justify-between"
            >
              <div>
                <p className="text-sm font-semibold text-[#10272c]">{item.label}</p>
                <p className="mt-1 text-sm leading-relaxed text-[#617477]">{item.description}</p>
              </div>

              <Button asChild size="sm" variant="secondary">
                <Link href={item.href}>Open</Link>
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
