import type { Metadata } from "next";
import Link from "next/link";
import { Activity, Building2, LayoutDashboard } from "lucide-react";

import Logo from "@/app/components/VisionOpsLogo";
import { PortalSignOutButton } from "@/app/portal/PortalSignOutButton";
import { requireAdminSession } from "@/lib/admin-auth";

export const metadata: Metadata = {
  title: "Admin Portal",
  description: "Internal Acuity Health practice operations portal.",
  robots: {
    follow: false,
    index: false,
  },
};

export default async function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await requireAdminSession();

  return (
    <section className="min-h-screen bg-[#f6f8f7]">
      <div className="mx-auto grid min-h-screen max-w-[1600px] lg:grid-cols-[272px_minmax(0,1fr)]">
        <aside className="border-b border-black/8 bg-white lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
          <div className="flex h-full flex-col gap-6 p-5">
            <Link href="/admin/practices" className="flex items-center gap-3 text-[#10272c]">
              <Logo />
              <div>
                <p className="text-base font-semibold tracking-[-0.03em] text-[#10272c]">
                  Acuity Health
                </p>
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#6c7d80]">
                  Admin
                </p>
              </div>
            </Link>

            <nav className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
              <Link
                href="/admin/practices"
                className="inline-flex min-w-fit items-center gap-3 rounded-lg bg-[#e8f4f4] px-3 py-2.5 text-sm font-semibold text-[#0d7377]"
              >
                <Building2 className="h-4 w-4" aria-hidden="true" />
                Practices
              </Link>
              <div className="inline-flex min-w-fit items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-[#8a9a9d]">
                <Activity className="h-4 w-4" aria-hidden="true" />
                Agents
              </div>
              <div className="inline-flex min-w-fit items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-[#8a9a9d]">
                <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
                Analytics
              </div>
            </nav>

            <div className="mt-auto hidden border-t border-black/8 pt-4 lg:block">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#8a9a9d]">
                Signed in
              </p>
              <p className="mt-2 truncate text-sm font-semibold text-[#10272c]">
                {session.user.email}
              </p>
              <div className="mt-3">
                <PortalSignOutButton className="justify-start border-transparent bg-transparent px-0 text-[#566a6d] shadow-none hover:bg-transparent hover:text-[#10272c]" />
              </div>
            </div>
          </div>
        </aside>

        <div className="min-w-0">
          <header className="border-b border-black/8 bg-white/80 px-4 py-4 backdrop-blur md:px-6 lg:hidden">
            <div className="flex items-center justify-between gap-4">
              <p className="truncate text-sm font-semibold text-[#10272c]">{session.user.email}</p>
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
