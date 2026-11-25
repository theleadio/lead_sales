// Records marketing-email consent for people who ALREADY opted in somewhere
// else, such as SalesProcess's subscribed list. Nothing else grants consent in
// bulk, and no one is ever marked consented by guesswork (PDPA).
//
//   node --env-file-if-exists=.env.local scripts/consent-import.ts \
//     --file subscribed.csv --source "salesprocess-subscribed-2026-11"
//   ... add --apply to write
//
// The file has one email address per line (a header line "email" is fine, and
// so are extra columns: the first column is used). Without --apply it only
// counts what it WOULD do. An address with no matching person is counted and
// ignored. Someone whose latest consent row is a withdrawal is never
// re-granted: they said no, and a spreadsheet doesn't change that.
//
// --source is stored on each consent row (as `import:<source>`), so every
// grant can be traced to the list it came from. Prints counts only: Actions
// and terminal logs may be shared.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { isValidEmail, normalizeEmail } from "../lib/crm/email.ts";
import { raiseEvent } from "../lib/crm/events.ts";
import { closeDb, db, withTransaction } from "../lib/sql.ts";

const { values } = parseArgs({
  options: {
    file: { type: "string" },
    source: { type: "string" },
    apply: { type: "boolean", default: false },
  },
});

try {
  if (!values.file || !values.source)
    throw new Error("--file and --source are required");
  if (!/^[a-z0-9][a-z0-9_.-]{2,60}$/i.test(values.source))
    throw new Error("--source: 3-61 letters, digits, . _ - (no spaces)");

  const emails = [
    ...new Set(
      readFileSync(values.file, "utf8")
        .split(/\r?\n/)
        .map((l) => normalizeEmail(l.split(",")[0].replace(/^"|"$/g, "")))
        .filter((e) => e !== "email" && isValidEmail(e)),
    ),
  ];

  const sql = db();
  const people = await sql`
    SELECT p.id, p.email_norm,
           coalesce(c.is_granted, NULL) AS latest
    FROM person p
    LEFT JOIN consent_current c
      ON c.person_id = p.id AND c.purpose = 'marketing_email'
    WHERE p.email_norm = ANY(${emails}::text[])
      AND p.deleted_at IS NULL AND p.erased_at IS NULL
      AND p.merged_into_id IS NULL`;

  const matched = new Set(people.map((p) => p.email_norm));
  const toGrant = people.filter((p) => p.latest === null);
  const stats = {
    addressesInFile: emails.length,
    noMatchingPerson: emails.filter((e) => !matched.has(e)).length,
    alreadyConsented: people.filter((p) => p.latest === true).length,
    withdrawnSoSkipped: people.filter((p) => p.latest === false).length,
    wouldGrant: toGrant.length,
  };

  if (values.apply) {
    await withTransaction(async () => {
      for (const p of toGrant) {
        await sql`
          INSERT INTO consent (person_id, purpose, is_granted, source)
          VALUES (${p.id}, 'marketing_email', true, ${`import:${values.source}`})`;
        await raiseEvent(
          "ConsentChanged",
          p.id,
          { personId: p.id, purpose: "marketing_email", isGranted: true },
          null,
        );
      }
    });
  }
  console.log(
    `consent-import: ${values.apply ? "APPLIED" : "dry run (add --apply to write)"} ${JSON.stringify(stats)}`,
  );
} catch (e) {
  console.error(
    `consent-import: ${e instanceof Error ? e.message : String(e)}`,
  );
  process.exitCode = 1;
} finally {
  await closeDb();
}
