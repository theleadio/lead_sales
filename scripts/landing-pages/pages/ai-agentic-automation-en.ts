// AI Agentic Automation Certification (EN), copied from
// https://ai.thelead.io/en/courses/ai-agentic-automation-certification and its
// payment step on 25 Nov 2026.
import {
  btn, C, card, counter, faq, h1, h2, h3, icon, img, leadForm, logos, M, one, orderForm, p, pageOf, row, sec, slider,
  social, ul, type FunnelSpec,
} from "../kit.ts";
import { footer, header, aboutLead, TRUSTED_LOGOS, LEAD_LOGO } from "./shared.ts";

const COURSE = "AI Agentic Automation Certification";
const BASE = "/en/courses/ai-agentic-automation-certification";
const PAY = "/ai-agentic-automation-certification-payment-form";
const DATE_LINE = "7 - 8 December 2026 (Mon, Tues) | 9AM - 5PM | AI365 Hub, Oval Damansara (In-person)";

const hero = sec(
  { name: "Hero", pt: 24, pb: 56 },
  one(img("https://files.leadconnectorhq.com/file/6a22902afc95b24549824526/img-0055.jpeg", `${COURSE} banner`)),
  one(
    h1(COURSE, { align: "center" }),
    h2("Build Practical AI Agents and Automations in 2 Days", { size: { d: 26, m: 20 }, weight: 600 }),
    p("Learn how AI agents and automation work, then use n8n and modern large language models to build workflows around real business processes.", { align: "center" }),
    p("The workshop focuses on implementation. You will learn how to spot work where AI could improve efficiency and output by 2x, 3x, or even 5x to 10x. You will also look at tasks that were difficult or impossible before AI.", { align: "center" }),
    p(`<b>${DATE_LINE}</b>`, { align: "center", color: C.ink }),
    btn("Sign Up Here", { url: PAY }, { sub: "Limited Seats 🚀", size: 20 }),
  ),
);

const who = sec(
  { name: "Who should attend", bg: C.pale },
  one(h2("WHO SHOULD ATTEND?")),
  row(
    "2",
    [
      [img(M("6a74abb66da442d0ad72589b.jpeg"), "Two professionals building an automated workflow")],
      [
        h3("✅ Founders, C-Suite leaders"),
        p("You want to find practical uses for AI automation across the business and increase output without adding more manual work."),
        h3("✅ Managers in HR, Marketing, Finance, Operations, and Customer Care"),
        p("Your team spends too much time handling documents, spreadsheets, email, reports, content, or internal requests. This course shows how to connect those tasks in an automated workflow."),
        h3("✅ Business professionals and digital consultants"),
        p("You are responsible for AI adoption and need working n8n examples and implementation patterns, not theory alone."),
        h3("✅ Beginners, non-engineers, and non-programmers"),
        p("You do not need a technical background. n8n has a visual, drag-and-drop interface for connecting triggers, actions, apps, and AI models without traditional coding."),
      ],
    ],
    { valign: "center", gap: 40 },
  ),
  one(h2("PRACTICAL HANDS-ON PROJECTS", { box: { mt: 32 } })),
  row("3", [
    card([icon(M("6a74a97b9a9c7792ea12cb46.png"), "HR chat agent", 150), h3("HR chat agent"), p("Build an HR specialist that responds when an employee sends a chat message. The agent uses a Google Gemini chat model, keeps track of the conversation with simple memory, and retrieves information from Google Docs before answering. This lab introduces the three parts of an AI agent: a model, memory, and tools.")]),
    card([icon(M("6a74a9ba568ec73524c1ffd1.png"), "Receipt to Google Sheets", 150), h3("Receipt to Google Sheets"), p("Create an expense claim workflow that receives a receipt through a form and reads it with AI image analysis. It extracts the restaurant name, date, service charge, and total amount, then records the data in Google Sheets. The lab combines Gemini for OCR with OpenAI for structured information extraction.")]),
    card([icon(M("6a74a97b568ec73524c1302f.png"), "Receipt to email", 150), h3("Receipt to email"), p("Build another expense claim workflow, this time with email as the final destination. A form receives the receipt, AI analyses the image, and a language model processes the extracted information. The workflow combines the original submission with the AI output, then sends the completed result through Gmail.")]),
  ]),
  row("3", [
    card([icon(M("6a74a97b5bc1e4f91ba54bb7.png"), "Financial report analyser", 150), h3("Financial report analyser"), p("Turn an uploaded financial report into an AI-summarised HTML dashboard. The workflow reads the PDF, summarises the report, identifies financial ratios, and generates a themed dashboard. It then converts the HTML into a file and returns it to the user as an immediate download from the form completion page.")]),
    card([icon(M("6a74a97b5bc1e4f91ba54baa.png"), "Restaurant order receipt", 150), h3("Restaurant order receipt"), p("Create a workflow that turns a form submission into a structured restaurant order receipt. An AI agent uses an OpenAI chat model and a structured output parser to organise the result. The workflow places the output into an HTML template and displays the finished receipt on the form completion page.")]),
    card([icon(M("6a74a97bbd6349ece22ef8ab.png"), "Personalised greeting cards", 150), h3("Personalised greeting cards"), p("Generate a personalised New Year greeting card for every customer in a Google Sheet. The workflow reads each customer's name and industry, then uses an image model to create a photorealistic card with relevant visual details and custom text. One workflow run can process the full customer list.")]),
  ]),
);

