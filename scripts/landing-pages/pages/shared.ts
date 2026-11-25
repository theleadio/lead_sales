// Blocks that repeat across the LEAD course pages (header, About LEAD, client
// logos, footer). Copied from the EN course pages on ai.thelead.io, 25 Nov 2026.
import { C, counter, h2, h3, icon, logos, M, nav, one, p, row, sec, slider } from "../kit.ts";

export const LEAD_LOGO = M("6981ffeb7a20d0dfb97eac3a.png");

export const header = (items: [string, string][]) =>
  sec({ name: "Header", pt: 12, pb: 12 }, row("1/3+2/3", [[icon(LEAD_LOGO, "LEAD Logo", 48)], [nav(items)]], { valign: "center" }));

const ABOUT_SLIDES = [
  "6a846d01b71315ed520d3020.jpg", "6a846c62b39b2fad7f8bea20.jpg", "6a846c627998683b3c97420a.jpg",
  "6a846d017998683b3c97f6a3.jpg", "6a846c62fcf70e5609595027.jpg",
].map(M);

export const aboutLead = () =>
  sec(
    { name: "About LEAD" },
    one(slider(ABOUT_SLIDES)),
    one(
      h2("About LEAD", { box: { mt: 24 } }),
      p("LEAD was founded in 2015 by Dr. Lau Cher Han with a simple mission: to bridge the gap between education and industry, ensuring that learning goes beyond theory and can be meaningfully applied in real-world situations."),
      p("Eleven years on, LEAD has grown into one of Malaysia's most practice-oriented technology academies, specialising in professional training across areas such as Artificial Intelligence, Data Science, Automation, and Vibe Coding."),
      p('Guided by the philosophy of "practical application over empty theory," Dr. Lau and his team have developed a hands-on learning approach that places real implementation at the centre of the learning experience. The goal is to help individuals and organisations stay ahead and evolve confidently in an AI-driven world.'),
      p("To date, more than 19,000 individuals have been trained, and over 720 corporate clients have been served. Across its online and in-person programmes, LEAD works with professionals, IT specialists, business leaders, and government agencies — continuously empowering digital transformation across industries in Malaysia."),
    ),
    row("3", [[counter(11, " yrs", "Founded 2015")], [counter(19, ",000+", "Students Collectively")], [counter(720, "+", "Clients Across the Region")]]),
  );

const CLIENTS = [
  "69a80439618c8d27f5b44055.png", "69a80439618c8d7ce2b44054.png", "69a80439b701feef54850799.png", "69a804392782ec83a50cec2a.png",
  "69a804394b6c779f13f7a716.png", "69a80439618c8d6803b44050.png", "69a80439b701fe3614850795.png", "69a8043966ab6e74fe63b936.png",
  "69a8043966ab6e71ad63b93a.png", "69a8043966ab6eceb563b93c.png", "69a80439b701fe66e1850794.png", "69a80439618c8d1719b44052.png",
  "69a8043966ab6eb91263b93b.png", "69a80439618c8dc888b44058.png", "69a8043966ab6e839463b935.png", "69a804394b6c77429df7a714.png",
  "69a804392782ecdd820cec29.png", "69a804392782ec83ab0cec2f.png", "69a804392782ec784c0cec30.png", "69a804392782ec1a360cec2e.png",
  "69a804392782ec2e950cec2b.png", "69a8043966ab6ef88f63b939.png", "69a80439618c8d29c1b44053.png", "69a80439b701feb048850796.png",
  "69a80439b701fe02f0850798.png", "69a8043966ab6ebf9863b934.png", "69a804394b6c7770d3f7a715.png", "69a80439618c8dfd6ab44057.png",
  "69a80439618c8d7601b44056.png", "69a804392782ec92200cec2d.png", "69a80439b701fe58fc850797.png", "69a8043966ab6ebb5263b937.png",
  "69a80439618c8deae1b44051.png", "69a804392782ecd68b0cec2c.png", "69a80439618c8d8b15b4404f.png",
].map(M);
// 35 client logos (SalesProcess scrolls them in a marquee). One logos element
// holds at most 30, so they are split across two.
export const TRUSTED_LOGOS = () =>
  sec(
    { name: "Trusted by", pt: 32, pb: 40 },
    one(h2("TRUSTED BY INDUSTRY LEADERS", { color: C.purple }), logos(CLIENTS.slice(0, 30), 48), logos(CLIENTS.slice(30), 48)),
  );

export const footer = (courses: [string, string][] = DEFAULT_COURSES) =>
  sec(
    { name: "Footer", bg: C.dark, pt: 40, pb: 32 },
    row("3", [
      [h3("Course Navigation", { color: C.white, size: { d: 18 } }), ...courses.map(([label, href]) => p(`<a href="${href}">${label}</a>`, { color: "#e5e7eb" }))],
      // The SalesProcess footer shows this heading with no links under it.
      [h3("Social Media Channels", { color: C.white, size: { d: 18 } })],
      [
        h3("Contact Us", { color: C.white, size: { d: 18 } }),
        p('<a href="mailto:hi@thelead.io">hi@thelead.io</a>', { color: "#e5e7eb" }),
        p('<a href="https://wa.me/60173767946">+6017 376 7946</a>', { color: "#e5e7eb" }),
      ],
    ]),
    one(p("Copyright © 2015 - 2026.<br>UCAN Technologies Sdn Bhd (1207802-V).<br>All Rights Reserved.", { align: "center", color: "#9ca3af", size: { d: 13 }, box: { mt: 16 } })),
  );

const DEFAULT_COURSES: [string, string][] = [
  ["AI Agentic Automation", "https://ai.thelead.io/en/courses/ai-agentic-automation-certification"],
  ["AI Full-Stack Building", "https://ai.thelead.io/en/courses/ai-full-stack-building-certification"],
  ["AI For Data Science", "https://ai.thelead.io/en/courses/ai-for-data-science"],
  ["Professional AI Engineering", "https://ai.thelead.io/en/courses/professional-ai-engineering-certification"],
];
