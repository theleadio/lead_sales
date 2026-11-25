"use client";

import { useState } from "react";
import type { ActionState } from "@/lib/sites/admin-actions";
import { button, field, switchInput } from "../../../ui";
import { ActionForm, FieldError } from "../../action-form";

// Google shows about this many characters before cutting a title or
// description off. A guide only: Google measures in pixels.
const TITLE_MAX = 60;
const DESC_MAX = 160;

function Count({ n, max }: { n: number; max: number }) {
  if (n === 0) return <span className="text-ink-muted text-xs">Empty</span>;
  const long = n > max;
  return (
    <span className={`text-xs ${long ? "text-warn" : "text-ok"}`}>
      {n} / {max} · {long ? "may be cut off" : "good length"}
    </span>
  );
}

const cut = (s: string, max: number) =>
  s.length > max ? `${s.slice(0, max).trimEnd()} …` : s;

// The SEO tab: the fields on the left, how Google and a shared link will
// show them on the right, updated as you type.
export function SeoForm({
  action,
  siteId,
  version,
  url,
  fallbackTitle,
  initial,
  edit,
}: {
  action: (prev: ActionState, f: FormData) => Promise<ActionState>;
  siteId: string;
  version: number;
  url: string;
  fallbackTitle: string;
  initial: { title: string; description: string; image: string; noindex: boolean };
  edit: boolean;
}) {
  const [title, setTitle] = useState(initial.title);
  const [desc, setDesc] = useState(initial.description);
  const [image, setImage] = useState(initial.image);
  const shownTitle = title.trim() || fallbackTitle;
  const host = url.replace(/^https:\/\//, "");
  const crumbs = host.split("/").filter(Boolean).join(" › ");
  const goodImage = /^https:\/\/\S+$/.test(image.trim());

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <ActionForm action={action} className="border-line rounded-[14px] border">
        <input type="hidden" name="siteId" value={siteId} />
        <input type="hidden" name="version" value={version} />
        <input type="hidden" name="section" value="seo" />
        <div className="border-line border-b px-[18px] py-4">
          <h2 className="font-semibold">How this funnel shows up on Google and social media</h2>
        </div>
        <fieldset disabled={!edit} className="flex flex-col gap-1 px-[18px] py-4 text-sm">
          <label htmlFor="seo-title" className="flex items-center justify-between font-medium">
            Page title <Count n={title.trim().length} max={TITLE_MAX} />
          </label>
          <input
            id="seo-title"
            name="seo.title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={fallbackTitle}
            className={field}
          />
          <FieldError name="seo.title" />

          <label htmlFor="seo-desc" className="mt-3 flex items-center justify-between font-medium">
            Description <Count n={desc.trim().length} max={DESC_MAX} />
          </label>
          <textarea
            id="seo-desc"
            name="seo.description"
            rows={3}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            className={`${field} resize-y`}
          />
          <FieldError name="seo.description" />

          <label htmlFor="seo-image" className="mt-3 font-medium">
            Share image
          </label>
          <input
            id="seo-image"
            name="seo.image"
            value={image}
            onChange={(e) => setImage(e.target.value)}
            placeholder="https://…"
            aria-describedby="seo-image-hint"
            className={field}
          />
          <span id="seo-image-hint" className="text-ink-muted text-xs">
            A link starting https://. Shown when the link is shared on WhatsApp, Facebook or
            LinkedIn. 1200 × 630 works best.
          </span>
          <FieldError name="seo.image" />

          <label className="border-line mt-4 flex items-center justify-between gap-4 border-t pt-4">
            <span>
              <span className="block font-medium">Hide from search engines</span>
              <span className="text-ink-muted block text-xs">
                Turn on for private or test funnels.
              </span>
            </span>
            <input
              type="checkbox"
              role="switch"
              name="noindex"
              defaultChecked={initial.noindex}
              className={switchInput}
            />
          </label>
        </fieldset>
        {edit && (
          <div className="flex justify-end px-[18px] pb-4">
            <button type="submit" className={button}>
              Save SEO
            </button>
          </div>
        )}
      </ActionForm>

      <div className="flex flex-col gap-2">
        <p className="text-ink-muted text-xs font-medium tracking-[.04em]">GOOGLE PREVIEW</p>
        <div className="border-line rounded-[14px] border p-4 font-[Arial,sans-serif]">
          <p className="text-xs text-[#202124]">{crumbs}</p>
          <p className="mt-1 text-[19px] leading-snug text-[#1a0dab]">{cut(shownTitle, TITLE_MAX)}</p>
          <p className="mt-0.5 text-[13px] leading-normal text-[#4d5156]">
            {desc.trim() ? cut(desc.trim(), DESC_MAX) : "Google picks text from the page when there is no description."}
          </p>
        </div>
        <p className="text-ink-muted mt-3 text-xs font-medium tracking-[.04em]">SHARE PREVIEW</p>
        <div className="border-line overflow-hidden rounded-[14px] border">
          {goodImage ? (
            // eslint-disable-next-line @next/next/no-img-element -- any https image the user typed
            <img src={image.trim()} alt="" className="bg-surface-muted aspect-[1200/630] w-full object-cover" />
          ) : (
            <div className="bg-surface-muted text-ink-muted grid aspect-[1200/630] place-items-center text-sm">
              No share image
            </div>
          )}
          <div className="bg-surface-muted border-line border-t px-3 py-2.5">
            <p className="text-ink-muted text-xs uppercase">{host.split("/")[0]}</p>
            <p className="truncate font-semibold">{shownTitle}</p>
            {desc.trim() && <p className="text-ink-muted truncate text-xs">{desc.trim()}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
