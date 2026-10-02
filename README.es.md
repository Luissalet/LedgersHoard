# Ledger's Hoard

Libro de cuentas doméstico local: cuentas, movimientos por categoría, presupuestos mensuales, informes, importación de extractos CSV del banco y pagos leídos del correo. Todo se guarda en un único archivo SQLite en vuestro ordenador y se expone a un asistente mediante MCP.

English version: [`README.md`](README.md).

## Abrir

Necesita Node.js 22.13 o posterior (usa el `node:sqlite` integrado). Sin módulos nativos ni Docker.

```sh
npm install
npm run build
npm start          # http://127.0.0.1:5180
```

`npm run open` arranca el servidor y abre el navegador en Windows. `npm run dev` ejecuta la API (`node --watch`) y Vite a la vez con el proxy de `/api` configurado solo.

El servidor escucha únicamente en `127.0.0.1`. Si el puerto 5180 está ocupado avanza al siguiente libre y muestra la dirección; con `PORT_STRICT=1` falla en lugar de cambiar.

### Variables de entorno

| Variable | Uso |
| --- | --- |
| `LEDGER_PORT` / `PORT` | Puerto preferido (por defecto `5180`). |
| `PORT_STRICT=1` | No buscar otro puerto. |
| `LEDGER_DATA_DIR` | Carpeta de datos (por defecto `<repo>/data`, ignorada por git). Contiene `ledgers-hoard.db` y `mcp-token`. |
| `LEDGER_ALLOWED_HOSTS` | Nombres de host adicionales aceptados detrás de un túnel (ver más abajo). |
| `LEDGER_URL` | Puente MCP: URL de la aplicación (por defecto `http://127.0.0.1:5180`). Debe ser local. |
| `LEDGER_TOKEN_FILE` / `LEDGER_TOKEN` | Puente MCP: de dónde leer el token (por defecto `<datos>/mcp-token`). |
| `LEDGER_FAUSTUS_DIR` / `FAUSTUS_DIR` | Carpeta de Faustus para leer el correo (también en Ajustes; si no, `../faustus` o `../../faustus`). Vale si existe `mcp_servers/email_server.py`. |
| `LEDGER_MAIL_SCHEDULER=0` | No arrancar la lectura de correo en segundo plano (siguen funcionando «Leer ahora» y las herramientas). |

### Acceso desde el móvil (a través de un túnel)

El servidor escucha en 127.0.0.1 y solo responde a peticiones cuyo `Host` sea `localhost`, `127.0.0.1` o `[::1]`. Para entrar desde el móvil a través de un túnel que ponga la aplicación delante (una red privada, un proxy inverso), indicad los nombres de host adicionales en `LEDGER_ALLOWED_HOSTS`, separados por comas, exactos o `*.sufijo`: `LEDGER_ALLOWED_HOSTS=mi-pc.example,*.ts.net`. El puerto y las mayúsculas no importan, y el `Origin` de las llamadas a la API también tiene que corresponder a uno de esos hosts (con cualquier esquema o puerto). Las peticiones *fetch* desde otras webs se siguen rechazando; abrir la aplicación desde otra página (un enlace, un bookmarklet, el menú de compartir) es una navegación normal y funciona.

Una vez abierta a través del túnel, el navegador ofrece instalarla (PWA).

## Qué hace

