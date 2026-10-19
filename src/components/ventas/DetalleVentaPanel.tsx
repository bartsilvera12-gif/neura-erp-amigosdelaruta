"use client";

import { useState } from "react";
import Link from "next/link";
import type { Venta } from "@/lib/ventas/types";
import { anularVenta } from "@/lib/ventas/storage";

/**
 * Detalle de una venta, con la opción de anularla.
 *
 * La lista de ventas mostraba el total y poco más: ni el cliente, ni el número
 * de factura, ni quién la hizo. Para saber qué era cada venta había que
 * adivinar por el monto.
 */

const fmtGs = (n: number) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;

function fmtFecha(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-PY", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Dato({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{k}</div>
      <div className="mt-0.5 text-sm text-slate-800">{v}</div>
    </div>
  );
}

export default function DetalleVentaPanel({
  venta,
  onClose,
  onAnulada,
}: {
  venta: Venta | null;
  onClose: () => void;
  onAnulada: () => Promise<void> | void;
}) {
  const [motivo, setMotivo] = useState("");
  const [anulando, setAnulando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  // Al cambiar de venta se limpia el formulario de anulación.
  const idActual = venta?.id ?? "";
  const [visto, setVisto] = useState(idActual);
  if (idActual !== visto) {
    setVisto(idActual);
    setMotivo("");
    setError(null);
    setConfirmando(false);
  }

  if (!venta) return null;
  const anulada = String(venta.estado ?? "") === "anulada";

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-y-auto overscroll-contain rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-mono text-lg font-bold text-slate-900">{venta.numero_control}</h3>
            <p className="mt-0.5 text-xs text-slate-500">{fmtFecha(venta.fecha)}</p>
          </div>
          {anulada ? (
            <span className="rounded-full bg-rose-50 px-3 py-1 text-[11px] font-semibold text-rose-700">
              Anulada
            </span>
          ) : null}
        </div>

        {anulada && venta.motivo_anulacion ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            <b>Motivo:</b> {venta.motivo_anulacion}
          </div>
        ) : null}

        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <Dato k="Cliente" v={venta.cliente_nombre ?? "—"} />
          <Dato k="RUC / CI" v={venta.cliente_ruc ?? "—"} />
          <Dato
            k="Factura"
            v={
              venta.factura_id ? (
                <Link
                  href={`/facturas/${venta.factura_id}`}
                  className="font-mono text-[#3F8E91] hover:underline"
                >
                  {venta.factura_numero ?? "Ver factura"}
                </Link>
              ) : (
                "Sin factura"
              )
            }
          />
          <Dato k="Tipo" v={venta.tipo_venta === "CREDITO" ? "Crédito" : "Contado"} />
          <Dato k="Cobro" v={venta.metodo_pago ?? "—"} />
          <Dato k="Vendió" v={venta.usuario_nombre ?? "—"} />
        </div>

        <div className="mt-5 overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Producto</th>
                <th className="px-3 py-2 text-right font-semibold">Cant.</th>
                <th className="px-3 py-2 text-right font-semibold">Precio</th>
                <th className="px-3 py-2 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {venta.items.map((it, i) => (
                <tr key={i}>
                  <td className="px-3 py-2">
                    <div className="text-slate-800">{it.producto_nombre}</div>
                    <div className="font-mono text-[11px] text-slate-400">{it.sku}</div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{it.cantidad}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtGs(it.precio_venta)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {fmtGs(it.total_linea)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50/70 text-sm">
              <tr>
                <td colSpan={3} className="px-3 py-2 text-right text-slate-500">
                  Subtotal
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtGs(venta.subtotal)}</td>
              </tr>
              <tr>
                <td colSpan={3} className="px-3 py-2 text-right text-slate-500">
                  IVA
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtGs(venta.monto_iva)}</td>
              </tr>
              <tr>
                <td colSpan={3} className="px-3 py-2 text-right font-semibold text-slate-700">
                  Total
                </td>
                <td className="px-3 py-2 text-right font-bold tabular-nums">{fmtGs(venta.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {error}
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            Cerrar
          </button>

          {!anulada && !confirmando ? (
            <button
              type="button"
              onClick={() => setConfirmando(true)}
              className="rounded-lg border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50"
            >
              Anular venta
            </button>
          ) : null}
        </div>

        {!anulada && confirmando ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50/60 p-4">
            <p className="text-xs text-rose-800">
              Se devuelve al stock lo que se vendió y la venta queda sin efecto. No se puede
              deshacer.
            </p>
            <textarea
              rows={2}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Motivo de la anulación"
              className="mt-2 w-full resize-none rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-rose-200"
            />
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={motivo.trim().length < 5 || anulando}
                onClick={async () => {
                  setAnulando(true);
                  setError(null);
                  const r = await anularVenta(venta.id, motivo.trim());
                  setAnulando(false);
                  if (!r.success) {
                    setError(r.error);
                    return;
                  }
                  setConfirmando(false);
                  await onAnulada();
                }}
                className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-40"
              >
                {anulando ? "Anulando…" : "Confirmar anulación"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmando(false)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
