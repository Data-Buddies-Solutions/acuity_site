"use client";

import { useState, type ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpenCheck,
  Building2,
  ChevronDown,
  ClipboardList,
  FolderOpen,
  LayoutDashboard,
  LineChart,
  MessageSquareText,
  PhoneCall,
  ShieldAlert,
} from "lucide-react";

import Logo from "@/app/components/VisionOpsLogo";
import { PortalSignOutButton } from "@/app/portal/PortalSignOutButton";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
};

const setupNavItems = [
  { href: "/portal/app/onboarding", icon: ClipboardList, label: "Onboarding" },
] satisfies NavItem[];

const livePrimaryNavItems = [
  { href: "/portal/app/overview", icon: LayoutDashboard, label: "Overview" },
  { href: "/portal/app/call-center", icon: PhoneCall, label: "Call Center" },
  {
    href: "/portal/app/two-way-texting",
    icon: MessageSquareText,
    label: "Two-way Texting",
  },
  { href: "/portal/app/tasking", icon: ClipboardList, label: "Tasking" },
  {
    href: "/portal/app/post-call-analytics",
    icon: LineChart,
    label: "Post-call Analytics",
  },
] satisfies NavItem[];

const liveDocumentNavItems = [
  {
    href: "/portal/app/practice-information",
    icon: Building2,
    label: "Practice Information",
  },
  { href: "/portal/app/knowledge-base", icon: BookOpenCheck, label: "Knowledge Base" },
  {
    href: "/portal/app/insurance-crosswalk",
    icon: ShieldAlert,
    label: "Insurance Crosswalk",
  },
] satisfies NavItem[];

function isCurrentPath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SidebarLink({
  href,
  icon: Icon,
  isIndented = false,
  label,
  pathname,
}: NavItem & { isIndented?: boolean; pathname: string }) {
  const isActive = isCurrentPath(pathname, href);

  return (
    <Link
      className={cn(
        "inline-flex min-w-fit items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
        isIndented && "xl:rounded-lg xl:py-2 xl:pl-4",
        isActive
          ? "bg-[#e8f4f4] text-[#0d7377]"
          : "text-[#566a6d] hover:bg-white hover:text-[#10272c]"
      )}
      href={href}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {label}
    </Link>
  );
}

export default function PortalWorkspaceShell({
  children,
  isLive,
  practiceName,
  userEmail,
}: Readonly<{
  children: React.ReactNode;
  isLive: boolean;
  practiceName?: string;
  userEmail?: string;
}>) {
  const pathname = usePathname();
  const navItems = isLive ? livePrimaryNavItems : setupNavItems;
  const accountName = practiceName?.trim() || "Practice account";
  const hasActiveDocument = liveDocumentNavItems.some(({ href }) =>
    isCurrentPath(pathname, href)
  );
  const [documentsOpen, setDocumentsOpen] = useState(hasActiveDocument);
  const isDocumentsOpen = documentsOpen;
  const isPreparing = pathname.startsWith("/portal/app/preparing");
  const isFocusedSetup = pathname.startsWith("/portal/app/onboarding") || isPreparing;

  if (isPreparing) {
    return <>{children}</>;
  }

  if (isFocusedSetup) {
    return (
      <section className="min-h-screen bg-[linear-gradient(180deg,#f7fbfa_0%,#eef5f3_42%,#ffffff_100%)]">
        <header className="border-b border-black/6 bg-white/78 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 md:px-6">
            <Link href="/" className="flex items-center gap-3" aria-label="Acuity Health home">
              <Logo />
              <div>
                <p className="text-base font-semibold tracking-[-0.03em] text-[#10272c]">
                  Acuity Health
                </p>
                <p className="text-sm text-[#65787b]">Practice Portal</p>
              </div>
            </Link>

            {isPreparing ? null : <PortalSignOutButton />}
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6 md:py-8">
          {children}
        </main>
      </section>
    );
  }

  return (
    <section className="bg-[linear-gradient(180deg,#f7fbfa_0%,#eef5f3_42%,#ffffff_100%)]">
      <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col xl:grid xl:grid-cols-[288px_minmax(0,1fr)] xl:gap-6 xl:px-4">
        <aside className="border-b border-black/6 bg-white/75 backdrop-blur xl:sticky xl:top-4 xl:my-4 xl:h-[calc(100vh-2rem)] xl:self-start xl:overflow-hidden xl:rounded-2xl xl:border xl:border-black/8 xl:bg-white/82 xl:shadow-[0_18px_70px_rgba(16,39,44,0.08)]">
          <div className="flex h-full flex-col p-4 md:p-6">
            <div className="flex items-center gap-3">
              <Logo />
              <div>
                <p className="text-base font-semibold tracking-[-0.03em] text-[#10272c]">
                  Acuity Health
                </p>
                <p className="text-sm text-[#65787b]">Practice Portal</p>
              </div>
            </div>

            <nav className="mt-6 flex gap-2 overflow-x-auto pb-1 xl:flex-col xl:overflow-visible">
              {navItems.map((item) => (
                <SidebarLink key={item.href} {...item} pathname={pathname} />
              ))}
              {isLive ? (
                <div className="flex gap-2 xl:hidden">
                  {liveDocumentNavItems.map((item) => (
                    <SidebarLink
                      key={item.href}
                      {...item}
                      pathname={pathname}
                    />
                  ))}
                </div>
              ) : null}
            </nav>

            {isLive ? (
              <div className="mt-5 hidden xl:block">
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-semibold transition",
                    hasActiveDocument
                      ? "bg-[#f2f8f7] text-[#10272c]"
                      : "text-[#566a6d] hover:bg-white hover:text-[#10272c]"
                  )}
                  aria-expanded={isDocumentsOpen}
                  onClick={() => setDocumentsOpen((current) => !current)}
                >
                  <span className="flex items-center gap-3">
                    <FolderOpen className="h-4 w-4" aria-hidden="true" />
                    Documents
                  </span>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 transition-transform",
                      isDocumentsOpen && "rotate-180"
                    )}
                    aria-hidden="true"
                  />
                </button>
                <div
                  className={cn(
                    "grid transition-all duration-200",
                    isDocumentsOpen
                      ? "grid-rows-[1fr] opacity-100"
                      : "grid-rows-[0fr] opacity-0"
                  )}
                >
                  <div className="overflow-hidden">
                    <div className="mt-2 flex flex-col gap-1">
                      {liveDocumentNavItems.map((item) => (
                        <SidebarLink
                          key={item.href}
                          {...item}
                          isIndented
                          pathname={pathname}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="mt-auto hidden border-t border-black/8 pt-4 xl:block">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#8a9a9d]">
                  Account
                </p>
                <p className="mt-2 truncate text-sm font-semibold tracking-[-0.02em] text-[#10272c]">
                  {accountName}
                </p>
                <p className="mt-0.5 truncate text-xs text-[#65787b]">
                  {userEmail || "Practice account"}
                </p>
                <div className="mt-3">
                  <PortalSignOutButton className="justify-start border-transparent bg-transparent px-0 text-[#566a6d] shadow-none hover:bg-transparent hover:text-[#10272c]" />
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3 border-t border-black/8 pt-4 xl:hidden">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold tracking-[-0.02em] text-[#10272c]">
                  {accountName}
                </p>
                <p className="truncate text-xs text-[#65787b]">
                  {userEmail || "Practice account"}
                </p>
              </div>
              <PortalSignOutButton className="shrink-0" />
            </div>
          </div>
        </aside>

        <div className="min-w-0">
          <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6 md:py-8">
            {children}
          </main>
        </div>
      </div>
    </section>
  );
}
