// lib/sites/admin: funnel creation, permissions, version conflicts, edit lock.
import { after } from "node:test";
import assert from "node:assert/strict";
import {
  cloneStep,
  createFunnel,
  deleteStep,
  getDraft,
  getSite,
  listSites,
  moveStep,
  saveDraft,
  SitesPermissionError,
  takeEditLock,
  updateSiteSettings,
} from "../lib/sites/admin.ts";
import { closeDb, db } from "../lib/sql.ts";
import { it, newUser } from "./seed.ts";

after(closeDb);

const base = () => `/t-${crypto.randomUUID().slice(0, 8)}`;
const settings = { pixels: {}, capi: false, paymentMode: "test" as const, seo: {} };

it("marketing creates a funnel with Home, Payment Form and Thank You steps", async () => {
  const m = await newUser("marketing");
  const b = base();
  const { siteId } = await createFunnel(m, { name: "F", language: "en", basePath: b });
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
  assert.equal((await listSites(m, "funnel")).find((r) => r.id === siteId)!.steps, 3);
});

it("sales cannot create a funnel and the refusal is audited", async () => {
  const s = await newUser("sales");
  await assert.rejects(createFunnel(s, { name: "F", language: "en", basePath: base() }), SitesPermissionError);
  const [{ n }] = await db()`
    SELECT count(*)::int AS n FROM audit_log WHERE user_id = ${s.id} AND action = 'permission_denied'`;
  assert.equal(n, 1);
});

it("a stale draft save is refused as conflict", async () => {
  const m = await newUser("marketing");
  const { siteId } = await createFunnel(m, { name: "F", language: "en", basePath: base() });
  const page = (await getSite(m, siteId))!.steps[0];
  assert.deepEqual(await saveDraft(m, page.id, { a: 1 }, page.version), { kind: "ok", version: page.version + 1 });
  assert.deepEqual(await saveDraft(m, page.id, { a: 2 }, page.version), { kind: "conflict" });
  assert.deepEqual((await getDraft(m, page.id)).project, { a: 1 });
});

it("a second editor sees the first editor as lock holder until 2 minutes pass", async () => {
  const a = await newUser("marketing");
  const b = await newUser("marketing");
  const { siteId } = await createFunnel(a, { name: "F", language: "en", basePath: base() });
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
  const { siteId } = await createFunnel(m, { name: "F", language: "en", basePath: base() });
  const v = (await getSite(m, siteId))!.version;
  assert.deepEqual(await updateSiteSettings(m, siteId, { ...settings, capi: true }, v), { kind: "ok", version: v + 1 });
  assert.deepEqual(await updateSiteSettings(m, siteId, settings, v), { kind: "conflict" });
  const [a] = await db()`
    SELECT before, after FROM audit_log WHERE entity = 'site' AND entity_id = ${siteId} AND action = 'update'`;
  assert.deepEqual(a.before, { settings: {} });
  assert.equal(a.after.settings.capi, true);
});

it("steps can be moved, cloned and deleted with positions kept contiguous", async () => {
  const m = await newUser("marketing");
  const { siteId } = await createFunnel(m, { name: "F", language: "en", basePath: base() });
  let s = (await getSite(m, siteId))!;
  const [home, pay, thanks] = s.steps;
  let r = await moveStep(m, siteId, s.version, thanks.id, 1);
  assert.equal(r.kind, "ok");
  s = (await getSite(m, siteId))!;
  assert.deepEqual(s.steps.map((x) => x.id), [thanks.id, home.id, pay.id]);
  r = await cloneStep(m, siteId, s.version, home.id);
  s = (await getSite(m, siteId))!;
  assert.deepEqual(s.steps.map((x) => x.position), [1, 2, 3, 4]);
  assert.equal(s.steps[2].path, `${home.path}-copy`);
  assert.deepEqual(await deleteStep(m, siteId, 1, pay.id), { kind: "conflict" });
  await deleteStep(m, siteId, s.version, pay.id);
  assert.deepEqual((await getSite(m, siteId))!.steps.map((x) => x.position), [1, 2, 3]);
});
