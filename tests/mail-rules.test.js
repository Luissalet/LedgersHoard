// Rules added after trying the mail import on a real inbox: label/value layouts, noise,
// order references, big amounts, merchant names, subscriptions that are not, order
// cancellations and the reset. Every message here is invented.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "./helpers.js";
import { installFakeSource, captureNotifications } from "./mail-helpers.js";
import { parseMail, normText, findOrderRef, cleanMerchantName } from "../server/mail-parse.js";
import { fold } from "../server/mail-merchants.js";
import * as engine from "../server/mail-engine.js";
import * as subs from "../server/subscriptions.js";
import { updateMailSettings, mailSettings } from "../server/mail-settings.js";
import { db } from "../server/db.js";
import { listEntries, createEntry } from "../server/entries.js";
import { createAccount } from "../server/accounts.js";
import { commitImport } from "../server/imports.js";
import { listNotifications } from "../server/notifications.js";

const at = (iso) => Math.floor(Date.parse(`${iso}T12:00:00Z`) / 1000);
const NOW = Date.parse("2026-10-20T12:00:00Z");
const parse = (m) => parseMail(m, { now: NOW });

// ---------------------------------------------------------------- parser
const layout = {
  subject: "¡Tu pedido ha sido realizado!",
  from_name: "Hamburguesería Ejemplo", from_address: "no-reply@m.hamburgueseria-ejemplo.test", ts: at("2026-09-21"),
  text: "Aquí tienes el resumen de lo que nos has pedido.\n\nCtd.\n\nProducto\n\nPrecio €\n\n1\n\nMenú Grande\n\n€ 11.25\n\n2\n\nPatatas\n\n€ 3.90\n\nSubtotal\n\n€ 15.15\n\nGastos de envío\n\n€ 0.00\n\nTOTAL\n\n€ 15.15\n\nNº DE PEDIDO\n\nOrder #:2979\n\nSERVICIO\n\nDELIVERY\n\nOrder ID 8ee3401a-accf-4065-ab3f-fc0606207764\n\nEl plazo de reclamaciones es de 24 horas.",
};

test("a label followed by blank lines and then the value is read; TOTAL beats Subtotal; the symbol may come first", () => {
  const f = parse(layout);
  assert.equal(f.kind, "charge");
  assert.equal(f.amount_cents, 1515);
  assert.equal(f.currency, "EUR");
  assert.equal(f.merchant, "Hamburguesería Ejemplo");
  assert.ok(f.confidence >= 75, `confidence ${f.confidence}`);
});

test("«Importe:» and «Fecha:» on their own lines, value two lines below", () => {
  const f = parse({
    subject: "Confirmación de pedido", from_name: "Burger Ejemplo Account Services", from_address: "DoNotReply@burgerejemplo.test", ts: at("2026-09-19"),
    text: "Gracias por elegirnos.\n\nFecha:\n\n17/09/26 22:28\n\nNombre del Restaurante:\n\nBurger Ejemplo Centro\n\nId de Pedido:\n\n0602\n\nImporte:\n\n16.92 EUR\n\nTarjeta:\n\nMasterCard\n/ ************0000",
  });
  assert.equal(f.kind, "charge");
  assert.equal(f.amount_cents, 1692);
  assert.equal(f.charge_date, "2026-09-17");
  assert.equal(f.date_source, "text");
  assert.equal(f.order_ref, "0602");
  assert.equal(f.merchant, "Burger Ejemplo", "«Account Services» is not part of the brand");
  assert.ok(f.confidence >= 75);
});

test("merchant, amount and date found with an order cue: confidence is at least 75", () => {
  const f = parse({ subject: "Pedido recibido", from_name: "Tienda Ejemplo", from_address: "avisos@tiendaejemplo.test", ts: at("2026-10-02"), text: "Cargo 12,00 €" });
  assert.equal(f.kind, "charge");
  assert.ok(f.confidence >= 75, `confidence ${f.confidence}`);
  // without the cue the floor does not apply
  const bare = parse({ subject: "Aviso", from_name: "Tienda Ejemplo", from_address: "avisos@tiendaejemplo.test", ts: at("2026-10-02"), text: "Gracias. Importe 12,00 € 15,00 € 7,00 €" });
  assert.ok(bare.kind === "noise" || bare.confidence < 75);
});

