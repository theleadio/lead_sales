// Turns a captured SalesProcess page (src/*.txt, one line per block) into a v2
// funnel spec. The .txt files are the page content as it was on ai.thelead.io on
// 25 Nov 2026, in reading order; this file only decides how blocks are laid out.
//
// Line format: `kind<TAB or space>rest`. kinds: h1-h4, p, ul (items split by ‖),
// img (src alt), btn (text href), faq (question ⟂ answer), logos (a,b,c),
// price, media, form (title), trainers (intro), `#` starts a section.
// `~` lines are title, description, share image. `%base` reuses another file.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  btn, C, card, embed, faq, fundingField, h1, h2, h3, icon, img, leadForm, logos, M, one, orderForm, orderIntakes, p, pageOf, row, sec, ul,
  type ColSpec, type FunnelSpec, type StepSpec,
} from "./kit.ts";
import type { CustomField } from "../../lib/sites/model.ts";
import type { Element } from "../../lib/sites/tree.ts";
import { aboutLead, aboutLeadCn, footer, footerCn, header, LEAD_LOGO, trustedLogos } from "./pages/shared.ts";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "src");
const read = (f: string) => readFileSync(join(SRC, f), "utf8");

type Line = { k: string; a: string; b?: string };
export type Parsed = { path: string; title: string; desc: string; og: string; sections: Line[][] };

const plain = (h: string) => h.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim();
const SEP = /\t| ⟂ /;

function loadLines(file: string, seen = new Set<string>()): string {
  const text = read(file);
  const m = /^%base (\S+)/m.exec(text);
  if (!m) return text;
  if (seen.has(m[1])) throw new Error("base loop");
  seen.add(m[1]);
  let base = loadLines(m[1] + ".txt", seen);
  for (const l of text.split("\n")) {
    if (l.startsWith("%sub ")) {
      const [from, to] = l.slice(5).split(" ⟂ ");
      if (!base.includes(from)) throw new Error(`${file}: %sub text not found: ${from.slice(0, 40)}`);
      base = base.split(from).join(to);
    } else if (l.startsWith("%dropbtn ")) {
      const u = l.slice(9).trim();
      base = base.split("\n").filter((x) => !(x.startsWith("btn") && x.includes(u))).join("\n");
    }
  }
  // meta lines of this file override the base
  const meta = text.split("\n").filter((l) => l.startsWith("@") || l.startsWith("~"));
  const rest = base.split("\n").filter((l) => !l.startsWith("@") && !l.startsWith("~"));
  return [...meta, ...rest].join("\n");
}

export function parse(file: string): Parsed {
  const out: Parsed = { path: "", title: "", desc: "", og: "", sections: [] };
  let meta = 0;
  for (const raw of loadLines(file).split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line) continue;
    if (line.startsWith("@")) out.path = line.slice(1);
    else if (line.startsWith("~")) {
      const v = line.slice(1);
      if (meta === 0) out.title = v;
      else if (meta === 1) out.desc = v;
      else if (meta === 2) out.og = v;
      meta++;
    }
    else if (line === "#") out.sections.push([]);
    else {
      const i = line.search(/[\t ]/);
      const k = i < 0 ? line : line.slice(0, i);
      const rest = i < 0 ? "" : line.slice(i + 1).trim();
      let a = rest;
      let b: string | undefined;
      if (k === "img") {
        const j = rest.search(/\s/);
        a = j < 0 ? rest : rest.slice(0, j);
        b = j < 0 ? "" : rest.slice(j + 1).trim();
      } else if (k === "btn") {
        const j = rest.search(/\s\S+$/);
        a = rest.slice(0, j).trim();
        b = rest.slice(j).trim();
      } else if (k === "faq") {
        const parts = rest.split(SEP);
        if (parts.length >= 2) [a, b] = [parts[0], parts.slice(1).join(" ")];
        else {
          const m = /^(.+?[?？])\s+(.*)$/.exec(rest);
          if (!m) throw new Error(`${file}: faq line without a question: ${rest.slice(0, 40)}`);
          [a, b] = [m[1], m[2]];
        }
      }
      out.sections[out.sections.length - 1].push({ k, a, b });
    }
  }
  return out;
}

const src = (s: string) => (s.startsWith("M/") ? M(s.slice(2)) : s);
const listItems = (s: string) => s.split("‖").map((x) => x.trim()).filter(Boolean);

