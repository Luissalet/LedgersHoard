# Ledger's Hoard

Libro de cuentas doméstico local: cuentas, movimientos con categoría, presupuestos, informes, importación de extractos, pagos leídos del correo, gastos compartidos y previsión a fin de mes, guardado en un único archivo SQLite en tu propio ordenador.

English version: [`README.md`](README.md).

## Qué es

Ledger's Hoard es una pequeña aplicación web (Express + React) que guarda el dinero de casa en una base SQLite local. Todo se almacena en céntimos enteros, nada sale de la máquina y los mismos datos se ofrecen a un asistente por MCP, de modo que puedes usar la interfaz, pedírselo a Faustus o ambas cosas.

Es una app de la familia Hoard y funciona sola. Cuando el hub de la familia o Faustus están en marcha, además lee el correo de pagos, envía avisos de cobro, te notifica y aparece en la agenda familiar. La interfaz está en español.

## Qué hace

**Movimientos y cuentas**
- Cuentas (efectivo, banco, tarjeta, ahorro, otra) con su moneda y saldo inicial; se archivan en lugar de borrarse si tienen movimientos.
- Categorías de gasto e ingreso con categoría padre opcional, color y presupuesto mensual editable; la primera vez se crea un conjunto por defecto en español.
- Tabla de movimientos con filtros (fechas, cuenta, categoría, texto libre, etiqueta parcial), fila de alta rápida, edición en línea, borrado con confirmación, editor de etiquetas, «Crear parecido» y carga progresiva con totales por moneda.
- Transferencias entre cuentas (dos movimientos enlazados): cambian saldos, pero quedan fuera de ingresos, gastos y presupuestos.
- Búsqueda de un pago por importe exacto a menos de cinco días de una fecha, para comprobar si una factura se pagó.
- Documentos de otras apps adjuntos a un movimiento (referencias `hoard://app/tipo/id` como chips que se abren en la app propietaria).

**Importación**
- CSV del banco: se detectan separador, cabecera, formatos de fecha, coma decimal y columnas separadas de cargo/abono; el mapeo se puede corregir, la vista previa muestra duplicados y repetir una importación es seguro.
- Extractos OFX/QFX.
- Una fila del banco que coincide con un movimiento ya registrado desde el correo o a mano se une a él en lugar de crear un segundo movimiento.

**Informes y previsión**
- Resumen: selector de mes, tarjetas de ingresos / gastos / neto / saldo, barras de presupuesto por categoría, saldos de cuentas, lo que registró el correo este mes y el saldo previsto a fin de mes con sus líneas.
- Comparación del mes con el anterior y con la media de los tres anteriores, total y por categoría.
- Informes: ingresos frente a gastos de 12 meses, gasto por categoría, informe anual por mes y categoría, y detección de cargos recurrentes.
- «Cargos fuera de lo normal»: un cargo repetido en pocos días, un pico frente a la mediana del comercio, un cargo extra de un comercio mensual, un primer cargo grande. Son señales para revisar, no prueba de fraude.
- Previsión: escenarios con nombre y supuestos únicos, mensuales o trimestrales, comparados con los saldos registrados durante 3-24 meses, o entre sí.
- Avisos de presupuesto y de renovación, aviso de cargo tras cancelar y comprobación diaria de facturas vencidas.

**Correo**
- Lee la cuenta de correo conectada a Faustus (o la pasarela de correo del hub) y registra recibos, avisos de tarjeta, facturas, pedidos de tiendas y devoluciones como gastos en la fecha del cargo, con comercio, importe, número de pedido y confianza.
- El correo de baja confianza va a una cola de revisión (aceptar, ignorar, deshacer) con los posibles duplicados señalados; el mismo mensaje o pedido nunca se registra dos veces.
- Pegado de un recibo que no está en la bandeja.
- El texto del correo se trata como dato no fiable y solo se guarda un fragmento corto.

**Suscripciones**
- Detectadas en el correo o en cargos repetidos, con coste mensual y anual por moneda, historial de precios, próximo cargo, fin de prueba, cancelar / pausar y cargos próximos.

