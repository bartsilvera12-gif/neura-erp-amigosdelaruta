"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getVentas, anularVenta } from "@/lib/ventas/storage";

/**
 * «Editar en la caja»: volver atrás cuando la vista previa muestra algo mal.
 *
 * Una venta confirmada no se edita en el lugar. El stock ya se descontó y la
 * factura ya nació con su número, así que cambiarle los ítems por debajo
 * dejaría el inventario y la numeración diciendo cosas distintas.
 *
 * Lo que se hace es deshacerla y rehacerla: se anula la venta —lo que devuelve
 * el stock y deja la factura sin efecto— y se vuelve a la caja con el carrito
 * cargado tal como estaba. Se corrige lo que haya que corregir y se confirma
 * de nuevo.
 *
 * Solo aparece mientras el documento electrónico no haya sido aceptado por la
 * SET: después de eso ya no es una corrección, es una cancelación o una nota
 * de crédito.
 */
export default function EditarEnCajaButton({ facturaId }: { facturaId: string }) {
  const router = useRouter();
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function editar() {
    setError(null);
    setTrabajando(true);
    try {
      const ventas = await getVentas();
      const venta = ventas.find((v) => v.factura_id === facturaId);
      if (!venta) {
        setError(
          "Esta factura no salió de una venta de caja, así que no hay a dónde volver. Anulala y cargá una nueva."
        );
        return;
      }
      if (String(venta.estado ?? "") === "anulada") {
        router.push(`/ventas/nueva?rehacer=${encodeURIComponent(venta.id)}`);
        return;
      }

      const ok = window.confirm(
        `Se va a anular la venta ${venta.numero_control} y esta factura, y volvés a la caja con los productos cargados para corregirlos.\n\nEl stock vuelve al inventario. ¿Seguimos?`
      );
      if (!ok) return;

      const r = await anularVenta(venta.id, "Corrección antes de emitir la factura");
      if (!r.success) {
        setError(r.error);
        return;
      }
      router.push(`/ventas/nueva?rehacer=${encodeURIComponent(venta.id)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo volver a la caja.");
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        disabled={trabajando}
        onClick={() => void editar()}
        className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
        title="Anular esta factura y volver a la caja para corregir la venta"
      >
        {trabajando ? "Volviendo…" : "Editar en la caja"}
      </button>
      {error ? (
        <p className="mt-1 text-[11px] text-amber-700">{error}</p>
      ) : null}
    </div>
  );
}
