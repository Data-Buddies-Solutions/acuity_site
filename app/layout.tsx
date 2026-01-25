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
    "AI consulting for eyecare practices",
    "AI agent development",
    "Practice management automation",
    "Healthcare workflow automation",
    "HIPAA-compliant AI solutions",
  ],
  areaServed: {
    "@type": "Country",
    name: "United States",
  },
  offers: {
    "@type": "Service",
    name: "AI Agent Implementation",
    description:
      "Custom AI agents for eyecare practice administration including scheduling, referral coordination, and pre-authorization.",
    priceRange: "$$",
    url: SITE_CONFIG.baseUrl,
  },
  founder: {
    "@type": "Person",
    name: "Data Buddies Solutions Team",
  },
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_CONFIG.baseUrl),
  title: {
    default: `${SITE_CONFIG.name} | AI Agents for Eyecare Practices`,
    template: `%s | ${SITE_CONFIG.name}`,
  },
  description: SITE_CONFIG.description,
  keywords: [
    "Data Buddies Solutions",
    "AI agents for eyecare",
    "optometry practice automation",
    "ophthalmology AI solutions",
    "medical practice AI",
    "healthcare automation",
    "AI scheduling for medical practices",
    "referral coordination AI",
    "pre-authorization automation",
    "HIPAA compliant AI",
    "eyecare practice management",
  ],
  icons: {
    icon: "/icon.svg",
  },
  authors: [{ name: "Data Buddies Solutions" }],
  creator: "Data Buddies Solutions",
  publisher: "Data Buddies Solutions",
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
    title: "AI Agents Built for Eyecare Practices | Data Buddies Solutions",
    description: SITE_CONFIG.description,
    siteName: "Data Buddies Solutions",
    images: [
      {
        url: `${SITE_CONFIG.baseUrl}/api/og?title=AI Agents for Eyecare Practices&subtitle=Focus on patient care. We handle the rest.`,
        width: 1200,
        height: 630,
        alt: "Data Buddies Solutions - AI agents built for eyecare practices",
        type: "image/png",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Agents Built for Eyecare Practices",
    description: SITE_CONFIG.description,
    images: [`${SITE_CONFIG.baseUrl}/api/og?title=AI Agents for Eyecare Practices&subtitle=Focus on patient care. We handle the rest.`],
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
