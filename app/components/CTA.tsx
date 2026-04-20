"use client";

import BookCallButton from "./BookCallButton";

export default function CTA() {
  return (
    <section className="py-20 md:py-32 bg-[linear-gradient(180deg,#ffffff_0%,#f6fbfb_100%)] relative overflow-hidden border-t border-neutral-100" id="contact">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(13,115,119,0.10),transparent_40%)]" />
      <div className="relative mx-auto max-w-4xl px-6 text-center">
        <p className="text-xs font-medium text-accent uppercase tracking-widest mb-4">Get started</p>
        <h2 className="text-3xl md:text-4xl lg:text-[3.4rem] font-semibold tracking-tight mb-5 leading-[1.05]">
          If patient engagement is breaking at the front desk, this is where to start.
        </h2>
        <p className="text-base md:text-lg text-muted-foreground mb-10 max-w-2xl mx-auto leading-relaxed">
          Book a 30-minute demo and we&apos;ll run a live call using your scheduling rules, insurance
          requirements, and appointment types so you can hear how Acuity would handle the patient
          experience end to end.
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
