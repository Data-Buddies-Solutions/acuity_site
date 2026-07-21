import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Panel,
  PanelContent,
  PanelDescription,
  PanelHeader,
  PanelTitle,
} from "@/components/ui/panel";

type QueueItem = {
  description: string;
  label: string;
};

export default function PortalModulePlaceholder({
  description,
  eyebrow,
  primaryActionHref,
  primaryActionLabel,
  queueDescription,
  queueItems,
  statusDescription,
  statusTitle,
  title,
}: Readonly<{
  description: string;
  eyebrow: string;
  primaryActionHref: string;
  primaryActionLabel: string;
  queueDescription: string;
  queueItems: QueueItem[];
  statusDescription: string;
  statusTitle: string;
  title: string;
}>) {
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-[#6a7b7e]">
          {eyebrow}
        </p>
        <h2 className="text-3xl font-semibold tracking-[-0.05em] text-[#10272c]">
          {title}
        </h2>
        <p className="max-w-3xl text-base leading-relaxed text-[#617477]">
          {description}
        </p>
      </section>

      <Panel className="rounded-[1.8rem] border-black/6 bg-white">
        <PanelHeader>
          <PanelTitle>{statusTitle}</PanelTitle>
          <PanelDescription>{statusDescription}</PanelDescription>
        </PanelHeader>
        <PanelContent className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <p className="max-w-2xl text-sm text-[#617477]">
            The route exists and the navigation is real. The remaining work here is wiring
            live events, persisted records, and module-specific actions.
          </p>

          <Button asChild variant="primary">
            <Link href={primaryActionHref}>
              {primaryActionLabel}
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
        </PanelContent>
      </Panel>

      <Panel className="rounded-[1.8rem] border-black/6 bg-white">
        <PanelHeader>
          <PanelTitle>Module queue</PanelTitle>
          <PanelDescription>{queueDescription}</PanelDescription>
        </PanelHeader>
        <PanelContent className="space-y-3">
          {queueItems.map((item) => (
            <div
              key={item.label}
              className="rounded-[1.4rem] border border-black/6 bg-[#f7fbfa] px-4 py-4"
            >
              <p className="text-sm font-semibold text-[#10272c]">{item.label}</p>
              <p className="mt-1 text-sm leading-relaxed text-[#617477]">
                {item.description}
              </p>
            </div>
          ))}
        </PanelContent>
      </Panel>
    </div>
  );
}
