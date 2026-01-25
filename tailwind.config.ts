import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      container: {
        center: true,
        padding: "1.5rem",
        screens: {
          "2xl": "1200px",
        },
      },
      colors: {
        background: "#FFFFFF",
        "background-alt": "#FAFAFA",
        foreground: "#1D1D1D",
        border: "#E5E5E5",
        muted: "#FAFAFA",
        "muted-foreground": "#666666",
        accent: "#0D7377",
        "accent-hover": "#0A5C5F",
        gold: "#C9A227",
      },
      borderRadius: {
        lg: "12px",
        md: "8px",
        sm: "6px",
      },
      boxShadow: {
        sm: "0 1px 2px rgba(0, 0, 0, 0.04)",
        card: "0 2px 8px rgba(0, 0, 0, 0.04), 0 4px 16px rgba(0, 0, 0, 0.04)",
        lg: "0 4px 12px rgba(0, 0, 0, 0.05), 0 8px 24px rgba(0, 0, 0, 0.05)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [animate],
};
export default config;