type Ctx = { lang: "en" | "zh"; pay?: string; formSettings: Record<string, unknown> };

function toElements(lines: Line[], c: Ctx, first: boolean): Element[] {
  const els: Element[] = [];
  let seenHeading = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const t = plain(l.a);
    if (/^h[1-4]$/.test(l.k)) {
      if (t.length > 110) els.push(p(l.a));
      else if (!seenHeading && (l.k === "h1" || l.k === "h2")) {
        seenHeading = true;
        els.push(first ? h1(l.a, { align: "center", size: { d: 40, m: 28 } }) : h2(l.a));
      } else if (l.k === "h1" || l.k === "h2") els.push(h3(l.a, { size: { d: 24, m: 20 } }));
      else els.push(h3(l.a));
      if (l.k === "h1" || l.k === "h2") seenHeading = true;
    } else if (l.k === "p") els.push(p(l.a, first ? { align: "center" } : {}));
    else if (l.k === "ul") els.push(ul(listItems(l.a).map((x) => x.replace(/<\/?li>/g, ""))));
    else if (l.k === "img") els.push(img(src(l.a), l.b ?? ""));
    else if (l.k === "price") els.push(p(`<b>${l.a}</b>`, { size: { d: 24, m: 22 }, color: C.ink, box: { bg: C.amber, radius: 10, pt: 8, pb: 8, pl: 14, pr: 14 } }));
    else if (l.k === "btn") {
      const href = l.b ?? "";
      const to = href === "#form" ? { form: true as const } : href === "#pay" ? { url: c.pay ?? "#" } : { url: href.replace(/^https:\/\/ai\.thelead\.io/, "") };
      els.push(btn(l.a, to, { align: "left" }));
    } else if (l.k === "faq") {
      const items: [string, string][] = [];
      while (i < lines.length && lines[i].k === "faq") items.push([lines[i].a, lines[i++].b ?? ""]);
      i--;
      els.push(faq(items));
    } else if (l.k === "logos") els.push(logos(l.a.split(",").map(src), 44));
    // A student demo: shown live in a sandboxed frame, with the link under it in case the site refuses framing.
    else if (l.k === "media") {
      const host = l.a.replace(/^https:\/\//, "").replace(/\/$/, "");
      els.push(embed(l.a, `Live demo: ${host}`, 520), p(`<a href="${l.a}">Open the live demo: ${host}</a>`, { size: { d: 14 } }));
    }
    else throw new Error(`unknown line kind ${l.k}`);
  }
  return els;
}

const isHead = (l?: Line) => !!l && /^h[1-4]$/.test(l.k);

// Splits a section into [lead lines, groups[], tail lines] where each group is a
// pricing card (h3 ... price ... first button) or a trainer (img + h3 ...).
function groups(lines: Line[]): { lead: Line[]; cards: Line[][]; tail: Line[] } | null {
  const starts: number[] = [];
  lines.forEach((l, i) => {
    if (l.k === "h3" && lines.slice(i + 1, i + 4).some((x) => x.k === "price")) starts.push(i);
  });
  if (starts.length >= 2) {
    const cards = starts.map((s, n) => {
      const next = starts[n + 1] ?? lines.length;
      let end = lines.findIndex((x, j) => j > s && x.k === "btn");
      if (end < 0 || end >= next) end = next - 1;
      return lines.slice(s, end + 1);
    });
    return { lead: lines.slice(0, starts[0]), cards, tail: lines.slice(starts[starts.length - 1] + cards[cards.length - 1].length) };
  }
  const imgs = lines.map((l, i) => (l.k === "img" && isHead(lines[i + 1]) ? i : -1)).filter((i) => i >= 0);
  if (imgs.length >= 2 && lines.some((l) => /TRAINER|培训师|导师|讲师|trainer/i.test(plain(l.a)))) {
    const cards = imgs.map((s, n) => lines.slice(s, imgs[n + 1] ?? lines.length));
    return { lead: lines.slice(0, imgs[0]), cards, tail: [] };
  }
  return null;
}

const colsFor = (n: number) => (n === 2 ? "2" : n === 3 ? "3" : n === 4 ? "4" : "1");

