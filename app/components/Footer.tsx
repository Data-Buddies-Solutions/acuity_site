import Link from "next/link";
import Image from "next/image";
import Logo from "./VisionOpsLogo";
import { solutionPages } from "@/app/solutions/pages";
import { SITE_CONFIG } from "@/lib/config";

const footerGroups = [
  {
    title: "Product",
    links: [
      { href: "/#offers", label: "Platform" },
      { href: "/partners/advancedmd", label: "AdvancedMD integration" },
      { href: "/portal", label: "Practice portal" },
      { href: "tel:+14843989071", label: "Try the AI receptionist" },
    ],
  },
  {
    title: "Solutions",
    links: solutionPages.map((page) => ({
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
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/about", label: "About" },
      { href: SITE_CONFIG.social.linkedin, label: "LinkedIn", external: true },
    ],
  },
  {
    title: "Contact",
    links: [
      { href: `mailto:${SITE_CONFIG.email}`, label: SITE_CONFIG.email },
      { href: SITE_CONFIG.calendarLink, label: "Book a demo", external: true },
    ],
  },
];

const socialLinks = [
  { href: SITE_CONFIG.social.linkedin, label: "LinkedIn", Icon: LinkedInIcon },
  { href: SITE_CONFIG.social.instagram, label: "Instagram", Icon: InstagramIcon },
  { href: SITE_CONFIG.social.facebook, label: "Facebook", Icon: FacebookIcon },
];

export default function Footer() {
  return (
    <footer className="bg-[#0f1726] text-white">
      <div className="mx-auto max-w-7xl px-6 py-14 md:py-18">
        <div className="grid gap-12 lg:grid-cols-[1.05fr_1.95fr]">
          <div className="max-w-sm">
            <Logo className="mb-5 text-white" />
            <p className="text-sm leading-relaxed text-[#aebbd0]">
              The AI receptionist for ophthalmology. Answer every call, book directly into
              your EMR, and keep the front desk focused on patients in the office.
            </p>
            <Image
              src="/hipaa-badge.webp"
              alt="HIPAA Compliance"
              width={120}
              height={48}
              className="mt-6 rounded-[4px] bg-white/90 p-2"
              style={{ height: "auto", width: 120 }}
            />
          </div>

          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-5">
            {footerGroups.map((group) => (
              <div key={group.title}>
                <p className="marketing-label mb-4 text-[11px] font-medium tracking-[0.16em] text-[#e7edf7]">
                  {group.title}
                </p>
                <div className="space-y-3">
                  {group.links.map((link) => (
                    <Link
                      className="block text-sm leading-relaxed text-[#aebbd0] transition-colors hover:text-white"
                      href={link.href}
                      key={`${group.title}-${link.href}`}
                      rel={link.external ? "noopener noreferrer" : undefined}
                      target={link.external ? "_blank" : undefined}
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-10 flex items-center gap-3">
          {socialLinks.map(({ href, label, Icon }) => (
            <Link
              aria-label={label}
              className="flex h-9 w-9 items-center justify-center rounded-[4px] border border-white/10 text-[#aebbd0] transition-colors hover:border-white/25 hover:bg-white/5 hover:text-white"
              href={href}
              key={label}
              rel="noopener noreferrer"
              target="_blank"
            >
              <Icon className="h-4 w-4" />
            </Link>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-white/10 pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-[#aebbd0]">
            © {new Date().getFullYear()} Acuity Health. All rights reserved.
          </p>
          <div className="flex items-center gap-6">
            <Link
              href="/privacy-policy"
              className="text-sm text-[#aebbd0] transition-colors hover:text-white"
            >
              Privacy
            </Link>
            <Link
              href="/terms-of-service"
              className="text-sm text-[#aebbd0] transition-colors hover:text-white"
            >
              Terms
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M4.98 3.5a2.5 2.5 0 1 1 0 5.001 2.5 2.5 0 0 1 0-5.001ZM3 9.75h4v11H3v-11Zm6.25 0h3.82v1.5h.06c.53-.96 1.84-1.97 3.79-1.97 4.05 0 4.8 2.66 4.8 6.12v5.35h-4v-4.74c0-1.13-.02-2.59-1.58-2.59-1.58 0-1.82 1.23-1.82 2.51v4.82h-4v-11Z" />
    </svg>
  );
}

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <rect height="16" rx="4" width="16" x="4" y="4" />
      <circle cx="12" cy="12" r="3.5" />
      <circle cx="17" cy="7" fill="currentColor" r="1" stroke="none" />
    </svg>
  );
}

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M13.6 21v-7.7h2.58l.39-3h-2.97V8.4c0-.87.24-1.46 1.49-1.46h1.59V4.25A21.3 21.3 0 0 0 14.36 4c-2.3 0-3.87 1.4-3.87 3.98v2.22H7.9v3h2.6V21h3.1Z" />
    </svg>
  );
}
