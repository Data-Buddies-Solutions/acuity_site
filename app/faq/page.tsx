import type { Metadata } from "next";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/app/components/ui/accordion";
import { SITE_CONFIG } from "@/lib/config";

const faqs = [
  {
    question: "What does the AI phone system actually do?",
    answer: "It answers your practice's phone calls, talks to patients in natural conversation, books appointments directly into your EMR, and handles things like appointment reminders and patient education calls. It works 24/7 and can handle 20+ calls at the same time.",
  },
  {
    question: "Will patients know they're talking to an AI?",
    answer: "The voice is natural and conversational, but we believe in transparency. Patients are informed they're speaking with an AI assistant. Most patients prefer it to being put on hold or sent to voicemail.",
  },
  {
    question: "Does it work with our EMR?",
    answer: "Yes. We integrate directly with major systems like AdvancedMD, EyeMD EMR, Compulink, and others. Appointments are booked straight into your existing system with no double entry.",
  },
  {
    question: "Is patient data safe?",
    answer: "Absolutely. We're fully HIPAA compliant. We hold partnership agreements with AI providers ensuring patient data is never used for model training. For practices that need it, we also offer custom on-premise deployments.",
  },
  {
    question: "What languages does it support?",
    answer: "Over 70 languages. The system detects what language a patient is speaking and responds fluently, so your practice can serve every patient without a language barrier.",
  },
  {
    question: "How long does setup take?",
    answer: "Most practices are live within 4–8 weeks. We handle everything from configuration to your insurance rules, EMR integration, and go-live. No technical expertise needed on your end.",
  },
  {
    question: "What happens if the AI can't handle a call?",
    answer: "It seamlessly transfers the call to your staff with full context of the conversation. You're always in control, and your team can step in at any point.",
  },
  {
    question: "How is pricing structured?",
    answer: "We offer a monthly subscription that covers the phone system, integrations, and ongoing support. We'll provide a detailed quote after a demo call so you can see exactly what you're getting.",
  },
  {
    question: "Can we try it before committing?",
    answer: "Yes. Book a demo and we'll run a live call for your practice so you can hear exactly how it sounds and see how it books into your system.",
  },
];

export const metadata: Metadata = {
  title: "FAQ | AI Phone System for Medical Teams",
  description: "Answers to common questions about Acuity Health AI phone system for medical practices.",
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