const TRAINERS_EN = (intro: string): Line[] => [
  { k: "h2", a: "YOUR EXPERT TRAINERS" },
  { k: "img", a: "M/69b3b3d8277ba0de57c105d3.png" },
  { k: "h3", a: "Dr. Lau Cher Han" },
  { k: "p", a: intro },
  { k: "p", a: "Dr. Lau is a highly sought-after trainer in AI, data science and emerging technology, with a strong track record of training leaders and individuals from OCBC Bank, TNB, Intel, IBM, Dell, PLUS, Shell and F&amp;N." },
  { k: "p", a: "In 2025 alone, he trained over 1,200+ professionals across more than 200 organisations, helping them adopt AI technologies and implement real-world automation solutions." },
  { k: "p", a: 'Find out more about Dr. Lau Cher Han on: <a href="https://www.linkedin.com/in/drhanlau/">LinkedIn</a> · <a href="https://www.facebook.com/drhanlau">Facebook</a>' },
  { k: "img", a: "M/69b3b562bfc81f5e38dffbf9.png" },
  { k: "h3", a: "Edmund Hee" },
  { k: "p", a: "Edmund is a CTO and data scientist with extensive experience at AirAsia and multiple tech startups." },
  { k: "p", a: "At LEAD, he designs and delivers hands-on programmes in Data Science 360, AI Engineering, AI Automation, and AI Analytics Certification, co-trained with Dr. Lau." },
  { k: "p", a: "With a strong blend of corporate and startup exposure, Edmund brings practical, real-world insights into every session. He has trained teams from organizations such as JPAN Sabah, MaGIC, Hitachi, and UTHM." },
  { k: "p", a: "Find out more about Edmund on: LinkedIn" },
];

function buildSection(lines: Line[], c: Ctx, idx: number, first: boolean) {
  // trainers shorthand
  if (lines.length === 1 && lines[0].k === "trainers") lines = TRAINERS_EN(lines[0].a);
  const bg = idx % 2 === 1 ? C.pale : "";
  const g = groups(lines);
  if (g) {
    const rows = [one(...toElements(g.lead, c, first))];
    const pg = g.cards.length;
    const isPrice = g.cards[0].some((l) => l.k === "price");
    const mk = (cs: Line[][]) =>
      row(colsFor(cs.length) as "2", cs.map((cl): ColSpec => card(toElements(cl, c, false), isPrice ? C.white : C.pale)));
    for (let i = 0; i < pg; i += 3) rows.push(mk(g.cards.slice(i, i + 3)));
    if (g.tail.length) rows.push(one(...toElements(g.tail, c, false)));
    return sec({ name: plain(g.lead.find((l) => isHead(l))?.a ?? "Section"), bg: isPrice ? "" : bg }, ...rows.filter((r) => r.cols.some((cc) => cc.els.length)));
  }
  const name = plain(lines.find((l) => isHead(l))?.a ?? lines.find((l) => l.k === "p")?.a ?? "Section").slice(0, 60);
  return sec({ name, bg, width: first ? "wide" : "medium", pt: first ? 24 : 56, pb: first ? 48 : 56 }, one(...toElements(lines, c, first)));
}

export type PageDef = {
  file: string; // src/<file>.txt
  slug: string;
  name: string;
  folder: string;
  lang: "en" | "zh";
  basePath: string; // the page's own path on ai.thelead.io
  pay?: string; // payment step path on ai.thelead.io (checkout step)
  chrome: boolean; // header, About LEAD, client logos and footer
  hrdc?: boolean; // the course has an HRDC-claimable fee: forms and checkout ask "self-funded or HRDC"
  sessionPick?: boolean; // the form lists the "Sessions available" bullets as tick boxes, plus in-house pax
  notes: string[];
  domain?: string;
};

const FORM_LABEL = { en: "Submit", zh: "提交" };
const THANKS = {
  en: "Thank you! Our course coordinator will contact you via WhatsApp.",
  zh: "谢谢你！课程协调员会通过 WhatsApp 联系你。",
};

// Extra questions the SalesProcess forms asked and the old builder could not.
function extraQuestions(d: PageDef, parsed: Parsed): CustomField[] {
  const out: CustomField[] = [];
  if (d.sessionPick) {
    const sessions = parsed.sections.flat().find((l, i, all) => l.k === "ul" && all[i - 1]?.a === "Sessions available");
    const options = listItems(sessions?.a ?? "").map((x) => plain(x.replace(/<\/?li>/g, "")));
    if (!options.length) throw new Error(`${d.slug}: no "Sessions available" list found`);
    out.push({ key: "sessions", label: "Which sessions are you interested in?", kind: "multi", options, required: true });
  }
  if (d.hrdc) out.push(fundingField(d.lang));
  if (d.sessionPick) out.push({ key: "inhousePax", label: "In-house training for your company: number of people (minimum 20)", kind: "pax" });
  return out;
}