- **Resumen** — selector de mes, tiles de ingresos / gastos / neto / saldo total, barras de presupuesto por categoría (superado en color de peligro y con el texto «Superado»), últimos movimientos, saldos por cuenta y una línea «Del correo este mes» con lo que ha apuntado el correo y la tarjeta «Saldo previsto a fin de mes» (con partidas desplegables).
- **Movimientos** — tabla con filtros (fechas, cuenta, categoría, texto), fila de alta rápida arriba (Enter guarda, Escape cancela), edición en línea, borrado con confirmación y formulario de traspaso entre cuentas, etiquetas con los documentos adjuntos al movimiento (se abren en la app que los guarda) y botón «Repartir» en los gastos.
- **Compartidos** — quién te debe por gastos que pagaste y repartiste (botón Repartir en un movimiento): saldo por persona, los gastos que lo forman y «Apuntar devolución». Abre un movimiento desde `#/movimientos?tx=<id>`.
- **Cuentas** — efectivo, banco, tarjeta, ahorro u otra; divisa por cuenta; saldo inicial; se archivan en lugar de borrarse si tienen movimientos.
- **Categorías** — de gasto o de ingreso, con padre opcional, color y presupuesto mensual editable al pulsar. La primera vez se crea un juego por defecto (Comida, Casa, Transporte, Ocio, Salud, Suscripciones, Ropa, Regalos, Otros gastos; Nómina, Otros ingresos).
- **Importar** — pegad o elegid el CSV del banco. Se detectan separador (`;`, `,`, tabulador), cabecera, fechas (`DD/MM/YYYY`, `YYYY-MM-DD`, `DD-MM-YYYY`), coma decimal y columnas separadas de cargo/abono; el mapeo se corrige con desplegables; la vista previa enseña las 20 primeras filas y cuántas están duplicadas; al importar se informa de añadidas y omitidas.
- **Informes** — barras de ingresos frente a gastos de los últimos 12 meses y donut de gasto por categoría, en SVG y con vista de tabla.
- **Previsión** — escenarios guardados con ingresos y gastos hipotéticos puntuales, mensuales o trimestrales. Se pueden editar y comparar los saldos registrados y previstos de 3 a 24 meses. Los pagos periódicos detectados rellenan el formulario para revisarlos antes de añadirlos. Los supuestos no crean movimientos reales; las distintas divisas se muestran por separado.
- **Correo** — lee la cuenta de correo conectada a Faustus, encuentra pagos (recibos, «has pagado», avisos de tarjeta, facturas con «importe a cargar», pedidos con total, reembolsos) y los apunta como gastos en la fecha del cobro. Tarjeta de estado (cuenta leída, última y próxima lectura, último error, «Leer ahora», activar, apuntar solos, cuenta de los cobros, frecuencia, límite de importe en euros, avisos de Windows y de la familia), «Apuntado desde el correo» con Deshacer, «Por revisar» con Aceptar (comercio, importe, fecha, cuenta y categoría editables) e Ignorar, duplicados vistos, avisos recientes y un cuadro para pegar un recibo que no esté en el buzón.
- **Suscripciones** — las que aparecen en el correo (servicios conocidos, palabras de suscripción) o en cargos repetidos (`recurring.js`; nunca tiendas ni comida), con coste mensual y anual por divisa, historial de precio, próximo cobro, fin de prueba, Cancelada / Pausada / Editar, cobros de los próximos 30 días y los avisos generados.
- **Ajustes** — símbolo de moneda; carpeta y usuario de Faustus para el correo y «Reiniciar el correo» (empezar de cero); carpeta de datos y versión solo de lectura.

Todos los importes se guardan en céntimos enteros. Entradas como `12,50`, `12.5`, `-3`, `1.234,56` o `1,234.56` las interpreta `shared/money.js` (`parseAmount`), común a la interfaz, la API y las herramientas.

Un traspaso son dos movimientos enlazados por `transfer_id`: cambian los saldos pero no cuentan como ingreso ni gasto ni en los presupuestos.

## Correo: pagos y suscripciones

El correo se lee a través de Faustus: `server/mail/faustus_mail.py` se ejecuta con el Python de Faustus dentro de su carpeta y devuelve solo los mensajes que encajan con una búsqueda de pagos (`gmail_query` en Gmail, `subject_terms` en otros servidores IMAP). La contraseña nunca llega a esta aplicación. La primera lectura abarca `first_days` (62: este mes y el anterior); las siguientes, `window_days` (14). Una lectura se lanza 30 s después de arrancar y luego cada `interval_min` minutos, de una en una; se guardan las últimas 50.

