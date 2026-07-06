"use client";

interface LogoProps {
  className?: string;
}

export default function Logo({ className = "text-[#1a1a1a]" }: LogoProps) {
  return (
    <div className={`flex items-center ${className}`}>
      <svg
        aria-hidden="true"
        focusable="false"
        width="24"
        height="24"
        viewBox="0 0 100 100"
        fill="none"
      >
        <circle cx="50" cy="15" r="11" fill="currentColor" />
        <circle cx="20" cy="35" r="11" fill="currentColor" />
        <circle cx="80" cy="35" r="11" fill="currentColor" />
        <circle cx="50" cy="50" r="11" fill="currentColor" />
        <circle cx="20" cy="65" r="11" fill="currentColor" />
        <circle cx="80" cy="65" r="11" fill="currentColor" />
        <circle cx="50" cy="85" r="11" fill="currentColor" />
      </svg>
    </div>
  );
}
