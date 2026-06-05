"use client";

import BookCallButton from "./BookCallButton";

export default function CTA() {
  return (
    <section
      className="relative overflow-hidden bg-[#111827] py-24 text-white md:py-32"
      id="contact"
    >
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-white/15" />
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-px bg-accent/35" />

      <div className="relative mx-auto max-w-4xl px-6 text-center">
        <p className="marketing-label text-[11px] font-medium tracking-[0.16em] text-[#aebbd0]">
          Get started
        </p>
        <h2 className="mx-auto mt-5 max-w-[18ch] text-4xl font-semibold leading-[1.0] tracking-[-0.03em] text-white md:text-6xl lg:text-[4.5rem] [text-wrap:balance]">
          See it run on a live call.
        </h2>
        <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-[#d8dee8] md:text-lg">
          Book a 30-minute demo. We&apos;ll run it on your scheduling rules, insurance
          flow, and appointment types.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-4">
          <BookCallButton
            className="marketing-cta rounded-[4px] bg-white px-8 py-3 text-[12px] font-medium tracking-[0.11em] text-[#111827] shadow-[0_18px_45px_rgba(0,0,0,0.18)] transition-opacity hover:opacity-90"
            iconVariant="arrow-right"
            size="lg"
          >
            Book a Demo
          </BookCallButton>
          <p className="marketing-label text-[11px] font-medium tracking-[0.14em] text-[#aebbd0]">
            Live walkthrough · ophthalmology workflow review
          </p>
        </div>
      </div>
    </section>
  );
}
