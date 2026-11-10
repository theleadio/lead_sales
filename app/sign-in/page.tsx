import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/server";
import { LeadLogo } from "../logo";
import { SignInForm } from "./sign-in-form";

export default async function SignInPage() {
  if (await getSession()) redirect("/inbox");
  return (
    <main className="bg-surface-muted flex min-h-screen items-center justify-center">
      <div className="bg-surface border-line w-full max-w-sm rounded-2xl border p-8 shadow-sm">
        <h1 className="mb-6 flex items-center gap-2.5">
          <LeadLogo height={40} />
          <span className="text-xl font-semibold tracking-wide">Sales</span>
        </h1>
        <Suspense>
          <SignInForm />
        </Suspense>
      </div>
    </main>
  );
}
