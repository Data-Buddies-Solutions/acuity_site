"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Menu, X, ArrowRight } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";
import BookCallButton from "./BookCallButton";
import Logo from "./VisionOpsLogo";

const navLinks = [
  { href: "/#what-we-build", label: "What We Build" },
  { href: "/#about", label: "About" },
  { href: "/blog", label: "Blog" },
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
      {/* Announcement Banner */}
      <div
        className={cn(
          "fixed top-0 left-0 right-0 z-50 bg-stone-950 text-center py-2.5 px-4 transition-all duration-300",
          isScrolled ? "opacity-0 -translate-y-full pointer-events-none" : "opacity-100 translate-y-0"
        )}
      >
        <a
          href="https://www.aoece.com/events/webinar-optometrists-artificial-intelligence-march-18-2026"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-sm text-white transition-colors group"
        >
          <span className="bg-white/10 text-white text-xs font-medium px-2 py-0.5 rounded-full">March 18</span>
          <span>Speaking on AI in Eye Care at AOECE Webinar</span>
          <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
        </a>
      </div>

      <header
        className={cn(
          "fixed top-0 left-0 right-0 z-50 transition-all duration-300",
          isScrolled ? "px-8 md:px-32 lg:px-48 pt-2 mt-0" : "px-4 pt-6 mt-10"
        )}
      >
      <div
        className={cn(
          "mx-auto flex max-w-screen-xl items-center justify-between rounded-full border border-stone-200 bg-stone-50/90 backdrop-blur-md shadow-sm transition-all duration-300",
          isScrolled ? "px-4 py-1.5" : "px-8 py-3"
        )}
      >
        {/* Logo */}
        <Link href="/" className="flex items-center shrink-0" aria-label="VisionOps home">
          <Logo />
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
            size="sm"
            iconVariant="none"
            className="hidden md:inline-flex rounded-full"
          >
            Book a Call
          </BookCallButton>

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
              <BookCallButton
                size="lg"
                iconVariant="none"
                className="rounded-full text-base mt-4"
              >
                Book a Call
              </BookCallButton>
            </nav>
          </div>
        </div>
      )}
    </header>
    </>
  );
}
