// OFX / QFX bank statements (SGML 1.x and XML 2.x): every <STMTTRN> becomes a row with date, signed amount, payee,
// memo and the bank's transaction id. The import turns the rows into the same table a CSV gives, so duplicates, the
// match with payments already recorded and the result are the same for both formats.

/** True when the text is an OFX/QFX statement rather than a CSV. */
export function looksLikeOfx(text) {
  const head = String(text || "").slice(0, 4000).toUpperCase();
  return head.includes("OFXHEADER") || head.includes("<OFX>") || /<STMTTRN>/.test(head) || (head.includes("<?OFX") && head.includes("<OFX"));
}

const tag = (block, name) => {
  const m = new RegExp(`<${name}>([^<\\r\\n]*)`, "i").exec(block);
  return m ? decode(m[1].trim()) : "";
};
const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** "20261003", "20261003120000[-5:EST]" → "2026-10-03"; null when it is not a date. */
export function ofxDate(value) {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(String(value || "").trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(+y, +mo - 1, +d));
  return date.getUTCMonth() === +mo - 1 && date.getUTCDate() === +d ? `${y}-${mo}-${d}` : null;
}

/** Amount text with a dot as decimal separator ("-42.10"); OFX allows a comma too. */
function ofxAmount(value) {
  const v = String(value || "").trim().replace(/\s/g, "");
  if (!v) return "";
  return v.includes(",") && !v.includes(".") ? v.replace(",", ".") : v.replace(/,/g, "");
}

/**
 * Parse a statement: { currency, account, transactions: [{ date, amount, payee, memo, fitid, type }] }.
 * Amounts stay as text with a dot decimal, signed as the bank sends them (negative = money out).
 */
export function parseOfx(text) {
  const body = String(text || "");
  const currency = tag(body, "CURDEF").toUpperCase() || null;
  const account = tag(body, "ACCTID") || null;
  const transactions = [];
  const parts = body.split(/<STMTTRN>/i).slice(1);
  for (const part of parts) {
    const block = part.split(/<\/STMTTRN>/i)[0];
    transactions.push({
      date: ofxDate(tag(block, "DTPOSTED") || tag(block, "DTUSER")),
      amount: ofxAmount(tag(block, "TRNAMT")),
      payee: tag(block, "NAME") || tag(block, "PAYEE"),
      memo: tag(block, "MEMO"),
      fitid: tag(block, "FITID"),
      type: tag(block, "TRNTYPE"),
    });
  }
  return { currency, account, transactions };
}

export const OFX_COLUMNS = ["Fecha", "Importe", "Concepto", "Contraparte", "Id del banco"];
export const OFX_MAPPING = { date: "Fecha", amount: "Importe", description: "Concepto", counterparty: "Contraparte", decimal: "." };

/** The statement as the table a CSV would give (see csv.js tabulate). */
export function ofxTable(text) {
  const { currency, account, transactions } = parseOfx(text);
  const data = transactions.map((t) => [t.date || "", t.amount, t.memo || t.payee, t.payee || t.memo, t.fitid]);
  return { delimiter: "ofx", hasHeader: true, columns: OFX_COLUMNS, data, format: "ofx", currency, account };
}