const t = (title: string, body: string) => p(`<b>${title}:</b> ${body}`);
const topics = sec(
  { name: "Topics covered" },
  one(h2("TOPICS COVERED")),
  row(
    "2",
    [
      [
        h3("Day 1 - AI, agent, and automation foundations"),
        ...([
          t("Three levels of AI adoption", "Understand how enterprises progress from using standalone AI tools to connected automation and agentic workflows."),
          t("n8n workflow fundamentals", "Learn how the visual workflow builder connects apps and services without traditional coding."),
          t("Triggers, nodes, and workflow logic", "See how an event starts a workflow and how each connected node carries out the next action."),
          t("CO-STAR agent prompting", "Define Context, Objective, Style, Tone, Audience, and Response so an AI agent behaves more consistently."),
          t("HR chat agent", "Build an HR specialist with a Google Gemini chat model, simple memory, and access to information stored in Google Docs."),
          t("Expense claim automation", "Read uploaded receipts with AI, extract structured information, record it in Google Sheets, and send results through Gmail."),
        ]),
        img(M("6a74ad27f4dee0f60f56d838.jpeg"), "Workshop in session"),
      ],
      [
        h3("Day 2 - Applied workflows, cost, and deployment"),
        ...([
          t("Financial report analyser", "Read an uploaded PDF, summarise the report, identify financial ratios, and return a themed HTML dashboard as a download."),
          t("Restaurant order receipt", "Use an AI agent and structured output parser to turn a form submission into a finished HTML receipt."),
          t("Personalised greeting cards", "Read a customer list from Google Sheets and generate an industry-specific greeting card for every customer in one workflow run."),
          t("Business automation workflows", "Build a Telegram assistant for text and voice, validate timesheets, and turn meeting recordings into to-do items in Google Sheets."),
          t("Additional workflow patterns", "Analyse survey sentiment, scrape websites on a schedule, send alerts, and generate single or multiple images with AI."),
          t("AI cost, models, and hosting", "Compare subscriptions with APIs, estimate token costs, understand the agentic automation stack, explore Ollama and LM Studio, and review n8n hosting options."),
        ]),
      ],
    ],
    { gap: 40 },
  ),
  one(h2("WHAT YOU WILL LEARN", { box: { mt: 32 } })),
  row("2", [
    card([icon(M("69b45c5bcab7f7cc72b5d969.svg"), "", 60), h3("Build visual automation workflows"), p("Connect triggers and nodes in n8n, then chain actions together to automate a process without traditional coding.")], C.pale),
    card([icon(M("69b45c5be8487c5cd67f97dc.svg"), "", 60), h3("Create more consistent AI agents"), p("Combine chat models, memory, and tools. Use the CO-STAR framework to define the agent's persona, objective, writing style, tone, audience, and response format.")], C.pale),
  ]),
  row("2", [
    card([icon(M("69b45c5bfb38cafc359804e9.svg"), "", 60), h3("Turn business inputs into usable outputs"), p("Work with receipts, PDFs, spreadsheets, survey responses, images, and recordings. Extract structured information and send the results to Google Sheets, Gmail, Telegram, downloadable files, or HTML dashboards.")], C.pale),
    card([icon(M("69b45c5bd5481730a0272dc6.svg"), "", 60), h3("Plan for cost, infrastructure, and deployment"), p("Compare SaaS subscriptions with usage-based APIs. Use token counts to estimate costs, compare models against actual tasks, explore local model options, and understand managed and self-hosted n8n deployments.")], C.pale),
  ]),
);

