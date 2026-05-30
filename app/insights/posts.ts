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
    slug: "ai-receptionist-vs-traditional-answering-service",
    title:
      "AI Receptionist vs. Traditional Answering Service: What Eye Care Practices Should Actually Compare",
    description:
      "Traditional answering services take messages. An AI receptionist answers, books, verifies, and writes appointments into the EMR. Here is the real comparison.",
    readingTime: "6 min read",
    date: "2026-05-22",
    tags: ["AI receptionist", "Answering service", "Comparison"],
    sections: [
      {
        heading: "The two categories solve different problems",
        paragraphs: [
          "Traditional medical answering services were built around a simple promise: a human will pick up the phone when your front desk cannot. They take a message, route urgent calls, and let the practice handle everything else the next morning. That is genuinely useful — but it is a message-taking service, not a scheduling system.",
          "An AI receptionist sits in a different category. It does not stop at taking a message. It completes the patient interaction: answer the call, verify the patient, check insurance, book the appointment, write it into the EMR, and follow up by text if needed.",
        ],
      },
      {
        heading: "What practices actually compare",
        bullets: [
          "Coverage: business hours only, after-hours only, or 24/7",
          "Outcome: message taken vs. appointment booked",
          "EMR integration: none, manual handoff, or direct write",
          "Concurrency: one call at a time, or hundreds in parallel",
          "Languages: English-only, bilingual operators, or 70+ languages",
          "Cost model: per-minute and per-message, or per-platform with predictable usage",
        ],
        paragraphs: [
          "On every dimension, the gap is widest where ophthalmology hurts most: high concurrent volume, multilingual patients, and the need to convert a call into a booked appointment in the EMR — not a callback request.",
        ],
      },
      {
        heading: "Where traditional answering services still win",
        paragraphs: [
          "There are cases where a human answering service is the right call: clinical triage that requires nurse judgment, sensitive emergency escalation that needs a person reading tone in real time, or after-hours-only coverage for very low call volumes.",
          "Most ophthalmology practices, though, are not buying a triage line. They are buying call coverage and scheduling capacity. That is exactly what AI receptionists are designed to do.",
        ],
      },
      {
        heading: "The ROI math",
        paragraphs: [
          "An average ophthalmology appointment is worth significantly more than the cost of answering a single call. When 23% of inbound calls are going to voicemail and 15% of demand arrives after hours, the cost is not paid in answering fees — it is paid in appointments that never got booked. That is the math an AI receptionist changes.",
        ],
      },
    ],
    takeaway:
      "Traditional answering services take messages. An AI receptionist completes the appointment. For ophthalmology practices losing patients to voicemail, the right comparison is not feature-for-feature — it is bookings-per-call.",
  },
  {
    slug: "after-hours-call-capture-ophthalmology",
    title:
      "After-Hours Call Capture: Where Ophthalmology Practices Are Quietly Losing Patients",
    description:
      "Roughly 15% of patient call demand in eye care arrives after the front desk has gone home. Most of it leaks to voicemail. Here is what to fix first.",
    readingTime: "5 min read",
    date: "2026-05-20",
    tags: ["After-hours", "AI receptionist", "Patient acquisition"],
    sections: [
      {
        heading: "The after-hours leak is bigger than most practices think",
        paragraphs: [
          "Patients do not call your practice on your schedule. They call when they get off work, during a kid's bedtime, on a lunch break, or after they notice something is wrong. In ophthalmology, a meaningful share of that demand lands outside the 9-to-5 window, and most of it hits voicemail.",
          "Voicemail is the worst possible outcome for that call. The patient already overcame the friction of dialing, and the practice already absorbed the marketing cost of attracting them. Then the call dies in a queue no one returns until tomorrow — if at all.",
        ],
      },
      {
        heading: "Where after-hours demand actually comes from",
        bullets: [
          "Evening callers after work and dinner",
          "Weekend bookings that wait through Monday voicemail",
          "Caregivers scheduling on behalf of parents or kids",
          "Multilingual patients who call when family members are home",
          "Urgent visual symptoms that need same-day triage",
        ],
        paragraphs: [
          "Each of these is a moment where the patient is ready to book and the practice cannot respond. By Monday morning, the appointment intent is often gone.",
        ],
      },
      {
        heading: "What good after-hours coverage looks like",
        paragraphs: [
          'Good after-hours coverage is not just "someone answers the phone." It is a coverage model that completes the patient\'s intent: book the appointment, route urgency to the right person, and confirm by text before the patient closes the laptop.',
          "An AI receptionist is a fit here precisely because the workload is unpredictable, low-margin per call, and spiky. Paying a human service per-minute for after-hours coverage rarely pencils. Letting an AI handle it — and only escalate true urgency — does.",
        ],
      },
      {
        heading: "Measure the leak first",
        bullets: [
          "After-hours call volume by hour and day",
          "Voicemail-to-callback conversion rate",
          "Same-day vs. next-day return-call rate",
          "Appointments booked from after-hours inbound",
          "Lost-call estimate (calls that hung up before voicemail)",
        ],
        paragraphs: [
          "Until practices measure these, the after-hours leak stays invisible. Once they do, the size of the gap usually justifies the fix on its own.",
        ],
      },
    ],
    takeaway:
      "After-hours leakage is one of the largest, least-tracked sources of lost ophthalmology appointments. Capturing it does not require a night-shift front desk — it requires an AI receptionist that can complete the booking when the patient is ready.",
  },
  {
    slug: "the-cost-of-a-missed-call-in-ophthalmology",
    title: "The Real Cost of a Missed Call in Ophthalmology",
    description:
      "Missed calls are usually framed as a front-desk efficiency problem. The bigger cost is the appointment, the patient, and the lifetime relationship behind it.",
    readingTime: "6 min read",
    date: "2026-05-18",
    tags: ["Missed calls", "Patient acquisition", "Ophthalmology"],
    sections: [
      {
        heading: "Missed calls are usually counted wrong",
        paragraphs: [
          "Most practices measure missed calls as a phone-system metric: how many rang through to voicemail, how many got abandoned, how many sat on hold. Those are useful operational numbers. They are also a serious undercount of the actual cost.",
          "A single missed call from a new patient is not a missed call. It is a missed first appointment, a missed second appointment, a missed referral, and — if the patient never gets booked — a missed multi-year relationship.",
        ],
      },
      {
        heading: "The cost stack of one missed call",
        bullets: [
          "Lost initial appointment revenue",
          "Lost downstream visit revenue (annual exams, follow-ups, procedures)",
          "Wasted marketing spend that drove the call in the first place",
          "Front-desk time spent on callbacks and voicemail triage",
          "Reputation cost as the patient tells others the practice is hard to reach",
        ],
        paragraphs: [
          "Adding these up makes missed calls one of the most expensive recurring failures in the practice — and one of the most invisible, because the cost shows up everywhere except on the phone bill.",
        ],
      },
      {
        heading: "Why ophthalmology is hit harder than other specialties",
        paragraphs: [
          "Eye care has unusually high call concurrency and unusually complex booking logic: medical vs. vision insurance, sub-specialty routing, pediatric flow, and post-op urgency. That mix overwhelms generic phone tools, which is why missed-call rates in eye care often run higher than the practice realizes.",
          "Add multilingual demand, and the gap widens further. Practices that cannot complete a booking in Spanish — or after hours, or while another five lines are ringing — quietly hand those patients to whoever can.",
        ],
      },
      {
        heading: "Fixing the missed-call problem at the source",
        paragraphs: [
          "Adding headcount rarely closes the gap because the demand is spiky and the work is repetitive. The structural fix is to make sure every call gets answered and resolved — by an AI receptionist that picks up on the first ring, completes the booking, and writes the appointment back into the EMR.",
          "When that happens, the missed-call line on the operations report stops being a leading indicator of lost revenue. Then the front desk can spend its time where it actually matters.",
        ],
      },
    ],
    takeaway:
      "Missed calls are not a phone problem. They are an acquisition problem, a revenue problem, and a trust problem. Closing them is one of the highest-ROI fixes available to an ophthalmology practice.",
  },
  {
    slug: "ai-receptionists-first-layer-of-triage-eye-care",
    title: "AI Receptionists in Eye Care: The First Layer of Triage",
    description:
      "AI receptionists in eye care are not just answering phones. They are becoming the first layer of triage — medical vs. vision, urgent vs. routine, scheduled vs. escalated.",
    readingTime: "3 min read",
    date: "2026-04-20",
    tags: ["AI receptionist", "Triage", "Ophthalmology"],
    sections: [
      {
        heading: "From answering calls to making decisions",
        paragraphs: [
          "AI receptionists in eye care are not just answering phones. They are becoming the first layer of triage.",
          "The unique challenge in ophthalmology is that the front desk is not just taking messages or booking appointments. They are constantly making small but important decisions:",
        ],
        bullets: [
          "Is this medical or vision?",
          "Is this urgent?",
          "Which provider should this patient see?",
          "Should this be scheduled, escalated, or handed directly to the clinical team?",
        ],
      },
      {
        heading: "Where AI fits in",
        paragraphs: [
          "This is where AI can be especially powerful.",
          "A well-designed AI receptionist can follow the same routing logic, ask the right questions, and know when to involve the office.",
        ],
      },
      {
        heading: "Triage is the foundation",
        paragraphs: [
          "For ophthalmology practices, triage is not a nice-to-have. It is the foundation of a better patient experience and a more scalable front desk.",
          "At Acuity Health, this is what we are building: AI front desk infrastructure designed specifically for the complexity of eye care.",
          "If your practice is exploring AI receptionists, we'd love to show you what triage-first automation can look like.",
        ],
      },
    ],
    takeaway:
      "Triage is the foundation of a better patient experience and a more scalable front desk. The AI receptionists that work in ophthalmology are the ones designed around routing decisions, not just call answering.",
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
