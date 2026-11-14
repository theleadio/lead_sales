// lib/sites/admin: funnel creation, permissions, version conflicts, edit lock.
import { after } from "node:test";
import assert from "node:assert/strict";
import { pageSchema } from "../lib/sites/tree.ts";
import {
  cloneStep,
  addStep,
  createFunnel,
  renameStep,
  saveTemplate,
  deleteStep,
  getDraft,
  getSite,
  listSites,
  moveStep,
  saveDraft,
  setStepPath,
  SitesPermissionError,
  takeEditLock,
  updateSiteSettings,
} from "../lib/sites/admin.ts";
import {
  CONFLICT_MESSAGE,
  FORBIDDEN_MESSAGE,
  publishStep,
  saveSettings,
} from "../lib/sites/admin-actions.ts";
import { closeDb, db } from "../lib/sql.ts";
import { paraPage } from "./sites-fixtures.ts";
import { it, newUser } from "./seed.ts";

after(closeDb);

const base = () => `/t-${crypto.randomUUID().slice(0, 8)}`;
const settings = {
  pixels: {},
  capi: false,
  paymentMode: "test" as const,
  seo: {},
};

it("marketing creates a funnel with Home, Payment Form and Thank You steps", async () => {
  const m = await newUser("marketing");
  const b = base();
  const { siteId } = await createFunnel(m, {
    name: "F",
    language: "en",
    basePath: b,
  });
  const s = await getSite(m, siteId);
  assert.deepEqual(
    s!.steps.map((x) => [x.position, x.name, x.kind, x.path]),
    [
      [1, "Home", "page", b],
      [2, "Payment Form", "checkout", `${b}/payment`],
      [3, "Thank You", "thank_you", `${b}/thank-you`],
    ],
  );
  const [{ n }] = await db()`
    SELECT count(*)::int AS n FROM sales.page_version v JOIN sales.site_page p ON p.id = v.page_id
    WHERE p.site_id = ${siteId} AND v.status = 'draft'`;
  assert.equal(n, 3);
  assert.equal(
    (await listSites(m, "funnel")).find((r) => r.id === siteId)!.steps,
    3,
  );
});

it("sales cannot create a funnel and the refusal is audited", async () => {
  const s = await newUser("sales");
  await assert.rejects(
    createFunnel(s, { name: "F", language: "en", basePath: base() }),
    SitesPermissionError,
  );
  const [{ n }] = await db()`
    SELECT count(*)::int AS n FROM audit_log WHERE user_id = ${s.id} AND action = 'permission_denied'`;
  assert.equal(n, 1);
});

it("a stale draft save is refused as conflict", async () => {
  const m = await newUser("marketing");
  const { siteId } = await createFunnel(m, { name: "F", language: "en", basePath: base() });
  const page = (await getSite(m, siteId))!.steps[0];
  const one = paraPage("one");
  assert.deepEqual(await saveDraft(m, page.id, { project: one }, page.version), { kind: "ok", version: page.version + 1 });
  assert.deepEqual(await saveDraft(m, page.id, { project: paraPage("two") }, page.version), { kind: "conflict" });
  const d = await getDraft(m, page.id);
  assert.deepEqual(d.project, one);
  assert.equal(d.html, "");
  assert.equal(d.css, "");
});

it("an invalid tree is refused as 'invalid' and nothing is stored; rich text is sanitised on save", async () => {
  const m = await newUser("marketing");
  const { siteId } = await createFunnel(m, { name: "F", language: "en", basePath: base() });
  const page = (await getSite(m, siteId))!.steps[0];
  const r = await saveDraft(m, page.id, { project: { version: 1 } }, page.version);
  assert.equal(r.kind, "invalid");
  assert.deepEqual((await getDraft(m, page.id)).project, { version: 2, sections: [], popups: [] }); // the blank a new step starts with
  assert.equal((await getSite(m, siteId))!.steps[0].version, page.version);
  assert.equal((await saveDraft(m, page.id, { project: paraPage('a<script>x</script><b>b</b>') }, page.version)).kind, "ok");
  assert.match(JSON.stringify((await getDraft(m, page.id)).project), /"text":"a<b>b<\/b>"/);
});

