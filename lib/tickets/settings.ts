import { writeAudit } from "../audit.ts";
import type { Role } from "../auth/roles.ts";
import { isUuid } from "../crm/people.ts";
import { normalizeEmail } from "../crm/email.ts";
import { db, withTransaction } from "../sql.ts";
import { CHANNELS, TicketError, type Actor } from "./service.ts";

// Ticket settings (inbox spec §5 Settings): team members, categories,
// routing rules and holidays. super_admin and management only. Every change
// is audited; adding or removing a team member is a permission change (it
// decides who can open that team's tickets).

const EDITORS: readonly Role[] = ["super_admin", "management"];
export const canEditTicketSettings = (role: Role) => EDITORS.includes(role);

async function guard(actor: Actor, what: string) {
  if (canEditTicketSettings(actor.role)) return;
  await writeAudit({
    userId: actor.id,
    action: "permission_denied",
    entity: "ticket_settings",
    entityId: null,
    before: null,
    after: { what },
  });
  throw new TicketError(
    "forbidden",
    "Only super_admin and management can change ticket settings.",
  );
}

const CODE = /^[a-z][a-z0-9_]{1,30}$/;

// ---- Read ---------------------------------------------------------------------

export async function settingsView() {
  const sql = db();
  const [teams, members, categories, rules, holidays] = await Promise.all([
    sql`SELECT id, code, name, is_default, restricted FROM sales.team ORDER BY name`,
    sql`
      SELECT m.team_id, u.id, u.full_name, u.email, u.is_active, m.last_assigned_at
      FROM sales.team_member m JOIN app_user u ON u.id = m.user_id
      ORDER BY u.full_name`,
    sql`
      SELECT code, label_en, label_zh, team_id, keywords, active, position
      FROM sales.ticket_category ORDER BY position, code`,
    sql`
      SELECT r.id, r.position, r.match_channel, r.match_category, r.set_team_id,
             r.assign_mode, r.assign_user_id, r.active, u.full_name AS assign_user_name
      FROM sales.ticket_rule r LEFT JOIN app_user u ON u.id = r.assign_user_id
      ORDER BY r.position, r.id`,
    sql`
      SELECT day::text AS day, name FROM sales.holiday
      WHERE day >= current_date - 31 ORDER BY day`,
  ]);
  return {
    teams: teams.map((t) => ({
      id: t.id as string,
      code: t.code as string,
      name: t.name as string,
      isDefault: t.is_default as boolean,
      restricted: t.restricted as boolean,
      members: members
        .filter((m) => m.team_id === t.id)
        .map((m) => ({
          id: m.id as string,
          name: m.full_name as string,
          email: m.email as string | null,
          active: m.is_active as boolean,
        })),
    })),
    categories: categories.map((c) => ({
      code: c.code as string,
      labelEn: c.label_en as string,
      labelZh: c.label_zh as string | null,
      teamId: c.team_id as string,
      keywords: c.keywords as string[],
      active: c.active as boolean,
      position: c.position as number,
    })),
    rules: rules.map((r) => ({
      id: r.id as string,
      position: r.position as number,
      matchChannel: r.match_channel as string | null,
      matchCategory: r.match_category as string | null,
      setTeamId: r.set_team_id as string | null,
      assignMode: r.assign_mode as string,
      assignUserName: r.assign_user_name as string | null,
      active: r.active as boolean,
    })),
    holidays: holidays.map((h) => ({
      day: h.day as string,
      name: h.name as string,
    })),
  };
}

// ---- Team members -------------------------------------------------------------

export async function addTeamMember(
  actor: Actor,
  teamId: string,
  email: string,
) {
  await guard(actor, "add team member");
  if (!isUuid(teamId)) throw new TicketError("invalid", "Unknown team.");
  const norm = normalizeEmail(email);
  await withTransaction(async () => {
    const sql = db();
    const [u] = await sql`
      SELECT id FROM app_user WHERE lower(btrim(email)) = ${norm} AND is_active`;
    if (!u)
      throw new TicketError("invalid", "No active CRM user has that email.");
    const [t] = await sql`SELECT id FROM sales.team WHERE id = ${teamId}`;
    if (!t) throw new TicketError("invalid", "Unknown team.");
    const added = await sql`
      INSERT INTO sales.team_member (team_id, user_id) VALUES (${teamId}, ${u.id})
      ON CONFLICT DO NOTHING RETURNING user_id`;
    if (added.length)
      await writeAudit({
        userId: actor.id,
        action: "permission_change",
        entity: "team_member",
        entityId: u.id,
        before: null,
        after: { teamId, userId: u.id },
      });
  });
}

