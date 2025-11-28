"use client";

import { Badge } from "./ui/badge";
import { motion } from "framer-motion";
import Image from "next/image";
import { useState } from "react";

const useCases = [
  {
    id: "appointment-scheduling",
    title: "Appointment Scheduling",
    description: "Answer calls and book appointments automatically",
    image: "/Customer with transcript.png",
  },
  {
    id: "reports-analytics",
    title: "Reports & Analytics",
    description: "Get insights without digging through data",
    image: "/Reports & Anyltics.png",
  },
  {
    id: "customer-support",
    title: "Customer Support",
    description: "Answer common questions instantly, 24/7",
    image: "/customersupport with icon .png",
  },
];

export default function HowAgentsWork() {
  const [activeTab, setActiveTab] = useState("appointment-scheduling");
  const activeUseCase = useCases.find(uc => uc.id === activeTab) || useCases[0];

  return (
    <section className="relative py-16 md:py-20 overflow-hidden bg-muted/30" id="how-agents-work">
      <div className="mx-auto max-w-7xl px-6 md:px-10">
        {/* Title */}
        <h2 className="text-3xl font-bold tracking-tighter md:text-4xl lg:text-5xl mb-24 text-center">
          How Your Data Buddy Helps
        </h2>

        {/* Tab buttons */}
        <div className="mx-auto max-w-5xl mb-10">
          <div className="inline-flex gap-1 p-0.5 bg-muted/50 rounded-lg">
            {useCases.map((useCase) => (
              <button
                key={useCase.id}
                onClick={() => setActiveTab(useCase.id)}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                  activeTab === useCase.id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {useCase.title}
              </button>
            ))}
          </div>
        </div>

        {/* Large showcase image */}
        <motion.div
          key={activeTab}
          className="relative mx-auto max-w-5xl"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        >
          {/* Subtle glow effect */}
          <div className="absolute inset-0 bg-gradient-to-br from-accent/20 via-accent/10 to-transparent blur-3xl -z-10 scale-110" />

          <div className="relative rounded-2xl overflow-hidden shadow-2xl ring-1 ring-border/50">
            <Image
              src={activeUseCase.image}
              alt={activeUseCase.title}
              width={1400}
              height={900}
              className="w-full h-auto"
              priority
            />
          </div>

          {/* Description below image */}
          <div className="mt-8 text-center">
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              {activeUseCase.description}
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
