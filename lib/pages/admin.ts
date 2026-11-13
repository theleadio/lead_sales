import { writeAudit } from "../audit.ts";
import type { Role } from "../auth/roles.ts";
import { isUuid } from "../crm/people.ts";
import { db, withTransaction } from "../sql.ts";
import { TicketError, type Actor } from "../tickets/service.ts";
import { blocksSchema, pageSchema, type Block } from "./model.ts";

// Making, changing and publishing landing pages. Every change is audited.

const EDITORS: readonly Role[] = [
  "super_admin",
  "management",
  "marketing",
  "sales",
];
export const canEditPages = (role: Role) => EDITORS.includes(role);

async function guard(actor: Actor, what: string) {
  if (canEditPages(actor.role)) return;
  await writeAudit({
    userId: actor.id,
    action: "permission_denied",
    entity: "page",
    entityId: null,
    before: null,
    after: { what },
  });
  throw new TicketError("forbidden", "You can't change pages.");
}

export type Page = {
  id: string;
  slug: string;
  title: string;
  description: string;
  language: "en" | "zh";
  blocks: Block[];
  published: boolean;
  updatedAt: Date;
};

const toPage = (r: Record<string, unknown>): Page => ({
  id: r.id as string,
  slug: r.slug as string,
  title: r.title as string,
  description: r.description as string,
  language: r.language as "en" | "zh",
  // Rows are written only through pageSchema; a row that no longer parses
  // (a block kind removed later) shows no blocks, not a crash.
  blocks: blocksSchema.safeParse(r.blocks).data ?? [],
  published: r.published as boolean,
  updatedAt: r.updated_at as Date,
});

export async function listPages(): Promise<Page[]> {
  return (await db()`SELECT * FROM sales.page ORDER BY updated_at DESC`).map(
    toPage,
  );
}

export async function pageDetail(id: string): Promise<Page | null> {
  if (!isUuid(id)) return null;
  const [r] = await db()`SELECT * FROM sales.page WHERE id = ${id}`;
  return r ? toPage(r) : null;
}

// The page at a public address. Drafts only when asked (staff preview).
export async function pageBySlug(
  slug: string,
  includeDraft = false,
): Promise<Page | null> {
  const [r] = await db()`
    SELECT * FROM sales.page
    WHERE slug = ${slug} AND (published OR ${includeDraft})`;
  return r ? toPage(r) : null;
}

// Adds or replaces a page. Its published state is kept (a new one is a draft).
export async function savePage(
  actor: Actor,
  input: unknown,
  id?: string,
): Promise<string> {
  await guard(actor, "save page");
  const parsed = pageSchema.safeParse(input);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    const at =
      i.path[0] === "blocks" && typeof i.path[1] === "number"
        ? `Block ${i.path[1] + 1}: `
        : "";
    throw new TicketError("invalid", at + i.message);
  }
  if (id && !isUuid(id)) throw new TicketError("not_found", "No such page.");
  const p = parsed.data;
  try {
    return await withTransaction(async () => {
      const sql = db();
      let before: unknown = null;
      let pageId = id ?? null;
      if (pageId) {
        [before] =
          await sql`SELECT * FROM sales.page WHERE id = ${pageId} FOR UPDATE`;
        if (!before) throw new TicketError("not_found", "No such page.");
        await sql`
          UPDATE sales.page
          SET title = ${p.title}, slug = ${p.slug}, description = ${p.description},
              language = ${p.language}, blocks = ${sql.json(p.blocks as never)},
              updated_at = now()
          WHERE id = ${pageId}`;
      } else {
        const [r] = await sql`
          INSERT INTO sales.page (created_by, title, slug, description, language, blocks)
          VALUES (${actor.id}, ${p.title}, ${p.slug}, ${p.description},
                  ${p.language}, ${sql.json(p.blocks as never)})
          RETURNING id`;
        pageId = r.id as string;
      }
      await writeAudit({
        userId: actor.id,
        action: id ? "update" : "create",
        entity: "page",
        entityId: pageId,
        before,
        after: p,
      });
      return pageId;
    });
  } catch (e) {
    if ((e as { code?: string }).code === "23505")
      throw new TicketError(
        "invalid",
        "Another page already has that address.",
      );
    throw e;
  }
}

export async function setPagePublished(
  actor: Actor,
  id: string,
  published: boolean,
) {
  await guard(actor, published ? "publish page" : "unpublish page");
  if (!isUuid(id)) throw new TicketError("not_found", "No such page.");
  const rows = await db()`
    UPDATE sales.page SET published = ${published}, updated_at = now()
    WHERE id = ${id} RETURNING id`;
  if (!rows.length) throw new TicketError("not_found", "No such page.");
  await writeAudit({
    userId: actor.id,
    action: "update",
    entity: "page",
    entityId: id,
    before: null,
    after: { published },
  });
}
