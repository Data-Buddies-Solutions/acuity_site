"use client";

import { Badge } from "./ui/badge";
import { motion } from "framer-motion";
import Image from "next/image";
import { useState } from "react";

export default function WhoWeAre() {
  const [activeView, setActiveView] = useState<"voice" | "email">("voice");
  return (
    <section className="py-20 md:py-32 bg-gradient-to-b from-background via-muted/20 to-background" id="who-we-are">
      <div className="mx-auto max-w-7xl px-6 md:px-10">
        <div className="space-y-12">
          {/* Title */}
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold tracking-tighter md:text-5xl lg:text-6xl">
              Your Data Buddy in Action
            </h2>
          </div>

          {/* Left-aligned toggle buttons */}
          <div className="flex justify-start">
            <div className="inline-flex gap-1 p-1 bg-background/80 rounded-lg border border-border/50 backdrop-blur-sm">
              <button
                onClick={() => setActiveView("voice")}
                className={`px-5 py-2.5 rounded-md text-sm font-medium transition-all ${
                  activeView === "voice"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Voice Agent
              </button>
              <button
                onClick={() => setActiveView("email")}
                className={`px-5 py-2.5 rounded-md text-sm font-medium transition-all ${
                  activeView === "email"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Email Management
              </button>
            </div>
          </div>

          {/* Content area */}
          <motion.div
            className="relative"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.7, ease: "easeOut" }}
          >
            <div className="relative rounded-3xl overflow-hidden border border-border/50 bg-gradient-to-br from-muted/50 via-muted/30 to-background/50 backdrop-blur-sm p-8 md:p-12 lg:p-16">

              <div className="space-y-6">
                {activeView === "voice" ? (
                  <>
                    <div className="space-y-3">
                      <div className="text-sm font-semibold text-accent uppercase tracking-tight">AI Voice Agent</div>
                      <div className="text-2xl font-bold">Answering Calls for a Doctor Office</div>
                    </div>

                    {/* Phone call interface */}
                    <div className="space-y-6">
                  {/* Call status */}
                  <div className="flex items-center justify-between p-4 bg-accent/10 rounded-xl border border-accent/20">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full bg-accent animate-pulse"></div>
                      <span className="text-sm font-semibold">Incoming Call: (555) 123-4567</span>
                    </div>
                    <span className="text-xs text-muted-foreground">00:47</span>
                  </div>

                  {/* Transcript */}
                  <div className="space-y-4 p-4 bg-background/50 rounded-xl border border-border/30">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-tight">Live Transcript</div>

                    <div className="space-y-3">
                      <div className="flex gap-2">
                        <span className="text-accent font-semibold text-sm">AI:</span>
                        <p className="text-sm">Good morning! This is Bright Smile Dental. How can I help you today?</p>
                      </div>

                      <div className="flex gap-2">
                        <span className="font-semibold text-sm">Caller:</span>
                        <p className="text-sm">Hi, I need to schedule a cleaning appointment.</p>
                      </div>

                      <div className="flex gap-2">
                        <span className="text-accent font-semibold text-sm">AI:</span>
                        <p className="text-sm">I'd be happy to help you schedule a cleaning. Can I get your name please?</p>
                      </div>

                      <div className="flex gap-2">
                        <span className="font-semibold text-sm">Caller:</span>
                        <p className="text-sm">Sarah Johnson</p>
                      </div>

                      <div className="flex gap-2">
                        <span className="text-accent font-semibold text-sm">AI:</span>
                        <p className="text-sm">Thank you, Sarah. I have availability next Tuesday at 2 PM or Wednesday at 10 AM. Which works better for you?</p>
                      </div>
                    </div>
                  </div>

                      {/* Actions being performed */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="p-3 bg-accent/5 rounded-lg border border-accent/10">
                          <div className="text-xs text-accent font-semibold mb-1">✓ Checking Calendar</div>
                          <div className="text-xs text-muted-foreground">Real-time availability</div>
                        </div>
                        <div className="p-3 bg-accent/5 rounded-lg border border-accent/10">
                          <div className="text-xs text-accent font-semibold mb-1">✓ Patient Lookup</div>
                          <div className="text-xs text-muted-foreground">Existing records found</div>
                        </div>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-border/30">
                      <div className="text-xs text-muted-foreground italic">
                        Sounds natural, books appointments, updates your calendar—all without staff lifting a finger
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="space-y-3">
                      <div className="text-sm font-semibold text-accent uppercase tracking-tight">AI Email Assistant</div>
                      <div className="text-2xl font-bold">Sorting & Responding to Inquiries</div>
                    </div>

                    {/* Email inbox interface */}
                    <div className="space-y-4">
                      {/* Inbox header */}
                      <div className="flex items-center justify-between p-3 bg-background/50 rounded-xl border border-border/30">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">Inbox</span>
                          <span className="text-xs text-muted-foreground">(47 unread)</span>
                        </div>
                        <div className="text-xs text-accent font-semibold">AI Processing...</div>
                      </div>

                      {/* Email items */}
                      <div className="space-y-2">
                        {/* Email 1 - Support request */}
                        <div className="p-4 bg-accent/5 rounded-xl border border-accent/20">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex-1">
                              <div className="text-sm font-semibold">Sarah M. - Product Question</div>
                              <div className="text-xs text-muted-foreground">2 minutes ago</div>
                            </div>
                            <div className="px-2 py-1 bg-accent/20 rounded text-xs font-semibold text-accent">Support</div>
                          </div>
                          <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
                            "Hi, I'm interested in your premium plan. Does it include...?"
                          </p>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-accent font-semibold">✓ AI Drafted Response</span>
                            <span className="text-muted-foreground">• Ready for review</span>
                          </div>
                        </div>

                        {/* Email 2 - Refund */}
                        <div className="p-4 bg-accent/5 rounded-xl border border-accent/20">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex-1">
                              <div className="text-sm font-semibold">John D. - Refund Request</div>
                              <div className="text-xs text-muted-foreground">5 minutes ago</div>
                            </div>
                            <div className="px-2 py-1 bg-orange-500/20 rounded text-xs font-semibold text-orange-500">Priority</div>
                          </div>
                          <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
                            "I'd like to request a refund for order #4521..."
                          </p>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-accent font-semibold">✓ Flagged for Review</span>
                            <span className="text-muted-foreground">• Escalated to team</span>
                          </div>
                        </div>

                        {/* Email 3 - Sales inquiry */}
                        <div className="p-4 bg-accent/5 rounded-xl border border-accent/20">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex-1">
                              <div className="text-sm font-semibold">Lisa K. - Enterprise Inquiry</div>
                              <div className="text-xs text-muted-foreground">12 minutes ago</div>
                            </div>
                            <div className="px-2 py-1 bg-accent/20 rounded text-xs font-semibold text-accent">Sales Lead</div>
                          </div>
                          <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
                            "We're a 200-person company looking for automation..."
                          </p>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-accent font-semibold">✓ Added to CRM</span>
                            <span className="text-muted-foreground">• Notification sent to sales</span>
                          </div>
                        </div>
                      </div>

                      {/* Stats */}
                      <div className="grid grid-cols-3 gap-2 pt-2">
                        <div className="p-2 bg-background/50 rounded-lg border border-border/30 text-center">
                          <div className="text-lg font-bold text-accent">32</div>
                          <div className="text-xs text-muted-foreground">Auto-replied</div>
                        </div>
                        <div className="p-2 bg-background/50 rounded-lg border border-border/30 text-center">
                          <div className="text-lg font-bold text-accent">12</div>
                          <div className="text-xs text-muted-foreground">Categorized</div>
                        </div>
                        <div className="p-2 bg-background/50 rounded-lg border border-border/30 text-center">
                          <div className="text-lg font-bold text-accent">3</div>
                          <div className="text-xs text-muted-foreground">Escalated</div>
                        </div>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-border/30">
                      <div className="text-xs text-muted-foreground italic">
                        Categorizes, drafts responses, flags urgent items—your inbox managed in real-time
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
