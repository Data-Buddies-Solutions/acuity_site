"use client";

import { Shield, Stethoscope, Users } from "lucide-react";

const features = [
  {
    icon: Shield,
    title: "HIPAA compliant",
    description: "We hold partnership agreements with AI providers ensuring patient data is never used for model training. For practices that need it, we build custom AI models for on-premise deployment.",
  },
  {
    icon: Stethoscope,
    title: "Built for medical teams",
    description: "We only work with healthcare practices. Every system we build is designed around how medical offices actually operate, from insurance rules to EMR workflows.",
  },
  {
    icon: Users,
    title: "White-glove setup",
    description: "We handle everything from configuration to go-live. Your team gets a fully working system without needing any technical expertise.",
  },
];

export default function WhoWeAre() {
  return (
    <section className="py-20 md:py-28 bg-background" id="about">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Left - Content */}
          <div>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-6">
              About Acuity Health
            </h2>
            <p className="text-lg text-muted-foreground leading-relaxed">
              We're an AI consulting firm that helps medical practices adopt AI through custom-built agents. We combine deep AI expertise with a focused understanding of practice operations.
            </p>
          </div>

          {/* Right - Features */}
          <div className="space-y-6">
            {features.map((feature) => (
              <div key={feature.title} className="flex gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                  <feature.icon className="w-5 h-5 text-foreground" />
                </div>
                <div>
                  <h3 className="font-semibold mb-1">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground">{feature.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
