"use client";

import BookCallButton from "./BookCallButton";

export default function CTA() {
  return (
    <section
      className="relative overflow-hidden bg-[#0b1f23] py-24 text-white md:py-32"
      id="contact"
    >
      {/* Soft accent vignettes — same language as the stat strip */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-32 top-0 h-[480px] w-[480px] rounded-full bg-[radial-gradient(closest-side,rgba(63,196,176,0.15),transparent_70%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-32 bottom-0 h-[520px] w-[520px] rounded-full bg-[radial-gradient(closest-side,rgba(63,196,176,0.10),transparent_70%)]"
      />

      <div className="relative mx-auto max-w-4xl px-6 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#5fdcc7]">
          Get started
        </p>
        <h2 className="mx-auto mt-5 max-w-[18ch] text-4xl font-semibold leading-[1.0] tracking-[-0.03em] text-white md:text-6xl lg:text-[4.5rem] [text-wrap:balance]">
          See it run on a live call.
        </h2>
        <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-white/85 md:text-lg">
          Book a 30-minute demo. We&apos;ll run it on your scheduling rules, insurance
          flow, and appointment types.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-4">
          <BookCallButton
            className="rounded-full bg-white px-8 py-3 text-base font-semibold text-[#0b1f23] shadow-[0_18px_45px_rgba(0,0,0,0.18)] transition-opacity hover:opacity-90"
            iconVariant="arrow-right"
            size="lg"
          >
            Book a Demo
          </BookCallButton>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/75">
            Live walkthrough · ophthalmology workflow review
          </p>
        </div>
      </div>
    </section>
  );
}
