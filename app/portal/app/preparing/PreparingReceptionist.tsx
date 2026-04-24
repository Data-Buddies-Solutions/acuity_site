"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  motion,
  useAnimationFrame,
  useMotionValue,
} from "framer-motion";

const statusLines = [
  "Mapping locations and providers",
  "Organizing insurance rules",
  "Loading practice knowledge",
  "Preparing front desk handoffs",
] as const;

const redirectDelayMs = 7000;
const motionDurationMs = 7000;
const stageSize = 224;
const dotSize = 22;

const logoDots = [
  { x: 50, y: 26 },
  { x: 30, y: 40 },
  { x: 70, y: 40 },
  { x: 50, y: 50 },
  { x: 30, y: 60 },
  { x: 70, y: 60 },
  { x: 50, y: 74 },
] as const;

type Point = { x: number; y: number };
type LogoDot = (typeof logoDots)[number];

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(edgeStart: number, edgeEnd: number, value: number) {
  const progress = clamp((value - edgeStart) / (edgeEnd - edgeStart));

  return progress * progress * (3 - 2 * progress);
}

function mix(start: number, end: number, amount: number) {
  return start + (end - start) * amount;
}

function toStagePosition(point: Point) {
  return {
    x: (point.x / 100) * stageSize - dotSize / 2,
    y: (point.y / 100) * stageSize - dotSize / 2,
  };
}

function LivingLogoDot({ home, index }: { home: LogoDot; index: number }) {
  const initialPosition = toStagePosition(home);
  const x = useMotionValue(initialPosition.x);
  const y = useMotionValue(initialPosition.y);
  const scale = useMotionValue(1);
  const opacity = useMotionValue(1);

  useAnimationFrame((time) => {
    const cycleProgress = (time % motionDurationMs) / motionDurationMs;
    const turn = cycleProgress * Math.PI * 2;
    const wakeIn = smoothstep(0.01, 0.08, cycleProgress);
    const waveIn = smoothstep(0.1, 0.25, cycleProgress);
    const reformIn = smoothstep(0.74, 0.97, cycleProgress);
    const openingProgress = clamp(cycleProgress / 0.18);
    const openingBreath =
      Math.sin(openingProgress * Math.PI) * (1 - waveIn) * (1 - reformIn);
    const phase = (index / logoDots.length) * Math.PI * 2;
    const wakeWeight =
      Math.max(openingBreath, wakeIn * (1 - waveIn)) * (1 - reformIn);
    const wake = {
      x: mix(home.x, 50, openingBreath * 0.16),
      y:
        mix(home.y, 50, openingBreath * 0.1) -
        openingBreath * 2.2 +
        Math.sin(index * 0.9) * openingBreath * 0.8,
    };
    const voiceLevel =
      0.58 +
      Math.sin(turn * 2.2) * 0.18 +
      Math.sin(turn * 5.7 + index) * 0.12;
    const waveAmplitude = 19 + voiceLevel * 12;
    const wave = {
      x: 15.5 + index * 11.5 + Math.sin(turn * 3.3 + phase) * 2.5,
      y:
        50 +
        Math.sin(turn * 4.15 + index * 0.86) * waveAmplitude +
        Math.sin(turn * 9.5 + phase) * 3.8,
    };
    const wavedPoint = {
      x: mix(wake.x, wave.x, waveIn),
      y: mix(wake.y, wave.y, waveIn),
    };
    const settle =
      Math.sin(clamp((cycleProgress - 0.78) / 0.19) * Math.PI) *
      reformIn *
      (1 - reformIn) *
      5;
    const point = {
      x: mix(wavedPoint.x, home.x, reformIn),
      y: mix(wavedPoint.y, home.y - settle, reformIn),
    };
    const liveWeight = Math.max(wakeWeight, waveIn * (1 - reformIn));
    const waveScale =
      0.76 + Math.abs(Math.sin(turn * 4.15 + index * 0.86)) * 0.32;
    const openingScale = 1 + openingBreath * 0.05;
    const scaleTarget = mix(openingScale, waveScale, waveIn);
    const stagePosition = toStagePosition(point);

    x.set(stagePosition.x);
    y.set(stagePosition.y);
    scale.set(mix(1, scaleTarget, liveWeight));
    opacity.set(
      mix(1, 0.9 + Math.sin(turn * 4.4 + index) * 0.06, liveWeight)
    );
  });

  return (
    <motion.span
      className="absolute left-0 top-0 h-[22px] w-[22px] rounded-full bg-[#151515] shadow-[0_18px_45px_rgba(0,0,0,0.16)] will-change-transform"
      style={{ x, y, scale, opacity }}
    />
  );
}

export default function PreparingReceptionist() {
  const router = useRouter();
  const [statusIndex, setStatusIndex] = useState(0);

  useEffect(() => {
    const statusTimer = window.setInterval(() => {
      setStatusIndex((current) => (current + 1) % statusLines.length);
    }, 1450);
    const redirectTimer = window.setTimeout(() => {
      router.replace("/portal/app/overview");
    }, redirectDelayMs);

    return () => {
      window.clearInterval(statusTimer);
      window.clearTimeout(redirectTimer);
    };
  }, [router]);

  return (
    <section className="relative min-h-screen overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(13,115,119,0.10),transparent_30%),linear-gradient(180deg,#f8fbfa_0%,#eef5f3_52%,#ffffff_100%)]" />
      <div className="relative mx-auto flex min-h-screen max-w-4xl flex-col items-center justify-center px-4 py-16 text-center md:px-6">
        <div
          aria-hidden="true"
          className="relative h-64 w-64 overflow-visible animate-[acuity-mark-float_4.8s_ease-in-out_infinite]"
        >
          <div className="absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 overflow-visible">
            {logoDots.map((home, index) => (
              <LivingLogoDot key={index} home={home} index={index} />
            ))}
          </div>
        </div>

        <p className="mt-10 text-sm font-medium uppercase tracking-[0.18em] text-[#6a7b7e]">
          Preparing Workspace
        </p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-[0.98] tracking-[-0.05em] text-[#10272c] md:text-6xl">
          Training your AI receptionist on how your practice works.
        </h1>
        <p className="mt-5 min-h-7 text-base font-medium text-[#0d7377] md:text-lg">
          {statusLines[statusIndex]}
        </p>

        <div className="mt-8 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-[#dfe9e7]">
          <div className="h-full rounded-full bg-[#0d7377] animate-[acuity-progress_7s_ease-in-out_forwards]" />
        </div>
      </div>

      <style jsx>{`
        @keyframes acuity-mark-float {
          0%,
          100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-8px);
          }
        }

        @keyframes acuity-progress {
          0% {
            width: 12%;
          }
          45% {
            width: 62%;
          }
          100% {
            width: 100%;
          }
        }
      `}</style>
    </section>
  );
}
