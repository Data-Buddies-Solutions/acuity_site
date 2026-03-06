"use client";

import BookCallButton from "./BookCallButton";

export default function CTA() {
  return (
    <section className="py-20 md:py-28 bg-muted" id="contact">
      <div className="mx-auto max-w-3xl px-6 text-center">
        <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-4">
          See it in action
        </h2>
        <p className="text-lg text-muted-foreground mb-8">
          Book a demo and hear the AI phone system handle a real call for your practice.
        </p>
        <BookCallButton size="lg" iconVariant="none">
          Book a Demo
        </BookCallButton>
      </div>
    </section>
  );
}