test("merchant names: brand only", () => {
  assert.equal(cleanMerchantName("Ejemplo.es"), "Ejemplo");
  assert.equal(cleanMerchantName("www.tiendaejemplo.com"), "tiendaejemplo");
  const names = [
    ["Tienda Ejemplo Account Services", "cuentas@tiendaejemplo.test"],
    ["Tienda Ejemplo (Customer Support)", "info@tiendaejemplo.test"],
    ["Notificaciones Tienda Ejemplo", "no-reply@tiendaejemplo.test"],
    ["Tienda Ejemplo.es", "no-reply@tiendaejemplo.test"],
    ["no-reply", "no-reply@tiendaejemplo.test"],
  ];
  for (const [from_name, from_address] of names) {
    const f = parse({ subject: "Confirmación de tu pedido", from_name, from_address, ts: at("2026-10-02"), text: "Total: 9,50 €\nFecha del pedido: 01/10/2026" });
    assert.match(f.merchant, /^Tienda ?[Ee]jemplo$/, `${from_name} → ${f.merchant}`);
  }
});

test("order references of every shape end up in order_ref (upper case)", () => {
  const ref = (subject, text) => findOrderRef(fold(subject), fold(text));
  assert.equal(ref("Pedido: “Cable”", "Pedido n.º ‫123-1234567-7654321\nVer pedido"), "123-1234567-7654321");
  assert.equal(ref("", "N.º de pedido D01-1234567-7654321"), "D01-1234567-7654321");
  assert.equal(ref("", "Su número de pedido es 4455667, su nombre de usuario es x"), "4455667");
  assert.equal(ref("Tu pedido (GS.1111-2222-3333) está listo", "Número de pedido\nGS.1111-2222-3333"), "GS.1111-2222-3333");
  assert.equal(ref("¡Pedido 7788990 enviado!", ""), "7788990");
  assert.equal(ref("", "Your order #AB-554433 has shipped"), "AB-554433");
  assert.equal(ref("", "Tu pedido n.° 99887766 ha sido cancelado"), "99887766");
  assert.equal(ref("", "Order ID 8ee3401a-accf-4065-ab3f-fc0606207764"), "8EE3401A-ACCF-4065-AB3F-FC0606207764");
  assert.equal(ref("", "Fecha del pedido: 12/10/2026"), null, "a date is not an order number");
  assert.equal(ref("Hola", "Tu pedido llegará pronto"), null);
});

test("noise: replies, opinion requests, newsletters, carriers, gift promos and support chats", () => {
  const base = { from_name: "Tienda Ejemplo", from_address: "pedidos@tiendaejemplo.test", ts: at("2026-10-02"), text: "Total: 20,00 €\nTu pedido ha sido confirmado. Hemos procesado tu reembolso de 20,00 €." };
  const noise = (patch, why) => {
    const f = parse({ ...base, ...patch });
    assert.equal(f.kind, "noise", `${why}: ${JSON.stringify(patch.subject)} → ${f.kind}`);
    assert.equal(f.amount_cents, null);
  };
  noise({ subject: "Re: Confirmación de tu pedido" }, "reply");
  noise({ subject: "RE: Re: Gracias por tu pedido" }, "reply 2");
  noise({ subject: "[Soporte] Re: Pedido 998877" }, "reply with tag");
  noise({ subject: "¿Qué tal tu último pedido de Cafetería Ejemplo?" }, "opinion 1");
  noise({ subject: "¿Cumple tus expectativas tu pedido reciente? Da tu opinión" }, "opinion 2");
  noise({ subject: "Valora tu compra y gana puntos" }, "opinion 3");
  noise({ subject: "Rate your order from Tienda Ejemplo" }, "opinion 4");
  noise({ subject: "Tu pedido ha sido confirmado", from_address: "newsletter@update.tiendaejemplo.test" }, "newsletter sender");
  noise({ subject: "Tu pedido ha sido confirmado", from_address: "info-promo@tiendaejemplo.test" }, "info-promo sender");
  noise({ subject: "Tu pedido ha sido confirmado", from_address: "avisos@deals.tiendaejemplo.test" }, "marketing host");
  noise({ subject: "Tu pedido ha sido confirmado", from_name: "Mensajería Ejemplo", from_address: "avisos@inpost.test" }, "carrier");
  noise({ subject: "¡El regalo fue enviado el 16 ago 2026!", from_address: "regalos@tiendaejemplo.test" }, "gift promo");
  noise({ subject: "¡Ya puedes recoger tu paquete!", text: "Tu pedido ha llegado al punto de recogida. Total: 20,00 €" }, "pickup notice");
  noise({ subject: "Tu pedido ha sido confirmado", from_name: "Olivia (Customer Support)", from_address: "support@ejemplo.zendesk.test" }, "support chat");
  noise({ subject: "Didn't receive my order", from_name: "Eva (Customer Support)", from_address: "support@ejemplo.test" }, "support chat 2");
});