const result = (gif: string, title: string, body: string, stat: string) =>
  card([img(M(gif), title), h3(title), p(body), p(`<b>${stat}</b>`, { color: C.purple })], C.pale);
const results = sec(
  { name: "Real projects" },
  one(h2("REAL PROJECTS. REAL RESULTS.")),
  row("2", [
    result("69a5a1d238a5f1469bffd3c3.gif", "Internal Knowledge Base Chatbot", "AI now handles about 70% of routine customer questions, so the support team can focus on the ones that actually need a human.", "70% of routine queries automated"),
    result("69a5a1d287d8670790a4cc2f.gif", "Content Marketing Automation", "From drafting articles to pushing posts live on social. The whole content flow now runs automatically, with output roughly doubled and performance fully trackable.", "2× content output, zero manual effort"),
  ]),
  row("2", [
    result("69a5a1d2e07e3612eff83b66.gif", "Invoice Archiving + Report Generation", "Invoices are auto-filed and monthly reports generated without manual work — saving around 40 hours every month and greatly reducing data errors.", "40 hours saved every month"),
    result("69a5a1d2b617a73bf4869f8f.gif", "Customer Onboarding Automation", "New leads now move smoothly from CRM to calendar booking to email follow-ups — helping increase conversion by about 30%.", "~30% increase in conversion rate"),
  ]),
);

const PERKS = [
  "2 full days of in-person intensive training",
  "Lunch Included (Provided by a Halal-Certified Caterer)",
  "Complete programme materials, tools and templates",
  "Certificate of Completion",
  "3-month post-training WhatsApp group support",
  "Unlimited refresher class access*",
  "Bonus 1: Premium AI Model Tokens (US$100 in Free Credits)",
  "Bonus 2: Three (3) Months of n8n Hosting",
];
const ROCKET = M("6a7409e9ac7d7ffc64029b10.jpg");
const plan = (name: string, tag: string, price: string, chip: string, perks: string[], cta: ReturnType<typeof btn>) =>
  card(
    [
      icon(ROCKET, "", 56, { box: { mb: 0 } }),
      h3(name, { color: C.purple }),
      p(tag, { size: { d: 14 } }),
      p(`<b>${price}</b> &nbsp;+8% SST`, { size: { d: 22, m: 20 }, color: C.ink, box: { bg: chip, radius: 10, pt: 10, pb: 10, pl: 14, pr: 14 } }),
      ul(perks, { size: { d: 15 } }),
      cta,
    ],
    C.white,
    24,
  );
const details = sec(
  { name: "Course details and fee" },
  one(h2("COURSE DETAILS")),
  row("2", [
    card([
      p("<b>Date:</b> 7-8 Dec 2026 (Mon, Tue)", { color: C.ink }),
      p("<b>Time:</b> 9AM – 5PM", { color: C.ink }),
      p("<b>Language:</b> English", { color: C.ink }),
      p("<b>Venue:</b> AI365 Hub, Oval Damansara", { color: C.ink }),
    ], C.pale),
    card([
      h3("KEY TECHNOLOGIES", { align: "center" }),
      logos([M("69b3bc96cab7f783b19e845b.png"), M("69b3bc96cab7f74c8f9e845a.png"), M("69b3bc96bfc81ffd41e0d03a.png"), M("69c2845275ee053efe5b0c9f.jpg"), M("6a6b3ff8f982994d1593a346.jpg")], 44),
    ], C.pale),
  ]),
  one(h2("COURSE FEE", { box: { mt: 32 } })),
  row("3", [
    plan("Self-Funded", "Kickstart your AI Automation journey", "RM 3,200", C.slate, PERKS, btn("Sign Up Now", { url: PAY }, { full: true })),
    plan("HRDC-Claimable", "Upskill with your company's HRDC grant", "RM 3,500", C.amber, PERKS, btn("Fill Up Form", { form: true }, { full: true })),
    plan(
      "Certification + Coaching",
      "Accelerate with personalised mentorship",
      "RM 9,250",
      C.lilac,
      ["Everything in the Certification", "Personalised career & AI skills roadmap", "4 x 30-min personal coaching sessions with Dr. Lau or Edmund", "1-year ongoing guidance for real-world implementation"],
      btn("Email Us", { url: "mailto:support@thelead.io" }, { full: true }),
    ),
  ]),
  one(p("* Graduates are entitled to unlimited access to refresher classes, subject to an RM300 administrative fee.", { align: "center", size: { d: 14 } })),
);

