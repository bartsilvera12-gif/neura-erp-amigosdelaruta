"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, X } from "lucide-react";

/**
 * Aviso de "hay una versión nueva, recargá".
 *
 * Next sirve el JS con hash y el navegador lo cachea: después de un deploy, la
 * pestaña que ya estaba abierta sigue corriendo el bundle viejo hasta que
 * alguien hace Ctrl+F5. Eso es molesto y, peor, hace que un arreglo recién
 * deployado parezca no haber funcionado.
 *
 * Cómo se entera: `/api/deploy-info` devuelve el `build_id` del contenedor.
 * Guardamos el primero que vemos y comparamos. Si cambió, hubo deploy.
 *
 * Cuándo consulta:
 *   · al montar, para fijar la referencia
 *   · cada 5 minutos
 *   · cuando la pestaña vuelve a primer plano, que es el caso real — alguien
 *     deja el ERP abierto, se va, y vuelve horas después
 *
 * Con la pestaña oculta no consulta: no tiene sentido gastar pedidos contra un
 * ERP que nadie está mirando.
 *
 * No recarga solo: el usuario puede estar a mitad de una carga y perder lo
 * escrito. Avisa y deja decidir, y se puede posponer.
 */

const INTERVALO_MS = 5 * 60 * 1000;

export default function NuevaVersionAviso() {
  const [hayVersionNueva, setHayVersionNueva] = useState(false);
  const [descartado, setDescartado] = useState(false);
  /** Build id con el que se cargó esta pestaña. */
  const referencia = useRef<string | null>(null);

  const chequear = useCallback(async () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    try {
      const r = await fetch("/api/deploy-info", { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as { build_id?: unknown };
      const actual = typeof j.build_id === "string" && j.build_id ? j.build_id : null;
      if (!actual) return; // sin build id resoluble, el aviso no aplica

      if (referencia.current === null) {
        referencia.current = actual;
        return;
      }
      if (actual !== referencia.current) setHayVersionNueva(true);
    } catch {
      // Si falla, no pasa nada: se reintenta en el próximo ciclo. Un error de
      // red acá no tiene por qué molestar al usuario.
    }
  }, []);

  useEffect(() => {
    void chequear();
    const id = window.setInterval(() => void chequear(), INTERVALO_MS);
    const alVolver = () => {
      if (document.visibilityState === "visible") void chequear();
    };
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("focus", alVolver);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("focus", alVolver);
    };
  }, [chequear]);

  if (!hayVersionNueva || descartado) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 z-[60] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-2xl border border-[#4FAEB2]/40 bg-white p-4 shadow-lg shadow-slate-900/10"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#4FAEB2]/12 text-[#4FAEB2]">
          <RefreshCw className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-900">Hay una versión nueva</div>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
            Recargá para usarla. Si estás completando algo, guardalo primero: al recargar se
            pierde lo que no esté guardado.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 rounded-xl bg-[#4FAEB2] px-3.5 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Recargar
            </button>
            <button
              type="button"
              onClick={() => setDescartado(true)}
              className="rounded-xl px-3 py-2 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100"
            >
              Ahora no
            </button>
          </div>
        </div>
        <button
          type="button"
          aria-label="Cerrar aviso"
          onClick={() => setDescartado(true)}
          className="shrink-0 rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