test("a «refund» word without an amount is not a refund; a refund subject still is", () => {
  const talk = parse({ subject: "Sobre tu consulta", from_name: "Tienda Ejemplo", from_address: "pedidos@tiendaejemplo.test", ts: at("2026-10-02"), text: "Tu reembolso de 12 días hábiles se procesa como una reversión. Hemos procesado tu reembolso." });
  assert.equal(talk.kind, "noise");
  assert.match(talk.reasons.join(" "), /sin importe/);
  const real = parse({ subject: "Reembolso de tu pedido", from_name: "Tienda Ejemplo", from_address: "pedidos@tiendaejemplo.test", ts: at("2026-10-02"), text: "Hemos procesado tu reembolso de 18,50 €." });
  assert.equal(real.kind, "refund");
  assert.equal(real.amount_cents, 1850);
});

test("a delivery date is not the charge date; the order date under «Pedido» is", () => {
  const delivery = parse({ subject: "Pedido: “Cable”", from_name: "Tienda Ejemplo", from_address: "pedidos@tiendaejemplo.test", ts: at("2026-10-02"), text: "¡Gracias por tu pedido!\nLlega el 15 oct\nTotal 17.95€" });
  assert.equal(delivery.charge_date, "2026-10-02");
  assert.equal(delivery.date_source, "mail");
  const dated = parse({ subject: "Tu pedido está listo", from_name: "Tienda Ejemplo", from_address: "pedidos@tiendaejemplo.test", ts: at("2026-10-12"), text: "Total: 40,00 €\nPedido\n7 de octubre de 2026, 18:07\nNúmero de pedido\nXX.1234-5678" });
  assert.equal(dated.charge_date, "2026-10-07");
  assert.equal(dated.date_source, "text");
});

