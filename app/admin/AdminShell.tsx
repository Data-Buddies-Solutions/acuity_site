"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Activity,
  Building2,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

import Logo from "@/app/components/VisionOpsLogo";
import { PortalSignOutButton } from "@/app/portal/PortalSignOutButton";
import { cn } from "@/lib/utils";

type AdminShellProps = Readonly<{
  children: React.ReactNode;
  userEmail: string;
}>;

function NavLabel({
  children,
  collapsed,
}: {
  children: React.ReactNode;
  collapsed: boolean;
}) {
  return <span className={cn(collapsed && "lg:hidden")}>{children}</span>;
}

export function AdminShell({ children, userEmail }: AdminShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <section className="min-h-screen bg-[#f6f8f7]">
      <div
        className={cn(
          "mx-auto grid min-h-screen max-w-[1600px] transition-[grid-template-columns] duration-200",
          collapsed
            ? "lg:grid-cols-[84px_minmax(0,1fr)]"
            : "lg:grid-cols-[272px_minmax(0,1fr)]",
        )}
      >
        <aside className="border-b border-black/8 bg-white lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
          <div className="flex h-full flex-col gap-6 p-5">
            <div className="flex items-center justify-between gap-3">
              <Link
                href="/admin/practices"
                className={cn(
                  "flex min-w-0 items-center gap-3 text-[#10272c]",
                  collapsed && "lg:justify-center",
                )}
                aria-label="Acuity Health admin"
              >
                <Logo />
                <div className={cn("min-w-0", collapsed && "lg:hidden")}>
                  <p className="truncate text-base font-semibold tracking-[-0.03em] text-[#10272c]">
                    Acuity Health
                  </p>
                  <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#6c7d80]">
                    Admin
                  </p>
                </div>
              </Link>

              <button
                type="button"
                className="hidden h-9 w-9 items-center justify-center rounded-lg border border-black/8 text-[#617477] transition hover:bg-[#eef5f3] hover:text-[#10272c] lg:inline-flex"
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                onClick={() => setCollapsed((current) => !current)}
              >
                <ToggleIcon className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <nav className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
              <Link
                href="/admin/practices"
                className={cn(
                  "inline-flex min-w-fit items-center gap-3 rounded-lg bg-[#e8f4f4] px-3 py-2.5 text-sm font-semibold text-[#0d7377]",
                  collapsed && "lg:justify-center lg:px-2.5",
                )}
                title="Practices"
              >
                <Building2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                <NavLabel collapsed={collapsed}>Practices</NavLabel>
              </Link>
              <div
                className={cn(
                  "inline-flex min-w-fit items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-[#8a9a9d]",
                  collapsed && "lg:justify-center lg:px-2.5",
                )}
                title="Agents"
              >
                <Activity className="h-4 w-4 shrink-0" aria-hidden="true" />
                <NavLabel collapsed={collapsed}>Agents</NavLabel>
              </div>
              <div
                className={cn(
                  "inline-flex min-w-fit items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-[#8a9a9d]",
                  collapsed && "lg:justify-center lg:px-2.5",
                )}
                title="Analytics"
              >
                <LayoutDashboard className="h-4 w-4 shrink-0" aria-hidden="true" />
                <NavLabel collapsed={collapsed}>Analytics</NavLabel>
              </div>
            </nav>

            <div
              className={cn(
                "mt-auto hidden border-t border-black/8 pt-4 lg:block",
                collapsed && "text-center",
              )}
            >
              <div className={cn(collapsed && "lg:hidden")}>
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#8a9a9d]">
                  Signed in
                </p>
                <p className="mt-2 truncate text-sm font-semibold text-[#10272c]">
                  {userEmail}
                </p>
              </div>
              <div className={cn("mt-3", collapsed && "mt-0 flex justify-center")}>
                <PortalSignOutButton
                  className={cn(
                    "justify-start border-transparent bg-transparent px-0 text-[#566a6d] shadow-none hover:bg-transparent hover:text-[#10272c]",
                    collapsed && "h-9 w-9 justify-center overflow-hidden px-0 [&>svg]:shrink-0",
                  )}
                />
              </div>
            </div>
          </div>
        </aside>

        <div className="min-w-0">
          <header className="border-b border-black/8 bg-white/80 px-4 py-4 backdrop-blur md:px-6 lg:hidden">
            <div className="flex items-center justify-between gap-4">
              <p className="truncate text-sm font-semibold text-[#10272c]">{userEmail}</p>
              <PortalSignOutButton className="shrink-0" />
            </div>
          </header>

          <main className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6 md:py-8">
            {children}
          </main>
        </div>
      </div>
    </section>
  );
}