it("a second editor sees the first editor as lock holder until 2 minutes pass", async () => {
  const a = await newUser("marketing");
  const b = await newUser("marketing");
  const { siteId } = await createFunnel(a, {
    name: "F",
    language: "en",
    basePath: base(),
  });
  const page = (await getSite(a, siteId))!.steps[0];
  assert.equal((await takeEditLock(a, page.id)).holder, null);
  assert.equal((await takeEditLock(b, page.id)).holder?.id, a.id);
  assert.equal((await getDraft(b, page.id)).lockedBy, "Test user");
  await db()`UPDATE sales.site_page SET edit_lock_at = now() - interval '3 minutes' WHERE id = ${page.id}`;
  assert.equal((await takeEditLock(b, page.id)).holder, null);
  assert.equal((await takeEditLock(a, page.id)).holder?.id, b.id);
});

it("settings change is audited with before/after", async () => {
  const m = await newUser("marketing");
  const { siteId } = await createFunnel(m, {
    name: "F",
    language: "en",
    basePath: base(),
  });
  const v = (await getSite(m, siteId))!.version;
  assert.deepEqual(
    await updateSiteSettings(m, siteId, { ...settings, capi: true }, v),
    { kind: "ok", version: v + 1 },
  );
  assert.deepEqual(await updateSiteSettings(m, siteId, settings, v), {
    kind: "conflict",
  });
  const [a] = await db()`
    SELECT before, after FROM audit_log WHERE entity = 'site' AND entity_id = ${siteId} AND action = 'update'`;
  assert.deepEqual(a.before, { settings: {} });
  assert.equal(a.after.settings.capi, true);
});

it("steps can be moved, cloned and deleted with positions kept contiguous", async () => {
  const m = await newUser("marketing");
  const { siteId } = await createFunnel(m, {
    name: "F",
    language: "en",
    basePath: base(),
  });
  let s = (await getSite(m, siteId))!;
  const [home, pay, thanks] = s.steps;
  let r = await moveStep(m, siteId, s.version, thanks.id, 1);
  assert.equal(r.kind, "ok");
  s = (await getSite(m, siteId))!;
  assert.deepEqual(
    s.steps.map((x) => x.id),
    [thanks.id, home.id, pay.id],
  );
  r = await cloneStep(m, siteId, s.version, home.id);
  s = (await getSite(m, siteId))!;
  assert.deepEqual(
    s.steps.map((x) => x.position),
    [1, 2, 3, 4],
  );
  assert.equal(s.steps[2].path, `${home.path}-copy`);
  assert.deepEqual(await deleteStep(m, siteId, 1, pay.id), {
    kind: "conflict",
  });
  await deleteStep(m, siteId, s.version, pay.id);
  assert.deepEqual(
    (await getSite(m, siteId))!.steps.map((x) => x.position),
    [1, 2, 3],
  );
});

it("force take-over moves the lock and is audited", async () => {
  const a = await newUser("marketing");
  const b = await newUser("marketing");
  const { siteId } = await createFunnel(a, {
    name: "F",
    language: "en",
    basePath: base(),
  });
  const page = (await getSite(a, siteId))!.steps[0];
  await takeEditLock(a, page.id);
  assert.equal((await takeEditLock(b, page.id, { force: true })).holder, null);
  assert.equal((await takeEditLock(a, page.id)).holder?.id, b.id);
  const [r] = await db()`
    SELECT before, after FROM audit_log WHERE entity = 'site_page' AND entity_id = ${page.id} AND user_id = ${b.id}`;
  assert.deepEqual(r.before, { lockHolderId: a.id });
  assert.deepEqual(r.after, { lockHolderId: b.id });
});

it("view-only role gets an audited permission refusal before validation", async () => {
  const m = await newUser("marketing");
  const s = await newUser("sales");
  const { siteId } = await createFunnel(m, {
    name: "F",
    language: "en",
    basePath: base(),
  });
  const site = (await getSite(m, siteId))!;
  await assert.rejects(
    addStep(s, siteId, site.version, { name: "", path: "BAD PATH" }),
    SitesPermissionError,
  );
  await assert.rejects(
    renameStep(s, siteId, site.version, site.steps[0].id, ""),
    SitesPermissionError,
  );
  const [{ n }] = await db()`
    SELECT count(*)::int AS n FROM audit_log WHERE user_id = ${s.id} AND action = 'permission_denied'`;
  assert.equal(n, 2);
});

