import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { CHANNELS } from "@/lib/tickets/service";
import { canEditTicketSettings, settingsView } from "@/lib/tickets/settings";
import { button, field } from "../../tickets/ui";
import {
  addHolidaysAction,
  addMemberAction,
  addRuleAction,
  deleteHolidayAction,
  deleteRuleAction,
  removeMemberAction,
  saveCategoryAction,
} from "./actions";

// Ticket settings (inbox spec §5): teams and members, categories, routing
// rules and holidays. super_admin and management only.

const RESULTS: Record<string, { text: string; ok: boolean }> = {
  saved: { text: "Saved.", ok: true },
  invalid: {
    text: "Not saved. Check that: the email belongs to an active CRM user; a category code is lowercase letters, digits or _; a rule matches a channel or a category; a fixed rule names a person; the general category stays on.",
    ok: false,
  },
  forbidden: {
    text: "Only super_admin and management can change these.",
    ok: false,
  },
  bad_holidays: {
    text: "No holidays were added: some lines weren't YYYY-MM-DD followed by a name. Fix them and paste again.",
    ok: false,
  },
};

const small = "text-ink-muted text-xs underline cursor-pointer";

export default async function TicketSettingsPage({
  searchParams,
}: PageProps<"/settings/tickets">) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  if (!canEditTicketSettings(user.role)) redirect("/tickets?error=forbidden");
  const q = await searchParams;
  const result =
    RESULTS[String(Array.isArray(q.result) ? q.result[0] : q.result)];
  const s = await settingsView();
  const teamName = (id: string | null) =>
    s.teams.find((t) => t.id === id)?.name ?? "Category's team";

  return (
    <section className="max-w-4xl">
      <Link href="/tickets" className="text-ink-muted text-sm underline">
        Tickets
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Ticket settings</h1>
      {result && (
        <p
          role={result.ok ? "status" : "alert"}
          className={`mt-4 rounded-xl border px-4 py-3 text-sm ${result.ok ? "border-line bg-surface-muted" : "border-danger/40 bg-danger/5 text-danger"}`}
        >
          {result.text}
        </p>
      )}

      <h2 className="mt-8 text-lg font-semibold">Teams</h2>
      <p className="text-ink-muted text-sm">
        Members get the team&apos;s tickets in turn. Finance is restricted: only
        its members, super_admin and management can open its tickets.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {s.teams.map((t) => (
          <div key={t.id} className="border-line rounded-2xl border p-4">
            <h3 className="font-semibold">
              {t.name}
              {t.isDefault && <Tag>default</Tag>}
              {t.restricted && <Tag>restricted</Tag>}
            </h3>
            {t.members.length === 0 ? (
              <p className="text-danger mt-2 text-sm">
                No members: its tickets stay unassigned.
              </p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {t.members.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between gap-2"
                  >
                    <span>
                      {m.name}
                      {!m.active && (
                        <span className="text-ink-muted"> (inactive)</span>
                      )}
                    </span>
                    <form action={removeMemberAction}>
                      <input type="hidden" name="teamId" value={t.id} />
                      <input type="hidden" name="userId" value={m.id} />
                      <button type="submit" className={small}>
                        Remove
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <form action={addMemberAction} className="mt-3 flex gap-2">
              <input type="hidden" name="teamId" value={t.id} />
              <input
                name="email"
                type="email"
                required
                placeholder="CRM login email"
                aria-label={`Add to ${t.name} by CRM login email`}
                className={`${field} min-w-0 flex-1`}
              />
              <button type="submit" className={button}>
                Add
              </button>
            </form>
          </div>
        ))}
      </div>

      <h2 className="mt-10 text-lg font-semibold">Categories</h2>
      <p className="text-ink-muted text-sm">
        A category decides the team. Keywords (comma-separated) only suggest a
        category for a message; they never route on their own.
      </p>
      <div className="mt-4 flex flex-col gap-3">
        {[...s.categories, null].map((c) => (
          <form
            key={c?.code ?? "new"}
            action={saveCategoryAction}
            className="border-line grid gap-2 rounded-2xl border p-3 text-sm sm:grid-cols-6"
          >
            <input
              name="code"
              defaultValue={c?.code}
              readOnly={Boolean(c)}
              required
              placeholder="new_code"
              aria-label="Code"
              className={`${field} ${c ? "bg-surface-muted" : ""}`}
            />
            <input
              name="labelEn"
              defaultValue={c?.labelEn}
              required
              placeholder="Label"
              aria-label="English label"
              className={field}
            />
            <input
              name="labelZh"
              defaultValue={c?.labelZh ?? ""}
              placeholder="中文"
              aria-label="Chinese label"
              className={field}
            />
            <select
              name="teamId"
              defaultValue={c?.teamId}
              aria-label="Team"
              className={field}
            >
              {s.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <input
              name="keywords"
              defaultValue={c?.keywords.join(", ")}
              placeholder="keywords"
              aria-label="Keywords"
              className={field}
            />
            <div className="flex items-center gap-2">
              <input type="hidden" name="position" value={c?.position ?? 500} />
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  name="active"
                  defaultChecked={c?.active ?? true}
                />{" "}
                On
              </label>
              <button type="submit" className={button}>
                {c ? "Save" : "Add"}
              </button>
            </div>
          </form>
        ))}
      </div>

      <h2 className="mt-10 text-lg font-semibold">Routing rules</h2>
      <p className="text-ink-muted text-sm">
        Checked in order, lowest number first; the first that matches wins. With
        no match, a ticket goes to its category&apos;s team, in turn.
      </p>
      {s.rules.length > 0 && (
        <table className="mt-4 w-full text-left text-sm">
          <thead className="text-ink-muted">
            <tr>
              <th className="py-1 pr-3 font-medium">#</th>
              <th className="py-1 pr-3 font-medium">Channel</th>
              <th className="py-1 pr-3 font-medium">Category</th>
              <th className="py-1 pr-3 font-medium">Team</th>
              <th className="py-1 pr-3 font-medium">Assign</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {s.rules.map((r) => (
              <tr key={r.id} className="border-line border-t">
                <td className="py-1 pr-3">{r.position}</td>
                <td className="py-1 pr-3">{r.matchChannel ?? "any"}</td>
                <td className="py-1 pr-3">{r.matchCategory ?? "any"}</td>
                <td className="py-1 pr-3">{teamName(r.setTeamId)}</td>
                <td className="py-1 pr-3">
                  {r.assignMode === "fixed"
                    ? (r.assignUserName ?? "fixed")
                    : r.assignMode === "none"
                      ? "nobody"
                      : "in turn"}
                </td>
                <td className="py-1">
                  <form action={deleteRuleAction}>
                    <input type="hidden" name="ruleId" value={r.id} />
                    <button type="submit" className={small}>
                      Delete
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form
        action={addRuleAction}
        className="border-line mt-4 grid gap-2 rounded-2xl border p-3 text-sm sm:grid-cols-6"
      >
        <input
          name="position"
          type="number"
          min={0}
          max={10000}
          defaultValue={(s.rules.at(-1)?.position ?? 0) + 10}
          aria-label="Order"
          className={field}
        />
        <select
          name="matchChannel"
          aria-label="Channel"
          className={field}
          defaultValue=""
        >
          <option value="">Any channel</option>
          {CHANNELS.map((ch) => (
            <option key={ch} value={ch}>
              {ch.replace("_", " ")}
            </option>
          ))}
        </select>
        <select
          name="matchCategory"
          aria-label="Category"
          className={field}
          defaultValue=""
        >
          <option value="">Any category</option>
          {s.categories.map((c) => (
            <option key={c.code} value={c.code}>
              {c.labelEn}
            </option>
          ))}
        </select>
        <select
          name="setTeamId"
          aria-label="Team"
          className={field}
          defaultValue=""
        >
          <option value="">Category&apos;s team</option>
          {s.teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select
          name="assignMode"
          aria-label="Assign"
          className={field}
          defaultValue="round_robin"
        >
          <option value="round_robin">In turn</option>
          <option value="fixed">One person</option>
          <option value="none">Nobody</option>
        </select>
        <div className="flex gap-2">
          <input
            name="assignEmail"
            type="email"
            placeholder="person's email"
            aria-label="Person for a fixed rule"
            className={`${field} min-w-0 flex-1`}
          />
          <button type="submit" className={button}>
            Add
          </button>
        </div>
      </form>

      <h2 className="mt-10 text-lg font-semibold">Holidays</h2>
      <p className="text-ink-muted text-sm">
        National plus KL/Selangor public holidays. Deadlines skip these days.
        Enter each year&apos;s dates from the official gazette: several follow
        the moon and are only fixed shortly before.
      </p>
      {s.holidays.length === 0 ? (
        <p className="text-danger mt-2 text-sm">
          No holidays entered: deadlines treat every weekday as a working day.
        </p>
      ) : (
        <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
          {s.holidays.map((h) => (
            <li key={h.day} className="flex items-center justify-between gap-2">
              <span>
                <span className="font-medium">{h.day}</span> {h.name}
              </span>
              <form action={deleteHolidayAction}>
                <input type="hidden" name="day" value={h.day} />
                <button type="submit" className={small}>
                  Delete
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <form action={addHolidaysAction} className="mt-4 flex flex-col gap-2">
        <label htmlFor="lines" className="text-sm font-medium">
          Add holidays, one per line
        </label>
        <textarea
          id="lines"
          name="lines"
          rows={5}
          required
          maxLength={10000}
          placeholder="2026-12-25 Christmas Day"
          className={`${field} font-mono`}
        />
        <button type="submit" className={`${button} self-start`}>
          Add holidays
        </button>
      </form>
    </section>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="bg-lead-blue/50 ml-2 rounded-full px-2 py-0.5 text-xs font-medium">
      {children}
    </span>
  );
}
