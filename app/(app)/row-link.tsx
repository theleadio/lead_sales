"use client";

import { useRouter } from "next/navigation";

// A table row that opens its record when clicked anywhere. The row's first
// link stays the real link, for keyboards, screen readers and new tabs;
// clicks on a button, link or field inside the row do their own thing.
export function RowLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <tr
      className={`cursor-pointer ${className ?? ""}`}
      onClick={(e) => {
        const t = e.target as HTMLElement;
        if (t.closest("a, button, input, select, textarea, label, form")) return;
        if (window.getSelection()?.toString()) return; // selecting text
        if (e.metaKey || e.ctrlKey) window.open(href, "_blank");
        else router.push(href);
      }}
    >
      {children}
    </tr>
  );
}
