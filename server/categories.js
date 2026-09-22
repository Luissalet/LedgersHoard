import { z } from "zod";
import { db, uid, now, transaction } from "./db.js";

export const CATEGORY_KINDS = ["expense", "income"];

const categoryShape = {
  name: z.string().trim().min(1).max(80),
  kind: z.enum(CATEGORY_KINDS),
  parent_id: z.string().nullable(),
  monthly_budget: z.number().int().nonnegative().nullable(),
  color: z.string().trim().max(20).nullable(),
  archived: z.boolean(),
};
export const categoryInput = z.object({
  ...categoryShape,
  kind: categoryShape.kind.default("expense"),
  parent_id: categoryShape.parent_id.default(null),
  monthly_budget: categoryShape.monthly_budget.default(null),
  color: categoryShape.color.default(null),
  archived: categoryShape.archived.default(false),
});
// .partial() would keep the defaults above, so patches use the bare shape.
export const categoryPatch = z.object(categoryShape).partial();

// Default Spanish set, inserted only when the table is empty.
export const DEFAULT_CATEGORIES = [
  ["Comida", "expense", "#8a5a19"],
  ["Casa", "expense", "#6b5b3e"],
  ["Transporte", "expense", "#4f6d7a"],
  ["Ocio", "expense", "#7a4f6d"],
  ["Salud", "expense", "#3f7a5a"],
  ["Suscripciones", "expense", "#5a5f8a"],
  ["Ropa", "expense", "#8a4f4f"],
  ["Regalos", "expense", "#a5723b"],
  ["Otros gastos", "expense", "#7a7a7a"],
  ["Nómina", "income", "#2f7a4b"],
  ["Otros ingresos", "income", "#4b8a6a"],
];

const row = (r) => (r ? { ...r, archived: !!r.archived } : null);

export function seedCategories() {
  const count = db().prepare("SELECT COUNT(*) AS n FROM categories").get().n;
  if (count > 0) return 0;
  transaction(() => {
    for (const [name, kind, color] of DEFAULT_CATEGORIES) createCategory({ name, kind, color });
  });
  return DEFAULT_CATEGORIES.length;
}

export function listCategories({ includeArchived = true } = {}) {
  const sql = includeArchived
    ? "SELECT * FROM categories ORDER BY kind, archived, name COLLATE NOCASE"
    : "SELECT * FROM categories WHERE archived = 0 ORDER BY kind, name COLLATE NOCASE";
  return db().prepare(sql).all().map(row);
}

export function getCategory(id) {
  return row(db().prepare("SELECT * FROM categories WHERE id = ?").get(id));
}

export function findCategoryByName(name) {
  return row(db().prepare("SELECT * FROM categories WHERE name = ? COLLATE NOCASE").get(String(name).trim()));
}

const fold = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/**
 * Fuzzy resolution: id, exact name, accent-insensitive equality, then a
 * unique prefix/substring match among active categories. Returns
 * { category, candidates } so callers can ask when it is ambiguous.
 */
export function resolveCategory(ref, kind = null) {
  if (!ref) return { category: null, candidates: [] };
  const text = String(ref).trim();
  const byId = getCategory(text);
  if (byId) return { category: byId, candidates: [] };
  const exact = findCategoryByName(text);
  if (exact) return { category: exact, candidates: [] };
  const needle = fold(text);
  const pool = listCategories({ includeArchived: false }).filter((c) => !kind || c.kind === kind);
  const folded = pool.filter((c) => fold(c.name) === needle);
  if (folded.length === 1) return { category: folded[0], candidates: [] };
  const starts = pool.filter((c) => fold(c.name).startsWith(needle));
  if (starts.length === 1) return { category: starts[0], candidates: [] };
  const contains = pool.filter((c) => fold(c.name).includes(needle) || needle.includes(fold(c.name)));
  if (contains.length === 1) return { category: contains[0], candidates: [] };
  return { category: null, candidates: (starts.length ? starts : contains).map((c) => c.name) };
}

export function createCategory(input) {
  const data = categoryInput.parse(input);
  if (findCategoryByName(data.name)) throw Object.assign(new Error("Ya existe una categoría con ese nombre."), { status: 409 });
  if (data.parent_id && !getCategory(data.parent_id)) throw Object.assign(new Error("La categoría padre no existe."), { status: 400 });
  const id = uid();
  db().prepare(
    "INSERT INTO categories (id, name, kind, parent_id, monthly_budget, color, archived, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, data.name, data.kind, data.parent_id, data.monthly_budget, data.color, data.archived ? 1 : 0, now());
  return getCategory(id);
}

export function updateCategory(id, patch) {
  const current = getCategory(id);
  if (!current) return null;
  const data = categoryPatch.parse(patch);
  if (data.name) {
    const clash = findCategoryByName(data.name);
    if (clash && clash.id !== id) throw Object.assign(new Error("Ya existe una categoría con ese nombre."), { status: 409 });
  }
  if (data.parent_id === id) throw Object.assign(new Error("Una categoría no puede ser su propio padre."), { status: 400 });
  if (data.parent_id && !getCategory(data.parent_id)) throw Object.assign(new Error("La categoría padre no existe."), { status: 400 });
  const next = { ...current, ...data };
  db().prepare(
    "UPDATE categories SET name = ?, kind = ?, parent_id = ?, monthly_budget = ?, color = ?, archived = ? WHERE id = ?",
  ).run(next.name, next.kind, next.parent_id, next.monthly_budget, next.color, next.archived ? 1 : 0, id);
  return getCategory(id);
}

export function deleteCategory(id) {
  const used = db().prepare("SELECT COUNT(*) AS n FROM entries WHERE category_id = ?").get(id).n;
  if (used > 0) throw Object.assign(new Error("La categoría tiene movimientos; archívala en lugar de borrarla."), { status: 409 });
  return db().prepare("DELETE FROM categories WHERE id = ?").run(id).changes > 0;
}
