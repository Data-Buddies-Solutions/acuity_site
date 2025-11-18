import Link from "next/link";

import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { SITE_CONFIG } from "@/lib/config";
import BookCallButton from "./BookCallButton";

export default function CTA() {
  return (
    <section className="relative py-20 md:py-32 overflow-hidden">
      {/* Geometric pattern background */}
      <div className="absolute inset-0 bg-gradient-to-br from-accent/10 via-accent/5 to-background">
        <div className="absolute inset-0 opacity-30" style={{
          backgroundImage: `radial-gradient(circle at 2px 2px, rgba(204, 102, 51, 0.15) 1px, transparent 0)`,
          backgroundSize: '48px 48px'
        }} />
      </div>
      <div className="relative mx-auto max-w-7xl px-6 md:px-10">
        <div className="mx-auto max-w-4xl space-y-10 text-center">
          <div className="space-y-6">
            <Badge variant="outline" className="backdrop-blur-sm bg-background/80 border-border text-sm font-medium uppercase tracking-tight">
              Ready to automate?
            </Badge>
            <h2 className="text-4xl font-bold tracking-tighter md:text-5xl lg:text-6xl">
              Start your AI automation roadmap with a tailored blueprint
            </h2>
            <p className="text-xl text-muted-foreground md:text-2xl max-w-3xl mx-auto">
              We'll map quick wins, review your data, and build a clear roadmap. You'll get a prioritized plan and ROI model within one week
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-center w-full px-4 sm:px-0">
            <BookCallButton iconVariant="none" className="rounded-xl h-12 px-8 text-base font-semibold w-full sm:w-auto" />
            <Button asChild variant="secondary" className="rounded-xl h-12 px-8 text-base font-semibold w-full sm:w-auto">
              <Link href={`mailto:${SITE_CONFIG.email}`}>Email our team</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
