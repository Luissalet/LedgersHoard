// CSV import: preview (mapping guess + duplicates) and commit (dedupe by hash).
import crypto from "node:crypto";
import { z } from "zod";
import { db, uid, now, transaction } from "./db.js";
import { tabulate, guessMapping, mapRows } from "./csv.js";
import { createEntry, getEntry, hasImportHash } from "./entries.js";
import { getAccount } from "./accounts.js";
import { resolveCategory } from "./categories.js";
import { findMatchingEntry } from "./mail-match.js";

export const mappingSchema = z.object({
  date: z.string().optional(),
  amount: z.string().optional(),
  debit: z.string().optional(),
  credit: z.string().optional(),
  description: z.string().optional(),
  counterparty: z.string().optional(),
  decimal: z.enum([",", "."]).optional(),
  invert: z.boolean().optional(),
  delimiter: z.string().max(1).optional(),
  hasHeader: z.boolean().optional(),
}).partial();

export const importInput = z.object({
  csv: z.string().min(1).max(5_000_000),
  mapping: mappingSchema.optional(),
  account_id: z.string().optional(),
  filename: z.string().max(200).default(""),
  category_id: z.string().nullable().optional(),
});

export function importHash(date, amount_cents, description, account_id) {
  return crypto.createHash("sha1").update(`${date}|${amount_cents}|${description}|${account_id}`).digest("hex");
}

/** Parse the CSV, merge the guessed mapping with the user's and evaluate rows. */
function analyse({ csv, mapping = {}, account_id = "" }) {
  const table = tabulate(csv, { delimiter: mapping.delimiter, hasHeader: mapping.hasHeader });
  const guessed = guessMapping(table.columns, table.data);
  const merged = { ...guessed };
  for (const [k, v] of Object.entries(mapping)) if (v !== undefined && v !== "") merged[k] = v;
  if (mapping.amount) { delete merged.debit; delete merged.credit; }
  if (mapping.debit || mapping.credit) delete merged.amount;
  merged.delimiter = table.delimiter;
  merged.hasHeader = table.hasHeader;
  const rows = mapRows(table.columns, table.data, merged);
  const seenInFile = new Set();
  const adopted = new Set();
  for (const r of rows) {
    if (r.error) continue;
    r.hash = importHash(r.date, r.amount_cents, r.description, account_id);
    r.duplicate = hasImportHash(r.hash) || seenInFile.has(r.hash);
    seenInFile.add(r.hash);
    if (r.duplicate) continue;
    // A payment already recorded from mail: the bank row is the same payment, not a second one.
    const match = [r.counterparty, r.description].filter(Boolean)
      .map((merchant) => findMatchingEntry({ amount_cents: r.amount_cents, date: r.date, merchant, account_id, mailOnly: true, exclude: [...adopted] }))
      .find(Boolean);
    if (match) { r.mail_entry_id = match.id; adopted.add(match.id); }
  }
  return { table, mapping: merged, rows };
}

export function previewImport(input) {
  const data = importInput.parse(input);
  const { table, mapping, rows } = analyse(data);
  const valid = rows.filter((r) => !r.error);
  const matched = valid.filter((r) => !r.duplicate && r.mail_entry_id);
  return {
    delimiter: table.delimiter,
    hasHeader: table.hasHeader,
    columns: table.columns,
    mapping,
    rows_total: rows.length,
    rows_valid: valid.length,
    rows_invalid: rows.length - valid.length,
    rows_duplicate: valid.filter((r) => r.duplicate).length,
    rows_matched_mail: matched.length,
    rows_new: valid.filter((r) => !r.duplicate && !r.mail_entry_id).length,
    sample: rows.slice(0, 20).map(({ hash, ...r }) => ({ ...r, duplicate: !!r.duplicate, matched_mail: !!r.mail_entry_id })),
    raw_sample: table.data.slice(0, 5),
  };
}

export function commitImport(input) {
  const data = importInput.parse(input);
  if (!data.account_id || !getAccount(data.account_id)) throw Object.assign(new Error("Indica una cuenta existente para importar."), { status: 400 });
  const { mapping, rows } = analyse(data);
  let category_id = data.category_id || null;
  if (category_id && !resolveCategory(category_id).category) category_id = null;
  return transaction(() => {
    let added = 0, skipped = 0, invalid = 0;
    const entries = [];
    const matchedEntries = [];
    for (const r of rows) {
      if (r.error) { invalid++; continue; }
      if (r.duplicate) { skipped++; continue; }
      if (r.mail_entry_id) { matchedEntries.push(adoptBankRow(r, data.account_id, category_id)); continue; }
      entries.push(createEntry({
        date: r.date, amount_cents: r.amount_cents, account_id: data.account_id, category_id,
        counterparty: r.counterparty.slice(0, 200), note: r.note.slice(0, 2000), source: "import", import_hash: r.hash,
      }));
      added++;
    }
    const id = uid();
    db().prepare(
      "INSERT INTO imports (id, created_at, filename, rows_total, rows_added, rows_skipped, mapping) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(id, now(), data.filename, rows.length, added, skipped + invalid, JSON.stringify(mapping));
    return {
      id, rows_total: rows.length, rows_added: added, rows_skipped: skipped, rows_invalid: invalid, matched_mail: matchedEntries.length, mapping,
      entries: entries.slice(0, 50), matched_entries: matchedEntries.slice(0, 50),
    };
  });
}

/**
 * Bank row for a payment that mail already recorded: keep ONE entry. The
 * bank's date, amount and account win; the entry keeps the merchant, the
 * category and the mail reference, and takes the row's hash so importing the
 * same file again skips it.
 */
function adoptBankRow(r, account_id, category_id) {
  const entry = getEntry(r.mail_entry_id);
  const bank = `banco: ${r.description || r.counterparty}`.slice(0, 200);
  const note = `${entry.note} · ${bank}`.slice(0, 2000);
  db().prepare(
    "UPDATE entries SET date = ?, amount_cents = ?, account_id = ?, category_id = COALESCE(category_id, ?), note = ?, source = 'import', import_hash = ?, updated_at = ? WHERE id = ?",
  ).run(r.date, r.amount_cents, account_id, category_id, note, r.hash, now(), entry.id);
  const mailId = String(entry.source_ref || "").replace(/^mail:/, "");
  const mail = db().prepare("SELECT facts FROM mail_messages WHERE message_id = ?").get(mailId);
  if (mail) {
    const facts = { ...JSON.parse(mail.facts || "{}"), matched_bank: true, bank_description: bank };
    db().prepare("UPDATE mail_messages SET facts = ? WHERE message_id = ?").run(JSON.stringify(facts), mailId);
  }
  return getEntry(entry.id);
}

export function listImports() {
  return db().prepare("SELECT * FROM imports ORDER BY created_at DESC LIMIT 50").all()
    .map((r) => ({ ...r, mapping: JSON.parse(r.mapping || "{}") }));
}