El texto de los correos es dato no fiable. `server/mail-parse.js` solo lo analiza con patrones (ES/EN) y extrae tipo (`charge`, `refund`, `upcoming`, `cancel`, `failed`, `noise`), comercio, importe y divisa, fecha del cobro, periodo, próximo cobro, fin de prueba, número de pedido y las 4 últimas cifras de la tarjeta, con una confianza de 0 a 100. La búsqueda deja fuera las pestañas de promociones, social y foros de Gmail (`-category:promotions -category:social -category:forums`). Respuestas (`Re:`), peticiones de opinión («¿Qué tal tu pedido?», «Da tu opinión»), boletines y remitentes comerciales (`newsletter@`, `info-promo@`, hosts `deals.`), avisos de mensajería, correos de regalos o promociones y conversaciones con atención al cliente son ruido y nunca llegan a revisión. Mencionar un reembolso sin ningún importe no es un reembolso. Se leen las etiquetas seguidas de líneas en blanco y luego el valor («TOTAL», línea en blanco, «€ 24.03»; «Importe:», línea en blanco, «16.92 EUR»), `TOTAL` gana a `Subtotal` y una fecha de entrega («Llega el…») nunca es la del cobro. Un cobro o reembolso con comercio, importe y fecha y confianza ≥ `min_confidence` (70) se apunta solo como movimiento en céntimos negativos (`source = mail`, `source_ref = mail:<id>`, nota `«asunto» · correo`). La categoría es la más usada antes con ese concepto; si no, la pista del comercio conocido casada por nombre con una categoría existente (nunca se crean categorías solas); si no, ninguna. Los nombres de comercio quedan en la marca («Account Services», «(Customer Support)», `.es` y `no-reply` se quitan) y un cobro con comercio, importe y fecha más un indicio de pedido o recibo puntúa al menos 75. Los cobros por encima de `review_above` (500 € por defecto, 0 desactiva la comprobación; se cambia en Correo) esperan siempre en revisión con «importe alto (revísalo)». Lo demás va a **Por revisar** con el motivo (sin cuenta elegida, varias cuentas, divisa distinta, falta importe o fecha, poca confianza, pedido cancelado). Los avisos de renovación, pruebas, cancelaciones y pagos fallidos no son movimientos: actualizan la suscripción y generan un aviso.

Ajustes (`mail.*`, `notify.*` en la tabla de ajustes): `enabled`, `auto_record`, `account` (vacía y con una sola cuenta activa se usa esa; si no, los cobros van a revisión), `interval_min`, `first_days`, `window_days`, `min_confidence`, `review_above`, `toast`, `hub`, `faustus_dir`, `faustus_owner`.

### Cómo se evitan los duplicados

