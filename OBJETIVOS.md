# Ledger's Hoard — siguientes pasos

- Cobros en otra divisa (USD) del correo: hoy esperan en revisión con «divisa distinta de la cuenta». Permitir apuntarlos con el importe en euros del extracto del banco cuando llegue (casado por fecha y comercio) en vez de pedirlo a mano.
- Recibos con el importe solo en el PDF adjunto (facturas simplificadas): leer el adjunto a través de la pasarela de correo del hub cuando la ofrezca.
- Comparación con meses anteriores también en Informes (gráfico por categoría a 12 meses) y en `summary` del copiloto.
- Presupuestos: arrastrar a otro mes lo que sobró (opcional por categoría).
- Patrones de número de pedido locales de `server/mail-parse.js` (`LOCAL_ORDER_REFS`): subirlos a la tabla común de comercios de Hoard Link para que los usen las demás apps.
