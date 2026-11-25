"use client";

import { useState } from "react";

// Copies a post's text, for pasting into a platform by hand.
export function CopyButton({ text, label = "Copy text" }: { text: string; label?: string }) {
  const [done, setDone] = useState<"" | "ok" | "fail">("");
  return (
    <button
      type="button"
      className="border-line bg-surface-muted cursor-pointer rounded-lg border px-3 py-1 text-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone("ok");
        } catch {
          setDone("fail");
        }
        setTimeout(() => setDone(""), 2000);
      }}
    >
      {done === "ok" ? "Copied" : done === "fail" ? "Copy failed: select the text instead" : label}
    </button>
  );
}
