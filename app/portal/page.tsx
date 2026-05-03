import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LockKeyhole } from "lucide-react";

import Logo from "@/app/components/VisionOpsLogo";
import { isAdminEmail } from "@/lib/admin-auth";
import { getAuthSession } from "@/lib/auth";

import { PortalLoginForm } from "./PortalLoginForm";

export const metadata: Metadata = {
  title: "Practice Portal Login",
  description:
    "Secure login for Acuity Health practice customers. Access the portal foundation for onboarding, analytics, and future operations tooling.",
  robots: {
    index: false,
    follow: false,
  },
};

function getSafeNextPath(value: string | string[] | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  return value.startsWith("/") && !value.startsWith("//") ? value : null;
}

export default async function PortalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const session = await getAuthSession();

  if (session) {
    redirect(
      getSafeNextPath(params.next) ||
        (isAdminEmail(session.user.email) ? "/admin/practices" : "/portal/app"),
    );
  }

  return (
    <section className="relative overflow-hidden bg-[#f6f8f6]">
      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-8 md:px-6 md:py-10">
        <div className="mb-8 flex w-full justify-start md:mb-10">
          <Link href="/" className="inline-flex items-center gap-3 text-[#10272c]">
            <Logo className="shrink-0" />
            <span className="text-lg font-semibold tracking-[-0.03em]">
              Acuity Health
            </span>
          </Link>
        </div>

        <div className="flex flex-1 items-center">
          <div className="grid w-full gap-6 lg:grid-cols-[420px_minmax(0,1fr)]">
            <div className="relative overflow-hidden rounded-[2.5rem] border border-black/8 bg-white/86 p-6 shadow-[0_28px_80px_rgba(16,39,44,0.12)] backdrop-blur md:p-8">
              <div className="absolute inset-x-8 top-0 h-px bg-white/80" />

              <div className="relative">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#5c7477]">
                    Practice Portal
                  </p>
                  <div className="flex h-11 w-11 items-center justify-center rounded-full border border-[#103137]/8 bg-white/75 text-[#18393d] shadow-[0_10px_24px_rgba(16,39,44,0.06)]">
                    <LockKeyhole className="h-4 w-4" aria-hidden="true" />
                  </div>
                </div>

                <h2 className="mt-8 text-4xl leading-[0.96] tracking-[-0.05em] text-[#10272c]">
                  Welcome back
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-[#5e7477]">
                  Sign in to your Acuity workspace.
                </p>

                <div className="mt-8">
                  <PortalLoginForm />
                </div>
              </div>
            </div>

            <div className="hidden lg:block">
              <div className="grid auto-rows-[112px] grid-cols-4 gap-3">
                <div className="relative overflow-hidden rounded-[2rem] bg-[#e2f2f1]">
                  <div className="absolute inset-6 rounded-full border-2 border-[#87cfc7]" />
                  <div className="absolute inset-[34px] rounded-full border-2 border-[#0d7377]" />
                  <div className="absolute right-6 top-6 h-3.5 w-3.5 rounded-full bg-[#0d7377]" />
                </div>

                <div className="relative col-span-2 overflow-hidden rounded-[2rem] bg-[#0f3f45]">
                  <div className="absolute -left-8 -top-8 h-32 w-32 rounded-full bg-white" />
                  <div className="absolute bottom-0 right-0 h-36 w-36 rounded-tl-[6rem] bg-[#7ccdc4]" />
                  <div className="absolute left-8 top-8 h-2 w-20 rounded-full bg-white/60" />
                </div>

                <div className="relative row-span-2 overflow-hidden rounded-[2rem] bg-[#0f3f45] p-6 text-white">
                  <div className="absolute inset-x-8 top-10 h-24 rounded-full border-4 border-white/75" />
                  <div className="absolute inset-x-11 top-13 h-18 rounded-full border-4 border-[#7fd2c8]" />
                  <div className="absolute inset-x-0 bottom-6 text-center">
                    <p className="text-2xl font-semibold tracking-[-0.05em]">5281</p>
                    <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-white/68">
                      Total Calls
                    </p>
                  </div>
                </div>

                <div className="relative overflow-hidden rounded-[2rem] bg-[#0d7377] p-5">
                  <div className="grid grid-cols-3 gap-3">
                    {Array.from({ length: 9 }).map((_, index) => (
                      <div
                        key={index}
                        className="aspect-square rounded-full bg-white/88"
                      />
                    ))}
                  </div>
                </div>

                <div className="relative row-span-2 overflow-hidden rounded-[2rem] bg-[#e8f4f4]">
                  <div className="absolute inset-y-6 left-1/2 w-40 -translate-x-1/2 rounded-full bg-[#cce7e6]/90" />
                  <div className="absolute inset-y-12 left-[18%] w-24 rounded-full bg-[#e8f4f4]" />
                </div>

                <div className="relative overflow-hidden rounded-[2rem] bg-[#f1f8f7]">
                  <div className="absolute left-6 top-6 h-3 w-20 rounded-full bg-[#0d7377]/18" />
                  <div className="absolute left-6 top-14 h-3 w-28 rounded-full bg-[#0d7377]/28" />
                  <div className="absolute left-6 top-22 h-3 w-18 rounded-full bg-[#0d7377]/18" />
                  <div className="absolute right-6 top-6 h-5 w-5 rounded-full border-2 border-[#0d7377]/45" />
                </div>

                <div className="relative row-span-2 overflow-hidden rounded-[2rem] bg-[#11393f]">
                  <div className="absolute -left-8 top-10 h-24 w-24 rounded-full bg-white" />
                  <div className="absolute bottom-12 left-1/2 h-24 w-24 -translate-x-1/2 rounded-full bg-[#d8efea]" />
                  <div className="absolute -right-5 bottom-0 h-24 w-24 rounded-full bg-[#9fd8d1]" />
                </div>

                <div className="relative col-span-2 row-span-2 overflow-hidden rounded-[2rem] bg-[#f6fbfa] shadow-[0_16px_40px_rgba(16,39,44,0.05)]">
                  <div className="absolute -left-6 top-8 h-28 w-28 rounded-full bg-[#d8efea]" />
                  <div className="absolute left-10 top-10 h-20 w-20 rounded-full border-[14px] border-[#0d7377]/22" />
                  <div className="absolute right-8 top-8 grid grid-cols-3 gap-2">
                    {Array.from({ length: 9 }).map((_, index) => (
                      <div key={index} className="h-5 w-5 rounded-full bg-[#0d7377]/18" />
                    ))}
                  </div>
                  <div className="absolute left-[42%] top-[28%] h-24 w-24 rotate-12 rounded-[2rem] bg-[#c9a227]/20" />
                  <div className="absolute left-[40%] top-[43%] h-5 w-40 rounded-full bg-[#0d7377]/20" />
                  <div className="absolute left-[48%] top-[55%] h-5 w-28 rounded-full bg-[#0d7377]/14" />
                  <div className="absolute bottom-7 left-8 h-12 w-36 rounded-[1.5rem] bg-[#0f3f45]">
                    <div className="absolute left-5 top-4 h-4 w-16 rounded-full bg-white/70" />
                  </div>
                  <div className="absolute bottom-7 right-9 h-28 w-28 rounded-full bg-[#0d7377]/14" />
                  <div className="absolute bottom-11 right-13 h-20 w-20 rounded-full bg-white/76" />
                  <div className="absolute bottom-15 right-17 h-12 w-12 rounded-full bg-[#7fd2c8]/65" />
                </div>

                <div className="relative overflow-hidden rounded-[2rem] bg-[#dff2f1]">
                  <div className="absolute left-6 top-6 h-10 w-10 rounded-2xl bg-[#0d7377]/14" />
                  <div className="absolute left-20 top-6 h-10 w-10 rounded-2xl bg-white/85" />
                  <div className="absolute left-6 top-20 h-10 w-24 rounded-[1.2rem] bg-white/70" />
                </div>

                <div className="relative overflow-hidden rounded-[2rem] bg-[#d5ece9]">
                  <div className="absolute -left-8 bottom-0 h-28 w-28 rotate-12 bg-white/80" />
                  <div className="absolute right-4 top-4 h-16 w-16 rounded-full border border-white/70 bg-white/40" />
                </div>

                <div className="relative overflow-hidden rounded-[2rem] bg-[#0b5f63]">
                  <div className="absolute left-1/2 top-1/2 h-20 w-20 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/90" />
                  <div className="absolute left-1/2 top-[38%] h-8 w-8 -translate-x-1/2 rounded-full bg-[#0b5f63]/16" />
                  <div className="absolute left-1/2 top-[54%] h-10 w-14 -translate-x-1/2 rounded-t-full bg-[#0b5f63]/16" />
                </div>

                <div className="relative overflow-hidden rounded-[2rem] bg-[#e5f3f2] p-5">
                  <div className="grid grid-cols-3 gap-3">
                    {Array.from({ length: 6 }).map((_, index) => (
                      <div
                        key={index}
                        className="aspect-square rounded-full bg-white/88"
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