it("a damaged template is refused with a clear error", async () => {
  const m = await newUser("marketing");
  const [t] = await db()`
    INSERT INTO sales.site_template (kind, name, payload)
    VALUES ('funnel', 'bad', ${db().json({ steps: [{ name: "X", kind: "page" }] } as never)}) RETURNING id`;
  await assert.rejects(
    createFunnel(m, {
      name: "F",
      language: "en",
      basePath: base(),
      templateId: t.id,
    }),
    /damaged/,
  );
});

it("saveTemplate suffixes respect path-segment boundaries", async () => {
  const m = await newUser("marketing");
  const b = base();
  const { siteId } = await createFunnel(m, {
    name: "F",
    language: "en",
    basePath: b,
  });
  const site = (await getSite(m, siteId))!;
  await addStep(m, siteId, site.version, { name: "Extra", path: `${b}/extra` });
  const { templateId } = await saveTemplate(m, siteId, "T");
  const [t] =
    await db()`SELECT payload FROM sales.site_template WHERE id = ${templateId}`;
  assert.deepEqual(
    t.payload.steps.map((x: { suffix: string }) => x.suffix),
    ["", "/payment", "/thank-you", "/extra"],
  );
  // /ab/x is outside base /a: refused rather than sliced into "b/x"
  const { siteId: s2 } = await createFunnel(m, {
    name: "G",
    language: "en",
    basePath: `${b}-a`,
  });
  const v2 = (await getSite(m, s2))!.version;
  await addStep(m, s2, v2, { name: "Other", path: `${b}-ab/x` });
  await assert.rejects(saveTemplate(m, s2, "T2"), /outside/);
});

it("operations cannot call the publish action", async () => {
  const m = await newUser("marketing");
  const o = await newUser("operations");
  const { siteId } = await createFunnel(m, {
    name: "F",
    language: "en",
    basePath: base(),
  });
  const page = (await getSite(m, siteId))!.steps[0];
  assert.deepEqual(await publishStep(o, page.id, page.version), {
    error: FORBIDDEN_MESSAGE,
  });
  const [{ n }] =
    await db()`SELECT count(*)::int AS n FROM sales.site_route WHERE page_id = ${page.id}`;
  assert.equal(n, 0);
});

it("settings action returns conflict on stale version and field errors from the schema", async () => {
  const m = await newUser("marketing");
  const { siteId } = await createFunnel(m, {
    name: "F",
    language: "en",
    basePath: base(),
  });
  const v = (await getSite(m, siteId))!.version;
  assert.deepEqual(await saveSettings(m, siteId, v, { capi: true }), {
    ok: "Settings saved.",
  });
  assert.deepEqual(await saveSettings(m, siteId, v, { capi: false }), {
    error: CONFLICT_MESSAGE,
  });
  const bad = await saveSettings(m, siteId, v + 1, {
    favicon: "http://x.co/a.png",
    chatWidget: { whatsapp: "abc" },
  });
  assert.deepEqual(Object.keys(bad.fields!).sort(), [
    "chatWidget.whatsapp",
    "favicon",
  ]);
  assert.equal((await getSite(m, siteId))!.settings.capi, true);
});

