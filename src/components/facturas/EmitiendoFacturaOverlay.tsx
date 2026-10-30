"use client";

import type { PasoEmision } from "@/lib/sifen/emitir-desde-caja";

/**
 * Lo que ve el cajero mientras el sistema emite la factura.
 *
 * El circuito tarda —firmar es local pero el SET responde cuando quiere— y
 * una pantalla quieta parece colgada. Mostrar los tres pasos convierte la
 * espera en algo legible: se entiende qué está pasando y, si falla, en cuál
 * de los tres fue.
 */

const PASOS: { id: PasoEmision; label: string }[] = [
  { id: "venta", label: "Registrando la venta" },
  { id: "documento", label: "Generando y firmando la factura" },
  { id: "set", label: "Esperando la aprobación de la SET" },
];

export default function EmitiendoFacturaOverlay({
  paso,
  error,
  onCerrar,
}: {
  paso: PasoEmision | null;
  error: string | null;
  onCerrar: () => void;
}) {
  if (!paso && !error) return null;

  const idx = PASOS.findIndex((p) => p.id === paso);
  const avance = error ? 100 : Math.max(10, ((idx + 1) / PASOS.length) * 100);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-600/60 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-2xl">
        {error ? (
          <>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-2xl text-amber-600">
              !
            </div>
            <h3 className="text-base font-semibold text-slate-900">
              La venta se registró, pero la factura no se emitió
            </h3>
            <p className="mt-2 text-sm text-slate-500">{error}</p>
            <button
              type="button"
              onClick={onCerrar}
              className="mt-5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Abrir la factura
            </button>
          </>
        ) : (
          <>
            <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-[#4FAEB2]" />
            <h3 className="text-base font-semibold text-slate-900">Emitiendo tu factura</h3>
            <p className="mt-1 text-xs text-slate-500">No cierres esta pantalla.</p>

            <div className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-[#4FAEB2] transition-all duration-500"
                style={{ width: `${avance}%` }}
              />
            </div>

            <ul className="mt-5 space-y-2.5 text-left">
              {PASOS.map((p, i) => {
                const hecho = i < idx;
                const actual = i === idx;
                return (
                  <li key={p.id} className="flex items-center gap-2.5">
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                        hecho
                          ? "border-[#4FAEB2] bg-[#4FAEB2]"
                          : actual
                            ? "border-[#4FAEB2]"
                            : "border-slate-200"
                      }`}
                    >
                      {actual ? <span className="h-1.5 w-1.5 rounded-full bg-[#4FAEB2]" /> : null}
                    </span>
                    <span
                      className={`text-sm ${
                        hecho || actual ? "text-slate-800" : "text-slate-400"
                      }`}
                    >
                      {p.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
