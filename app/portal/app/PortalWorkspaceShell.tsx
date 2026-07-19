"use client";

import { useState, type ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpenCheck,
  CalendarCheck,
  ChevronDown,
  ClipboardList,
  FolderOpen,
  LayoutDashboard,
  MessageSquareText,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PhoneCall,
  ShieldAlert,
} from "lucide-react";

import Logo from "@/app/components/VisionOpsLogo";
import { PracticeBrandLogo } from "@/app/portal/app/PracticeBrandLogo";
import { PortalSignOutButton } from "@/app/portal/PortalSignOutButton";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { PracticeBranding } from "@/lib/practice-branding";
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
  { href: "/portal/app/bookings", icon: CalendarCheck, label: "Bookings" },
  {
    href: "/portal/app/two-way-texting",
    icon: MessageSquareText,
    label: "Texting",
  },
  { href: "/portal/app/tasking", icon: ClipboardList, label: "Tasks" },
] satisfies NavItem[];

const liveDocumentNavItems = [
  { href: "/portal/app/knowledge-base", icon: BookOpenCheck, label: "Knowledge Base" },
  {
    href: "/portal/app/insurance-crosswalk",
    icon: ShieldAlert,
    label: "Insurance Rules",
  },
] satisfies NavItem[];

function isCurrentPath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SidebarLink({
  disablePrefetch = false,
  href,
  icon: Icon,
  isCollapsed = false,
  isIndented = false,
  label,
  pathname,
}: NavItem & {
  disablePrefetch?: boolean;
  isCollapsed?: boolean;
  isIndented?: boolean;
  pathname: string;
}) {
  const isActive = isCurrentPath(pathname, href);

  return (
    <Link
      aria-label={isCollapsed ? label : undefined}
      className={cn(
        "group relative inline-flex h-11 items-center rounded-xl text-sm font-medium transition",
        isCollapsed ? "w-11 justify-center px-0" : "min-w-fit gap-3 px-3 xl:w-full",
        isIndented && !isCollapsed && "xl:rounded-lg xl:pl-4",
        isActive
          ? "bg-[#536a91] text-white shadow-sm hover:text-white"
          : "text-[#667085] hover:bg-[#edf4ff] hover:text-[#536a91]",
      )}
      href={href}
      prefetch={disablePrefetch ? false : undefined}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
      <span className={cn(isCollapsed ? "sr-only" : "truncate")}>{label}</span>
      {isCollapsed ? (
        <span className="pointer-events-none absolute left-[calc(100%+12px)] top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-lg bg-[#151a24] px-3 py-1.5 text-sm font-medium text-white opacity-0 shadow-[0_10px_30px_rgba(16,24,40,0.18)] transition group-hover:opacity-100 group-focus-visible:opacity-100">
          <span
            className="absolute -left-1 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rotate-45 bg-[#151a24]"
            aria-hidden="true"
          />
          {label}
        </span>
      ) : null}
    </Link>
  );
}

function MobileDockLink({
  disablePrefetch = false,
  href,
  icon: Icon,
  label,
  pathname,
}: NavItem & { disablePrefetch?: boolean; pathname: string }) {
  const isActive = isCurrentPath(pathname, href);

  return (
    <Link
      aria-label={label}
      className={cn(
        "relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-[10px] font-medium transition",
        isActive
          ? "bg-[var(--portal-accent-soft)] text-[var(--portal-accent)]"
          : "text-[var(--portal-muted)] hover:bg-[var(--portal-panel)] hover:text-[var(--portal-ink)]",
      )}
      href={href}
      prefetch={disablePrefetch ? false : undefined}
    >
      <Icon className="size-5" aria-hidden="true" />
      <span className="max-w-full truncate">{label}</span>
    </Link>
  );
}

