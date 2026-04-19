import Link from "next/link";
import Image from "next/image";
import Logo from "./VisionOpsLogo";
import { SITE_CONFIG } from "@/lib/config";

const footerLinks = [
  { href: "/platform", label: "Platform" },
  { href: "/#how-it-works", label: "How It Works" },
  { href: "/results", label: "Results" },
  { href: "/faq", label: "FAQ" },
];

export default function Footer() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-8">
          {/* Logo and description */}
          <div className="max-w-sm">
            <Logo className="mb-4" />
            <p className="text-sm text-muted-foreground mb-4">
              Patient access and engagement for ophthalmology and optometry practices, from first call to confirmed visit.
            </p>
            <Image
              src="/hipaa-badge.webp"
              alt="HIPAA Compliance"
              width={120}
              height={48}
              className="opacity-70"
            />
          </div>

          {/* Links */}
          <div className="flex flex-wrap gap-8">
            <div>
              <p className="font-medium text-sm mb-3">Navigation</p>
              <div className="space-y-2">
                {footerLinks.map(({ href, label }) => (
                  <Link
                    key={href}
                    href={href}
                    className="block text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {label}
                  </Link>
                ))}
              </div>
            </div>
            <div>
              <p className="font-medium text-sm mb-3">Contact</p>
              <div className="space-y-2">
                <Link
                  href={`mailto:${SITE_CONFIG.email}`}
                  className="block text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {SITE_CONFIG.email}
                </Link>
                <Link
                  href={SITE_CONFIG.social.linkedin}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  LinkedIn
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mt-12 pt-8 border-t border-border">
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Acuity Health. All rights reserved.
          </p>
          <div className="flex items-center gap-6">
            <Link
              href="/privacy-policy"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Privacy
            </Link>
            <Link
              href="/terms-of-service"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Terms
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
