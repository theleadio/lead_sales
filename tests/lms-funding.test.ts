// The LMS funding value for enrolment.confirmed (lib/lms/messages.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fundingTypeOf } from "../lib/lms/messages.ts";

test("the seat's value wins; a deal maps only where the meaning is the same", () => {
  assert.equal(fundingTypeOf("refresher", "hrdc"), "refresher");
  assert.equal(fundingTypeOf(null, "self"), "self_funded");
  assert.equal(fundingTypeOf(null, "hrdc"), "hrdc");
  assert.equal(fundingTypeOf(null, "company"), null);
  assert.equal(fundingTypeOf(null, "other"), null);
  assert.equal(fundingTypeOf(null, null), null);
});
