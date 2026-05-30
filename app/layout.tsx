import type { Metadata } from "next";
import Script from "next/script";

import "./globals.css";
import AppChrome from "./components/AppChrome";
import { SITE_CONFIG } from "@/lib/config";

const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: SITE_CONFIG.name,
  url: SITE_CONFIG.baseUrl,
  logo: `${SITE_CONFIG.baseUrl}/logo.png`,
  description: SITE_CONFIG.description,
  email: SITE_CONFIG.email,
  sameAs: [SITE_CONFIG.social.linkedin],
  areaServed: {
    "@type": "Country",
    name: "United States",
  },
  founder: {
    "@type": "Person",
    name: "Acuity Health Team",
  },
};

const softwareApplicationSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Acuity AI Receptionist",
  applicationCategory: "HealthApplication",
  applicationSubCategory: "AI Receptionist / Voice AI",
  operatingSystem: "Web",
  url: SITE_CONFIG.baseUrl,
  description:
    "AI receptionist for ophthalmology practices that answers every patient call and books appointments directly into the EMR.",
  audience: {
    "@type": "MedicalAudience",
    audienceType: "Ophthalmology practices",
  },
  offers: {
    "@type": "Offer",
    priceCurrency: "USD",
    price: "0",
    priceSpecification: {
      "@type": "PriceSpecification",
      priceCurrency: "USD",
      description: "Custom pricing based on locations, workflows, and call volume.",
    },
  },
  featureList: [
    "AI receptionist that answers 100% of patient calls",
    "Direct appointment booking into the EMR",
    "After-hours and weekend call capture",
    "Multilingual handling, including Spanish",
    "Pediatric and medical vs. vision insurance routing",
    "Two-way SMS, confirmations, and reminders",
    "Front-desk analytics across locations",
    "HIPAA-conscious deployment",
  ],
  provider: {
    "@type": "Organization",
    name: SITE_CONFIG.name,
    url: SITE_CONFIG.baseUrl,
  },
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_CONFIG.baseUrl),
  title: {
    default: `${SITE_CONFIG.name} | AI Receptionist for Ophthalmology`,
    template: `%s | ${SITE_CONFIG.name}`,
  },
  description: SITE_CONFIG.description,
  keywords: [
    "AI receptionist",
    "AI receptionist for ophthalmology",
    "AI receptionist for medical practices",
    "AI phone agent",
    "virtual receptionist for doctors",
    "medical answering service alternative",
    "AI appointment booking",
    "AI receptionist EMR integration",
    "ophthalmology answering service",
    "eye care AI front desk",
    "after-hours call answering",
    "never miss a call",
    "Acuity Health",
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
    title: "AI Receptionist for Ophthalmology | Acuity Health",
    description: SITE_CONFIG.description,
    siteName: "Acuity Health",
    images: [
      {
        url: `${SITE_CONFIG.baseUrl}/api/og`,
        width: 1200,
        height: 630,
        alt: "Acuity Health — AI receptionist that answers every call and books directly into your EMR",
        type: "image/png",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Receptionist for Ophthalmology | Acuity Health",
    description: SITE_CONFIG.description,
    images: [`${SITE_CONFIG.baseUrl}/api/og`],
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
        <AppChrome>{children}</AppChrome>
        <Script
          id="structured-data-organization"
          type="application/ld+json"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
        />
        <Script
          id="structured-data-software-application"
          type="application/ld+json"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplicationSchema) }}
        />
      </body>
    </html>
  );
}
