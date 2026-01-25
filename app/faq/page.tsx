import type { Metadata } from "next";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/app/components/ui/accordion";
import { SITE_CONFIG } from "@/lib/config";

const faqs = [
  {
    question: "What types of medical practices do you work with?",
    answer: "We work with medical practices of all types—from eyecare and primary care to specialty clinics. Our deep focus on healthcare means we understand the specific workflows, compliance requirements, and operational challenges you face.",
  },
  {
    question: "How quickly can we launch an AI agent?",
    answer: "Most agents launch in 4–8 weeks. We prioritize quick wins that deliver measurable ROI within the first month—like reducing missed calls or automating referral intake.",
  },
  {
    question: "Do we need technical expertise on our team?",
    answer: "None. We translate your practice goals into AI use cases, handle all the technical work, and train your team on how to use the new systems. You just need to help us understand your current workflows.",
  },
  {
    question: "Are your AI agents HIPAA compliant?",
    answer: "Yes. HIPAA compliance is built into everything we do—from the infrastructure we use to how we handle patient data. All solutions meet strict healthcare privacy and security requirements.",
  },
  {
    question: "Do you build custom agents or use off-the-shelf tools?",
    answer: "Both. We combine best-in-class AI platforms with custom orchestration and guardrails so each agent is tuned to your specific workflows, branding, and compliance requirements.",
  },
  {
    question: "Can you integrate with our EHR and practice management systems?",
    answer: "Yes. We integrate with major systems like AdvancedMD, EyeMD EMR, Compulink, and others. If your system has an API, we can connect to it. We also work with fax, phone systems, and scheduling platforms.",
  },
  {
    question: "How is pricing structured?",
    answer: "Most clients start with a project-based engagement for the initial build, then move to a monthly subscription for ongoing improvements and support. We'll provide a detailed quote after our discovery call.",
  },
  {
    question: "Can we start with just one agent?",
    answer: "Absolutely. Many practices start with a single agent—like phone scheduling or referral processing—to see results before expanding to other workflows.",
  },
  {
    question: "What happens if something goes wrong?",
    answer: "All our agents have built-in escalation paths. If an agent encounters something it can't handle, it seamlessly hands off to your team with full context. You're always in control.",
  },
];

export const metadata: Metadata = {
  title: "FAQ | AI Agents for Eyecare",
  description: "Answers to common questions about Data Buddies Solutions AI agents for optometry and ophthalmology practices.",
  alternates: {
    canonical: `${SITE_CONFIG.baseUrl}/faq`,
  },
};

export default function FAQPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };

  return (
    <section className="pt-20 md:pt-28 pb-20 md:pb-28 bg-background">
      <div className="mx-auto max-w-3xl px-6">
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight mb-4">
            Frequently asked questions
          </h1>
          <p className="text-lg text-muted-foreground">
            Everything you need to know about working with us. Have a specific question?{" "}
            <a
              href={SITE_CONFIG.calendarLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              Schedule a call
            </a>
          </p>
        </div>

        <Accordion type="single" collapsible className="space-y-3">
          {faqs.map(({ question, answer }, index) => (
            <AccordionItem
              key={question}
              value={`item-${index + 1}`}
              className="rounded-lg border border-border bg-background px-6"
            >
              <AccordionTrigger className="py-4 text-left font-medium hover:no-underline">
                {question}
              </AccordionTrigger>
              <AccordionContent className="pb-4 text-muted-foreground">
                {answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>

      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
    </section>
  );
}