export async function removeTeamMember(
  actor: Actor,
  teamId: string,
  userId: string,
) {
  await guard(actor, "remove team member");
  if (!isUuid(teamId) || !isUuid(userId))
    throw new TicketError("invalid", "Unknown member.");
  await withTransaction(async () => {
    const gone = await db()`
      DELETE FROM sales.team_member WHERE team_id = ${teamId} AND user_id = ${userId}
      RETURNING user_id`;
    if (gone.length)
      await writeAudit({
        userId: actor.id,
        action: "permission_change",
        entity: "team_member",
        entityId: userId,
        before: { teamId, userId },
        after: null,
      });
  });
}

// ---- Categories ---------------------------------------------------------------

export type CategoryInput = {
  code: string;
  labelEn: string;
  labelZh: string | null;
  teamId: string;
  keywords: string[];
  active: boolean;
  position: number;
};

// Adds a category, or updates the one with this code. A code is never
// renamed: tickets keep it.
export async function saveCategory(actor: Actor, c: CategoryInput) {
  await guard(actor, "save category");
  if (!CODE.test(c.code))
    throw new TicketError("invalid", "Code: lowercase letters, digits, _.");
  if (!c.labelEn.trim() || c.labelEn.length > 100)
    throw new TicketError("invalid", "An English label is required.");
  if (!isUuid(c.teamId)) throw new TicketError("invalid", "Unknown team.");
  const keywords = [
    ...new Set(c.keywords.map((k) => k.trim().toLowerCase()).filter(Boolean)),
  ].slice(0, 30);
  if (keywords.some((k) => k.length > 50))
    throw new TicketError("invalid", "Keywords are up to 50 characters.");
  const position = Math.min(Math.max(Math.trunc(c.position) || 100, 0), 10000);
  await withTransaction(async () => {
    const sql = db();
    const [t] = await sql`SELECT 1 FROM sales.team WHERE id = ${c.teamId}`;
    if (!t) throw new TicketError("invalid", "Unknown team.");
    if (c.code === "general" && !c.active)
      throw new TicketError(
        "invalid",
        "The general category can't be turned off: it is the fallback.",
      );
    const [before] =
      await sql`SELECT * FROM sales.ticket_category WHERE code = ${c.code}`;
    await sql`
      INSERT INTO sales.ticket_category (code, label_en, label_zh, team_id, keywords, active, position)
      VALUES (${c.code}, ${c.labelEn.trim()}, ${c.labelZh?.trim() || null}, ${c.teamId},
              ${keywords}, ${c.active}, ${position})
      ON CONFLICT (code) DO UPDATE SET
        label_en = EXCLUDED.label_en, label_zh = EXCLUDED.label_zh,
        team_id = EXCLUDED.team_id, keywords = EXCLUDED.keywords,
        active = EXCLUDED.active, position = EXCLUDED.position`;
    await writeAudit({
      userId: actor.id,
      action: before ? "update" : "create",
      entity: "ticket_category",
      entityId: null,
      before: before ?? null,
      after: { ...c, keywords, position },
    });
  });
}

// ---- Rules --------------------------------------------------------------------

export type RuleInput = {
  position: number;
  matchChannel: string | null;
  matchCategory: string | null;
  setTeamId: string | null;
  assignMode: "round_robin" | "fixed" | "none";
  assignEmail: string | null;
};

