"use client";

import { motion } from "framer-motion";
import Image from "next/image";

export default function WhoWeAre() {
  return (
    <section className="relative py-20 md:py-24 overflow-hidden bg-muted/15" id="who-we-are">

      <div className="relative mx-auto max-w-7xl px-6 md:px-10">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left side - Text content */}
          <motion.div
            className="space-y-6"
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: false, amount: 0.3 }}
            transition={{ duration: 0.7, ease: "easeOut" }}
          >
            <h2 className="text-3xl font-bold tracking-tighter md:text-4xl lg:text-5xl">
              Works With Your Existing Tools
            </h2>
            <p className="text-base text-muted-foreground md:text-lg leading-relaxed">
              Connect to any system you already use
            </p>
          </motion.div>

          {/* Right side - Image with floating effect */}
          <motion.div
            className="relative"
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: false, amount: 0.2 }}
            transition={{ duration: 0.7, ease: "easeOut", delay: 0.2 }}
          >
            {/* Subtle glow effect behind image */}
            <div className="absolute inset-0 bg-gradient-to-br from-accent/20 via-accent/10 to-transparent blur-3xl -z-10 scale-110" />

            <div className="relative overflow-hidden rounded-2xl shadow-2xl ring-1 ring-border/50">
              <Image
                src="/ChatGPT Image Nov 28, 2025, 08_35_47 AM.png"
                alt="Connect to any data source - CRM, EMR, Google Workspace, Database"
                width={1200}
                height={900}
                className="w-full h-auto"
                priority
              />
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
