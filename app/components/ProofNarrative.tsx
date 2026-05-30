"use client";

import { motion, useInView } from "framer-motion";
import Image from "next/image";
import { useRef } from "react";

const outcomes = [
  { metric: "0", label: "missed calls in the first 30 days" },
  { metric: "500+", label: "appointments booked directly into the EMR" },
  { metric: "2,000+", label: "after-hours calls answered" },
  { metric: "400", label: "staff hours returned to the team" },
];

const logos = [
  { name: "AdvancedMD", logo: "/logo-advancedmd.png" },
  { name: "Jazzy Eyes Optical", logo: "/logo-jazzyeyes.jpg" },
  { name: "Abita Eye Group", logo: "/logo-abita.png" },
  { name: "NMB Eye Center", logo: "/logo-nmbeyecenter.jpg" },
];

export default function ProofNarrative() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.2, once: true });

  return (
    <section className="bg-white py-24 md:py-32" id="results">
      <div ref={ref} className="mx-auto max-w-7xl px-4 md:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-accent">
            Proof from practice
          </p>
          <h2 className="mt-4 text-4xl font-semibold leading-[1.05] tracking-[-0.02em] md:text-5xl lg:text-[3.25rem] [text-wrap:balance]">
            Six locations. Thirty days.
          </h2>
        </div>

        {/* Outcome strip — oversized numbers, no boxes */}
        <div className="mt-16 grid grid-cols-2 gap-y-12 md:mt-24 md:grid-cols-4 md:gap-y-0">
          {outcomes.map((o, i) => (
            <motion.div
              animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
              className="text-center"
              initial={{ opacity: 0, y: 16 }}
              key={o.label}
              transition={{ delay: 0.1 + i * 0.12, duration: 0.5, ease: "easeOut" }}
            >
              <p className="text-5xl font-semibold tracking-[-0.04em] text-accent tabular-nums md:text-6xl lg:text-[4rem]">
                {o.metric}
              </p>
              <p className="mx-auto mt-3 max-w-[18ch] text-sm leading-relaxed text-muted-foreground md:text-base">
                {o.label}
              </p>
            </motion.div>
          ))}
        </div>

        {/* Quote slide */}
        <motion.figure
          animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
          className="relative mx-auto mt-24 max-w-3xl text-center md:mt-32"
          initial={{ opacity: 0, y: 24 }}
          transition={{ delay: 0.5, duration: 0.6, ease: "easeOut" }}
        >
          <span
            aria-hidden="true"
            className="block text-[6rem] leading-none text-accent/20 md:text-[8rem]"
          >
            &ldquo;
          </span>
          <blockquote className="-mt-8 text-2xl font-medium leading-[1.35] tracking-[-0.01em] text-neutral-900 md:text-3xl lg:text-[2.25rem] [text-wrap:balance]">
            I was spending 4+ hours a day on manual admin work. Acuity gave me my life
            back.
          </blockquote>
          <figcaption className="mt-8 flex items-center justify-center gap-3 text-sm">
            <span className="font-semibold text-neutral-900">Jason Buchwald</span>
            <span className="h-1 w-1 rounded-full bg-neutral-300" />
            <span className="text-muted-foreground">Practice Operator</span>
          </figcaption>
        </motion.figure>

        {/* Logo strip — quiet trust signal */}
        <div className="mt-20 border-t border-neutral-100 pt-12 md:mt-28">
          <p className="text-center text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
            Deployed across
          </p>
          <div className="mx-auto mt-8 grid max-w-3xl grid-cols-2 items-center justify-items-center gap-x-10 gap-y-6 md:grid-cols-4">
            {logos.map((logo) => (
              <div className="relative h-9 w-32" key={logo.name}>
                <Image
                  alt={logo.name}
                  className="object-contain opacity-60 grayscale"
                  fill
                  sizes="128px"
                  src={logo.logo}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
