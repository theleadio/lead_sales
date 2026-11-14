const COPY = {
  en: { title: "This page is not available", body: "This event has ended or the page has moved. See our upcoming classes.", cta: "See upcoming classes" },
  zh: { title: "此页面暂不可用", body: "此活动已结束，或页面已移动。请查看我们即将开课的课程。", cta: "查看即将开课的课程" },
} as const;

export function holdingHtml(language: "en" | "zh"): string {
  const c = COPY[language];
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${c.title}</title><style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:1rem;text-align:center;color:#1a1a1a}a{display:inline-block;margin-top:1rem;padding:.7rem 1.2rem;border-radius:8px;background:#1a1a1a;color:#fff;text-decoration:none}</style></head><body><main><h1>${c.title}</h1><p>${c.body}</p><a href="https://www.thelead.io">${c.cta}</a></main></body></html>`;
}
