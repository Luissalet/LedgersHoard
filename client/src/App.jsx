import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./api.js";
import { Toast } from "./components/ui.jsx";
import Resumen from "./pages/Resumen.jsx";
import Movimientos from "./pages/Movimientos.jsx";
import Cuentas from "./pages/Cuentas.jsx";
import Categorias from "./pages/Categorias.jsx";
import Importar from "./pages/Importar.jsx";
import Informes from "./pages/Informes.jsx";
import Ajustes from "./pages/Ajustes.jsx";

const PAGES = [
  { path: "resumen", label: "Resumen", icon: "M3 12h18M3 6h18M3 18h12", component: Resumen },
  { path: "movimientos", label: "Movimientos", icon: "M4 7h16M4 12h16M4 17h10", component: Movimientos },
  { path: "cuentas", label: "Cuentas", icon: "M3 7h18v12H3zM3 11h18", component: Cuentas },
  { path: "categorias", label: "Categorías", icon: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z", component: Categorias },
  { path: "importar", label: "Importar", icon: "M12 4v12m0 0l-4-4m4 4l4-4M4 20h16", component: Importar },
  { path: "informes", label: "Informes", icon: "M4 20V10m5 10V4m5 16v-8m5 8V7", component: Informes },
  { path: "ajustes", label: "Ajustes", icon: "M12 8a4 4 0 100 8 4 4 0 000-8zM4 12h2m12 0h2M12 4v2m0 12v2", component: Ajustes },
];

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

function useHashRoute() {
  const read = () => (window.location.hash.replace(/^#\/?/, "").split("/")[0] || "resumen");
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

function Icon({ d }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export default function App() {
  const route = useHashRoute();
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setState(await api.state());
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const notify = useCallback((message) => setToast(message), []);
  const value = useMemo(() => ({ ...(state || {}), ready: !!state, refresh, notify }), [state, refresh, notify]);

  const page = PAGES.find((p) => p.path === route) || PAGES[0];
  const Component = page.component;

  return (
    <AppContext.Provider value={value}>
      <div className="min-h-dvh md:grid md:grid-cols-[224px_minmax(0,1fr)]">
        <aside className="sticky top-0 z-10 border-b md:h-dvh md:border-b-0 md:border-r" style={{ background: "var(--sidebar)", borderColor: "var(--line)" }}>
          <div className="flex items-center gap-2 px-4 py-3 md:px-5 md:py-5">
            <span className="grid h-8 w-8 place-items-center rounded-md text-[15px] font-bold text-white" style={{ background: "var(--accent)", fontFamily: "Georgia, serif" }}>L</span>
            <div className="leading-tight">
              <div className="text-[15px] font-semibold">Ledger's Hoard</div>
              <div className="help text-[11px]">Cuentas de casa</div>
            </div>
          </div>
          <nav aria-label="Secciones" className="flex gap-1 overflow-x-auto px-3 pb-2 md:flex-col md:px-3">
            {PAGES.map((p) => (
              <a key={p.path} href={`#/${p.path}`} className="nav-link shrink-0 text-[13px]" aria-current={p.path === page.path ? "page" : undefined}>
                <Icon d={p.icon} />
                {p.label}
              </a>
            ))}
          </nav>
        </aside>
        <main className="min-w-0">
          {error && (
            <div className="m-4 rounded-md border p-4 text-[13px]" style={{ background: "var(--danger-bg)", color: "var(--danger-ink)", borderColor: "var(--danger-line)" }} role="alert">
              No se pudo cargar el estado: {error}. <button type="button" className="btn-link" onClick={refresh}>Reintentar</button>
            </div>
          )}
          {state ? <Component key={page.path} /> : !error && <p className="help p-8">Cargando…</p>}
        </main>
      </div>
      <Toast message={toast} onClose={() => setToast(null)} />
    </AppContext.Provider>
  );
}
