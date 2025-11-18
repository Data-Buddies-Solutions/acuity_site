"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useRef } from "react";

export default function HexagonAnimation() {
  const [showRobot, setShowRobot] = useState(false);
  const [isInView, setIsInView] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          // Reset animation when entering viewport
          setShowRobot(false);
          setIsInView(true);
        } else {
          // Component left viewport
          setIsInView(false);
        }
      },
      {
        threshold: 0.3, // Trigger when 30% of component is visible
      }
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => {
      if (containerRef.current) {
        observer.unobserve(containerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (isInView) {
      // After 2 seconds, morph into robot (smoother transition)
      const timer = setTimeout(() => {
        setShowRobot(true);
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [isInView]);

  // Calculate positions for 6 circles in a hexagon pattern
  const hexagonCircles = Array.from({ length: 6 }, (_, i) => {
    const angle = (i * 60 * Math.PI) / 180 - Math.PI / 2; // Start from top
    const radius = 80; // Distance from center
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    };
  });

  return (
    <div ref={containerRef} className="flex items-center justify-center w-full h-full min-h-[375px] relative">
      <svg
        width="300"
        height="300"
        viewBox="-175 -175 350 350"
        className="w-full h-full max-w-[300px]"
      >
        {/* Rotating outer group */}
        <motion.g
          animate={{
            rotate: 360,
          }}
          transition={{
            duration: 2,
            ease: "linear",
          }}
        >
          {/* 6 circles forming hexagon pattern - fly off in different directions */}
          {hexagonCircles.map((pos, i) => {
            // Calculate exit direction (fly outward from current position)
            const exitAngle = (i * 60 * Math.PI) / 180 - Math.PI / 2;
            const exitDistance = 500;
            return (
              <motion.circle
                key={i}
                cx={pos.x}
                cy={pos.y}
                r="28"
                fill="white"
                initial={{ scale: 0, opacity: 0 }}
                animate={
                  showRobot
                    ? {
                        cx: pos.x + Math.cos(exitAngle) * exitDistance,
                        cy: pos.y + Math.sin(exitAngle) * exitDistance,
                        opacity: 0,
                      }
                    : { scale: 1, opacity: 1 }
                }
                transition={
                  showRobot
                    ? {
                        duration: 0.8,
                        delay: i * 0.05,
                        ease: "easeInOut",
                      }
                    : {
                        duration: 0.5,
                        delay: i * 0.1,
                        ease: "backOut",
                      }
                }
              />
            );
          })}
        </motion.g>

        {/* Center circle - shrinks away */}
        <motion.circle
          cx="0"
          cy="0"
          r="28"
          fill="white"
          initial={{ scale: 0, opacity: 0 }}
          animate={
            showRobot
              ? { scale: 0, opacity: 0 }
              : { scale: 1, opacity: 1 }
          }
          transition={
            showRobot
              ? { duration: 0.6, ease: "easeIn" }
              : {
                  duration: 0.6,
                  delay: 0.6,
                  ease: "backOut",
                }
          }
        />
        {showRobot && (
          <>
            {/* Modern Robot Design */}
            {/* Body - main torso - flies in from bottom */}
            <motion.rect
              x="-55"
              y="-10"
              width="110"
              height="95"
              rx="20"
              fill="white"
              initial={{ y: 300, opacity: 0 }}
              animate={{ y: -10, opacity: 1 }}
              transition={{ delay: 0.4, type: "spring", stiffness: 120, damping: 15 }}
            />

            {/* Head - flies in from top */}
            <motion.rect
              x="-45"
              y="-80"
              width="90"
              height="65"
              rx="15"
              fill="white"
              initial={{ y: -300, opacity: 0 }}
              animate={{ y: -80, opacity: 1 }}
              transition={{ delay: 0.5, type: "spring", stiffness: 120, damping: 15 }}
            />

            {/* Visor/Eye panel */}
            <motion.rect
              x="-35"
              y="-60"
              width="70"
              height="25"
              rx="12"
              fill="#cc6633"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ delay: 0.5, type: "spring", stiffness: 200 }}
            />

            {/* Eyes - glowing effect */}
            <motion.circle
              cx="-15"
              cy="-47"
              r="6"
              fill="white"
              initial={{ scale: 0 }}
              animate={{ scale: [0, 1.2, 1] }}
              transition={{ delay: 0.6, duration: 0.4 }}
            />
            <motion.circle
              cx="15"
              cy="-47"
              r="6"
              fill="white"
              initial={{ scale: 0 }}
              animate={{ scale: [0, 1.2, 1] }}
              transition={{ delay: 0.6, duration: 0.4 }}
            />

            {/* Antenna with blinking light */}
            <motion.line
              x1="0"
              y1="-80"
              x2="0"
              y2="-100"
              stroke="white"
              strokeWidth="5"
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ delay: 0.7, duration: 0.3 }}
            />
            <motion.circle
              cx="0"
              cy="-100"
              r="8"
              fill="#cc6633"
              initial={{ scale: 0 }}
              animate={{ scale: [0, 1.3, 1] }}
              transition={{ delay: 0.8, duration: 0.4 }}
            />

            {/* Chest panel with details */}
            <motion.rect
              x="-25"
              y="15"
              width="50"
              height="45"
              rx="8"
              fill="#cc6633"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.6, type: "spring", stiffness: 200 }}
            />

            {/* Panel details - horizontal lines */}
            <motion.line
              x1="-18"
              y1="25"
              x2="18"
              y2="25"
              stroke="white"
              strokeWidth="2"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ delay: 0.9 }}
            />
            <motion.line
              x1="-18"
              y1="35"
              x2="18"
              y2="35"
              stroke="white"
              strokeWidth="2"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ delay: 0.95 }}
            />
            <motion.line
              x1="-18"
              y1="45"
              x2="18"
              y2="45"
              stroke="white"
              strokeWidth="2"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ delay: 1 }}
            />

            {/* Hands */}
            <motion.circle
              cx="-60"
              cy="68"
              r="7"
              fill="#cc6633"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.9 }}
            />
            <motion.circle
              cx="60"
              cy="68"
              r="7"
              fill="#cc6633"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.9 }}
            />


            {/* Legs/Base - fly in from bottom */}
            <motion.rect
              x="-32"
              y="90"
              width="22"
              height="45"
              rx="11"
              fill="white"
              initial={{ y: 300, opacity: 0 }}
              animate={{ y: 90, opacity: 1 }}
              transition={{ delay: 0.7, type: "spring", stiffness: 120, damping: 15 }}
            />
            <motion.rect
              x="10"
              y="90"
              width="22"
              height="45"
              rx="11"
              fill="white"
              initial={{ y: 300, opacity: 0 }}
              animate={{ y: 90, opacity: 1 }}
              transition={{ delay: 0.7, type: "spring", stiffness: 120, damping: 15 }}
            />

            {/* Feet */}
            <motion.rect
              x="-36"
              y="130"
              width="30"
              height="12"
              rx="6"
              fill="#cc6633"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.9 }}
            />
            <motion.rect
              x="6"
              y="130"
              width="30"
              height="12"
              rx="6"
              fill="#cc6633"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.9 }}
            />
          </>
        )}
      </svg>
    </div>
  );
}
