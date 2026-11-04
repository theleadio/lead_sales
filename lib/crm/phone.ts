// Copied from lead_crm lib/format/phone.ts (build plan ground rule 4, 4 Nov evening):
// lead_sales writes CRM data directly, so it follows the CRM's own rules.
// Keep in step with the CRM copy.
import { parsePhoneNumberFromString } from "libphonenumber-js";

// Spec §4: store both the typed value and phone_e164. Default region MY.
// Unnormalisable input returns null — caller stores it in `phone` with
// `phone_e164` null and flags the record for review; never drop it.
export function normalizePhoneE164(raw: string): string | null {
  const parsed = parsePhoneNumberFromString(raw, { defaultCountry: "MY" });
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}
