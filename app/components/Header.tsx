"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";
import BookCallButton from "./BookCallButton";
import Logo from "./VisionOpsLogo";

const navLinks = [
  { href: "/#offers", label: "Solutions" },
  { href: "/about", label: "About" },
  { href: "/insights", label: "Insights" },
  { href: "/press", label: "Press" },
  { href: "/faq", label: "FAQ" },
];

export default function Header() {
  const [isMobileNavOpen, setMobileNavOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <>
      <header
        className={cn(
          "fixed top-0 left-0 right-0 z-50 transition-all duration-300",
          isScrolled ? "px-8 md:px-32 lg:px-48 pt-2" : "px-4 pt-6",
        )}
      >
        <div
          className={cn(
            "mx-auto flex max-w-screen-xl items-center justify-between rounded-[6px] border border-[#e1e5eb] bg-[#fbfaf7]/94 backdrop-blur-md shadow-sm transition-all duration-300",
            isScrolled ? "px-4 py-1.5" : "px-5 py-3 md:px-8",
          )}
        >
          {/* Logo */}
          <Link
            href="/"
            className="flex items-center gap-2 shrink-0"
            aria-label="Acuity Health home"
          >
            <Logo />
            <span className="text-sm font-semibold tracking-tight text-[#101820]">
              Acuity Health
            </span>
          </Link>

          {/* Desktop nav - centered with even spacing */}
          <nav className="hidden md:flex items-center justify-center flex-1">
            <div className="flex items-center gap-10">
              {navLinks.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className="text-sm font-normal text-[#586372] transition-colors hover:text-[#101820]"
                >
                  {label}
                </Link>
              ))}
            </div>
          </nav>

          {/* CTA */}
          <div className="flex items-center gap-2 shrink-0">
            <BookCallButton
              variant="secondary"
              size="sm"
              iconVariant="none"
              className="marketing-cta hidden rounded-[4px] border-[#d4dae3] bg-white px-3.5 text-[11px] font-medium tracking-[0.11em] text-[#172033] shadow-sm hover:bg-[#f7f8fb] md:inline-flex"
            >
              Book a Demo
            </BookCallButton>

            <Button
              variant="default"
              size="sm"
              className="marketing-cta hidden rounded-[4px] bg-[#172033] px-3.5 text-[11px] font-medium tracking-[0.11em] hover:bg-[#22304a] md:inline-flex"
              asChild
            >
              <Link href="/portal">Practice Portal</Link>
            </Button>

            {/* Mobile menu button */}
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 rounded-[4px] border border-[#e1e5eb] bg-white text-[#101820] shadow-sm md:hidden"
              onClick={() => setMobileNavOpen(!isMobileNavOpen)}
              aria-label="Toggle navigation"
            >
              {isMobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>

        {/* Mobile nav - fullscreen overlay */}
        {isMobileNavOpen && (
          <div className="fixed inset-0 z-40 bg-[#fbfaf7] md:hidden">
            <div className="flex min-h-full flex-col items-center justify-center gap-8 bg-[#fbfaf7] px-6 py-8">
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="absolute right-6 top-6 flex h-10 w-10 items-center justify-center rounded-[4px] border border-[#e1e5eb] bg-white text-[#101820] shadow-sm"
                aria-label="Close navigation"
              >
                <X className="h-5 w-5" />
              </button>
              <nav className="flex flex-col items-center space-y-6">
                {navLinks.map(({ href, label }) => (
                  <Link
                    key={href}
                    href={href}
                    className="text-2xl font-normal text-[#101820]/80 transition-colors hover:text-[#101820]"
                    onClick={() => setMobileNavOpen(false)}
                  >
                    {label}
                  </Link>
                ))}
                <div className="mt-4 flex w-full max-w-xs flex-col gap-3">
                  <BookCallButton
                    variant="secondary"
                    size="lg"
                    iconVariant="none"
                    className="marketing-cta w-full rounded-[4px] border-[#d4dae3] bg-white text-[12px] tracking-[0.11em] text-[#172033] shadow-sm hover:bg-[#f7f8fb]"
                  >
                    Book a Demo
                  </BookCallButton>
                  <Button
                    variant="default"
                    size="lg"
                    className="marketing-cta w-full rounded-[4px] bg-[#172033] text-[12px] tracking-[0.11em] hover:bg-[#22304a]"
                    asChild
                  >
                    <Link href="/portal" onClick={() => setMobileNavOpen(false)}>
                      Practice Portal
                    </Link>
                  </Button>
                </div>
              </nav>
            </div>
          </div>
        )}
      </header>
    </>
  );
}
