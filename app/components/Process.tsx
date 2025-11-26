"use client";

import { Badge } from "./ui/badge";
import { motion } from "framer-motion";

const steps = [
  {
    step: "1",
    title: "We Listen",
    description:
      "Tell us what's eating up your time. We'll ask questions, understand your workflow, and spot what can be automated.",
  },
  {
    step: "2",
    title: "We Build",
    description:
      "We create your custom AI assistant and test it with real tasks from your business. You see it working before we go live.",
  },
  {
    step: "3",
    title: "We Launch",
    description:
      "We set everything up and show you (in plain English) how it all works. No technical manual required.",
  },
  {
    step: "4",
    title: "We Support",
    description:
      "We stick around to make sure it's working smoothly and add more automations as your business grows.",
  },
];

export default function Process() {
  return (
    <section className="py-20 md:py-32" id="process">
      <div className="mx-auto max-w-7xl px-6 md:px-10">
        <div className="mx-auto mb-16 md:mb-20 max-w-3xl space-y-6 text-center">
          <Badge variant="outline" className="backdrop-blur-sm bg-background/60 border-border text-sm font-medium uppercase tracking-tight">
            Our process
          </Badge>
          <h2 className="text-4xl font-bold tracking-tighter md:text-5xl lg:text-6xl">
            How We Work <span className="text-accent">With You</span>
          </h2>
          <p className="text-xl text-muted-foreground md:text-2xl">
            Simple, straightforward, and built around your schedule
          </p>
        </div>

        {/* Desktop: Horizontal layout */}
        <div className="hidden md:block mx-auto max-w-6xl">
          <div className="flex items-start justify-between gap-6">
            {steps.map(({ step, title, description }, index) => (
              <motion.div
                key={title}
                className="flex flex-col items-center text-center flex-1"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: false, amount: 0.3 }}
                transition={{ delay: index * 0.15, duration: 0.5 }}
              >
                <motion.div
                  className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-accent via-accent/90 to-accent/70 shadow-lg mb-6"
                  whileHover={{ scale: 1.1, rotate: 5 }}
                  transition={{ type: "spring", stiffness: 300 }}
                >
                  <span className="text-3xl font-bold text-white">{step}</span>
                </motion.div>

                <motion.h3
                  className="text-xl font-bold tracking-tight mb-3"
                  initial={{ opacity: 0 }}
                  whileInView={{ opacity: 1 }}
                  viewport={{ once: false }}
                  transition={{ delay: index * 0.15 + 0.2, duration: 0.5 }}
                >
                  {title}
                </motion.h3>
                <motion.p
                  className="text-sm text-muted-foreground leading-relaxed"
                  initial={{ opacity: 0 }}
                  whileInView={{ opacity: 1 }}
                  viewport={{ once: false }}
                  transition={{ delay: index * 0.15 + 0.3, duration: 0.5 }}
                >
                  {description}
                </motion.p>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Mobile: Vertical stack */}
        <div className="md:hidden mx-auto max-w-md space-y-8">
          {steps.map(({ step, title, description }, index) => (
            <motion.div
              key={title}
              className="flex flex-col items-center text-center space-y-4"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: false, amount: 0.3 }}
              transition={{ delay: index * 0.15, duration: 0.5 }}
            >
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-accent via-accent/90 to-accent/70 shadow-lg">
                <span className="text-3xl font-bold text-white">{step}</span>
              </div>
              <h3 className="text-xl font-bold tracking-tight">{title}</h3>
              <p className="text-base text-muted-foreground leading-relaxed">
                {description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
