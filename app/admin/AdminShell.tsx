"use client";

import { useState, type ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpenCheck,
  Building2,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldAlert,
} from "lucide-react";

import Logo from "@/app/components/VisionOpsLogo";
import { PortalSignOutButton } from "@/app/portal/PortalSignOutButton";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type AdminShellProps = Readonly<{
  children: React.ReactNode;
  userEmail: string;
}>;

type AdminNavItem = {
  href: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
};

const adminNavItems = [
  { href: "/admin/practices", icon: Building2, label: "Practices" },
  { href: "/admin/knowledge-base", icon: BookOpenCheck, label: "Knowledge Queue" },
  { href: "/admin/insurance-rules", icon: ShieldAlert, label: "Insurance Queue" },
] satisfies AdminNavItem[];

function isCurrentPath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SidebarLink({
  href,
  icon: Icon,
  isCollapsed = false,
  label,
  pathname,
}: AdminNavItem & { isCollapsed?: boolean; pathname: string }) {
  const isActive = isCurrentPath(pathname, href);

  const link = (
    <Link
      aria-label={isCollapsed ? label : undefined}
      className={cn(
        "inline-flex h-11 items-center rounded-xl text-sm font-medium transition",
        isCollapsed ? "w-11 justify-center px-0" : "min-w-fit gap-3 px-3 xl:w-full",
        isActive
          ? "bg-[#536a91] text-white shadow-sm hover:text-white"
          : "text-[#667085] hover:bg-[#edf4ff] hover:text-[#536a91]",
      )}
      href={href}
      title={label}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
      <span className={cn(isCollapsed ? "sr-only" : "truncate")}>{label}</span>
    </Link>
  );

  return isCollapsed ? <Tooltip label={label}>{link}</Tooltip> : link;
}

export function AdminShell({ children, userEmail }: AdminShellProps) {
  const pathname = usePathname();
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const isSidebarCollapsed = !isSidebarExpanded;

  return (
    <section className="portal-platform min-h-screen bg-[#fbfbfd] text-[#171a22]">
      <header className="sticky top-0 z-40 border-b border-[#e6e9f0] bg-white/95 backdrop-blur">
        <div className="flex h-[68px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-4">
            <Link
              href="/admin/practices"
              className="flex min-w-0 items-center gap-3 text-[#19203a] hover:text-[#19203a]"
              aria-label="Acuity Health admin"
            >
              <Logo />
              <span className="truncate text-lg font-semibold tracking-normal">
                Acuity Health
              </span>
            </Link>

            <span className="hidden h-7 items-center border-l border-[#e6e9f0] pl-4 text-sm font-medium text-[#6b7280] md:flex">
              Admin Portal
            </span>
          </div>

          <div className="flex min-w-0 items-center gap-3">
            <div className="hidden min-w-0 items-center rounded-xl border border-[#d8dde8] bg-white px-3 py-2 sm:block">
              <p className="truncate text-sm font-medium leading-5 text-[#19203a]">
                {userEmail}
              </p>
              <p className="text-xs leading-4 text-[#7b8494]">Admin</p>
            </div>
            <PortalSignOutButton className="border-[#d8dde8] bg-white text-[#344054] shadow-none hover:bg-[#f5f7fb]" />
          </div>
        </div>

        <nav className="flex gap-2 overflow-x-auto border-t border-[#edf0f5] px-4 py-3 xl:hidden">
          {adminNavItems.map((item) => (
            <SidebarLink key={item.href} {...item} pathname={pathname} />
          ))}
        </nav>
      </header>

      <div className="flex min-h-[calc(100vh-68px)]">
        <aside
          className={cn(
            "hidden shrink-0 border-r border-[#e6e9f0] bg-white transition-[width] duration-200 xl:sticky xl:top-[68px] xl:flex xl:h-[calc(100vh-68px)] xl:flex-col",
            isSidebarExpanded ? "w-[272px]" : "w-[68px]",
          )}
        >
          <div
            className={cn(
              "flex h-[68px] shrink-0 items-center border-b border-[#e6e9f0]",
              isSidebarCollapsed ? "justify-center" : "justify-between px-3",
            )}
          >
            {isSidebarCollapsed ? null : (
              <span className="truncate text-sm font-semibold tracking-normal text-[#19203a]">
                Navigation
              </span>
            )}
            <Button
              type="button"
              aria-label={isSidebarExpanded ? "Collapse sidebar" : "Expand sidebar"}
              className="rounded-xl text-[#4f5b6b] hover:bg-[#f5f7fb] hover:text-[#1f2937]"
              size="icon"
              variant="ghost"
              onClick={() => setIsSidebarExpanded((current) => !current)}
            >
              {isSidebarExpanded ? (
                <PanelLeftClose className="h-[22px] w-[22px]" aria-hidden="true" />
              ) : (
                <PanelLeftOpen className="h-[22px] w-[22px]" aria-hidden="true" />
              )}
            </Button>
          </div>

          <nav
            className={cn(
              "flex flex-col gap-1 py-3",
              isSidebarCollapsed ? "items-center px-0" : "px-3",
            )}
          >
            {adminNavItems.map((item) => (
              <SidebarLink
                key={item.href}
                {...item}
                isCollapsed={isSidebarCollapsed}
                pathname={pathname}
              />
            ))}
          </nav>

          <div
            className={cn(
              "mt-auto border-t border-[#edf0f5] p-3",
              isSidebarCollapsed && "flex justify-center",
            )}
          >
            {isSidebarCollapsed ? (
              <Logo className="text-[#536a91]" />
            ) : (
              <div className="flex min-w-0 items-center gap-3 rounded-xl px-1 py-2">
                <Logo className="shrink-0 text-[#536a91]" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium leading-5 text-[#19203a]">
                    Acuity Health
                  </p>
                  <p className="truncate text-xs leading-4 text-[#7b8494]">Admin</p>
                </div>
              </div>
            )}
          </div>
        </aside>

        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-10 lg:py-7">
          {children}
        </main>
      </div>
    </section>
  );
}
