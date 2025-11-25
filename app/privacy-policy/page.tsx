import { Metadata } from "next";
import { SITE_CONFIG } from "@/lib/config";
import BreadcrumbSchema from "@/app/components/BreadcrumbSchema";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Learn how Data Buddies Solutions collects, uses, and protects your personal information. Our commitment to data privacy and security for our AI automation services.",
  alternates: {
    canonical: `${SITE_CONFIG.baseUrl}/privacy-policy`,
  },
  openGraph: {
    title: "Privacy Policy | Data Buddies Solutions",
    description:
      "Learn how Data Buddies Solutions handles your personal information and protects your privacy.",
  },
};

export default function PrivacyPolicyPage() {
  return (
    <>
      <BreadcrumbSchema
        items={[
          { name: "Home", url: "/" },
          { name: "Privacy Policy", url: "/privacy-policy" },
        ]}
      />
      <section className="mx-auto max-w-3xl space-y-6 px-4 py-16 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-semibold text-foreground">Privacy Policy</h1>
      <p className="text-sm text-foreground/70">Last updated: October 2025</p>
      <p className="text-base leading-relaxed text-foreground/80">
        Emet Global LLC doing business as Data Buddies Solutions (&quot;Data Buddies Solutions,&quot; &quot;we,&quot;
        &quot;us,&quot; or &quot;our&quot;) respects your privacy. This Privacy Policy explains the types of information we
        collect from visitors to our website and clients of our services, how we use that information, and the
        choices you have regarding your data.
      </p>
      <div className="space-y-4 text-base leading-relaxed text-foreground/80">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Information We Collect</h2>
          <p>
            We collect information that you provide directly, such as when you fill out a contact form, request a
            consultation, or communicate with us. This may include your name, company, email address, phone number,
            and any details you choose to share. We also collect limited technical information through analytics
            tools to understand site performance, such as IP address, browser type, and referring pages.
          </p>
        </div>
        <div>
          <h2 className="text-xl font-semibold text-foreground">How We Use Information</h2>
          <p>
            We use the information we collect to respond to inquiries, deliver our services, improve our website,
            and communicate with you about updates or offerings relevant to your interests. We do not sell your
            personal information. We may share your information with service providers who assist us in operating
            our business and who are bound by confidentiality obligations.
          </p>
        </div>
        <div>
          <h2 className="text-xl font-semibold text-foreground">Data Security</h2>
          <p>
            We maintain safeguards designed to protect your personal information. While we strive to keep your data
            secure, no method of transmission over the internet or method of electronic storage is completely
            secure, and we cannot guarantee absolute security.
          </p>
        </div>
        <div>
          <h2 className="text-xl font-semibold text-foreground">Your Choices</h2>
          <p>
            You can request access, updates, or deletion of your personal information by contacting us at{" "}
            <a href="mailto:team@databuddiessolutions.com" className="text-accent hover:underline">
              team@databuddiessolutions.com
            </a>
            . You may also opt out of marketing communications by following the unsubscribe instructions included in
            those messages.
          </p>
        </div>
        <div>
          <h2 className="text-xl font-semibold text-foreground">Contact</h2>
          <p>
            If you have questions about this Privacy Policy or our data practices, please contact Emet Global LLC
            d/b/a Data Buddies Solutions at{" "}
            <a href="mailto:team@databuddiessolutions.com" className="text-accent hover:underline">
              team@databuddiessolutions.com
            </a>
            .
          </p>
        </div>
      </div>
    </section>
    </>
  );
}
