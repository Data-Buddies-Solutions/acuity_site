"use client";

import { motion } from "framer-motion";

export default function HexagonAnimation() {
  // Calculate positions for 6 circles in a hexagon pattern
  // Hexagon vertices (circles at each point)
  const hexagonCircles = Array.from({ length: 6 }, (_, i) => {
    const angle = (i * 60 * Math.PI) / 180 - Math.PI / 2; // Start from top
    const radius = 80; // Distance from center
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    };
  });

  return (
    <div className="flex items-center justify-center w-full h-full min-h-[500px]">
      <svg
        width="400"
        height="400"
        viewBox="-150 -150 300 300"
        className="w-full h-full"
      >
        {/* Rotating outer group */}
        <motion.g
          animate={{
            rotate: 360,
          }}
          transition={{
            duration: 20,
            repeat: Infinity,
            ease: "linear",
          }}
        >
          {/* 6 circles forming hexagon pattern */}
          {hexagonCircles.map((pos, i) => (
            <motion.circle
              key={i}
              cx={pos.x}
              cy={pos.y}
              r="28"
              fill="white"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: [0, 1, 1], opacity: [0, 1, 1] }}
              transition={{
                duration: 0.5,
                delay: i * 0.1,
                ease: "backOut",
              }}
            />
          ))}
        </motion.g>

        {/* Center circle - static, appears last */}
        <motion.circle
          cx="0"
          cy="0"
          r="28"
          fill="white"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{
            duration: 0.6,
            delay: 0.6,
            ease: "backOut",
          }}
        />
      </svg>
    </div>
  );
}
