---
name: Ledger's Hoard
description: Un libro de cuentas doméstico, sobrio y rápido, para apuntar y entender el dinero de casa.
colors:
  accent: "#8a5a19"
  accent-hover: "#6f4713"
  ink: "#33291b"
  muted: "#6f6556"
  paper: "#fcfaf5"
  white: "#ffffff"
  line: "#e8e1d3"
  soft: "#f3ede1"
  sidebar: "#f5f0e5"
  nav-active: "#ecdfc6"
  nav-active-ink: "#5c3c0f"
  nav-hover: "#f0e8d8"
  field-line: "#d9cfbb"
  field-ink: "#3d2f18"
  placeholder: "#857a68"
  supporting-ink: "#6c6151"
  focus: "#a3702a"
  button-line: "#ddd4c2"
  panel: "#f6f1e6"
  income-bg: "#e6efe3"
  income-ink: "#2f5f3a"
  expense-ink: "#7a3d2a"
  warn-bg: "#f8ecd2"
  warn-ink: "#7a5a17"
  danger-bg: "#fbeceb"
  danger-ink: "#8a3a2c"
  danger-line: "#e8c8c2"
  bar-bg: "#ece4d3"
  chart-income: "#2a6f9e"
  chart-expense: "#b3762a"
typography:
  headline:
    fontFamily: "Segoe UI, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Segoe UI, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    lineHeight: 1.65
  button:
    fontFamily: "Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: "18px"
  label:
    fontFamily: "Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
  figure:
    fontFamily: "Segoe UI, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    fontVariantNumeric: "tabular-nums"
  code:
    fontFamily: "Consolas, monospace"
    fontSize: "12px"
    lineHeight: 1.8
rounded:
  badge: "5px"
  field: "6px"
  control: "7px"
  panel: "8px"
  dialog: "12px"
spacing:
  control-gap: "8px"
  action-gap: "10px"
  section-gap: "16px"
  panel-padding: "20px"
  page-gutter: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.white}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "8px 15px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    borderColor: "{colors.button-line}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "8px 15px"
  button-danger:
    backgroundColor: "{colors.danger-bg}"
    textColor: "{colors.danger-ink}"
    borderColor: "{colors.danger-line}"
    rounded: "{rounded.control}"
  field:
    backgroundColor: "{colors.white}"
    textColor: "{colors.field-ink}"
    borderColor: "{colors.field-line}"
    rounded: "{rounded.field}"
    padding: "8px 11px"
    width: "100%"
  nav-active:
    backgroundColor: "{colors.nav-active}"
    textColor: "{colors.nav-active-ink}"
    rounded: "{rounded.control}"
    padding: "10px 13px"
  chip:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.supporting-ink}"
    rounded: "{rounded.badge}"
    padding: "2px 6px"
  tile:
    backgroundColor: "{colors.panel}"
    borderColor: "{colors.line}"
    rounded: "{rounded.panel}"
    padding: "20px"
  budget-bar:
    backgroundColor: "{colors.bar-bg}"
    fillColor: "{colors.accent}"
    overColor: "{colors.danger-ink}"
    height: "8px"
---

# Design System: Ledger's Hoard

## Overview

**Creative North Star: "Libro de cuentas"**

Un cuaderno de contabilidad doméstica: papel cálido, tinta oscura, cifras tabulares alineadas a la derecha y una única tinta de acento, ámbar/ocre, para las acciones. Nada compite con los números. La interfaz está en español de España y cada cifra se presenta como la escribiría una persona: `1.234,56 €`.

La dirección estética se hereda de la familia Hoard (papel, paneles de 8px, Segoe UI) y cambia el acento verde bosque por un ámbar tostado (`#8a5a19`), que sobre papel tiene contraste 6,3:1 y sirve tanto para botones como para texto de enlace.

**Key Characteristics:**

- Superficies claras y planas separadas por líneas; ningún panel flota.
- Cifras con `font-variant-numeric: tabular-nums`, alineadas a la derecha en tablas.
- Ingresos y gastos se distinguen por texto y signo, con color de apoyo (verde apagado / arcilla).
- Cada escritura es inmediata: la fila rápida guarda con Enter; presupuestos y nombres se guardan al salir del campo.

## Colors

El ámbar organiza las acciones; los neutros de papel y arena sostienen la lectura de columnas de cifras.

### Primary

- **Ámbar:** `accent` en botones primarios, enlaces, relleno de barras de presupuesto y foco de escritura. `accent-hover` lo oscurece al pasar el puntero.
- **Arena de selección:** `nav-active` / `nav-active-ink` marcan la página activa; `soft` es la fila de alta rápida y el hover de filas.

### Neutral

- **Papel:** `paper` es la página; `white` los paneles de contenido y los campos; `panel` los tiles de resumen y los formularios de alta; `sidebar` el índice.
- **Tinta:** `ink` para títulos y cifras; `muted` para descripciones; `supporting-ink` para cabeceras de tabla, ayudas y ejes.
- **Líneas:** `line` separa filas y paneles; `field-line` y `button-line` bordean controles.

### Semantic

- **Ingreso:** `income-ink` sobre texto (`+1.850,00 €`) y `income-bg` en chips «Nueva».
- **Gasto:** `expense-ink` sobre texto (`-12,50 €`). No hay fondo de gasto: el signo ya lo dice.
- **Presupuesto superado:** la barra pasa a `danger-ink` y la fila lleva el chip «Superado» en `danger-bg`/`danger-ink`. El color nunca va solo.
- **Aviso:** `warn-bg`/`warn-ink` para chips «Duplicada».
- **Gráficos:** `chart-income` (azul) y `chart-expense` (ámbar) son la única pareja de series; se validó para deficiencias de visión del color (ΔE ≥ 15 en protan/deutan/tritan) y siempre va con leyenda y tabla alternativa. Los colores de categoría los elige el usuario y se muestran junto a su nombre.

