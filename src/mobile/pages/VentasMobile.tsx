"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
// import { NuevaFacturaCajaModal } from "@/components/caja/NuevaFacturaCajaModal"; // Nueva factura — COMENTADO
import CajaControlPanel from "@/components/caja/CajaControlPanel";
import { getVentas } from "@/lib/ventas/storage";
import type { Venta } from "@/lib/ventas/types";

/**
 * Caja en celular. Misma idea que la de escritorio, en una columna: el total
 * del día, las dos acciones y las últimas ventas.
 *
 * Antes era sólo el botón de factura rápida, igual que en escritorio, y la
 * venta con productos no se podía abrir desde acá.
 */

function formatGs(valor: number) {
  return `Gs. ${Math.round(valor).toLocaleString("es-PY")}`;
}

function esDeHoy(iso: string): boolean {
  try {
    const f = new Date(iso);
    const h = new Date();
    return (
      f.getFullYear() === h.getFullYear() && f.getMonth() === h.getMonth() && f.getDate() === h.getDate()
    );
  } catch {
    return false;
  }
}

export default function VentasMobile() {
  // const [open, setOpen] = useState(false); // Nueva factura — COMENTADO
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getVentas()
      .then((data) => {
        if (cancelled) return;
        setVentas(
          [...data].sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
        );
      })
      .finally(() => {
        if (!cancelled) setCargando(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const deHoy = ventas.filter((v) => esDeHoy(v.fecha));
  const totalHoy = deHoy.reduce((s, v) => s + v.total, 0);

  return (
    <div className="mx-auto max-w-md px-4 py-6">
      <header className="mb-5">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Caja</h1>
        <p className="text-sm text-slate-500">Turno de caja, cobro y registro de ventas</p>
      </header>

      {/* El turno: abrir, movimientos, arqueo y cierre. Mismo panel que en
          escritorio; el cajero suele tener el teléfono a mano y no la pantalla. */}
      <div className="mb-5">
        <CajaControlPanel />
      </div>

      <div className="mb-5 rounded-2xl border border-[#4FAEB2] bg-[#4FAEB2] px-5 py-4 shadow-sm">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/90">
          Facturación de hoy
        </span>
        <p className="text-2xl font-bold leading-tight tabular-nums text-white">
          {formatGs(totalHoy)}
        </p>
        <span className="text-xs text-white/80">
          {deHoy.length === 1 ? "1 orden registrada" : `${deHoy.length} órdenes registradas`}
        </span>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-2">
        <Link
          href="/ventas/nueva"
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#4FAEB2] px-6 py-4 text-base font-semibold text-white shadow-sm shadow-[#4FAEB2]/25 transition-colors hover:bg-[#3F8E91]"
        >
          <Plus className="h-5 w-5" />
          Nueva venta
        </Link>
        {/* Nueva factura — COMENTADO (ver VentasDesktop para el porqué)
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-6 py-4 text-base font-medium text-slate-700 shadow-sm transition-colors hover:border-[#4FAEB2]/60 hover:text-[#4FAEB2]"
        >
          <FileText className="h-5 w-5" />
          Nueva factura
        </button> */}
      </div>

      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Últimas ventas
      </h2>
      <div className="space-y-2">
        {cargando ? (
          <p className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
            Cargando…
          </p>
        ) : ventas.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
            No hay ventas registradas
          </p>
        ) : (
          ventas.slice(0, 15).map((v) => (
            <div
              key={v.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">
                  {v.items[0]?.producto_nombre ?? "Sin líneas"}
                  {v.items.length > 1 && (
                    <span className="ml-1 text-xs text-slate-400">+{v.items.length - 1}</span>
                  )}
                </p>
                <p className="font-mono text-[11px] text-slate-400">{v.numero_control}</p>
              </div>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-800">
                {formatGs(v.total)}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Nueva factura — COMENTADO
      <NuevaFacturaCajaModal open={open} onClose={() => setOpen(false)} /> */}
    </div>
  );
}
