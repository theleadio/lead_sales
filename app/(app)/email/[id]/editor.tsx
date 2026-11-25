"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BLOCK_LABEL,
  blockProblem,
  BUTTON_COLORS,
  FOOTER,
  newBlock,
  renderBlocks,
  STARTER_BLOCKS,
  wrapEmail,
  type Block,
  type BlockType,
} from "@/lib/email/blocks";
import { UploadButton, type PickerImage } from "../../social/media-picker";
import { field } from "../../ui";

// The email editor: blocks on the left, a live preview on the right. The
// form gets `mode`, and `blocks` (JSON) or `bodyHtml`; the server renders
// the blocks again itself, so the preview only has to look right.

const TYPES: BlockType[] = ["heading", "text", "image", "button", "divider"];
const SAMPLE_NAME = "Aisyah";

function previewDoc(body: string): string {
  const html = wrapEmail(body.replace(/\{\{\s*name\s*\}\}/g, SAMPLE_NAME), {
    ...FOOTER.en,
    url: "#",
  });
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="margin:0;padding:24px;background:#ffffff">${html}</body></html>`;
}

export function EmailEditor({
  initialBlocks,
  initialHtml,
  library,
}: {
  initialBlocks: Block[] | null;
  initialHtml: string;
  library: PickerImage[];
}) {
  const [mode, setMode] = useState<"blocks" | "html">(
    initialBlocks ? "blocks" : initialHtml.trim() ? "html" : "blocks",
  );
  const [blocks, setBlocks] = useState<Block[]>(
    initialBlocks ?? (initialHtml.trim() ? [] : STARTER_BLOCKS()),
  );
  const [html, setHtml] = useState(initialHtml);
  const [confirmSwitch, setConfirmSwitch] = useState(false);
  const [width, setWidth] = useState<"desktop" | "phone">("desktop");
  const [images, setImages] = useState(library);
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  const body = mode === "blocks" ? renderBlocks(blocks) : html;
  // An unfinished block stops the form from submitting (and losing the
  // other edits to a server refusal): the browser shows this message.
  const problem =
    mode === "blocks"
      ? (blocks
          .map((b, i) => {
            const p = blockProblem(b);
            return p ? `${BLOCK_LABEL[b.type]} ${i + 1}: ${p}` : null;
          })
          .find(Boolean) ?? "")
      : "";
  const guard = useRef<HTMLInputElement>(null);
  useEffect(() => {
    guard.current?.setCustomValidity(problem);
  }, [problem]);
  const doc = useMemo(() => previewDoc(body), [body]);

  const update = (id: string, patch: Partial<Block>) =>
    setBlocks((bs) =>
      bs.map((b) => (b.id === id ? ({ ...b, ...patch } as Block) : b)),
    );
  const move = (i: number, d: -1 | 1) =>
    setBlocks((bs) => {
      const j = i + d;
      if (j < 0 || j >= bs.length) return bs;
      const next = [...bs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const remove = (id: string) =>
    setBlocks((bs) => bs.filter((b) => b.id !== id));
  const add = (t: BlockType, at = blocks.length) =>
    setBlocks((bs) => [...bs.slice(0, at), newBlock(t), ...bs.slice(at)]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <input type="hidden" name="mode" value={mode} />
      <input
        ref={guard}
        aria-hidden="true"
        tabIndex={-1}
        className="sr-only"
        defaultValue=""
      />
      {mode === "blocks" ? (
        <input type="hidden" name="blocks" value={JSON.stringify(blocks)} />
      ) : (
        <input type="hidden" name="bodyHtml" value={html} />
      )}

      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium">The email</span>
          {mode === "blocks" ? (
            <button
              type="button"
              className="text-ink-muted cursor-pointer text-xs underline"
              onClick={() => {
                setHtml(renderBlocks(blocks));
                setMode("html");
              }}
            >
              Edit as HTML instead
            </button>
          ) : confirmSwitch ? (
            <span className="text-xs">
              Start over with blocks? The HTML below is replaced.{" "}
              <button
                type="button"
                className="text-danger cursor-pointer font-medium underline"
                onClick={() => {
                  setBlocks(STARTER_BLOCKS());
                  setMode("blocks");
                  setConfirmSwitch(false);
                }}
              >
                Yes, start over
              </button>{" "}
              <button
                type="button"
                className="text-ink-muted cursor-pointer underline"
                onClick={() => setConfirmSwitch(false)}
              >
                Keep HTML
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="text-ink-muted cursor-pointer text-xs underline"
              onClick={() => setConfirmSwitch(true)}
            >
              Use the block editor
            </button>
          )}
        </div>
        <p className="text-ink-muted mt-1 text-xs">
          Use {"{{name}}"} for the person&apos;s name.
          {mode === "blocks" &&
            " In text, **two stars** make bold and [words](https://link) make a link."}{" "}
          An unsubscribe link is always added at the bottom.
        </p>

        {mode === "html" ? (
          <textarea
            aria-label="Email HTML"
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            rows={18}
            className={`${field} mt-2 w-full font-mono`}
          />
        ) : (
          <ol className="mt-3 space-y-3">
            {blocks.map((b, i) => (
              <li key={b.id} className="border-line rounded-xl border p-3">
                <div className="flex items-center gap-1">
                  <span className="text-ink-muted mr-auto text-xs font-medium tracking-wide uppercase">
                    {BLOCK_LABEL[b.type]}
                  </span>
                  <IconButton
                    label="Move up"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    ↑
                  </IconButton>
                  <IconButton
                    label="Move down"
                    disabled={i === blocks.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    ↓
                  </IconButton>
                  <IconButton label="Remove" onClick={() => remove(b.id)}>
                    ×
                  </IconButton>
                </div>
                <BlockFields
                  b={b}
                  update={(p) => update(b.id, p)}
                  images={images}
                  pickerOpen={pickerFor === b.id}
                  togglePicker={() =>
                    setPickerFor((f) => (f === b.id ? null : b.id))
                  }
                  onUploaded={(img) => {
                    setImages((l) => [img, ...l]);
                    update(b.id, { url: img.url } as Partial<Block>);
                    setPickerFor(null);
                  }}
                />
                {blockProblem(b) && (
                  <p className="text-danger mt-2 text-xs">{blockProblem(b)}</p>
                )}
              </li>
            ))}
          </ol>
        )}

        {mode === "blocks" && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-ink-muted text-xs">Add</span>
            {TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => add(t)}
                className="border-line hover:bg-surface-muted cursor-pointer rounded-lg border px-3 py-1.5 text-sm"
              >
                + {BLOCK_LABEL[t]}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="min-w-0 lg:sticky lg:top-4 lg:self-start">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Preview</span>
          <div
            role="group"
            aria-label="Preview width"
            className="bg-surface-muted flex gap-1 rounded-lg p-1 text-xs"
          >
            {(["desktop", "phone"] as const).map((w) => (
              <button
                key={w}
                type="button"
                aria-pressed={width === w}
                onClick={() => setWidth(w)}
                className={`cursor-pointer rounded-md px-2.5 py-1 ${width === w ? "bg-surface font-medium shadow-sm" : "text-ink-muted"}`}
              >
                {w === "desktop" ? "Desktop" : "Phone"}
              </button>
            ))}
          </div>
        </div>
        <div className="bg-surface-muted border-line mt-2 rounded-xl border p-3">
          {/* No scripts, no same-origin: the preview can't touch the app. */}
          <iframe
            title="Email preview"
            sandbox=""
            srcDoc={doc}
            className="bg-surface mx-auto block h-[36rem] w-full rounded-lg border-0 shadow-sm"
            style={{ maxWidth: width === "phone" ? 375 : 640 }}
          />
        </div>
        <p className="text-ink-muted mt-1 text-xs">
          {"{{name}}"} shows as &ldquo;{SAMPLE_NAME}&rdquo; here. Send yourself
          a test to see it in a real inbox.
        </p>
      </div>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="text-ink-muted hover:bg-surface-muted hover:text-ink h-7 w-7 cursor-pointer rounded-md text-sm disabled:cursor-default disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function Align({
  value,
  onChange,
}: {
  value: "left" | "center";
  onChange: (v: "left" | "center") => void;
}) {
  return (
    <select
      aria-label="Alignment"
      value={value}
      onChange={(e) => onChange(e.target.value as "left" | "center")}
      className={`${field} !py-1.5`}
    >
      <option value="left">Left</option>
      <option value="center">Centre</option>
    </select>
  );
}

function BlockFields({
  b,
  update,
  images,
  pickerOpen,
  togglePicker,
  onUploaded,
}: {
  b: Block;
  update: (p: Partial<Block>) => void;
  images: PickerImage[];
  pickerOpen: boolean;
  togglePicker: () => void;
  onUploaded: (img: PickerImage) => void;
}) {
  const input = `${field} w-full`;
  switch (b.type) {
    case "heading":
      return (
        <div className="mt-2 flex gap-2">
          <input
            aria-label="Heading"
            value={b.text}
            maxLength={300}
            onChange={(e) => update({ text: e.target.value })}
            className={`${input} font-semibold`}
          />
          <Align value={b.align} onChange={(align) => update({ align })} />
        </div>
      );
    case "text":
      return (
        <div className="mt-2 space-y-2">
          <textarea
            aria-label="Text"
            value={b.text}
            maxLength={10000}
            rows={Math.min(12, Math.max(3, b.text.split("\n").length + 1))}
            onChange={(e) => update({ text: e.target.value })}
            className={input}
          />
          <Align value={b.align} onChange={(align) => update({ align })} />
        </div>
      );
    case "image":
      return (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={togglePicker}
              className="border-line bg-surface-muted cursor-pointer rounded-lg border px-3 py-1.5 text-sm font-medium"
            >
              {pickerOpen ? "Close library" : "Choose from image library"}
            </button>
            {b.url && (
              // eslint-disable-next-line @next/next/no-img-element -- a small thumbnail of the chosen image
              <img
                src={b.url}
                alt=""
                className="border-line h-9 w-9 rounded border object-cover"
              />
            )}
          </div>
          {pickerOpen && (
            <div className="border-line rounded-lg border p-2">
              <UploadButton label="Upload an image" onUploaded={onUploaded} />
              {images.length === 0 ? (
                <p className="text-ink-muted mt-2 text-sm">
                  The library is empty. Upload an image to use it.
                </p>
              ) : (
                <ul className="mt-2 grid max-h-56 grid-cols-4 gap-2 overflow-y-auto">
                  {images.map((img) => (
                    <li key={img.id}>
                      <button
                        type="button"
                        title={img.name || "Image"}
                        onClick={() => {
                          update({ url: img.url });
                          togglePicker();
                        }}
                        className={`block aspect-square w-full cursor-pointer overflow-hidden rounded-md border-2 ${b.url === img.url ? "border-action" : "border-line"}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- library thumbnail */}
                        <img
                          src={img.url}
                          alt={img.name}
                          className="h-full w-full object-cover"
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-ink-muted mt-1 text-xs">
                The same library as the Social planner.
              </p>
            </div>
          )}
          <input
            aria-label="Image address"
            placeholder="Or paste an image address (https://…)"
            value={b.url}
            onChange={(e) => update({ url: e.target.value })}
            className={input}
          />
          <input
            aria-label="Description for people who can't see the image"
            placeholder="Describe the image (shown if it doesn't load)"
            value={b.alt}
            maxLength={300}
            onChange={(e) => update({ alt: e.target.value })}
            className={input}
          />
          <input
            aria-label="Link when the image is clicked"
            placeholder="Link when clicked (optional, https://…)"
            value={b.href}
            onChange={(e) => update({ href: e.target.value })}
            className={input}
          />
        </div>
      );
    case "button":
      return (
        <div className="mt-2 space-y-2">
          <div className="flex gap-2">
            <input
              aria-label="Button words"
              value={b.label}
              maxLength={80}
              onChange={(e) => update({ label: e.target.value })}
              className={input}
            />
            <Align value={b.align} onChange={(align) => update({ align })} />
          </div>
          <input
            aria-label="Button link"
            placeholder="https://"
            value={b.href}
            onChange={(e) => update({ href: e.target.value })}
            className={input}
          />
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="Colour"
          >
            {(
              Object.entries(BUTTON_COLORS) as [
                keyof typeof BUTTON_COLORS,
                (typeof BUTTON_COLORS)[keyof typeof BUTTON_COLORS],
              ][]
            ).map(([k, c]) => (
              <button
                key={k}
                type="button"
                aria-pressed={b.color === k}
                onClick={() => update({ color: k })}
                className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${b.color === k ? "border-ink" : "border-line"}`}
              >
                <span
                  className="border-line h-3.5 w-3.5 rounded-full border"
                  style={{ background: c.bg }}
                />
                {c.label}
              </button>
            ))}
          </div>
        </div>
      );
    case "divider":
      return (
        <p className="text-ink-muted mt-1 text-xs">
          A thin line between parts.
        </p>
      );
  }
}
