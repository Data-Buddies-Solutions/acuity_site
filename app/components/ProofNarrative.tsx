"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";

const outcomes = [
  { metric: "0", label: "missed calls in the first 30 days" },
  { metric: "500+", label: "appointments booked directly into the EMR" },
  { metric: "2,000+", label: "after-hours calls answered" },
  { metric: "400", label: "staff hours returned to the team" },
];

export default function ProofNarrative() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.2, once: true });

  return (
    <section className="bg-[#172033] py-24 text-white md:py-32" id="results">
      <div ref={ref} className="mx-auto max-w-7xl px-4 md:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="marketing-label text-xs font-medium tracking-[0.16em] text-white/65">
            Proof from practice
          </p>
          <h2 className="mt-4 text-4xl font-semibold leading-[1.05] tracking-[-0.02em] text-white md:text-5xl lg:text-[3.25rem] [text-wrap:balance]">
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
              <p className="font-display text-5xl font-medium tracking-[-0.052em] text-white tabular-nums md:text-6xl lg:text-[4rem]">
                {o.metric}
              </p>
              <p className="mx-auto mt-3 max-w-[18ch] text-sm leading-relaxed text-white/68 md:text-base">
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
            className="block text-[6rem] leading-none text-white/12 md:text-[8rem]"
          >
            &ldquo;
          </span>
          <blockquote className="-mt-8 text-2xl font-medium leading-[1.35] tracking-[-0.01em] text-white md:text-3xl lg:text-[2.25rem] [text-wrap:balance]">
            I was spending 4+ hours a day on manual admin work. Acuity gave me my life
            back.
          </blockquote>
          <figcaption className="mt-8 flex items-center justify-center gap-3 text-sm">
            <span className="font-semibold text-white">Jason Buchwald</span>
            <span className="h-1 w-1 rounded-full bg-white/25" />
            <span className="text-white/65">Practice Operator</span>
          </figcaption>
        </motion.figure>
      </div>
    </section>
  );
}
