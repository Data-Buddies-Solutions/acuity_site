"use client";

import { motion } from "framer-motion";

export default function HexagonLogo() {
  // Calculate positions for 6 circles in a hexagon pattern
  const hexagonCircles = Array.from({ length: 6 }, (_, i) => {
    const angle = (i * 60 * Math.PI) / 180 - Math.PI / 2; // Start from top
    const radius = 22; // Distance from center (smaller for logo)
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    };
  });

  return (
    <div className="relative w-12 h-12 flex items-center justify-center">
      <svg
        width="48"
        height="48"
        viewBox="-30 -30 60 60"
        className="w-full h-full"
      >
        <g>
          {/* 6 circles forming hexagon pattern - animate in from center */}
          {hexagonCircles.map((pos, i) => (
            <motion.circle
              key={i}
              cx={pos.x}
              cy={pos.y}
              r="5"
              fill="#cc6633"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{
                duration: 0.4,
                delay: i * 0.08,
                ease: "backOut",
              }}
            />
          ))}

          {/* Center circle - appears last */}
          <motion.circle
            cx="0"
            cy="0"
            r="5"
            fill="#cc6633"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{
              duration: 0.5,
              delay: 0.48,
              ease: "backOut",
            }}
          />
        </g>
      </svg>
    </div>
  );
}