const faqs = sec(
  { name: "FAQ", bg: C.pale, width: "medium" },
  one(
    h2("Frequently Asked Questions (FAQs)"),
    faq([
      ["Is this course suitable for beginners?", "Yes. The programme is for business professionals, complete beginners, non-engineers, and non-programmers. n8n uses a visual, drag-and-drop interface. The course covers the basics of triggers and nodes before moving on to AI agents, memory, tools, and hands-on workflows."],
      ["Is there any prerequisite?", "You do not need programming experience. You only need curiosity, an interest in applying AI to real business processes, and some exposure to ChatGPT or a similar AI tool."],
      ["What are the hardware requirements?", "A laptop with a reliable internet connection is enough. If you use a company-managed laptop, contact us for the list of websites that may need to be whitelisted."],
      ["Is this course HRDC claimable?", 'Yes. The programme is 100% HRDC-claimable for eligible Malaysian companies, and we will provide the required documents. For HRDC enquiries, WhatsApp us at <a href="https://wa.me/60182777989">+6018-2777 989</a>'],
      ["Will there be a certificate?", "Yes. We assess your participation in class and your contribution to the final presentation."],
      ["Will I have projects in my portfolio?", "Yes. You will work on n8n workflows such as an HR chat agent, receipt OCR, PDF analysis, image generation, a Telegram assistant for text and voice, timesheet validation, and meeting-to-do automation. For each workflow, you will see how it starts, processes information, connects models and tools, and produces a useful output."],
    ]),
  ),
);

const trainers = sec(
  { name: "Trainers" },
  one(h2("YOUR EXPERT TRAINERS")),
  row("2", [
    card([
      img(M("69b3b3d8277ba0de57c105d3.png"), "Dr. Lau Cher Han"),
      h3("Dr. Lau Cher Han"),
      p("This Agentic AI Automation certification is designed and led by Dr. Lau, AI engineer, chief data scientist and founder of LEAD."),
      p("Dr. Lau is a highly sought-after trainer in AI, data science and emerging technology, with a strong track record of training leaders and individuals from OCBC Bank, TNB, Intel, IBM, Dell, PLUS, Shell and F&amp;N."),
      p("In 2025 alone, he trained over 1,200+ professionals across more than 200 organisations, helping them adopt AI technologies and implement real-world automation solutions."),
      p("Find out more about Dr. Lau Cher Han on:"),
      social([["linkedin", "https://www.linkedin.com/in/drhanlau/"], ["facebook", "https://www.facebook.com/drhanlau"]]),
    ], C.pale),
    card([
      img(M("69b82002913053317e17e7ea.png"), "YeeSheng Choon"),
      h3("YeeSheng, Choon"),
      p("YeeSheng Choon, CFP®, is a Bank Negara approved Financial Adviser Representative who specialises in turning complex, regulation heavy workflows into structured, automated systems."),
      p("At LEAD, YeeSheng focuses on practical AI automation and using AI agents to read information, make decisions and trigger actions with human in the loop control."),
      p("He helps professionals build automations that are efficient, auditable and compliant, tightly aligned with real business outcomes in industries where trust and precision matter."),
      p("Find out more about YeeSheng on:"),
      social([["linkedin", "https://www.linkedin.com/in/yeeshengchoon/"]]),
    ], C.pale),
  ]),
);

const form = sec(
  { name: "Interest form", bg: C.dark, width: "small" },
  one(
    h2("AI Agentic Automation Interest Form", { color: C.white }),
    p("Kindly fill in the form and our course coordinator will contact you via WhatsApp.", { align: "center", color: "#e5e7eb" }),
    leadForm(
      {
        type: "interest",
        formName: "AI Agentic Automation Interest Form",
        fields: ["company"],
        createDeal: true,
        after: { kind: "message", text: "Thank you! Our course coordinator will contact you via WhatsApp." },
      },
      "Submit",
    ),
    icon("https://storage.googleapis.com/highlevel-backend.appspot.com/location/szVYTdKpbjBJvbLHEDmm/form/64TX22F0PcaWfJbOLBIJ/33b605a0-d161-4e57-be92-81e4ab442df7.png", "HRDC logo", 60),
    p('For Programme Enquiries: <a href="mailto:hi@thelead.io">hi@thelead.io</a>', { align: "center", color: "#e5e7eb" }),
    p('For Corporate Training: <a href="mailto:daphne@thelead.io">daphne@thelead.io</a>', { align: "center", color: "#e5e7eb" }),
  ),
);

