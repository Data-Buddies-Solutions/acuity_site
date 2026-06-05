"use client";

import { motion, useInView } from "framer-motion";
import Image from "next/image";
import { useRef } from "react";

export default function WhatWeBuild() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.2, once: true });

  return (
    <section className="bg-white py-24 md:py-36" id="how-it-works">
      <div ref={ref} className="mx-auto max-w-7xl px-4 md:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="marketing-label text-xs font-medium tracking-[0.16em] text-accent">
            Inside the platform
          </p>
          <h2 className="mt-4 text-4xl font-semibold leading-[1.05] tracking-[-0.02em] md:text-5xl lg:text-[3.25rem] [text-wrap:balance]">
            Built for the way the front desk actually works.
          </h2>
        </div>

        <motion.div
          animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
          className="relative mx-auto mt-16 w-full max-w-6xl md:mt-20"
          initial={{ opacity: 0, y: 24 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
        >
          <Image
            alt="Acuity practice portal — overview dashboard"
            className="h-auto w-full rounded-2xl shadow-[0_40px_100px_rgba(23,32,51,0.14)] ring-1 ring-[#e1e5eb]"
            height={949}
            quality={95}
            sizes="(max-width: 1280px) 100vw, 1280px"
            src="/portal-overview.png"
            width={1603}
          />
        </motion.div>
      </div>
    </section>
  );
}
