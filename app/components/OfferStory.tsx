"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";

const spokes = [
  {
    id: "call-center",
    label: "Call Center",
    description:
      "Browser VoIP with warm transfers, live call summaries, and missed-call recaps the front desk can act on.",
  },
  {
    id: "tasking",
    label: "Tasking",
    description:
      "Every call generates structured follow-up, routed to the right person.",
  },
  {
    id: "texting",
    label: "Two-way Texting",
    description:
      "Acuity drafts replies, confirms appointments, and re-books patients over SMS — staff steps in only when needed.",
  },
  {
    id: "analytics",
    label: "Analytics",
    description:
      "Call volume, booking outcomes, and after-hours capture across locations.",
  },
] as const;

export default function OfferStory() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.25, once: true });

  return (
    <section className="bg-[#f7fbfb] py-24 md:py-32" id="offers">
      <div ref={ref} className="mx-auto max-w-6xl px-4 md:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-accent">
            The platform
          </p>
          <h2 className="mt-5 text-4xl font-semibold leading-[1.05] tracking-[-0.02em] md:text-5xl lg:text-[3.5rem] [text-wrap:balance]">
            One AI front desk, end to end.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
            Watch a single call move through the platform.
          </p>
        </div>

        {/* Desktop: hub-and-spoke diagram */}
        <div className="mt-20 hidden lg:block">
          <HubSpokeDiagram inView={inView} />
        </div>

        {/* Mobile / tablet: vertical flow */}
        <div className="mt-16 lg:hidden">
          <VerticalFlow inView={inView} />
        </div>
      </div>
    </section>
  );
}

/* ─────────────────── Desktop diagram ─────────────────── */

