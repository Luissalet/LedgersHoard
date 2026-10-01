// Reads one payment-related mail (Spanish or English) into facts. Pure
// functions: no database, no network. The text is untrusted data: it is
// only ever matched against patterns, never interpreted.
//
// kinds
//   charge   a payment that happened (receipt, "has pagado", card notice, bill with "importe a cargar")
//   refund   money coming back (positive amount when recorded)
//   upcoming renewal or trial notice, price change: feeds a subscription, no entry
//   cancel   a subscription was cancelled: alert only
//   failed   a payment was declined: alert only
//   noise    everything else (offers, newsletters, shipping updates without a charge, own mail)
import { parseAmount } from "../shared/money.js";
import { fold, knownMerchant, BANK_RE, SHOP_CATS } from "./mail-merchants.js";
import { merchantKey } from "./mail-match.js";
import { addDays, daysBetween, localDate, parseDate } from "./dates.js";

export const KINDS = ["charge", "refund", "upcoming", "cancel", "failed", "noise"];

// ---------------------------------------------------------------- text helpers
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u00ad\u034f\u200b-\u200f\u202a-\u202e\u2028\u2029\u2060\u2066-\u2069\ufeff]/g;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", zwnj: "", zwj: "", shy: "", ndash: "-", mdash: "-", euro: "€", hellip: "..." };
const looksHtml = (text) => /<(html|body|table|div|p|br|span|head|!doctype)\b/i.test(text);

