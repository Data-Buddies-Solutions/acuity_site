import type { Metadata } from "next";
import Image from "next/image";

import { SITE_CONFIG } from "@/lib/config";

function XLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

type TeamMember = {
  name: string;
  role: string;
  initials: string;
  image?: string;
  imagePosition?: string;
  twitter?: string;
  placeholder?: boolean;
};

const team: TeamMember[] = [
  {
    name: "Kyle Shechtman",
    role: "Co-founder & CEO",
    initials: "KS",
    image: "/kyle-shechtman-2026.png",
    twitter: "_kyleshechtman",
  },
  {
    name: "Chase Fagen",
    role: "Co-founder & Head of Engineering",
    initials: "CF",
    image: "/chase-fagen-v2.png",
    twitter: "chasef07",
  },
  {
    name: "Dr. Michael Venincasa",
    role: "Chief Medical Officer",
    initials: "MV",
    image: "/michael-venincasa.jpg",
    imagePosition: "center top",
  },
];

export const metadata: Metadata = {
  title: "About — AI Receptionist for Ophthalmology",
  description:
    "Meet the Acuity Health team building the AI receptionist purpose-built for ophthalmology practices — founders, engineering, and clinical leadership.",
  alternates: {
    canonical: `${SITE_CONFIG.baseUrl}/about`,
  },
};

export default function AboutPage() {
  return (
    <section className="bg-white pt-20 pb-10 md:pt-24 md:pb-14">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-accent">
            The team
          </p>
          <h1 className="mt-3 text-3xl font-semibold leading-[1.05] tracking-[-0.03em] md:whitespace-nowrap md:text-4xl lg:text-[3rem]">
            Built by practitioners and engineers.
          </h1>
        </div>

        <div className="mx-auto mt-8 grid max-w-5xl gap-5 md:mt-10 md:grid-cols-3 md:gap-6">
          {team.map((member) => (
            <article
              key={member.name}
              className="group relative overflow-hidden rounded-[1.75rem] border border-neutral-200 bg-white shadow-[0_18px_45px_rgba(15,39,44,0.04)] transition-shadow hover:shadow-[0_28px_70px_rgba(15,39,44,0.10)]"
            >
              <div className="relative aspect-[5/6] w-full overflow-hidden bg-neutral-100">
                {member.image ? (
                  <Image
                    src={member.image}
                    alt={member.name}
                    fill
                    className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                    style={{ objectPosition: member.imagePosition ?? "center" }}
                    sizes="(max-width: 768px) 100vw, 33vw"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-accent/12 via-accent/5 to-transparent">
                    <span className="text-5xl font-semibold tracking-tight text-accent/60">
                      {member.initials}
                    </span>
                  </div>
                )}
                {member.placeholder && (
                  <div className="absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-full border border-white/50 bg-white/85 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent backdrop-blur">
                    Now hiring
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <h3 className="truncate text-base font-semibold tracking-tight text-neutral-900">
                    {member.name}
                  </h3>
                  <p
                    className={
                      member.placeholder
                        ? "mt-0.5 truncate text-xs font-medium text-accent"
                        : "mt-0.5 truncate text-xs text-muted-foreground"
                    }
                  >
                    {member.role}
                  </p>
                </div>
                {member.twitter && (
                  <a
                    href={`https://x.com/${member.twitter}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-neutral-200 text-neutral-500 transition-colors hover:border-neutral-300 hover:text-neutral-900"
                    aria-label={`${member.name} on X`}
                  >
                    <XLogo className="h-3 w-3" />
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
