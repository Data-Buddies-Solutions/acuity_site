import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "../components/ui/button";
import { SITE_CONFIG } from "@/lib/config";

export const metadata: Metadata = {
  title: "Practice Portal",
  description:
    "Secure portal access for Acuity Health customer practices to manage onboarding, office knowledge, and operational visibility.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function PortalPage() {
  return (
    <section className="bg-[linear-gradient(180deg,#f7fbfb_0%,#ffffff_100%)]">
      <div className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-4xl items-center px-4 py-20 md:px-6">
        <div className="w-full rounded-[2rem] border border-neutral-200 bg-white p-8 shadow-card md:p-12">
          <div className="inline-flex items-center gap-2 rounded-full border border-accent/15 bg-accent/8 px-3 py-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            <span className="text-xs font-medium uppercase tracking-[0.14em] text-accent">
              Acuity Health
            </span>
          </div>

          <h1 className="mt-6 text-4xl leading-[1.02] md:text-5xl">
            Practice Portal
          </h1>

          <p className="mt-4 max-w-2xl text-base leading-relaxed md:text-lg">
            Secure portal access for customer practices is being rolled out. This
            workspace will house onboarding, office-specific knowledge, messaging,
            and analytics in one place.
          </p>

          <div className="mt-8 grid gap-4 text-sm text-muted-foreground md:grid-cols-3">
            <div className="rounded-2xl border border-neutral-200 bg-[#f7fbfb] p-4">
              Office setup
            </div>
            <div className="rounded-2xl border border-neutral-200 bg-[#f7fbfb] p-4">
              Knowledge base
            </div>
            <div className="rounded-2xl border border-neutral-200 bg-[#f7fbfb] p-4">
              Messaging and analytics
            </div>
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button variant="primary" size="lg" asChild>
              <Link href={`mailto:${SITE_CONFIG.email}?subject=Practice%20Portal%20Access`}>
                Request Access
              </Link>
            </Button>
            <Button variant="secondary" size="lg" asChild>
              <Link href="/">Back to site</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