const pieces = sec(
  { name: "How the pieces fit", width: "medium" },
  one(
    h2("Learn how the pieces of AI automation fit together", { size: { d: 24, m: 20 } }),
    p("AI automation connects business inputs, APIs and data formats, an orchestration tool such as n8n, AI models, agent memory and tools, and output channels such as Gmail, Microsoft Teams, Telegram, Google Sheets, and downloadable files."),
    p("During the two-day workshop, you will build n8n workflows that:"),
    ul([
      "Respond to chat messages using context, memory, and tools",
      "Read receipts, PDFs, spreadsheets, images, and recordings",
      "Extract structured data and make rule-based decisions",
      "Create reports, dashboards, personalised images, and action lists",
      "Send results to the business tools your team already uses",
      "Estimate token costs, compare access models, and review hosting options",
    ]),
    p("By the end of the programme, you will know what to automate, how to structure an AI workflow, and how models and tools work together in a business system."),
  ),
);

const landing = pageOf(
  header([["What You'll Learn", "#"], ["Course Details", "#"], ["Trainers", "#"], ["About LEAD", "#"]]),
  hero, who, topics, results, details, faqs, trainers, aboutLead(), TRUSTED_LOGOS(), form, pieces, footer(),
);

// ---- payment step ----------------------------------------------------------
const INTAKES = [
  "AI Agentic Automation Certification (English) | 7-8 December 2026 (Mon, Tues) @ AI365 Hub, Oval Damansara",
  "AI Agentic Automation Certification (English) | 27-28 January 2027 (Wed, Thu) @ AI365 Hub, Oval Damansara",
];
const payment = pageOf(
  sec(
    { name: "Payment", width: "small", pt: 40 },
    one(
      icon(LEAD_LOGO, "LEAD", 48),
      h2("LEAD - AI Agentic Automation Certification Payment Form", { size: { d: 22, m: 19 } }),
      p("Fill up personal information &amp; intake", { align: "center" }),
      h3("Intake 1: " + INTAKES[0], { size: { d: 16 }, box: { mt: 16 } }),
      p("RM3,200.00 + SST (8%) RM256.00 = <b>RM3,456.00</b>", { color: C.ink }),
      orderForm("ai-agentic-automation-certification-2026-12-07-en", "Pay for 7-8 Dec 2026"),
      h3("Intake 2: " + INTAKES[1], { size: { d: 16 }, box: { mt: 24 } }),
      p("RM3,200.00 + SST (8%) RM256.00 = <b>RM3,456.00</b>", { color: C.ink }),
      orderForm("ai-agentic-automation-certification-2027-01-27-en", "Pay for 27-28 Jan 2027"),
      p("* Payments are non-refundable but transferable *", { align: "center", size: { d: 14 }, box: { mt: 16 } }),
    ),
  ),
);

const thanks = pageOf(
  sec(
    { name: "Thank you", width: "small", pt: 80, pb: 80 },
    one(
      icon(LEAD_LOGO, "LEAD", 48),
      h2("Thank you for registering!"),
      p(`Your payment for the ${COURSE} has been received. Our course coordinator will contact you via WhatsApp with the class details.`, { align: "center" }),
      p('Questions? Email <a href="mailto:hi@thelead.io">hi@thelead.io</a> or WhatsApp <a href="https://wa.me/60173767946">+6017 376 7946</a>.', { align: "center" }),
    ),
  ),
);

export const spec: FunnelSpec = {
  slug: "ai-agentic-automation-en",
  name: "AI Agentic Automation Certification (EN)",
  folder: "Certification",
  language: "en",
  basePath: BASE,
  source: ["https://ai.thelead.io" + BASE, "https://ai.thelead.io" + PAY],
  settings: {
    theme: { headFont: "Poppins", bodyFont: "Poppins", text: C.body, link: "#2563eb", bg: C.white },
    pixels: {},
    capi: false,
    paymentMode: "live",
    chatWidget: { whatsapp: "+60173767946" },
    seo: {
      title: "AI Agentic Automation Certification | 7 - 8 December 2026 (Mon, Tues) | 9AM - 5PM | AI365 Hub, Oval Damansara | LEAD",
      description: "Master AI agent automation with n8n & LLMs in 2 days. Build real workflows, deploy AI agents & automate operations. HRDC claimable. Limited seats.",
      image: M("6a22902afc95b24549824526.jpeg"),
    },
  },
  steps: [
    { name: "Course page", kind: "page", path: BASE, page: landing },
    { name: "Payment Form", kind: "checkout", path: PAY, page: payment },
    { name: "Thank You", kind: "thank_you", path: BASE + "/thank-you", page: thanks },
  ],
  notes: [],
};
void slider; void counter;
