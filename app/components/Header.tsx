"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";

import { Menu, X } from "lucide-react";

import { buttonVariants, Button } from "./ui/button";
import { cn } from "@/lib/utils";
import BookCallButton from "./BookCallButton";
import HexagonLogo from "./HexagonLogo";

const navLinks = [
  { href: "/#problems", label: "Why Teams Call Us" },
  { href: "/#how-agents-work", label: "How It Works" },
  { href: "/about", label: "About Us" },
  { href: "/blog", label: "Blog" },
  { href: "/faq", label: "FAQ" },
];

export default function Header() {
  const [isMobileNavOpen, setMobileNavOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header className={cn(
      "fixed top-0 left-0 right-0 z-50 transition-all duration-300",
      isScrolled ? "px-32 pt-2 md:px-48 lg:px-64" : "px-4 pt-6"
    )}>
      <div className={cn(
        "mx-auto flex max-w-screen-xl items-center justify-between rounded-full border border-border/40 bg-background/70 backdrop-blur-md shadow-sm transition-all duration-300",
        isScrolled ? "px-4 py-1.5" : "px-8 py-3"
      )}>
        <Link href="/" className="flex items-center" aria-label="Data Buddies Solutions home">
          <HexagonLogo />
        </Link>
        <nav className="hidden items-center gap-8 md:flex">
          {navLinks.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="text-sm font-normal text-foreground/70 transition-colors hover:text-foreground"
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <BookCallButton
            size="sm"
            iconVariant="none"
            className="hidden md:inline-flex rounded-full"
          >
            Book a strategy call
          </BookCallButton>
          <Button
            variant="ghost"
            size="icon"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-white text-foreground shadow-sm md:hidden"
            onClick={() => setMobileNavOpen((prev) => !prev)}
            aria-label="Toggle navigation"
            aria-expanded={isMobileNavOpen}
          >
            {isMobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>
      {isMobileNavOpen ? (
        <div className="md:hidden">
          <div
            className="fixed inset-0 z-40 bg-background/95 backdrop-blur-md"
            onClick={() => setMobileNavOpen(false)}
          >
            <div
              className="mx-auto flex min-h-full w-full max-w-screen-sm flex-col items-center justify-center gap-8 px-6 py-8"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="absolute top-6 right-6">
                <button
                  type="button"
                  onClick={() => setMobileNavOpen(false)}
                  className={cn(
                    buttonVariants({ variant: "ghost", size: "icon" }),
                    "h-10 w-10 rounded-full border border-border bg-background text-foreground shadow-sm"
                  )}
                  aria-label="Close navigation"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <nav className="flex flex-col items-center space-y-6 w-full">
                {navLinks.map(({ href, label }) => (
                  <Link
                    key={href}
                    href={href}
                    className="text-2xl font-normal text-foreground/80 transition-colors hover:text-foreground"
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
                  Book a strategy call
                </BookCallButton>
              </nav>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