it("save-template error outside the base path reads as a message", async () => {
  const m = await newUser("marketing");
  const b = base();
  const { siteId } = await createFunnel(m, {
    name: "F",
    language: "en",
    basePath: b,
  });
  const v = (await getSite(m, siteId))!;
  await addStep(m, siteId, v.version, { name: "Odd", path: "/elsewhere" });
  const { act } = await import("../lib/sites/admin-actions.ts");
  const r = await act(() => saveTemplate(m, siteId, "T"));
  assert.match(r.error!, /outside the funnel's base path/);
});

it("setStepPath: changes a path, refuses duplicates and stale versions, keeps the live route until republished", async () => {
  const m = await newUser("marketing");
  const b = base();
  const { siteId } = await createFunnel(m, { name: "F", language: "en", basePath: b });
  let s = (await getSite(m, siteId))!;
  const [home, pay] = s.steps;
  assert.deepEqual(await setStepPath(m, siteId, s.version, pay.id, ` ${b}/Pay-Now/ `), { kind: "ok", version: s.version + 1 });
  s = (await getSite(m, siteId))!;
  assert.equal(s.steps[1].path, `${b}/pay-now`);
  await assert.rejects(setStepPath(m, siteId, s.version, pay.id, home.path), /already uses that path/);
  await assert.rejects(setStepPath(m, siteId, s.version, pay.id, "/Bad Path"), /Invalid path/);
  assert.deepEqual(await setStepPath(m, siteId, s.version - 1, pay.id, `${b}/other`), { kind: "conflict" });
  const [a] = await db()`SELECT before, after FROM audit_log WHERE entity = 'site_page' AND entity_id = ${pay.id} ORDER BY created_at DESC LIMIT 1`;
  assert.deepEqual([a.before, a.after], [{ path: `${b}/payment` }, { path: `${b}/pay-now` }]);
});

it("setStepPath: a view-only role is refused and audited", async () => {
  const m = await newUser("marketing");
  const o = await newUser("operations");
  const { siteId } = await createFunnel(m, { name: "F", language: "en", basePath: base() });
  const s = (await getSite(m, siteId))!;
  await assert.rejects(setStepPath(o, siteId, s.version, s.steps[0].id, "/x-y"), SitesPermissionError);
  const [{ n }] = await db()`SELECT count(*)::int AS n FROM audit_log WHERE user_id = ${o.id} AND action = 'permission_denied'`;
  assert.equal(n, 1);
  assert.equal((await getSite(m, siteId))!.steps[0].path, s.steps[0].path);
});

it("after a forced take-over the displaced editor's save is refused and the draft is untouched", async () => {
  const a = await newUser("marketing");
  const b = await newUser("marketing");
  const { siteId } = await createFunnel(a, { name: "F", language: "en", basePath: base() });
  const page = (await getSite(a, siteId))!.steps[0];
  assert.equal((await takeEditLock(a, page.id)).holder, null);
  const a1 = paraPage("a1");
  const first = await saveDraft(a, page.id, { project: a1 }, page.version);
  assert.equal(first.kind, "ok");
  const v = (first as { version: number }).version;
  assert.equal((await takeEditLock(b, page.id, { force: true })).holder, null);
  // a's next autosave, still on the old version: locked.
  const r = await saveDraft(a, page.id, { project: paraPage("a2") }, v);
  assert.equal(r.kind, "locked");
  assert.deepEqual(await getDraft(b, page.id).then((d) => d.project), a1);
  // the take-over bumped the version: even after the lock goes stale, a's old version conflicts.
  await db()`UPDATE sales.site_page SET edit_lock_at = now() - interval '3 minutes' WHERE id = ${page.id}`;
  assert.deepEqual(await saveDraft(a, page.id, { project: paraPage("a3") }, v), { kind: "conflict" });
  assert.deepEqual(await getDraft(b, page.id).then((d) => d.project), a1);
  // b, on the current version, saves fine.
  const cur = (await getDraft(b, page.id)).version;
  assert.equal(cur, v + 1);
  assert.equal((await saveDraft(b, page.id, { project: paraPage("b") }, cur)).kind, "ok");
});

it("the three starter templates create funnels with all their steps and html", async () => {
  const { TEMPLATES } = await import("../scripts/site-templates-data.ts");
  const m = await newUser("marketing");
  for (const t of TEMPLATES) {
    const name = `${t.name} ${crypto.randomUUID().slice(0, 6)}`;
    const [row] = await db()`
      INSERT INTO sales.site_template (kind, name, payload)
      VALUES ('funnel', ${name}, ${db().json({ steps: t.steps } as never)}) RETURNING id`;
    const { siteId } = await createFunnel(m, { name: "From template", language: "en", basePath: base(), templateId: row.id });
    const steps = (await getSite(m, siteId))!.steps;
    assert.equal(steps.length, t.steps.length, t.name);
    for (const [i, s] of steps.entries()) {
      assert.equal(s.name, t.steps[i].name);
      assert.equal(s.kind, t.steps[i].kind);
      const d = await getDraft(m, s.id);
      assert.equal(pageSchema.safeParse(d.project).success, true, `${t.name} / ${s.name}`);
    }
  }
});
