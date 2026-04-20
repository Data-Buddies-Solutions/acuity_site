"use client";

import BookCallButton from "./BookCallButton";

export default function CTA() {
  return (
    <section className="py-20 md:py-32 bg-white relative overflow-hidden border-t border-neutral-100" id="contact">
      <div className="relative mx-auto max-w-4xl px-6 text-center">
        <p className="text-xs font-medium text-accent uppercase tracking-widest mb-4">Get started</p>
        <h2 className="text-3xl md:text-4xl lg:text-[3.4rem] font-semibold tracking-tight mb-5 leading-[1.05]">
          If engagement is breaking at the front desk, start here.
        </h2>
        <p className="text-base md:text-lg text-muted-foreground mb-10 max-w-2xl mx-auto leading-relaxed">
          Book a 30-minute demo. We&apos;ll run a live call using your scheduling rules, insurance requirements, and appointment types.
        </p>
        <div className="flex flex-col items-center justify-center gap-4">
          <BookCallButton
            size="lg"
            iconVariant="arrow-right"
            className="rounded-full text-base px-8 py-3"
          >
            Book a Demo
          </BookCallButton>
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground/70">
            Ophthalmology-specific workflow review · live call walkthrough
          </p>
        </div>
      </div>
    </section>
  );
}
