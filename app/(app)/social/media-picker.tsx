"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

// The image library, in the browser: an upload button, and (in a post) the
// images to pick from. Uploads go to /api/social/image.

export type PickerImage = { id: string; url: string; name: string };

async function upload(file: File): Promise<PickerImage> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch("/api/social/image", { method: "POST", body });
  const json = await res.json().catch(() => null);
  if (!res.ok)
    throw new Error(json?.error?.message ?? "The upload failed. Try again.");
  return json as PickerImage;
}

export function UploadButton({
  onUploaded,
  label = "Upload images",
}: {
  onUploaded?: (img: PickerImage) => void;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onChange(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const f of Array.from(files)) {
        const img = await upload(f);
        onUploaded?.(img);
      }
      if (!onUploaded) router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The upload failed.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png"
        multiple
        className="sr-only"
        id="social-upload"
        onChange={(e) => onChange(e.target.files)}
      />
      <label
        htmlFor="social-upload"
        className="border-line bg-surface-muted inline-block cursor-pointer rounded-lg border px-4 py-2 text-sm font-medium"
      >
        {busy ? "Uploading…" : label}
      </label>
      <span className="text-ink-muted ml-2 text-xs">JPG or PNG, up to 4 MB</span>
      {error && (
        <p role="alert" className="text-danger mt-1 text-sm">
          {error}
        </p>
      )}
    </div>
  );
}

// Picks up to `max` images for a post, in the order they are ticked. The
// choice is sent with the post's form as `mediaIds`.
export function MediaPicker({
  library,
  selected,
  max,
  disabled = false,
}: {
  library: PickerImage[];
  selected: PickerImage[];
  max: number;
  disabled?: boolean;
}) {
  // The post's images first (one may have left the library since), then the
  // rest of the library.
  const [items, setItems] = useState<PickerImage[]>(() => {
    const seen = new Set(selected.map((s) => s.id));
    return [...selected, ...library.filter((l) => !seen.has(l.id))];
  });
  const [chosen, setChosen] = useState<string[]>(selected.map((s) => s.id));

  const toggle = (id: string) =>
    setChosen((c) =>
      c.includes(id)
        ? c.filter((x) => x !== id)
        : c.length >= max
          ? c
          : [...c, id],
    );

  return (
    <div>
      {chosen.map((id) => (
        <input key={id} type="hidden" name="mediaIds" value={id} />
      ))}
      {!disabled && (
        <UploadButton
          label="Upload new images"
          onUploaded={(img) => {
            setItems((i) => [img, ...i]);
            setChosen((c) => (c.length >= max ? c : [...c, img.id]));
          }}
        />
      )}
      {items.length === 0 ? (
        <p className="text-ink-muted mt-2 text-sm">
          The library is empty. Upload an image to use it here.
        </p>
      ) : (
        <ul className="mt-2 grid max-h-80 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-5">
          {items.map((img) => {
            const n = chosen.indexOf(img.id);
            return (
              <li key={img.id}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => toggle(img.id)}
                  aria-pressed={n >= 0}
                  title={img.name || "Image"}
                  className={`relative block aspect-square w-full overflow-hidden rounded-lg border-2 ${n >= 0 ? "border-action" : "border-line"} disabled:cursor-default`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- library images are already sized by the uploader */}
                  <img
                    src={img.url}
                    alt={img.name || "Library image"}
                    className="h-full w-full object-cover"
                  />
                  {n >= 0 && (
                    <span className="bg-action text-action-ink absolute top-1 left-1 rounded-full px-2 text-xs font-semibold">
                      {n + 1}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-ink-muted mt-1 text-xs">
        {chosen.length} of {max} picked. They post in the order you pick them.
      </p>
    </div>
  );
}
