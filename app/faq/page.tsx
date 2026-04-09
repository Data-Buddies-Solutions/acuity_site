import type { Metadata } from "next";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/app/components/ui/accordion";
import { SITE_CONFIG } from "@/lib/config";

const faqs = [
  {
    question: "What does the AI actually do when a patient calls?",
    answer: "It answers the phone, has a natural conversation with the patient, and handles their request. Scheduling an appointment, confirming an existing one, checking insurance, or answering common questions about your practice. If the call needs your staff, it transfers with full context so the patient never has to repeat themselves.",
  },
  {
    question: "Will patients know they're talking to an AI?",
    answer: "The voice is natural and conversational, but we believe in transparency. Patients are informed they're speaking with an AI assistant. In practice, most patients prefer it to being put on hold or sent to voicemail. We've seen that patients actually like getting helped immediately.",
  },
  {
    question: "Which EMRs do you integrate with?",
    answer: "We're fully integrated with AdvancedMD today. Appointments book directly into your system with no double entry. Athena and Compulink integrations are in progress. If you use a different EMR, let us know. We're expanding quickly.",
  },
  {
    question: "How many calls can it handle at once?",
    answer: "30+ simultaneous calls. Every patient gets answered instantly. No hold time, no busy signals, no voicemail. This includes after hours, weekends, and holidays.",
  },
  {
    question: "What percentage of calls does the AI actually handle?",
    answer: "In our current deployments, 65% of calls are handled end-to-end by the AI with no staff involvement. The remaining calls are transferred to your team with full context. The AI never leaves a patient stranded.",
  },
  {
    question: "Is patient data safe?",
    answer: "Absolutely. We're fully HIPAA compliant. We hold partnership agreements with AI providers ensuring patient data is never used for model training. For practices that need it, we also offer custom on-premise deployments.",
  },
  {
    question: "What languages does it support?",
    answer: "Over 70 languages. The system detects what language a patient is speaking and responds fluently. No interpreter line needed.",
  },
  {
    question: "How long does setup take?",
    answer: "Most practices are live within 4–8 weeks. We handle everything. Your insurance rules, scheduling logic, appointment types, and EMR integration. No technical expertise needed on your end. It's a white-glove process.",
  },
  {
    question: "Is this built specifically for eye care?",
    answer: "Yes. We only work with ophthalmology and optometry practices. The AI understands your appointment types, insurance requirements, and how eye care front desks actually operate. It's not a generic healthcare AI.",
  },
  {
    question: "How is pricing structured?",
    answer: "Monthly subscription that covers the phone system, EMR integration, and ongoing support. We'll provide a detailed quote after a demo call so you can see exactly what you're getting.",
  },
  {
    question: "Can we try it before committing?",
    answer: "Yes. Book a demo and we'll run a live call using your practice's rules. Your appointment types, your insurance requirements, your scheduling logic. You'll hear exactly how it sounds and see how it books into your system.",
  },
];

export const metadata: Metadata = {
  title: "FAQ | AI Phone Receptionist for Eye Care",
  description: "Common questions about the Acuity Health AI phone receptionist for ophthalmology and optometry practices.",
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
            Everything you need to know about Acuity Health. Have a specific question?{" "}
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