1. El mismo identificador de mensaje no se procesa dos veces.
2. Los números de pedido (Amazon 3-7-7, «número de pedido es N», `GS.xxxx-…`, «Pedido N», «order #…», «n.° N») se guardan en `order_ref`: un correo posterior del mismo comercio y pedido (estado, repetición, respuesta) no se apunta de nuevo, y si el primero sigue en revisión sin importe, el posterior lo completa. Los números cortos (menos de 7 caracteres, típicos de restaurantes) solo coinciden con un día de diferencia.
3. Un movimiento existente de cualquier origen (también de un CSV del banco) con el mismo importe con signo, fecha a menos de 3 días y concepto coincidente hace que el correo quede como `duplicate` enlazado a él.
4. Si el CSV del banco llega después de apuntar el correo, la fila del banco adopta el movimiento del correo en vez de crear otro: queda UN movimiento, mandan la fecha, el importe y la cuenta del banco, el correo sigue enlazado (`source_ref` y nota) y la vista previa y el resultado de la importación lo cuentan como `matched_mail` (no entra en `rows_new`).
5. `mail_undo` / **Deshacer** borra el movimiento que creó el correo (con confirmación) y deja el correo como `ignored`; se niega si una fila del banco ya lo adoptó.

Un correo que cancela un pedido ya apuntado («pedido cancelado») no es un aviso de suscripción: espera en revisión con «Quitar el movimiento» y «Dejarlo como está», y deshacer el pedido lo cierra. Las tiendas, la comida y los restaurantes (Amazon, apps de reparto, comercios) nunca son suscripciones por sí solos: solo lo hace una mención explícita de membresía («Amazon Prime»), los cargos repetidos no bastan y los enlaces del pie como «Cancelar suscripción» no cuentan. Las plataformas que cobran varios servicios (Google Play) generan una suscripción por producto, así que sus precios no se comparan entre sí.

### Avisos

Se guardan (últimos 200) y se ven en Correo y con `ledger_notifications`. Aviso de Windows mediante un `.ps1` temporal con BOM UTF-8 que PowerShell ejecuta oculto (solo win32; los de gravedad baja de una lectura se juntan en uno). Eventos del bus familiar (`family.emit`): `ledger.mail.recorded` {entry_id, merchant, amount, date}, `ledger.subscription.new`, `ledger.subscription.price`, `ledger.subscription.trial`, `ledger.payment.failed`, y además `ledger.subscription.upcoming` y `ledger.subscription.cancelled`. Gravedad: baja para apuntado o cancelada, media para suscripción nueva, cambio de precio o renovación anual a 7 días o menos, alta para pagos fallidos y pruebas que acaban en 3 días o menos. Cada aviso salta una sola vez (clave de deduplicación).

## Conectar un asistente (MCP)

`server/mcp.js` es un servidor MCP por stdio que reenvía cada llamada a la aplicación en marcha, de modo que solo un proceso abre la base de datos. Mantened la aplicación abierta mientras el asistente trabaja.

```json
{
  "command": "node",
  "args": ["C:/ruta/a/ledgers-hoard/server/mcp.js"],
  "env": { "LEDGER_URL": "http://127.0.0.1:5180", "LEDGER_TOKEN_FILE": "C:/ruta/a/ledgers-hoard/data/mcp-token" }
}
```

`faustus-plugin.json` describe la aplicación para Faustus (comprobación de salud, arranque y comando MCP con marcadores).

Herramientas (46):

| Herramienta | Uso |
| --- | --- |
| `list_accounts` | Cuentas con saldo actual. |
| `upsert_account` | Crear una cuenta o actualizar la que tenga el mismo nombre (sin distinguir mayúsculas ni acentos): tipo, divisa (EUR por defecto), saldo inicial como texto, archivada. |
| `list_categories` | Categorías con presupuesto, opcionalmente por tipo. |
| `add_entry` | Apuntar un movimiento: importe como texto, tipo `expense` / `income` / `auto`, cuenta y categoría por nombre (aproximado, sin acentos; si solo hay una cuenta se usa sola; la categoría solo se crea con `create_category: true`). Devuelve el movimiento guardado y la cuenta y categoría resueltas. |
| `list_entries` | Filtrar por fechas, cuenta, categoría, texto o etiqueta; máximo 200. |
| `search_entries` | Búsqueda libre en concepto, nota, etiquetas y categoría. |
| `summary` | Totales del mes, por categoría con presupuesto y por cuenta. |
| `budget_status` | Presupuesto frente a gasto por categoría (opcionalmente una `category` y un `month`) con `over`, `left`, `ok` y un veredicto en una línea. |
| `months_report` | Ingresos / gastos / neto por mes entre dos meses. |
| `balance` | Saldo de una cuenta (o de todas) a una fecha. |
| `update_entry` | Corregir un movimiento. |
| `delete_entry` | Borrar un movimiento (destructiva; borra las dos mitades de un traspaso). |
| `upsert_category` | Crear o actualizar una categoría por nombre. |
| `set_budget` | Poner o quitar un presupuesto mensual. |
| `import_csv_preview` | Analizar un CSV: columnas, mapeo propuesto, filas de muestra, duplicados. |
| `import_csv_commit` | Importar en una cuenta con deduplicación por hash (se puede repetir sin riesgo). |
| `transfer` | Mover dinero entre dos cuentas. |
| `mail_status` | Estado de la lectura del correo: cuenta leída vía Faustus, última lectura, errores, pendientes de revisar. |
| `mail_scan` | Leer el correo ahora (`since_days`, `query`) y apuntar pagos y suscripciones. |
| `mail_review` | Pagos pendientes de revisar y por qué. |
| `mail_accept` | Apuntar un pago de la cola, con `account`, `category`, `amount`, `date`, `merchant` opcionales. |
| `mail_ignore` | Marcar un correo como no-pago. |
| `mail_undo` | Borrar el movimiento que creó un correo e ignorarlo (`confirm: true`). |
| `mail_reset` | Empezar de cero con el correo: correos leídos, suscripciones creadas desde el correo, avisos e historial de lecturas (`confirm: true`; los movimientos solo con `delete_entries: true`, y entonces solo los que creó un correo y no adoptó el banco). Solo si el usuario lo pide. |
| `mail_paste` | Apuntar un recibo que no está en el buzón a partir de `subject`, `text`, `from`. |
| `subscriptions_list` | Suscripciones por `status` con totales mensual y anual. |
| `subscription_update` | Cambiar estado (cancelled / paused / active), importe, periodo, categoría, próximo cobro, notas. |
| `subscriptions_upcoming` | Cobros y fines de prueba de los próximos `days` (30). |
| `mail_spending` | Lo apuntado desde el correo en un `month`, por comercio y categoría, con enlaces a los movimientos. |
| `tx_find` | Buscar el movimiento de gasto que coincide con un importe y una fecha (el de una factura), con puntuación; 0,8 o más es coincidencia fuerte. |
| `tx_attach_doc` | Guardar en un movimiento la referencia `hoard://app/tipo/id` de un documento (idempotente); sale como etiqueta que abre el documento en su app. |
| `forecast_month` | Saldo previsto a fin de mes (hasta 12 meses por delante): saldo de hoy, suscripciones, recibos e ingresos que se repiten y la media de 3 meses para el resto del gasto. Cada partida dice de dónde sale. |
| `split_add` | Repartir un movimiento que pagaste entre personas (por parte, importe o a partes iguales contigo). Las personas se resuelven en la libreta de la familia y el nombre se guarda por si está apagada. |
| `splits_balance` | Quién debe qué: saldo por persona, fecha pendiente más antigua y gastos detrás. |
| `split_settle` | Apuntar una devolución; se aplica primero a las partes abiertas más antiguas y nunca más de lo debido. |
| `income_from_sales` | Apuntar el ingreso de un lote de ventas de Mercator, un movimiento por divisa y día, idempotente por lote y línea. |
| `report_year` | Totales de un año por mes y por categoría. |
| `ledger_notifications` | Avisos recientes: pagos apuntados, suscripciones nuevas, cambios de precio, pruebas, pagos fallidos. |

Cada descripción termina con una línea `Sinónimos:` con las palabras que se usan en español. Si un nombre de cuenta o categoría es ambiguo, la herramienta devuelve `candidates` para que el asistente pregunte en vez de adivinar.

## Familia

Ledger participa en el hub de la familia Hoard, siempre de forma opcional: con el hub apagado todo lo demás responde, con un error claro donde haga falta otra app.

- **Correo**: por defecto (`mail.source` = `auto`) se lee por la pasarela de correo del hub, que abre el buzón una sola vez para todas las apps; si no está encendida, se usa el ayudante de Faustus. `hub` nunca recurre al ayudante y `faustus` nunca pregunta al hub (se elige en Correo, donde también se ve «Leyendo de»). Cada pago apuntado se reclama en el hub (tipo `payment`, ref `hoard://ledger/tx/<id>`) para que otras apps no archiven el mismo correo. Se lee solo lo posterior a una marca (`mail.hub_since_id`).
- **Agenda**: `GET /api/family/agenda` (con el token de la app) da renovaciones, fines de prueba, cargos previstos (`Cargo previsto`) y deudas de gastos compartidos de más de 30 días.
- **Documentos**: un movimiento guarda referencias a documentos de otras apps; las etiquetas de Kafka enlazan a `#/movimientos?tx=<id>`, que muestra ese movimiento con un botón «Ver todos».
- **Gastos compartidos**: botón *Repartir* en un gasto de Movimientos y página **Compartidos** con saldos y devoluciones.
- **Previsión**: tarjeta en Resumen con el saldo previsto a fin de mes y sus partidas.
- **Eventos** en el bus del hub: `ledger.mail.recorded` {tx_id, entry_id, merchant, amount, amount_cents, currency, date, order_ref?, message_id, items}, `ledger.payment.failed`, `ledger.subscription.price` (con `old_amount`) y `ledger.subscription.new` (con `url`). `amount` es un número positivo en unidades (12,99); `amount_cents` es el valor con signo guardado.

Ajustes de correo nuevos: `source` (`auto` | `hub` | `faustus`).

## Datos y límites

- `data/ledgers-hoard.db` — SQLite en modo WAL; migraciones en `server/db.js` (tabla `schema_version`).
- `data/mcp-token` — 32 bytes aleatorios escritos en cada arranque; nunca se sube al repositorio.
- Solo se aceptan peticiones desde `localhost` / `127.0.0.1`; las peticiones de otras webs se rechazan.
- CSV de hasta 10 MB; `list_entries` devuelve como máximo 200 filas por llamada en las herramientas y 500 en la interfaz.
- El servidor no hace llamadas a internet por sí mismo. El correo se lee solo con el proceso auxiliar de Faustus, que es lo único que habla con el servidor de correo.
- Del texto de cada correo se guardan 300 caracteres como máximo, sin caracteres de control.

## Verificación

```sh
npm test        # node --test tests/*.test.js — parser, CSV, informes, API HTTP, autenticación y herramientas del agente
npm run build   # vite build → dist/
```

Las pruebas usan carpetas temporales y nunca tocan `data/`.

Los módulos de la familia están en `server/family*.js`, `mail-hub.js`, `tx-links.js`, `splits.js`, `sales.js`, `outlook.js` y `agenda.js`; las páginas, en `Compartidos.jsx` y la tarjeta de `Resumen.jsx`. Los módulos del correo están en `server/mail-*.js`, `server/subscriptions.js`, `server/notifications.js` y `server/mail/faustus_mail.py`; las páginas, en `client/src/pages/Correo.jsx` y `Suscripciones.jsx`.

Licencia: MIT (ver `LICENSE`).
