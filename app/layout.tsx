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
    "AI phone system for medical practices",
    "Medical appointment scheduling automation",
    "Healthcare call management",
    "Patient communication automation",
    "HIPAA-compliant AI solutions",
  ],
  areaServed: {
    "@type": "Country",
    name: "United States",
  },
  offers: {
    "@type": "Service",
    name: "AI Phone System",
    description:
      "AI phone system for medical teams that handles scheduling, appointment reminders, and patient education.",
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
    default: `${SITE_CONFIG.name} | AI Phone System for Medical Teams`,
    template: `%s | ${SITE_CONFIG.name}`,
  },
  description: SITE_CONFIG.description,
  keywords: [
    "Acuity Health",
    "AI phone system for doctors",
    "medical practice phone automation",
    "AI appointment scheduling",
    "healthcare call automation",
    "AI receptionist for medical offices",
    "patient appointment reminders",
    "HIPAA compliant AI phone system",
    "multilingual medical phone system",
    "automated patient calls",
    "medical office phone system",
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
    title: "AI Phone System for Medical Teams | Acuity Health",
    description: SITE_CONFIG.description,
    siteName: "Acuity Health",
    images: [
      {
        url: `${SITE_CONFIG.baseUrl}/api/og?title=AI Phone System for Medical Teams&subtitle=Scheduling, reminders, and patient education. Handled.`,
        width: 1200,
        height: 630,
        alt: "Acuity Health - AI phone system for medical teams",
        type: "image/png",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Phone System for Medical Teams | Acuity Health",
    description: SITE_CONFIG.description,
    images: [`${SITE_CONFIG.baseUrl}/api/og?title=AI Phone System for Medical Teams&subtitle=Scheduling, reminders, and patient education. Handled.`],
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
