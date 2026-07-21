"use client";

import Link from "next/link";
import { ChevronDown, Menu } from "lucide-react";

import { Button } from "@/components/ui/button";
import BookCallButton from "./BookCallButton";
import Logo from "./VisionOpsLogo";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { specialtyPages } from "@/app/specialties/pages";

const specialtyLinks = specialtyPages.map((page) => ({
  href: `/${page.slug}`,
  label: page.navLabel,
}));

const resourceLinks = [
  { href: "/insights", label: "Insights" },
  { href: "/press", label: "Press" },
  { href: "/faq", label: "FAQ" },
];

export default function Header() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 md:px-6">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between rounded-[6px] border border-[#e1e5eb] bg-[#fbfaf7]/95 px-4 shadow-sm backdrop-blur-md md:px-5">
        <Link
          aria-label="Acuity Health home"
          className="flex shrink-0 items-center gap-2 text-[#101820]"
          href="/"
        >
          <Logo />
          <span className="text-sm font-semibold tracking-tight">Acuity Health</span>
        </Link>

        <nav
          className="hidden items-center gap-8 lg:flex"
          aria-label="Primary navigation"
        >
          <HeaderLink href="/#product">Product</HeaderLink>
          <HeaderMenu label="Specialties" links={specialtyLinks} />
          <HeaderLink href="/#proof">Proof</HeaderLink>
          <HeaderMenu label="Resources" links={resourceLinks} />
        </nav>

        <div className="flex shrink-0 items-center gap-3">
          <Link
            className="hidden text-sm font-medium text-[#586372] transition-colors hover:text-[#101820] md:inline-flex"
            href="/portal"
          >
            Practice Portal
          </Link>
          <BookCallButton
            className="hidden h-9 rounded-[4px] bg-[#172033] px-4 text-sm font-semibold text-white shadow-sm hover:bg-[#22304a] sm:inline-flex"
            iconVariant="none"
            size="sm"
          >
            Book a demo
          </BookCallButton>

          <Sheet>
            <SheetTrigger asChild>
              <Button
                aria-label="Open navigation"
                className="size-10 rounded-[4px] border-[#e1e5eb] bg-white text-[#101820] shadow-sm lg:hidden"
                size="icon"
                variant="outline"
              >
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent
              className="w-[min(94vw,24rem)] gap-0 bg-[#fbfaf7] p-0 text-[#101820]"
              side="right"
            >
              <SheetHeader className="border-b border-[#e1e5eb] px-6 py-5">
                <SheetTitle className="flex items-center gap-2 text-[#101820]">
                  <Logo />
                  Acuity Health
                </SheetTitle>
                <SheetDescription className="sr-only">
                  Navigate the Acuity Health website
                </SheetDescription>
              </SheetHeader>

              <nav
                className="flex flex-1 flex-col overflow-y-auto px-6 py-8"
                aria-label="Mobile navigation"
              >
                <div className="space-y-5">
                  <MobileLink href="/#product">Product</MobileLink>
                  <MobileLink href="/#proof">Proof</MobileLink>
                </div>

                <MobileGroup label="Specialties" links={specialtyLinks} />
                <MobileGroup label="Resources" links={resourceLinks} />

                <div className="mt-auto space-y-4 border-t border-[#e1e5eb] pt-6">
                  <SheetClose asChild>
                    <Link
                      className="block text-center text-sm font-medium text-[#586372] hover:text-[#101820]"
                      href="/portal"
                    >
                      Practice Portal
                    </Link>
                  </SheetClose>
                  <BookCallButton
                    className="h-11 w-full rounded-[4px] bg-[#172033] text-sm font-semibold text-white hover:bg-[#22304a]"
                    iconVariant="none"
                    size="default"
                  >
                    Book a demo
                  </BookCallButton>
                </div>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}

function HeaderLink({ children, href }: { children: React.ReactNode; href: string }) {
  return (
    <Link
      className="text-sm font-medium text-[#586372] transition-colors hover:text-[#101820]"
      href={href}
    >
      {children}
    </Link>
  );
}

function HeaderMenu({
  label,
  links,
}: {
  label: string;
  links: readonly { href: string; label: string }[];
}) {
  return (
    <div className="group relative">
      <button
        aria-haspopup="true"
        className="flex items-center gap-1 text-sm font-medium text-[#586372] transition-colors hover:text-[#101820] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#536a91]/40"
        type="button"
      >
        {label}
        <ChevronDown className="size-3.5" />
      </button>
      <div className="invisible absolute left-1/2 top-full z-50 w-56 -translate-x-1/2 pt-3 opacity-0 transition-all duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
        <div className="overflow-hidden rounded-[6px] border border-[#e1e5eb] bg-[#fbfaf7] p-1 shadow-lg">
          {links.map((link) => (
            <Link
              className="block rounded-[4px] px-3 py-2 text-sm text-[#586372] transition-colors hover:bg-white hover:text-[#101820]"
              href={link.href}
              key={link.href}
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function MobileLink({ children, href }: { children: React.ReactNode; href: string }) {
  return (
    <SheetClose asChild>
      <Link className="block text-2xl font-medium text-[#101820]" href={href}>
        {children}
      </Link>
    </SheetClose>
  );
}

function MobileGroup({
  label,
  links,
}: {
  label: string;
  links: readonly { href: string; label: string }[];
}) {
  return (
    <div className="mt-9">
      <p className="marketing-label text-[10px] font-medium tracking-[0.16em] text-[#8a94a6]">
        {label}
      </p>
      <div className="mt-4 space-y-3">
        {links.map((link) => (
          <SheetClose asChild key={link.href}>
            <Link className="block text-base font-medium text-[#586372]" href={link.href}>
              {link.label}
            </Link>
          </SheetClose>
        ))}
      </div>
    </div>
  );
}
