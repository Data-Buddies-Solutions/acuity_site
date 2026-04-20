export type InsightPost = {
  slug: string;
  title: string;
  description: string;
  readingTime: string;
  date: string;
  tags: string[];
  sections: {
    heading: string;
    paragraphs: string[];
    bullets?: string[];
  }[];
  takeaway: string;
};

export const insightPosts: InsightPost[] = [
  {
    slug: "hidden-cost-of-missed-calls-ophthalmology",
    title: "The Hidden Cost of Missed Calls in Ophthalmology Practices",
    description:
      "Missed calls are not just a phone problem. In ophthalmology, they are often lost appointments, delayed care, and avoidable front-desk strain.",
    readingTime: "5 min read",
    date: "2026-04-20",
    tags: ["Ophthalmology", "Missed calls", "Patient engagement"],
    sections: [
      {
        heading: "A missed call is a dropped patient interaction",
        paragraphs: [
          "Many practices still think about missed calls as an operational nuisance. In reality, they are patient engagement failures. A patient called because they needed something now: scheduling, reassurance, follow-up, an answer about insurance, or clarity on next steps.",
          "When that interaction ends in voicemail, hold time, or a dropped handoff, the patient experiences the practice as hard to reach. That changes trust before the visit ever happens.",
        ],
      },
      {
        heading: "Ophthalmology call volume is not simple",
        paragraphs: [
          "Eye care practices deal with a mix of routine scheduling, specialty visits, pediatric questions, urgent concerns, medical insurance, vision insurance, and multilingual needs. The front desk is rarely dealing with just one thing at a time.",
          "That means every missed call is happening inside a system that is already carrying more communication complexity than most generic platforms are designed for.",
        ],
      },
      {
        heading: "What practices should measure",
        bullets: [
          "Missed-call volume",
          "After-hours demand",
          "Appointments booked from inbound calls",
          "Staff time spent on repetitive phone work",
          "Spanish-language or multilingual booking volume",
        ],
        paragraphs: [
          "If patient engagement is a priority, these are the first operational signals to review.",
        ],
      },
    ],
    takeaway:
      "In ophthalmology, missed calls are not a minor ops issue. They are a measurable patient engagement problem with direct scheduling and trust consequences.",
  },
  {
    slug: "how-eye-care-practices-should-measure-patient-engagement",
    title: "How Eye Care Practices Should Measure Patient Engagement",
    description:
      "Patient engagement should be measured through responsiveness, completion, and continuity, not just message volume.",
    readingTime: "5 min read",
    date: "2026-04-20",
    tags: ["Patient engagement", "Measurement", "Eye care"],
    sections: [
      {
        heading: "Engagement is not just reminders and review requests",
        paragraphs: [
          "Many platforms define patient engagement too narrowly: reminders sent, texts opened, reviews requested. Those things matter, but they do not tell the whole story.",
          "For eye care practices, engagement starts with whether the patient can reach the practice and complete the next step without friction.",
        ],
      },
      {
        heading: "Three categories matter most",
        bullets: [
          "Reachability: are calls answered and after-hours demand captured?",
          "Completion: are appointments getting booked, confirmed, or routed correctly?",
          "Continuity: do reminders, follow-up, and staff handoffs keep the patient moving?",
        ],
        paragraphs: [
          "These three categories are much more useful than vanity metrics because they tie engagement back to operations.",
        ],
      },
      {
        heading: "Measure what changes behavior",
        paragraphs: [
          "The best engagement systems reduce missed calls, return staff capacity, increase completed scheduling, and make the practice feel easier to work with.",
          "Those outcomes matter more than saying a message was sent or opened.",
        ],
      },
    ],
    takeaway:
      "The most useful patient engagement metrics in eye care are the ones that show whether patients can reach the practice and complete the next step without friction.",
  },
  {
    slug: "front-desk-overload-what-to-fix-first",
    title: "Front-Desk Overload: What to Fix First",
    description:
      "When the front desk is overwhelmed, the problem is rarely just staffing. It is usually a mix of repetitive volume, poor routing, and communication design.",
    readingTime: "4 min read",
    date: "2026-04-20",
    tags: ["Front desk", "Operations", "Workflow"],
    sections: [
      {
        heading: "Front-desk overload is often misdiagnosed",
        paragraphs: [
          "Practices often describe the problem as staffing. But what front-desk teams usually experience is a combination of repetitive call volume, low-context transfers, after-hours leakage, and too many interactions that should not require a human every time.",
          "That distinction matters because adding headcount alone does not fix the design problem.",
        ],
      },
      {
        heading: "Fix repetitive work before adding complexity",
        bullets: [
          "Routine scheduling",
          "FAQ handling",
          "Reminder and confirmation logic",
          "Missed-call follow-up",
          "Basic routing and escalation",
        ],
        paragraphs: [
          "These are usually the highest-leverage areas because they consume attention all day and interrupt higher-value staff work.",
        ],
      },
      {
        heading: "The goal is not less humanity",
        paragraphs: [
          "The goal is a front desk that can spend more time where a person actually matters: exceptions, anxious patients, edge cases, pediatric nuance, and clinical coordination.",
        ],
      },
    ],
    takeaway:
      "The first fix for front-desk overload is not usually more staffing. It is better handling of repetitive communication work.",
  },
  {
    slug: "patient-engagement-starts-before-the-visit",
    title: "Patient Engagement Starts Before the Visit",
    description:
      "By the time a patient walks into the office, they have already formed a judgment about how responsive and organized the practice feels.",
    readingTime: "4 min read",
    date: "2026-04-20",
    tags: ["Patient engagement", "Patient experience", "Responsiveness"],
    sections: [
      {
        heading: "Engagement begins with reachability",
        paragraphs: [
          "Patients do not separate communication from care as neatly as practices sometimes do. If reaching the office is difficult, the patient already experiences the practice as less responsive.",
          "That means engagement begins with the first call, first text, first booking attempt, and first after-hours interaction.",
        ],
      },
      {
        heading: "Responsiveness is a trust signal",
        paragraphs: [
          "Hold times, voicemail loops, repeated explanations, and unclear routing do not just slow operations down. They shape trust.",
          "In ophthalmology and optometry, where follow-up and continuity matter, trust built before the visit has real downstream effects.",
        ],
      },
      {
        heading: "What better engagement feels like",
        bullets: [
          "The phone gets answered",
          "The patient gets routed correctly",
          "Scheduling feels clear",
          "Reminders and follow-up stay consistent",
          "The practice feels reachable and organized",
        ],
        paragraphs: [
          "That is what most practices should actually mean when they say they want better patient engagement.",
        ],
      },
    ],
    takeaway:
      "Patient engagement is not something layered on after scheduling. It starts with whether the patient can easily reach and move through the practice in the first place.",
  },
];

export function getInsightBySlug(slug: string) {
  return insightPosts.find((post) => post.slug === slug);
}
