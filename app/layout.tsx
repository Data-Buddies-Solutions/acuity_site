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
  logo: `${SITE_CONFIG.baseUrl}/logo.png`,
  description: SITE_CONFIG.description,
  email: SITE_CONFIG.email,
  sameAs: [SITE_CONFIG.social.linkedin],
  serviceType: [
    "AI phone receptionist for ophthalmology",
    "AI phone receptionist for optometry",
    "Eye care appointment scheduling automation",
    "Healthcare call management",
    "HIPAA-compliant AI solutions",
  ],
  areaServed: {
    "@type": "Country",
    name: "United States",
  },
  offers: {
    "@type": "Service",
    name: "AI Phone Receptionist",
    description:
      "AI phone receptionist for ophthalmology and optometry practices. Handles scheduling, insurance checks, and appointment confirmations.",
    priceRange: "$$",
    url: SITE_CONFIG.baseUrl,
  },
  founder: {
    "@type": "Person",
    name: "Acuity Health Team",
  },
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_CONFIG.baseUrl),
  title: {
    default: `${SITE_CONFIG.name} | AI Phone Receptionist for Eye Care`,
    template: `%s | ${SITE_CONFIG.name}`,
  },
  description: SITE_CONFIG.description,
  keywords: [
    "Acuity Health",
    "AI phone receptionist ophthalmology",
    "AI phone receptionist optometry",
    "eye care phone automation",
    "AI appointment scheduling ophthalmology",
    "ophthalmology call automation",
    "AI receptionist for eye doctors",
    "HIPAA compliant AI phone system",
    "AdvancedMD AI integration",
    "automated patient calls eye care",
    "ophthalmology office phone system",
  ],
  icons: {
    icon: "/icon.svg",
  },
  authors: [{ name: "Acuity Health" }],
  creator: "Acuity Health",
  publisher: "Acuity Health",
  category: "Healthcare Technology",
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
    title: "AI Phone Receptionist for Eye Care | Acuity Health",
    description: SITE_CONFIG.description,
    siteName: "Acuity Health",
    images: [
      {
        url: `${SITE_CONFIG.baseUrl}/api/og?title=AI Phone Receptionist for Eye Care&subtitle=Scheduling, insurance checks, and appointment confirmations. Handled.`,
        width: 1200,
        height: 630,
        alt: "Acuity Health - AI phone receptionist for eye care practices",
        type: "image/png",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Phone Receptionist for Eye Care | Acuity Health",
    description: SITE_CONFIG.description,
    images: [`${SITE_CONFIG.baseUrl}/api/og?title=AI Phone Receptionist for Eye Care&subtitle=Scheduling, insurance checks, and appointment confirmations. Handled.`],
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
    google: "QXxI1wTFC8aokChguwQIspepbaGAOH4EiNNOmloICX8",
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
