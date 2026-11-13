"use client";

import { useActionState, useState } from "react";
import { BLOCK_KINDS, BLOCKS, type BlockKind } from "@/lib/pages/model";
import { button, field } from "../tickets/ui";
import { savePageAction, type EditorState } from "./actions";

// The page editor: page details, then the blocks in order. Blocks live in
// this component's state and are sent as one JSON field; the server checks
// every one (lib/pages/model.ts).

type Draft = { kind: BlockKind } & Record<string, string>;
const small =
  "border-line hover:bg-surface-muted cursor-pointer rounded-lg border px-2.5 py-1 text-xs disabled:opacity-40";

export function PageEditor(props: {
  id?: string;
  title: string;
  slug: string;
  description: string;
  language: "en" | "zh";
  blocks: Draft[];
}) {
  const [state, action, pending] = useActionState<EditorState, FormData>(
    savePageAction,
    {},
  );
  const [blocks, setBlocks] = useState<Draft[]>(props.blocks);
  const [kind, setKind] = useState<BlockKind>("hero");
  // Upload progress or error, per image field ("<block>:<field>").
  const [notes, setNotes] = useState<Record<string, string>>({});

  const add = () =>
    setBlocks((b) => [
      ...b,
      {
        kind,
        ...Object.fromEntries(BLOCKS[kind].fields.map((f) => [f.name, ""])),
      } as Draft,
    ]);
  const move = (i: number, by: number) =>
    setBlocks((b) => {
      const next = [...b];
      [next[i], next[i + by]] = [next[i + by], next[i]];
      return next;
    });
  const set = (i: number, name: string, value: string) =>
    setBlocks((b) => b.map((x, j) => (j === i ? { ...x, [name]: value } : x)));

  const upload = async (i: number, name: string, file: File | undefined) => {
    if (!file) return;
    const note = (text: string) =>
      setNotes((n) => ({ ...n, [`${i}:${name}`]: text }));
    note("Uploading…");
    const body = new FormData();
    body.set("file", file);
    try {
      const res = await fetch("/api/pages/image", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) return note(json.error?.message ?? "The upload failed.");
      set(i, name, json.url);
      note("Uploaded. Save the page to keep it.");
    } catch {
      note("The upload failed. Try again.");
    }
  };

  return (
    <form action={action} className="mt-6 flex flex-col gap-5">
      {props.id && <input type="hidden" name="id" value={props.id} />}
      <input type="hidden" name="blocks" value={JSON.stringify(blocks)} />
      {state.error && (
        <p
          role="alert"
          className="border-danger/40 bg-danger/5 text-danger rounded-xl border px-4 py-3 text-sm"
        >
          {state.error}
        </p>
      )}
      <label className="flex flex-col gap-1 text-sm font-medium">
        Title
        <input
          name="title"
          defaultValue={props.title}
          required
          maxLength={120}
          className={field}
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Address
          <span className="flex items-center gap-1">
            <span className="text-ink-muted font-normal">/p/</span>
            <input
              name="slug"
              defaultValue={props.slug}
              required
              maxLength={120}
              placeholder="ai-engineering"
              className={`${field} flex-1`}
            />
          </span>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Language
          <select
            name="language"
            defaultValue={props.language}
            className={field}
          >
            <option value="en">English</option>
            <option value="zh">中文</option>
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Description for search engines and link previews
        <input
          name="description"
          defaultValue={props.description}
          maxLength={300}
          className={field}
        />
      </label>

      <h2 className="mt-4 text-lg font-semibold">Blocks</h2>
      {blocks.length === 0 && (
        <p className="text-ink-muted text-sm">
          No blocks yet. Most pages start with a hero and end with a lead form.
        </p>
      )}
      {blocks.map((b, i) => (
        <fieldset key={i} className="border-line rounded-2xl border p-4">
          <legend className="px-1 text-sm font-semibold">
            {i + 1}. {BLOCKS[b.kind].label}
          </legend>
          <div className="mb-3 flex gap-2">
            <button
              type="button"
              className={small}
              disabled={i === 0}
              onClick={() => move(i, -1)}
            >
              Move up
            </button>
            <button
              type="button"
              className={small}
              disabled={i === blocks.length - 1}
              onClick={() => move(i, 1)}
            >
              Move down
            </button>
            <button
              type="button"
              className={`${small} text-danger ml-auto`}
              onClick={() => setBlocks((x) => x.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </div>
          <div className="flex flex-col gap-3">
            {BLOCKS[b.kind].fields.map((f) => (
              <label
                key={f.name}
                className="flex flex-col gap-1 text-sm font-medium"
              >
                {f.label}
                {f.area ? (
                  <textarea
                    rows={4}
                    value={b[f.name] ?? ""}
                    onChange={(e) => set(i, f.name, e.target.value)}
                    className={field}
                  />
                ) : (
                  <input
                    value={b[f.name] ?? ""}
                    onChange={(e) => set(i, f.name, e.target.value)}
                    className={field}
                  />
                )}
                {f.image && (
                  <span className="flex flex-wrap items-center gap-2 text-xs font-normal">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      aria-label={`Upload ${f.label.toLowerCase()}`}
                      onChange={(e) => upload(i, f.name, e.target.files?.[0])}
                    />
                    <span role="status" className="text-ink-muted">
                      {notes[`${i}:${f.name}`] ??
                        "Upload a file (PNG, JPEG, WebP or GIF, up to 4 MB), or paste an https link above."}
                    </span>
                  </span>
                )}
                {f.hint && (
                  <span className="text-ink-muted text-xs font-normal">
                    {f.hint}
                  </span>
                )}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <div className="flex items-end gap-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Add a block
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as BlockKind)}
            className={field}
          >
            {BLOCK_KINDS.map((k) => (
              <option key={k} value={k}>
                {BLOCKS[k].label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={`${small} py-2`} onClick={add}>
          Add
        </button>
      </div>

      <button
        type="submit"
        disabled={pending}
        className={`${button} mt-4 self-start disabled:opacity-60`}
      >
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