**Gastos compartidos**
- Reparte un gasto que has pagado entre personas (por partes, importe o a partes iguales); saldo por persona y devoluciones, aplicadas primero a la parte abierta más antigua.

**Cobros (facturas que emites)**
- Facturas con cliente, concepto, importe, vencimiento, referencia e instrucciones de pago.
- Escalera de avisos: recordatorio sencillo el día 1, uno más firme el día 7 y notificación interna el día 14. Los borradores son editables y se envían por el servicio de correo de la familia cuando lo pides; el envío automático está desactivado por defecto.
- Los pagos del libro que parecen una factura pendiente se proponen para que los aceptes o descartes.

**Ingresos por ventas**
- Registra el ingreso de un lote de ventas de la app de ventas de la familia, un movimiento por moneda y día, de forma idempotente.

## Cómo se ejecuta

Requiere Node.js 22.13 o posterior (usa `node:sqlite` integrado). Sin módulos nativos ni Docker.

```sh
npm install
npm run build
npm start          # http://127.0.0.1:5180
```

`npm run open` arranca el servidor y abre el navegador en Windows. `npm run dev` ejecuta la API y Vite a la vez. El servidor escucha solo en `127.0.0.1`; si el puerto está ocupado toma el siguiente libre, salvo con `PORT_STRICT=1`.

| Variable | Para qué sirve |
| --- | --- |
| `LEDGER_PORT` / `PORT` | Puerto preferido (por defecto `5180`). |
| `PORT_STRICT=1` | No pasar a otro puerto. |
| `LEDGER_DATA_DIR` | Carpeta de datos (por defecto `./data`, ignorada por git). |
| `LEDGER_ALLOWED_HOSTS` | Nombres de host extra aceptados tras un túnel, separados por comas, exactos o `*.sufijo`. |
| `LEDGER_FAUSTUS_DIR` / `FAUSTUS_DIR` | Carpeta de Faustus usada para leer el correo (también en Ajustes). |
| `LEDGER_MAIL_SCHEDULER=0` | No arrancar el lector de correo en segundo plano. |
| `LEDGER_ALERTS=0` | Desactivar la comprobación horaria de avisos. |
| `LEDGER_URL`, `LEDGER_TOKEN_FILE` / `LEDGER_TOKEN` | Puente MCP: URL de la app y ubicación del token. |
| `HOARD_FAUSTUS_URL` | Dirección de Faustus para el copiloto (por defecto `http://127.0.0.1:7000`). |
| `HOARD_COPILOT=0` | Desactivar el botón y las rutas del copiloto de Faustus. |

Tras un túnel privado, indica los nombres de host en `LEDGER_ALLOWED_HOSTS`; el navegador ofrecerá entonces instalar la app como PWA.

## Conectar un asistente (MCP)

`server/mcp.js` es un servidor MCP por stdio que reenvía cada llamada a la app en marcha, de modo que solo un proceso abre la base de datos. Mantén la app abierta mientras trabaje el asistente.

```json
{
  "command": "node",
  "args": ["C:/ruta/a/ledgers-hoard/server/mcp.js"],
  "env": { "LEDGER_URL": "http://127.0.0.1:5180", "LEDGER_TOKEN_FILE": "C:/ruta/a/ledgers-hoard/data/mcp-token" }
}
```

`faustus-plugin.json` describe la app para Faustus (comprobación de salud, pista de arranque, comando MCP). Las herramientas, unas sesenta, se agrupan así:

