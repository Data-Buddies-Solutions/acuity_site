"use client";

import BookCallButton from "./BookCallButton";
import AnimatedLogo from "./AnimatedLogo";
import { Badge } from "./ui/badge";
import { motion } from "framer-motion";

export default function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center py-20 bg-background" id="top">
      <div className="mx-auto max-w-7xl px-6 md:px-10">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left side - Text content */}
          <motion.div
            className="space-y-6 md:space-y-8 max-w-2xl mx-auto lg:mx-0"
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, ease: "easeOut" }}
          >
            <Badge variant="outline" className="backdrop-blur-sm bg-background/60 border-border text-sm font-medium uppercase tracking-tight">
              AI Automation for Small Businesses
            </Badge>

            <h1 className="text-4xl font-bold leading-tight tracking-tighter md:text-5xl lg:text-6xl xl:text-7xl">
              Stop Doing Repetitive Work.<br />
              <span className="text-accent">Let AI Do It</span>
            </h1>

            <p className="text-lg md:text-xl text-muted-foreground leading-relaxed">
              We build custom AI assistants that handle your busywork, from customer emails to data entry, so you can focus on growing your business
            </p>

            <div className="flex flex-col items-start pt-4">
              <BookCallButton iconVariant="none" className="rounded-xl h-12 px-8 text-base font-semibold" />
            </div>
          </motion.div>

          {/* Right side - Animation */}
          <motion.div
            className="relative flex items-center justify-center w-full h-[300px] md:h-[400px] lg:h-[500px]"
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, ease: "easeOut", delay: 0.2 }}
          >
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-96 h-96 rounded-full bg-gradient-to-br from-accent/30 via-accent/20 to-accent/10 blur-3xl" />
            </div>
            <div className="relative z-10 w-full h-full flex items-center justify-center">
              <AnimatedLogo />
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