/** Entities decoded (&#8204;, &nbsp;, &euro;...) and, when the text is raw HTML, tags and style/script blocks removed. */
export function decodeText(raw) {
  let text = String(raw ?? "");
  if (looksHtml(text)) {
    text = text
      .replace(/<(style|script|head)\b[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d|table)\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " ");
  }
  return text
    .replace(/&#(\d{1,6});/g, (_, n) => (Number(n) < 0x110000 ? String.fromCodePoint(Number(n)) : " "))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, n) => (parseInt(n, 16) < 0x110000 ? String.fromCodePoint(parseInt(n, 16)) : " "))
    .replace(/&([a-z]{2,8});/gi, (all, name) => (name.toLowerCase() in ENTITIES ? ENTITIES[name.toLowerCase()] : all));
}

/** Normalised text: no control characters, thousands separators made plain, blank noise collapsed. */
export function normText(text) {
  return decodeText(text)
    .replace(/\r/g, "")
    .replace(CTRL, "")
    .replace(/(\d)[\u00a0\u202f\u2009](?=\d{3}(?!\d))/g, "$1")
    .replace(/[\u00a0\u202f\u2009]/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function oneLine(text, max = 300) {
  const flat = String(text ?? "").replace(CTRL, " ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

// ---------------------------------------------------------------- amounts
const CUR = "€|eur(?:os?)?|usd|us\\$|\\$|£|gbp";
const NUM = "\\d{1,3}(?:[.,]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?";
const MONEY = new RegExp(
  `(?<![\\d.,])(?:(?<![a-z])(${CUR})\\s*(${NUM})|(${NUM})\\s*(${CUR})(?![a-z]))`,
  "gi",
);
const MAX_CENTS = 50_000_000;

const currencyOf = (raw) => {
  const c = raw.toLowerCase();
  if (c.includes("€") || c.startsWith("eur")) return "EUR";
  if (c.includes("£") || c === "gbp") return "GBP";
  return "USD";
};

/** Every money amount of a (folded) line: [{ cents, currency, index, end }]. */
export function findMoney(line) {
  const out = [];
  for (const m of line.matchAll(MONEY)) {
    const number = m[2] ?? m[3];
    const currency = currencyOf(m[1] ?? m[4]);
    const cents = parseAmount(number);
    if (cents === null || cents <= 0 || cents > MAX_CENTS) continue;
    out.push({ cents, currency, index: m.index, end: m.index + m[0].length });
  }
  return out;
}

const EXCLUDE_LABEL = /(subtotal|sub-total|\biva\b|i\.v\.a|\bvat\b|\btax\b|impuesto|\bigic\b|base imponible|gastos? de envio|\benvio\b|shipping|handling|descuento|discount|cupon|coupon|ahorro|ahorras|saving|propina|\btip\b|saldo|balance|limite|limit\b|puntos|points|cashback)/;
const TOTAL1 = /(importe total|total (a pagar|pagado|cobrado|facturado|abonado|del pedido|de (la )?(compra|factura|recibo|operacion|suscripcion)|factura|con iva|iva incl\w*)|amount (paid|charged|due)|total (charged|paid|due|amount)|order total|grand total|importe (cargado|pagado|a cargar|a pagar|de la factura|facturado|del recibo|de la compra|a debitar|a domiciliar)|has pagado|you paid|pago total|monto total|total a cargar|cobrado|charged)/;
const TOTAL2 = /(^|[^a-z])total\b/;
const LABEL3 = /(importe|amount|cargo|pago|payment|precio|price|cuota|mensualidad|renovacion|renewal)\b/;
const VERB_BEFORE = /(has pagado|reembolso (de|por)|refund (of|for)|reembolsado|refunded|hemos cobrado|te hemos cobrado|se ha(n)? (cargado|cobrado)|cargo de|cobro de|pago (de|por)|payment of|you paid|you were charged|we charged|charged you|has enviado un pago de|you sent a payment of|purchase of|compra (de|por)|por importe de|importe de|abonado|pagado)\s*:?\s*$/;
const PROMO = /(%\s*(de\s*)?(dto|descuento|off|dcto)|\d+\s*%\s*(dto|descuento|off|dcto|de descuento)|\boferta|\bofertas\b|rebajas|black friday|cyber monday|newsletter|novedades|promocion|\bpromo\b|cupon|codigo (de )?descuento|\bsale\b|save up to|limited time|ahorra hasta|solo hoy|ultimas unidades|descubre|lo mas vendido|best sellers?|\bregalo\b|\bgift\b|\bsorteo|\bpremio\b|envio gratis|free shipping|acepta(lo)? antes de que caduque)/;

/** Text that labels the value at `before` on line i: when the line has no words of its own, the nearest previous non-blank line. */
function labelOf(lines, i, before, take = 70) {
  if (/[a-z]{3}/.test(before) || i === 0) return before.slice(-take);
  for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
    if (lines[j].trim()) return `${lines[j].slice(-60)} ${before}`.slice(-take);
  }
  return before.slice(-take);
}

/**
 * Pick the amount that is the payment. Returns
 * { cents, currency, source, conflict, tier } or null.
 */
export function pickAmount(subjectFolded, bodyFolded, { upcomingFrom = -1, bodyLines = null } = {}) {
  const lines = bodyLines || bodyFolded.split("\n");
  const candidates = [];
  const add = (money, tier, source, order) => candidates.push({ ...money, tier, source, order });
  let order = 0;
  for (const m of findMoney(subjectFolded)) {
    const before = subjectFolded.slice(Math.max(0, m.index - 45), m.index);
    const promo = PROMO.test(subjectFolded);
    if (promo) continue;
    add(m, VERB_BEFORE.test(before) ? 2 : 1, "subject", order++);
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const found = findMoney(line);
    if (!found.length) continue;
    for (const m of found) {
      const before = labelOf(lines, i, line.slice(0, m.index), 400);
      const label = before.slice(-70);
      if (EXCLUDE_LABEL.test(label)) continue;
      const after = line.slice(m.end, m.end + 25);
      if (/^\s*(\/|por|al|a la|per)\s*(mes|ano|year|month|semana|week)\b/.test(after) && !TOTAL1.test(label) && !TOTAL2.test(label)) {
        // "9,99 € / mes" is a price tag; keep it as a weak candidate
        add(m, 1, "label", order++);
        continue;
      }
      if (VERB_BEFORE.test(before.slice(-45))) add(m, 2, "verb", order++);
      else if (TOTAL1.test(label)) add(m, 3, "total", order++);
      else if (TOTAL2.test(label)) add(m, 2, "total", order++);
      else if (found.length === 1 && /(importe|amount)\s*:?\s*$/.test(label.trim())) add(m, 2, "label", order++);
      else if (LABEL3.test(label)) add(m, 1, "label", order++);
      else add(m, 0, "single", order++);
    }
  }
  if (!candidates.length) return null;
  const best = Math.max(...candidates.map((c) => c.tier));
  const top = candidates.filter((c) => c.tier === best);
  const distinct = [...new Set(top.map((c) => `${c.cents}|${c.currency}`))];
  if (best >= 1) {
    const pick = best === 3 ? top[0] : top[top.length - 1];
    return { cents: pick.cents, currency: pick.currency, source: pick.source, tier: best, conflict: distinct.length > 1 };
  }
  // only unlabelled amounts
  if (distinct.length === 1) return { cents: top[0].cents, currency: top[0].currency, source: "single", tier: 0, conflict: false };
  if (upcomingFrom >= 0) return null;
  return null;
}

// ---------------------------------------------------------------- dates
const MONTHS = {
  enero: 1, ene: 1, january: 1, jan: 1, febrero: 2, feb: 2, february: 2, marzo: 3, mar: 3, march: 3, abril: 4, abr: 4, april: 4, apr: 4,
  mayo: 5, may: 5, junio: 6, jun: 6, june: 6, julio: 7, jul: 7, july: 7, agosto: 8, ago: 8, august: 8, aug: 8,
  septiembre: 9, setiembre: 9, sept: 9, sep: 9, september: 9, octubre: 10, oct: 10, october: 10,
  noviembre: 11, nov: 11, november: 11, diciembre: 12, dic: 12, december: 12, dec: 12,
};
const MONTH_RE = "(?:septiembre|setiembre|september|noviembre|november|diciembre|december|febrero|february|octubre|october|january|enero|febrero|marzo|march|abril|april|mayo|junio|june|julio|july|agosto|august|sept|sep|ene|jan|feb|mar|abr|apr|may|jun|jul|ago|aug|oct|nov|dic|dec)";
const iso = (y, m, d) => parseDate(`${y}-${m}-${d}`);

function resolveYear(day, month, mailDate, prefer) {
  const base = Number(mailDate.slice(0, 4));
  const options = [base - 1, base, base + 1].map((y) => iso(y, month, day)).filter(Boolean);
  if (!options.length) return null;
  const score = (d) => {
    const diff = daysBetween(mailDate, d);
    return prefer === "future" ? (diff >= -10 ? diff : 10_000 - diff) : (diff <= 45 ? -diff : 10_000 + diff);
  };
  return options.sort((a, b) => score(a) - score(b))[0];
}

/** Dates of a folded line: [{ date, index }] with the year inferred from the mail date when missing. */
export function findDates(line, mailDate, prefer = "past") {
  const out = [];
  const push = (date, index) => { if (date) out.push({ date, index }); };
  for (const m of line.matchAll(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g)) push(iso(m[1], m[2], m[3]), m.index);
  for (const m of line.matchAll(/(?<![\d/.-])(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?![\d/])/g)) {
    let a = Number(m[1]);
    let b = Number(m[2]);
    if (b > 12 && a <= 12) [a, b] = [b, a];
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    push(iso(year, b, a), m.index);
  }
  for (const m of line.matchAll(new RegExp(`(?<!\\d)(\\d{1,2})(?:st|nd|rd|th|o)?\\s+(?:de\\s+)?(${MONTH_RE})\\b\\.?(?:,?\\s*(?:de(?:l)?\\s+)?(\\d{4}))?`, "g"))) {
    const month = MONTHS[m[2]];
    push(m[3] ? iso(m[3], month, m[1]) : resolveYear(Number(m[1]), month, mailDate, prefer), m.index);
  }
  for (const m of line.matchAll(new RegExp(`\\b(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s*(\\d{4}))?`, "g"))) {
    const month = MONTHS[m[1]];
    push(m[3] ? iso(m[3], month, m[2]) : resolveYear(Number(m[2]), month, mailDate, prefer), m.index);
  }
  for (const m of line.matchAll(/(?<![\d/.-])(\d{1,2})\/(\d{1,2})(?![\d/])/g)) {
    if (out.some((d) => Math.abs(d.index - m.index) < 6)) continue;
    push(resolveYear(Number(m[1]), Number(m[2]), mailDate, prefer), m.index);
  }
  const seen = new Set();
  return out.filter((d) => (seen.has(`${d.date}|${d.index}`) ? false : seen.add(`${d.date}|${d.index}`))).sort((a, b) => a.index - b.index);
}

const CHARGE_DATE_LABEL = /(fecha( de(l)?)?\s*(cobro|pago|cargo|compra|pedido|operacion|transaccion|factura|emision|facturacion|adeudo|recibo|domiciliacion|valor)?|date( of (purchase|payment|charge|order|transaction))?|billed on|paid on|charged on|purchased on|order date|invoice date|payment date|importe a cargar|a cargar|se (cargara|cobrara|adeudara|domiciliara)|cargo previsto|cargado el|cobrado el|pagado el|fecha de cargo|cargo el|compra del|(^|[^a-z])pedido\s*:?\s*$|(^|[^a-z])order\s*:?\s*$)/;
const WEAK_CHARGE_LABEL = /( el dia| el )/;
// "llega el 15 sept", "entrega prevista: ...": a delivery date is not the charge date
const DELIVERY_BEFORE = /(llega|llegara|entrega|entregad|delivery|deliver|arriv|prevista?|estimad)\S*\s*(el|:)?\s*(dia|el)?\s*$/;
const NEXT_DATE_LABEL = /(a partir del?|starting (on|from)|effective|proximo (cobro|pago|cargo|recibo|renovacion)|siguiente (cobro|pago|cargo|recibo)|next (billing|payment|charge|renewal)( date)?|renewal date|fecha de renovacion|se renovara|renews?\b|will renew|renovara automaticamente|renovacion (el|automatica)|se renueva|se cobrara|will be charged|cobraremos|vence el|expires on|fecha de vencimiento)/;
const TRIAL_LABEL = /(prueba[^.\n]{0,50}(termina|finaliza|acaba|vence|expira)|trial[^.\n]{0,50}(ends?|expires?|will end|finishes)|free trial|periodo de prueba|prueba gratuita|hasta el)/;

function labelledDate(lines, mailDate, labelRe, prefer, { skip = null, reject = null } = {}) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const d of findDates(line, mailDate, prefer)) {
      if (skip && skip(d.date)) continue;
      const before = labelOf(lines, i, line.slice(Math.max(0, d.index - 70), d.index), 140);
      if (reject && reject.test(before.slice(-40))) continue;
      if (labelRe.test(before)) return d.date;
    }
  }
  return null;
}

// ---------------------------------------------------------------- patterns
const FAILED = /(pago (ha sido )?(rechazad|fallid|denegad)|(tu )?pago no (se )?(ha )?(pudo|podido)|no (se )?ha podido (procesar|cobrar|completar|realizar)|no hemos podido (procesar|cobrar|completar)|payment (has )?(failed|declined|was declined|unsuccessful)|(was|has been) declined|(unable|couldn.?t|could not|were unable) to (process|charge|complete)|problema con tu (pago|metodo de pago|tarjeta)|there.?s a problem with your (payment|card)|tarjeta (rechazada|declinada|caducada)|card (was )?(declined|expired)|fallo (en|del) (el )?pago|actualiza tu (metodo|forma) de pago|update your payment (method|details)|cobro (fallido|rechazado)|no se ha autorizado el pago|pago no autorizado|no ha sido procesado con exito|payment (was )?not authori[sz]ed)/;
const CANCEL = /((suscripcion|membresia|subscription|membership|plan)\b[^.\n]{0,40}\b(ha sido )?(cancelad[oa]|anulad[oa]|dad[oa] de baja|canceled|cancelled)|has cancelado|you(.ve| have) (canceled|cancelled)|cancelacion de (tu )?(suscripcion|membresia)|(cancellation|cancelation) (of|confirmation)|tu baja (ha|se)|hemos cancelado)/;
const ORDER_CANCEL = /(\b(pedido|order)\b[^.\n]{0,60}\b(ha sido |has been |was )?(cancelad[oa]|anulad[oa]|canceled|cancelled)|has cancelado (correctamente )?(el|tu) pedido|you(.ve| have) (canceled|cancelled) (your|the) order)/;
const REPLY_SUBJ = /^\s*(\[[^\]]{1,40}\]\s*)*(re|rv|aw|sv)\s*:/i;
const OPINION_SUBJ = /(que tal (tu|el|la|los|las|esta)\b|da tu opinion|cumple tus expectativas|valora(r)? (tu|el|la|este|esta|nuestro)\b|valoranos|cuentanos que te ha parecido|opina sobre|deja (tu )?(una )?(opinion|resena)|rate your|how was your|how did we do|leave (us )?a review|tell us what you think|share your (feedback|experience)|encuesta de satisfaccion|customer survey)/;
const MARKETING_LOCAL = /^(newsletters?|news|marketing|promos?|promociones?|ofertas?|info-?promo|deals|offers|mailing|novedades|campanas?|comunicaciones)([-_.+0-9]|$)/;
const MARKETING_HOST = /^(deals|promo|promos|offers|ofertas|news|newsletter|newsletters|marketing|mailing|campaigns?)$/;
const SUPPORT_SENDER = /(customer (support|service|care)|servicio de atencion al cliente|\bsoporte\b|help ?desk|support team)/;
const SUPPORT_LOCAL = /^(support|soporte|help|ayuda|helpdesk|cs|atencion|atencioncliente|customer-?(support|service|care))([-_.+0-9]|$)/;
const SUPPORT_HOST = /(zendesk|freshdesk|helpscout|intercom|freshservice)/;
const CARRIER = /(inpost|\bcorreos\b|\bseur\b|\bmrw\b|\bgls\b|\bups\b|fedex|\bdhl\b|\bctt\b|nacex|zeleris|packlink|mondial relay|redyser)/;
const REFUND_SUBJ = /(reembolso|refund|devolucion de (tu )?(pago|importe|dinero|pedido)|hemos devuelto|devolucion del)/;
const REFUND_BODY = /(hemos (procesado|emitido|realizado|iniciado|tramitado) (un|el|tu) reembolso|tu reembolso|your refund|we(.ve| have) (processed|issued|sent|initiated) (a|your) refund|refund (of|has been|was|will be)|se ha reembolsado|reembolso de|devolucion del importe|importe reembolsado|has been refunded|hemos reembolsado|te hemos devuelto|we(.ve| have) refunded)/;
const PAST_VERB = /(has pagado|hemos (recibido|cobrado|procesado) (tu|el) pago|te hemos cobrado|hemos cobrado|pago (realizado|recibido|completado|confirmado|procesado|efectuado|correcto|aceptado)|se ha(n)? (cargado|cobrado)|(compra|cargo|pago|operacion|movimiento) (con|en) (tu )?tarjeta|aviso de (compra|cargo|pago|movimiento)|compra realizada|gracias por tu (compra|pedido|pago|suscripcion)|(your |tu )?(payment|pago|order|pedido|purchase|compra) (was |has been |ha sido )?(received|confirmed|successful|processed|complete|recibido|confirmado|realizado)|you(.ve| have) (paid|sent a payment|been charged)|has enviado un pago|you were charged|we (have )?charged|thank you for your (purchase|payment|order|subscription)|cobro realizado|has sido cobrado|payment confirmation|order confirmation|confirmacion de (pedido|pago|compra))/;
const DOC_WORD = /(\brecibo\b|\bfactura\b|\binvoice\b|\breceipt\b|\btu pedido\b|\byour order\b|total del pedido|\bsu pedido\b|importe a cargar|tu compra\b|your purchase)/;
const UPCOMING = /((se )?renovara|se cobrara|se cargara|te cobraremos|cobraremos|se te cobrara|se te cargara|proximo (cobro|pago|cargo|recibo)|siguiente (cobro|pago|cargo)|(will|going to) (renew|be charged|be billed|auto-?renew)|(renews|renewing|renewal) (on|in)|will (automatically )?renew|aviso de renovacion|renewal (notice|reminder)|recordatorio de (pago|renovacion|cobro)|upcoming (charge|payment|renewal)|your (subscription|membership|plan) (will|renews)|(tu |su )?(suscripcion|membresia) se (renueva|renovara)|prueba (gratuita|gratis|de \d+ dias)|periodo de prueba|free trial|trial (ends|expires|ending|period)|(termina|finaliza|acaba) tu (prueba|periodo)|subimos el precio|cambio (en|de) (el )?precio|cambios en (el )?precio|(price|pricing) (change|increase|update)|nuevo precio|new price|actualizacion de precio|subida de precio)/;
const UPCOMING_SUBJ = UPCOMING;
const PRICE_CHANGE = /(?:pasara|subira|sube|aumenta|aumentara|cambiara|incrementara|increase|increasing|will (?:change|increase|go up|be)|going (?:up|from))[^.\n]{0,90}?\bde\b\s*([^.\n]{0,12}\d[\d.,]*\s*(?:€|eur|usd|\$|£)?)\s*(?:a|to)\s*([^.\n]{0,12}\d[\d.,]*\s*(?:€|eur|usd|\$|£)?)|(?:from)\s+([^.\n]{0,4}\d[\d.,]*\s*(?:€|eur|usd|\$|£)?)\s+to\s+([^.\n]{0,4}\d[\d.,]*\s*(?:€|eur|usd|\$|£)?)/;
const SHIPPING_SUBJ = /(enviado|ha salido|en camino|shipped|has shipped|out for delivery|entregado|delivered|reparto|tracking|seguimiento|dispatched|on its way|ready for pickup|recogida|recoger tu paquete|tu paquete|punto pack|locker)/;
// A newsletter footer with nothing that looks like a receipt in the subject means a bulletin, whatever amounts its
// stories quote («why you won't get a tariff refund», «compra ya por 100 $»).
const BULLETIN_FOOTER = /(unsubscribe|darte de baja|darse de baja|dejar de recibir|cancelar (la |tu )?suscripcion a (este|nuestro|nuestros) (boletin|correo|newsletter)|ver (este correo|en (el|tu) navegador)|view (this email )?in (your )?browser|you('| a)re receiving this|recibes este (correo|email))/;
const PROMO_VERB_SUBJ = /^(consigue|descubre|aprovecha|recibe manana|compra ya|disfruta|prueba gratis|hazte con|no te pierdas|ultim[ao]s? (horas|dias|unidades))\b|: compra (ya|inteligente)\b/;
const CONFIRM_SUBJ = /(confirmacion|confirmation|confirmado|confirmed|recibo|factura|receipt|invoice|pago|payment|compra realizada)/;
const SUB_WORDS = /(suscripcion|subscription|renovacion|renewal|membresia|membership|mensualidad|cuota (mensual|anual)|plan (premium|mensual|anual|familiar|individual|estandar|basico)|auto-?renew|renovara automaticamente|renovacion automatica|prueba gratuita|free trial)/;
// footer links that mention subscriptions without the mail being about one
const SUB_FOOTER = /(cancelar (la |tu |esta )?suscripcion|darse de baja|date de baja|gestiona(r)? (tus|las) suscripciones|manage (your )?subscriptions?|unsubscribe|cancel (your |the )?subscription|actualiza(r)? tus preferencias|update (your )?(email )?preferences|baja de la suscripcion|suscribete|subscribe (now|to))/g;
// shops and food only count as a subscription with explicit membership wording near the top of the mail
const PRIME_RE = /(amazon prime|membresia prime|suscripcion (de )?prime|prime (membership|subscription|video)|cuota (anual |mensual )?de prime)/;
const TRIAL_REL = /(prueba|trial)[^.\n]{0,40}?(termina|finaliza|acaba|ends?|expires?)[^.\n]{0,20}?(?:en|in)\s+(\d{1,2})\s+(dias?|days?)/;
const TRIAL_ANY = /(prueba (gratuita|gratis|de \d+ dias)|periodo de prueba|free trial|trial (ends|expires|ending|period))/;
const CARD_NOTICE_SUBJ = /(aviso|alerta|notificacion) de (compra|cargo|pago|movimiento)|compra con (tu )?tarjeta|cargo en tu tarjeta|card (purchase|transaction|payment) (alert|notification)|movimiento en tu tarjeta|transaction alert/;

const PERIODS = [
  ["weekly", /(semanal\w*|por semana|a la semana|weekly|per week|\/ ?week\b|every week|cada semana)/],
  ["monthly", /(mensual\w*|al mes|\/ ?mes\b|por mes|cada mes|monthly|per month|\/ ?mo\b|\/ ?month\b|a month|every month|mes a mes|billed monthly)/],
  ["yearly", /(anual\w*|al ano|\/ ?ano\b|por ano|cada ano|yearly|annual\w*|per year|\/ ?year\b|a year|every year|billed annually|12 meses)/],
];

function detectPeriod(subjectFolded, bodyFolded) {
  const found = (text) => PERIODS.filter(([, re]) => re.test(text)).map(([name]) => name);
  const inSubject = found(subjectFolded);
  if (inSubject.length === 1) return inSubject[0];
  const inBody = found(bodyFolded);
  if (inBody.length === 1) return inBody[0];
  if (inBody.length > 1) {
    // an offer for the other plan ("ahorra con el plan anual") must not decide: take the one nearest "total"/"importe"
    const pos = (re) => { const m = re.exec(bodyFolded); return m ? m.index : Infinity; };
    const total = /(total|importe|amount|renueva|renews)/.exec(bodyFolded)?.index ?? 0;
    const ranked = PERIODS.filter(([n]) => inBody.includes(n)).sort((a, b) => Math.abs(pos(a[1]) - total) - Math.abs(pos(b[1]) - total));
    return ranked[0][0];
  }
  return "unknown";
}

// ---------------------------------------------------------------- merchant
const GENERIC_NAME = /\b(no[- ]?reply|noreply|do[- ]?not[- ]?reply|no[- ]?responder|no contestar|account services?|accounts?|notificaciones?|notifications?|soporte|support|facturacion|facturas?|billing|invoices?|receipts?|recibos?|pedidos?|orders?|pagos?|payments?|team|equipo|servicio de atencion al cliente|atencion al cliente|customer (service|care|support)|info|hola|hello|mail|email|correo|avisos?|alertas?|confirmaciones?|confirmation|ventas|sales|tienda online)\b/gi;
const LEGAL = /[\s,]+(s\.?\s?l\.?\s?u?\.?|s\.?\s?a\.?\s?u?\.?|inc\.?|ltd\.?|llc|gmbh|b\.?v\.?|s\.?r\.?l\.?|s\.?l\.?l\.?)$/i;
const SUBDOMAINS = new Set(["mail", "email", "e", "em", "news", "m", "info", "no-reply", "noreply", "notifications", "notification", "mailer", "bounce", "send", "mg", "mailing", "smtp", "correo", "t", "www", "service", "services", "accounts", "billing", "receipts", "orders", "pedidos", "avisos"]);

function titleCase(text) {
  const letters = text.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, "");
  if (letters.length > 4 && letters === letters.toUpperCase()) {
    return text.toLowerCase().replace(/(^|[\s\-/'&(])([a-záéíóúñ])/g, (_, a, b) => a + b.toUpperCase());
  }
  return text;
}

export function cleanMerchantName(name) {
  let out = String(name ?? "").replace(CTRL, " ").replace(/\s+/g, " ").trim();
  out = out.replace(/\s+(via|vía)\s+paypal.*$/i, "");
  out = out.replace(/^www\./i, "").replace(/\.(com|es|net|org|eu|io|co\.uk|de|fr|it)\b/gi, "");
  for (let i = 0; i < 2; i++) out = out.replace(LEGAL, "");
  out = out.replace(/^[\s"'«»,.:;\-–]+|[\s"'«»,.:;\-–]+$/g, "").trim();
  return titleCase(out).slice(0, 80);
}

function domainLabel(address) {
  const host = String(address).split("@")[1]?.toLowerCase().trim();
  if (!host) return "";
  const parts = host.split(".").filter(Boolean);
  if (parts.length < 2) return parts[0] || "";
  const sld = ["co", "com", "org", "net", "gov", "ac"].includes(parts[parts.length - 2]) && parts.length >= 3 ? parts.length - 3 : parts.length - 2;
  let label = parts[sld];
  if (SUBDOMAINS.has(label) && sld > 0) label = parts[sld - 1];
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : "";
}

function senderName(fromName, fromAddress) {
  let name = String(fromName ?? "").replace(/\([^)]*\)/g, "").replace(/<[^>]*>/g, "");
  if (name.includes("@")) name = "";
  name = name.replace(GENERIC_NAME, " ").replace(/\s+/g, " ").replace(/^[\s\-–|:.]+|[\s\-–|:.]+$/g, "");
  name = cleanMerchantName(name);
  if (name.length >= 2) return name;
  return cleanMerchantName(domainLabel(fromAddress));
}

const PAYEE_STOP = /\s{2,}|\s-\s|\s\(|,\s|\s(por|for|id|fecha|date|numero|number|pedido|order|referencia|reference|detalles|details)\b|#|\s\d{1,2}[/.]\d{1,2}[/.]\d/i;
function trimPayee(raw) {
  let out = String(raw ?? "");
  const cut = out.search(PAYEE_STOP);
  if (cut > 1) out = out.slice(0, cut);
  out = out.replace(/[\s.:;,]+$/g, (m) => (/\b[A-Za-z]\.[A-Za-z]$/.test(out.slice(0, out.length - m.length + 1)) ? "." : ""));
  return cleanMerchantName(out);
}

function extractPayee(subject, body) {
  const sources = [subject, ...body.split("\n")];
  const patterns = [
    /(?:\bpago\b|\bpayment\b|\bpaid\b)[^\n]{0,80}?\b(?:a|to)\s+([^\n]{2,70})/i,
    /(?:recibo|receipt|invoice|factura)\s+(?:de|from|para|del)\s+([^\n:#]{2,60})/i,
    /(?:comerciante|merchant|vendedor|seller|tienda|payee|beneficiario|pagado a)\s*:\s*([^\n]{2,60})/i,
  ];
  for (const re of patterns) {
    for (const text of sources) {
      const m = re.exec(text);
      if (!m) continue;
      const name = trimPayee(m[1]);
      if (name.length >= 2 && !/^\d/.test(name) && !/^(tu|su|your|the|ti|you)\b/i.test(name)) return name;
    }
  }
  return null;
}

function extractCardMerchant(body) {
  const labelled = /(?:comercio|establecimiento|merchant|lugar|beneficiario|descripcion|descripción|concepto)\s*[:\-]\s*([^\n]{2,60})/i.exec(body);
  if (labelled) {
    const name = trimPayee(labelled[1]);
    if (name.length >= 2) return name;
  }
  const re = /(?<!(?:terminada|terminadas|ending|acabada|finalizada|last|ultimos)\s)\b(?:en|at)\s+((?!tu\b|su\b|la\b|el\b|los\b|las\b|un\b|una\b|your\b|the\b|a\b|an\b|este\b|esta\b)[A-Z0-9ÁÉÍÓÚÑ][^\n,;]{1,45}?)(?=\s+(?:el|on|a las|a la|con|por|tarjeta|using|with)\b|\s*[,;.]\s|\s*[,;.]?$|\s+\d{1,2}[/.-]\d{1,2})/;
  for (const line of body.split("\n")) {
    if (!/(compra|pago|cargo|operacion|purchase|payment|transaction|transaccion|movimiento)/i.test(line)) continue;
    for (const m of line.matchAll(new RegExp(re.source, "g"))) {
      const name = trimPayee(m[1]);
      if (name.length >= 2 && !/^[\d\s*xX.-]+$/.test(name)) return name;
    }
  }
  return null;
}

/** { name, known, how } — how: known | payee | body | sender | none */
export function identifyMerchant({ fromName, fromAddress, subject, body, cardNotice }) {
  const domain = String(fromAddress ?? "").split("@")[1] || "";
  const senderText = `${fromName ?? ""} ${domain}`;
  const known = knownMerchant(senderText);
  const bankSender = BANK_RE.test(fold(senderText));
  if (known?.gateway) {
    const payee = extractPayee(subject, body);
    if (payee) return { name: payee, known: knownMerchant(payee), how: "payee" };
    return { name: null, known: null, how: "none", gateway: known.name };
  }
  if (cardNotice && (bankSender || !known)) {
    const name = extractCardMerchant(body);
    if (name) return { name: knownMerchant(name)?.name || name, known: knownMerchant(name), how: "body" };
    if (bankSender) return { name: null, known: null, how: "none", bank: true };
  }
  if (known) return { name: known.name, known, how: "known" };
  const name = senderName(fromName, fromAddress);
  if (name) return { name, known: null, how: "sender" };
  const fromSubject = /(?:recibo|receipt|invoice|factura|pedido|order)\s+(?:de|from|para)\s+([^\n:#]{2,40})/i.exec(subject);
  const guess = fromSubject ? trimPayee(fromSubject[1]) : "";
  return guess ? { name: guess, known: knownMerchant(guess), how: "payee" } : { name: null, known: null, how: "none" };
}

const REF = "([a-z0-9][a-z0-9./-]{2,34}[a-z0-9])";
const REF_PATTERNS = [
  /\b([a-z]?\d{2,3}-\d{7}-\d{7})\b/g, // Amazon order numbers
  /\b(gs\.\d{4}-\d{4}-\d{4})\b/g, // Google Store
  /\b((?:sop|gpa)\.[0-9.-]{8,40})/g, // Google Play
  new RegExp(`(?:id de pedido|order id|order #|pedido #|invoice #|factura #|n[º°o]\\.? de factura|referencia del pedido)\\s*[:#]?\\s*${REF}`, "g"),
  new RegExp(`(?:numero|num\\.?|n\\.?[º°o]\\.?)\\s*(?:de\\s+)?(?:pedido|orden|order|factura|invoice|recibo|receipt)\\s*(?:es|is|:|#)?\\s*[:#]?\\s*${REF}`, "g"),
  new RegExp(`\\b(?:pedido|orden|order)\\s*(?:n\\.?[º°o]\\.?|no\\.?|num\\.?|number|numero|#|:|es|is)\\s*[:#]?\\s*${REF}`, "g"),
  /\b(?:pedido|order)\s+#?(\d{5,})\b/g,
  new RegExp(`(?:factura|invoice|recibo|receipt|referencia|reference|ref\\.?)\\s*(?:no\\.?|n[º°o]\\.?|#|:)?\\s*[:#]?\\s*${REF}`, "g"),
];
const validRef = (ref) => (ref.match(/\d/g) || []).length >= 3 && !/^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(ref) && !/^\d{4}-\d{2}-\d{2}$/.test(ref);

/** Order, invoice or receipt number (upper case), or null. Text is accent-folded and lower case. */
export function findOrderRef(subjectFolded, bodyFolded) {
  const text = `${subjectFolded}\n${bodyFolded}`;
  for (const re of REF_PATTERNS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const ref = m[1].replace(/[-/.]+$/g, "");
      if (validRef(ref)) return ref.toUpperCase().slice(0, 40);
    }
  }
  return null;
}

const LAST4 = /(?:tarjeta|card|visa|mastercard|amex|terminada en|ending in|acabada en|finalizada en|\*{2,}|x{3,}|•{2,}|\.{3})\s*(?:[a-z]+\s*){0,2}[*x•.\s-]*(\d{4})\b/i;

/** Item line of a Google Play receipt (the line after the "Artículo / Precio" header), so that every subscription billed through it is tracked apart. */
function googlePlayProduct(body) {
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  const at = lines.findIndex((l) => /^art[ií]culo$/i.test(l) || /^item$/i.test(l));
  if (at < 0) return null;
  let i = at + 1;
  if (/^(precio|price)$/i.test(lines[i] || "")) i++;
  const line = lines[i] || "";
  return line && line.length <= 160 && !findMoney(fold(line)).length ? oneLine(line, 70) : null;
}

// ---------------------------------------------------------------- main
/**
 * @param msg { subject, from_name, from_address, text, ts (epoch seconds), from_self }
 * @returns facts (see the head of the file)
 */
export function parseMail(msg, { now = Date.now() } = {}) {
  const subject = oneLine(msg?.subject, 300);
  const body = normText(msg?.text).slice(0, 24_000);
  const fs = fold(subject);
  const fb = fold(body);
  const full = `${fs}\n${fb}`;
  const ts = Number(msg?.ts);
  const mailDate = Number.isFinite(ts) && ts > 0 ? localDate(ts * 1000) : localDate(now);
  const reasons = [];
  const facts = {
    kind: "noise", merchant: null, merchant_key: null, category_hint: null, known: false, subscription: false,
    amount_cents: null, currency: null, charge_date: null, date_source: null, period: "unknown",
    next_charge_date: null, trial_end_date: null, price_change: null, order_ref: null, card_last4: null, product: null, order_cancel: false,
    confidence: 0, amount_source: null, conflict: false, mail_date: mailDate, reasons,
  };
  if (msg?.from_self) { reasons.push("correo propio"); return facts; }

  // mail that can never be a payment, whatever its words
  {
    const address = String(msg?.from_address ?? "").toLowerCase();
    const [local = "", host = ""] = address.split("@");
    const hostFirst = host.split(".")[0] || "";
    const senderFolded = fold(msg?.from_name ?? "");
    const why = REPLY_SUBJ.test(subject) ? "respuesta a un correo (no es un cobro)"
      : OPINION_SUBJ.test(fs) ? "petición de opinión"
        : MARKETING_LOCAL.test(local) || MARKETING_HOST.test(hostFirst) ? "correo comercial (boletín u ofertas)"
          : (SUPPORT_SENDER.test(senderFolded) && SUPPORT_LOCAL.test(local)) || SUPPORT_HOST.test(host) ? "conversación de atención al cliente"
            : CARRIER.test(`${senderFolded} ${host}`) ? "aviso de mensajería"
              : "";
    if (why) { reasons.push(why); return facts; }
  }

  const bodyLines = fb.split("\n");
  const failed = FAILED.test(full);
  const cancel = !failed && CANCEL.test(full) && !ORDER_CANCEL.test(full);
  const orderCancel = !failed && ORDER_CANCEL.test(full);
  const refund = !failed && !cancel && !orderCancel && (REFUND_SUBJ.test(fs) || REFUND_BODY.test(fb));
  const promoSubject = PROMO.test(fs);
  const promoBody = (fb.match(new RegExp(PROMO.source, "g")) || []).length;
  const pastSubject = PAST_VERB.test(fs);
  const pastAny = pastSubject || PAST_VERB.test(fb);
  const docSubject = DOC_WORD.test(fs);
  const docBody = DOC_WORD.test(fb);
  const shippingSubject = SHIPPING_SUBJ.test(fs) && !CONFIRM_SUBJ.test(fs);
  const upcomingSubject = UPCOMING_SUBJ.test(fs);
  const upcomingBody = UPCOMING.test(fb);
  const cardNotice = (CARD_NOTICE_SUBJ.test(fs) || (/(compra|pago|cargo|purchase|payment|transaction)[^\n]{0,120}\b(tarjeta|card)\b|\b(tarjeta|card)\b[^\n]{0,120}(compra|pago|cargo|purchase|payment|transaction)/.test(fb) && BANK_RE.test(fold(`${msg?.from_name ?? ""} ${String(msg?.from_address ?? "").split("@")[1] ?? ""}`))));

  if (!failed && (PROMO_VERB_SUBJ.test(fs) || (BULLETIN_FOOTER.test(fb) && !CONFIRM_SUBJ.test(fs) && !pastSubject && !findOrderRef(fs, fb)))) {
    reasons.push(PROMO_VERB_SUBJ.test(fs) ? "oferta o promoción" : "boletín (sin recibo ni pedido)");
    return facts;
  }

  let kind;
  if (failed) kind = "failed";
  else if (orderCancel) { kind = "cancel"; facts.order_cancel = true; }
  else if (cancel) kind = "cancel";
  else if (promoSubject && !pastSubject && !docSubject) { kind = "noise"; reasons.push("oferta o promoción"); }
  else if (refund) kind = "refund";
  else if (shippingSubject) { kind = "noise"; reasons.push("aviso de envío sin cobro"); }
  else if ((upcomingSubject && !pastSubject && !docSubject) || (upcomingBody && !pastAny && !docSubject)) kind = "upcoming";
  else if (pastAny || docSubject || docBody) kind = "charge";
  else { kind = "noise"; reasons.push("sin indicios de pago"); }

  if (kind === "noise") return facts;

  // merchant
  const who = identifyMerchant({ fromName: msg?.from_name, fromAddress: msg?.from_address, subject, body, cardNotice });
  if (who.name) {
    facts.merchant = who.name;
    facts.merchant_key = merchantKey(who.name);
    facts.known = !!who.known;
    facts.category_hint = who.known?.cat ?? null;
    facts.subscription = !!who.known?.sub;
    reasons.push(who.how === "known" ? `comerciante conocido (${who.name})` : who.how === "payee" ? `destinatario del pago: ${who.name}` : who.how === "body" ? `comercio del aviso: ${who.name}` : `remitente: ${who.name}`);
  } else if (who.gateway) reasons.push(`no se ve el comercio detrás de ${who.gateway}`);
  else if (who.bank) reasons.push("aviso del banco sin comercio");
  else reasons.push("comerciante no identificado");

  // shops and food never are a subscription by themselves; others need subscription words outside footer links
  const shopLike = !!who.known && SHOP_CATS.has(who.known.cat);
  const fullBare = full.replace(SUB_FOOTER, " ");
  const subs = shopLike ? PRIME_RE.test(`${fs}\n${fb.slice(0, 600)}`) : SUB_WORDS.test(fullBare);
  facts.subscription = subs || (!shopLike && !!who.known?.sub);
  facts.period = detectPeriod(fs, fb);
  if (facts.period !== "unknown" && kind === "upcoming" && !shopLike) facts.subscription = true;
  facts.order_ref = findOrderRef(fs, fb);
  if (who.known?.key === "googleplay") facts.product = googlePlayProduct(body);
  facts.card_last4 = LAST4.exec(body)?.[1] ?? null;

  // amount
  const upcomingAt = kind === "upcoming" ? Math.max(0, fb.search(UPCOMING)) : -1;
  let amount = pickAmount(fs, fb, { upcomingFrom: upcomingAt, bodyLines });
  if (!amount && kind === "upcoming" && upcomingAt >= 0) {
    const near = findMoney(fb.slice(upcomingAt, upcomingAt + 140));
    if (near.length) amount = { cents: near[0].cents, currency: near[0].currency, source: "near", tier: 1, conflict: false };
  }
  if (!amount && kind !== "failed" && kind !== "cancel") {
    const bare = bodyLines.map((l, i) => ({ l, i })).find(({ l, i }) => (TOTAL1.test(l) || TOTAL2.test(l)) && !EXCLUDE_LABEL.test(l) && /(?<![\d.,])\d{1,6}[.,]\d{2}(?![\d])/.test(l));
    if (bare) {
      const cents = parseAmount(/(?<![\d.,])\d{1,6}(?:[.,]\d{3})*[.,]\d{2}(?![\d])/.exec(bare.l)?.[0] ?? "");
      if (cents) { amount = { cents, currency: "EUR", source: "total", tier: 2, conflict: false, assumed: true }; reasons.push("divisa asumida: EUR"); }
    }
  }
  if (amount) {
    facts.amount_cents = amount.cents;
    facts.currency = amount.currency;
    facts.amount_source = amount.source;
    facts.conflict = amount.conflict;
    reasons.push(`importe ${amount.source === "total" ? "total" : amount.source === "verb" ? "del cobro" : amount.source === "subject" ? "del asunto" : amount.source === "single" ? "único" : "indicado"}`);
    if (amount.conflict) reasons.push("hay importes distintos con el mismo peso");
  } else if (kind === "charge" || kind === "refund") reasons.push("no se encuentra el importe");

  if (kind === "refund" && facts.amount_cents == null && !REFUND_SUBJ.test(fs)) {
    facts.kind = "noise";
    facts.merchant = null; facts.merchant_key = null; facts.category_hint = null; facts.known = false; facts.subscription = false;
    reasons.length = 0;
    reasons.push("menciona un reembolso pero sin importe: no es un reembolso");
    return facts;
  }

  // price change notice
  const pc = PRICE_CHANGE.exec(fb) || PRICE_CHANGE.exec(fs);
  if (pc) {
    const fromText = pc[1] ?? pc[3];
    const toText = pc[2] ?? pc[4];
    const fromCents = findMoney(`${fromText} `).at(0)?.cents ?? parseAmount(String(fromText).replace(/[^\d.,]/g, ""));
    const toCents = findMoney(`${toText} `).at(0)?.cents ?? parseAmount(String(toText).replace(/[^\d.,]/g, ""));
    if (fromCents && toCents && fromCents !== toCents) {
      facts.price_change = { from_cents: fromCents, to_cents: toCents };
      if (kind === "upcoming") {
        facts.amount_cents = toCents;
        facts.currency = facts.currency || "EUR";
        facts.amount_source = "price_change";
      }
    }
  }

  // dates
  const maxAhead = addDays(mailDate, 45);
  const minBack = addDays(mailDate, -400);
  if (kind === "charge" || kind === "refund") {
    const date = labelledDate(bodyLines, mailDate, CHARGE_DATE_LABEL, "past", { skip: (d) => d > maxAhead || d < minBack, reject: DELIVERY_BEFORE })
      || labelledDate(bodyLines, mailDate, WEAK_CHARGE_LABEL, "past", { skip: (d) => d > mailDate || d < minBack, reject: DELIVERY_BEFORE });
    if (date) { facts.charge_date = date; facts.date_source = "text"; }
    else { facts.charge_date = mailDate; facts.date_source = "mail"; }
  }
  facts.next_charge_date = labelledDate([fs, ...bodyLines], mailDate, NEXT_DATE_LABEL, "future", { skip: (d) => d < addDays(mailDate, -3) });
  if (kind === "upcoming" && !facts.next_charge_date) {
    const sd = findDates(fs, mailDate, "future")[0];
    if (sd) facts.next_charge_date = sd.date;
  }
  if (TRIAL_ANY.test(fullBare) && !shopLike) {
    facts.subscription = true;
    const rel = TRIAL_REL.exec(full);
    const trialDate = labelledDate([fs, ...bodyLines], mailDate, TRIAL_LABEL, "future", { skip: (d) => d < addDays(mailDate, -3) });
    facts.trial_end_date = trialDate || (rel ? addDays(mailDate, Number(rel[3])) : null);
    if (facts.trial_end_date && kind === "upcoming" && !facts.next_charge_date) facts.next_charge_date = facts.trial_end_date;
  }

  facts.kind = kind;

  // confidence (charges and refunds)
  if (kind === "charge" || kind === "refund") {
    let score = 0;
    score += facts.merchant ? (who.how === "known" ? 30 : who.how === "sender" ? 20 : 24) : 0;
    score += !amount ? 0 : amount.tier >= 3 ? 30 : amount.tier === 2 ? 28 : amount.tier === 1 ? 18 : 10;
    score += facts.date_source === "text" ? 15 : facts.date_source === "mail" ? 10 : 0;
    score += pastSubject ? 20 : pastAny ? 14 : docSubject ? 14 : kind === "refund" ? 16 : 8;
    if (amount?.conflict) score -= 15;
    if (amount?.assumed) score -= 5;
    if (promoBody >= 2) score -= 15;
    // merchant, amount and date found in a mail with an order or receipt cue: clear enough to act on
    const cue = pastSubject || docSubject || !!facts.order_ref || CONFIRM_SUBJ.test(fs) || /(confirmacion de (pedido|compra|pago)|order confirmation|pedido confirmado|tu pedido (ha sido )?(realizado|confirmado))/.test(fb);
    if (kind === "charge" && facts.merchant && amount && facts.charge_date && cue && !amount.conflict) score = Math.max(score, 75);
    facts.confidence = Math.max(0, Math.min(100, score));
  } else {
    facts.confidence = facts.merchant ? 60 : 30;
  }
  return facts;
}

/** Facts → one-line Spanish reasons for the review queue when the message cannot be recorded automatically. */
export function missingForAuto(facts) {
  const missing = [];
  if (!facts.merchant) missing.push("falta el comercio");
  if (facts.amount_cents == null) missing.push("falta el importe");
  if (!facts.charge_date) missing.push("falta la fecha");
  return missing;
}
