"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useInView } from "framer-motion";
import { useRef } from "react";

export default function AnimatedLogo() {
  const ref = useRef(null);
  const isInView = useInView(ref, { amount: 0.5 });
  const [animationKey, setAnimationKey] = useState(0);

  useEffect(() => {
    if (isInView) {
      // Reset animation when component comes into view
      setAnimationKey((prev) => prev + 1);
    }
  }, [isInView]);
  // Logo positions (hexagon pattern) - starting point
  const logoPositions = [
    { x: 200, y: 120 },    // Top
    { x: 269, y: 160 },    // Top-right
    { x: 269, y: 240 },    // Bottom-right
    { x: 200, y: 280 },    // Bottom
    { x: 131, y: 240 },    // Bottom-left
    { x: 131, y: 160 },    // Top-left
    { x: 200, y: 200 },    // Center
  ];

  // Scattered positions - where nodes drift to (farther apart)
  const scatteredPositions = [
    { x: 50, y: 80 },
    { x: 250, y: 50 },
    { x: 350, y: 120 },
    { x: 320, y: 300 },
    { x: 120, y: 350 },
    { x: 30, y: 260 },
    { x: 140, y: 160 },  // Center also moves
  ];

  return (
    <div ref={ref} className="relative w-full h-full flex items-center justify-center">
      <svg
        viewBox="0 0 400 400"
        className="w-full h-full"
        style={{ maxWidth: "500px", maxHeight: "500px" }}
      >
        {/* Circles - animate from scattered to logo, then stop */}
        {logoPositions.map((logoPos, index) => {
          const scatterPos = scatteredPositions[index];

          return (
            <motion.circle
              key={`${animationKey}-${index}`}
              r="12"
              fill="white"
              initial={{ cx: scatterPos.x, cy: scatterPos.y }}
              animate={{
                cx: logoPos.x,
                cy: logoPos.y,
              }}
              transition={{
                duration: 2.5,
                delay: index * 0.1,
                ease: [0.43, 0.13, 0.23, 0.96],
              }}
            >
              <animate
                attributeName="opacity"
                values="0.8;1;0.8"
                dur="3s"
                repeatCount="indefinite"
              />
            </motion.circle>
          );
        })}
      </svg>
    </div>
  );
}
