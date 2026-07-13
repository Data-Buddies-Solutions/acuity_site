import Image from "next/image";
import Link from "next/link";

import Logo from "./VisionOpsLogo";
import { specialtyPages } from "@/app/specialties/pages";
import { SITE_CONFIG } from "@/lib/config";

const footerGroups = [
  {
    title: "Product",
    links: [
      { href: "/#product", label: "AI receptionist" },
      { href: "/#portal", label: "Practice portal" },
      { href: "/partners/advancedmd", label: "AdvancedMD integration" },
      { href: "tel:+14843989071", label: "Call the live receptionist" },
    ],
  },
  {
    title: "Specialties",
    links: specialtyPages.map((page) => ({
      href: `/${page.slug}`,
      label: page.navLabel,
    })),
  },
  {
    title: "Resources",
    links: [
      { href: "/insights", label: "Insights" },
      { href: "/press", label: "Press" },
      { href: "/faq", label: "FAQ" },
      { href: "/privacy-policy", label: "Privacy" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/about", label: "About" },
      { href: "/portal", label: "Practice Portal" },
      { href: SITE_CONFIG.calendarLink, label: "Book a demo", external: true },
      { href: SITE_CONFIG.social.linkedin, label: "LinkedIn", external: true },
    ],
  },
] as const;

export default function Footer() {
  return (
    <footer className="bg-[#0f1726] text-white">
      <div className="mx-auto max-w-7xl px-6 py-12 md:py-14">
        <div className="grid gap-12 lg:grid-cols-[1.1fr_2fr] lg:gap-16">
          <div className="max-w-sm">
            <Logo className="mb-5 text-white" />
            <p className="text-sm leading-relaxed text-[#aebbd0]">
              The AI receptionist for specialty medical practices. Answer every call, book
              into the EMR, and keep staff focused on the patients in front of them.
            </p>
            <Link
              className="mt-4 inline-flex text-sm text-[#d8dee8] hover:text-white"
              href={`mailto:${SITE_CONFIG.email}`}
            >
              {SITE_CONFIG.email}
            </Link>
            <Image
              alt="HIPAA compliance"
              className="mt-5 rounded-[4px] bg-white/90 p-2"
              height={48}
              src="/hipaa-badge.webp"
              style={{ height: "auto", width: 112 }}
              width={112}
            />
          </div>

          <div className="grid grid-cols-2 gap-x-8 gap-y-10 md:grid-cols-4">
            {footerGroups.map((group) => (
              <div key={group.title}>
                <p className="marketing-label mb-4 text-[10px] font-medium tracking-[0.16em] text-[#e7edf7]">
                  {group.title}
                </p>
                <div className="space-y-3">
                  {group.links.map((link) => (
                    <Link
                      className="block text-sm leading-relaxed text-[#aebbd0] transition-colors hover:text-white"
                      href={link.href}
                      key={`${group.title}-${link.href}`}
                      rel={
                        "external" in link && link.external
                          ? "noopener noreferrer"
                          : undefined
                      }
                      target={"external" in link && link.external ? "_blank" : undefined}
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-4 border-t border-white/10 pt-7 text-sm text-[#aebbd0] sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Acuity Health. All rights reserved.</p>
          <div className="flex items-center gap-6">
            <Link className="hover:text-white" href="/privacy-policy">
              Privacy
            </Link>
            <Link className="hover:text-white" href="/terms-of-service">
              Terms
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
