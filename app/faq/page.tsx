import type { Metadata } from "next";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/app/components/ui/accordion";
import { SITE_CONFIG } from "@/lib/config";

const faqs = [
  {
    question: "What does the AI actually do when a patient calls?",
    answer:
      "It answers the phone, has a natural conversation with the patient, and handles their request. That can mean scheduling an appointment, confirming an existing visit, checking insurance, or answering common practice questions. If the call needs your staff, it transfers with full context so the patient never has to repeat themselves.",
  },
  {
    question: "Will patients know they're talking to an AI?",
    answer:
      "The voice is natural and conversational, but we believe in transparency. Patients are informed they're speaking with an AI assistant. In practice, most patients prefer getting helped immediately over being put on hold or sent to voicemail.",
  },
  {
    question: "Which EMRs do you integrate with?",
    answer:
      "We're fully integrated with AdvancedMD today. Appointments book directly into your system with no double entry. Athena and Compulink integrations are in progress. If you use a different EMR, let us know. We're expanding carefully around real practice demand.",
  },
  {
    question: "How many calls can it handle at once?",
    answer:
      "Acuity is built for high-volume environments and is currently supporting 100+ concurrent calls in a multi-location ophthalmology deployment. Every patient gets answered instantly with no hold time, no busy signals, and no voicemail dead ends.",
  },
  {
    question: "What percentage of calls does the AI actually handle?",
    answer:
      "In current deployments, a large share of repetitive patient communication can be handled end-to-end by Acuity without staff involvement. When a human needs to step in, the call is transferred with context rather than leaving the patient stranded.",
  },
  {
    question: "Is patient data safe?",
    answer:
      "Yes. Acuity is built with HIPAA-conscious implementation and uses vendor agreements that prevent patient data from being used for model training. For practices that need stricter deployment requirements, we can discuss additional configuration options.",
  },
  {
    question: "What languages does it support?",
    answer:
      "Over 70 languages. Acuity can detect what language a patient is speaking and respond fluently. It is already supporting full answering and booking in Spanish in a live ophthalmology deployment.",
  },
  {
    question: "How long does setup take?",
    answer:
      "Most practices are live within 4 to 8 weeks. We handle workflow configuration, routing logic, appointment setup, integration work, and go-live support. It is a white-glove implementation, not a self-serve tool drop.",
  },
  {
    question: "Is this built specifically for eye care?",
    answer:
      "Yes. We focus on ophthalmology and optometry. Acuity is designed around the way eye care front desks actually operate, including appointment nuance, insurance complexity, multilingual communication, and escalation logic.",
  },
  {
    question: "How is Acuity different from general patient engagement platforms?",
    answer:
      "Acuity is built around ophthalmology communication complexity, not just broad messaging features. That means handling high call volume, after-hours demand, medical and vision insurance workflows, multilingual booking, pediatric routing, and front-desk escalation logic inside one patient engagement system.",
  },
  {
    question: "Can Acuity handle medical and vision insurance workflows?",
    answer:
      "Yes. Acuity is designed to support the workflow complexity that comes with both medical and vision insurance, so patient engagement does not break down where scheduling and coverage questions get more nuanced.",
  },
  {
    question: "Can Acuity support pediatric and multilingual workflows?",
    answer:
      "Yes. Acuity is already supporting pediatric ophthalmology workflows and can fully answer and book in Spanish. The goal is not just translation, but a patient interaction that still feels complete and useful.",
  },
  {
    question: "How is pricing structured?",
    answer:
      "Pricing is structured around implementation, platform value, and usage. Implementation covers onboarding, workflow setup, routing, and integrations. The monthly platform fee reflects software, support, and reporting. Usage covers AI voice, texting, and telephony volume. We scope the right package after reviewing your locations, workflows, and call volume.",
  },
  {
    question: "What is included in implementation?",
    answer:
      "Implementation includes workflow configuration, routing rules, escalation logic, appointment setup, hours, integrations, and go-live support. Standard configuration is part of implementation. Only true one-off engineering work is scoped separately.",
  },
  {
    question: "Can we try it before committing?",
    answer:
      "Yes. Book a demo and we'll run a live call using your practice's rules, appointment types, insurance requirements, and scheduling logic. You'll hear exactly how it sounds and see how it books into your system.",
  },
];

export const metadata: Metadata = {
  title: "FAQ — AI Receptionist for Ophthalmology",
  description:
    "Common questions about Acuity's AI receptionist for ophthalmology — call answering, EMR booking, languages, HIPAA, pricing, and setup.",
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
