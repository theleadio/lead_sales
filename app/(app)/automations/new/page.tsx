import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canEditAutomations } from "@/lib/automations/admin";
import { AutomationEditor } from "../editor";
import { triggerOptions } from "../shared";

export default async function NewAutomationPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  if (!canEditAutomations(user.role)) redirect("/home");
  return (
    <section className="max-w-3xl">
      <Link href="/automations" className="text-ink-muted text-sm underline">
        Automations
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">New automation</h1>
      <AutomationEditor
        name=""
        trigger={triggerOptions[0].value}
        conditions={[]}
        steps={[]}
        triggers={triggerOptions}
      />
    </section>
  );
}
