import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LeadMark } from "../../logo";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canEditPages, pageBySlug } from "@/lib/pages/admin";
import { pairs, youtubeId, type Block } from "@/lib/pages/model";
import { COPY, type Lang } from "../copy";
import { LeadForm } from "../lead-form";

// A landing page built in Sites & forms: open to anyone once published.
// A draft is shown only to signed-in staff who may edit pages (preview).

async function load(slug: string[]) {
  const path = slug.join("/");
  const page = await pageBySlug(path, true);
  if (!page) return null;
  if (!page.published) {
    const user = await getCurrentUser();
    if (!user || !canEditPages(user.role)) return null;
  }
  return page;
}

export async function generateMetadata({
  params,
}: PageProps<"/p/[...slug]">): Promise<Metadata> {
  const page = await load((await params).slug);
  if (!page) return {};
  return {
    title: page.title,
    description: page.description || undefined,
    robots: page.published ? undefined : { index: false },
  };
}

// Buttons: charcoal on white, logo yellow (dark text) on the blue hero. White
// text on the logo blue or yellow fails contrast (tests/brand.test.ts).
const btn =
  "focus-visible:outline-focus-ring inline-flex min-h-12 items-center rounded-full px-7 py-3 text-base font-semibold transition duration-200 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[0.98] motion-reduce:transition-none";
const cta = `${btn} bg-action text-action-ink hover:bg-ink`;
const ctaOnBlue = `${btn} bg-lead-yellow text-ink hover:brightness-95`;
const h2 =
  "text-[clamp(1.75rem,4vw,2.5rem)] leading-[1.1] font-semibold tracking-[-0.02em] text-balance";
const prose = "mx-auto max-w-[68ch] px-5 py-12 sm:py-16";
const wide = "mx-auto max-w-6xl px-5 sm:px-8";

export default async function LandingPage({
  params,
}: PageProps<"/p/[...slug]">) {
  const page = await load((await params).slug);
  if (!page) notFound();
  const lang: Lang = page.language;
  const heroFirst = page.blocks[0]?.kind === "hero";

  return (
    <main lang={lang} className="bg-surface flex-1">
      {!page.published && (
        <p className="bg-lead-yellow px-4 py-2 text-center text-sm font-medium">
          Draft preview. Customers can&apos;t see this page yet.
        </p>
      )}
      <header className={heroFirst ? "bg-lead-blue" : ""}>
        <div className={`${wide} flex items-center gap-2.5 py-5`}>
          <LeadMark />
          <span className="text-lg font-semibold tracking-wide">LEAD</span>
        </div>
      </header>
      {page.blocks.map((b, i) => (
        <BlockView
          key={i}
          block={b}
          position={i}
          slug={page.slug}
          lang={lang}
        />
      ))}
      <footer className="text-ink-muted px-5 py-10 text-center text-sm">
        © LEAD
      </footer>
    </main>
  );
}

