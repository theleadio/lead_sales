import type { Metadata } from "next";
import { connection } from "next/server";
import { LeadLogo } from "../logo";
import { helpCategories } from "@/lib/help/intake";
import { HelpForm } from "./help-form";

// The public help form (inbox spec §5): open to anyone, no sign-in. Each
// submission becomes a ticket for the right team (lib/help/intake.ts). The
// new website can link here, or post to /api/public/help itself.

export const metadata: Metadata = {
  title: "Get help · LEAD",
  description: "Ask LEAD about receipts, e-invoices, vouchers and more.",
};

export default async function HelpPage() {
  // Read at request time: the categories can change in Settings.
  await connection();
  const categories = await helpCategories("en");
  return (
    <main className="bg-surface-muted flex min-h-screen justify-center px-4 py-12">
      <div className="bg-surface border-line w-full max-w-xl rounded-2xl border p-8 shadow-sm">
        <LeadLogo />
        <h1 className="mt-5 text-xl font-semibold tracking-wide">Get help</h1>
        <p className="text-ink-muted mt-2 mb-6 text-sm">
          Tell us what you need and we&apos;ll reply by the next working day.
        </p>
        <HelpForm categories={categories} />
      </div>
    </main>
  );
}