| Área | Herramientas |
| --- | --- |
| Cuentas y categorías | `list_accounts`, `upsert_account`, `list_categories`, `upsert_category`, `set_budget` |
| Movimientos | `add_entry`, `list_entries`, `search_entries`, `update_entry`, `delete_entry`, `transfer`, `balance`, `tx_find`, `tx_attach_doc` |
| Informes | `summary`, `budget_status`, `months_report`, `report_year`, `month_compare`, `recurring_candidates`, `spending_anomalies`, `mail_spending` |
| Previsión | `forecast_month`, `list_scenarios`, `get_scenario`, `create_scenario`, `add_scenario_line`, `update_scenario_line`, `delete_scenario_line`, `cash_forecast`, `compare_cash_forecasts` |
| Importación CSV | `import_csv_preview`, `import_csv_commit` |
| Correo | `mail_status`, `mail_scan`, `mail_review`, `mail_accept`, `mail_ignore`, `mail_undo`, `mail_paste`, `mail_reset` |
| Suscripciones y avisos | `subscriptions_list`, `subscription_update`, `subscriptions_upcoming`, `subscription_delete`, `alert_settings`, `ledger_notifications` |
| Gastos compartidos | `split_add`, `splits_balance`, `split_settle` |
| Facturas emitidas | `receivables_list`, `receivable_add`, `receivable_update`, `receivables_check`, `receivable_drafts`, `receivable_send`, `receivable_mark_paid` |
| Ventas | `income_from_sales` |

Los nombres de cuenta y categoría se resuelven de forma aproximada y sin acentos; si son ambiguos se devuelven candidatos para que el asistente pregunte. Las herramientas destructivas exigen `confirm: true`. El catálogo también se sirve en `GET /api/agent/tools`.

## Conexión con Faustus y la familia Hoard

- **Copiloto**: cada página tiene un botón flotante de Faustus que abre el asistente en un panel lateral. La conversación vive en Faustus; esta app la retransmite e informa al asistente de la página, el mes, los filtros y el formulario abierto. Cuando el asistente termina un turno, la página recarga sus datos en el sitio sin perder lo que habías escrito.
- **App Dock**: abierta junto a un chat de Faustus, la página registra `ledger_open`, `ledger_filter` y `ledger_view` para que el asistente abra registros, aplique filtros y cambie de sección.
- **Hub**: pasarela de correo, notificaciones (horas de silencio, móvil), agenda de contactos para los gastos compartidos y la agenda familiar (`GET /api/family/agenda`: renovaciones, fin de pruebas, cargos esperados, deudas compartidas antiguas).
- **Skills**: `faustus-plugin.json` nombra la skill familiar `household-ledger-month-close`.

Todo esto es opcional: sin el hub o sin Faustus, las funciones locales siguen funcionando y las que necesitan otra app lo dicen.

## Datos y seguridad

- `data/ledgers-hoard.db`: SQLite en modo WAL con migraciones versionadas. `data/mcp-token`: token aleatorio que se escribe en cada arranque y nunca se sube a git.
- Solo se aceptan peticiones de hosts y orígenes `localhost` / `127.0.0.1` (más los de `LEDGER_ALLOWED_HOSTS`); las peticiones entre sitios se rechazan.
- El servidor no habla con nada fuera de la máquina; solo el proceso auxiliar de correo habla con un servidor de correo.
- Los importes como `12,50`, `1.234,56` o `1,234.56` los interpreta `shared/money.js`, común a la interfaz, la API y las herramientas.

## Estructura del proyecto

| Ruta | Contenido |
| --- | --- |
| `server/` | API Express, acceso a SQLite, motor y analizador de correo, planificador, cobros, informes, previsión, puente MCP, cliente de la familia |
| `server/hoard-commons/`, `server/hoard-link.js` | Código común de la familia Hoard incluido tal cual (dinero, fechas, guardia, puente MCP); no se edita aquí |
| `client/` | React 19 + Vite + Tailwind v4 (Resumen, Movimientos, Cuentas, Categorías, Importar, Informes, Compartidos, Previsión, Correo, Suscripciones, Cobros, Ajustes) |
| `shared/` | Código común a servidor y cliente (`money.js`) |
| `scripts/` | `launch.mjs`, `dev.mjs` |
| `tests/` | Suites de `node:test` |

```sh
npm test         # node --test tests/*.test.js
npm run build    # vite build -> dist/
```

Las pruebas usan carpetas de datos temporales y nunca tocan `data/`.

Licencia: MIT (véase `LICENSE`).
