"use client";

import BookCallButton from "./BookCallButton";

export default function CTA() {
  return (
    <section className="py-20 md:py-28 bg-white border-t border-neutral-100" id="contact">
      <div className="mx-auto max-w-3xl px-6 text-center">
        <p className="text-xs font-medium text-accent uppercase tracking-widest mb-4">Get started</p>
        <h2 className="text-3xl md:text-4xl lg:text-5xl font-semibold tracking-tight mb-4">
          Hear the AI handle a real call
          <span className="text-muted-foreground"> for your practice</span>
        </h2>
        <p className="text-base md:text-lg text-muted-foreground mb-8 max-w-xl mx-auto">
          Book a 30-minute demo. We'll run a live call using your scheduling rules, insurance requirements, and appointment types.
        </p>
        <BookCallButton size="lg" iconVariant="arrow-right" className="rounded-full text-base px-8 py-3">
          Book a Demo
        </BookCallButton>
      </div>
    </section>
  );
}