test("HTML and entities in the text are decoded; invisible characters are dropped", () => {
  const text = normText("<html><head><style>.a{color:red}</style></head><body><p>Total:&nbsp;12,50&nbsp;&euro;</p>&#8204; &zwnj; <p>Fecha: 02/10/2026</p></body></html>");
  assert.match(text, /Total: 12,50 €/);
  assert.doesNotMatch(text, /color:red|<p>|&nbsp;|&#8204;/);
  assert.equal(normText("a‫b­c"), "abc");
});

test("«Tu pedido ha sido cancelado» is an order cancellation, not a subscription one", () => {
  const f = parse({ subject: "Tu pedido de Tienda Ejemplo ha sido cancelado.", from_name: "Tienda Ejemplo", from_address: "pedidos@tiendaejemplo.test", ts: at("2026-10-02"), text: "Has cancelado correctamente el pedido n.° 99887766.\nSi ya se te cobró, recibirás un reembolso en 3 a 5 días." });
  assert.equal(f.kind, "cancel");
  assert.equal(f.order_cancel, true);
  assert.equal(f.order_ref, "99887766");
  const sub = parse({ subject: "Tu suscripción ha sido cancelada", from_name: "Streaming Ejemplo", from_address: "info@streamingejemplo.test", ts: at("2026-10-02"), text: "Hemos cancelado tu suscripción mensual." });
  assert.equal(sub.kind, "cancel");
  assert.equal(sub.order_cancel, false);
});

test("shops and food are not subscriptions, even with footer links and Prime-style words in the text", () => {
  const footer = "\nCancelar suscripción | Gestionar tus suscripciones | Actualiza tus preferencias\nPrueba gratuita de nuestra tarjeta premium plus";
  const shop = parse({ subject: "Pedido: “Funda”", from_name: "Amazon.es", from_address: "auto-confirm@amazon.es", ts: at("2026-10-02"), text: `¡Gracias por tu pedido!\nPedido n.º 123-1234567-7654321\nTotal 10,99€${footer}` });
  assert.equal(shop.kind, "charge");
  assert.equal(shop.subscription, false);
  const food = parse({ subject: "Tu pedido ha sido confirmado", from_name: "Just Eat", from_address: "no-reply@order.just-eat.test", ts: at("2026-10-02"), text: `Total: 13,68 €${footer}` });
  assert.equal(food.subscription, false);
  const prime = parse({ subject: "Tu suscripción a Amazon Prime se ha renovado", from_name: "Amazon.es", from_address: "prime@amazon.es", ts: at("2026-10-02"), text: "Hemos cobrado la cuota mensual de Amazon Prime.\nTotal: 4,99 €\nFecha de pago: 01/10/2026" });
  assert.equal(prime.subscription, true);
  const links = "\nCancelar suscripción | Gestionar tus suscripciones | Actualiza tus preferencias";
  const unknown = parse({ subject: "Recibo de tu pedido", from_name: "Tienda Rara", from_address: "avisos@tiendarara.test", ts: at("2026-10-02"), text: `Total: 9,00 €${links}` });
  assert.equal(unknown.subscription, false, "footer links do not make a subscription");
});

test("Google Play receipts: the product is read from the item line", () => {
  const f = parse({
    subject: "Recibo de tu pedido de Google Play del 14 sept 2026", from_name: "Google Play", from_address: "googleplay-noreply@google.test", ts: at("2026-09-14"),
    text: "Gracias\nTu suscripción de Proveedor Ejemplo en Google Play continúa y se te ha cobrado el importe correspondiente.\nNúmero de pedido: SOP.1111-2222-3333-44444..1\nFecha del pedido: 14 sept 2026 9:48:06 CEST\nArtículo\nPrecio\nPlan Ejemplo Plus (50 GB)\n(de Proveedor Ejemplo)\n2,99 € al mes\nSuscripción de renovación automática\nTotal :\n2,99 € al mes",
  });
  assert.equal(f.merchant, "Google Play");
  assert.equal(f.product, "Plan Ejemplo Plus (50 GB)");
  assert.equal(f.amount_cents, 299);
  assert.equal(f.period, "monthly");
  assert.equal(f.subscription, true);
  assert.equal(f.charge_date, "2026-09-14");
});

// ---------------------------------------------------------------- engine
let s;
let sink;
let account;
const shop = (n, patch = {}) => ({
  message_id: `<r-${n}@test>`, subject: "Confirmación de tu pedido en Tienda Ejemplo", from_name: "Tienda Ejemplo", from_address: "pedidos@tiendaejemplo.test",
  ts: at("2026-10-10"), text: "Número de pedido: 55012345\nTotal: 42,50 €\nFecha del pedido: 10/10/2026", ...patch,
});
const scan = (messages, options = {}) => { const source = installFakeSource(messages); return engine.scanMail({ trigger: "test", ...options }).then((run) => Object.assign(run, { source })); };
const entries = () => listEntries({ limit: 500, order: "asc" }).items;
const wipe = () => {
  for (const table of ["entries", "mail_messages", "subscriptions", "mail_runs", "notifications", "imports"]) db().exec(`DELETE FROM ${table}`);
  updateMailSettings({ account: "", auto_record: true, min_confidence: 70, review_above: 500, toast: true, hub: true });
};
const byId = (id) => engine.getMail(id);

before(async () => {
  s = await bootServer();
  sink = captureNotifications();
  account = createAccount({ name: "Banco Ficticio", opening_balance: 100000 });
});
after(async () => { sink.restore(); await s.stop(); });
beforeEach(() => { wipe(); sink.events.length = 0; sink.scripts.length = 0; });

test("the payment query leaves promotions, social and forums out", async () => {
  const run = await scan([]);
  const q = run.source.requests[0].gmail_query;
  assert.match(q, / -category:promotions -category:social -category:forums$/);
  assert.match(q, /recibo/);
});

test("a later mail for the same order never records again: confirmation, status, repeat and replies", async () => {
  const messages = [
    shop(1),
    shop(2, { subject: "Tu pedido 55012345 está en camino", ts: at("2026-10-11"), text: "Tu pedido 55012345 ha salido." }),
    shop(3, { subject: "Re: Confirmación de tu pedido en Tienda Ejemplo", ts: at("2026-10-12") }),
    shop(4, { subject: "Tu pedido de Tienda Ejemplo", ts: at("2026-10-14"), text: "Número de pedido: 55012345\nTotal: 42,50 €" }),
  ];
  const run = await scan(messages);
  assert.deepEqual([run.recorded, run.duplicates, run.ignored], [1, 1, 2]);
  assert.equal(entries().length, 1);
  const dup = byId("<r-4@test>");
  assert.equal(dup.state, "duplicate");
  assert.equal(dup.facts.duplicate_of_mail, "<r-1@test>");
  assert.equal(dup.entry_id, byId("<r-1@test>").entry_id);
});

test("a short order number repeats from day to day: it only matches within a day", async () => {
  const day = (n, iso, total) => shop(n, { subject: "Confirmación de pedido", from_name: "Hamburguesería Ejemplo", from_address: "no-reply@hamburgueseria-ejemplo.test", ts: at(iso), text: `Id de Pedido:\n\n0602\n\nImporte:\n\n${total} EUR` });
  const run = await scan([day(1, "2026-10-02", "16.92"), day(2, "2026-10-12", "21.10"), day(3, "2026-10-12", "21.10")]);
  assert.deepEqual([run.recorded, run.duplicates], [2, 1]);
  assert.equal(entries().length, 2);
});

test("a later mail with the total completes a review item that lacked it, and the entry is recorded once", async () => {
  const first = shop(1, { subject: "Tu pedido de Tienda Ejemplo", text: "Número de pedido: 55012345\nFecha del pedido: 10/10/2026" });
  const second = shop(2, { subject: "Recibo de tu pedido", ts: at("2026-10-11") });
  let run = await scan([first]);
  assert.equal(run.review, 1);
  assert.match(engine.reviewQueue()[0].review_reasons.join(" "), /falta el importe/);
  run = await scan([first, second]);
  assert.deepEqual([run.recorded, run.duplicates, run.review], [0, 1, 0]);
  assert.equal(entries().length, 1);
  assert.equal(entries()[0].amount_cents, -4250);
  assert.equal(entries()[0].date, "2026-10-10");
  assert.equal(byId("<r-1@test>").state, "recorded");
  assert.equal(byId("<r-2@test>").state, "duplicate");
  assert.equal(engine.reviewQueue().length, 0);
});

test("a later mail for an order waiting in review is a duplicate, never a second review item", async () => {
  updateMailSettings({ auto_record: false });
  const run = await scan([shop(1), shop(2, { ts: at("2026-10-11"), subject: "Tu pedido de Tienda Ejemplo" })]);
  assert.deepEqual([run.review, run.duplicates], [1, 1]);
  assert.equal(engine.reviewQueue().length, 1);
});

test("big amounts wait in review (importe alto) whatever their confidence; the limit is a setting", async () => {
  const big = shop(1, { text: "Número de pedido: 55012345\nTotal: 600,00 €\nFecha del pedido: 10/10/2026" });
  assert.equal(mailSettings().review_above, 500);
  let run = await scan([big]);
  assert.deepEqual([run.recorded, run.review], [0, 1]);
  const queued = engine.reviewQueue()[0];
  assert.deepEqual(queued.review_reasons, ["importe alto (revísalo)"]);
  assert.ok(queued.confidence >= 75);
  // accepting it is the user's decision
  const accepted = await engine.acceptMail(queued.message_id);
  assert.equal(accepted.entry.amount_cents, -60000);
  // exactly 500 is fine; a higher limit lets 600 through; 0 turns the check off
  wipe();
  run = await scan([shop(2, { text: "Número de pedido: 55012346\nTotal: 500,00 €\nFecha del pedido: 10/10/2026" })]);
  assert.equal(run.recorded, 1, "the limit is exclusive");
  wipe();
  updateMailSettings({ review_above: 1000 });
  run = await scan([big]);
  assert.equal(run.recorded, 1);
  wipe();
  updateMailSettings({ review_above: 0 });
  run = await scan([shop(3, { text: "Número de pedido: 55012347\nTotal: 5.000,00 €\nFecha del pedido: 10/10/2026" })]);
  assert.equal(run.recorded, 1);
});

test("review_above: validated by the settings route", async () => {
  assert.equal((await s.call("GET", "/api/mail/settings")).body.review_above, 500);
  assert.equal((await s.call("PUT", "/api/mail/settings", { review_above: 750.5 })).body.review_above, 750.5);
  assert.equal((await s.call("PUT", "/api/mail/settings", { review_above: -1 })).status, 400);
  assert.equal((await s.call("PUT", "/api/mail/settings", { review_above: 2_000_000 })).status, 400);
  assert.equal((await s.call("PUT", "/api/mail/settings", { review_above: "mucho" })).status, 400);
});

const cancelMail = (n, patch = {}) => shop(n, { subject: "Tu pedido de Tienda Ejemplo ha sido cancelado.", ts: at("2026-10-11"), text: "Has cancelado correctamente el pedido n.° 55012345.\nSi ya se te cobró, recibirás un reembolso en 3 a 5 días.", ...patch });

test("an order cancelled after it was recorded waits in review, is not a subscription alert, and undoing the order closes it", async () => {
  const run = await scan([shop(1), cancelMail(2)]);
  assert.deepEqual([run.recorded, run.review], [1, 1]);
  const queue = engine.reviewQueue();
  assert.equal(queue.length, 1);
  assert.equal(queue[0].kind, "cancel");
  assert.equal(queue[0].cancels_message_id, "<r-1@test>");
  assert.equal(queue[0].entry_id, byId("<r-1@test>").entry_id);
  assert.match(queue[0].review_reasons[0], /pedido cancelado/);
  assert.equal(listNotifications({ limit: 50 }).some((n) => n.kind === "subscription.cancelled"), false);
  assert.ok(listNotifications({ limit: 50 }).some((n) => n.kind === "mail.order_cancelled"));
  assert.equal(subs.listSubscriptions().length, 0);
  // it cannot be "accepted" as a payment
  await assert.rejects(() => engine.acceptMail("<r-2@test>"), /cancelado/);
  // the user removes the entry: the cancellation item is closed too
  engine.undoMail("<r-1@test>", { confirm: true });
  assert.equal(entries().length, 0);
  assert.equal(engine.reviewQueue().length, 0);
});

test("ignoring the cancellation keeps the entry", async () => {
  await scan([shop(1), cancelMail(2)]);
  engine.ignoreMail("<r-2@test>");
  assert.equal(engine.reviewQueue().length, 0);
  assert.equal(entries().length, 1);
});

test("a cancellation seen before the charge flags the charge; one with no order seen is only logged", async () => {
  let run = await scan([cancelMail(1, { ts: at("2026-10-09") })]);
  assert.deepEqual([run.review, run.ignored], [0, 1]);
  run = await scan([cancelMail(1, { ts: at("2026-10-09") }), shop(2)]);
  assert.equal(run.review, 1);
  assert.deepEqual(engine.reviewQueue()[0].review_reasons, ["pedido cancelado"]);
  assert.equal(entries().length, 0);
});

test("a cancellation of an order that waits in review adds the reason to it", async () => {
  const big = shop(1, { text: "Número de pedido: 55012345\nTotal: 900,00 €\nFecha del pedido: 10/10/2026" });
  await scan([big, cancelMail(2)]);
  const queue = engine.reviewQueue();
  assert.equal(queue.length, 1);
  assert.deepEqual(queue[0].review_reasons, ["importe alto (revísalo)", "pedido cancelado"]);
});

test("shops, food and platforms: no subscription from footers, repeated shop charges or other products", async () => {
  const footer = "\nCancelar suscripción | Gestionar tus suscripciones";
  const amazon = (n, iso, total) => ({
    message_id: `<a-${n}@test>`, subject: "Pedido: “Funda”", from_name: "Amazon.es", from_address: "auto-confirm@amazon.es", ts: at(iso),
    text: `¡Gracias por tu pedido!\nPedido n.º 123-000000${n}-7654321\nTotal ${total}€${footer}`,
  });
  // three same-priced orders a month apart would be a "recurring" pattern for any other merchant
  const run = await scan([amazon(1, "2026-07-10", "10.74"), amazon(2, "2026-08-09", "10.74"), amazon(3, "2026-09-08", "10.74"), amazon(4, "2026-10-08", "909.73")]);
  assert.equal(run.recorded, 3);
  assert.equal(run.review, 1, "909,73 waits for review");
  assert.equal(subs.listSubscriptions().length, 0);
  assert.equal(listNotifications({ limit: 100 }).filter((n) => n.kind.startsWith("subscription")).length, 0);
  subs.syncFromEntries();
  assert.equal(subs.listSubscriptions().length, 0, "detecting from entries skips shops too");
});

const play = (n, iso, product, price, period = "al mes") => ({
  message_id: `<g-${n}@test>`, subject: `Recibo de tu pedido de Google Play del ${iso}`, from_name: "Google Play", from_address: "googleplay-noreply@google.test", ts: at(iso),
  text: `Gracias\nTu suscripción en Google Play continúa y se te ha cobrado el importe correspondiente.\nNúmero de pedido: SOP.1111-2222-3333-4444${n}..${n}\nFecha del pedido: ${iso}\nArtículo\nPrecio\n${product}\n(de Proveedor Ejemplo)\n${price} ${period}\nSuscripción de renovación automática\nTotal :\n${price} ${period}`,
});

test("every product billed through Google Play is its own subscription: no price alert between them, one alert for a real price change", async () => {
  const run = await scan([
    play(1, "2026-08-14", "Plan Ejemplo Plus (50 GB)", "2,99 €"),
    play(2, "2026-09-14", "Plan Ejemplo Plus (50 GB)", "2,99 €"),
    play(3, "2026-08-05", "Curso Anual Ejemplo", "59,99 €", "al año"),
    play(4, "2026-08-04", "Club Mensual Ejemplo", "29,98 €"),
  ]);
  assert.equal(run.recorded, 4);
  const list = subs.listSubscriptions();
  assert.equal(list.length, 3);
  const plus = list.find((x) => /Plan Ejemplo Plus/.test(x.merchant));
  assert.equal(plus.merchant, "Google Play · Plan Ejemplo Plus (50 GB)");
  assert.equal(plus.price_history.length, 2);
  assert.equal(plus.period, "monthly");
  assert.equal(list.find((x) => /Curso Anual/.test(x.merchant)).period, "yearly");
  assert.equal(listNotifications({ limit: 100 }).filter((n) => n.kind === "subscription.price").length, 0);
  assert.deepEqual(entries().map((e) => e.counterparty), ["Google Play", "Google Play", "Google Play", "Google Play"]);
  // the same product at a new price is a price change of that subscription only
  await scan([play(5, "2026-10-14", "Plan Ejemplo Plus (50 GB)", "3,99 €")]);
  const prices = listNotifications({ limit: 100 }).filter((n) => n.kind === "subscription.price");
  assert.equal(prices.length, 1);
  assert.match(prices[0].title, /Plan Ejemplo Plus.*2,99.*3,99/);
});

test("mail_reset: needs confirm, clears the mail import, keeps entries that are not from mail", async () => {
  const manual = createEntry({ date: "2026-10-01", amount_cents: -1000, account_id: account.id, counterparty: "Panadería", note: "", source: "manual" });
  await scan([shop(1), play(1, "2026-09-14", "Plan Ejemplo Plus (50 GB)", "2,99 €")]);
  subs.createSubscription({ merchant: "Gimnasio Ejemplo", amount_cents: 3000, period: "monthly" }, { source: "manual" });
  assert.ok(listNotifications({ limit: 50 }).length > 0);
  assert.throws(() => engine.resetMail({}), /confirm: true/);
  assert.throws(() => engine.resetMail({ confirm: false }), /confirm: true/);
  assert.equal(db().prepare("SELECT COUNT(*) AS n FROM mail_messages").get().n, 2);

  const out = engine.resetMail({ confirm: true });
  assert.deepEqual([out.mail_messages, out.subscriptions, out.entries_deleted], [2, 1, 0]);
  assert.ok(out.notifications > 0);
  assert.equal(db().prepare("SELECT COUNT(*) AS n FROM mail_messages").get().n, 0);
  assert.equal(db().prepare("SELECT COUNT(*) AS n FROM notifications").get().n, 0);
  assert.equal(db().prepare("SELECT COUNT(*) AS n FROM mail_runs").get().n, 0);
  assert.deepEqual(subs.listSubscriptions().map((x) => x.merchant), ["Gimnasio Ejemplo"], "only mail-sourced subscriptions go");
  assert.equal(entries().length, 3, "no entry is touched");
  assert.ok(entries().some((e) => e.id === manual.id));

  // the next scan starts from the first window again and reads everything
  const run = await scan([shop(1)]);
  assert.equal(run.since_days, 62);
  assert.deepEqual(run.source.requests[0].skip, []);
  assert.equal(run.duplicates, 1, "the old entry is recognised, not recorded twice");
});

test("mail_reset with delete_entries removes only entries a mail created and no bank row adopted", async () => {
  const manual = createEntry({ date: "2026-10-01", amount_cents: -1000, account_id: account.id, counterparty: "Panadería", note: "", source: "manual" });
  await scan([
    shop(1),
    { message_id: "<n-1@test>", subject: "Tu recibo de Netflix", from_name: "Netflix", from_address: "info@mailer.netflix.test", ts: at("2026-10-05"), text: "Total: 12,99 €\nFecha de facturación: 05/10/2026" },
  ]);
  assert.equal(entries().length, 3);
  // the bank statement adopts the Netflix entry
  commitImport({ csv: "Fecha;Concepto;Importe\n06/10/2026;COMPRA TARJ. NETFLIX.COM 4455;-12,99\n", account_id: account.id });
  assert.equal(entries().length, 3);
  const out = engine.resetMail({ confirm: true, delete_entries: true });
  assert.equal(out.entries_deleted, 1);
  const left = entries();
  assert.equal(left.length, 2);
  assert.ok(left.some((e) => e.id === manual.id));
  assert.ok(left.some((e) => e.source === "import"), "the bank-adopted entry stays");
});

test("mail_reset through the route and the tool", async () => {
  await scan([shop(1)]);
  assert.equal((await s.call("POST", "/api/mail/reset", {})).status, 400);
  const tool = await s.agent("mail_reset", { confirm: false });
  assert.equal(tool.status >= 400 || tool.body.isError === true || /confirm/.test(JSON.stringify(tool.body)), true);
  assert.equal(db().prepare("SELECT COUNT(*) AS n FROM mail_messages").get().n, 1);
  const ok = await s.agent("mail_reset", { confirm: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(db().prepare("SELECT COUNT(*) AS n FROM mail_messages").get().n, 0);
  await scan([shop(2, { text: "Número de pedido: 66012345\nTotal: 10,00 €\nFecha del pedido: 10/10/2026" })]);
  const route = await s.call("POST", "/api/mail/reset", { confirm: true });
  assert.equal(route.status, 200);
  assert.equal(route.body.mail_messages, 1);
  assert.equal(entries().length, 2, "entries stay by default");
});

test("a scan in progress blocks the reset", async () => {
  const source = installFakeSource([shop(1)], { delay: 150 });
  const running = engine.scanMail({ trigger: "test" });
  assert.throws(() => engine.resetMail({ confirm: true }), /en curso/);
  await running;
  assert.equal(source.calls, 1);
});
