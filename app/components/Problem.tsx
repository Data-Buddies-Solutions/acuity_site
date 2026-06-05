"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";

const stats = [
  { number: "23%", label: "of patient calls go to voicemail" },
  { number: "15%", label: "of demand comes in after hours" },
  { number: "25+", label: "front-desk hours a week on the phone" },
];

export default function Problem() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.2, once: true });

  return (
    <section className="bg-[#111827] py-24 text-white md:py-32" id="problem">
      <div ref={ref} className="mx-auto max-w-6xl px-4 md:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="marketing-label text-[11px] font-medium tracking-[0.16em] text-[#aebbd0]">
            Why this matters
          </p>
          <h2 className="mt-5 text-4xl font-semibold leading-[1.05] tracking-[-0.025em] text-white md:text-5xl lg:text-[3.5rem] [text-wrap:balance]">
            A more responsive front desk is a better patient experience.
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-[#d8dee8] md:text-lg">
            Missed calls, voicemail, and after-hours dead ends do more than create
            friction. They slow booking, pile on repetitive phone work, and make the
            practice feel harder to reach.
          </p>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-12 md:mt-24 md:grid-cols-3 md:gap-8">
          {stats.map((item, i) => (
            <motion.div
              animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
              className="text-center md:border-l md:border-[#aebbd0]/18 md:px-6 md:first:border-l-0"
              initial={{ opacity: 0, y: 16 }}
              key={item.label}
              transition={{ delay: 0.15 + i * 0.12, duration: 0.5, ease: "easeOut" }}
            >
              <p className="font-display text-6xl font-medium tracking-[-0.052em] tabular-nums text-white md:text-7xl lg:text-[5.5rem]">
                {item.number}
              </p>
              <p className="mx-auto mt-4 max-w-[20ch] text-sm leading-relaxed text-[#d8dee8] md:text-base">
                {item.label}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
