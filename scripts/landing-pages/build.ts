// Builds the SalesProcess landing-page copies: checks every page against the
// editor's schema, writes an HTML preview of each step, and writes one SQL file
// per funnel that creates it as an UNPUBLISHED draft (no routes, so nothing
// goes live; a funnel with the same name is left alone).
//
//   node scripts/landing-pages/build.ts <outDir> [slug ...]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { siteSettingsSchema } from "../../lib/sites/model.ts";
import { renderDraft } from "../../lib/sites/render/html.ts";
import { parsePage, sanitizePage } from "../../lib/sites/tree-server.ts";
import type { FunnelSpec } from "./kit.ts";
import { SPECS } from "./pages/index.ts";

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
function json(v: unknown): string {
  const body = JSON.stringify(v);
  let tag = "j";
  while (body.includes(`$${tag}$`)) tag += "x";
  return `$${tag}$${body}$${tag}$::jsonb`;
}

export function funnelSql(f: FunnelSpec): string {
  const settings = siteSettingsSchema.parse(f.settings);
  const steps = f.steps.map((s) => {
    const r = parsePage(s.page);
    if (!r.ok) throw new Error(`${f.slug} / ${s.name}: ${r.message}`);
    return { ...s, page: sanitizePage(r.page) };
  });
  const lines = [
    `-- ${f.name}: draft copy of ${f.source.join(" + ")}`,
    `-- Creates the funnel unpublished. Safe to run twice: skips if a funnel with this name exists.`,
    `DO $do$`,
    `DECLARE fid uuid; sid uuid; pid uuid;`,
    `BEGIN`,
    `  IF EXISTS (SELECT 1 FROM sales.site WHERE kind = 'funnel' AND name = ${lit(f.name)}) THEN`,
    `    RAISE NOTICE 'Funnel % already exists, skipped', ${lit(f.name)}; RETURN;`,
    `  END IF;`,
    `  SELECT id INTO fid FROM sales.site_folder WHERE kind = 'funnel' AND name = ${lit(f.folder)} ORDER BY created_at LIMIT 1;`,
    `  IF fid IS NULL THEN INSERT INTO sales.site_folder (name, kind) VALUES (${lit(f.folder)}, 'funnel') RETURNING id INTO fid; END IF;`,
    `  INSERT INTO sales.site (kind, name, folder_id, base_path, language, settings)`,
    `  VALUES ('funnel', ${lit(f.name)}, fid, ${lit(f.basePath)}, ${lit(f.language)}, ${json(settings)}) RETURNING id INTO sid;`,
  ];
  steps.forEach((s, i) => {
    lines.push(
      `  INSERT INTO sales.site_page (site_id, position, name, path, kind) VALUES (sid, ${i + 1}, ${lit(s.name)}, ${lit(s.path)}, ${lit(s.kind)}) RETURNING id INTO pid;`,
      `  INSERT INTO sales.page_version (page_id, project) VALUES (pid, ${json(s.page)});`,
    );
  });
  lines.push(`  RAISE NOTICE 'Created draft funnel % (%)', ${lit(f.name)}, sid;`, `END`, `$do$;`, ``);
  return lines.join("\n");
}

// Preview document: the live renderer's markup and CSS, with the runtime
// loaded from ./site/ next to the file.
export function previewHtml(f: FunnelSpec, stepIndex: number): string {
  const steps = f.steps.map((s, i) => ({ id: `step-${i}`, path: s.path }));
  const site = { language: f.language, settings: siteSettingsSchema.parse(f.settings) };
  const r = renderDraft(f.steps[stepIndex].page, { site, steps, pageId: `step-${stepIndex}` });
  if (!r.ok) throw new Error(r.message);
  const fonts =
    "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Poppins:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;700&display=swap";
  return `<!doctype html><html lang="${f.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${f.name} - ${f.steps[stepIndex].name} (draft preview)</title><link rel="stylesheet" href="${fonts}"><link rel="stylesheet" href="site/runtime.css"><style>${r.css}</style></head><body style="margin:0">${r.html}<script src="site/runtime.js" defer></script></body></html>`;
}

if ((import.meta as { main?: boolean }).main) {
  const [out = "landing-out", ...only] = process.argv.slice(2);
  mkdirSync(out, { recursive: true });
  const specs = only.length ? SPECS.filter((s) => only.includes(s.slug)) : SPECS;
  const all: string[] = [];
  for (const f of specs) {
    const sql = funnelSql(f);
    writeFileSync(join(out, `${f.slug}.sql`), sql);
    all.push(sql);
    f.steps.forEach((_, i) => writeFileSync(join(out, `${f.slug}-${i + 1}.html`), previewHtml(f, i)));
    const bytes = f.steps.map((s) => JSON.stringify(s.page).length);
    console.log(`${f.slug}: ${f.steps.length} steps OK (${bytes.join(" / ")} bytes)`);
  }
  if (specs.length > 1) writeFileSync(join(out, `all.sql`), all.join("\n"));
}
