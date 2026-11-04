// Ticket settings (lib/tickets/settings.ts): only super_admin and
// management change them; members by CRM login email; categories, rules
// and holidays; every change audited. Each test is rolled back.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createTicket, loadHolidays } from "../lib/tickets/service.ts";
import {
  addHolidays,
  addRule,
  addTeamMember,
  deleteHoliday,
  deleteRule,
  parseHolidays,
  removeTeamMember,
  saveCategory,
  settingsView,
} from "../lib/tickets/settings.ts";
import { closeDb, db } from "../lib/sql.ts";
import { it, newPerson, newUser } from "./seed.ts";

after(closeDb);

test("holiday lines: date then name; bad lines are returned, not dropped", () => {
  const r = parseHolidays(
    "2026-12-25 Christmas Day\n\n2027-02-30 Not a day\n2027-01-01,\tNew Year\nDec 25 Christmas",
  );
  assert.deepEqual(r.days, [
    { day: "2026-12-25", name: "Christmas Day" },
    { day: "2027-01-01", name: "New Year" },
  ]);
  assert.deepEqual(r.bad, ["2027-02-30 Not a day", "Dec 25 Christmas"]);
});

async function team(code: string) {
  const [t] = await db()`SELECT id FROM sales.team WHERE code = ${code}`;
  return t.id as string;
}

async function userWithEmail(role: Parameters<typeof newUser>[0]) {
  const u = await newUser(role);
  const [r] = await db()`SELECT email FROM app_user WHERE id = ${u.id}`;
  return { ...u, email: r.email as string };
}

it("only super_admin and management may change settings; a refusal is audited", async () => {
  const sales = await newUser("sales");
  const target = await userWithEmail("support");
  await assert.rejects(
    addTeamMember(sales, await team("support"), target.email),
    /Only super_admin and management/,
  );
  const [a] = await db()`
    SELECT 1 FROM audit_log
    WHERE action = 'permission_denied' AND entity = 'ticket_settings' AND user_id = ${sales.id}`;
  assert.ok(a);
});

it("members are added by CRM login email and then get tickets; removal is a permission change", async () => {
  await db()`DELETE FROM sales.team_member`;
  await db()`DELETE FROM sales.ticket_rule`;
  const boss = await newUser("management");
  const mischa = await userWithEmail("operations");
  const fin = await team("finance");
  await addTeamMember(boss, fin, `  ${mischa.email.toUpperCase()} `);
  await addTeamMember(boss, fin, mischa.email); // again: no change
  let v = await settingsView();
  assert.deepEqual(
    v.teams.find((t) => t.id === fin)!.members.map((m) => m.id),
    [mischa.id],
  );
  const t = await createTicket(
    {
      personId: await newPerson("Customer"),
      sourceChannel: "manual",
      category: "einvoice",
      subject: "e-invoice",
    },
    null,
    new Set(),
  );
  assert.equal(t.assigned_user_id, mischa.id);

  await removeTeamMember(boss, fin, mischa.id);
  v = await settingsView();
  assert.equal(v.teams.find((t) => t.id === fin)!.members.length, 0);
  const changes = await db()`
    SELECT before, after FROM audit_log
    WHERE action = 'permission_change' AND entity = 'team_member' AND entity_id = ${mischa.id}
    ORDER BY at`;
  assert.equal(
    changes.length,
    2,
    "one add (the repeat isn't logged), one removal",
  );

  await assert.rejects(
    addTeamMember(boss, fin, "nobody@nowhere.test"),
    /No active CRM user/,
  );
});

it("categories: add, edit (code kept), and general can't be turned off", async () => {
  const boss = await newUser("super_admin");
  const tech = await team("tech");
  await saveCategory(boss, {
    code: "lms_login",
    labelEn: "LMS login",
    labelZh: null,
    teamId: tech,
    keywords: [" Login ", "password", "login"],
    active: true,
    position: 50,
  });
  const [c] =
    await db()`SELECT * FROM sales.ticket_category WHERE code = 'lms_login'`;
  assert.deepEqual(c.keywords, ["login", "password"]);
  assert.equal(c.team_id, tech);
  await saveCategory(boss, {
    code: "lms_login",
    labelEn: "LMS login help",
    labelZh: "登录",
    teamId: tech,
    keywords: [],
    active: false,
    position: 50,
  });
  const [c2] =
    await db()`SELECT label_en, active FROM sales.ticket_category WHERE code = 'lms_login'`;
  assert.equal(c2.label_en, "LMS login help");
  assert.equal(c2.active, false);
  const [general] =
    await db()`SELECT team_id FROM sales.ticket_category WHERE code = 'general'`;
  await assert.rejects(
    saveCategory(boss, {
      code: "general",
      labelEn: "General",
      labelZh: null,
      teamId: general.team_id,
      keywords: [],
      active: false,
      position: 1000,
    }),
    /general category can't be turned off/,
  );
});

it("rules: need a match; a fixed rule needs an active person; delete is audited", async () => {
  await db()`DELETE FROM sales.ticket_rule`;
  const boss = await newUser("management");
  const qiEn = await userWithEmail("operations");
  await assert.rejects(
    addRule(boss, {
      position: 10,
      matchChannel: null,
      matchCategory: null,
      setTeamId: null,
      assignMode: "round_robin",
      assignEmail: null,
    }),
    /must match/,
  );
  await assert.rejects(
    addRule(boss, {
      position: 10,
      matchChannel: "web_form",
      matchCategory: null,
      setTeamId: null,
      assignMode: "fixed",
      assignEmail: null,
    }),
    /needs a person/,
  );
  await addRule(boss, {
    position: 10,
    matchChannel: "web_form",
    matchCategory: null,
    setTeamId: await team("operations"),
    assignMode: "fixed",
    assignEmail: qiEn.email,
  });
  const v = await settingsView();
  assert.equal(v.rules.length, 1);
  assert.equal(v.rules[0].assignMode, "fixed");
  await deleteRule(boss, v.rules[0].id);
  assert.equal((await settingsView()).rules.length, 0);
  const [d] = await db()`
    SELECT 1 FROM audit_log WHERE action = 'delete' AND entity = 'ticket_rule' AND entity_id = ${v.rules[0].id}`;
  assert.ok(d);
});

it("holidays: a pasted list is all-or-nothing, and deadlines then skip them", async () => {
  const boss = await newUser("management");
  const bad = await addHolidays(boss, "2099-01-02 Test day\nnot a line");
  assert.equal(bad.added, 0);
  assert.deepEqual(bad.bad, ["not a line"]);

  const today = new Date();
  const soon = new Date(today.getTime() + 20 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const r = await addHolidays(boss, `${soon} Test holiday`);
  assert.equal(r.added, 1);
  assert.ok((await loadHolidays()).has(soon), "loaded for deadlines");
  await deleteHoliday(boss, soon);
  assert.ok(!(await loadHolidays()).has(soon));
});
