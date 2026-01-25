"use client";

import { Shield, Stethoscope, Users } from "lucide-react";

const features = [
  {
    icon: Stethoscope,
    title: "Healthcare focused",
    description: "We specialize in medical practices, from eyecare to primary care and beyond.",
  },
  {
    icon: Shield,
    title: "HIPAA compliant",
    description: "All solutions meet strict healthcare privacy and security requirements.",
  },
  {
    icon: Users,
    title: "Hands-on team",
    description: "Work directly with the engineers and consultants who build your agents.",
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
              About Data Buddies Solutions
            </h2>
            <p className="text-lg text-muted-foreground mb-6 leading-relaxed">
              We're an AI consulting firm that helps medical practices adopt AI through custom-built agents. We combine deep AI expertise with a focused understanding of practice operations.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              Every practice is different. We work closely with you to understand your workflows, identify the right opportunities for AI, and build agents that fit how your team already works.
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
