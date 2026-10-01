// Mail settings live in the existing settings table, one key each
// (mail.enabled, mail.account, notify.toast, ...). The API and the tools use
// short names (enabled, account, toast, ...).
import { z } from "zod";
import { getSetting, setSetting } from "./db.js";
import { getAccount, resolveAccount } from "./accounts.js";

export const KEYS = {
  enabled: ["mail.enabled", 1],
  auto_record: ["mail.auto_record", 1],
  account: ["mail.account", ""],
  interval_min: ["mail.interval_min", 15],
  first_days: ["mail.first_days", 62],
  window_days: ["mail.window_days", 14],
  min_confidence: ["mail.min_confidence", 70],
  review_above: ["mail.review_above", 500],
  toast: ["notify.toast", 1],
  hub: ["notify.hub", 1],
  quiet_history: ["notify.quiet_history", 1],
  faustus_dir: ["mail.faustus_dir", ""],
  faustus_owner: ["mail.faustus_owner", ""],
};
const FLAGS = new Set(["enabled", "auto_record", "toast", "hub", "quiet_history"]);

const flag = z.union([z.boolean(), z.number().int().min(0).max(1)]).transform((v) => (v === true || v === 1 ? 1 : 0));

export const settingsPatch = z.object({
  enabled: flag,
  auto_record: flag,
  account: z.string().trim().max(120),
  interval_min: z.number().int().min(2).max(1440),
  first_days: z.number().int().min(1).max(365),
  window_days: z.number().int().min(1).max(90),
  min_confidence: z.number().int().min(50).max(100),
  review_above: z.number().min(0).max(1_000_000),
  toast: flag,
  hub: flag,
  quiet_history: flag,
  faustus_dir: z.string().trim().max(500),
  faustus_owner: z.string().trim().max(120),
}).partial().strict();

/** Typed settings: flags as booleans. */
export function mailSettings() {
  const out = {};
  for (const [name, [key, fallback]] of Object.entries(KEYS)) {
    const value = getSetting(key, fallback);
    out[name] = FLAGS.has(name) ? Boolean(Number(value)) : value;
  }
  return out;
}

export function updateMailSettings(patch) {
  const data = settingsPatch.parse(patch || {});
  if (data.account) {
    const account = getAccount(data.account) || resolveAccount(data.account);
    if (!account) throw Object.assign(new Error("La cuenta para los cargos del correo no existe."), { status: 400 });
    if (account.archived) throw Object.assign(new Error("La cuenta para los cargos del correo está archivada."), { status: 400 });
    data.account = account.id;
  }
  for (const [name, value] of Object.entries(data)) setSetting(KEYS[name][0], value);
  return mailSettings();
}