export async function addRule(actor: Actor, r: RuleInput) {
  await guard(actor, "add rule");
  if (
    r.matchChannel &&
    !(CHANNELS as readonly string[]).includes(r.matchChannel)
  )
    throw new TicketError("invalid", "Unknown channel.");
  if (r.setTeamId && !isUuid(r.setTeamId))
    throw new TicketError("invalid", "Unknown team.");
  if (!r.matchChannel && !r.matchCategory)
    throw new TicketError(
      "invalid",
      "A rule must match a channel or a category.",
    );
  await withTransaction(async () => {
    const sql = db();
    let userId: string | null = null;
    if (r.assignMode === "fixed") {
      if (!r.assignEmail)
        throw new TicketError("invalid", "A fixed rule needs a person.");
      const [u] = await sql`
        SELECT id FROM app_user WHERE lower(btrim(email)) = ${normalizeEmail(r.assignEmail)} AND is_active`;
      if (!u)
        throw new TicketError("invalid", "No active CRM user has that email.");
      userId = u.id;
    }
    if (r.matchCategory) {
      const [c] =
        await sql`SELECT 1 FROM sales.ticket_category WHERE code = ${r.matchCategory}`;
      if (!c) throw new TicketError("invalid", "Unknown category.");
    }
    const [row] = await sql`
      INSERT INTO sales.ticket_rule (position, match_channel, match_category,
        set_team_id, assign_mode, assign_user_id)
      VALUES (${Math.min(Math.max(Math.trunc(r.position) || 100, 0), 10000)},
              ${r.matchChannel}, ${r.matchCategory}, ${r.setTeamId},
              ${r.assignMode}, ${userId})
      RETURNING id`;
    await writeAudit({
      userId: actor.id,
      action: "create",
      entity: "ticket_rule",
      entityId: row.id,
      before: null,
      after: { ...r, assignUserId: userId },
    });
  });
}

export async function deleteRule(actor: Actor, ruleId: string) {
  await guard(actor, "delete rule");
  if (!isUuid(ruleId)) throw new TicketError("invalid", "Unknown rule.");
  await withTransaction(async () => {
    const [gone] =
      await db()`DELETE FROM sales.ticket_rule WHERE id = ${ruleId} RETURNING *`;
    if (gone)
      await writeAudit({
        userId: actor.id,
        action: "delete",
        entity: "ticket_rule",
        entityId: ruleId,
        before: gone,
        after: null,
      });
  });
}

// ---- Holidays -----------------------------------------------------------------

// One holiday per line: "2026-12-25 Christmas Day" (also "2026-12-25, …" or
// a tab). Returns the lines it couldn't read, so nothing is silently dropped.
export function parseHolidays(text: string): {
  days: { day: string; name: string }[];
  bad: string[];
} {
  const days: { day: string; name: string }[] = [];
  const bad: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(\d{4})-(\d{2})-(\d{2})[\s,;\t]+(.{1,100})$/.exec(line);
    const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (!m || !d || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) {
      bad.push(line.slice(0, 120));
      continue;
    }
    days.push({ day: `${m[1]}-${m[2]}-${m[3]}`, name: m[4].trim() });
  }
  return { days, bad };
}

export async function addHolidays(
  actor: Actor,
  text: string,
): Promise<{ added: number; bad: string[] }> {
  await guard(actor, "add holidays");
  const { days, bad } = parseHolidays(text);
  if (bad.length) return { added: 0, bad };
  if (days.length > 100)
    throw new TicketError("invalid", "Up to 100 holidays at a time.");
  return withTransaction(async () => {
    const sql = db();
    let added = 0;
    for (const h of days) {
      const r = await sql`
        INSERT INTO sales.holiday (day, name) VALUES (${h.day}, ${h.name})
        ON CONFLICT (day) DO UPDATE SET name = EXCLUDED.name
        RETURNING day`;
      added += r.length;
    }
    await writeAudit({
      userId: actor.id,
      action: "update",
      entity: "holiday",
      entityId: null,
      before: null,
      after: { days },
    });
    return { added, bad: [] };
  });
}

export async function deleteHoliday(actor: Actor, day: string) {
  await guard(actor, "delete holiday");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day))
    throw new TicketError("invalid", "Unknown date.");
  await withTransaction(async () => {
    const [gone] =
      await db()`DELETE FROM sales.holiday WHERE day = ${day} RETURNING day::text, name`;
    if (gone)
      await writeAudit({
        userId: actor.id,
        action: "delete",
        entity: "holiday",
        entityId: null,
        before: gone,
        after: null,
      });
  });
}
