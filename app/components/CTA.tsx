import Link from "next/link";

import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { SITE_CONFIG } from "@/lib/config";
import BookCallButton from "./BookCallButton";

export default function CTA() {
  return (
    <section className="py-16 md:py-24">
      <div className="mx-auto max-w-screen-xl px-4">
        <div className="mx-auto max-w-3xl space-y-8 text-center">
          <div className="space-y-4">
            <Badge variant="outline" className="text-sm font-medium uppercase">
              Ready to automate?
            </Badge>
            <h2 className="text-3xl font-semibold md:text-4xl lg:text-5xl">
              Start your AI automation roadmap with a tailored blueprint
            </h2>
            <p className="text-lg text-foreground/75 md:text-xl">
              We'll map quick wins, review your data, and build a clear roadmap. You'll get a prioritized plan and ROI model within one week
            </p>
          </div>
          <div className="flex flex-row gap-3 items-center justify-center">
            <BookCallButton iconVariant="none" className="rounded-full h-9 px-4 text-sm sm:h-11 sm:px-6 sm:text-base" />
            <Button asChild variant="secondary" className="rounded-full h-9 px-4 text-sm sm:h-11 sm:px-6 sm:text-base">
              <Link href={`mailto:${SITE_CONFIG.email}`}>Email our team</Link>
            </Button>
          </div>
          <p className="text-sm text-foreground/60">
            Prefer async? We'll record a walkthrough with personalized automation ideas after reviewing your intake form
          </p>
        </div>
      </div>
    </section>
  );
}
