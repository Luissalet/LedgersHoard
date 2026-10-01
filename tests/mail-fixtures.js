// Invented mails for the parser and recording tests: no real people,
// addresses, card numbers or order numbers. Times are noon UTC so the local
// date is the same in every time zone.
const at = (iso) => Math.floor(Date.parse(`${iso}T12:00:00Z`) / 1000);

export const MAIL = {
  netflix: {
    message_id: "<m-netflix-1@test>",
    subject: "Tu recibo de Netflix",
    from_name: "Netflix", from_address: "info@mailer.netflix.com", ts: at("2026-10-05"),
    text: `Hola,\nHemos cobrado tu suscripción mensual de Netflix.\nPlan Estándar\nSubtotal 10,74 €\nIVA 2,25 €\nTotal: 12,99 €\nFecha de facturación: 05/10/2026\nPróximo cobro: 05/11/2026\nTarjeta terminada en 4821\nNúmero de factura: NF-2026-100234`,
  },
  spotify10: {
    message_id: "<m-spotify-1@test>",
    subject: "Recibo de pago de Spotify Premium",
    from_name: "Spotify", from_address: "no-reply@spotify.com", ts: at("2026-08-12"),
    text: `Gracias por tu pago.\nSpotify Premium Individual (mensual)\nImporte total: 10,99 €\nFecha de pago: 12/08/2026`,
  },
  spotify11: {
    message_id: "<m-spotify-2@test>",
    subject: "Recibo de pago de Spotify Premium",
    from_name: "Spotify", from_address: "no-reply@spotify.com", ts: at("2026-09-12"),
    text: `Gracias por tu pago.\nSpotify Premium Individual (mensual)\nImporte total: 11,99 €\nFecha de pago: 12/09/2026`,
  },
  spotifyNotice: {
    message_id: "<m-spotify-notice@test>",
    subject: "Cambios en el precio de Premium",
    from_name: "Spotify", from_address: "no-reply@spotify.com", ts: at("2026-10-01"),
    text: `Te escribimos para avisarte de un cambio en el precio.\nA partir del 12/11/2026 tu plan Premium Individual pasará de 11,99 € a 12,99 € al mes.`,
  },
  paypal: {
    message_id: "<m-paypal-1@test>",
    subject: "Has enviado un pago de 12,99 EUR a Tienda Ejemplo S.L.",
    from_name: "PayPal", from_address: "service@paypal.es", ts: at("2026-10-07"),
    text: `Has enviado un pago de 12,99 EUR a Tienda Ejemplo S.L.\nImporte: 12,99 EUR\nFecha: 07/10/2026\nID de la transacción: 8XY12345AB678901C`,
  },
  appstore: {
    message_id: "<m-apple-1@test>",
    subject: "Tu recibo de Apple",
    from_name: "Apple", from_address: "no_reply@email.apple.com", ts: at("2026-10-03"),
    text: `Recibo\nFecha del pedido: 03/10/2026\nSuscripción de Editor Fotos Ejemplo (mensual)\nSe renueva el 03/11/2026\nTOTAL 4,99 €\nPagado con tarjeta terminada en 4821`,
  },
  amazon: {
    message_id: "<m-amazon-1@test>",
    subject: "Tu pedido de Amazon.es: confirmación",
    from_name: "Amazon.es", from_address: "confirmar-pedido@amazon.es", ts: at("2026-10-08"),
    text: `Gracias por tu pedido.\nResumen del pedido\nArtículos: 49,90 €\nGastos de envío: 4,30 €\nTotal del pedido: 54,20 €\nPedido nº 123-4567890-1234567`,
  },
  amazonShipped: {
    message_id: "<m-amazon-2@test>",
    subject: "Tu pedido ha sido enviado",
    from_name: "Amazon.es", from_address: "shipment-tracking@amazon.es", ts: at("2026-10-10"),
    text: `Tu paquete está en camino.\nTotal del pedido: 54,20 €\nEntrega estimada: 12 de octubre`,
  },
  utility: {
    message_id: "<m-utility-1@test>",
    subject: "Tu factura de septiembre ya está disponible",
    from_name: "Iberdrola Clientes", from_address: "facturas@iberdrola.es", ts: at("2026-10-02"),
    text: `Ya puedes consultar tu factura.\nPeriodo: 01/09/2026 - 30/09/2026\nImporte total: 62,40 €\nImporte a cargar el 05/10/2026 en tu cuenta terminada en 4821.`,
  },
  bankCard: {
    message_id: "<m-bank-1@test>",
    subject: "Aviso de compra con tu tarjeta",
    from_name: "Banco Ejemplo", from_address: "avisos@bancoejemplo.test", ts: at("2026-10-12"),
    text: `Compra con tu tarjeta terminada en 4821 por importe de 23,40 EUR en FARMACIA EJEMPLO el 12/10/2026 18:32.`,
  },
  refund: {
    message_id: "<m-refund-1@test>",
    subject: "Reembolso de tu pedido",
    from_name: "Tienda Ejemplo", from_address: "pedidos@tiendaejemplo.test", ts: at("2026-10-14"),
    text: `Hemos procesado tu reembolso de 29,95 € a tu método de pago original.\nPedido TE-558201`,
  },
  trial: {
    message_id: "<m-trial-1@test>",
    subject: "Tu prueba gratuita termina en 3 días",
    from_name: "Notion", from_address: "team@mail.notion.so", ts: at("2026-10-15"),
    text: `Tu prueba gratuita de Notion Plus termina en 3 días.\nDespués se te cobrará 9,00 € al mes.`,
  },
  failed: {
    message_id: "<m-failed-1@test>",
    subject: "No hemos podido procesar tu pago",
    from_name: "Netflix", from_address: "info@mailer.netflix.com", ts: at("2026-10-16"),
    text: `Hemos intentado cobrar 12,99 € pero tu tarjeta ha sido rechazada. Actualiza tu método de pago.`,
  },
  renewal: {
    message_id: "<m-renewal-1@test>",
    subject: "Tu suscripción se renovará el 12/10",
    from_name: "Dropbox", from_address: "no-reply@dropbox.com", ts: at("2026-10-05"),
    text: `Tu plan Plus (anual) se renovará el 12/10/2026 por 119,88 €.\nNo necesitas hacer nada.`,
  },
  cancel: {
    message_id: "<m-cancel-1@test>",
    subject: "Tu suscripción ha sido cancelada",
    from_name: "Crunchyroll", from_address: "noreply@crunchyroll.com", ts: at("2026-10-17"),
    text: `Hemos cancelado tu suscripción de Crunchyroll. Seguirás teniendo acceso hasta el 30/10/2026.`,
  },
  newsletter: {
    message_id: "<m-news-1@test>",
    subject: "Novedades de la semana: auriculares desde 29,99 €",
    from_name: "Tienda Ejemplo", from_address: "news@tiendaejemplo.test", ts: at("2026-10-09"),
    text: `Descubre nuestras ofertas: 20% de descuento en auriculares.\nTeclado 49,90 €\nRatón 19,95 €\nMonitor 129,00 €\nSolo hoy. Para darte de baja pulsa aquí.`,
  },
  own: {
    message_id: "<m-own-1@test>",
    subject: "Recibo de la comunidad",
    from_name: "Yo", from_address: "yo@example.test", ts: at("2026-10-11"),
    text: `Recibo de la comunidad: total 45,00 €`,
    from_self: true,
  },
  english: {
    message_id: "<m-english-1@test>",
    subject: "Your receipt from Example Cloud",
    from_name: "Example Cloud", from_address: "billing@examplecloud.test", ts: at("2026-10-06"),
    text: `Thanks for your payment.\nExample Cloud Pro – billed monthly\nAmount paid: $1,234.56\nPaid on October 6, 2026\nInvoice #EC-2026-0042`,
  },
};
