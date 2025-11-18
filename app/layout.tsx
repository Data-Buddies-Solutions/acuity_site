import type { Metadata } from "next";
import Script from "next/script";

import "./globals.css";
import Footer from "./components/Footer";
import Header from "./components/Header";
import { SITE_CONFIG } from "@/lib/config";

const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "ProfessionalService",
  name: SITE_CONFIG.name,
  url: SITE_CONFIG.baseUrl,
  logo: `${SITE_CONFIG.baseUrl}/logono.png`,
  description:
    "Your Business Buddy That Never Sleeps. We clear repetitive tasks with AI automation so you can focus on work that grows profit.",
  email: SITE_CONFIG.email,
  sameAs: [SITE_CONFIG.social.linkedin],
  serviceType: [
    "AI automation consulting",
    "Workflow automation",
    "AI agent development",
    "Customer success automation",
    "Data analytics automation",
  ],
  areaServed: {
    "@type": "Country",
    name: "United States",
  },
  offers: {
    "@type": "Service",
    name: "AI automation blueprint",
    description:
      "Assessment, roadmap, and implementation plan for AI automation initiatives tailored to small business workflows.",
    priceRange: "$$",
    url: SITE_CONFIG.baseUrl,
  },
  founder: {
    "@type": "Person",
    name: "Data Buddies Team",
  },
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_CONFIG.baseUrl),
  title: {
    default: SITE_CONFIG.name,
    template: `%s | ${SITE_CONFIG.name}`,
  },
  description:
    "Your Business Buddy That Never Sleeps. Data Buddies clear repetitive tasks so you can focus on the work that grows profit. AI automation that turns bottlenecks into breakthroughs.",
  keywords: [
    "Data Buddies",
    "Data Buddies Solutions",
    "AI automation for small business",
    "business process automation services",
    "AI agent development",
    "workflow automation",
    "AI customer success copilot",
    "affordable AI automation",
    "hire AI automation consultant",
    "small business AI consultant",
    "AI automation consultancy",
  ],
  icons: {
    icon: "/icon.svg",
  },
  authors: [{ name: "Data Buddies Solutions" }],
  creator: "Data Buddies Solutions",
  publisher: "Data Buddies Solutions",
  category: "Automation Services",
  alternates: {
    canonical: `${SITE_CONFIG.baseUrl}/`,
    languages: {
      "en-US": `${SITE_CONFIG.baseUrl}/`,
    },
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: `${SITE_CONFIG.baseUrl}/`,
    title: "AI Automation for Small Businesses | Data Buddies Solutions",
    description:
      "Your Business Buddy That Never Sleeps. We clear repetitive tasks with AI automation so you can focus on work that grows profit.",
    siteName: "Data Buddies Solutions",
    images: [
      {
        // TODO: Create a dedicated 1200x630 OpenGraph image for better social media sharing
        // Current image is 668x374, consider creating a proper OG image with:
        // - Data Buddies Solutions branding
        // - Clear value proposition text
        // - Professional design matching brand colors (#cc6633)
        url: "/hero-isometric-removebg-preview.png",
        width: 668,
        height: 374,
        alt: "Data Buddies Solutions - AI automation for small businesses",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Automation for Small Businesses",
    description:
      "Your Business Buddy That Never Sleeps. AI automation that clears repetitive tasks so you can focus on work that grows profit.",
    images: ["/hero-isometric-removebg-preview.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  verification: {
    google: "",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <Header />
        <main className="flex flex-col pt-24">{children}</main>
        <Footer />
        <Script
          id="structured-data-organization"
          type="application/ld+json"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
        />
      </body>
    </html>
  );
}
