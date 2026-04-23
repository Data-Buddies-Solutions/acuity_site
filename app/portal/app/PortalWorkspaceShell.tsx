"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpenCheck,
  ClipboardList,
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
  { href: "/portal/app/knowledge-base", icon: BookOpenCheck, label: "Knowledge Base" },
  {
    href: "/portal/app/insurance-crosswalk",
    icon: ShieldAlert,
    label: "Insurance Crosswalk",
  },
] satisfies NavItem[];

const liveNavItems = [
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

export default function PortalWorkspaceShell({
  children,
  completionCount,
  email,
  isLive,
  readyToLaunch,
  totalSections,
  userName,
}: Readonly<{
  children: React.ReactNode;
  completionCount: number;
  email: string;
  isLive: boolean;
  readyToLaunch: boolean;
  totalSections: number;
  userName?: string | null;
}>) {
  const pathname = usePathname();
  const navItems = isLive ? liveNavItems : setupNavItems;
  const workspaceLabel = userName || email;

  return (
    <section className="bg-[linear-gradient(180deg,#f7fbfa_0%,#eef5f3_42%,#ffffff_100%)]">
      <div className="mx-auto grid min-h-screen max-w-[1600px] grid-cols-1 xl:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="border-b border-black/6 bg-white/75 backdrop-blur xl:border-b-0 xl:border-r">
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

            <div className="mt-6 rounded-[1.8rem] border border-black/6 bg-[#10353a] p-5 text-white">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/62">
                Workspace
              </p>
              <p className="mt-3 text-lg font-semibold tracking-[-0.03em]">{workspaceLabel}</p>
              <p className="mt-2 text-sm leading-relaxed text-white/70">
                {isLive
                  ? "Overview is the default home."
                  : "Setup stays focused on one step at a time."}
              </p>
            </div>

            <nav className="mt-6 flex gap-2 overflow-x-auto pb-1 xl:flex-col xl:overflow-visible">
              {navItems.map(({ href, icon: Icon, label }) => {
                const isActive = isCurrentPath(pathname, href);

                return (
                  <Link
                    key={href}
                    className={cn(
                      "inline-flex min-w-fit items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
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
              })}
            </nav>

            <div className="mt-6 rounded-[1.8rem] border border-black/6 bg-white p-5">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#6a7b7e]">
                Status
              </p>
              <p className="mt-3 text-lg font-semibold tracking-[-0.03em] text-[#10272c]">
                {isLive
                  ? "Agent live"
                  : readyToLaunch
                    ? "Ready to launch"
                    : `${completionCount} of ${totalSections} sections ready`}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-[#617477]">
                {isLive
                  ? "Overview, then the live modules."
                  : readyToLaunch
                    ? "Launch to switch the default home to overview."
                    : "Finish the current setup step."}
              </p>
            </div>
          </div>
        </aside>

        <div className="min-w-0">
          <header className="sticky top-0 z-10 border-b border-black/6 bg-white/80 backdrop-blur">
            <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 md:px-6 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm text-[#6c7f82]">
                  {isLive ? "Live Portal" : "Setup Workspace"}
                </p>
                <h1 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-[#10272c] md:text-3xl">
                  {workspaceLabel}
                </h1>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="rounded-full border border-black/6 bg-[#f7fbfa] px-3 py-1.5 text-sm text-[#5f7376]">
                  {isLive ? "Live" : "Setup"}
                </div>
                <div className="rounded-full border border-black/6 bg-white px-4 py-2 text-sm text-[#5f7376]">
                  {email}
                </div>
                <PortalSignOutButton />
              </div>
            </div>
          </header>

          <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6 md:py-8">
            {children}
          </main>
        </div>
      </div>
    </section>
  );
}