function BlockView({
  block: b,
  position,
  slug,
  lang,
}: {
  block: Block;
  position: number;
  slug: string;
  lang: Lang;
}) {
  switch (b.kind) {
    case "hero":
      return (
        <section className="bg-lead-blue overflow-hidden">
          <div
            className={`${wide} grid items-center gap-12 pt-10 pb-16 sm:pt-16 sm:pb-24 ${b.imageUrl ? "md:grid-cols-[1.1fr_1fr]" : ""}`}
          >
            <div className="rise">
              <h1 className="max-w-[16ch] text-[clamp(2.5rem,7vw,4.5rem)] leading-[1.02] font-semibold tracking-[-0.035em] text-balance">
                {b.heading}
              </h1>
              {b.sub && (
                <p className="mt-6 max-w-[46ch] text-lg leading-relaxed text-pretty sm:text-xl">
                  {b.sub}
                </p>
              )}
              {b.ctaLabel && b.ctaHref && (
                <a href={b.ctaHref} className={`${ctaOnBlue} mt-9`}>
                  {b.ctaLabel}
                </a>
              )}
            </div>
            {b.imageUrl && (
              <div className="rise rise-late relative">
                {/* The yellow dot of the logo, behind the photo. */}
                <span
                  aria-hidden
                  className="bg-lead-yellow absolute -top-6 -right-6 size-32 rounded-full sm:size-44"
                />
                {/* eslint-disable-next-line @next/next/no-img-element -- staff paste any https image */}
                <img
                  src={b.imageUrl}
                  alt=""
                  className="bg-surface-muted relative aspect-[4/3] w-full rounded-[2rem] object-cover"
                />
              </div>
            )}
          </div>
        </section>
      );
    case "text":
      return (
        <section className={prose}>
          {b.heading && <h2 className={h2}>{b.heading}</h2>}
          {b.body.split(/\n\s*\n/).map((p, i) => (
            <p
              key={i}
              className="mt-5 text-lg leading-[1.7] text-pretty whitespace-pre-line"
            >
              {p}
            </p>
          ))}
        </section>
      );
    case "image":
      return (
        <section className={`${wide} py-6`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- staff paste any https image */}
          <img
            src={b.url}
            alt={b.alt}
            loading="lazy"
            className="bg-surface-muted w-full rounded-[2rem]"
          />
        </section>
      );
    case "video":
      return (
        <section className="mx-auto max-w-4xl px-5 py-6">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${youtubeId(b.url)}`}
            title="Video"
            loading="lazy"
            allow="encrypted-media; picture-in-picture; fullscreen"
            className="bg-charcoal aspect-video w-full rounded-[2rem]"
          />
        </section>
      );
    case "testimonials":
      return (
        <section className={`${wide} py-12 sm:py-16`}>
          {b.heading && <h2 className={h2}>{b.heading}</h2>}
          {/* Pull quotes on a shared rule, not a grid of cards. */}
          <div className="mt-8 grid gap-x-14 sm:grid-cols-2">
            {pairs(b.lines).map(([quote, name], i) => (
              <figure key={i} className="border-ink border-t py-7">
                <blockquote className="text-xl leading-snug font-medium text-pretty sm:text-2xl">
                  <span
                    aria-hidden
                    className="bg-lead-yellow mr-2.5 inline-block size-3 rounded-full align-middle"
                  />
                  {quote}
                </blockquote>
                {name && (
                  <figcaption className="text-ink-muted mt-4 text-base">
                    {name}
                  </figcaption>
                )}
              </figure>
            ))}
          </div>
        </section>
      );
    case "faq":
      return (
        <section className={prose}>
          <h2 className={h2}>{b.heading || COPY[lang].faq}</h2>
          <div className="border-line mt-8 border-t">
            {pairs(b.lines).map(([q, a], i) => (
              <details key={i} className="group border-line border-b">
                <summary className="hover:text-ink-muted focus-visible:outline-focus-ring flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-lg font-medium focus-visible:outline-2 [&::-webkit-details-marker]:hidden">
                  {q}
                  <span
                    aria-hidden
                    className="bg-surface-muted grid size-8 shrink-0 place-items-center rounded-full text-xl leading-none transition-transform duration-200 ease-out group-open:rotate-45 motion-reduce:transition-none"
                  >
                    +
                  </span>
                </summary>
                <p className="max-w-[60ch] pb-6 text-lg leading-relaxed text-pretty">
                  {a}
                </p>
              </details>
            ))}
          </div>
        </section>
      );
    case "form":
      return (
        <section id="form" className="bg-charcoal my-8">
          <div
            className={`${wide} grid items-start gap-10 py-14 sm:py-20 md:grid-cols-[1fr_1.1fr]`}
          >
            <h2 className={`${h2} text-surface max-w-[14ch]`}>
              {b.heading || b.buttonLabel || COPY[lang].send}
            </h2>
            <div className="bg-surface rounded-[2rem] p-6 sm:p-9">
              <LeadForm
                slug={slug}
                position={position}
                lang={lang}
                buttonLabel={b.buttonLabel}
              />
            </div>
          </div>
        </section>
      );
    case "button":
      return (
        <section className="px-5 py-10 text-center">
          <a href={b.href} className={cta}>
            {b.label}
          </a>
        </section>
      );
  }
}
