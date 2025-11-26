"use client";

import { Badge } from "./ui/badge";
import { motion } from "framer-motion";
import { MessageSquare, Calendar, BarChart3, FileText, Mail, ShoppingCart } from "lucide-react";

const useCases = [
  {
    icon: MessageSquare,
    title: "Customer Support",
    description: "Answer common questions instantly, 24/7",
    example: "A customer asks 'What are your business hours?' Your AI buddy responds immediately with accurate info.",
    color: "from-white/10 to-white/5",
  },
  {
    icon: Calendar,
    title: "Appointment Scheduling",
    description: "Answer calls and book appointments automatically",
    example: "A patient calls to schedule an appointment. Your AI voice agent answers, checks availability, and books them in—all without staff picking up the phone.",
    color: "from-white/10 to-white/5",
  },
  {
    icon: ShoppingCart,
    title: "Order Processing",
    description: "Handle orders from start to finish",
    example: "A new order comes in. Your AI enters it in your system, updates inventory, and sends confirmation.",
    color: "from-white/10 to-white/5",
  },
  {
    icon: FileText,
    title: "Data Entry",
    description: "Move information between your tools",
    example: "Invoice arrives via email. Your AI reads it, extracts the details, and logs everything in your accounting software.",
    color: "from-white/10 to-white/5",
  },
  {
    icon: BarChart3,
    title: "Reports & Analytics",
    description: "Get insights without digging through data",
    example: "Every Monday, your AI sends you a summary of last week's sales, top products, and customer trends.",
    color: "from-white/10 to-white/5",
  },
  {
    icon: Mail,
    title: "Email Management",
    description: "Sort, respond, and follow up on emails",
    example: "Customer emails with a refund request. Your AI categorizes it, drafts a response, and flags it for review.",
    color: "from-white/10 to-white/5",
  },
];

export default function HowAgentsWork() {
  return (
    <section className="border-b py-20 md:py-32 bg-muted/50" id="how-agents-work">
      <div className="mx-auto max-w-7xl px-6 md:px-10">
        <div className="mx-auto mb-16 md:mb-20 max-w-3xl space-y-6 text-center">
          <Badge variant="outline" className="backdrop-blur-sm bg-background/60 border-border text-sm font-medium uppercase tracking-tight">
            What AI assistants can do
          </Badge>
          <h2 className="text-4xl font-bold tracking-tighter md:text-5xl lg:text-6xl">
            How Your <span className="text-accent">Data Buddy</span> Helps
          </h2>
          <p className="text-xl text-muted-foreground md:text-2xl">
            Think of an AI assistant like a super-smart secretary who never sleeps, never makes mistakes, and can handle dozens of tasks at once
          </p>
        </div>

        <div className="mx-auto grid max-w-6xl gap-8 md:grid-cols-2 lg:grid-cols-3">
          {useCases.map((useCase, index) => (
            <motion.div
              key={useCase.title}
              className="group relative overflow-hidden rounded-2xl border border-border/50 bg-background/80 backdrop-blur-sm p-6 hover:bg-muted hover:border-accent/30 transition-all duration-300"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ delay: index * 0.2, duration: 0.7, ease: "easeOut" }}
              whileHover={{ scale: 1.02 }}
            >
              {/* Gradient background */}
              <div className={`absolute inset-0 bg-gradient-to-br ${useCase.color} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />

              <div className="relative space-y-4">
                {/* Icon */}
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 border border-accent/20">
                  <useCase.icon className="h-6 w-6 text-accent" aria-hidden />
                </div>

                {/* Title */}
                <h3 className="text-xl font-bold tracking-tight">{useCase.title}</h3>

                {/* Description */}
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {useCase.description}
                </p>

                {/* Example */}
                <div className="pt-2 border-t border-border/50">
                  <p className="text-xs text-muted-foreground italic leading-relaxed">
                    <span className="text-accent font-semibold not-italic">Example:</span> {useCase.example}
                  </p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Bottom explainer */}
        <div className="mx-auto mt-16 max-w-3xl text-center">
          <p className="text-base text-muted-foreground leading-relaxed">
            These are just examples. We build custom AI assistants for whatever repetitive work is slowing down your business. If you're doing it more than once a week, we can probably automate it.
          </p>
        </div>
      </div>
    </section>
  );
}