function MobileMoreMenu({
  accountName,
  disablePrefetch,
  pathname,
  practiceBranding,
  userEmail,
}: {
  accountName: string;
  disablePrefetch: boolean;
  pathname: string;
  practiceBranding: PracticeBranding;
  userEmail?: string;
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <button
          aria-label="More portal navigation"
          className="inline-flex size-10 items-center justify-center rounded-xl border border-[var(--portal-border)] text-[var(--portal-muted)] transition hover:bg-[var(--portal-panel)] hover:text-[var(--portal-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--portal-accent)]/30 md:hidden"
          type="button"
        >
          <MoreHorizontal className="size-5" aria-hidden="true" />
        </button>
      </SheetTrigger>
      <SheetContent className="portal-platform" side="bottom">
        <SheetHeader className="pr-12">
          <SheetTitle>More</SheetTitle>
          <SheetDescription>Practice resources and account controls.</SheetDescription>
        </SheetHeader>
        <div className="px-5">
          <div className="flex min-w-0 items-center gap-3 rounded-xl bg-[var(--portal-panel-soft)] p-3">
            <PracticeBrandLogo
              branding={practiceBranding}
              className="size-10 shrink-0 rounded-full p-1"
              practiceName={accountName}
              variant="mark"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-[var(--portal-ink)]">
                {accountName}
              </p>
              {userEmail ? (
                <p className="truncate text-xs text-[var(--portal-muted)]">{userEmail}</p>
              ) : null}
            </div>
          </div>
          <nav aria-label="Practice resources" className="mt-4 grid gap-1">
            {liveDocumentNavItems.map(({ href, icon: Icon, label }) => {
              const isActive = isCurrentPath(pathname, href);
              return (
                <SheetClose asChild key={href}>
                  <Link
                    className={cn(
                      "flex h-12 items-center gap-3 rounded-xl px-3 text-sm font-medium",
                      isActive
                        ? "bg-[var(--portal-accent)] text-white hover:text-white"
                        : "text-[var(--portal-ink-soft)] hover:bg-[var(--portal-panel)] hover:text-[var(--portal-ink)]",
                    )}
                    href={href}
                    prefetch={disablePrefetch ? false : undefined}
                  >
                    <Icon className="size-[18px]" aria-hidden="true" />
                    {label}
                  </Link>
                </SheetClose>
              );
            })}
          </nav>
        </div>
        <SheetFooter>
          <PortalSignOutButton className="w-full justify-center border-[var(--portal-border)] bg-white text-[var(--portal-ink-soft)] shadow-none hover:bg-[var(--portal-panel)]" />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export default function PortalWorkspaceShell({
  children,
  isLive,
  practiceBranding,
  practiceName,
  userEmail,
}: Readonly<{
  children: React.ReactNode;
  isLive: boolean;
  practiceBranding: PracticeBranding;
  practiceName?: string;
  userEmail?: string;
}>) {
  const pathname = usePathname();
  const navItems = isLive ? livePrimaryNavItems : setupNavItems;
  const accountName = practiceName?.trim() || "Practice account";
  const hasActiveDocument = liveDocumentNavItems.some(({ href }) =>
    isCurrentPath(pathname, href),
  );
  const [documentsOpen, setDocumentsOpen] = useState(hasActiveDocument);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const isDocumentsOpen = documentsOpen;
  const isSidebarCollapsed = !isSidebarExpanded;
  const isPreparing = pathname.startsWith("/portal/app/preparing");
  const isFocusedSetup = pathname.startsWith("/portal/app/onboarding") || isPreparing;
  const disablePrefetch = pathname === "/portal/app/call-center";

  if (isPreparing) {
    return <>{children}</>;
  }

  if (isFocusedSetup) {
    return (
      <section className="portal-platform min-h-screen bg-[#fbfbfd]">
        <header className="border-b border-[#e6e9f0] bg-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 md:px-6">
            <Link
              href="/"
              className="flex items-center gap-3"
              aria-label="Acuity Health home"
            >
              <Logo />
              <div>
                <p className="text-base font-semibold tracking-normal text-[#19203a]">
                  Acuity Health
                </p>
                <p className="text-sm text-[#7b8494]">Practice Portal</p>
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
    <section className="portal-platform min-h-screen bg-[#fbfbfd] text-[#171a22]">
      <header className="sticky top-0 z-40 border-b border-[#e6e9f0] bg-white/95 backdrop-blur">
        <div className="flex h-[68px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8 xl:pl-0">
          <div className="flex min-w-0 items-center">
            <button
              type="button"
              aria-label={isSidebarExpanded ? "Collapse sidebar" : "Expand sidebar"}
              className="hidden h-[68px] w-[68px] shrink-0 items-center justify-center border-r border-[#e6e9f0] text-[#4f5b6b] transition hover:bg-[#f5f7fb] hover:text-[#1f2937] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#536a91]/30 xl:inline-flex"
              onClick={() => setIsSidebarExpanded((current) => !current)}
            >
              {isSidebarExpanded ? (
                <PanelLeftClose className="h-[22px] w-[22px]" aria-hidden="true" />
              ) : (
                <PanelLeftOpen className="h-[22px] w-[22px]" aria-hidden="true" />
              )}
            </button>

            <Link
              href="/"
              className="flex min-w-0 items-center gap-3 text-[#19203a] hover:text-[#19203a] xl:ml-6"
              aria-label="Acuity Health home"
            >
              <Logo />
              <span className="truncate text-lg font-semibold tracking-normal">
                Acuity Health
              </span>
            </Link>

            <span className="ml-4 hidden h-7 items-center border-l border-[#e6e9f0] pl-4 text-sm font-medium text-[#6b7280] md:flex">
              Practice Portal
            </span>
          </div>

          <div className="flex min-w-0 items-center gap-3">
            <div className="hidden min-w-0 items-center gap-3 rounded-xl border border-[#d8dde8] bg-white px-3 py-2 sm:flex">
              <PracticeBrandLogo
                branding={practiceBranding}
                className="h-7 w-7 shrink-0 rounded-full p-1"
                practiceName={accountName}
                variant="mark"
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium leading-5 text-[#19203a]">
                  {accountName}
                </p>
                {userEmail ? (
                  <p className="truncate text-xs leading-4 text-[#7b8494]">{userEmail}</p>
                ) : null}
              </div>
            </div>
            {isLive ? (
              <MobileMoreMenu
                accountName={accountName}
                disablePrefetch={disablePrefetch}
                pathname={pathname}
                practiceBranding={practiceBranding}
                userEmail={userEmail}
              />
            ) : null}
            <div className="hidden md:block">
              <PortalSignOutButton className="border-[#d8dde8] bg-white text-[#344054] shadow-none hover:bg-[#f5f7fb]" />
            </div>
          </div>
        </div>

        <nav className="hidden gap-2 overflow-x-auto border-t border-[#edf0f5] px-4 py-3 md:flex xl:hidden">
          {navItems.map((item) => (
            <SidebarLink
              disablePrefetch={disablePrefetch}
              key={item.href}
              {...item}
              pathname={pathname}
            />
          ))}
          {isLive
            ? liveDocumentNavItems.map((item) => (
                <SidebarLink
                  disablePrefetch={disablePrefetch}
                  key={item.href}
                  {...item}
                  pathname={pathname}
                />
              ))
            : null}
        </nav>
      </header>

      <div className="flex min-h-[calc(100vh-68px)]">
        <aside
          className={cn(
            "hidden shrink-0 border-r border-[#e6e9f0] bg-white transition-[width] duration-200 xl:sticky xl:top-[68px] xl:flex xl:h-[calc(100vh-68px)] xl:flex-col",
            isSidebarExpanded ? "w-[272px]" : "w-[68px]",
          )}
        >
          <nav
            className={cn(
              "flex flex-col gap-1 py-3",
              isSidebarCollapsed ? "items-center px-0" : "px-3",
            )}
          >
            {navItems.map((item) => (
              <SidebarLink
                disablePrefetch={disablePrefetch}
                key={item.href}
                {...item}
                isCollapsed={isSidebarCollapsed}
                pathname={pathname}
              />
            ))}

            {isLive && isSidebarCollapsed ? (
              <div className="mt-4 flex flex-col items-center gap-1 border-t border-[#edf0f5] pt-4">
                {liveDocumentNavItems.map((item) => (
                  <SidebarLink
                    disablePrefetch={disablePrefetch}
                    key={item.href}
                    {...item}
                    isCollapsed
                    pathname={pathname}
                  />
                ))}
              </div>
            ) : null}

            {isLive && !isSidebarCollapsed ? (
              <div className="mt-4 border-t border-[#edf0f5] pt-4">
                <button
                  type="button"
                  className={cn(
                    "flex h-11 w-full items-center justify-between rounded-xl px-3 text-sm font-medium transition",
                    hasActiveDocument
                      ? "bg-[#536a91] text-white shadow-sm"
                      : "text-[#667085] hover:bg-[#edf4ff] hover:text-[#536a91]",
                  )}
                  aria-expanded={isDocumentsOpen}
                  onClick={() => setDocumentsOpen((current) => !current)}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <FolderOpen className="h-[18px] w-[18px]" aria-hidden="true" />
                    <span className="truncate">Documents</span>
                  </span>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 transition-transform",
                      isDocumentsOpen && "rotate-180",
                    )}
                    aria-hidden="true"
                  />
                </button>
                <div
                  className={cn(
                    "grid transition-all duration-200",
                    isDocumentsOpen
                      ? "grid-rows-[1fr] opacity-100"
                      : "grid-rows-[0fr] opacity-0",
                  )}
                >
                  <div className="overflow-hidden">
                    <div className="mt-2 flex flex-col gap-1">
                      {liveDocumentNavItems.map((item) => (
                        <SidebarLink
                          disablePrefetch={disablePrefetch}
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
          </nav>

          <div
            className={cn(
              "mt-auto border-t border-[#edf0f5] p-3",
              isSidebarCollapsed && "flex justify-center",
            )}
          >
            {isSidebarCollapsed ? (
              <PracticeBrandLogo
                branding={practiceBranding}
                className="h-9 w-9 rounded-full p-1"
                practiceName={accountName}
                variant="mark"
              />
            ) : (
              <div className="flex min-w-0 items-center gap-3 rounded-xl px-1 py-2">
                <PracticeBrandLogo
                  branding={practiceBranding}
                  className="h-10 w-10 shrink-0 rounded-full p-1"
                  practiceName={accountName}
                  variant="mark"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium leading-5 text-[#19203a]">
                    {accountName}
                  </p>
                  {userEmail ? (
                    <p className="truncate text-xs leading-4 text-[#7b8494]">
                      {userEmail}
                    </p>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </aside>

        <main className="mx-auto w-full max-w-7xl px-4 pb-24 pt-6 sm:px-6 md:pb-6 lg:px-10 lg:py-7">
          {children}
        </main>
      </div>

      {isLive ? (
        <nav
          aria-label="Portal"
          className="fixed inset-x-0 bottom-0 z-40 flex gap-1 border-t border-[var(--portal-border)] bg-white/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_24px_rgba(16,24,40,0.06)] backdrop-blur md:hidden"
        >
          {livePrimaryNavItems.map((item) => (
            <MobileDockLink
              disablePrefetch={disablePrefetch}
              key={item.href}
              {...item}
              pathname={pathname}
            />
          ))}
        </nav>
      ) : null}
    </section>
  );
}
