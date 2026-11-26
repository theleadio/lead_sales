// Funnels built from the captured page text in ../src (see ../generic.ts).
import { buildFunnel, loadPayments, type PageDef } from "../generic.ts";
import type { FunnelSpec } from "../kit.ts";

const pay = loadPayments();
const CERT = "Certification";
const DAY = "1 Day Mastery";

const DEFS: PageDef[] = [
  { file: "ai-full-stack-en", slug: "ai-full-stack-en", name: "AI Full-Stack Building Certification (EN)", folder: CERT, lang: "en", basePath: "/en/courses/ai-full-stack-building-certification", pay: "/ai-full-stack-building-certification-payment-form", chrome: true, notes: [] },
  { file: "ai-full-stack-cn", slug: "ai-full-stack-cn", name: "AI全栈开发认证课 (CN)", folder: CERT, lang: "zh", basePath: "/cn/courses/ai-full-stack-building-certification", pay: "/cn/ai-full-stack-building-certification-payment-form", chrome: true, notes: [] },
  { file: "professional-ai-engineering-en", slug: "professional-ai-engineering-en", name: "Professional AI Engineering Certification (EN)", folder: CERT, lang: "en", basePath: "/en/courses/professional-ai-engineering-certification", pay: "/professional-ai-engineering-certification-payment-form", chrome: true, notes: [] },
  { file: "ai-for-data-science-en", slug: "ai-for-data-science-en", name: "AI for Data Science Certification (EN)", folder: CERT, lang: "en", basePath: "/en/courses/ai-for-data-science", chrome: true, notes: [] },
  { file: "ai-agents-foundation", slug: "ai-agents-foundation", name: "AI Agents Foundation", folder: CERT, lang: "en", basePath: "/ai-agents-foundation", pay: "/cn/ai-agents-foundation-form", chrome: false, notes: [] },
  { file: "ai-vibe-coding-cn", slug: "ai-vibe-coding-cn-kl", name: "AI Vibe Coding 实战课 (CN, KL)", folder: DAY, lang: "zh", basePath: "/cn/workshop/vibe-coding-mastery", pay: "/ai-vibe-coding-mastery-payment-form", chrome: true, notes: [] },
  { file: "ai-vibe-coding-cn-jb", slug: "ai-vibe-coding-cn-jb", name: "AI Vibe Coding 实战课 (CN, JB)", folder: DAY, lang: "zh", basePath: "/cn/workshop/vibe-coding-mastery-jb", chrome: true, notes: [] },
  { file: "claude-ai-mastery-en", slug: "claude-ai-mastery-en", name: "Claude AI Mastery (EN)", folder: DAY, lang: "en", basePath: "/en/workshop/claude-ai-mastery", pay: "/claude-ai-mastery-payment-form", chrome: true, notes: [] },
  { file: "youth-vibe-coding-bootcamp-en", slug: "youth-vibe-coding-bootcamp-en", name: "Youth Vibe Coding Bootcamp (EN)", folder: DAY, lang: "en", basePath: "/en/workshop/youth-vibe-coding-bootcamp", pay: "/youth-vibe-coding-bootcamp-payment-form", chrome: false, notes: [] },
  { file: "ai-agents-online-workshop-en", slug: "ai-agents-online-workshop-en", name: "AI Agents Online Workshop EN (SP)", folder: "Online Workshop", lang: "en", basePath: "/ai-agents-online-workshop", pay: "/ai-agents-online-workshop-payment-form", chrome: false, notes: [] },
  { file: "aios-workshop-cn", slug: "aios-workshop-cn", name: "AI Agents Workshop CN (SP)", folder: "Workshop", lang: "zh", basePath: "/cn/aios-workshop", pay: "/cn/aios-workshop-payment-form", chrome: false, notes: [] },
  { file: "lead-programs-intention-form", slug: "lead-programs-intention-form", name: "LEAD programs intention form", folder: CERT, lang: "en", basePath: "/program", chrome: false, notes: [] },
];

export const GENERATED: FunnelSpec[] = DEFS.map((d) => buildFunnel(d, pay));
