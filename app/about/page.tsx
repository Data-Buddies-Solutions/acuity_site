import type { Metadata } from "next";
import Image from "next/image";
import { Eye, Target, Users } from "lucide-react";
import { SITE_CONFIG } from "@/lib/config";

function XLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

const team = [
  {
    name: "Kyle Shechtman",
    role: "CEO",
    initials: "KS",
    image: "/kyle-shechtman.png",
    bio: "I work closely with eyecare practice owners to understand their operational challenges and design AI solutions that fit how their teams work.",
    twitter: "_kyleshechtman",
  },
  {
    name: "Chase Fagen",
    role: "CTO",
    initials: "CF",
    image: "/chase-fagen.png",
    bio: "I lead our technical development, ensuring our AI agents integrate smoothly with EHR systems, phone platforms, and practice management software.",
    twitter: "chasef07",
  },
];

const values = [
  {
    icon: Eye,
    title: "Eyecare focused",
    description: "We specialize exclusively in optometry and ophthalmology practices.",
  },
  {
    icon: Target,
    title: "Custom solutions",
    description: "Every practice is different. We build agents tailored to your specific workflows.",
  },
  {
    icon: Users,
    title: "Hands-on partnership",
    description: "You work directly with our engineers. No handoffs or support tickets.",
  },
];

export const metadata: Metadata = {
  title: "About Us",
  description: "Meet the Data Buddies Solutions team—AI consultants specializing in custom agent development for eyecare practices.",
  alternates: {
    canonical: `${SITE_CONFIG.baseUrl}/about`,
  },
};

export default function AboutPage() {
  return (
    <>
      {/* Hero */}
      <section className="py-20 md:py-28 bg-background">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight mb-6">
            About Data Buddies Solutions
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            We're an AI consulting firm helping eyecare practices adopt AI through custom-built agents.
          </p>
        </div>
      </section>

      {/* Team */}
      <section className="py-20 md:py-28 bg-muted">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-2xl md:text-3xl font-semibold tracking-tight mb-12 text-center">
            Meet the team
          </h2>
          <div className="grid md:grid-cols-2 gap-12 max-w-4xl mx-auto">
            {team.map(({ name, role, initials, image, bio, twitter }) => (
              <div key={name} className="text-center">
                {image ? (
                  <div className="relative h-32 w-32 rounded-full overflow-hidden mx-auto mb-6 border border-border">
                    <Image src={image} alt={name} fill className="object-cover" sizes="128px" />
                  </div>
                ) : (
                  <div className="h-32 w-32 rounded-full bg-muted flex items-center justify-center mx-auto mb-6 text-2xl font-semibold">
                    {initials}
                  </div>
                )}
                <h3 className="text-lg font-semibold">{name}</h3>
                <p className="text-sm text-muted-foreground mb-2">{role}</p>
                {twitter && (
                  <a
                    href={`https://x.com/${twitter}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
                  >
                    <XLogo className="h-3 w-3" />
                    @{twitter}
                  </a>
                )}
                <p className="text-sm text-muted-foreground">{bio}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="py-20 md:py-28 bg-background">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-2xl md:text-3xl font-semibold tracking-tight mb-12 text-center">
            How we work
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            {values.map(({ icon: Icon, title, description }) => (
              <div key={title} className="text-center">
                <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center mx-auto mb-4">
                  <Icon className="w-6 h-6 text-foreground" />
                </div>
                <h3 className="font-semibold mb-2">{title}</h3>
                <p className="text-sm text-muted-foreground">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