export function buildFunnel(d: PageDef, payments: Map<string, { title: string; sub: string; intakes: [string, number, string][] }>): FunnelSpec {
  const parsed = parse(d.file + ".txt");
  const c: Ctx = { lang: d.lang, pay: d.pay, formSettings: {} };
  const extra = extraQuestions(d, parsed);
  const secs: ReturnType<typeof sec>[] = [];
  let formTitle = "";
  parsed.sections.forEach((lines, i) => {
    const formAt = lines.findIndex((l) => l.k === "form");
    if (formAt >= 0) {
      formTitle = lines[formAt].a;
      const before = lines.slice(0, formAt);
      const afterAll = lines.slice(formAt + 1);
      const intro = afterAll.filter((l) => l.k === "p" && !/^<b>/.test(l.a)).slice(0, 2);
      const restIdx = afterAll.findIndex((l) => l.k !== "p");
      const lead = restIdx < 0 ? afterAll : afterAll.slice(0, restIdx);
      const tail = restIdx < 0 ? [] : afterAll.slice(restIdx);
      void intro;
      void before;
      const FORM = leadForm(
        {
          type: "interest",
          formName: formTitle,
          fields: ["company"],
          ...(extra.length ? { custom: extra } : {}),
          createDeal: true,
          after: { kind: "message", text: THANKS[d.lang] },
        },
        FORM_LABEL[d.lang],
      );
      secs.push(
        sec(
          { name: formTitle, bg: C.dark, width: "small", pt: 56, pb: 56 },
          one(
            h2(formTitle, { color: C.white }),
            ...lead.map((l) => p(l.a, { align: "center", color: "#e5e7eb" })),
            FORM,
            icon("https://storage.googleapis.com/highlevel-backend.appspot.com/location/szVYTdKpbjBJvbLHEDmm/form/64TX22F0PcaWfJbOLBIJ/33b605a0-d161-4e57-be92-81e4ab442df7.png", "HRDC logo", 60),
            p(`${d.lang === "zh" ? "课程咨询" : "For Programme Enquiries"}: <a href="mailto:hi@thelead.io">hi@thelead.io</a>`, { align: "center", color: "#e5e7eb" }),
            p(`${d.lang === "zh" ? "企业培训" : "For Corporate Training"}: <a href="mailto:daphne@thelead.io">daphne@thelead.io</a>`, { align: "center", color: "#e5e7eb" }),
          ),
        ),
      );
      if (tail.length) secs.push(buildSection(tail, c, i + 1, false));
      return;
    }
    // hero: a leading run of 1-2 pictures is the banner (desktop first, phone second)
    if (i === 0) {
      const imgs: Line[] = [];
      while (lines[imgs.length]?.k === "img") imgs.push(lines[imgs.length]);
      const body = lines.slice(imgs.length);
      if (imgs.length >= 2) {
        const dk = sec({ name: "Banner (desktop)", pt: 16, pb: 0 }, one(img(src(imgs[0].a), imgs[0].b ?? "")));
        dk.hideOn = { d: false, t: true, m: true };
        const mb = sec({ name: "Banner (phone)", pt: 8, pb: 0 }, one(img(src(imgs[1].a), imgs[1].b ?? "")));
        mb.hideOn = { d: true, t: false, m: false };
        secs.push(dk, mb);
      } else if (imgs.length === 1) secs.push(sec({ name: "Banner", pt: 16, pb: 0 }, one(img(src(imgs[0].a), imgs[0].b ?? ""))));
      if (body.length) secs.push(buildSection(body, c, 0, true));
      return;
    }
    secs.push(buildSection(lines, c, i, false));
  });

  const chromeTop = d.chrome ? [header([])] : [];
  const bottom = d.chrome ? [d.lang === "zh" ? aboutLeadCn() : aboutLead(), trustedLogos(d.lang), d.lang === "zh" ? footerCn() : footer()] : [];
  const landing = pageOf(...chromeTop, ...secs, ...bottom);

  const steps: StepSpec[] = [{ name: "Landing page", kind: "page", path: d.basePath, page: landing }];
  if (d.pay) {
    const pm = payments.get(d.pay);
    if (!pm) throw new Error(`${d.slug}: no payment data for ${d.pay}`);
    const intakes = pm.intakes.filter(([, price]) => price > 0);
    const blocks: Element[] = [
      icon(LEAD_LOGO, "LEAD", 48),
      h2(pm.title, { size: { d: 22, m: 19 } }),
      p(pm.sub, { align: "center" }),
    ];
    const fmt = (v: number) => v.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const priceLine = (price: number) => `RM${fmt(price)} + SST (8%) RM${fmt(Math.round(price * 0.08 * 100) / 100)} = <b>RM${fmt(Math.round(price * 1.08 * 100) / 100)}</b>`;
    const custom = d.hrdc ? [fundingField(d.lang)] : [];
    const pay = d.lang === "zh" ? "付款" : "Pay now";
    if (intakes.length > 1) {
      // One checkout, the visitor picks the intake (a blank code keeps publishing blocked until the class exists).
      blocks.push(
        h3(d.lang === "zh" ? "可选梯次" : "Available intakes", { size: { d: 16 }, box: { mt: 16 } }),
        ul(intakes.map(([label, price]) => `${label}: ${priceLine(price)}`)),
        orderIntakes(intakes.map(([, , code]) => code), pay, false, { custom }),
      );
    } else {
      intakes.forEach(([label, price, code]) => {
        blocks.push(h3(label, { size: { d: 16 }, box: { mt: 16 } }), p(priceLine(price), { color: C.ink }), orderForm(code, pay, false, { custom }));
      });
    }
    blocks.push(p(d.lang === "zh" ? "* 费用不可退还，但可转让 *" : "* Payments are non-refundable but transferable *", { align: "center", size: { d: 14 }, box: { mt: 16 } }));
    steps.push({ name: "Payment Form", kind: "checkout", path: d.pay, page: pageOf(sec({ name: "Payment", width: "small", pt: 40 }, one(...blocks))) });
  }
  steps.push({
    name: "Thank You",
    kind: "thank_you",
    path: d.basePath.replace(/\/$/, "") + "/thank-you",
    page: pageOf(
      sec(
        { name: "Thank you", width: "small", pt: 80, pb: 80 },
        one(
          icon(LEAD_LOGO, "LEAD", 48),
          h2(d.lang === "zh" ? "谢谢你的报名！" : "Thank you for registering!"),
          p(
            d.lang === "zh"
              ? "我们已收到你的报名。课程协调员会通过 WhatsApp 联系你，告诉你上课详情。"
              : "We have received your registration. Our course coordinator will contact you via WhatsApp with the class details.",
            { align: "center" },
          ),
          p('<a href="mailto:hi@thelead.io">hi@thelead.io</a> · <a href="https://wa.me/60173767946">+6017 376 7946</a>', { align: "center" }),
        ),
      ),
    ),
  });
  return {
    slug: d.slug,
    name: d.name,
    folder: d.folder,
    language: d.lang,
    basePath: d.basePath,
    source: ["https://ai.thelead.io" + parsed.path, ...(d.pay ? ["https://ai.thelead.io" + d.pay] : [])],
    settings: {
      theme: { headFont: d.lang === "zh" ? "Noto Sans SC" : "Poppins", bodyFont: d.lang === "zh" ? "Noto Sans SC" : "Poppins", text: C.body, link: "#2563eb", bg: C.white },
      pixels: {},
      capi: false,
      paymentMode: "live",
      chatWidget: { whatsapp: "+60173767946" },
      seo: { title: parsed.title, description: parsed.desc, ...(parsed.og.startsWith("M/") ? { image: M(parsed.og.slice(2)) } : parsed.og.startsWith("https") ? { image: parsed.og } : {}) },
    },
    steps,
    notes: d.notes,
  };
}

export function loadPayments() {
  const m = new Map<string, { title: string; sub: string; intakes: [string, number, string][] }>();
  let cur: { title: string; sub: string; intakes: [string, number, string][] } | null = null;
  for (const l of read("payments.txt").split("\n")) {
    if (l.startsWith("@pay ")) m.set(l.slice(5).trim(), (cur = { title: "", sub: "", intakes: [] }));
    else if (cur && l.startsWith("title ")) cur.title = l.slice(6);
    else if (cur && l.startsWith("sub ")) cur.sub = l.slice(4);
    else if (cur && l.startsWith("intake ")) {
      const [a, b, code] = l.slice(7).split(" ⟂ ");
      cur.intakes.push([a, Number(b), (code ?? "").trim()]);
    }
  }
  return m;
}
