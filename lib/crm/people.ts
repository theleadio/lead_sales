import { writeAudit } from "../audit.ts";
import { normaliseName } from "./dedupe.ts";
import { db } from "../sql.ts";

// Copied from lead_crm (lib/people/service.ts, lib/people/duplicate-review.ts).
// Keep in step. Spec §12.2 duplicate handling, used by captureLead().

export const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// Tasks a system writer creates go to the duty super_admin (spec O37), so
// they show on someone's Home; null only with no active super_admin.
export async function dutySuperAdmin(): Promise<string | null> {
  const [row] = await db()`
    SELECT id FROM app_user
    WHERE role_code = 'super_admin' AND is_active
    ORDER BY created_at, id
    LIMIT 1`;
  return row?.id ?? null;
}

type DupRow = {
  id: string;
  full_name: string;
  email_norm: string | null;
  phone_e164: string | null;
  company_norms: (string | null)[];
};

// normalise_company_name() from CRM migration 003: the one rule for "same
// company name" (§12.2 a). Call it for a typed company before findDuplicate.
export async function normaliseCompanyName(
  name: string | null | undefined,
): Promise<string | null> {
  if (!name?.trim()) return null;
  const [r] = await db()`SELECT normalise_company_name(${name}) AS n`;
  return r.n;
}

// Candidates for spec §12.2: hard matches on email/phone, plus people whose
// normalised name matches. The pure findDuplicate decides what counts.
export async function dedupeCandidates(
  c: { fullName: string; emailNorm: string | null; phoneE164: string | null },
  excludeId: string | null,
) {
  const sql = db();
  const rows = await sql<DupRow[]>`
    SELECT p.id, p.full_name, p.email_norm, p.phone_e164,
           ARRAY[
             (SELECT co.name_norm FROM company_membership m
              JOIN company co ON co.id = m.company_id
              WHERE m.person_id = p.id AND m.end_date IS NULL AND co.deleted_at IS NULL
              ORDER BY m.created_at LIMIT 1),
             normalise_company_name(p.company_name_given)
           ] AS company_norms
    FROM person p
    WHERE p.deleted_at IS NULL AND p.merged_into_id IS NULL
      ${excludeId ? sql`AND p.id <> ${excludeId}` : sql``}
      AND (
        ${c.emailNorm ? sql`p.email_norm = ${c.emailNorm} OR` : sql``}
        ${c.phoneE164 ? sql`p.phone_e164 = ${c.phoneE164} OR` : sql``}
        ${
          normaliseName(c.fullName)
            ? sql`regexp_replace(lower(p.full_name), '[[:space:].''’-]', '', 'g') = ${normaliseName(c.fullName)}`
            : sql`false`
        }
      )
    -- Hard matches first, so the cap can never hide one.
    ORDER BY (
      ${c.emailNorm ? sql`coalesce(p.email_norm = ${c.emailNorm}, false)` : sql`false`}
      OR ${c.phoneE164 ? sql`coalesce(p.phone_e164 = ${c.phoneE164}, false)` : sql`false`}
    ) DESC
    LIMIT 200`;
  return rows.map((r) => ({
    id: r.id,
    fullName: r.full_name,
    emailNorm: r.email_norm,
    phoneE164: r.phone_e164,
    companyNorms: r.company_norms.filter((n): n is string => n !== null),
  }));
}

export type DuplicatePair = { id: string; fullName: string };

// A soft match makes a review task for the duty super_admin. Null viewer =
// a system writer (the public form, Meta intake): no actor.
export async function raiseDuplicateTask(
  newPersonId: string,
  candidate: DuplicatePair,
  viewer: { id: string } | null,
): Promise<void> {
  const sql = db();
  const assignee = await dutySuperAdmin();
  const [task] = await sql`
    INSERT INTO task (type, title, person_id, related_person_id,
                      assigned_user_id, due_at, created_by)
    VALUES ('review_duplicate',
            ${`Possible duplicate of ${candidate.fullName}`},
            ${newPersonId}, ${candidate.id}, ${assignee},
            now(), ${viewer?.id ?? null})
    RETURNING id`;
  await writeAudit({
    userId: viewer?.id ?? null,
    action: "create",
    entity: "task",
    entityId: task.id,
    before: null,
    after: {
      type: "review_duplicate",
      personId: newPersonId,
      relatedPersonId: candidate.id,
      assignedUserId: assignee,
    },
  });
}
