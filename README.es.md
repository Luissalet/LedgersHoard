# Ledger's Hoard

Libro de cuentas doméstico local: cuentas, movimientos por categoría, presupuestos mensuales, informes e importación de extractos CSV del banco. Todo se guarda en un único archivo SQLite en vuestro ordenador y se expone a un asistente mediante MCP.

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

### Acceso desde el móvil (a través de un túnel)

El servidor escucha en 127.0.0.1 y solo responde a peticiones cuyo `Host` sea `localhost`, `127.0.0.1` o `[::1]`. Para entrar desde el móvil a través de un túnel que ponga la aplicación delante (una red privada, un proxy inverso), indicad los nombres de host adicionales en `LEDGER_ALLOWED_HOSTS`, separados por comas, exactos o `*.sufijo`: `LEDGER_ALLOWED_HOSTS=mi-pc.example,*.ts.net`. El puerto y las mayúsculas no importan, y el `Origin` de las llamadas a la API también tiene que corresponder a uno de esos hosts (con cualquier esquema o puerto). Las peticiones *fetch* desde otras webs se siguen rechazando; abrir la aplicación desde otra página (un enlace, un bookmarklet, el menú de compartir) es una navegación normal y funciona.

## Qué hace

- **Resumen** — selector de mes, tiles de ingresos / gastos / neto / saldo total, barras de presupuesto por categoría (superado en color de peligro y con el texto «Superado»), últimos movimientos y saldos por cuenta.
- **Movimientos** — tabla con filtros (fechas, cuenta, categoría, texto), fila de alta rápida arriba (Enter guarda, Escape cancela), edición en línea, borrado con confirmación y formulario de traspaso entre cuentas.
- **Cuentas** — efectivo, banco, tarjeta, ahorro u otra; divisa por cuenta; saldo inicial; se archivan en lugar de borrarse si tienen movimientos.
- **Categorías** — de gasto o de ingreso, con padre opcional, color y presupuesto mensual editable al pulsar. La primera vez se crea un juego por defecto (Comida, Casa, Transporte, Ocio, Salud, Suscripciones, Ropa, Regalos, Otros gastos; Nómina, Otros ingresos).
- **Importar** — pegad o elegid el CSV del banco. Se detectan separador (`;`, `,`, tabulador), cabecera, fechas (`DD/MM/YYYY`, `YYYY-MM-DD`, `DD-MM-YYYY`), coma decimal y columnas separadas de cargo/abono; el mapeo se corrige con desplegables; la vista previa enseña las 20 primeras filas y cuántas están duplicadas; al importar se informa de añadidas y omitidas.
- **Informes** — barras de ingresos frente a gastos de los últimos 12 meses y donut de gasto por categoría, en SVG y con vista de tabla.
- **Ajustes** — símbolo de moneda; carpeta de datos y versión solo de lectura.

Todos los importes se guardan en céntimos enteros. Entradas como `12,50`, `12.5`, `-3`, `1.234,56` o `1,234.56` las interpreta `shared/money.js` (`parseAmount`), común a la interfaz, la API y las herramientas.

Un traspaso son dos movimientos enlazados por `transfer_id`: cambian los saldos pero no cuentan como ingreso ni gasto ni en los presupuestos.

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

Herramientas (17):

| Herramienta | Uso |
| --- | --- |
| `list_accounts` | Cuentas con saldo actual. |
| `upsert_account` | Crear una cuenta o actualizar la que tenga el mismo nombre (sin distinguir mayúsculas ni acentos): tipo, divisa (EUR por defecto), saldo inicial como texto, archivada. |
| `list_categories` | Categorías con presupuesto, opcionalmente por tipo. |
| `add_entry` | Apuntar un movimiento: importe como texto, tipo `expense` / `income` / `auto`, cuenta y categoría por nombre (aproximado, sin acentos; si solo hay una cuenta se usa sola; la categoría solo se crea con `create_category: true`). Devuelve el movimiento guardado y la cuenta y categoría resueltas. |
| `list_entries` | Filtrar por fechas, cuenta, categoría, texto o etiqueta; máximo 200. |
| `search_entries` | Búsqueda libre en concepto, nota, etiquetas y categoría. |
| `summary` | Totales del mes, por categoría con presupuesto y por cuenta. |
| `budget_status` | Presupuesto frente a gasto por categoría con `over` y un veredicto en una línea. |
| `months_report` | Ingresos / gastos / neto por mes entre dos meses. |
| `balance` | Saldo de una cuenta (o de todas) a una fecha. |
| `update_entry` | Corregir un movimiento. |
| `delete_entry` | Borrar un movimiento (destructiva; borra las dos mitades de un traspaso). |
| `upsert_category` | Crear o actualizar una categoría por nombre. |
| `set_budget` | Poner o quitar un presupuesto mensual. |
| `import_csv_preview` | Analizar un CSV: columnas, mapeo propuesto, filas de muestra, duplicados. |
| `import_csv_commit` | Importar en una cuenta con deduplicación por hash (se puede repetir sin riesgo). |
| `transfer` | Mover dinero entre dos cuentas. |

Cada descripción termina con una línea `Sinónimos:` con las palabras que se usan en español. Si un nombre de cuenta o categoría es ambiguo, la herramienta devuelve `candidates` para que el asistente pregunte en vez de adivinar.

## Datos y límites

- `data/ledgers-hoard.db` — SQLite en modo WAL; migraciones en `server/db.js` (tabla `schema_version`).
- `data/mcp-token` — 32 bytes aleatorios escritos en cada arranque; nunca se sube al repositorio.
- Solo se aceptan peticiones desde `localhost` / `127.0.0.1`; las peticiones de otras webs se rechazan.
- CSV de hasta 10 MB; `list_entries` devuelve como máximo 200 filas por llamada en las herramientas y 500 en la interfaz.
- El servidor no hace ninguna llamada a internet.

## Verificación

```sh
npm test        # node --test tests/*.test.js — parser, CSV, informes, API HTTP, autenticación y herramientas del agente
npm run build   # vite build → dist/
```

Las pruebas usan carpetas temporales y nunca tocan `data/`.

Licencia: MIT (ver `LICENSE`).
