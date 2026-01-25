"use client";

import BookCallButton from "./BookCallButton";

export default function CTA() {
  return (
    <section className="py-20 md:py-28 bg-muted" id="contact">
      <div className="mx-auto max-w-3xl px-6 text-center">
        <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-4">
          Ready to bring AI to your practice?
        </h2>
        <p className="text-lg text-muted-foreground mb-8">
          Book a free strategy call to discuss your workflows and explore how AI agents can help your team.
        </p>
        <BookCallButton size="lg" iconVariant="none">
          Book a Strategy Call
        </BookCallButton>
      </div>
    </section>
  );
}