**The Cifra legible Rule.** Cada importe se lee sin depender del color: signo, símbolo y etiqueta escrita.

## Typography

**Body Font:** Segoe UI con `system-ui` y `sans-serif` de respaldo; Georgia solo en la marca «L»; Consolas para rutas y variables en Ajustes.

- **Headline:** título de página (30px; 26px en móvil).
- **Title:** título de panel (17px).
- **Figure:** tiles de resumen (22px, tabular).
- **Body:** 14px; descripciones y tablas 13px; ayudas 12px; chips 10px.
- **Label:** etiqueta visible encima de cada campo (12px, seminegrita). Los placeholders muestran ejemplos («-12,50»), nunca sustituyen a la etiqueta.

## Layout

Escritorio: rejilla `224px | 1fr`; índice pegado arriba a `100dvh`; contenido centrado con máximo `1200px` y márgenes `32px`. Los paneles se apilan con `16px`.

- **Resumen:** cuatro tiles (`grid-cols-4`), luego `3fr | 2fr` con presupuestos y últimos movimientos a la izquierda y saldos a la derecha.
- **Movimientos:** filtros en una fila; tabla con `table-layout: fixed`, fila de alta rápida en `soft` y edición en línea que sustituye la fila.
- **Categorías:** formulario de alta y dos paneles (`Gastos`, `Ingresos`) con presupuesto editable al pulsar.
- **Importar:** tres pasos en paneles apilados: archivo, mapeo con vista previa, resultado.
- **Informes:** barras agrupadas en SVG (12 meses) con leyenda y «Ver tabla»; donut por categoría con lista.

Hasta `768px` el índice pasa a barra superior desplazable, los tiles a dos columnas, los filtros a dos columnas y la fila rápida a un formulario apilado de dos columnas; las tablas conservan desplazamiento horizontal dentro de su panel. Hasta `1024px` se oculta la columna Nota.

## Elevation & Depth

Plano por defecto. Sombra únicamente en el diálogo de confirmación (`0 24px 70px #2a1c0a26`, velo `#2a1c0a55`), en el aviso flotante (`0 8px 28px #2a1c0a2a`) y en el tooltip del gráfico.

**The Profundidad funcional Rule.** Una sombra significa «esto está encima de la página».

## Shapes

Campos `6px`, botones y navegación `7px`, paneles `8px`, diálogo `12px`, chips `5px`. Barras de presupuesto de `8px` de alto con extremos redondeados; marcas de gráfico con `rx=2`. Los iconos son trazos SVG de 1,8px. No hay imágenes raster.

## Components

### Buttons

Primario ámbar con tinta blanca, secundario blanco con borde, destructivo sobre `danger-bg`. Altura mínima `38px` (`30px` en la variante `btn-sm` de tablas). Deshabilitado a opacidad 0,45. Las acciones de texto (`btn-link`) se subrayan al pasar el puntero.

### Inputs / Fields

Etiqueta encima, ayuda debajo, ancho completo. Foco con contorno `2px` en `focus` y separación `3px`. Los importes usan `inputmode="decimal"` y aceptan coma o punto. Las fechas usan el control nativo.

### Quick-add row

Primera fila de la tabla de movimientos sobre `soft`: fecha, importe, cuenta, categoría, concepto, nota y «Añadir». Enter en cualquier campo guarda; tras guardar se vacían importe, concepto y nota y se conservan fecha y cuenta. La misma fila sirve para editar en línea (Guardar / Cancelar, Escape cancela).

### Tables

Cabeceras en mayúsculas pequeñas (`11px`, `supporting-ink`), filas separadas por `line`, hover en `soft`, cifras a la derecha. Los conceptos largos se recortan con elipsis y conservan el texto completo en `title`.

### Budget bars

Nombre con muestra de color, cifra `gastado / presupuesto` y barra. Sin presupuesto se escribe «Sin presupuesto». Superado: barra en `danger-ink` y chip «Superado». La barra lleva `role="meter"` con el porcentaje en `aria-label`.

### Charts

SVG en línea, sin librería. Barras finas (`≤22px`) con separación de 2px entre series, ejes recesivos, leyenda siempre visible, tooltip al pasar el puntero y vista de tabla equivalente. Donut con top 8 + «Otras», lista con porcentaje y cifra.

### Feedback

Aviso centrado abajo (`role=status` o `alert`) con botón «Cerrar» y cierre automático a los 4 s. Borrados con `<dialog>` nativo y botón destructivo. Vacíos con borde discontinuo y una única acción («Crear cuenta», «Apuntar el primero»).

## Do's and Don'ts

### Do:

- **Do** formatear todo importe como `1.234,56 €` con cifras tabulares.
- **Do** escribir el estado (Superado, Duplicada, Traspaso) además de colorearlo.
- **Do** guardar inmediatamente en campos sueltos y usar formularios solo para altas.
- **Do** mantener las tablas legibles en móvil con desplazamiento dentro del panel.

### Don't:

- **Don't** añadir un segundo color de acento ni usar el rojo para gastos normales.
- **Don't** convertir filas en tarjetas flotantes ni añadir sombras decorativas.
- **Don't** mostrar cifras en coma flotante: siempre céntimos enteros convertidos al presentar.
- **Don't** depender solo del color en gráficos: leyenda, etiquetas y tabla alternativa siempre.