function HubSpokeDiagram({ inView }: { inView: boolean }) {
  // Geometry (viewBox is stretched via preserveAspectRatio="none", so coords map
  // directly to the container percentage-wise). Cards live at the right edge in
  // a 4-row flex column; their vertical centers, in viewBox units, are computed
  // to match exactly: container height = 700, top/bottom padding = 0, 4 rows of
  // 160 with 20 gap → centers at 80, 260, 440, 620.
  const cardCenters = [80, 260, 440, 620];
  const hub = { cx: 440, cy: 350, r: 96 };
  const cardLeftX = 720; // matches `right-0 w-72` cards in a max-w-5xl container

  const arrows = cardCenters.map((cy) => {
    const dx = cardLeftX - hub.cx;
    const dy = cy - hub.cy;
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    return {
      x1: hub.cx + ux * (hub.r + 4),
      y1: hub.cy + uy * (hub.r + 4),
      x2: cardLeftX - 6,
      y2: cy,
    };
  });

  return (
    <div
      className="relative mx-auto w-full max-w-5xl"
      style={{ aspectRatio: "1000 / 700" }}
    >
      {/* SVG arrows layer */}
      <svg
        aria-hidden="true"
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="none"
        viewBox="0 0 1000 700"
      >
        <defs>
          <marker
            id="arrow-accent"
            markerHeight="7"
            markerWidth="7"
            orient="auto-start-reverse"
            refX="5.5"
            refY="3.5"
            viewBox="0 0 7 7"
          >
            <path d="M0 0 L7 3.5 L0 7 Z" fill="#3fc4b0" />
          </marker>
          <marker
            id="arrow-muted"
            markerHeight="7"
            markerWidth="7"
            orient="auto-start-reverse"
            refX="5.5"
            refY="3.5"
            viewBox="0 0 7 7"
          >
            <path d="M0 0 L7 3.5 L0 7 Z" fill="#94a3a3" />
          </marker>
        </defs>

        {/* Inbound arrow */}
        <motion.line
          animate={inView ? { pathLength: 1, opacity: 1 } : {}}
          initial={{ pathLength: 0, opacity: 0 }}
          markerEnd="url(#arrow-muted)"
          stroke="#94a3a3"
          strokeDasharray="4 4"
          strokeWidth="1.5"
          transition={{ delay: 0.2, duration: 0.6, ease: "easeOut" }}
          x1={150}
          x2={hub.cx - hub.r - 6}
          y1={hub.cy}
          y2={hub.cy}
        />

        {/* Spoke arrows */}
        {arrows.map((a, i) => (
          <motion.line
            animate={inView ? { pathLength: 1, opacity: 1 } : {}}
            initial={{ pathLength: 0, opacity: 0 }}
            key={i}
            markerEnd="url(#arrow-accent)"
            stroke="#3fc4b0"
            strokeWidth="1.75"
            transition={{ delay: 0.7 + i * 0.12, duration: 0.5, ease: "easeOut" }}
            x1={a.x1}
            x2={a.x2}
            y1={a.y1}
            y2={a.y2}
          />
        ))}
      </svg>

      {/* Inbound label */}
      <motion.div
        animate={inView ? { opacity: 1, x: 0 } : { opacity: 0, x: -8 }}
        className="absolute left-0 top-1/2 -translate-y-1/2"
        initial={{ opacity: 0, x: -8 }}
        transition={{ delay: 0.05, duration: 0.5 }}
      >
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Inbound
        </p>
        <p className="mt-2 text-base font-semibold text-neutral-900">
          Patient calls
        </p>
        <p className="mt-1 text-xs text-muted-foreground">Any hour, any language</p>
      </motion.div>

      {/* Hub — centered at viewBox (440, 350) → 44% / 50% of container */}
      <div
        className="absolute -translate-x-1/2 -translate-y-1/2"
        style={{ left: "44%", top: "50%" }}
      >
        <motion.div
          animate={inView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.94 }}
          className="flex h-48 w-48 flex-col items-center justify-center rounded-full bg-white text-center shadow-[0_30px_80px_rgba(15,39,44,0.12)] ring-1 ring-neutral-200"
          initial={{ opacity: 0, scale: 0.94 }}
          transition={{ delay: 0.4, duration: 0.5, ease: "easeOut" }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-accent">
            Acuity
          </p>
          <p className="mt-2 text-xl font-semibold leading-tight tracking-tight text-neutral-900">
            AI Receptionist
          </p>
          <p className="mt-2 max-w-[10rem] text-[11px] leading-relaxed text-muted-foreground">
            Picks up, books, verifies — every call.
          </p>
        </motion.div>
      </div>

      {/* Spoke column — proportional width matches viewBox geometry above */}
      <div
        className="absolute inset-y-0 right-0 flex flex-col justify-between"
        style={{ width: "28%" }}
      >
        {spokes.map((s, i) => (
          <motion.div
            animate={inView ? { opacity: 1, x: 0 } : { opacity: 0, x: 12 }}
            className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-[0_18px_45px_rgba(15,39,44,0.06)]"
            initial={{ opacity: 0, x: 12 }}
            key={s.id}
            style={{ height: "22.857%" }}
            transition={{ delay: 0.95 + i * 0.12, duration: 0.5, ease: "easeOut" }}
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">
              Module
            </p>
            <p className="mt-1.5 text-[15px] font-semibold tracking-tight text-neutral-900">
              {s.label}
            </p>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
              {s.description}
            </p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────── Mobile flow ─────────────────── */

function VerticalFlow({ inView }: { inView: boolean }) {
  return (
    <div className="mx-auto max-w-md">
      {/* Inbound */}
      <motion.div
        animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
        className="text-center"
        initial={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.4 }}
      >
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Inbound
        </p>
        <p className="mt-1 text-base font-semibold text-neutral-900">Patient calls</p>
      </motion.div>

      {/* Arrow down */}
      <FlowArrow delay={0.2} inView={inView} />

      {/* Hub */}
      <motion.div
        animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
        className="mx-auto flex h-40 w-40 flex-col items-center justify-center rounded-full bg-white text-center shadow-[0_24px_60px_rgba(15,39,44,0.10)] ring-1 ring-neutral-200"
        initial={{ opacity: 0, y: 8 }}
        transition={{ delay: 0.35, duration: 0.45 }}
      >
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-accent">
          Acuity
        </p>
        <p className="mt-1.5 text-lg font-semibold leading-tight tracking-tight text-neutral-900">
          AI Receptionist
        </p>
        <p className="mt-1.5 max-w-[8.5rem] text-[10px] leading-relaxed text-muted-foreground">
          Picks up · books · verifies
        </p>
      </motion.div>

      {/* Branching arrow */}
      <div className="relative mx-auto my-4 flex h-12 w-full max-w-[280px] items-start justify-center">
        <motion.div
          animate={inView ? { scaleY: 1 } : { scaleY: 0 }}
          className="absolute left-1/2 top-0 h-6 w-px origin-top bg-accent"
          initial={{ scaleY: 0 }}
          transition={{ delay: 0.6, duration: 0.3 }}
        />
        <motion.div
          animate={inView ? { scaleX: 1 } : { scaleX: 0 }}
          className="absolute left-0 right-0 top-6 h-px origin-center bg-accent"
          initial={{ scaleX: 0 }}
          transition={{ delay: 0.75, duration: 0.4 }}
        />
        {[0, 33.33, 66.66, 100].map((pct, i) => (
          <motion.div
            animate={inView ? { scaleY: 1 } : { scaleY: 0 }}
            className="absolute top-6 h-6 w-px origin-top bg-accent"
            initial={{ scaleY: 0 }}
            key={i}
            style={{ left: `${pct}%` }}
            transition={{ delay: 0.9 + i * 0.05, duration: 0.3 }}
          />
        ))}
      </div>

      {/* Spokes as horizontally-scrollable cards on mobile, stacked on small */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {spokes.map((s, i) => (
          <motion.div
            animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
            className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-[0_12px_30px_rgba(15,39,44,0.05)]"
            initial={{ opacity: 0, y: 10 }}
            key={s.id}
            transition={{ delay: 1.05 + i * 0.08, duration: 0.45 }}
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">
              Module
            </p>
            <p className="mt-1.5 text-[15px] font-semibold tracking-tight text-neutral-900">
              {s.label}
            </p>
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              {s.description}
            </p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function FlowArrow({ delay, inView }: { delay: number; inView: boolean }) {
  return (
    <motion.div
      animate={inView ? { scaleY: 1, opacity: 1 } : { scaleY: 0, opacity: 0 }}
      className="mx-auto my-4 h-8 w-px origin-top bg-neutral-300"
      initial={{ scaleY: 0, opacity: 0 }}
      transition={{ delay, duration: 0.3 }}
    />
  );
}
