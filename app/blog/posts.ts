export type BlogPost = {
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

export const posts: BlogPost[] = [
  {
    slug: "orchestration-vs-automation",
    title: "Orchestration vs. Automation: Building AI Systems That Think",
    description:
      "The difference between automation and orchestration isn't semantic—it's the gap between rigid scripts and intelligent systems that adapt, reason, and evolve.",
    readingTime: "7 min read",
    date: "2025-11-25",
    tags: ["AI orchestration", "Agent architecture"],
    sections: [
      {
        heading: "Orchestration Is What Separates Tools From Living Systems",
        paragraphs: [
          "Most companies think they need AI automation. They're wrong. What they actually need is orchestration—and the difference isn't semantic, it's existential.",
          "Automation says \"if X, do Y.\" It's a vending machine: predictable, rigid, dead. Orchestration says \"given goal G, figure out how to achieve it.\" It's a jazz ensemble: adaptive, collaborative, alive.",
          "The businesses building AI systems today are learning this the hard way. A collection of powerful AI tools doesn't become intelligent just because you chain them together. That's still automation—just fancier plumbing. True orchestration transforms isolated capabilities into a system that thinks.",
        ],
      },
      {
        heading: "Think in Layers, Not Bots",
        paragraphs: [
          "The biggest mistake in AI system design is thinking in terms of \"bots\" or \"agents\" as standalone entities. Modern AI systems should be architected in distinct layers, each with clear responsibilities:",
          "<strong>Interface Layer:</strong> What triggers the AI? A user message, a scheduled event, a database change? This layer defines how intelligence enters your system.",
          "<strong>Orchestration Layer:</strong> The brain of your operation. This is where you decide: centralized planner or decentralized swarm? Single coordinator or consensus protocol? This choice shapes everything.",
          "<strong>Agent Layer:</strong> Highly specialized agents, each expert in one narrow context. Not generalist bots trying to do everything, but focused capabilities that excel in their domain.",
          "<strong>Tool Layer:</strong> The execution primitives. APIs, databases, calculators, search engines. Raw capability without decision-making.",
          "<strong>Memory Layer:</strong> Both short-term (current task chain) and long-term (organizational knowledge, past learnings, ongoing projects). Without memory, you don't have intelligence—you have amnesia with a nice interface.",
        ],
      },
      {
        heading: "Three Orchestration Paradigms",
        paragraphs: [
          "Modern AI systems don't use one orchestration pattern—they blend three:",
          "<strong>Hierarchical Orchestration:</strong> One central planner decomposes goals, delegates tasks, and verifies output. Think of it as the conductor of an orchestra. Reliable, traceable, but potentially brittle.",
          "<strong>Event-Driven Orchestration:</strong> Agents react to events rather than top-down commands. When something happens in your system, specialized agents spring into action. Resilient and parallel, but harder to predict.",
          "<strong>Collaborative Orchestration:</strong> Multiple agents reason together, debate approaches, and converge on consensus or the best plan. Slower but dramatically more robust for complex decisions.",
          "Most robust systems combine all three. Use hierarchical for routine workflows, event-driven for reactive tasks, and collaborative when stakes are high or problems are novel.",
        ],
      },
      {
        heading: "Graphs, Not Linear Flows",
        paragraphs: [
          "Traditional automation is embarrassingly linear: Step A leads to Step B leads to Step C. If something breaks at B, everything stops.",
          "Modern agent orchestration should be graph-based. Tasks spawn subtasks. Workflows branch based on context. Multiple paths run in parallel and merge when dependencies align. Agents can loop back, retry with different strategies, or escalate to human oversight.",
          "This isn't theoretical. Look at how GPUs transformed computing—by moving from sequential CPU logic to massively parallel processing. AI orchestration is the same shift for business logic. Instead of one thread executing one path, you have a graph of capabilities activating in concert.",
        ],
      },
      {
        heading: "Reason, Act, Reflect",
        paragraphs: [
          "The most sophisticated AI systems follow a cycle that mimics human cognition:",
          "<strong>Reason:</strong> Before acting, evaluate the situation. What's the goal? What context matters? What could go wrong? Planning before execution prevents most disasters.",
          "<strong>Act:</strong> Execute with focused tools and specialized agents. Do one thing well, then move to the next.",
          "<strong>Reflect:</strong> After acting, assess outcomes. Did it work? What was learned? Should the approach change? This feedback loop is where systems evolve from scripted to intelligent.",
          "Without reflection, you're back to automation. With it, your system learns, adapts, and improves over time.",
        ],
      },
      {
        heading: "Memory Is Everything",
        paragraphs: [
          "Here's what most AI implementations miss: memory is not a feature, it's the foundation.",
          "<strong>Short-term memory</strong> holds the current task chain. What are we doing? What have we tried? What's the context right now? This is working memory—essential for coherent multi-step reasoning.",
          "<strong>Long-term memory</strong> stores organizational intelligence. Who are we as a company? What's our philosophy? What projects are ongoing? What mistakes have we made before? What tone do we use with customers?",
          "An AI agent with access to your long-term memory doesn't just execute tasks—it understands your business. It makes decisions aligned with your values. It knows not to repeat past failures. It operates like a tenured employee, not a temp worker reading a script.",
        ],
      },
      {
        heading: "From Automation to Agency",
        paragraphs: [
          "The mental shift required is profound:",
          "<strong>Automation thinking:</strong> \"Schedule a post every Tuesday at 9am.\"<br/><strong>Agency thinking:</strong> \"Grow our social media presence.\"",
          "<strong>Automation thinking:</strong> \"If cart abandoned, send email.\"<br/><strong>Agency thinking:</strong> \"Recover lost revenue from interested customers.\"",
          "<strong>Automation thinking:</strong> \"Summarize this document.\"<br/><strong>Agency thinking:</strong> \"Help me understand the implications of this contract.\"",
          "Agency means giving your AI systems goals, not just instructions. It means building systems that can plan, adapt, and reason—not just execute predetermined steps.",
          "This is the inflection point. Companies building automation will be outpaced by those building orchestration. Not because the tools are different, but because the thinking is.",
        ],
      },
      {
        heading: "Building Systems That Live",
        paragraphs: [
          "The future of business software isn't smarter bots or better prompts. It's orchestration layers that transform disparate AI capabilities into coherent, adaptive systems.",
          "Stop thinking in terms of \"automating X task\" and start thinking in terms of \"enabling agency around Y goal.\" Build in layers. Combine orchestration paradigms. Think in graphs, not lines. Give your systems memory. Architect for reasoning, not just reaction.",
          "That's the difference between a collection of tools and a living system. And living systems win.",
          "Ready to architect AI orchestration for your practice? <a href='/' class='text-accent hover:underline'>Acuity Health</a> specializes in building intelligent agent systems that think, adapt, and scale.",
        ],
      },
    ],
    takeaway:
      "Orchestration transforms AI tools into intelligent systems through layered architecture, graph-based workflows, and the ability to reason, act, and reflect—not just automate.",
  },
  {
    slug: "vibe-code-to-production",
    title: "You Can't Vibe Code to Production",
    description:
      "Vibe coding promised anyone could build apps by talking to AI. Reality was different. Here's what actually works.",
    readingTime: "6 min read",
    date: "2025-11-04",
    tags: ["AI development", "Context engineering"],
    sections: [
      {
        heading: "The Beautiful Lie",
        paragraphs: [
          "Vibe coding is nothing short of revolutionary. It promises to level the playing field, to give anyone access to the software economy. In theory, a 13-year-old really can build a multi-million dollar app over a weekend.",
          "Seven years ago in university, I dropped Programming 1 after three weeks. The syntax, the IDE, even understanding how code became a real application felt foreign. Today, I build software people actually pay for. What changed wasn't me learning to code the old way. It was discovering something the vibe coders missed: context engineering.",
          "For about two weeks, it felt like magic for me. \"Make me a todo app.\" Done. \"Add user authentication.\" Sure. \"Make it look modern.\" Gorgeous.",
          "Then I tried to connect the pieces. The authentication system didn't know how to talk to my database. The database schema didn't match my UI's data structure. The frontend worked locally but exploded on Vercel. Beautiful on the surface, broken underneath.",
          "The problem wasn't the AI's capability. It was that vibe coding treats software like isolated paintings when it's actually interconnected plumbing. You can generate perfect components all day, but if they don't know how to talk to each other, you've built nothing.",
        ],
      },
      {
        heading: "The Shift",
        paragraphs: [
          "After watching projects implode, I started using AI differently. I stopped asking it to build things and began using it to think with me.",
          "That's when I discovered the difference: AI doesn't need more power, it needs more context. It thrives when you narrow the lane, not when you open the highway. There's a massive difference between saying \"make a million-dollar chess simulator\" and saying \"build a Next.js web app styled with Tailwind, tested with Vitest, and deployed on Vercel.\"",
          "One gives it direction. The other leaves it wandering.",
          "This became my workflow, not prompting, but architecting through conversation. Each session became a teaching exchange. I taught the AI my constraints, my stack, my deployment target. It taught me patterns, syntax, and best practices. We researched together. We planned together. We worked together.",
        ],
      },
      {
        heading: "How it Actually Works",
        paragraphs: [
          "Vibe coding is karaoke. Context engineering is jazz. Instead of \"build me an app,\" the conversation becomes:",
          "\"I need a Next.js application with Tailwind styling. Let's think through the architecture first. We're deploying to Vercel, so we need to consider their edge functions. The database will be PostgreSQL. How should we structure the API routes to handle authentication flow?\"",
          "You're not prompting. You're architecting through conversation.",
          "AI helps you research the ecosystem. You learn why Next.js App Router matters. Why Tailwind's utility classes scale. How Vitest catches edge cases. Each response deepens your understanding while narrowing the AI's focus.",
          "Then and only then you build. Component by component. Test by test. Each piece is aware of its place in the system. Every production app has a dialogue history. Not a prompt. A conversation.",
        ],
      },
      {
        heading: "The Moment Everything Changed",
        paragraphs: [
          "The moment I knew everything had changed wasn't when my app compiled. It was when a stranger paid for something I'd built through conversation.",
          "I finally understood what I'd been missing in Programming 1. Code isn't syntax. It's systems thinking expressed through language. Context engineering taught me to think in systems while the AI handled the syntax.",
        ],
      },
      {
        heading: "The Future Isn't What They Promised",
        paragraphs: [
          "The future of software isn't about replacing programmers or democratizing code through vibe coding. It's about evolution. The best builders of tomorrow won't be those who memorize syntax or those who prompt blindly. They'll be the ones who can architect through conversation, who can teach an AI their vision while learning from its process.",
          "They'll be context engineers. Vibe coding gave us wings but not the discipline to fly straight. Context engineering provides both the power and the flight plan. The revolution isn't coming. It's here, but it looks nothing like what they promised.",
          "Ready to build AI systems the right way? <a href='/' class='text-accent hover:underline'>Acuity Health</a> can help you architect AI automations that actually make it to production.",
        ],
      },
    ],
    takeaway:
      "Stop vibe coding. Start context engineering. The best AI-built software comes from architectural conversation, not wishful prompting.",
  },
  {
    slug: "from-sequential-to-parallel",
    title: "From Sequential to Parallel: Why Your Business Needs to Think Like a GPU",
    description:
      "The shift from linear thinking to parallel execution is reshaping business. Companies that adapt will operate like beehives, not assembly lines.",
    readingTime: "5 min read",
    date: "2025-10-26",
    tags: ["AI strategy", "Business transformation"],
    sections: [
      {
        heading: "We're wired to think in steps",
        paragraphs: [
          "Almost every business owner thinks sequentially, and I don't blame them. It's human nature. Our ancestors survived by thinking in steps: we must eat, therefore we must hunt, then we cook for the tribe. Over thousands of years, this instinct became the foundation of how we work, plan, and build.",
          "Modern business psychology still runs on that same wiring. Checklists, meetings, quarterly goals. Everything is built on sequence and control. The CPU embodied that logic: one task after another, efficiently executed. That mindset powered the modern world, from the moon landing to billion-dollar industries. But it is also what holds most companies back today.",
        ],
      },
      {
        heading: "The GPU changed everything",
        paragraphs: [
          "The GPU changed everything. Instead of one brain working fast, it became thousands thinking together. That parallel design gave rise to AI, intelligence that learns, adapts, and acts all at once. Look at search. For decades, Google worked in sequence: crawl, index, retrieve. Now ChatGPT or Perplexity can sweep across the internet in a single motion, synthesizing meaning rather than listing links. This is not faster search; it's a new kind of cognition.",
          "Yet most companies still behave like CPUs. Bureaucracy kills ideas one approval at a time. Layers of management throttle creativity. Work moves in lines, not networks. The businesses that adapt will operate like beehives: thousands of small, synchronized actions moving toward one purpose.",
        ],
      },
      {
        heading: "What parallel business looks like",
        paragraphs: [
          "Take an eyecare practice. In the linear world, a patient calls to book, a receptionist confirms, reminders go out later. If ten people call, nine wait. In the parallel world, an AI handles every call at once, books appointments, processes payments, and updates records in real time. The team spends less time managing and more time caring. The practice hums like a hive, every part aware of the whole. Learn more about building AI automations at <a href='/' class='text-accent hover:underline'>Acuity Health</a>.",
        ],
      },
      {
        heading: "The shift is already here",
        paragraphs: [
          "The shift from linear to exponential is already here. The only question left is whether your practice, and your mind, are ready to move from sequence to simultaneity.",
        ],
      },
    ],
    takeaway:
      "Modern businesses must evolve from sequential thinking to parallel execution—operating like beehives where thousands of synchronized actions move toward one purpose.",
  },
  {
    slug: "database-is-your-brain",
    title: "Upgrade Your Database: Why It's About to Become Your Brain",
    description:
      "Legacy systems block AI agents from accessing the intelligence that makes your practice unique. Modernize your data layer to compete.",
    readingTime: "4 min read",
    date: "2025-10-16",
    tags: ["AI strategy", "Data modernization"],
    sections: [
      {
        heading: "Small practices aren't ready for the AI era",
        paragraphs: [
          "The AI revolution is here, and most small practices aren't prepared for it.",
          "If you're running on the same tech stack from when you first opened, you're leaving money on the table. Upgrading your database infrastructure isn't just about keeping up—it's crucial to boost revenue, unlock AI-driven insights, and prepare for the biggest business transformation of our lifetime.",
        ],
      },
      {
        heading: "The problem: built for yesterday",
        paragraphs: [
          "Most eyecare practices inherited their tech stack at launch—an all-in-one package for scheduling, billing, and patient management. Convenient, but outdated. These systems were built in the early 2000s, before cloud computing and AI agents existed.",
          "AI agents can't access data locked in legacy systems. If you wait to upgrade until you need it, you'll be playing catch-up while competitors scale effortlessly. Future-proof now, not later.",
        ],
      },
      {
        heading: "The revolution: from storage to intelligence",
        bullets: [
          "Your practice philosophy: Why you exist, what you stand for, how you make decisions",
          "Growth strategy: Your 1-year, 5-year, 10-year vision",
          "Patient insights: What motivates patients, what concerns they have, what language resonates",
          "Service stories: Why each service exists, who it serves, what makes it unique",
          "Tribal knowledge: Lessons from past mistakes, wisdom from your team, context behind every decision",
          "Your competitive edge: What makes you different, what only you can provide",
        ],
        paragraphs: [
          "For decades, databases stored one thing: structured data. Appointment counts. Patient IDs. Billing codes. Just numbers in rows and columns.",
          "But modern databases don't just store data—they store intelligence.",
          "Think about what your practice knows that isn't a number:",
          "Right now, all of this lives scattered across people's brains, old documents, and forgotten conversations. What if it lived in one accessible place, ready for AI agents to understand and use?",
        ],
      },
      {
        heading: "Why this changes everything",
        paragraphs: [
          "When your database stores intelligence, AI agents can make strategic decisions that align with your practice philosophy. They don't just execute tasks—they understand context, anticipate opportunities, and act like they've worked at your practice for years.",
          "An AI with access to your intelligence layer doesn't just process appointments. It understands why you make the decisions you make, what your patients truly value, and how to scale your unique approach. It can identify patterns you've missed, suggest strategies aligned with your growth plan, and operate with the wisdom of your best employees.",
          "This is augmentation, not automation. Amplifying human wisdom at scale. Ready to modernize your infrastructure? Check our <a href='/faq' class='text-accent hover:underline'>FAQ</a> to learn how we approach data modernization.",
        ],
      },
      {
        heading: "Build the foundation now",
        paragraphs: [
          "We're entering the largest explosion of economic growth in human history, driven by AI. The practices that thrive will be the ones that built modern infrastructure before they needed it.",
          "Your database is about to become your practice's brain—storing not just transactions, but the intelligence that makes your practice unique. The foundation you build today determines the insights you'll unlock tomorrow.",
          "Start building now. Your future revenue depends on it.",
        ],
      },
    ],
    takeaway:
      "Modernize your data infrastructure today so AI agents can access the intelligence that sets your practice apart tomorrow.",
  },
  {
    slug: "foundation-holds-you-back",
    title: "When the Foundation Holds You Back: Why Eyecare Practices Struggle to Unlock AI",
    description:
      "Without a solid data foundation, AI agents can't deliver the value practice owners expect. Here's how to get the infrastructure right.",
    readingTime: "2 min read",
    date: "2025-10-15",
    tags: ["AI readiness", "Data infrastructure"],
    sections: [
      {
        heading: "The AI dream vs. the data reality",
        paragraphs: [
          "We're seeing an exciting trend: eyecare practice owners are eager to use AI, but too often lack the proper infrastructure to support it.",
          "Think of it like building a house. You can dream of a stunning rooftop deck, but you can't build it if the foundation isn't solid. In the world of AI, that foundation is your data pipeline.",
        ],
      },
      {
        heading: "AI agents need unified context",
        paragraphs: [
          "AI agents thrive on context. They can make decisions, draw insights, and automate tasks, but only if they have reliable, unified data.",
          "Unfortunately, many practices still store information in silos, or worse, on paper. Disconnected data is the reason promising AI initiatives stall.",
        ],
      },
      {
        heading: "Lay the groundwork before you sprint",
        paragraphs: [
          "Before you can run with AI, you must crawl. Build the right infrastructure: clean data, shared systems, documented processes. Then AI suddenly becomes repeatable and scalable.",
          "Once you shore up the foundation, you can deploy agents confidently and finally see the payoff you imagined. Want to learn more about our approach? Visit our <a href='/#about' class='text-accent hover:underline'>About section</a> to meet the team.",
        ],
      },
    ],
    takeaway:
      "Shore up your data foundation first, and AI becomes the growth engine it was meant to be.",
  },
];

export function getPostBySlug(slug: string) {
  return posts.find((post) => post.slug === slug);
}
