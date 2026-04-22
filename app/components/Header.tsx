"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";
import BookCallButton from "./BookCallButton";
import Logo from "./VisionOpsLogo";

const navLinks = [
  { href: "/#how-it-works", label: "How It Works" },
  { href: "/#offers", label: "Solutions" },
  { href: "/#results", label: "Results" },
  { href: "/faq", label: "FAQ" },
  { href: "/insights", label: "Insights" },
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
          isScrolled ? "px-8 md:px-32 lg:px-48 pt-2" : "px-4 pt-6"
        )}
      >
      <div
        className={cn(
          "mx-auto flex max-w-screen-xl items-center justify-between rounded-full border border-stone-200 bg-stone-50/90 backdrop-blur-md shadow-sm transition-all duration-300",
          isScrolled ? "px-4 py-1.5" : "px-8 py-3"
        )}
      >
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 shrink-0" aria-label="Acuity Health home">
          <Logo />
          <span className="text-sm font-semibold text-stone-900 tracking-tight">Acuity Health</span>
        </Link>

        {/* Desktop nav - centered with even spacing */}
        <nav className="hidden md:flex items-center justify-center flex-1">
          <div className="flex items-center gap-10">
            {navLinks.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="text-sm font-normal text-stone-600 hover:text-stone-900 transition-colors"
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
            className="hidden md:inline-flex rounded-full border-stone-200 bg-white text-stone-900 shadow-sm hover:bg-stone-50"
          >
            Book a Demo
          </BookCallButton>

          <Button
            variant="default"
            size="sm"
            className="hidden md:inline-flex rounded-full"
            asChild
          >
            <Link href="/portal">Practice Portal</Link>
          </Button>

          {/* Mobile menu button */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden h-10 w-10 rounded-full border border-border bg-white text-foreground shadow-sm"
            onClick={() => setMobileNavOpen(!isMobileNavOpen)}
            aria-label="Toggle navigation"
          >
            {isMobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {/* Mobile nav - fullscreen overlay */}
      {isMobileNavOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-background/95 backdrop-blur-md">
          <div className="flex min-h-full flex-col items-center justify-center gap-8 px-6 py-8">
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              className="absolute top-6 right-6 h-10 w-10 rounded-full border border-border bg-background text-foreground shadow-sm flex items-center justify-center"
              aria-label="Close navigation"
            >
              <X className="h-5 w-5" />
            </button>
            <nav className="flex flex-col items-center space-y-6">
              {navLinks.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className="text-2xl font-normal text-foreground/80 hover:text-foreground transition-colors"
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
                  className="w-full rounded-full border-stone-200 bg-white text-base text-stone-900 shadow-sm hover:bg-stone-50"
                >
                  Book a Demo
                </BookCallButton>
                <Button
                  variant="default"
                  size="lg"
                  className="w-full rounded-full text-base"
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
