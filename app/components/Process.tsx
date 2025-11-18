"use client";

import { Badge } from "./ui/badge";
import { motion } from "framer-motion";

const steps = [
  {
    step: "1",
    title: "Understand & plan",
    description:
      "We identify bottlenecks and map AI opportunities specific to your business.",
  },
  {
    step: "2",
    title: "Build & test",
    description:
      "We rapidly prototype solutions and iterate based on your feedback.",
  },
  {
    step: "3",
    title: "Launch & coach",
    description:
      "We deploy the solution and train your team for seamless adoption.",
  },
  {
    step: "4",
    title: "Tune & grow",
    description:
      "We monitor performance and scale with new automations as you grow.",
  },
];

export default function Process() {
  return (
    <section className="border-b py-20 md:py-32" id="process">
      <div className="mx-auto max-w-7xl px-6 md:px-10">
        <div className="mx-auto mb-16 md:mb-20 max-w-3xl space-y-6 text-center">
          <Badge variant="outline" className="backdrop-blur-sm bg-background/60 border-border text-sm font-medium uppercase tracking-tight">
            How it works
          </Badge>
          <h2 className="text-4xl font-bold tracking-tighter md:text-5xl lg:text-6xl">
            The Process
          </h2>
          <p className="text-xl text-muted-foreground md:text-2xl">
            From discovery to deployment in four simple steps
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
