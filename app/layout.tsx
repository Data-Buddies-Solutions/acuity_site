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
    "Patient engagement platform for ophthalmology",
    "Patient engagement platform for optometry",
    "Eye care patient engagement",
    "Eye care phone system",
    "HIPAA-compliant patient communication",
  ],
  areaServed: {
    "@type": "Country",
    name: "United States",
  },
  offers: {
    "@type": "Service",
    name: "Patient Engagement Platform",
    description:
      "Patient engagement for ophthalmology and optometry practices, including call handling, scheduling, confirmations, reminders, and follow-up workflows.",
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
    default: `${SITE_CONFIG.name} | Patient Engagement for Eye Care`,
    template: `%s | ${SITE_CONFIG.name}`,
  },
  description: SITE_CONFIG.description,
  keywords: [
    "Acuity Health",
    "patient engagement ophthalmology",
    "patient engagement optometry",
    "eye care phone system",
    "ophthalmology appointment scheduling",
    "ophthalmology call management",
    "patient communication for eye doctors",
    "HIPAA compliant phone system",
    "AdvancedMD integration",
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
    title: "Patient Engagement for Eye Care | Acuity Health",
    description: SITE_CONFIG.description,
    siteName: "Acuity Health",
    images: [
      {
        url: `${SITE_CONFIG.baseUrl}/api/og?title=Patient Engagement for Eye Care&subtitle=Answer every patient call and keep communication moving.`,
        width: 1200,
        height: 630,
        alt: "Acuity Health - patient engagement for eye care practices",
        type: "image/png",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Patient Engagement for Eye Care | Acuity Health",
    description: SITE_CONFIG.description,
    images: [`${SITE_CONFIG.baseUrl}/api/og?title=Patient Engagement for Eye Care&subtitle=Answer every patient call and keep communication moving.`],
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
